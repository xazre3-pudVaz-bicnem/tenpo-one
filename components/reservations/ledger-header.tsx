import Link from 'next/link';
import { ChevronLeft, ChevronRight, Mail, Plus, Printer } from 'lucide-react';
import { SegmentedTabs, type SegmentedTab } from '@/components/ui/segmented-tabs';
import { cn } from '@/lib/utils';
import { ManualReservationDialog } from './manual-reservation-dialog';
import { WalkInDialog } from './walk-in-dialog';
import { FindSeatsDialog } from './find-seats-dialog';
import { PrintButton } from './print-button';
import { LedgerMoreMenu } from './ledger-more-menu';
import type { LedgerChrome } from './ledger-data';

export type LedgerTabKey =
  | 'home'
  | 'gourmet'
  | 'tables'
  | 'list'
  | 'schedule'
  | 'week'
  | 'month'
  | 'waiting'
  | 'customers'
  | 'analytics'
  | 'settings';

const ACTION =
  'inline-flex h-10 items-center gap-1.5 rounded-[9px] px-3.5 text-[14px] font-bold whitespace-nowrap transition-colors';
const ACTION_GHOST = cn(ACTION, 'bg-iris-soft text-royal hover:bg-wisteria');
/** 「…」の中の1行 */
const MENU_ITEM =
  'flex h-11 w-full items-center justify-start gap-2 rounded-lg px-3 text-left text-[14px] font-semibold text-ink hover:bg-lilac-soft';

function En({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <span className={cn('ml-1 font-[family-name:var(--font-num)] text-[10.5px] font-semibold', light ? 'text-white/80' : 'text-ink-3')}>
      {children}
    </span>
  );
}

/**
 * 店舗台帳の上段（タブ＋日付ナビ）と操作ボタン行。
 * グルメサイト連携タブは外部契約が必要なため出さない。
 */
export function LedgerTop({
  active,
  date,
  chrome,
  nav,
}: {
  active: LedgerTabKey;
  /** タブのリンク先に引き継ぐ日付 */
  date: string;
  chrome: LedgerChrome;
  /** 右上（日付ナビ・月ナビなど） */
  nav?: React.ReactNode;
}) {
  const tabs: (SegmentedTab | false)[] = [
    { key: 'home', label: 'ホーム', en: 'Home', href: '/app' },
    { key: 'list', label: '予約リスト', en: 'List', href: `/app/reservations/list?from=${date}&to=${date}` },
    { key: 'schedule', label: 'スケジュール', en: 'Schedule', href: `/app/reservations?date=${date}` },
    { key: 'gourmet', label: 'グルメ別', en: 'Gourmet', href: `/app/reservations?view=gourmet&date=${date}` },
    chrome.links.customers && { key: 'customers', label: '顧客台帳', en: 'Customers', href: '/app/customers' },
  ];

  // 封筒＝未連絡（仮予約のまま返事をしていない予約）。押すと予約リストのその絞り込みへ
  const unconfirmed = chrome.summary.unconfirmed;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      <SegmentedTabs tabs={tabs.filter((t): t is SegmentedTab => !!t)} active={active} className="[&>a]:px-2" />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {nav}
        <Link
          href={`/app/reservations/list?from=${date}&to=${date}&status=pending`}
          aria-label={`未連絡の予約 ${unconfirmed}件`}
          title="未連絡（仮予約）/ Unconfirmed"
          className="relative flex h-10 w-10 items-center justify-center rounded-[9px] border border-line bg-white text-ink-2 transition-colors hover:border-iris hover:text-iris"
        >
          <Mail className="h-5 w-5" aria-hidden />
          {unconfirmed > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 font-[family-name:var(--font-num)] text-[10px] font-extrabold text-white tabular-nums">
              {unconfirmed > 99 ? '99+' : unconfirmed}
            </span>
          )}
        </Link>

        <FindSeatsDialog storeId={chrome.storeId} tables={chrome.seatTables} defaultDate={date} className={ACTION_GHOST}>
          空席検索<En>Find seats</En>
        </FindSeatsDialog>

        <ManualReservationDialog
          stores={chrome.stores}
          defaultStoreId={chrome.defaultStoreId}
          sources={chrome.sources}
          courses={chrome.courses}
          tables={chrome.manualTables}
          prefill={{ date }}
          triggerVariant="primary"
          triggerClassName={cn(ACTION, 'px-4 shadow-card')}
          triggerContent={
            <>
              <Plus className="h-4 w-4" strokeWidth={3} aria-hidden />
              予約登録<En light>Add</En>
            </>
          }
        />

        {/* 週間・月間・ウェイティング・印刷などは「…」の中へ（タブは5つに絞る） */}
        <LedgerMoreMenu>
          {chrome.links.tables && (
            <Link href="/app/floor" className={MENU_ITEM}>
              テーブル管理<En>Tables</En>
            </Link>
          )}
          <Link href={`/app/reservations?view=week&date=${date}`} className={MENU_ITEM}>
            週間<En>Week</En>
          </Link>
          <Link href={`/app/reservations/calendar?month=${date.slice(0, 7)}`} className={MENU_ITEM}>
            月間<En>Month</En>
          </Link>
          <Link href="/app/reservations?view=waitlist" className={MENU_ITEM}>
            ウェイティング<En>Waiting</En>
          </Link>
          <WalkInDialog
            stores={chrome.stores}
            defaultStoreId={chrome.defaultStoreId}
            storeTables={chrome.storeTables}
            triggerClassName={MENU_ITEM}
            triggerContent={
              <>
                直接来店<En>Walk-in</En>
              </>
            }
          />
          <PrintButton className={MENU_ITEM}>
            <Printer className="h-4 w-4" aria-hidden />
            印刷・PDF<En>Print / PDF</En>
          </PrintButton>
          {chrome.links.analytics && (
            <Link href={`/app/reports?from=${date.slice(0, 7)}-01&to=${date}`} className={MENU_ITEM}>
              集計分析<En>Analytics</En>
            </Link>
          )}
          {chrome.links.settings && (
            <Link href="/app/settings/booking" className={MENU_ITEM}>
              台帳設定<En>Settings</En>
            </Link>
          )}
        </LedgerMoreMenu>
      </div>
    </div>
  );
}

