/**
 * まだ注文していないカートの単価を、いまのメニューの値段で付け直す（ハンディ・レジ iPad 共通）。
 * 2026-09-28 Ronnie「メニュー設定で値段を変えたら、ハンディと iPad でも変わるように。これから入れる注文から」
 *
 * メニュー設定で値段が変わると画面が読み直され（menu_items の Realtime・30秒ごとの読み直し）、
 * カートに入れ済みの商品も新しい値段で出す。注文したときの値段はサーバーがメニューから決める（addItem）ので、
 * ここは画面の表示を合わせるだけ。すでに伝票に入った明細（注文済み）の値段は変えない。
 *
 * 商品・選択肢が見つからない行はそのまま。何も変わらなければ同じ配列を返す（無駄に描き直さない）。
 */

export interface RepriceableLine {
  menuItemId: string;
  optionItemIds: string[];
  /** 選択肢の追加料金を含む単価 */
  unitPrice: number;
  /** レジで打った金額（¥0 の商品＝キャンセル料など）。入っていればメニューの値段ではなくこれを使う */
  openPrice?: number | null;
}

export function repriceLines<L extends RepriceableLine>(
  lines: L[],
  basePriceOf: (menuItemId: string) => number | undefined,
  optionPriceOf: (menuItemId: string, optionItemId: string) => number | undefined
): L[] {
  let changed = false;
  const next = lines.map((line) => {
    const base = line.openPrice != null ? line.openPrice : basePriceOf(line.menuItemId);
    if (base === undefined || !Number.isFinite(base)) return line;
    let extra = 0;
    for (const id of line.optionItemIds) {
      const price = optionPriceOf(line.menuItemId, id);
      if (price === undefined || !Number.isFinite(price)) return line;
      extra += price;
    }
    const unitPrice = base + extra;
    if (unitPrice === line.unitPrice) return line;
    changed = true;
    return { ...line, unitPrice };
  });
  return changed ? next : lines;
}

/** 選択肢グループ（商品ごと）から、選択肢の追加料金を引く関数を作る */
export function optionPriceLookup(
  optionGroupsByItem: Record<string, readonly { items: readonly { id: string; price: number | string | null }[] }[]>
): (menuItemId: string, optionItemId: string) => number | undefined {
  return (menuItemId, optionItemId) => {
    for (const group of optionGroupsByItem[menuItemId] ?? []) {
      const option = group.items.find((o) => o.id === optionItemId);
      if (option) return Number(option.price ?? 0);
    }
    return undefined;
  };
}
