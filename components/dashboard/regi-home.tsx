/**
 * レジ（iPad）のホーム（2026-10-19 Ronnie の新しいレイアウト。パソコン・ハンディのホームは今まで通り）。
 *
 *  ┌ オーダー・会計（濃い青） ┐┌ 店舗台帳（テラコッタ） ┐   ← 大きいボタン2つだけ
 *  │ 即会計     │ 達成率の丸 │ 実績売上高・客単価      [店舗分析] │
 *  │ 伝票明細   │            │ ‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐‐ │
 *  │ 入出金     │            │ 予算売上高（Target）    [予算登録] │
 *  │ 仕入・経費 │    日付 23:12 秒 ｜ 20° ☾ 新宿区歌舞伎町        │
 *  │ …          │ 来店組数 │ 客数 │ リピーター │ 当日ウォークイン │
 *
 * - 見出し・箱の背景は使わない（地は白）。英語は日本語の下に小さく
 * - お知らせ&アラートは 仕入・経費 の中（ここは赤い件数だけ）。在庫アラートは 在庫設定 の上
 * - 本日の予約は オーダー・会計 の画面の右にあるので出さない。ハンディ・テイクアウトのボタンも出さない
 */
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatDayDelta } from '@/lib/home-todos';
import { LedgerIcon, OrderIcon, GroupsIcon, GuestIcon, RepeatIcon, WalkInIcon } from './regi-icons';
import { RegiTools, type RegiTool } from './regi-tools';

export interface RegiBigTile {
  href: string;
  label: string;
  en: string;
}

const BIG_STYLE: Record<string, { bg: string; Icon: typeof OrderIcon }> = {
  '/app/floor': { bg: 'linear-gradient(180deg,#2a6fe6,#0a3fa8)', Icon: OrderIcon },
  '/app/reservations': { bg: 'linear-gradient(180deg,#d0694f,#a94e37)', Icon: LedgerIcon },
};

const num = { fontFamily: 'var(--font-manrope)' } as const;

function BigTile({ tile }: { tile: RegiBigTile }) {
  const st = BIG_STYLE[tile.href];
  const Icon = st?.Icon ?? OrderIcon;
  return (
    <Link
      href={tile.href}
      className="flex h-[132px] items-center justify-center gap-[22px] rounded-[18px] bg-[#f2f2f7] px-6 transition-colors active:bg-[#e8e8ed]"
    >
      <span
        className="relative grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[18px] shadow-[0_1px_1px_rgba(0,0,0,0.06),0_3px_8px_rgba(0,0,0,0.14)]"
        style={{ backgroundImage: st?.bg ?? BIG_STYLE['/app/floor'].bg }}
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0)_55%)]" />
        <Icon className="relative h-[42px] w-[42px]" />
      </span>
      <span className="min-w-0 leading-tight">
        <b className="block text-[26px] font-extrabold tracking-[0.02em] whitespace-nowrap text-[#1c1c1e]">{tile.label}</b>
        <span className="block text-[13.5px] text-[#8e8e93]" style={num}>
          {tile.en}
        </span>
      </span>
    </Link>
  );
}

