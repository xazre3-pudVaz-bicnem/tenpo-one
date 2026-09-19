/**
 * 厨房伝票のデータモデルとレイアウト（純関数・テスト対象）。
 * claim_kitchen_items（00057）が返した差分行を注文ごとの伝票にまとめ、
 * Markup / StarPRNT の両レンダラが共有する「行の並び」を組み立てる。
 */
import { colsFor, twoCol, type PaperWidth } from './receipt-layout';
import { romanItemName } from './romaji';

export type KitchenStation = 'kitchen' | 'drink' | 'dessert';

export const STATION_LABELS: Record<KitchenStation, string> = {
  kitchen: 'キッチン',
  drink: 'ドリンク',
  dessert: 'デザート',
};

/** claim_kitchen_items の1行 */
export interface ClaimedKitchenItem {
  order_id: string;
  order_no: number | string;
  table_name: string | null;
  guest_count: number | null;
  clerk_name: string | null;
  item_name: string;
  /** 商品のカナ（英語名を入れている店舗もある）。ローマ字印字の元にする */
  item_name_kana?: string | null;
  modifiers: { name: string }[] | null;
  memo: string | null;
  station: string;
  delta: number;
}

export interface KitchenTicketLine {
  name: string;
  /** ローマ字名。作れない場合は null（日本語名のみ印字する） */
  nameRoman: string | null;
  /** 正=作る数（新規・追加）、負=取消数 */
  delta: number;
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
}

/** 差分行を注文ごとの伝票にまとめる（取消を先に出して見落としを防ぐ）。 */
export function groupKitchenTickets(rows: ClaimedKitchenItem[]): KitchenTicket[] {
  const byOrder = new Map<string, KitchenTicket>();
  for (const r of rows) {
    if (!r.delta) continue;
    let t = byOrder.get(r.order_id);
    if (!t) {
      t = {
        orderId: r.order_id,
        orderNo: String(r.order_no),
        tableName: r.table_name,
        guestCount: r.guest_count,
        clerkName: r.clerk_name,
        lines: [],
      };
      byOrder.set(r.order_id, t);
    }
    t.lines.push({
      name: r.item_name,
      nameRoman: romanItemName(r.item_name, r.item_name_kana ?? null),
      delta: r.delta,
      modifiers: (r.modifiers ?? []).map((m) => m.name).filter(Boolean),
      memo: r.memo,
    });
  }
  const tickets = [...byOrder.values()];
  for (const t of tickets) t.lines.sort((a, b) => Number(a.delta > 0) - Number(b.delta > 0));
  return tickets;
}

/** レンダラ非依存の1行 */
export interface LayoutLine {
  text: string;
  align: 'left' | 'center';
  /** normal=等倍 / tall=縦倍（桁数は変わらない）/ large=縦横倍 */
  size: 'normal' | 'tall' | 'large';
  rule?: boolean;
}

export interface KitchenLayoutOptions {
  paperWidth?: PaperWidth;
  /** 伝票見出し（プリンタ名やステーション名） */
  title: string;
  /** 表示用の発行時刻（例: 18:21） */
  printedAt: string;
}

/** 伝票1枚ぶんの行を組み立てる。 */
export function layoutKitchenTicket(ticket: KitchenTicket, opts: KitchenLayoutOptions): LayoutLine[] {
  const width = colsFor(opts.paperWidth);
  const rule = '-'.repeat(width);
  const out: LayoutLine[] = [];
  const push = (text: string, size: LayoutLine['size'] = 'normal', align: LayoutLine['align'] = 'left') =>
    out.push({ text, size, align });

  const hasCancel = ticket.lines.some((l) => l.delta < 0);
  const hasAdd = ticket.lines.some((l) => l.delta > 0);

  push(opts.title, 'normal', 'center');
  push(ticket.tableName ?? 'テイクアウト', 'large', 'center');
  if (hasCancel && !hasAdd) push('*** 取消 ***', 'large', 'center');
  push(twoCol(`No.${ticket.orderNo}`, opts.printedAt, width));
  const meta = [ticket.guestCount ? `${ticket.guestCount}名` : null, ticket.clerkName ? `担当 ${ticket.clerkName}` : null]
    .filter(Boolean)
    .join('  ');
  if (meta) push(meta);
  out.push({ text: rule, size: 'normal', align: 'left', rule: true });

  for (const l of ticket.lines) {
    // 日本語を読まない厨房スタッフ向けに、ローマ字を主・日本語を従で並べる
    // （ローマ字が作れない商品は日本語のみ。情報は落とさない）
    const qty = `x${Math.abs(l.delta)}`;
    const cancelled = l.delta < 0;
    const head = l.nameRoman ?? l.name;
    push(`${cancelled ? '【取消/CANCEL】' : ''}${head}  ${qty}`, 'tall');
    if (l.nameRoman) push(`   ${l.name}`);
    for (const m of l.modifiers) push(`   ・${m}`);
    if (l.memo) push(`   ※${l.memo}`);
  }
  out.push({ text: rule, size: 'normal', align: 'left', rule: true });
  return out;
}
