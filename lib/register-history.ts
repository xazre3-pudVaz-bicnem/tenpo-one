/**
 * レジの履歴（レジごとのセッション：開局〜レジ精算）。入出金 › 締め履歴（Web）と、iPad ネイティブのレジクローズの画面の「履歴」で使う。
 *
 * 2026-10-26 Ronnie「Web ipad ko 履歴 ma gayera hijo ko レジ決算 garna milne ra 決算レポート nikalna milne banau ta same as native ma pani」
 *   「Shunka ko hijo native ma close garna namilera aa rezi khulena」
 * → 前の営業日に締められなかったレジ（開いたまま）を履歴から見つけて、そのままレジ精算に進む・精算レシート（途中集計）を出す。
 *   締めたレジも、日を選んで精算レシートを出し直せる。
 *
 * ここは純粋な関数だけ（テスト対象）。読み込みは lib/register-history-server.ts。
 */

export interface RegisterHistoryRow {
  id: string;
  storeId: string;
  storeName: string | null;
  registerName: string;
  businessDate: string;
  /** open＝開いたまま（未精算）・closed＝レジ精算ずみ・approved＝承認ずみ */
  status: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
}

/** 開いたまま（未精算）のレジ */
export function isOpenSession(row: Pick<RegisterHistoryRow, 'status'>): boolean {
  return row.status === 'open';
}

/**
 * 前の営業日から開いたまま（締め忘れ）のレジ。clock は時計の営業日（YYYY-MM-DD）。
 * このレジを締めるまで、同じレジは新しく開局できない（open_register_session の SESSION_ALREADY_OPEN）。
 */
export function unclosedPastSessions<T extends Pick<RegisterHistoryRow, 'status' | 'businessDate'>>(rows: readonly T[], clock: string): T[] {
  return rows.filter((r) => isOpenSession(r) && r.businessDate < clock);
}

/** 履歴の状態の言葉（日本語・英語） */
export function historyStatusLabel(row: Pick<RegisterHistoryRow, 'status' | 'businessDate'>, clock: string): { ja: string; en: string; tone: 'danger' | 'warn' | 'done' } {
  if (isOpenSession(row)) {
    return row.businessDate < clock
      ? { ja: '未精算（前の営業日）', en: 'Not closed (previous day)', tone: 'danger' }
      : { ja: '営業中', en: 'Open', tone: 'warn' };
  }
  if (row.status === 'approved') return { ja: '承認済み', en: 'Approved', tone: 'done' };
  return { ja: 'レジ精算済み', en: 'Closed', tone: 'done' };
}

/** 履歴を見る期間の始まり：clock の days 日前（YYYY-MM-DD・カレンダーの日付として） */
export function historySince(clock: string, days: number): string {
  const [y, m, d] = clock.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - Math.max(0, Math.floor(days)));
  return t.toISOString().slice(0, 10);
}

/** 並び：開いたまま（未精算）を先に、あとは営業日の新しい順・開局の新しい順 */
export function sortHistory<T extends Pick<RegisterHistoryRow, 'status' | 'businessDate' | 'openedAt'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ao = isOpenSession(a) ? 0 : 1;
    const bo = isOpenSession(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? 1 : -1;
    return a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0;
  });
}
