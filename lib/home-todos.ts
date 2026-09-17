/**
 * ホーム画面（/app/dashboard）の「今日のやること」「自動検知」「リピーター率」「予算達成率」の純ロジック。
 * データ取得はページ側で行い、ここでは件数の算出と表示用の整形だけを担う（テスト: tests/home-todos.test.ts）。
 */

// ---------------------------------------------------------------------------
// 今日のやること
// ---------------------------------------------------------------------------

export interface HomeTodoInput {
  /** 直近数日の出金（出金・小口出金）のうち、レシート画像が紐付いていない件数 */
  unscannedWithdrawals?: number;
  /** 立替（仮払い）の未精算残高（円）。承認済みの立替合計 − 精算合計 */
  pettyAdvanceBalance?: number;
  /** 保存ボックスに残っている要確認の書類（documents.status='inbox'） */
  inboxDocuments?: number;
  /** 支払期日を過ぎた未払いの請求書 */
  overdueInvoices?: number;
  /** 本日の予約のうち、テーブル未割当のもの */
  unassignedReservations?: number;
  /** 本日の予約のうち、未確定（pending）のもの */
  pendingReservations?: number;
  /** 在庫が下限（発注点・最低在庫）以下の品目 */
  lowStockItems?: number;
  /** 前月の月次締めが未了なら対象月（'YYYY-MM'）。締め済み・対象外なら null */
  unclosedMonth?: string | null;
  /** 本日（'YYYY-MM-DD'）。予約台帳へのリンクに日付を付ける */
  today?: string;
}

export interface HomeTodo {
  key: string;
  label: string;
  /** チップに出す件数（金額表示のときは valueLabel を優先） */
  count: number;
  /** 件数の代わりに表示する値（例: 金額） */
  valueLabel?: string;
  href: string;
}

const yenLabel = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/**
 * 「今日のやること」チップの一覧を返す。0件のもの・算出できないもの（undefined）は含めない。
 * 並び順はプロトタイプに合わせる（お金 → 書類 → 予約 → 在庫 → 月次）。
 */
export function buildHomeTodos(input: HomeTodoInput): HomeTodo[] {
  const today = input.today;
  const todos: HomeTodo[] = [];
  const push = (t: HomeTodo) => {
    if (t.count > 0) todos.push(t);
  };

  push({ key: 'unscanned', label: '未スキャンの出金', count: input.unscannedWithdrawals ?? 0, href: '/app/cash' });
  const advance = input.pettyAdvanceBalance ?? 0;
  if (advance > 0) {
    todos.push({ key: 'advance', label: '仮払い 未精算', count: 1, valueLabel: yenLabel(advance), href: '/app/cash?tab=petty' });
  }
  push({ key: 'inbox', label: '要確認レシート', count: input.inboxDocuments ?? 0, href: '/app/invoices?tab=inbox' });
  push({ key: 'overdue', label: '支払期日超過', count: input.overdueInvoices ?? 0, href: '/app/invoices?tab=invoices&overdue=1' });
  const resvHref = today ? `/app/reservations?date=${today}` : '/app/reservations';
  push({ key: 'pending-resv', label: '未確定の予約', count: input.pendingReservations ?? 0, href: resvHref });
  push({ key: 'unassigned-resv', label: '席未定の予約', count: input.unassignedReservations ?? 0, href: resvHref });
  push({ key: 'low-stock', label: '在庫アラート', count: input.lowStockItems ?? 0, href: '/app/inventory?sort=warning' });
  if (input.unclosedMonth && /^\d{4}-\d{2}$/.test(input.unclosedMonth)) {
    const [y, m] = input.unclosedMonth.split('-');
    todos.push({
      key: 'month-close',
      label: `${y}年${Number(m)}月 月次締め`,
      count: 1,
      href: '/app/accounting/auto',
    });
  }
  return todos;
}

