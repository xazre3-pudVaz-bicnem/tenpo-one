/**
 * 予約ドメインの純関数（テスト対象）。
 * テーブル自動候補・結合候補の算出。
 */

export interface TableLike {
  id: string;
  name: string;
  capacityMin: number;
  capacityMax: number;
  isActive: boolean;
  /** 対象時間帯に既に割当済みか */
  isOccupied: boolean;
}

export interface TableSuggestion {
  tableIds: string[];
  label: string;
  totalCapacity: number;
  /** 単卓か結合か */
  combined: boolean;
}

/**
 * 人数に対するテーブル候補を返す。
 * 優先順:
 *  1) 収容範囲（min<=人数<=max）に合う空き単卓を、無駄席が少ない順
 *  2) 空き2卓の結合で人数を満たす組み合わせを、合計無駄席が少ない順（上位3件）
 */
export function suggestTables(tables: TableLike[], partySize: number): TableSuggestion[] {
  const free = tables.filter((t) => t.isActive && !t.isOccupied);
  const suggestions: TableSuggestion[] = [];

  // 単卓候補
  const singles = free
    .filter((t) => partySize >= t.capacityMin && partySize <= t.capacityMax)
    .sort((a, b) => a.capacityMax - partySize - (b.capacityMax - partySize) || a.capacityMax - b.capacityMax);
  for (const t of singles.slice(0, 3)) {
    suggestions.push({
      tableIds: [t.id],
      label: t.name,
      totalCapacity: t.capacityMax,
      combined: false,
    });
  }

  // 結合候補（2卓）: 単卓で収まらない、または候補が少ない場合
  if (suggestions.length < 3) {
    const pairs: TableSuggestion[] = [];
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const cap = free[i].capacityMax + free[j].capacityMax;
        if (cap >= partySize && free[i].capacityMin + free[j].capacityMin <= partySize) {
          pairs.push({
            tableIds: [free[i].id, free[j].id],
            label: `${free[i].name} + ${free[j].name}`,
            totalCapacity: cap,
            combined: true,
          });
        }
      }
    }
    pairs.sort((a, b) => a.totalCapacity - b.totalCapacity);
    suggestions.push(...pairs.slice(0, 3 - suggestions.length));
  }

  return suggestions;
}

/** 予約ステータスの表示定義（UI共通） */
export const RESERVATION_STATUS = {
  pending: { label: '仮予約', tone: 'gray' },
  confirmed: { label: '予約確定', tone: 'primary' },
  waiting: { label: '来店待ち', tone: 'primary' },
  arrived: { label: '来店', tone: 'warning' },
  seated: { label: '着席', tone: 'success' },
  billing: { label: '会計待ち', tone: 'warning' },
  completed: { label: '会計済み', tone: 'gray' },
  cancelled: { label: 'キャンセル', tone: 'danger' },
  no_show: { label: '無断キャンセル', tone: 'danger' },
  waitlisted: { label: 'キャンセル待ち', tone: 'gray' },
} as const;

export type ReservationStatus = keyof typeof RESERVATION_STATUS;

/** 許可されるステータス遷移（不正遷移防止・UI/Server Action共通） */
export const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['waiting', 'arrived', 'seated', 'cancelled', 'no_show'],
  waiting: ['arrived', 'seated', 'cancelled', 'no_show'],
  arrived: ['seated', 'cancelled'],
  seated: ['billing', 'completed'],
  billing: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
  waitlisted: ['pending', 'confirmed', 'cancelled'],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_TRANSITIONS[from]?.includes(to) ?? false;
}
