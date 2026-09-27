'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markAnnouncementRead } from '@/app/app/announcements/actions';
import { POPUP_SNOOZE_MS, shouldShowPopup, type PopupAnnouncement } from '@/lib/announcement-popup';

const SNOOZE_KEY = 'tenpo_announcement_snooze_until';

function readSnooze(): number | null {
  try {
    const v = Number(window.sessionStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeSnooze(until: number) {
  try {
    window.sessionStorage.setItem(SNOOZE_KEY, String(until));
  } catch {
    // 使えなくても、この画面の間は覚えておけばよい
  }
}

/**
 * 重要なお知らせを画面の真ん中に出す（2026-09-28 Ronnie「アラートは時々画面にポップアップ。了解を押すまで」）。
 * 「了解」を押すと既読になり、もう出ない。「あとで」を押すと10分後にもう一度出る。注文画面（/app/pos）では出さない。
 * レジ（iPad）は店舗で1つのアカウントなので、誰か1人が了解を押せばその店のレジでは出なくなる。
 */
export function AnnouncementPopup({ items }: { items: PopupAnnouncement[] }) {
  const pathname = usePathname() ?? '';
  const [queue, setQueue] = useState(items);
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [pending, startTransition] = useTransition();

  // 端末に覚えた「あとで」と、時計（10分たったらもう一度出す）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage と時計は client でしか読めない
    setSnoozedUntil(readSnooze());
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const current = queue[0];
  const visible = now > 0 && !!current && shouldShowPopup({ queueLength: queue.length, snoozedUntil, now, pathname });
  if (!visible || !current) return null;

  const acknowledge = () =>
    startTransition(async () => {
      try {
        await markAnnouncementRead(current.id);
      } catch {
        // 既読にできなくても、この画面では閉じる（次に開いたときにもう一度出る）
      }
      setQueue((q) => q.filter((a) => a.id !== current.id));
    });

  const later = () => {
    const until = Date.now() + POPUP_SNOOZE_MS;
    writeSnooze(until);
    setSnoozedUntil(until);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="ann-popup-title">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line bg-danger-soft px-5 py-4">
          <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-danger">重要なお知らせ{queue.length > 1 ? `（あと${queue.length - 1}件）` : ''}</p>
            <h2 id="ann-popup-title" className="text-[17px] font-extrabold leading-snug text-ink">
              {current.title}
            </h2>
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto px-5 py-4 text-[14px] leading-relaxed whitespace-pre-wrap text-ink-2">{current.body}</div>
        <div className="flex gap-2 border-t border-line px-5 py-3">
          <Button variant="secondary" className="flex-1" onClick={later} disabled={pending}>
            あとで
          </Button>
          <Button size="lg" className="flex-[2]" onClick={acknowledge} disabled={pending}>
            {pending ? '…' : '了解 / OK'}
          </Button>
        </div>
      </div>
    </div>
  );
}