function Kpi({
  icon,
  bg,
  ja,
  en,
  value,
  unit,
  delta,
  href,
}: {
  icon: React.ReactNode;
  bg: string;
  ja: string;
  en: string;
  value: string;
  unit: string;
  delta?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-white" style={{ backgroundImage: bg }}>
          {icon}
        </span>
        <span className="leading-tight">
          <span className="block text-[12.5px] font-bold text-[#3a3a3c]">{ja}</span>
          <span className="block text-[10px] text-[#8e8e93]" style={num}>
            {en}
          </span>
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[30px] leading-[1.1] font-extrabold text-[#1c1c1e] tabular-nums" style={num}>
          {value}
          <small className="ml-px text-[13px] font-semibold text-[#8e8e93]">{unit}</small>
        </span>
        {delta && <span className="text-[11.5px] whitespace-nowrap text-[#8e8e93]">{delta}</span>}
      </span>
    </>
  );
  const cls = 'flex min-w-0 flex-col justify-between gap-1.5 px-[18px] pt-[18px] pb-1.5';
  return href ? (
    <Link href={href} className={cn(cls, 'active:bg-[#f2f2f7]')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function deltaText(today: number, yesterday: number, unit: string): string {
  return `前日比 ${formatDayDelta(today, yesterday, unit)}`;
}

export function RegiHome({
  bigTiles,
  tools,
  storeId,
  sales,
  clock,
  weather,
  kpis,
  ordersHref,
}: {
  bigTiles: RegiBigTile[];
  tools: RegiTool[];
  storeId: string | null;
  /** 売上（RegiSales） */
  sales: React.ReactNode;
  /** 時刻（RegiClock） */
  clock: React.ReactNode;
  /** 天気（RegiWeather。Suspense で包んで渡す） */
  weather: React.ReactNode;
  kpis: {
    groups: number;
    groupsYesterday: number;
    guests: number;
    guestsYesterday: number;
    /** リピーター（組）。顧客の紐付けが無ければ null */
    repeaters: number | null;
    walkIns: number;
  };
  ordersHref: string;
}) {
  return (
    <div className="regi-home flex flex-col gap-[18px] lg:min-h-[calc(100svh-58px-18px-32px)]">
      {bigTiles.length > 0 && (
        <div className={cn('grid gap-[18px]', bigTiles.length > 1 && 'md:grid-cols-2')}>
          {bigTiles.map((t) => (
            <BigTile key={t.href} tile={t} />
          ))}
        </div>
      )}

      <div className="grid flex-1 gap-[22px] md:grid-cols-[236px_minmax(0,1fr)]">
        <RegiTools tools={tools} storeId={storeId} />

        <div className="flex min-w-0 flex-col">
          {sales}
          {/* 日付・時刻 ｜ 気温・天気・地名（下の線のすぐ上・真ん中。全部 下にそろえて1行） */}
          <div className="flex flex-wrap items-end justify-center gap-y-2 pt-4 pb-4">
            <div className="pr-6 lg:pr-8">{clock}</div>
            <div className="border-l border-[#e5e5ea] pl-6 lg:pl-8">{weather}</div>
          </div>
          <div className="grid grid-cols-2 border-t border-[#e5e5ea] lg:grid-cols-4 [&>*]:border-[#e5e5ea] [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*+*]:border-l lg:[&>*:nth-child(n+3)]:border-t-0">
            <Kpi
              icon={<GroupsIcon className="h-5 w-5" />}
              bg="linear-gradient(180deg,#4a9bff,#1f6fe0)"
              ja="来店組数"
              en="Groups"
              value={String(kpis.groups)}
              unit="組"
              delta={deltaText(kpis.groups, kpis.groupsYesterday, '組')}
              href={ordersHref}
            />
            <Kpi
              icon={<GuestIcon className="h-5 w-5" />}
              bg="linear-gradient(180deg,#7b74f0,#5147d6)"
              ja="客数"
              en="Guests"
              value={String(kpis.guests)}
              unit="名"
              delta={deltaText(kpis.guests, kpis.guestsYesterday, '名')}
              href={ordersHref}
            />
            <Kpi
              icon={<RepeatIcon className="h-5 w-5" />}
              bg="linear-gradient(180deg,#ff8a7a,#e5584a)"
              ja="リピーター"
              en="Repeat"
              value={kpis.repeaters != null ? String(kpis.repeaters) : '—'}
              unit="組"
            />
            <Kpi
              icon={<WalkInIcon className="h-5 w-5" />}
              bg="linear-gradient(180deg,#ffa53a,#f08a10)"
              ja="当日ウォークイン"
              en="Walk-in"
              value={String(kpis.walkIns)}
              unit="組"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