/** 前月（'YYYY-MM'）を返す。today は 'YYYY-MM-DD' */
export function previousMonthOf(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

/**
 * 前月の月次締めが未了かを判定する。
 * 月次締めを一度も使っていない企業（締め済みの月が1つも無い）には出さない。
 * @param periods accounting_periods の行（month は 'YYYY-MM-01'）
 */
export function findUnclosedPreviousMonth(
  periods: { month: string; status: string }[],
  today: string
): string | null {
  const usesClosing = periods.some((p) => p.status === 'closed');
  if (!usesClosing) return null;
  const prev = previousMonthOf(today);
  const row = periods.find((p) => p.month.slice(0, 7) === prev);
  return row?.status === 'closed' ? null : prev;
}

/** 立替（仮払い）の未精算残高。承認済みの petty_advance 合計 − petty_settlement 合計（負にはしない） */
export function pettyAdvanceBalance(rows: { kind: string; amount: number }[]): number {
  let advance = 0;
  let settlement = 0;
  for (const r of rows) {
    if (r.kind === 'petty_advance') advance += r.amount;
    else if (r.kind === 'petty_settlement') settlement += r.amount;
  }
  return Math.max(0, advance - settlement);
}

/** 立替（仮払い）残高の計算に使う kind */
export const PETTY_ADVANCE_KINDS = ['petty_advance', 'petty_settlement'] as const;

/** 出金系（レシートが必要な現金支出）の kind */
export const RECEIPT_REQUIRED_KINDS = ['withdrawal', 'petty_out'] as const;

/** レシート未紐付けの出金件数（取消済み=status≠active・差戻しは除く） */
export function countUnscannedWithdrawals(
  rows: { kind: string; receipt_document_id: string | null; status?: string | null; approval_status?: string | null }[]
): number {
  return rows.filter(
    (r) =>
      (RECEIPT_REQUIRED_KINDS as readonly string[]).includes(r.kind) &&
      !r.receipt_document_id &&
      (r.status == null || r.status === 'active') &&
      r.approval_status !== 'rejected'
  ).length;
}

/** 本日の予約から「未確定」「席未定」の件数を数える（キャンセル等はクエリ側で除外済みの前提） */
export function countReservationTodos(
  rows: { status: string; table_count: number }[]
): { pending: number; unassigned: number } {
  let pending = 0;
  let unassigned = 0;
  for (const r of rows) {
    if (r.status === 'pending') pending += 1;
    if ((r.status === 'pending' || r.status === 'confirmed') && r.table_count === 0) unassigned += 1;
  }
  return { pending, unassigned };
}

// ---------------------------------------------------------------------------
// 自動検知（ルール判定の注意事項）
// ---------------------------------------------------------------------------

export interface RegisterDiffRow {
  store_name?: string | null;
  register_name?: string | null;
  business_date: string;
  closed_at: string | null;
  difference: number | null;
  /** 表示用の時刻（呼び出し側で整形して渡す） */
  at?: string;
}

export interface AutoNotice {
  id: string;
  message: string;
  linkLabel?: string;
  href: string;
  /** 表示用の時刻（'今日 06:00' など）。任意 */
  at?: string;
}

/**
 * レジ締めの現金差額（過不足）を注意事項にする。差額0・未締めは除外。
 * @param minAbs この金額（円）以上の差額だけを出す（既定1円）
 */
export function buildRegisterDiffNotices(rows: RegisterDiffRow[], minAbs = 1): AutoNotice[] {
  return rows
    .filter((r) => r.closed_at && r.difference != null && Math.abs(r.difference) >= minAbs)
    .sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''))
    .map((r, i) => {
      const diff = r.difference ?? 0;
      const sign = diff > 0 ? '過剰' : '不足';
      const where = [r.store_name, r.register_name].filter(Boolean).join(' ');
      const date = `${Number(r.business_date.slice(5, 7))}/${Number(r.business_date.slice(8, 10))}`;
      return {
        id: `register-diff-${i}-${r.business_date}`,
        message: `${date} のレジ締め${where ? `（${where}）` : ''}で現金${sign} ${yenLabel(Math.abs(diff))} を検出。`,
        linkLabel: '締め履歴を確認',
        href: '/app/cash?tab=closings',
        at: r.at,
      };
    });
}

// ---------------------------------------------------------------------------
// リピーター率（本日）
// ---------------------------------------------------------------------------

export interface RepeatSummary {
  repeaters: number;
  newcomers: number;
  /** 顧客紐付きの来店者に占めるリピーターの割合（%・整数）。対象0名なら null */
  ratePct: number | null;
}

/**
 * 本日の顧客紐付き注文から、リピーター（来店2回目以上）と新規の人数を数える。
 * 判定: 初回来店日が本日より前ならリピーター。初回来店日が無ければ累計来店回数（2回以上）で判定。
 * 同じ顧客の複数注文は1名として数える。
 */
export function summarizeRepeatRate(
  customerIds: (string | null | undefined)[],
  customers: { id: string; first_visit_date: string | null; visit_count: number }[],
  today: string
): RepeatSummary {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const unique = [...new Set(customerIds.filter((v): v is string => !!v))];
  let repeaters = 0;
  let newcomers = 0;
  for (const id of unique) {
    const c = byId.get(id);
    if (!c) continue;
    const isRepeat = c.first_visit_date ? c.first_visit_date < today : c.visit_count >= 2;
    if (isRepeat) repeaters += 1;
    else newcomers += 1;
  }
  const total = repeaters + newcomers;
  return { repeaters, newcomers, ratePct: total > 0 ? Math.round((repeaters / total) * 100) : null };
}

// ---------------------------------------------------------------------------
// 予算達成率（本日）
// ---------------------------------------------------------------------------

/** 月予算を日割りにする（端数切り捨て）。月予算が無い・0以下なら null */
export function dailyBudgetFromMonthly(monthlyBudget: number | null | undefined, today: string): number | null {
  if (!monthlyBudget || monthlyBudget <= 0) return null;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.floor(monthlyBudget / days);
}

/** 達成率（%・整数）。予算が無ければ null。リング描画用に 0〜100 へ丸めた値も返す */
export function budgetAchievement(actual: number, budget: number | null): { pct: number | null; ringPct: number } {
  if (!budget || budget <= 0) return { pct: null, ringPct: 0 };
  const pct = Math.max(0, Math.round((actual / budget) * 100));
  return { pct, ringPct: Math.max(0, Math.min(100, pct)) };
}

/** 前日比の表示（'+5組' / '−3名' / '±0組'） */
export function formatDayDelta(today: number, yesterday: number, unit: string): string {
  const d = today - yesterday;
  if (d === 0) return `±0${unit}`;
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('ja-JP')}${unit}`;
}
