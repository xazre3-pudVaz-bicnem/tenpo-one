/**
 * スキャンしたレシート・請求書の文字から「金額・日付・種類（レシートか請求書か）・費目・発行元」を読む（純関数）。
 * 2026-10-20 Ronnie「ScanSnap（iX100 など）で iPad からスキャン → 出金・月払いに入って自動で決算・レジクローズにつながるように」。
 *
 * - 文字の読み取りは iPad のブラウザの中（pdf.js の文字・Tesseract。料金なし）。ここは読み取った文字を分けるだけ
 * - 確実ではないので、読めない・迷うときは null（＝要確認）にする。自動で紐付けるのは金額がぴったり合うときだけ
 */

export type ScanKind = 'receipt' | 'bill';
/** 月払いの費目。rent・electric・water・gas は本部が入れる固定費（月次清算）、vendor は仕入先の請求書 */
export type BillCategory = 'rent' | 'electric' | 'water' | 'gas' | 'vendor';

export interface ScanReading {
  kind: ScanKind;
  /** 請求書のときの費目（レシートは null） */
  category: BillCategory | null;
  /** 合計金額（税込・円）。読めなければ null */
  amount: number | null;
  /** 日付 YYYY-MM-DD。読めなければ null */
  date: string | null;
  /** 発行元（店名・会社名）。読めなければ null */
  vendorName: string | null;
}

export const BILL_CATEGORY_LABELS: Record<BillCategory, string> = {
  rent: '家賃',
  electric: '電気',
  water: '水道',
  gas: 'ガス',
  vendor: '仕入・経費の請求書',
};

const MAX_AMOUNT = 10_000_000;

const CJK = '\\u3005\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f';
/** OCR が漢字・かなの間に入れる空白（「歌舞 伎町 店」） */
const CJK_SPACE = new RegExp(`([${CJK}・])\\s+(?=[${CJK}・])`, 'g');

/**
 * 全角の数字・記号を半角に、全角スペースを半角に。
 * PDF の文字には「⽉」「⽇」「⼒」のような部首の文字（康熙部首）が入ることがあるので NFKC でふつうの漢字にする。
 */
/** NFKC で直らない部首補助の文字（PDF の文字に出る）→ ふつうの漢字 */
const RADICAL_SUPPLEMENT: Record<string, string> = {
  '⻘': '青', '⻑': '長', '⻝': '食', '⻄': '西', '⻤': '鬼', '⻭': '歯', '⻯': '竜', '⻲': '亀', '⻩': '黄', '⻨': '麦', '⻫': '斉', '⻖': '阝', '⻌': '辶',
};

function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u2e80-\u2eff]/g, (c) => RADICAL_SUPPLEMENT[c] ?? c)
    .replace(CJK_SPACE, '$1')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[￥]/g, '¥')
    .replace(/[：]/g, ':')
    .replace(/[／]/g, '/')
    .replace(/　/g, ' ');
}

/** 1行の中の金額（¥1,234・1,234円・1234円・¥ 1234）。OCR でカンマが . や空白になったものも拾う */
function amountsIn(line: string): number[] {
  const out: number[] = [];
  const re = /¥\s*(\d{1,3}(?:[,.\s]\d{3})+|\d{1,8})|(\d{1,3}(?:[,.]\d{3})+|\d{1,8})\s*円/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').replace(/[,.\s]/g, '');
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT) out.push(n);
  }
  return out;
}

/** カンマ付きの数だけ（¥・円が無い行の合計欄用。例「合計 3,280」） */
function plainCommaNumbers(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/(?<![\d/:-])(\d{1,3}(?:,\d{3})+)(?![\d/:-])/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n > 0 && n <= MAX_AMOUNT) out.push(n);
  }
  return out;
}

