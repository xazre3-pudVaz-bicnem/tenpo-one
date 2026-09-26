/**
 * 領収書の「一度きり」ルール（2026-09-26 Ronnie）。
 *
 * 「合計金額の領収書は1枚しか出せない。1回出したら二度と出せない。
 *   じゃないと同じ金額でいろんなところ（経費精算）に使われたらやばい」
 *
 * 決めごと:
 *   - 1つの伝票（orders.id）につき、領収書の発行は1回だけ。全額1枚でも、分割（合計＝領収額）でも「1回」
 *   - 発行した記録は print_jobs（job_type = 'ryoshusho'）。プリンタ印字（cloudprnt）もブラウザ印刷・PDF（browser）も同じ
 *   - 失敗したジョブ（status = 'failed'：プリンタ未接続で期限切れ等）は「紙が出ていない」ので数えない。
 *     queued / claimed（プリンタが取りに来る途中）は紙が出る前提なので、発行済みとして扱う
 *   - 再発行（?reissue=1）も領収書には無い。直したいときは伝票を取消して会計し直す（監査ログに残る）
 * ここは純粋な関数だけ（DB・React 非依存・テスト対象）。判定はサーバー側（print-actions / actions）でも必ず通す。
 */

/** 領収書の但し書きの既定（2026-09-26 Ronnie「飲食代として」。以前は「お品代として」） */
export const RYOSHUSHO_DEFAULT_PURPOSE = '飲食代として';

export interface RyoshushoJobRow {
  job_type: string;
  status: string;
  printed_at?: string | null;
  created_at?: string | null;
}

export interface RyoshushoIssueState {
  /** 発行済み（もう出せない） */
  issued: boolean;
  /** 最初に発行した日時（ISO）。printed_at が無ければ created_at */
  at: string | null;
  /** 出した枚数（分割発行なら枚数ぶん） */
  count: number;
}

/** print_jobs の行（この伝票ぶん）から、領収書を発行済みかどうかを決める */
export function ryoshushoIssuedFrom(jobs: readonly RyoshushoJobRow[] | null | undefined): RyoshushoIssueState {
  const rows = (jobs ?? []).filter((j) => j.job_type === 'ryoshusho' && j.status !== 'failed');
  if (rows.length === 0) return { issued: false, at: null, count: 0 };
  const times = rows
    .map((j) => j.printed_at ?? j.created_at ?? null)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .sort();
  return { issued: true, at: times[0] ?? null, count: rows.length };
}

/** 「9/26 21:12」のような日本時間の短い表記（発行済みの案内に使う） */
export function jstShortDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

export const RYOSHUSHO_ISSUED_MESSAGE = 'この伝票の領収書は発行済みです。領収書は一度しか発行できません';
