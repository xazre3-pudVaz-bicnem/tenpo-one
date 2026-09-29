'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { POPUP_SNOOZE_MS } from '@/lib/announcement-popup';
import { closeReminderHiddenOn } from '@/lib/register-close-reminder';

const snoozeKey = (storeId: string, date: string) => `tenpo_close_reminder_snooze:${storeId}:${date}`;

function readSnooze(key: string): number | null {
  try {
    const v = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * 「〇〇さん、レジクローズがまだです」のポップアップ（2026-09-30 Ronnie）。
 * 「レジクローズへ」で締めの画面へ。「あとで」は10分後にもう一度出る（レジを閉めるまで出る）。
 * 注文画面・レジクローズ／開局の画面では出さない。
 */
export function RegisterClosePopup({ storeId, date, title, body }: { storeId: string; date: string; title: string; body: string }) {
  const pathname = usePathname() ?? '';
  const key = snoozeKey(storeId, date);
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage と時計は client でしか読めない
    setSnoozedUntil(readSnooze(key));
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [key]);

  if (now === 0 || closeReminderHiddenOn(pathname)) return null;
  if (snoozedUntil != null && now < snoozedUntil) return null;

  const later = () => {
    const until = Date.now() + POPUP_SNOOZE_MS;
    try {
      window.sessionStorage.setItem(key, String(until));
    } catch {
      // 使えなくても、この画面の間は覚えておけばよい
    }
    setSnoozedUntil(until);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="close-reminder-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line bg-danger-soft px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-danger">レジクローズ / Register close</p>
            <h2 id="close-reminder-title" className="text-[18px] leading-snug font-extrabold text-ink">
              {title}
            </h2>
          </div>
        </div>
        <p className="px-5 py-4 text-[14px] leading-relaxed text-ink-2">{body}</p>
        <div className="flex gap-2 border-t border-line px-5 py-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={later}>
            あとで
          </Button>
          <Link href="/app/cash/close" className={cn(buttonVariants({ size: 'lg' }), 'flex-[2]')}>
            レジクローズへ
          </Link>
        </div>
      </div>
    </div>
  );
}
