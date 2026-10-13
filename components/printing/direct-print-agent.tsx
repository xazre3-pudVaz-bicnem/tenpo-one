'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import { DIRECT_BACKOFF_MS, DIRECT_POLL_MS, eposErrorLabel } from '@/lib/direct-print';
import { postDirect, readDirectPrintConfig, sendToEposPrinter } from './direct-print-client';

interface NextJob {
  id: string;
  printerId: string;
  printerName: string;
  host: string;
  soap: string;
}

/**
 * Wi-Fi で直接印刷（EPSON）。レジの設定「このiPadのプリンター」で ON にした端末だけで動く（それ以外は何もしない）。
 * 画面を開いている間、1秒ごとにそのプリンター宛ての印刷を受け取り、お店の Wi-Fi でプリンターへ直接送る。
 * つながらないときは印刷をキューに戻し、プリンター自身の Server Direct Print に任せる（今の印刷はそのまま動く）。
 */
export function DirectPrintAgent() {
  const { toast } = useToast();

  useEffect(() => {
    let stopped = false;
    let running = false;
    let timer: number | undefined;
    let backoffUntil = 0;
    let warnedUnreachable = false;
    let config = readDirectPrintConfig();

    const schedule = (ms: number) => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), ms);
    };

    const done = (job: NextJob, result: 'printed' | 'failed' | 'unreachable', code?: string | null) =>
      postDirect({ action: 'done', printerId: job.printerId, jobId: job.id, result, code: code ?? null });

    async function tick() {
      if (stopped) return;
      if (running) return schedule(DIRECT_POLL_MS);
      if (config.printerIds.length === 0) return; // この端末は使っていない（何もしない）
      if (document.visibilityState !== 'visible' || Date.now() < backoffUntil) return schedule(DIRECT_POLL_MS);

      running = true;
      try {
        const res = await postDirect<{ ok: boolean; job: NextJob | null }>({ action: 'next', printerIds: config.printerIds });
        const job = res?.job ?? null;
        if (!job) return schedule(DIRECT_POLL_MS);

        const sent = await sendToEposPrinter(job.host, job.soap);
        if (sent.kind === 'printed') {
          await done(job, 'printed');
          warnedUnreachable = false;
          return schedule(0); // 続けて次の1件
        }
        if (sent.kind === 'unreachable') {
          await done(job, 'unreachable');
          backoffUntil = Date.now() + DIRECT_BACKOFF_MS;
          if (!warnedUnreachable) {
            toast(`${job.printerName} に Wi-Fi でつながりません。プリンター自身の印刷に切り替えます`, 'error');
            warnedUnreachable = true;
          }
          return schedule(DIRECT_POLL_MS);
        }
        if (sent.kind === 'timeout') {
          // 送ったが返事が無い：もう一度送ると2枚出るかもしれないので、戻さない
          await done(job, 'failed', 'direct: timeout');
          toast(`${job.printerName} の返事がありません。印刷されたか確かめてください`, 'error');
          return schedule(DIRECT_POLL_MS);
        }
        await done(job, 'failed', sent.code);
        toast(`${job.printerName}：${eposErrorLabel(sent.code)}`, 'error');
        return schedule(DIRECT_POLL_MS);
      } finally {
        running = false;
      }
    }

    const onChange = () => {
      config = readDirectPrintConfig();
      backoffUntil = 0;
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