function SumTile({ label, en, children }: { label: string; en: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-white/75 px-3 py-2.5">
      <span className="truncate text-[12px] font-medium text-ink-2">
        {label}
        <span className="en-inline">{en}</span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-[family-name:var(--font-num)] text-[22px] leading-tight font-extrabold text-royal tabular-nums">
        {children}
      </span>
    </div>
  );
}

function Unit({ children }: { children: React.ReactNode }) {
  return <small className="ml-0.5 font-sans text-[12px] font-medium text-ink-3">{children}</small>;
}

function Note({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <span className={cn('font-sans text-[12.5px] font-bold', danger ? 'text-danger' : 'text-ink-3')}>{children}</span>
  );
}

/** 集計タイル4つ（本日のご予約／当日ご予約／来店済み・退店／来店待ち） */
export function LedgerSummaryTiles({ chrome, isToday }: { chrome: LedgerChrome; isToday: boolean }) {
  const s = chrome.summary;
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <SumTile label={isToday ? '本日のご予約' : `${Number(chrome.summaryDate.slice(5, 7))}/${Number(chrome.summaryDate.slice(8))}のご予約`} en={isToday ? 'Today' : 'Day'}>
        <span>
          {s.count}
          <Unit>組</Unit>
        </span>
        <span className="text-ink">
          {s.guests}
          <Unit>名</Unit>
        </span>
        {s.cancelled > 0 && <Note>キャンセル {s.cancelled}</Note>}
      </SumTile>
      <SumTile label="当日ご予約" en="Same-day">
        <span>
          {s.sameDayCount}
          <Unit>組</Unit>
        </span>
        <span className="text-ink">
          {s.sameDayGuests}
          <Unit>名</Unit>
        </span>
      </SumTile>
      <SumTile label="来店済み ／ 退店" en="In / Out">
        <span>
          {s.inCount}
          <Unit>組</Unit>
        </span>
        <span className="text-ink">
          {s.outCount}
          <Unit>組</Unit>
        </span>
      </SumTile>
      <SumTile label="来店待ち" en="Waiting">
        <span>
          {s.waitingCount}
          <Unit>組</Unit>
        </span>
        {s.unconfirmed > 0 && <Note danger>未連絡 {s.unconfirmed}</Note>}
        {s.unseated > 0 && <Note danger>席未定 {s.unseated}</Note>}
      </SumTile>
    </div>
  );
}

const navBtn =
  'flex h-10 w-10 items-center justify-center rounded-[9px] border border-line bg-white text-ink-2 transition-colors hover:border-iris hover:text-iris';

/** 月間表示用の月ナビ（‹ 2026年9月 ›） */
export function MonthNav({ month, current }: { month: string; current: string }) {
  const [y, m] = month.split('-').map(Number);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return (
    <div className="ml-auto flex items-center gap-1">
      <Link href={`/app/reservations/calendar?month=${shift(-1)}`} aria-label="前月" className={navBtn}>
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <span className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-line bg-white px-3.5 text-[17px] font-bold text-ink">
        {month === current && <span className="rounded-full bg-iris-soft px-2.5 py-0.5 text-xs font-bold text-royal">今月</span>}
        <span className="tabular-nums">
          {y}年{m}月
        </span>
      </span>
      <Link href={`/app/reservations/calendar?month=${shift(1)}`} aria-label="翌月" className={navBtn}>
        <ChevronRight className="h-4 w-4" />
      </Link>
      {month !== current && (
        <Link
          href={`/app/reservations/calendar?month=${current}`}
          className="ml-1 inline-flex h-10 items-center rounded-[9px] px-3 text-[13px] font-bold text-iris hover:bg-iris-soft"
        >
          今月へ
        </Link>
      )}
    </div>
  );
}
