'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import { DIRECT_BACKOFF_MS, DIRECT_POLL_MS, eposErrorLabel, type BluetoothLink } from '@/lib/direct-print';
import { nativeBluetooth } from '@/lib/native-app';
import { postDirect, readDirectPrintConfig, sendToEposPrinter } from './direct-print-client';

interface NextJob {
  id: string;
  printerId: string;
  printerName: string;
  host: string;
  soap: string;
}

interface NextBtJob {
  id: string;
  printerId: string;
  printerName: string;
  data: string;
}

/** Bluetooth で送れなかったときの理由（アプリが返す code）のうち、「つながらない」もの */
const BT_UNREACHABLE = new Set(['not_found', 'connect', 'unreachable', 'bluetooth_off', 'timeout', 'no_sdk']);

/**
 * この端末だけで動く印刷（レジの設定「このiPadのプリンター」で ON にした端末だけ。それ以外は何もしない）。
 *   - Wi-Fi で直接印刷（EPSON）：1秒ごとに印刷を受け取り、お店の Wi-Fi でプリンターへ直接送る。
 *     つながらないときは印刷をキューに戻し、プリンター自身の Server Direct Print に任せる。
 *   - Bluetooth・USB（TENPO ONE レジ アプリだけ）：レシートプリンター＋ドロアを iPad とつなぐ。
 *     アプリ（ios/Shared/BluetoothPrinters.swift）が Star は StarPRNT、EPSON・SII・ESC/POS は ESC/POS を送る。
 */
export function DirectPrintAgent() {
  const { toast } = useToast();

  useEffect(() => {
    let stopped = false;
    let running = false;
    let timer: number | undefined;
    let wifiBackoffUntil = 0;
    let btBackoffUntil = 0;
    let warnedWifi = false;
    let warnedBt = false;
    let config = readDirectPrintConfig();

    const schedule = (ms: number) => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), ms);
    };

    const done = (job: { id: string; printerId: string }, result: 'printed' | 'failed' | 'unreachable', code?: string | null) =>
      postDirect({ action: 'done', printerId: job.printerId, jobId: job.id, result, code: code ?? null });

    /** Bluetooth のレシートプリンター。印刷したら true（続けて次を見る） */
    async function bluetoothOnce(links: BluetoothLink[]): Promise<boolean> {
      const bt = nativeBluetooth();
      if (!bt || links.length === 0 || Date.now() < btBackoffUntil) return false;
      const res = await postDirect<{ ok: boolean; job: NextBtJob | null }>({
        action: 'next-bt',
        printerIds: links.map((l) => l.printerId),
      });
      const job = res?.job ?? null;
      if (!job) return false;
      const link = links.find((l) => l.printerId === job.printerId);
      if (!link) {
        await done(job, 'unreachable');
        return false;
      }
      const sent = await bt.print({ deviceId: link.deviceId, maker: link.maker, via: link.via, data: job.data });
      if (sent.ok) {
        await done(job, 'printed');
        warnedBt = false;
        return true;
      }
      if (BT_UNREACHABLE.has(sent.code ?? '')) {
        // 戻して、少し待ってからもう一度（Bluetooth はプリンター自身では印刷しないので、つながれば出る）
        await done(job, 'unreachable');
        btBackoffUntil = Date.now() + 5000;
        if (!warnedBt) {
          toast(`${job.printerName} につながりません。プリンターの電源と iPad の Bluetooth（USB はケーブル）を確かめてください`, 'error');
          warnedBt = true;
        }
        return false;
      }
      await done(job, 'failed', `bt: ${sent.code ?? 'error'}`);
      toast(`${job.printerName}：${eposErrorLabel(sent.code ?? null)}`, 'error');
      return false;
    }

    /** Wi-Fi で直接印刷（EPSON）。印刷したら true */
    async function wifiOnce(ids: string[]): Promise<boolean> {
      if (ids.length === 0 || Date.now() < wifiBackoffUntil) return false;
      const res = await postDirect<{ ok: boolean; job: NextJob | null }>({ action: 'next', printerIds: ids });
      const job = res?.job ?? null;
      if (!job) return false;

      const sent = await sendToEposPrinter(job.host, job.soap);
      if (sent.kind === 'printed') {
        await done(job, 'printed');
        warnedWifi = false;
        return true;
      }
      if (sent.kind === 'unreachable') {
        await done(job, 'unreachable');
        wifiBackoffUntil = Date.now() + DIRECT_BACKOFF_MS;
        if (!warnedWifi) {
          toast(`${job.printerName} に Wi-Fi でつながりません。プリンター自身の印刷に切り替えます`, 'error');
          warnedWifi = true;
        }
        return false;
      }
      if (sent.kind === 'timeout') {
        // 送ったが返事が無い：もう一度送ると2枚出るかもしれないので、戻さない
        await done(job, 'failed', 'direct: timeout');
        toast(`${job.printerName} の返事がありません。印刷されたか確かめてください`, 'error');
        return false;
      }
      await done(job, 'failed', sent.code);
      toast(`${job.printerName}：${eposErrorLabel(sent.code)}`, 'error');
      return false;
    }

    async function tick() {
      if (stopped) return;
      if (running) return schedule(DIRECT_POLL_MS);
      const links = nativeBluetooth() ? (config.bluetooth ?? []) : [];
      if (config.printerIds.length === 0 && links.length === 0) return; // この端末は使っていない（何もしない）
      if (document.visibilityState !== 'visible') return schedule(DIRECT_POLL_MS);

      running = true;
      try {
        const printedBt = await bluetoothOnce(links);
        const printedWifi = await wifiOnce(config.printerIds);
        return schedule(printedBt || printedWifi ? 0 : DIRECT_POLL_MS); // 印刷したら続けて次の1件
      } finally {
        running = false;
      }
    }

    const onChange = () => {
      config = readDirectPrintConfig();
      wifiBackoffUntil = 0;
      btBackoffUntil = 0;
      schedule(0);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };

    window.addEventListener('tenpo-direct-print-changed', onChange);
    window.addEventListener('storage', onChange);
    document.addEventListener('visibilitychange', onVisible);
    schedule(800);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('tenpo-direct-print-changed', onChange);
      window.removeEventListener('storage', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [toast]);

  return null;
}
