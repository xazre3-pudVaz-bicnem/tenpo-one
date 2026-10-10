/**
 * 新しい管理画面のホーム（2026-10-10 Ronnie）の集計。純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */
import type { TableGroup } from '@/lib/table-group';

export interface HomeStoreRow {
  id: string;
  name: string;
  tablesUsed: number;
  tablesTotal: number;
  openCount: number;
  openTotal: number;
  /** 本日の売上（会計済みの純売上＋未会計） */
  sales: number;
  dailyBudget: number | null;
  budgetPct: number | null;
  resvGroups: number;
  resvGuests: number;
  /** まだ来ていない予約の数と、いちばん早い時刻 */
  resvUpcoming: number;
  nextTime: string | null;
}

const UPCOMING = new Set(['pending', 'confirmed', 'waiting']);

function jstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function homeStoreRow(input: {
  store: { id: string; name: string };
  tableIds: string[];
  openOrders: { tableId: string | null; total: number }[];
  settledTotal: number;
  refundTotal: number;
  reservations: { startAt: string; partySize: number; status: string }[];
  groups: TableGroup[];
  dailyBudget: number | null;
  now: number;
}): HomeStoreRow {
  const known = new Set(input.tableIds);
  const used = new Set<string>();
  for (const o of input.openOrders) if (o.tableId && known.has(o.tableId)) used.add(o.tableId);
  // テーブル連携：組のどれかに伝票があれば組の全部を使用中に
  for (const g of input.groups) {
    if (g.tableIds.some((id) => used.has(id))) for (const id of g.tableIds) if (known.has(id)) used.add(id);
  }
  const openTotal = input.openOrders.reduce((a, o) => a + o.total, 0);
  const sales = input.settledTotal - input.refundTotal + openTotal;
  const upcoming = input.reservations
    .filter((r) => UPCOMING.has(r.status) && new Date(r.startAt).getTime() >= input.now - 30 * 60_000)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return {
    id: input.store.id,
    name: input.store.name,
    tablesUsed: used.size,
    tablesTotal: input.tableIds.length,
    openCount: input.openOrders.length,
    openTotal,
    sales,
    dailyBudget: input.dailyBudget,
    budgetPct: input.dailyBudget && input.dailyBudget > 0 ? Math.round((sales / input.dailyBudget) * 100) : null,
    resvGroups: input.reservations.length,
    resvGuests: input.reservations.reduce((a, r) => a + r.partySize, 0),
    resvUpcoming: upcoming.length,
    nextTime: upcoming[0] ? jstTime(upcoming[0].startAt) : null,
  };
}

export interface HourlyCompare {
  /** 表示する時（例: 11〜23） */
  hours: number[];
  today: number[];
  lastWeek: number[];
}

/** 伝票を開いた時刻（日本時間）の「時」で、本日と前週の同じ曜日の売上を並べる。表示は売上のある時間の前後だけ */
export function hourlyFromOrders(
  todayOrders: { total: number; openedAt: string }[],
  lastWeekOrders: { total: number; openedAt: string }[]
): HourlyCompare {
  const hourOf = (iso: string) => Number(new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).slice(0, 2)) % 24;
  const t = Array<number>(24).fill(0);
  const w = Array<number>(24).fill(0);
  for (const o of todayOrders) t[hourOf(o.openedAt)] += o.total;
  for (const o of lastWeekOrders) w[hourOf(o.openedAt)] += o.total;
  const withData = [...Array(24).keys()].filter((h) => t[h] > 0 || w[h] > 0);
  // 朝5時を営業日の始まりとして、5時〜翌4時の順に見る。売上が無い日は 11〜23時
  const order = [...Array(24).keys()].map((i) => (i + 5) % 24);
  let hours: number[];
  if (withData.length === 0) {
    hours = Array.from({ length: 13 }, (_, i) => 11 + i);
  } else {
    const idx = withData.map((h) => order.indexOf(h));
    const from = Math.min(...idx);
    const to = Math.max(...idx);
    hours = order.slice(from, to + 1);
  }
  return { hours, today: hours.map((h) => t[h]), lastWeek: hours.map((h) => w[h]) };
}
