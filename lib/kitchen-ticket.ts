/**
 * 厨房伝票のデータモデルとレイアウト（純関数・テスト対象）。
 * claim_kitchen_items（00057）が返した差分行を注文ごとの伝票にまとめ、
 * Markup / StarPRNT の両レンダラが共有する「行の並び」を組み立てる。
 */
import { colsFor, twoCol, wrapText, type PaperWidth, type WidthOptions } from './receipt-layout';
import { englishName } from './romaji';

export type KitchenStation = 'kitchen' | 'drink' | 'dessert' | 'grill';

export const STATION_LABELS: Record<KitchenStation, string> = {
  kitchen: 'キッチン',
  drink: 'ドリンク',
  dessert: 'デザート',
  grill: '焼き場',
};

/** 厨房伝票は英語を主にするため、ステーション名も英語を持つ */
export const STATION_LABELS_EN: Record<KitchenStation, string> = {
  kitchen: 'KITCHEN',
  drink: 'DRINK',
  dessert: 'DESSERT',
  grill: 'GRILL',
};

/**
 * 厨房伝票の分け方（店舗設定 store_settings.settings.kitchenTicket.split）。
 *   item  … 商品の種類ごとに1枚（同じ商品・同じ選択肢・同じメモはまとめて「x3」）。既定（2026-09-21 店舗要望）
 *   order … 1回の注文を1枚にまとめる（これまでの動き）
 * どちらも1回の注文は1つの印刷ジョブで出し、1枚ごとに紙を切る（ポーリング1回で全部出る・順番が崩れない）。
 */
export type KitchenTicketSplit = 'item' | 'order';

export const DEFAULT_KITCHEN_TICKET_SPLIT: KitchenTicketSplit = 'item';

export const KITCHEN_TICKET_SPLIT_LABELS: Record<KitchenTicketSplit, string> = {
  item: '商品の種類ごとに1枚ずつ',
  order: '1回の注文をまとめて1枚',
};

/** store_settings.settings から分け方を読む。未設定・不明な値は既定（種類ごと） */
export function kitchenTicketSplitFrom(settings: unknown): KitchenTicketSplit {
  const v = (settings as { kitchenTicket?: { split?: unknown } } | null)?.kitchenTicket?.split;
  return v === 'item' || v === 'order' ? v : DEFAULT_KITCHEN_TICKET_SPLIT;
}

/**
 * 厨房伝票の文字の大きさ（店舗設定 store_settings.settings.kitchenTicket.textSize）。
 *   large  … 商品名（英語・日本語）を縦横2倍（Word の16ポイントくらい）、卓名も縦横2倍、
 *             伝票番号・選択肢・メモは縦2倍。既定（2026-09-21 店舗要望「文字を少し大きく」）
 *   medium … 商品名（英語・日本語）・選択肢・メモ・伝票番号・取消の見出しを縦2倍（幅はそのまま）、卓名だけ縦横2倍。
 *             Word の12ポイントくらいの見た目（2026-09-21 店舗要望「大きくなりました。Word の12くらいに」）。
 *             プリンターの文字は1倍・2倍…の整数倍しか選べないため、縦2倍（高さ2倍・幅1倍）がいちばん近い。
 *             1行の桁数は変わらない（80mm=48桁）ので、長い商品名も縦横2倍のように途中で折り返さない
 *   normal … これまでの大きさ（商品名は縦2倍、日本語名・選択肢は等倍）
 */
export type KitchenTicketTextSize = 'large' | 'medium' | 'normal';

/** 既定は「中くらい」（2026-09-26 Ronnie「全店 中」。以前は large） */
export const DEFAULT_KITCHEN_TICKET_TEXT_SIZE: KitchenTicketTextSize = 'medium';

export const KITCHEN_TICKET_TEXT_SIZE_LABELS: Record<KitchenTicketTextSize, string> = {
  large: '大きめ（Word の16ポイントくらい）',
  medium: '中くらい（Word の12ポイントくらい）',
  normal: '標準（これまでの大きさ）',
};

