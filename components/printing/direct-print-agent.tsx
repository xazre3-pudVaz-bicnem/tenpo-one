'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import { DIRECT_BACKOFF_MS, DIRECT_POLL_MS, eposErrorLabel, type BluetoothLink } from '@/lib/direct-print';
import { nativeBluetooth, nativeLan } from '@/lib/native-app';
import { postDirect, readDirectPrintConfig, sendToEposPrinter } from './direct-print-client';
import { buildSiiAgentPrint, openSiiAgent } from './sii-agent-client';

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

interface NextAgentJob {
  id: string;
  printerId: string;
  printerName: string;
  epos: string;
  paper: 58 | 80;
}

interface NextLanJob {
  id: string;
  printerId: string;
  printerName: string;
  host: string;
  port: number;
  data: string;
}

/** LAN のプリンターにつながらなかったとき、そのプリンターを次に試すまで（ほかのプリンターは止めない） */
const LAN_BACKOFF_MS = 5000;

/** SII URL Print Agent を開いてから、開けなかった（Safari の「開きますか？」で開かなかった）とみなすまで */
const AGENT_OPEN_TIMEOUT_MS = 30_000;

/** Bluetooth で送れなかったときの理由（アプリが返す code）のうち、「つながらない」もの */
const BT_UNREACHABLE = new Set(['not_found', 'connect', 'unreachable', 'bluetooth_off', 'timeout', 'no_sdk']);

