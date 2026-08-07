/**
 * CRM分析の純関数（テスト対象）。
 * 顧客の自動分類・RFM分析・LTV算出。
 * customers テーブルの集計列（visit_count / total_spent / last_visit_at 等）から導出する。
 */

export interface CustomerMetrics {
  visitCount: number;
  totalSpent: number;
  cancelCount: number;
  noShowCount: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
}

export type CustomerSegment =
  | 'new'
  | 'repeater'
  | 'regular'
  | 'vip'
  | 'dormant'
  | 'high_spender'
  | 'cancel_risk'
  | 'no_show_risk';

export const SEGMENT_LABELS: Record<CustomerSegment, { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'gray' | 'navy' }> = {
  new: { label: '新規', tone: 'primary' },
  repeater: { label: 'リピーター', tone: 'success' },
  regular: { label: '常連', tone: 'success' },
  vip: { label: 'VIP', tone: 'navy' },
  dormant: { label: '休眠', tone: 'gray' },
  high_spender: { label: '高単価', tone: 'warning' },
  cancel_risk: { label: 'キャンセル注意', tone: 'danger' },
  no_show_risk: { label: '無断キャンセル注意', tone: 'danger' },
};

export const SEGMENT_THRESHOLDS = {
  regularVisits: 10,       // 常連: 来店回数
  vipSpent: 300_000,       // VIP: 累計利用額（円）
  dormantDays: 90,         // 休眠: 最終来店からの日数
  highSpenderAvg: 8_000,   // 高単価: 平均客単価（円）
  cancelRisk: 3,           // キャンセル注意: キャンセル回数
  noShowRisk: 1,           // 無断キャンセル注意
} as const;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

// -------------------------------------------------------------
// 拡張セグメント（v0.3）: 来店時間帯・誕生月・記念日・休眠段階
// -------------------------------------------------------------

export type ExtendedSegment =
  | 'second_visit'
  | 'dormant_30'
  | 'dormant_60'
  | 'dormant_90'
  | 'high_frequency'
  | 'lunch'
  | 'dinner'
  | 'takeout'
  | 'birthday_month'
  | 'anniversary_month';

export const EXTENDED_SEGMENT_LABELS: Record<ExtendedSegment, { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'gray' | 'navy' }> = {
  second_visit: { label: '2回目', tone: 'primary' },
  dormant_30: { label: '休眠30日', tone: 'gray' },
  dormant_60: { label: '休眠60日', tone: 'gray' },
  dormant_90: { label: '休眠90日', tone: 'gray' },
  high_frequency: { label: '高頻度', tone: 'success' },
  lunch: { label: 'ランチ客', tone: 'primary' },
  dinner: { label: 'ディナー客', tone: 'navy' },
  takeout: { label: 'テイクアウト客', tone: 'warning' },
  birthday_month: { label: '誕生月', tone: 'success' },
  anniversary_month: { label: '記念日月', tone: 'success' },
};

export interface ExtendedMetrics {
  /** 注文履歴からの時間帯別来店数（11-15時=ランチ / 17時以降=ディナー） */
  lunchVisits?: number;
  dinnerVisits?: number;
  takeoutOrders?: number;
  birthday?: Date | null;
  /** 記念日テキストに月表記があるかの判定はUI側で月番号に解決して渡す */
  anniversaryMonth?: number | null;
  /** 月間来店頻度（calcLtvのvisitsPerMonth） */
  visitsPerMonth?: number | null;
}

/**
 * 拡張セグメント判定。classifyCustomer（基本8種）と併用する。
 * ランチ/ディナー/テイクアウトは過半数傾向で判定。
 */