/** 設定画面に並べる順（大きい順） */
export const KITCHEN_TICKET_TEXT_SIZES: readonly KitchenTicketTextSize[] = ['large', 'medium', 'normal'];

export function isKitchenTicketTextSize(v: unknown): v is KitchenTicketTextSize {
  return v === 'large' || v === 'medium' || v === 'normal';
}

export function kitchenTicketTextSizeFrom(settings: unknown): KitchenTicketTextSize {
  const v = (settings as { kitchenTicket?: { textSize?: unknown } } | null)?.kitchenTicket?.textSize;
  return isKitchenTicketTextSize(v) ? v : DEFAULT_KITCHEN_TICKET_TEXT_SIZE;
}

/**
 * 厨房伝票の商品名の言語（店舗設定 store_settings.settings.kitchenTicket.language）。
 *   both … 英語を主に、日本語も下に（これまで）。既定
 *   en   … 英語だけ（2026-09-21 Ronnie「キッチン英語だけで大丈夫」）。見出しの日本語（ドリンク 伝票・取消・テイクアウト）も出さない。
 *          英語名が作れない商品（英語名もカナも無い）は日本語名を出す（情報は落とさない）
 */
export type KitchenTicketLanguage = 'both' | 'en';

/** 既定は英語だけ（厨房・バーは英語で出す。2026-09-24 店舗要望） */
export const DEFAULT_KITCHEN_TICKET_LANGUAGE: KitchenTicketLanguage = 'en';

export const KITCHEN_TICKET_LANGUAGE_LABELS: Record<KitchenTicketLanguage, string> = {
  both: '英語と日本語（これまで）',
  en: '英語だけ',
};

export function kitchenTicketLanguageFrom(settings: unknown): KitchenTicketLanguage {
  const v = (settings as { kitchenTicket?: { language?: unknown } } | null)?.kitchenTicket?.language;
  return v === 'both' || v === 'en' ? v : DEFAULT_KITCHEN_TICKET_LANGUAGE;
}

/**
 * 厨房伝票を出したときのブザー信号（store_settings.settings.kitchenTicket.buzzer）。
 * 厨房は音がないと伝票が出たことに気付けないため（2026-09-25 店舗要望）。
 * 音はプリンター本体ではなく、ドロア／ブザー端子につないだブザー（Star mC-Sound 等）が鳴らす。
 *   drawer1 … コネクタ1（Star: BEL / EPSON: 2番ピン）← 既定・全店（2026-09-26 Ronnie「鳴るのは当たり前。設定に出さない」）
 *   drawer2 … コネクタ2（Star: SUB / EPSON: 5番ピン）。配線が違うときに DB で切り替える用
 *   none    … 鳴らさない（画面からは選べない。DB に残っている値の互換用）
 * 設定画面には出さない（2026-09-26 に外した）。ブザーをつないでいない厨房機では信号を出しても何も起きない。
 */
export type KitchenTicketBuzzer = 'none' | 'drawer1' | 'drawer2';

export const DEFAULT_KITCHEN_TICKET_BUZZER: KitchenTicketBuzzer = 'drawer1';

export const KITCHEN_TICKET_BUZZERS: KitchenTicketBuzzer[] = ['none', 'drawer1', 'drawer2'];

export const KITCHEN_TICKET_BUZZER_LABELS: Record<KitchenTicketBuzzer, string> = {
  none: '鳴らさない',
  drawer1: '鳴らす（コネクタ1）',
  drawer2: '鳴らす（コネクタ2）',
};

export function isKitchenTicketBuzzer(v: unknown): v is KitchenTicketBuzzer {
  return v === 'none' || v === 'drawer1' || v === 'drawer2';
}

/** store_settings.settings からブザー設定を読む。未設定・不明な値は既定（コネクタ1で鳴らす） */
export function kitchenTicketBuzzerFrom(settings: unknown): KitchenTicketBuzzer {
  const v = (settings as { kitchenTicket?: { buzzer?: unknown } } | null)?.kitchenTicket?.buzzer;
  return isKitchenTicketBuzzer(v) ? v : DEFAULT_KITCHEN_TICKET_BUZZER;
}