/**
 * この端末だけで動く印刷（レジの設定「このiPadのプリンター」で ON にした端末だけ。それ以外は何もしない）。
 *   - Wi-Fi で直接印刷（EPSON）：1秒ごとに印刷を受け取り、お店の Wi-Fi でプリンターへ直接送る。
 *     つながらないときは印刷をキューに戻し、プリンター自身の Server Direct Print に任せる。
 *   - Bluetooth・USB（TENPO ONE レジ アプリだけ）：レシートプリンター＋ドロアを iPad とつなぐ。
 *     アプリ（ios/Shared/BluetoothPrinters.swift）が Star は StarPRNT、EPSON・SII・ESC/POS は ESC/POS を送る。
 *   - SII URL Print Agent（Safari。SII の RP-F10 など）：印刷を受け取り、画像・PDF にして SII の無料アプリを開く
 *     （lib/sii-url-print.ts）。アプリが印刷して Safari に戻ってきたら次の印刷。
 *   - LAN（TENPO ONE レジ アプリだけ）：SII RP-F10（有線LAN）・EPSON など、Wi-Fi・有線LAN のプリンターへ
 *     ESC/POS をそのまま送る（ios/Shared/LanPrinters.swift）。厨房・ドリンクの伝票も。2026-10-16 Ronnie「LAN で」
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
    /** LAN：つながらなかったプリンターごとの、次に試す時刻 */
    const lanBackoff = new Map<string, number>();
    const lanWarned = new Set<string>();
    /** SII URL Print Agent を開いたところ（戻ってくるまで次を出さない） */
    let agentOpenedAt = 0;
    let agentLeft = false;
    let agentResumeAt = 0;
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
      const sent = await bt.print({ deviceId: link.deviceId, maker: link.maker, via: link.via === 'usb' ? 'usb' : 'bluetooth', data: job.data });
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

    /** SII URL Print Agent（Safari）。アプリを開いたら true（戻ってくるまで待つ） */
    async function agentOnce(links: BluetoothLink[]): Promise<boolean> {
      if (links.length === 0) return false;
      if (agentOpenedAt > 0) {
        // 開いたのに Safari から出ていかない＝「開きますか？」で開かなかった・アプリが入っていない
        if (!agentLeft && Date.now() - agentOpenedAt > AGENT_OPEN_TIMEOUT_MS) {
          agentOpenedAt = 0;
          toast('SII URL Print Agent が開きませんでした。App Store で入れてあるか確かめ、レシートを印刷し直してください', 'error');
        }
        return false;
      }
      if (Date.now() < agentResumeAt) return false;
      const res = await postDirect<{ ok: boolean; job: NextAgentJob | null }>({
        action: 'next-bt',
        printerIds: links.map((l) => l.printerId),
        format: 'epos',
      });
      const job = res?.job ?? null;
      if (!job) return false;
      let url: string;
      try {
        url = (await buildSiiAgentPrint(job.epos, job.paper === 58 ? 58 : 80, { drawerAllowed: true })).url;
      } catch {
        await done(job, 'failed', 'sii-agent: render');
        toast(`${job.printerName}：印刷データを作れませんでした`, 'error');
        return false;
      }
      // 先に「印刷した」にする（アプリに移ると、この画面は止まるため。2枚出ないように）
      await done(job, 'printed');
      agentOpenedAt = Date.now();
      agentLeft = false;
      openSiiAgent(url);
      return true;
    }

    /** LAN のプリンター（アプリ）。印刷したら true（続けて次を見る） */
    async function lanOnce(ids: string[]): Promise<boolean> {
      const lan = nativeLan();
      const now = Date.now();
      const ready = ids.filter((id) => (lanBackoff.get(id) ?? 0) <= now);
      if (!lan || ready.length === 0) return false;
      const res = await postDirect<{ ok: boolean; job: NextLanJob | null }>({ action: 'next-lan', printerIds: ready });
      const job = res?.job ?? null;
      if (!job) return false;
      const sent = await lan.print({ host: job.host, port: job.port, data: job.data });
      if (sent.ok) {
        await done(job, 'printed');
        lanBackoff.delete(job.printerId);
        lanWarned.delete(job.printerId);
        return true;
      }
      if (sent.code === 'timeout_sent') {
        // 送りかけて返事が無い：もう一度送ると2枚出るかもしれないので、戻さない
        await done(job, 'failed', 'lan: timeout');
        toast(`${job.printerName} の返事がありません。印刷されたか確かめてください`, 'error');
        return false;
      }
      if (sent.code === 'unreachable' || sent.code === 'timeout') {
        // 戻して、少し待ってからもう一度（つながれば出る。EPSON はその間プリンター自身の印刷に任せる）
        await done(job, 'unreachable');
        lanBackoff.set(job.printerId, Date.now() + LAN_BACKOFF_MS);
        if (!lanWarned.has(job.printerId)) {
          toast(`${job.printerName} に LAN でつながりません。プリンターの電源・LAN ケーブル・IPアドレスを確かめてください`, 'error');
          lanWarned.add(job.printerId);
        }
        return false;
      }
      await done(job, 'failed', `lan: ${sent.code ?? 'error'}`);
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
      const inApp = nativeBluetooth() !== null;
      const all = config.bluetooth ?? [];
      // アプリ：Bluetooth・USB。Safari：SII URL Print Agent だけ
      const links = inApp ? all.filter((l) => l.via !== 'agent') : [];
      const agentLinks = inApp ? [] : all.filter((l) => l.via === 'agent');
      // LAN はアプリ（iPad）だけ
      const lanIds = nativeLan() ? (config.lan ?? []) : [];
      if (config.printerIds.length === 0 && links.length === 0 && agentLinks.length === 0 && lanIds.length === 0) return; // この端末は使っていない（何もしない）
      if (document.visibilityState !== 'visible') return schedule(DIRECT_POLL_MS);

      running = true;
      try {
        const printedBt = await bluetoothOnce(links);
        const openedAgent = await agentOnce(agentLinks);
        const printedWifi = await wifiOnce(config.printerIds);
        const printedLan = await lanOnce(lanIds);
        if (openedAgent) return schedule(DIRECT_POLL_MS);
        return schedule(printedBt || printedWifi || printedLan ? 0 : DIRECT_POLL_MS); // 印刷したら続けて次の1件
      } finally {
        running = false;
      }
    }

    const onChange = () => {
      config = readDirectPrintConfig();
      wifiBackoffUntil = 0;
      btBackoffUntil = 0;
      lanBackoff.clear();
      schedule(0);
    };
    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        if (agentOpenedAt > 0) agentLeft = true;
        return;
      }
      if (agentOpenedAt > 0 && agentLeft) {
        // SII URL Print Agent から戻ってきた → 少し待って次の印刷（アプリは印刷中の次の依頼を受け付けない）
        agentOpenedAt = 0;
        agentLeft = false;
        agentResumeAt = Date.now() + 1500;
      }
      schedule(0);
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
