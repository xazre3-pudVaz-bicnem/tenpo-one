'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { BellRing, CalendarCheck2, CalendarPlus, CalendarX2, Check, ClipboardList, LogOut, Mail, PencilLine, PhoneCall } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import {
  acknowledgeReservation,
  confirmPendingReservation,
  markReservationContacted,
  resolveInboxImport,
} from '@/app/app/reservations/actions';
import type { InboxNotice, InboxTask, InboxTaskKind } from '@/lib/reservation-inbox-server';
import { markInboxSeen, unreadCount, useInboxSeen } from './inbox-seen';

/**
 * 予約の画面の上のタブ「予約一覧 ｜ 受付管理 ｜ メッセージ」と、その中身（ハンディ・レジ・PC 共通）。
 * 2026-10-19 Ronnie「予約受付管理・メッセージは予約の画面の上のタブに（サイドメニューではなく）。
 * 受付管理は全部（仮予約・要連絡・グルメサイト要確認・新しいネット予約・変更キャンセル）。
 * メッセージはお客様の新しい予約・変更・キャンセルのお知らせが来る箱」。
 */

export type InboxTab = 'list' | 'inbox' | 'messages';
type Variant = 'handy' | 'ledger';

function jstStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const reservationHref = (variant: Variant, date: string | null) =>
  date ? (variant === 'handy' ? `/handy/reservations?date=${date}` : `/app/reservations?date=${date}`) : null;

/* ------------------------------------------------------------------ タブ */

