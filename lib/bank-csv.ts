/**
 * 銀行明細CSVの取込（列の対応付け・1行の読み取り）。Web の components/accounting/bank-csv-import.tsx と
 * iPad ネイティブ（lib/native-modules/accounting.ts）で同じ純関数を使う（2026-10-24 コンポーネントから移した。中身は同じ）。
 */

export interface BankCsvColumnMapping {
  date: number | null;
  description: number | null;
  deposit: number | null;
  withdrawal: number | null;
}

export interface BankCsvParsedRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
}

/** 日付表記のゆらぎ（区切り文字違い）を吸収して 'YYYY-MM-DD' へ正規化する */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/[／．]/g, '/').replace(/[.]/g, '-').replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  const iso = `${y}-${mo}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return iso;
}

/** 金額表記（カンマ・円記号）を除去して整数化する */
export function normalizeAmount(raw: string): number {
  const cleaned = raw.replace(/[¥,円\s]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : NaN;
}

/** 列名からの簡易自動推定 */
export function guessBankCsvMapping(headerRow: string[]): BankCsvColumnMapping {
  const findCol = (keywords: string[]) => headerRow.findIndex((h) => keywords.some((k) => h.includes(k)));
  const pick = (keywords: string[]): number | null => {
    const i = findCol(keywords);
    return i >= 0 ? i : null;
  };
  return {
    date: pick(['日付', '年月日', 'date']),
    description: pick(['摘要', '内容', '取引内容', 'description']),
    deposit: pick(['入金', 'お預け入れ', 'deposit']),
    withdrawal: pick(['出金', 'お引き出し', 'withdrawal']),
  };
}

/** 日付・摘要は必須、入金・出金は少なくとも一方 */
export function isBankCsvMappingComplete(mapping: BankCsvColumnMapping): boolean {
  return mapping.date != null && mapping.description != null && (mapping.deposit != null || mapping.withdrawal != null);
}

/** 1行を読み取る（読めなければ error に理由） */
export function parseBankCsvRow(
  cells: string[],
  mapping: BankCsvColumnMapping
): { parsed: BankCsvParsedRow; error: null } | { parsed: null; error: string } {
  const dateRaw = mapping.date != null ? cells[mapping.date] ?? '' : '';
  const descRaw = mapping.description != null ? cells[mapping.description] ?? '' : '';
  const depositRaw = mapping.deposit != null ? cells[mapping.deposit] ?? '' : '';
  const withdrawalRaw = mapping.withdrawal != null ? cells[mapping.withdrawal] ?? '' : '';

  const date = normalizeDate(dateRaw);
  const deposit = normalizeAmount(depositRaw);
  const withdrawal = normalizeAmount(withdrawalRaw);

  if (!date) return { parsed: null, error: `日付を解釈できません（${dateRaw}）` };
  if (!descRaw.trim()) return { parsed: null, error: '摘要が空です' };
  if (Number.isNaN(deposit) || Number.isNaN(withdrawal)) {
    return { parsed: null, error: '金額を解釈できません' };
  }
  if (deposit === 0 && withdrawal === 0) return { parsed: null, error: '入金・出金がいずれも0円です' };
  if (deposit > 0 && withdrawal > 0) return { parsed: null, error: '入金・出金が両方入力されています' };

  return { parsed: { date, description: descRaw.trim(), deposit, withdrawal }, error: null };
}