export interface KitchenTicketSettings {
  split: KitchenTicketSplit;
  textSize: KitchenTicketTextSize;
  language: KitchenTicketLanguage;
  buzzer: KitchenTicketBuzzer;
}

export function kitchenTicketSettingsFrom(settings: unknown): KitchenTicketSettings {
  return {
    split: kitchenTicketSplitFrom(settings),
    textSize: kitchenTicketTextSizeFrom(settings),
    language: kitchenTicketLanguageFrom(settings),
    buzzer: kitchenTicketBuzzerFrom(settings),
  };
}

/**
 * ドリンクの商品（item_type='drink'）が入っているのに、厨房ステーションが「ドリンク」になっていないカテゴリ。
 * 厨房伝票はカテゴリのステーションでプリンターに振り分けるため、ここに出たカテゴリの商品はドリンク機に出ない
 * （キッチン機に出る）。設定画面で気付けるように名前を返す。
 */
export function misroutedDrinkCategories(
  categories: { id: string; name: string; station: string | null }[],
  drinkItemCategoryIds: (string | null)[]
): string[] {
  const drinkIds = new Set(drinkItemCategoryIds.filter((id): id is string => !!id));
  return categories.filter((c) => drinkIds.has(c.id) && (c.station ?? 'kitchen') !== 'drink').map((c) => c.name);
}

/** claim_kitchen_items の1行 */
export interface ClaimedKitchenItem {
  order_id: string;
  order_no: number | string;
  table_name: string | null;
  guest_count: number | null;
  clerk_name: string | null;
  item_name: string;
  /** 設定 > メニュー の英語名。英語印字の第一候補 */
  item_name_en?: string | null;
  /** 商品のカナ。英語名が無いときはここからローマ字を作る */
  item_name_kana?: string | null;
  modifiers: { name: string; name_en?: string | null }[] | null;
  memo: string | null;
  station: string;
  delta: number;
}

export interface KitchenTicketLine {
  name: string;
  /** 英語名（name_en → カナのローマ字）。作れない場合は null（日本語名のみ印字する） */
  nameEn: string | null;
  /** 正=作る数（新規・追加）、負=取消数 */
  delta: number;
  /** 選択肢。英語名があれば英語、無ければ日本語 */
  modifiers: string[];
  memo: string | null;
}

export interface KitchenTicket {
  orderId: string;
  orderNo: string;
  tableName: string | null;
  guestCount: number | null;
  clerkName: string | null;
  lines: KitchenTicketLine[];
  /** 種類ごとに分けたときの「何枚目／全何枚」（1枚だけのときは付けない） */
  part?: { index: number; total: number } | null;
}

/** 同じ商品として1行にまとめるためのキー（追加と取消は別行） */
function lineKey(l: KitchenTicketLine): string {
  return [l.delta > 0 ? '+' : '-', l.name, l.nameEn ?? '', l.modifiers.join('\u0001'), l.memo ?? ''].join('\u0002');
}

/**
 * 差分行を注文ごとの伝票にまとめる（取消を先に出して見落としを防ぐ）。
 * レジは商品を1回タップするごとに1明細を作るため、同じ商品・同じ選択肢・同じメモの行は数量を足して1行にする
 * （「唐揚げ x1」が3行並ぶのではなく「唐揚げ x3」）。
 */
export function groupKitchenTickets(rows: ClaimedKitchenItem[]): KitchenTicket[] {
  const byOrder = new Map<string, { ticket: KitchenTicket; byKey: Map<string, KitchenTicketLine> }>();
  for (const r of rows) {
    if (!r.delta) continue;
    let entry = byOrder.get(r.order_id);
    if (!entry) {
      entry = {
        ticket: {
          orderId: r.order_id,
          orderNo: String(r.order_no),
          tableName: r.table_name,
          guestCount: r.guest_count,
          clerkName: r.clerk_name,
          lines: [],
        },
        byKey: new Map(),
      };
      byOrder.set(r.order_id, entry);
    }
    const line: KitchenTicketLine = {
      name: r.item_name,
      nameEn: englishName(r.item_name, r.item_name_kana ?? null, r.item_name_en ?? null),
      delta: r.delta,
      // 選択肢（セットのカレー・ナン/ご飯など）も英語優先。厨房が作るものそのものなので特に重要
      modifiers: (r.modifiers ?? []).map((m) => (m.name_en?.trim() || m.name)).filter(Boolean),
      memo: r.memo,
    };
    const key = lineKey(line);
    const same = entry.byKey.get(key);
    if (same) {
      same.delta += line.delta;
    } else {
      entry.byKey.set(key, line);
      entry.ticket.lines.push(line);
    }
  }
  const tickets = [...byOrder.values()].map((e) => e.ticket);
  for (const t of tickets) t.lines.sort((a, b) => Number(a.delta > 0) - Number(b.delta > 0));
  return tickets;
}

