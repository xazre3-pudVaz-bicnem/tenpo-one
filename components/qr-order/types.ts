/**
 * QRオーダー（/order/[storeSlug]/[tableToken]）で使う型。
 * RPC get_qr_menu / create_qr_order / get_qr_order_status の戻り値と一致させる。
 */

export interface QrMenuModifier {
  id: string;
  name: string;
  price: number;
  /** 英語名（選択肢グループの選択肢だけ。English のとき表示に使う） */
  name_en?: string | null;
  /** 'option' = 設定 > メニュー選択肢（グループ）の選択肢。無印は古い menu_modifiers */
  kind?: 'option';
}

/** 選択肢グループ（レジ・ハンディと同じ menu_option_groups。get_qr_menu の option_groups） */
export interface QrOptionGroup {
  id: string;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  items: { id: string; name: string; name_en: string | null; price: number }[];
}

export interface QrMenuItem {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  price: number;
  is_sold_out: boolean;
  is_recommended: boolean;
  allergy_info: string | null;
  /** 内部Storageの相対パスの場合がある。anonからは参照できないため、http(s)絶対URLの場合のみ表示する */
  image_path: string | null;
  modifiers: QrMenuModifier[];
  /** 選択肢グループ（古いデータベースでは無い） */
  option_groups?: QrOptionGroup[] | null;
}

/** 商品に選択肢（グループ・古い modifiers）があるか（あればタップでシートを開く） */
export function hasOptions(item: Pick<QrMenuItem, 'modifiers' | 'option_groups'>): boolean {
  return item.modifiers.length > 0 || (item.option_groups ?? []).some((g) => g.items.length > 0);
}

/** 必須の選択肢が選ばれているか・各グループの最大を超えていないか（レジの resolveOptionSelection と同じ判定） */
export function optionSelectionError(groups: QrOptionGroup[] | null | undefined, selectedIds: readonly string[]): string | null {
  for (const g of groups ?? []) {
    if (g.items.length === 0) continue;
    const n = g.items.filter((o) => selectedIds.includes(o.id)).length;
    const min = g.is_required ? Math.max(1, g.min_select) : g.min_select;
    if (n < min) return g.name;
    if (n > g.max_select) return g.name;
  }
  return null;
}

export interface QrMenuCategory {
  id: string;
  name: string;
  name_en: string | null;
  color: string | null;
  items: QrMenuItem[];
}

/** image_path が匿名ユーザーから見える絶対URLかどうか（内部Storageパスは非表示にする） */
export function isPublicImageUrl(path: string | null | undefined): path is string {
  return !!path && /^https?:\/\//i.test(path);
}

export interface QrMenuData {
  store_name: string;
  table_name: string;
  categories: QrMenuCategory[];
}

/** 呼び出しの種類。staff=スタッフ呼び出し、checkout=お会計希望（別種類として扱う） */
export type ServiceCallKind = 'staff' | 'checkout';

/** get_qr_service_calls が返す未対応の呼び出し1件。created_at は 'HH:MM'（JST） */
export interface QrServiceCall {
  kind: ServiceCallKind;
  created_at: string;
}

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

export interface QrOrderStatusItem {
  name: string;
  quantity: number;
  kitchen_status: KitchenStatus;
  ordered_at: string; // 'HH:MM'（JST）
}

export interface QrOrderStatus {
  table_name: string;
  items: QrOrderStatusItem[];
  total: number;
}

/** カート内の1行。同一商品でもメモ・選択オプションが異なれば別行として扱う */
export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  memo: string;
  modifiers: QrMenuModifier[];
}

/** カート行の単価（本体価格＋オプション合計）。サーバー側(create_qr_order)の line_total スナップショットと同じ計算式にすること */
export function cartLineUnitPrice(line: Pick<CartLine, 'price' | 'modifiers'>): number {
  return line.price + line.modifiers.reduce((sum, m) => sum + m.price, 0);
}

/** 選択済みオプションの組み合わせが同一か（順不同で比較） */
export function sameModifiers(a: QrMenuModifier[], b: QrMenuModifier[]): boolean {
  if (a.length !== b.length) return false;
  const idsA = [...a.map((m) => m.id)].sort();
  const idsB = [...b.map((m) => m.id)].sort();
  return idsA.every((id, i) => id === idsB[i]);
}

export const KITCHEN_STATUS_LABELS: Record<KitchenStatus, string> = {
  pending: '未着手',
  preparing: '調理中',
  ready: '完成',
  served: '提供済',
};

const QR_ERROR_MESSAGES: Record<string, string> = {
  TABLE_NOT_FOUND: 'テーブル情報を確認できませんでした。QRコードを読み取り直してください。',
  EMPTY_ORDER: 'カートに商品がありません。',
  TOO_MANY_ITEMS: '一度に注文できる品数の上限を超えています。数回に分けてご注文ください。',
  RATE_LIMITED: '短時間にご注文が集中しました。少し時間をおいてから再度お試しください。',
  INVALID_QUANTITY: '数量の指定が正しくありません。',
  ITEM_UNAVAILABLE: '一部の商品が販売終了・品切れになりました。内容をご確認のうえ再度お試しください。',
  OPTION_REQUIRED: '選択肢（ナン・ライス、辛さ、ドリンクなど）が選ばれていない商品があります。カートから商品を入れ直してください。',
  INVALID_MODIFIER: '選択肢の内容が変わりました。カートから商品を入れ直してください。',
  TOO_MANY_MODIFIERS: '選択肢の数が多すぎます。',
  NOT_IN_SERVICE: 'ご利用の受付が終了しています。スタッフにお声がけください。',
};

/** Postgres の RAISE EXCEPTION 文言から先頭のコードだけを取り出す */
function errorCode(raw: string): string {
  return raw.split(':')[0].trim();
}

/** RPC のエラーメッセージ（Postgres RAISE EXCEPTION の文言）を日本語表示に変換する */
export function qrOrderErrorMessage(raw: string | null | undefined): string {
  if (!raw) return '通信エラーが発生しました。時間をおいて再度お試しください。';
  return QR_ERROR_MESSAGES[errorCode(raw)] ?? '注文の送信に失敗しました。時間をおいて再度お試しください。';
}

const QR_CALL_ERROR_MESSAGES: Record<string, string> = {
  NOT_IN_SERVICE: 'ご利用の受付が終了しています。スタッフにお声がけください。',
  RATE_LIMITED: '呼び出しが続けて送信されました。少しお待ちください。',
  TABLE_NOT_FOUND: 'テーブル情報を確認できませんでした。QRコードを読み取り直してください。',
  INVALID_KIND: '呼び出しの種類が正しくありません。スタッフにお声がけください。',
};

/** create_qr_service_call のエラーを日本語表示に変換する（通信失敗も成功に見せない） */
export function qrServiceCallErrorMessage(raw: string | null | undefined): string {
  if (!raw) return '呼び出しを送信できませんでした。お手数ですがスタッフに直接お声がけください。';
  return (
    QR_CALL_ERROR_MESSAGES[errorCode(raw)] ??
    '呼び出しを送信できませんでした。お手数ですがスタッフに直接お声がけください。'
  );
}
