import Link from 'next/link';
import { BarChart3, ChevronLeft, ChevronRight, DoorOpen, FileDown, FileSpreadsheet, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ManualReservationDialog } from './manual-reservation-dialog';
import { WalkInDialog } from './walk-in-dialog';
import { FindSeatsDialog } from './find-seats-dialog';
import { PrintButton } from './print-button';
import { LedgerMoreMenu } from './ledger-more-menu';
import type { LedgerChrome } from './ledger-data';

/**
 * 店舗台帳の上段（見本 2026-09-24）。
 *   1段目: 画面名（スケジュールなど）＋ 退店管理・CSV出力・集計・PDF作成・＋予約登録
 *   2段目: 左に日付ナビ（‹ 今日 9/24（木）▾ ›）、右にカレンダーのボタン
 * 色は TENPO ONE のまま（濃い紫）。
 * 予約リスト・グルメ別・週間・月間・ウェイティングなどはカレンダーのボタンの中に入れる。
 */

/** 上段のボタン（見本どおり全部同じ形・TENPO ONE の色） */
const ACTION =
  'inline-flex h-10 items-center gap-1.5 rounded-[9px] bg-royal px-3.5 text-[14px] font-bold whitespace-nowrap text-white transition-colors hover:bg-plum';
/** カレンダーのボタンの中の1行 */
const MENU_ITEM =
  'flex h-11 w-full items-center justify-start gap-2 rounded-lg px-3 text-left text-[14px] font-semibold text-ink hover:bg-lilac-soft';

export function LedgerTop({
  title,
  date,
  chrome,
  nav,
}: {
  /** 画面名（スケジュール／予約リスト／グルメ別 …） */
  title: string;
  /** リンク先に引き継ぐ日付 */
  date: string;
  chrome: LedgerChrome;
  /** 2段目の左（日付ナビ・月ナビ） */
  nav?: React.ReactNode;
}) {
  const unconfirmed = chrome.summary.unconfirmed;

  return (
    <div className="mb-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <h2 className="text-[22px] leading-none font-extrabold text-navy">{title}</h2>

        <div className="flex flex-wrap items-center gap-2">
          {chrome.links.tables && (
            <Link href="/app/floor" className={ACTION}>
              <DoorOpen className="h-4 w-4" aria-hidden />
              退店管理
            </Link>
          )}
          <a href={`/app/reservations/list/export?from=${date}&to=${date}`} className={ACTION}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            CSV出力
          </a>
          {chrome.links.analytics && (
            <Link href={`/app/reports?from=${date.slice(0, 7)}-01&to=${date}`} className={ACTION}>
              <BarChart3 className="h-4 w-4" aria-hidden />
              集計
            </Link>
          )}
          <PrintButton className={ACTION}>
            <FileDown className="h-4 w-4" aria-hidden />
            PDF作成
          </PrintButton>
          <ManualReservationDialog
            stores={chrome.stores}
            defaultStoreId={chrome.defaultStoreId}
            sources={chrome.sources}
            courses={chrome.courses}
            tables={chrome.manualTables}
            prefill={{ date }}
            triggerVariant="primary"
            triggerClassName={ACTION}
            triggerContent={
              <>
                <Plus className="h-4 w-4" strokeWidth={3} aria-hidden />
                予約登録
              </>
            }
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center [&>*]:ml-0">{nav}</div>

        <LedgerMoreMenu icon="calendar" label="ほかの台帳・設定">
          <Link href={`/app/reservations?date=${date}`} className={MENU_ITEM}>
            スケジュール
          </Link>
          <Link href={`/app/reservations/list?from=${date}&to=${date}`} className={MENU_ITEM}>
            予約リスト
          </Link>
          <Link href={`/app/reservations?view=gourmet&date=${date}`} className={MENU_ITEM}>
            グルメ別
          </Link>
          <Link href={`/app/reservations?view=week&date=${date}`} className={MENU_ITEM}>
            週間
          </Link>
          <Link href={`/app/reservations/calendar?month=${date.slice(0, 7)}`} className={MENU_ITEM}>
            月間カレンダー
          </Link>
          <Link href="/app/reservations?view=waitlist" className={MENU_ITEM}>
            ウェイティング
          </Link>
          <Link href={`/app/reservations/list?from=${date}&to=${date}&status=pending`} className={MENU_ITEM}>
            未連絡の予約{unconfirmed > 0 ? `（${unconfirmed}）` : ''}
          </Link>
          <FindSeatsDialog storeId={chrome.storeId} tables={chrome.seatTables} defaultDate={date} className={MENU_ITEM}>
            空席検索
          </FindSeatsDialog>
          <WalkInDialog
            stores={chrome.stores}
            defaultStoreId={chrome.defaultStoreId}
            storeTables={chrome.storeTables}
            triggerClassName={MENU_ITEM}
            triggerContent={<>直接来店</>}
          />
          {chrome.links.customers && (
            <Link href="/app/customers" className={MENU_ITEM}>
              顧客台帳
            </Link>
          )}
          {chrome.links.settings && (
            <Link href="/app/settings/booking" className={MENU_ITEM}>
              台帳設定
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