export function classifyExtended(
  m: CustomerMetrics,
  ext: ExtendedMetrics,
  now: Date
): ExtendedSegment[] {
  const out: ExtendedSegment[] = [];
  if (m.visitCount === 2) out.push('second_visit');

  if (m.visitCount >= 1 && m.lastVisitAt) {
    const days = daysBetween(m.lastVisitAt, now);
    if (days > 90) out.push('dormant_90');
    else if (days > 60) out.push('dormant_60');
    else if (days > 30) out.push('dormant_30');
  }

  if ((ext.visitsPerMonth ?? 0) >= 2) out.push('high_frequency');

  const lunch = ext.lunchVisits ?? 0;
  const dinner = ext.dinnerVisits ?? 0;
  if (lunch + dinner >= 2) {
    if (lunch > dinner) out.push('lunch');
    else if (dinner > lunch) out.push('dinner');
  }
  if ((ext.takeoutOrders ?? 0) >= 2) out.push('takeout');

  const month = Number(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric' }));
  if (ext.birthday) {
    const bMonth = Number(
      ext.birthday.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric' })
    );
    if (bMonth === month) out.push('birthday_month');
  }
  if (ext.anniversaryMonth === month) out.push('anniversary_month');
  return out;
}

// -------------------------------------------------------------
// 条件ビルダー（campaignAudience）: 将来LINE/Email配信へ渡す抽出条件
// -------------------------------------------------------------

export type AudienceField =
  | 'total_spent'
  | 'visit_count'
  | 'days_since_last_visit'
  | 'avg_spend'
  | 'cancel_count'
  | 'no_show_count'
  | 'point_balance';

export type AudienceOp = 'gte' | 'lte' | 'eq';

export interface AudienceCondition {
  field: AudienceField;
  op: AudienceOp;
  value: number;
}

export const AUDIENCE_FIELD_LABELS: Record<AudienceField, string> = {
  total_spent: '累計利用額',
  visit_count: '来店回数',
  days_since_last_visit: '最終来店からの日数',
  avg_spend: '平均客単価',
  cancel_count: 'キャンセル回数',
  no_show_count: '無断キャンセル回数',
  point_balance: 'ポイント残高',
};

/** 顧客が条件（AND結合）に一致するか */
export function matchesAudience(
  m: CustomerMetrics & { pointBalance?: number },
  conditions: AudienceCondition[],
  now: Date
): boolean {
  return conditions.every((c) => {
    const actual = (() => {
      switch (c.field) {
        case 'total_spent': return m.totalSpent;
        case 'visit_count': return m.visitCount;
        case 'days_since_last_visit':
          return m.lastVisitAt ? daysBetween(m.lastVisitAt, now) : Number.MAX_SAFE_INTEGER;
        case 'avg_spend': return m.visitCount > 0 ? Math.floor(m.totalSpent / m.visitCount) : 0;
        case 'cancel_count': return m.cancelCount;
        case 'no_show_count': return m.noShowCount;
        case 'point_balance': return m.pointBalance ?? 0;
      }
    })();
    switch (c.op) {
      case 'gte': return actual >= c.value;
      case 'lte': return actual <= c.value;
      case 'eq': return actual === c.value;
    }
  });
}

/** 顧客の自動分類（複数該当あり）。表示は先頭ほど優先 */
export function classifyCustomer(m: CustomerMetrics, now: Date): CustomerSegment[] {
  const segments: CustomerSegment[] = [];
  const t = SEGMENT_THRESHOLDS;

  if (m.noShowCount >= t.noShowRisk) segments.push('no_show_risk');
  if (m.cancelCount >= t.cancelRisk) segments.push('cancel_risk');
  if (m.totalSpent >= t.vipSpent) segments.push('vip');
  if (m.visitCount >= 1 && m.lastVisitAt && daysBetween(m.lastVisitAt, now) > t.dormantDays) {
    segments.push('dormant');
  }
  if (m.visitCount > 0 && Math.floor(m.totalSpent / m.visitCount) >= t.highSpenderAvg) {
    segments.push('high_spender');
  }
  if (m.visitCount >= t.regularVisits) segments.push('regular');
  else if (m.visitCount >= 2) segments.push('repeater');
  else segments.push('new');

  return segments;
}

// -------------------------------------------------------------
// RFM分析（固定しきい値・1〜5スコア）
// -------------------------------------------------------------

export interface RfmScore {
  recency: number; // 5=直近
  frequency: number;
  monetary: number;
  /** RFM合計からの総合ランク */
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  rankLabel: string;
}

export function calcRfm(m: CustomerMetrics, now: Date): RfmScore {
  const days = m.lastVisitAt ? daysBetween(m.lastVisitAt, now) : Infinity;
  const recency = days <= 14 ? 5 : days <= 30 ? 4 : days <= 60 ? 3 : days <= 90 ? 2 : 1;
  const frequency =
    m.visitCount >= 20 ? 5 : m.visitCount >= 10 ? 4 : m.visitCount >= 5 ? 3 : m.visitCount >= 2 ? 2 : 1;
  const monetary =
    m.totalSpent >= 300_000 ? 5 : m.totalSpent >= 100_000 ? 4 : m.totalSpent >= 50_000 ? 3
    : m.totalSpent >= 10_000 ? 2 : 1;

  const total = recency + frequency + monetary;
  const rank = total >= 13 ? 'S' : total >= 10 ? 'A' : total >= 7 ? 'B' : total >= 5 ? 'C' : 'D';
  const rankLabel =
    rank === 'S' ? '最重要顧客' : rank === 'A' ? '優良顧客' : rank === 'B' ? '安定顧客'
    : rank === 'C' ? '育成対象' : '離反リスク';

  return { recency, frequency, monetary, rank, rankLabel };
}

// -------------------------------------------------------------
// LTV
// -------------------------------------------------------------

export interface LtvResult {
  /** 実績LTV = 累計利用額 */
  actual: number;
  /** 12ヶ月予測 = 平均客単価 × 月間来店頻度 × 12（来店実績が薄い場合はnull） */
  projected12m: number | null;
  avgSpend: number;
  visitsPerMonth: number | null;
}

export function calcLtv(m: CustomerMetrics, now: Date): LtvResult {
  const avgSpend = m.visitCount > 0 ? Math.floor(m.totalSpent / m.visitCount) : 0;
  if (!m.firstVisitAt || m.visitCount < 2) {
    return { actual: m.totalSpent, projected12m: null, avgSpend, visitsPerMonth: null };
  }
  const months = Math.max(1, daysBetween(m.firstVisitAt, now) / 30.44);
  const visitsPerMonth = m.visitCount / months;
  const projected12m = Math.floor(avgSpend * visitsPerMonth * 12);
  return {
    actual: m.totalSpent,
    projected12m,
    avgSpend,
    visitsPerMonth: Math.round(visitsPerMonth * 100) / 100,
  };
}