export function ReservationInboxTabs({
  active,
  hrefs,
  taskCount,
  noticeTimes,
  storeId,
  variant,
  listLabel = '予約一覧',
}: {
  active: InboxTab;
  hrefs: Record<InboxTab, string>;
  /** 受付管理のやること（数字） */
  taskCount: number;
  /** メッセージの時刻（未読の数を数える） */
  noticeTimes: string[];
  storeId: string;
  variant: Variant;
  listLabel?: string;
}) {
  const seen = useInboxSeen(storeId);
  const [now] = useState(() => Date.now());
  const unread = unreadCount(noticeTimes, seen, now);
  const tabs: { key: InboxTab; label: string; count: number; tone: 'red' | 'blue' }[] = [
    { key: 'list', label: listLabel, count: 0, tone: 'red' },
    { key: 'inbox', label: '受付管理', count: taskCount, tone: 'red' },
    { key: 'messages', label: 'メッセージ', count: active === 'messages' ? 0 : unread, tone: 'blue' },
  ];
  return (
    <nav
      aria-label="予約の画面"
      className={cn(
        'flex shrink-0 border-b border-[#e5dfd5] bg-white',
        variant === 'handy' ? 'px-1' : 'mb-3 w-fit rounded-[10px] border p-1 print:hidden'
      )}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={hrefs[t.key]}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'relative flex items-center justify-center gap-1.5 font-bold whitespace-nowrap',
              variant === 'handy'
                ? cn(
                    'h-11 flex-1 border-b-[3px] text-[13.5px]',
                    on ? 'border-[#bc5940] text-[#292725]' : 'border-transparent text-[#766b62] active:text-[#292725]'
                  )
                : cn(
                    'h-9 rounded-[7px] px-4 text-[14px]',
                    on ? 'bg-[#292725] text-white' : 'text-[#5c5650] hover:bg-[#f3efe8]'
                  )
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={cn(
                  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold text-white tabular-nums',
                  t.tone === 'red' ? 'bg-[#c2410c]' : 'bg-[#2563eb]'
                )}
              >
                {t.count > 99 ? '99+' : t.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ 受付管理 */

const GROUPS: { kind: InboxTaskKind; label: string; hint: string; icon: typeof Check }[] = [
  { kind: 'pending', label: '仮予約', hint: '確定するとお店の予約になります', icon: ClipboardList },
  { kind: 'contact', label: '要連絡', hint: 'お客様に連絡したら「連絡済み」', icon: PhoneCall },
  { kind: 'new', label: '新しいネット予約', hint: 'ネット・グルメサイトから入った予約。見たら「確認済み」', icon: CalendarPlus },
  { kind: 'change', label: '変更・キャンセル', hint: 'お客様・グルメサイトからの変更とキャンセル', icon: PencilLine },
  { kind: 'gourmet', label: 'グルメサイト 要確認', hint: 'メールを読み取れませんでした。内容を見て台帳に入れてください', icon: Mail },
];

function primaryAction(t: InboxTask): { label: string; done: string; run: () => Promise<unknown> } | null {
  if (t.kind === 'pending' && t.reservationId) {
    const id = t.reservationId;
    return { label: '確定する', done: `${t.title}の予約を確定しました`, run: () => confirmPendingReservation(id) };
  }
  if (t.kind === 'contact' && t.reservationId) {
    const id = t.reservationId;
    return { label: '連絡済み', done: `${t.title}を連絡済みにしました`, run: () => markReservationContacted(id) };
  }
  if (t.importId) {
    const id = t.importId;
    return { label: '対応済み', done: '対応済みにしました', run: () => resolveInboxImport(id) };
  }
  if ((t.kind === 'new' || t.kind === 'change') && t.reservationId) {
    const id = t.reservationId;
    return { label: '確認済み', done: '確認済みにしました', run: () => acknowledgeReservation(id) };
  }
  return null;
}

export function InboxTaskList({
  tasks,
  canAcknowledge,
  canWrite,
  variant,
}: {
  tasks: InboxTask[];
  canAcknowledge: boolean;
  canWrite: boolean;
  variant: Variant;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = (t: InboxTask) => {
    const a = primaryAction(t);
    if (!a) return;
    setBusyKey(t.key);
    startTransition(async () => {
      try {
        await a.run();
        toast(a.done);
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '変更できませんでした', 'error');
      } finally {
        setBusyKey(null);
      }
    });
  };

  return (
    <div className={cn('space-y-4', variant === 'handy' ? 'px-3 pt-3 pb-6' : 'max-w-3xl')}>
      {tasks.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-[#e5dfd5] bg-white px-5 py-10 text-center">
          <CalendarCheck2 className="h-8 w-8 text-[#3f7a4f]" aria-hidden />
          <p className="text-[15px] font-bold text-[#292725]">やることはありません</p>
          <p className="text-[12px] leading-relaxed text-[#766b62]">
            仮予約・要連絡・新しいネット予約・変更・キャンセル・グルメサイトの要確認が入ると、ここに出ます。
          </p>
        </div>
      )}

      {GROUPS.map((g) => {
        const items = tasks.filter((t) => t.kind === g.kind);
        if (items.length === 0) return null;
        const Icon = g.icon;
        return (
          <section key={g.kind} aria-label={g.label}>
            <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-[13px] font-bold text-[#292725]">
              <Icon className="h-4 w-4 shrink-0 text-[#bc5940]" aria-hidden />
              <span className="shrink-0 whitespace-nowrap">{g.label}</span>
              <span className="shrink-0 rounded-full bg-[#f9ede6] px-2 py-0.5 text-[11px] whitespace-nowrap text-[#bc5940] tabular-nums">
                {items.length}件
              </span>
              <span className="ml-1 min-w-0 flex-1 truncate text-[10.5px] font-normal text-[#766b62]">{g.hint}</span>
            </h2>
            <ul className="overflow-hidden rounded-[12px] border border-[#e5dfd5] bg-white">
              {items.map((t) => {
                const a = primaryAction(t);
                const href = reservationHref(variant, t.date);
                const busy = pending && busyKey === t.key;
                return (
                  <li key={t.key} className="flex items-center gap-3 border-b border-[#efe9e0] px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-bold text-[#292725]">{t.title}</p>
                      <p className="mt-0.5 truncate text-[12.5px] font-semibold text-[#45403b] tabular-nums">{t.detail}</p>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-[#766b62]">
                        {t.note && <span className="truncate rounded bg-[#f3efe8] px-1.5 py-px">{t.note}</span>}
                        <span className="shrink-0 tabular-nums">{jstStamp(t.at)} 受付</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
                      {canWrite && a && (
                        <button
                          type="button"
                          onClick={() => run(t)}
                          disabled={pending}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] bg-[#bc5940] px-3 text-[13px] font-bold text-white active:bg-[#a24a33] disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden />
                          {busy ? '…' : a.label}
                        </button>
                      )}
                      {href && (
                        <Link
                          href={href}
                          className="inline-flex h-9 items-center justify-center rounded-[8px] border border-[#e5dfd5] bg-white px-3 text-[12.5px] font-bold text-[#45403b] active:bg-[#f6ebe3]"
                        >
                          予約を見る
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {!canAcknowledge && (
        <p className="px-1 text-[10.5px] leading-relaxed text-[#766b62]">
          「新しいネット予約」と「お客様のキャンセル」の確認は、データベースの更新（00100）のあとに出ます。
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ メッセージ */

const NOTICE_LOOK: Record<InboxNotice['kind'], { icon: typeof Check; label: string; className: string }> = {
  new: { icon: CalendarPlus, label: '新規', className: 'bg-[#e8f3ec] text-[#2f6b3f]' },
  change: { icon: PencilLine, label: '変更', className: 'bg-[#e8eefb] text-[#2b4fa8]' },
  cancel: { icon: CalendarX2, label: 'キャンセル', className: 'bg-[#fbeaea] text-[#b42318]' },
  // ウォークインが帰った（予約台帳の「退店」と同じ茶色がかった灰色）
  left: { icon: LogOut, label: '退店', className: 'bg-[#efebe7] text-[#6b625a]' },
};

export function InboxNoticeList({ notices, storeId, variant }: { notices: InboxNotice[]; storeId: string; variant: Variant }) {
  const prev = useInboxSeen(storeId, 'prev');
  const latest = notices[0]?.at ?? null;
  // 開いたら、いちばん新しいお知らせまで読んだことにする（タブの数字が消える）
  useEffect(() => {
    markInboxSeen(storeId, latest);
  }, [storeId, latest]);

  return (
    <div className={cn(variant === 'handy' ? 'px-3 pt-3 pb-6' : 'max-w-3xl')}>
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-[#766b62]">
        <BellRing className="h-3.5 w-3.5 text-[#bc5940]" aria-hidden />
        お客様の新しい予約・変更・キャンセルのお知らせ（14日分）
      </p>
      {notices.length === 0 ? (
        <div className="rounded-[12px] border border-[#e5dfd5] bg-white px-5 py-10 text-center text-[13px] text-[#766b62]">
          お知らせはまだありません
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-[#e5dfd5] bg-white">
          {notices.map((n) => {
            const look = NOTICE_LOOK[n.kind];
            const Icon = look.icon;
            const fresh = typeof prev === 'string' ? n.at > prev : false;
            const href = reservationHref(variant, n.date);
            const body = (
              <>
                <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', look.className)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-bold text-[#292725]">{n.title}</span>
                    {fresh && (
                      <span className="shrink-0 rounded-full bg-[#2563eb] px-1.5 py-px text-[10px] font-bold text-white">新着</span>
                    )}
                  </span>
                  {n.detail && <span className="mt-0.5 block truncate text-[12.5px] font-semibold text-[#45403b] tabular-nums">{n.detail}</span>}
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[#766b62]">
                    <span className={cn('rounded px-1.5 py-px font-bold', look.className)}>{look.label}</span>
                    {n.note && <span className="truncate">{n.note}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] text-[#766b62] tabular-nums">{jstStamp(n.at)}</span>
              </>
            );
            return (
              <li key={n.key} className={cn('border-b border-[#efe9e0] last:border-b-0', fresh && 'bg-[#f5f8ff]')}>
                {href ? (
                  <Link href={href} className="flex items-start gap-2.5 px-3 py-2.5 active:bg-[#f6ebe3]">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2.5 px-3 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
