/**
 * QRオーダー画面の純粋な計算。
 * 副作用・DOM・日時取得を持たないので tests/qr-order.test.ts から直接検証できる。
 */
import {
  cartLineUnitPrice,
  sameModifiers,
  type CartLine,
  type QrMenuCategory,
  type QrMenuItem,
  type QrMenuModifier,
  type QrServiceCall,
  type ServiceCallKind,
} from './types';

/** 1行あたりの数量上限。サーバー側 create_qr_order の INVALID_QUANTITY 判定（1〜20）と揃える */
export const MAX_LINE_QUANTITY = 20;

/** カテゴリタブの先頭に差し込む「おすすめ」擬似カテゴリのID */
export const RECOMMENDED_TAB_ID = '__recommended__';

/** 未送信カートの点数 */
export function cartCount(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

/** 未送信カートの金額。送信済みの履歴合計とは混ぜない */
export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + cartLineUnitPrice(line) * line.quantity, 0);
}

/**
 * カートに1行足す。同じ商品・同じメモ・同じオプションなら数量を合算する。
 * key はランダム生成を避けるため呼び出し側から渡す（描画中に値が変わらないようにするため）。
 */
export function addCartLine(
  cart: CartLine[],
  item: Pick<QrMenuItem, 'id' | 'name' | 'price'>,
  quantity: number,
  memo: string,
  modifiers: QrMenuModifier[],
  key: string
): CartLine[] {
  const index = cart.findIndex(
    (line) => line.menuItemId === item.id && line.memo === memo && sameModifiers(line.modifiers, modifiers)
  );
  if (index >= 0) {
    const next = [...cart];
    next[index] = {
      ...next[index],
      quantity: Math.min(MAX_LINE_QUANTITY, next[index].quantity + quantity),
    };
    return next;
  }
  return [
    ...cart,
    {
      key,
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: Math.min(MAX_LINE_QUANTITY, quantity),
      memo,
      modifiers,
    },
  ];
}

/** 数量の増減。0になった行は削除する（上限は MAX_LINE_QUANTITY） */
export function changeCartQuantity(cart: CartLine[], key: string, delta: number): CartLine[] {
  return cart
    .map((line) =>
      line.key === key
        ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + delta) }
        : line
    )
    .filter((line) => line.quantity > 0);
}

/** 行を削除する */
export function removeCartLine(cart: CartLine[], key: string): CartLine[] {
  return cart.filter((line) => line.key !== key);
}

/** その商品がいまカートに何点入っているか（メニューカードの「＋」に出す数字） */
export function itemQuantityInCart(cart: CartLine[], menuItemId: string): number {
  return cart.reduce((sum, line) => (line.menuItemId === menuItemId ? sum + line.quantity : sum), 0);
}

/**
 * メニューブックのページ（サーバーで決めたタブのまとめ方）。categoryIds の中身は get_qr_menu の結果から引く。
 * plan は「プランのときだけ」のカテゴリだけのページ（飲み放題・コースの卓では先頭に来る）。
 */
export interface QrMenuPage {
  key: string;
  name: string | null;
  categoryIds: string[];
  plan?: boolean;
}

/** メニューのタブ1つ。sections はタブの中のカテゴリ（複数なら見出しを付けて並べる） */
export interface QrMenuTab {
  id: string;
  /** 店長が付けたページの名前、または「おすすめ」。null はカテゴリ名をつなげて出す */
  name: string | null;
  sections: QrMenuCategory[];
  itemCount: number;
  recommended: boolean;
}

/**
 * 表示するタブ。
 * - メニューブックのページごとに1タブ（SOUP・APPETIZER・SALAD など）。ページが無ければ1カテゴリ1タブ
 * - 販売時間外・非公開などで商品が0件のカテゴリ・タブは出さない
 * - おすすめ商品があるときだけ「おすすめ」タブを足す（飲み放題・コースのページの後、ほかのタブの前）
 */
export function menuTabs(
  categories: QrMenuCategory[],
  pages: QrMenuPage[] | null | undefined,
  recommendedLabel: string
): QrMenuTab[] {
  const withItems = categories.filter((category) => category.items.length > 0);
  const byId = new Map(withItems.map((c) => [c.id, c]));
  const tab = (id: string, name: string | null, sections: QrMenuCategory[]): QrMenuTab => ({
    id,
    name,
    sections,
    itemCount: sections.reduce((n, c) => n + c.items.length, 0),
    recommended: false,
  });

  const tabs: (QrMenuTab & { plan: boolean })[] = [];
  const used = new Set<string>();
  for (const page of pages ?? []) {
    const sections = page.categoryIds
      .map((id) => byId.get(id))
      .filter((c): c is QrMenuCategory => !!c && !used.has(c.id));
    if (sections.length === 0) continue;
    for (const c of sections) used.add(c.id);
    tabs.push({ ...tab(`page:${page.key}`, page.name, sections), plan: !!page.plan });
  }
  // ページに入っていないカテゴリ（ページの情報が無いときは全部）は1カテゴリ1タブで後ろに足す
  for (const c of withItems) {
    if (!used.has(c.id)) tabs.push({ ...tab(c.id, null, [c]), plan: false });
  }

  const recommended = withItems.flatMap((category) => category.items.filter((item) => item.is_recommended));
  const plain: QrMenuTab[] = tabs.map((t) => ({
    id: t.id,
    name: t.name,
    sections: t.sections,
    itemCount: t.itemCount,
    recommended: t.recommended,
  }));
  if (recommended.length === 0) return plain;
  const recommendedTab: QrMenuTab = {
    id: RECOMMENDED_TAB_ID,
    name: recommendedLabel,
    sections: [{ id: RECOMMENDED_TAB_ID, name: recommendedLabel, name_en: null, color: null, items: recommended }],
    itemCount: recommended.length,
    recommended: true,
  };
  const firstNonPlan = tabs.findIndex((t) => !t.plan);
  const at = firstNonPlan < 0 ? tabs.length : firstNonPlan;
  return [...plain.slice(0, at), recommendedTab, ...plain.slice(at)];
}

/** 未対応の呼び出しのうち、指定種類のもの（なければ null）。会計希望と一般呼び出しは別種類 */
export function openServiceCall(calls: QrServiceCall[], kind: ServiceCallKind): QrServiceCall | null {
  return calls.find((call) => call.kind === kind) ?? null;
}

/** get_qr_service_calls の戻り値を検証して配列にする（想定外の形は空として扱う） */
export function parseServiceCalls(raw: unknown): QrServiceCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { kind, created_at: createdAt } = entry as { kind?: unknown; created_at?: unknown };
    if (kind !== 'staff' && kind !== 'checkout') return [];
    return [{ kind, created_at: typeof createdAt === 'string' ? createdAt : '' }];
  });
}