const TOTAL_WORDS = /(合\s*計|総\s*額|お買上|お買い上げ|領収金額|お支払(?:金額|額)?|ご請求金額|御請求金額|請求金額|今回ご請求額|今回請求額|お支払い金額|税込合計|ご利用金額|小計)/;
const NOT_TOTAL = /(お預り|お預かり|預り|お釣り|おつり|釣銭|釣り|ポイント|内消費税|消費税等?\s*(?:\(|（)?\d|対象|税抜)/;

/** 合計金額。「合計」などの行（無ければ次の行）の金額を優先し、無ければいちばん大きい ¥・円 の金額 */
export function readAmount(lines: string[]): number | null {
  const norm = lines.map(normalize);
  const totals: number[] = [];
  for (let i = 0; i < norm.length; i++) {
    const l = norm[i];
    if (!TOTAL_WORDS.test(l) || NOT_TOTAL.test(l)) continue;
    const isSubtotal = /小\s*計/.test(l) && !/合\s*計/.test(l);
    let found = [...amountsIn(l), ...plainCommaNumbers(l)];
    if (found.length === 0 && i + 1 < norm.length && !NOT_TOTAL.test(norm[i + 1])) {
      found = [...amountsIn(norm[i + 1]), ...plainCommaNumbers(norm[i + 1])];
    }
    if (found.length === 0) continue;
    // 小計しか無いときだけ小計を使う（合計があれば合計）
    totals.push(...found.map((n) => (isSubtotal ? -n : n)));
  }
  const real = totals.filter((n) => n > 0);
  if (real.length > 0) return Math.max(...real);
  const subs = totals.filter((n) => n < 0).map((n) => -n);
  if (subs.length > 0) return Math.max(...subs);
  const any = norm.filter((l) => !NOT_TOTAL.test(l)).flatMap(amountsIn);
  return any.length > 0 ? Math.max(...any) : null;
}

const REIWA_START = 2018; // 令和1年 = 2019

function ymd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function datesIn(line: string): string[] {
  const out: string[] = [];
  const push = (v: string | null) => {
    if (v) out.push(v);
  };
  for (const m of line.matchAll(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/g)) {
    push(ymd(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  // 令和6年10月19日・R6.10.19・R06/10/19
  for (const m of line.matchAll(/(?:令和|R)\s*(\d{1,2}|元)\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g)) {
    const n = m[1] === '元' ? 1 : Number(m[1]);
    push(ymd(REIWA_START + n, Number(m[2]), Number(m[3])));
  }
  // 26/10/19（2桁の年）
  for (const m of line.matchAll(/(?<![\d/])(\d{2})\/(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    push(ymd(2000 + Number(m[1]), Number(m[2]), Number(m[3])));
  }
  return out;
}

const DUE_WORDS = /(支払期限|お支払期限|支払期日|振込期限|お振込期限|期限|有効期限|次回)/;
const ISSUE_WORDS = /(請求日|発行日|ご利用日|ご購入日|お買上日|日付|検針日|作成日)/;

/** 日付。発行日・請求日の行を優先、支払期限・有効期限の行は使わない。today より先の日付は使わない */
export function readDate(lines: string[], today: string): string | null {
  const norm = lines.map(normalize);
  const preferred: string[] = [];
  const others: string[] = [];
  for (const l of norm) {
    const ds = datesIn(l).filter((d) => d <= today);
    if (ds.length === 0) continue;
    if (DUE_WORDS.test(l) && !ISSUE_WORDS.test(l)) continue;
    (ISSUE_WORDS.test(l) ? preferred : others).push(...ds);
  }
  return preferred[0] ?? others[0] ?? null;
}

const BILL_WORDS = /(請\s*求\s*書|御請求|ご請求|請求金額|今回請求|お支払期限|支払期限|振込先|お振込先|ご使用量|検針|使用期間|口座振替|引落|引き落とし)/;
const RECEIPT_WORDS = /(領\s*収\s*書|領収証|レシート|お預り|お預かり|お釣り|おつり|釣銭)/;

export function readKind(lines: string[]): ScanKind {
  const text = lines.map(normalize).join('\n');
  if (RECEIPT_WORDS.test(text) && !/(請\s*求\s*書|ご請求金額|御請求金額|今回請求)/.test(text)) return 'receipt';
  return BILL_WORDS.test(text) ? 'bill' : 'receipt';
}

export function readCategory(lines: string[]): BillCategory {
  const text = lines.map(normalize).join('\n');
  if (/(電気料金|電気ご使用量|電力|でんき|kWh)/i.test(text)) return 'electric';
  if (/(水道|上下水道|下水道)/.test(text)) return 'water';
  if (/(ガス料金|ガスご使用量|都市ガス|プロパン|LPガス|東京ガス|大阪ガス)/.test(text)) return 'gas';
  if (/(家賃|賃料|共益費|管理費|賃貸)/.test(text)) return 'rent';
  return 'vendor';
}

/** 発行元：会社名（株式会社・(株)・有限会社…）か、レシートの1行目の店名。宛名（〜様・御中）は除く */
export function readVendor(lines: string[]): string | null {
  const norm = lines.map((l) => normalize(l).trim()).filter(Boolean);
  const company = norm.find(
    (l) => /(株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|商店|商事|電力|ガス|水道局)/.test(l) && !/(様|御中|殿)\s*$/.test(l) && l.length <= 40
  );
  if (company) return company.replace(/\s+/g, ' ').slice(0, 40);
  const first = norm.find((l) => /[\p{L}]/u.test(l) && !/(領収|レシート|請求|様|御中|\d{2,})/.test(l) && l.length >= 2 && l.length <= 30);
  return first ? first.slice(0, 40) : null;
}

/** 読み取った文字（行の並び）から、金額・日付・種類・費目・発行元をまとめて読む */
export function readScan(lines: string[], today: string): ScanReading {
  const kind = readKind(lines);
  return {
    kind,
    category: kind === 'bill' ? readCategory(lines) : null,
    amount: readAmount(lines),
    date: readDate(lines, today),
    vendorName: readVendor(lines),
  };
}

// ---------------------------------------------------------------------------
// 出金との突き合わせ
// ---------------------------------------------------------------------------

export interface WithdrawalCandidate {
  id: string;
  amount: number;
  /** 営業日 YYYY-MM-DD */
  businessDate: string;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** 突き合わせる日の幅（レシートの日付の前後） */
export const MATCH_WINDOW_DAYS = 3;

/**
 * レシートに合う出金を1件だけ選ぶ。金額がぴったり同じで、日付が前後 MATCH_WINDOW_DAYS 日以内（日付が読めなければ today から7日以内）。
 * いちばん日付の近いものが1件に決まるときだけ返す（同じ近さが2件以上なら選ばない＝要確認）。
 */
export function matchWithdrawal(
  reading: Pick<ScanReading, 'amount' | 'date'>,
  candidates: WithdrawalCandidate[],
  today: string
): WithdrawalCandidate | null {
  if (reading.amount == null) return null;
  const base = reading.date ?? today;
  const window = reading.date ? MATCH_WINDOW_DAYS : 7;
  const hits = candidates
    .filter((c) => c.amount === reading.amount)
    .map((c) => ({ c, d: Math.abs(dayDiff(c.businessDate, base)) }))
    .filter((x) => x.d <= window)
    .sort((a, b) => a.d - b.d);
  if (hits.length === 0) return null;
  if (hits.length > 1 && hits[1].d === hits[0].d) return null;
  return hits[0].c;
}
