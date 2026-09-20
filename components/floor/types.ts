/** フロア（テーブル一覧）画面の表示用データ型と状態判定。サーバーで整形してクライアントへ渡す。 */

export interface ReservationChip {
  time: string;
  guestName: string;
  partySize: number;
}

export interface FloorRow {
  id: string;
  name: string;
  sort_order: number;
}

export interface FloorTable {
  id: string;
  floor_id: string | null;
  name: string;
  capacity_min: number;
  capacity_max: number;
  is_private_room: boolean;
  is_counter: boolean;
  current_status: string;
  pos_x: number | null;
  pos_y: number | null;
  shape: string;
}

/** テーブルに紐づく未会計注文（表示用） */
export interface TableOrderInfo {
  id: string;
  openedAtMs: number;
  guestCount: number;
  total: number;
  /** 顧客台帳の名前（紐付けがあれば） */
  customerName: string | null;
  /** 顧客台帳の来店回数（紐付けがあれば） */
  visitCount: number | null;
  /** 予約の代表者名（ウォークインは null） */
  guestName: string | null;
  /** 来店経路（直接来店・LINE・Web予約 など） */
  sourceLabel: string;
  clerkName: string | null;
  /** 時間制コース（飲み放題など） */
  course: { label: string; minutes: number } | null;
  /** 滞在終了予定（コース時間 → 予約の終了時刻 → 店舗の既定滞在時間 の順で決定） */
  endAtMs: number;
}

/** このテーブルに入る予約（未来店） */
export interface UpcomingReservation {
  id: string;
  startMs: number;
  time: string;
  name: string;
  partySize: number;
  sourceLabel: string;
}

export interface TableView extends FloorTable {
  order: TableOrderInfo | null;
  upcoming: UpcomingReservation[];
}

/** 右パネル「本日のご予約」の1行 */
export interface PanelReservation {
  id: string;
  startMs: number;
  time: string;
  name: string;
  partySize: number;
  tableLabel: string;
  status: string;
  createdToday: boolean;
}

export type TileState =
  | 'free'
  | 'reserved'
  | 'waiting'
  | 'seated'
  | 'ordered'
  | 'lo'
  | 'over'
  | 'pay'
  | 'cleaning'
  | 'unavailable';

/** L.O.（ラストオーダー）とみなす残り時間（分） */
export const LAST_ORDER_WARN_MINUTES = 30;

/** 予約の「次」表示の対象: 開始から30分以内の遅れまでは「次」として出す */
export const UPCOMING_GRACE_MS = 30 * 60_000;

export function nextReservation(t: TableView, now: number): UpcomingReservation | null {
  return t.upcoming.find((r) => r.startMs >= now - UPCOMING_GRACE_MS) ?? null;
}

export interface TileTime {
  elapsed: number;
  limit: number;
  left: number;
  /** 残り時間の割合（0〜1） */
  frac: number;
}

export function tileTime(order: TableOrderInfo, now: number): TileTime {
  const elapsed = Math.max(0, Math.floor((now - order.openedAtMs) / 60_000));
  const limit = Math.max(1, Math.round((order.endAtMs - order.openedAtMs) / 60_000));
  const left = Math.ceil((order.endAtMs - now) / 60_000);
  return { elapsed, limit, left, frac: Math.max(0, Math.min(1, left / limit)) };
}

export function tileState(t: TableView, now: number): TileState {
  const s = t.current_status;
  if (s === 'unavailable') return 'unavailable';
  if (s === 'cleaning') return 'cleaning';
  if (s === 'billing') return 'pay';
  if (!t.order) {
    if (s === 'seated' || s === 'ordering') return 'seated';
    if (s === 'waiting') return 'waiting';
    if (s === 'reserved') return 'reserved';
    return 'free';
  }
  const tt = tileTime(t.order, now);
  if (tt.left <= 0) return 'over';
  if (tt.left <= LAST_ORDER_WARN_MINUTES) return 'lo';
  return t.order.total > 0 ? 'ordered' : 'seated';
}

/** 卓の状態ラベル。日本語を読まないスタッフ向けに「日本語 / English」で併記する。 */
export const TILE_LABEL: Record<TileState, string> = {
  free: '空席 / Free',
  reserved: '予約あり / Reserved',
  waiting: 'キャンセル待ち / Waitlist',
  seated: '着席中 / Seated',
  ordered: '注文済 / Ordered',
  lo: 'L.O.済 / Last order',
  over: '時間超過 / Over time',
  pay: '会計待ち / To pay',
  cleaning: '清掃中 / Cleaning',
  unavailable: '利用停止 / Closed',
};