/**
 * 1回の注文の伝票を、商品の種類ごとの伝票に分ける（1枚に1商品）。
 * 何枚目かが分かるよう part（1/3 など）を付ける（1枚だけのときは印字しない）。
 */
export function splitTicketByItem(ticket: KitchenTicket): KitchenTicket[] {
  const total = ticket.lines.length;
  return ticket.lines.map((line, i) => ({ ...ticket, lines: [line], part: { index: i + 1, total } }));
}

/** 店舗設定の分け方に従って、1回の注文を何枚の伝票にするかを決める */
export function ticketSlips(ticket: KitchenTicket, split: KitchenTicketSplit): KitchenTicket[] {
  return split === 'item' ? splitTicketByItem(ticket) : [ticket];
}

/** レンダラ非依存の1行 */
export interface LayoutLine {
  text: string;
  align: 'left' | 'center';
  /** normal=等倍 / tall=縦倍（桁数は変わらない）/ large=縦横倍 */
  size: 'normal' | 'tall' | 'large';
  rule?: boolean;
}

export interface KitchenLayoutOptions extends WidthOptions {
  paperWidth?: PaperWidth;
  /** 1行の桁数を直接指定する（EPSON機は用紙幅どおりだと右端で折り返すため少なくする） */
  columns?: number;
  /** 伝票見出し（日本語。例: キッチン・ドリンク 伝票） */
  title: string;
  /** 伝票見出しの英語（例: KITCHEN / DRINK）。厨房伝票はこちらを主に出す */
  titleEn?: string;
  /** 表示用の発行時刻（例: 18:21） */
  printedAt: string;
  /** 文字の大きさ（省略時は標準＝これまでの大きさ） */
  textSize?: KitchenTicketTextSize;
  /** 商品名の言語（省略時は英語と日本語） */
  language?: KitchenTicketLanguage;
}

/** 伝票1枚ぶんの行を組み立てる。 */
/**
 * プリンターを上下さかさまに取り付けている店舗向けに、印字を180度回す（2026-09-25 要望）。
 * 行の並びを逆にして、1行の文字も逆順にする。紙をさかさまに読むと正しく見える。
 * 左寄せの行は回すと右寄せに見えるので、あらかじめ右に寄せておく（桁数が分かるときだけ）。
 * 機種ごとのコマンドに頼らないので、Star でも EPSON でも同じように効く。
 */
export function rotateLines180(lines: readonly LayoutLine[], columns?: number): LayoutLine[] {
  return [...lines].reverse().map((l) => {
    const text = [...l.text].reverse().join('');
    if (l.align === 'left' && columns && columns > 0) {
      // large（縦横2倍）は1行に入る桁数が半分になる
      const cols = l.size === 'large' ? Math.max(8, Math.floor(columns / 2)) : columns;
      const pad = Math.max(0, cols - [...text].length);
      return { ...l, text: ' '.repeat(pad) + text };
    }
    return { ...l, text };
  });
}

