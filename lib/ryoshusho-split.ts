/**
 * 領収書の分割発行（2026-09-25 店舗要望 FULL MOoN 御茶ノ水「領収書の分割ができるようにしてほしい」）。
 *
 * 宴会などで1つの会計を数人で割って、それぞれに領収書を出したいときに使う。
 * 会計そのもの（売上・支払）は分けない。出す「証憑」だけを分ける。
 *
 * 決めごと:
 *   - 分割した金額の合計は、必ず領収額（netPaid）と一致させる。1円でもズレたら発行させない
 *   - 等分で割り切れない端数は先頭の伝票に寄せる（現場が「1枚目が1円多い」と説明しやすい）
 *   - 内消費税は金額の比で按分し、端数は最後の1枚で吸収する（合計が税額と必ず一致する）
 *   - 1枚ごとに「(2/3)」のような通し番号を印字して、二重計上をひと目で防ぐ
 * ここは純粋な関数だけ（DB・React 非依存・テスト対象）。
 */

/** 分割できる最大枚数。宴会の割り勘を想定した上限 */
export const RYOSHUSHO_SPLIT_MAX = 20;
export const RYOSHUSHO_SPLIT_MIN = 2;

export interface RyoshushoSlip {
  /** 1始まりの通し番号 */
  index: number;
  count: number;
  /** この1枚で領収する金額（税込） */
  amount: number;
  /** この1枚に含まれる消費税（按分） */
  tax: number;
}

/** 分割できる枚数か */
export function isSplitCount(count: unknown): count is number {
  return (
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= RYOSHUSHO_SPLIT_MIN &&
    count <= RYOSHUSHO_SPLIT_MAX
  );
}

/**
 * 総額を count 枚に等分する。割り切れない端数は先頭の伝票から1円ずつ足す。
 * 例: 10,000円を3枚 → [3334, 3333, 3333]
 */
export function splitAmounts(total: number, count: number): number[] {
  if (!isSplitCount(count)) return [Math.round(total)];
  const t = Math.round(total);
  const base = Math.floor(t / count);
  const remainder = t - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * 金額の比で内消費税を按分する。端数は最後の1枚で吸収するので、合計は必ず taxTotal と一致する。
 */
export function prorateTax(taxTotal: number, amounts: number[]): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (amounts.length === 0) return [];
  if (total <= 0) return amounts.map(() => 0);
  const out = amounts.map((a) => Math.round((taxTotal * a) / total));
  const used = out.slice(0, -1).reduce((a, b) => a + b, 0);
  out[out.length - 1] = Math.round(taxTotal) - used;
  return out;
}

/** 分割の合計が領収額と一致しているか（ここが合わないと発行させない） */
export function isSplitBalanced(amounts: number[], total: number): boolean {
  if (amounts.length === 0) return false;
  if (amounts.some((a) => !Number.isFinite(a) || !Number.isInteger(a) || a <= 0)) return false;
  return amounts.reduce((a, b) => a + b, 0) === Math.round(total);
}

/** 画面・印字で使う1枚ずつの内容にする */
export function ryoshushoSlips(amounts: number[], taxTotal: number): RyoshushoSlip[] {
  const taxes = prorateTax(taxTotal, amounts);
  return amounts.map((amount, i) => ({ index: i + 1, count: amounts.length, amount, tax: taxes[i] }));
}

/** 「(2/3)」のような見出し。1枚だけのときは空文字（通常の領収書と同じ見た目にする） */
export function splitLabel(slip: Pick<RyoshushoSlip, 'index' | 'count'>): string {
  return slip.count > 1 ? `(${slip.index}/${slip.count})` : '';
}
