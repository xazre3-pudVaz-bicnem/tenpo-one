'use client';

/**
 * ホーム上部の「お知らせ Notices」カード（プロトタイプの .notice）。
 * - 本部・オーナーからのお知らせ（announcements）
 * - 自動検知（レジ締めの現金差額・alert_rules によるルール判定。旧「要対応」バーの内容を統合）
 * - 今日のやること（件数付きチップ。lib/home-todos.ts で算出）
 * 既定では上位3行だけを出し、残りは「他n件」で展開する。
 */
import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ChevronUp, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutoNotice, HomeTodo } from '@/lib/home-todos';
import type { HomeAnnouncement } from './home-data';

const COLLAPSED_ROWS = 3;

const chipBase = 'inline-flex shrink-0 items-center rounded-full px-[9px] py-0.5 text-[11.5px] font-bold whitespace-nowrap';

type Row =
  | { type: 'announcement'; key: string; item: HomeAnnouncement }
  | { type: 'auto'; key: string; item: AutoNotice };

export function HomeNotices({
  announcements,
  unreadCount,
  autoNotices,
  todos,
}: {
  announcements: HomeAnnouncement[];
  unreadCount: number;
  autoNotices: AutoNotice[];
  todos: HomeTodo[];
}) {
  const [expanded, setExpanded] = useState(false);

  // 並び: 未読のお知らせ → 自動検知 → 既読のお知らせ
  const rows: Row[] = [
    ...announcements.filter((a) => a.unread).map((a) => ({ type: 'announcement' as const, key: `a-${a.id}`, item: a })),
    ...autoNotices.map((n) => ({ type: 'auto' as const, key: `n-${n.id}`, item: n })),
    ...announcements.filter((a) => !a.unread).map((a) => ({ type: 'announcement' as const, key: `a-${a.id}`, item: a })),
  ];
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hidden = rows.length - COLLAPSED_ROWS;

  return (
    <section aria-label="お知らせ" className="flex flex-col gap-2 rounded-xl border border-line bg-white px-4 pt-[11px] pb-3">
      <header className="flex items-center gap-2.5">
        <Mail className="h-[18px] w-[18px] shrink-0 text-iris" aria-hidden="true" />
        <h2 className="text-sm font-bold text-ink">
          お知らせ<span className="en-inline">Notices</span>
        </h2>
        {unreadCount > 0 && (
          <span className="shrink-0 rounded-full bg-iris-soft px-2.5 py-0.5 text-xs font-bold text-royal tabular-nums">
            未読 {unreadCount}件
          </span>
        )}
        {autoNotices.length > 0 && (
          <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-bold text-danger tabular-nums">
            要確認 {autoNotices.length}件
          </span>
        )}
        <Link
          href="/app/notifications"
          className="ml-auto inline-flex shrink-0 items-center text-[13px] font-bold whitespace-nowrap text-iris hover:underline"
        >
          すべて見る
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </header>

      <ul className="flex flex-col gap-1.5">
        {rows.length === 0 && (
          <li className="flex min-w-0 items-center gap-2.5">
            <span className={cn(chipBase, 'bg-iris-soft text-royal')}>本部・オーナー</span>
            <p className="min-w-0 flex-1 text-[13.5px] text-ink-3">新しいお知らせはありません</p>
          </li>
        )}
        {visible.map((row) =>
          row.type === 'announcement' ? (
            <li key={row.key} className="flex min-w-0 items-center gap-2.5 max-sm:flex-wrap">
              <span className={cn(chipBase, 'bg-iris-soft text-royal')}>本部・オーナー</span>
              <p className={cn('min-w-0 flex-1 truncate text-[13.5px]', row.item.unread ? 'text-ink' : 'text-ink-3')}>
                {row.item.important && <span className="mr-1 font-bold text-danger">【重要】</span>}
                <Link href="/app/announcements" className="hover:underline">
                  {row.item.title}
                </Link>
              </p>
              <time className="shrink-0 text-xs text-ink-3 tabular-nums">{row.item.createdAt}</time>
            </li>
          ) : (
            <li key={row.key} className="flex min-w-0 items-center gap-2.5 max-sm:flex-wrap">
              <span className={cn(chipBase, 'bg-danger-soft text-danger')}>自動検知</span>
              <p className="min-w-0 flex-1 text-[13.5px] text-ink">
                {row.item.message}
                <Link href={row.item.href} className="ml-1 inline-flex items-center font-bold whitespace-nowrap text-iris hover:underline">
                  {row.item.linkLabel ?? '確認する'}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </p>
              <time className="shrink-0 text-xs text-ink-3 tabular-nums">{row.item.at ?? '自動'}</time>
            </li>
          )
        )}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-0.5 rounded-md py-0.5 text-xs font-bold text-ink-2 hover:text-royal"
            >
              {expanded ? 'たたむ' : `他 ${hidden}件を表示`}
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </li>
        )}

        <li className="flex min-w-0 items-center gap-2.5 max-sm:flex-wrap">
          <span className={cn(chipBase, 'self-start bg-success-soft text-success sm:self-center')}>今日のやること</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {todos.length === 0 ? (
              <span className="inline-flex items-center rounded-full border border-success-soft bg-success-soft px-[9px] py-0.5 text-xs font-bold text-success">
                対応が必要な項目はありません
              </span>
            ) : (
              todos.map((t) => (
                <Link
                  key={t.key}
                  href={t.href}
                  className="inline-flex items-center gap-[5px] rounded-full border border-line bg-white px-[9px] py-0.5 text-xs font-bold whitespace-nowrap text-ink-2 transition-colors hover:bg-lilac-soft"
                >
                  {t.label}
                  <b className="text-danger tabular-nums">{t.valueLabel ?? t.count}</b>
                </Link>
              ))
            )}
          </div>
          <time className="shrink-0 text-xs text-ink-3">自動</time>
        </li>
      </ul>
    </section>
  );
}