export function layoutKitchenTicket(ticket: KitchenTicket, opts: KitchenLayoutOptions): LayoutLine[] {
  const width = opts.columns ?? colsFor(opts.paperWidth);
  const rule = '-'.repeat(width);
  const out: LayoutLine[] = [];
  const big = opts.textSize === 'large';
  // 中くらい: 縦2倍（幅はそのまま）を主に使う。卓名だけ縦横2倍（短く、厨房で最初に探すため）
  const mid = opts.textSize === 'medium';
  // 長い商品名は桁数で折り返す（プリンタ任せだと1文字だけ次行に落ちて読みにくい）。
  // 縦2倍は桁数が変わらない。縦横2倍（large）は1行の桁数が半分になるので半分の桁数で折り返す。
  const push = (text: string, size: LayoutLine['size'] = 'normal', align: LayoutLine['align'] = 'left') => {
    const cols = size === 'large' ? Math.max(8, Math.floor(width / 2)) : width;
    for (const w of wrapText(text, cols, opts)) out.push({ text: w, size, align });
  };

  const hasCancel = ticket.lines.some((l) => l.delta < 0);
  const hasAdd = ticket.lines.some((l) => l.delta > 0);
  const enOnly = opts.language === 'en';

  // 厨房は英語主体（日本語を読まないスタッフが作る）。「英語と日本語」は日本語も残して両方読めるようにする。
  if (opts.titleEn) push(opts.titleEn, 'normal', 'center');
  if (!enOnly || !opts.titleEn) push(opts.title, 'normal', 'center');
  // 卓名と取消の見出し: 標準は縦2倍、大きめは縦横2倍（卓名は短いので半分の桁数でも収まる）。中くらいは卓名だけ縦横2倍
  push(ticket.tableName ?? (enOnly ? 'TAKEOUT' : 'TAKEOUT / テイクアウト'), big || mid ? 'large' : 'tall', 'center');
  if (hasCancel && !hasAdd) push(enOnly ? '*** CANCEL ***' : '*** CANCEL / 取消 ***', big ? 'large' : 'tall', 'center');
  const part = ticket.part && ticket.part.total > 1 ? `  (${ticket.part.index}/${ticket.part.total})` : '';
  push(twoCol(`No.${ticket.orderNo}${part}`, opts.printedAt, width, opts), big || mid ? 'tall' : 'normal');
  const meta = [
    ticket.guestCount ? `Guests ${ticket.guestCount}` : null,
    ticket.clerkName ? `Staff ${ticket.clerkName}` : null,
  ]
    .filter(Boolean)
    .join('  ');
  if (meta) push(meta);
  out.push({ text: rule, size: 'normal', align: 'left', rule: true });

  // 商品名: 大きめは英語・日本語とも縦横2倍（Word の16ポイントくらい）、選択肢・メモは縦2倍。
  // 中くらいは商品名（英語・日本語）・選択肢・メモとも縦2倍（Word の12ポイントくらい。1行48桁のまま）。
  // 標準は種類ごとの伝票（1枚に1商品）だけ商品名を縦2倍（これまでの大きさ）
  const itemSize: LayoutLine['size'] = big ? 'large' : mid ? 'tall' : ticket.part ? 'tall' : 'normal';
  const nameJaSize: LayoutLine['size'] = big ? 'large' : mid ? 'tall' : 'normal';
  const detailSize: LayoutLine['size'] = big || mid ? 'tall' : 'normal';
  // 縦横2倍は字下げを浅くする（1行の桁数が半分になるため）
  const indent = big ? ' ' : '   ';
  for (const l of ticket.lines) {
    // 日本語を読まない厨房スタッフ向けに、英語を主・日本語を従で並べる（「英語だけ」は日本語を出さない）
    // （英語が作れない商品は日本語のみ。情報は落とさない）
    const qty = `x${Math.abs(l.delta)}`;
    const head = l.nameEn ?? l.name;
    // 取消の印は商品名と別の行にする（同じ行だと大きい文字で商品名の途中から折り返して読みにくい）
    if (l.delta < 0) push(enOnly ? '[CANCEL]' : '[CANCEL / 取消]', itemSize);
    push(`${head}  ${qty}`, itemSize);
    if (l.nameEn && !enOnly) push(`${indent}${l.name}`, nameJaSize);
    for (const m of l.modifiers) push(`   ・${m}`, detailSize);
    if (l.memo) push(`   ※${l.memo}`, detailSize);
  }
  out.push({ text: rule, size: 'normal', align: 'left', rule: true });
  return out;
}
