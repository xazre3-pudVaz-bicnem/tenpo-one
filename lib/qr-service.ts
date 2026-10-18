/**
 * お客様QRの「サービス」（お水・お箸・取り皿交換など、無料で頼めるもの）。純関数・テスト対象。
 *
 * 2026-10-18 Ronnie「QR の最後に SERVICE ボタン。お水・塩・ブラックペッパー・一味・醤油・わさび・取り皿交換・
 * スプーン・お箸のように。全店舗で追加できるように、いまある仕組み（呼び出し）で」。
 *
 * - 店舗ごとの一覧は store_settings.settings.qrService に入る（DB 変更なし）。設定 > メニュー > QRのサービス で編集
 * - 一覧を保存していない店舗は 標準の一覧（お水・取り皿交換・お箸・スプーン）で出す。出したくない店舗は「出さない」にする
 * - お客様が選んで送ると、スタッフ呼び出し（service_calls kind='staff'）の note に「お水×2・お箸×2」が入り、
 *   ハンディ・レジの呼び出しと同じように 鈴・振動・通知 で知らせる。注文（伝票・厨房伝票・会計）には入らない
 */

export interface QrServiceItem {
  /** 日本語の名前（例：お水） */
  name: string;
  /** 英語の名前（例：Water）。無ければ null（英語の画面でも日本語で出す） */
  nameEn: string | null;
}

export interface QrServiceSettings {
  /** お客様QRに出すか */
  enabled: boolean;
  items: QrServiceItem[];
}

/** 一覧を保存していない店舗の標準（どの業態でも使うものだけ） */
export const DEFAULT_QR_SERVICE_ITEMS: readonly QrServiceItem[] = [
  { name: 'お水', nameEn: 'Water' },
  { name: '取り皿交換', nameEn: 'New plates' },
  { name: 'お箸', nameEn: 'Chopsticks' },
  { name: 'スプーン', nameEn: 'Spoon' },
];

/** 一覧の上限・名前の長さ・1回に頼める数 */
export const QR_SERVICE_MAX_ITEMS = 24;
export const QR_SERVICE_NAME_MAX = 20;
export const QR_SERVICE_QTY_MAX = 9;
/** 呼び出しの note に入れる長さの上限（何度も頼まれてもこれ以上は増やさない） */
export const QR_SERVICE_NOTE_MAX = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\s　]+/g, ' ').trim().slice(0, QR_SERVICE_NAME_MAX) : '';
}

/** 入力された一覧を整える（空・重複を除く、長さ・数をそろえる） */
export function sanitizeQrServiceItems(input: unknown): QrServiceItem[] {
  if (!Array.isArray(input)) return [];
  const out: QrServiceItem[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    if (!isRecord(row)) continue;
    const name = cleanName(row.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const en = cleanName(row.nameEn);
    out.push({ name, nameEn: en || null });
    if (out.length >= QR_SERVICE_MAX_ITEMS) break;
  }
  return out;
}

/** store_settings.settings から読む。保存が無ければ 標準の一覧で「出す」 */
export function qrServiceFrom(settings: unknown): QrServiceSettings {
  const root = isRecord(settings) ? settings.qrService : null;
  if (!isRecord(root)) return { enabled: true, items: DEFAULT_QR_SERVICE_ITEMS.map((i) => ({ ...i })) };
  return {
    enabled: root.enabled !== false,
    items: sanitizeQrServiceItems(root.items),
  };
}

/** 保存する形 */
export function qrServiceToJson(s: QrServiceSettings): { enabled: boolean; items: QrServiceItem[] } {
  return { enabled: s.enabled, items: sanitizeQrServiceItems(s.items) };
}

/** お客様QRに出す一覧（出さない設定・空なら空） */
export function visibleQrServiceItems(s: QrServiceSettings): QrServiceItem[] {
  return s.enabled ? s.items : [];
}

export interface QrServiceRequestLine {
  name: string;
  qty: number;
}

/**
 * お客様が選んだものを、スタッフに見せる1行にする（例：「お水×2・お箸×1」）。
 * お店の一覧に無い名前・数が変なものは捨てる（QR から勝手な文字を送らせない）。何も残らなければ ''
 */
export function formatQrServiceRequest(lines: unknown, items: readonly QrServiceItem[]): string {
  if (!Array.isArray(lines)) return '';
  const allowed = new Set(items.map((i) => i.name));
  const qty = new Map<string, number>();
  for (const l of lines) {
    if (!isRecord(l)) continue;
    const name = typeof l.name === 'string' ? l.name : '';
    const n = typeof l.qty === 'number' && Number.isInteger(l.qty) ? l.qty : 0;
    if (!allowed.has(name) || n < 1) continue;
    qty.set(name, Math.min(QR_SERVICE_QTY_MAX, (qty.get(name) ?? 0) + n));
  }
  // お店の一覧の順番で並べる
  return items
    .filter((i) => qty.has(i.name))
    .map((i) => `${i.name}×${qty.get(i.name)}`)
    .join('・');
}

/**
 * 呼び出しの note に足す。まだ対応していない呼び出しにもう一度頼まれたときは「／」でつなぐ。
 * 上限を超えるときは足さない（null を返す）
 */
export function mergeQrServiceNote(existing: string | null | undefined, add: string): string | null {
  const a = add.trim();
  if (!a) return null;
  const cur = (existing ?? '').trim();
  const next = cur ? `${cur}／${a}` : a;
  return next.length > QR_SERVICE_NOTE_MAX ? null : next;
}
