/**
 * 厨房伝票のデータモデルとレイアウト（純関数・テスト対象）。
 * claim_kitchen_items（00057）が返した差分行を注文ごとの伝票にまとめ、
 * Markup / StarPRNT の両レンダラが共有する「行の並び」を組み立てる。
 */
import { colsFor, twoCol, wrapText, type PaperWidth, type WidthOptions } from './receipt-layout';
import { englishName } from './romaji';

export type KitchenStation = 'kitchen' | 'drink' | 'dessert';

export const STATION_LABELS: Record<KitchenStation, string> = {
  kitchen: 'キッチン',
  drink: 'ドリンク',
  dessert: 'デザート',
};

/** 厨房伝票は英語を主にするため、ステーション名も英語を持つ */
export const STATION_LABELS_EN: Record<KitchenStation, string> = {
  kitchen: 'KITCHEN',
  drink: 'DRINK',
  dessert: 'DESSERT',
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
}

/** 伝票1枚ぶんの行を組み立てる。 */
export function layoutKitchenTicket(ticket: KitchenTicket, opts: KitchenLayoutOptions): LayoutLine[] {
  const width = opts.columns ?? colsFor(opts.paperWidth);
  const rule = '-'.repeat(width);
  const out: LayoutLine[] = [];
  // 長い商品名は桁数で折り返す（プリンタ任せだと1文字だけ次行に落ちて読みにくい）。
  // 縦2倍は桁数が変わらないので、どのサイズでも同じ桁数で折り返してよい。
  const push = (text: string, size: LayoutLine['size'] = 'normal', align: LayoutLine['align'] = 'left') => {
    for (const w of wrapText(text, width, opts)) out.push({ text: w, size, align });
  };

  const hasCancel = ticket.lines.some((l) => l.delta < 0);
  const hasAdd = ticket.lines.some((l) => l.delta > 0);

  // 厨房は英語主体（日本語を読まないスタッフが作る）。日本語も残して両方読めるようにする。
  if (opts.titleEn) push(opts.titleEn, 'normal', 'center');
  push(opts.title, 'normal', 'center');
  // 卓名と取消の見出しは縦2倍まで（縦横2倍だと1行の桁数が半分になり、紙も文字も大きくなりすぎる）
  push(ticket.tableName ?? 'TAKEOUT / テイクアウト', 'tall', 'center');
  if (hasCancel && !hasAdd) push('*** CANCEL / 取消 ***', 'tall', 'center');
  const part = ticket.part && ticket.part.total > 1 ? `  (${ticket.part.index}/${ticket.part.total})` : '';
  push(twoCol(`No.${ticket.orderNo}${part}`, opts.printedAt, width, opts));
  const meta = [
    ticket.guestCount ? `Guests ${ticket.guestCount}` : null,
    ticket.clerkName ? `Staff ${ticket.clerkName}` : null,
  ]
    .filter(Boolean)
    .join('  ');
  if (meta) push(meta);
  out.push({ text: rule, size: 'normal', align: 'left', rule: true });

  // 種類ごとに分けた伝票（1枚に1商品）は、商品名を縦2倍にして遠くからでも読めるようにする
  // （縦2倍は1行の桁数が変わらないので折り返しは等倍と同じ）
  const itemSize: LayoutLine['size'] = ticket.part ? 'tall' : 'normal';
  for (const l of ticket.lines) {
    // 日本語を読まない厨房スタッフ向けに、英語を主・日本語を従で並べる
    // （英語が作れない商品は日本語のみ。情報は落とさない）
    const qty = `x${Math.abs(l.delta)}`;
    const cancelled = l.delta < 0;
    const head = l.nameEn ?? l.name;
    push(`${cancelled ? '[CANCEL/取消] ' : ''}${head}  ${qty}`, itemSize);
    if (l.nameEn) push(`   ${l.name}`);
    for (const m of l.modifiers) push(`   ・${m}`);
    if (l.memo) push(`   ※${l.memo}`);
  }
  out.push({ text: rule, size: 'normal', align: 'left', rule: true });
  return out;
}
