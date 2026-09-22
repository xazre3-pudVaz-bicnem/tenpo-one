/**
 * CSVインポートの行検証ロジック。
 * クライアント（プレビュー画面）とサーバー（server action内での再検証）の双方から同じ関数を呼び出す。
 * サーバー側は「クライアントが検証済み」というフラグを一切信用せず、受け取った生の文字列から
 * ここで毎回イチから再計算する（半端な・不正なデータが登録されないようにするための唯一の防衛線）。
 */

import { MENU_ITEM_TYPE_OPTIONS } from './field-defs';

type Leaf<T> = { ok: true; value: T } | { ok: false; error: string };

function cell(values: Record<string, string>, key: string): string {
  return (values[key] ?? '').trim();
}

function requiredText(values: Record<string, string>, key: string, label: string): Leaf<string> {
  const raw = cell(values, key);
  if (!raw) return { ok: false, error: `${label}を入力してください` };
  return { ok: true, value: raw };
}

function optionalText(values: Record<string, string>, key: string): string | null {
  const raw = cell(values, key);
  return raw === '' ? null : raw;
}

function optionalInt(values: Record<string, string>, key: string, label: string): Leaf<number | null> {
  const raw = cell(values, key).replace(/,/g, '');
  if (raw === '') return { ok: true, value: null };
  if (!/^-?\d+$/.test(raw)) return { ok: false, error: `${label}は整数で入力してください` };
  return { ok: true, value: Number(raw) };
}

function optionalDecimal(values: Record<string, string>, key: string, label: string): Leaf<number | null> {
  const raw = cell(values, key).replace(/,/g, '');
  if (raw === '') return { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) {
    return { ok: false, error: `${label}は数値で入力してください` };
  }
  return { ok: true, value: Number(raw) };
}

/** 電話番号を数字のみへ正規化する。表記ゆれ（ハイフンあり/なし）で重複判定・登録内容がぶれないようにする */
function optionalPhone(values: Record<string, string>, key: string, label: string): Leaf<string | null> {
  const raw = cell(values, key);
  if (raw === '') return { ok: true, value: null };
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 9 || digits.length > 11) return { ok: false, error: `${label}の桁数が不正です（9〜11桁）` };
  return { ok: true, value: digits };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalEmail(values: Record<string, string>, key: string, label: string): Leaf<string | null> {
  const raw = cell(values, key);
  if (raw === '') return { ok: true, value: null };
  if (!EMAIL_RE.test(raw)) return { ok: false, error: `${label}の形式が不正です` };
  return { ok: true, value: raw };
}

/** YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD を受け付け、YYYY-MM-DD へ正規化する */
function optionalDate(values: Record<string, string>, key: string, label: string): Leaf<string | null> {
  const raw = cell(values, key);
  if (raw === '') return { ok: true, value: null };
  const normalized = raw.replace(/[./]/g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!m) return { ok: false, error: `${label}はYYYY-MM-DD形式で入力してください` };
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return { ok: false, error: `${label}の日付が不正です` };
  }
  return { ok: true, value: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` };
}

function optionalDayOfMonth(values: Record<string, string>, key: string, label: string): Leaf<number | null> {
  const r = optionalInt(values, key, label);
  if (!r.ok) return r;
  if (r.value !== null && (r.value < 1 || r.value > 31)) return { ok: false, error: `${label}は1〜31で入力してください` };
  return r;
}

// ---------------------------------------------------------------
// 商品 (menu_items)
// ---------------------------------------------------------------

export interface NormalizedMenuItemRow {
  categoryName: string | null;
  name: string;
  nameKana: string | null;
  nameEn: string | null;
  /** 新規登録には必須。登録済み商品の英語名・カナ更新だけなら null でよい */
  price: number | null;
  takeoutPrice: number | null;
  cost: number | null;
  itemType: 'food' | 'drink' | 'course' | 'option';
  /** コースの所要時間（分）。コース以外は常に null */
  durationMinutes: number | null;
}

export type ValidateResult<T> = { ok: true; data: T; dupKey: string | null } | { ok: false; errors: string[] };

export function validateMenuItemRow(values: Record<string, string>): ValidateResult<NormalizedMenuItemRow> {
  const errors: string[] = [];
  const name = requiredText(values, 'name', '商品名');
  if (!name.ok) errors.push(name.error);
  const price = optionalInt(values, 'price', '価格');
  if (!price.ok) errors.push(price.error);
  else if (price.value !== null && price.value < 0) errors.push('価格は0以上で入力してください');
  const takeoutPrice = optionalInt(values, 'takeoutPrice', 'テイクアウト価格');
  if (!takeoutPrice.ok) errors.push(takeoutPrice.error);
  const cost = optionalInt(values, 'cost', '原価');
  if (!cost.ok) errors.push(cost.error);

  const duration = optionalInt(values, 'durationMinutes', '所要時間（分）');
  if (!duration.ok) errors.push(duration.error);
  else if (duration.value !== null && (duration.value < 1 || duration.value > 1440)) {
    errors.push('所要時間（分）は1〜1440で入力してください');
  }

  const itemTypeRaw = cell(values, 'itemType');
  const itemTypeMatch = MENU_ITEM_TYPE_OPTIONS.find(
    (o) => o.value === itemTypeRaw.toLowerCase() || o.label === itemTypeRaw
  );
  if (itemTypeRaw !== '' && !itemTypeMatch) errors.push(`種別の値が不正です（フード/ドリンク/コース/オプション）`);

  if (errors.length > 0) return { ok: false, errors };

  const data: NormalizedMenuItemRow = {
    categoryName: optionalText(values, 'categoryName'),
    name: name.ok ? name.value : '',
    nameKana: optionalText(values, 'nameKana'),
    nameEn: optionalText(values, 'nameEn'),
    price: price.ok ? price.value : null,
    takeoutPrice: takeoutPrice.ok ? takeoutPrice.value : null,
    cost: cost.ok ? cost.value : null,
    itemType: (itemTypeMatch?.value as NormalizedMenuItemRow['itemType']) ?? 'food',
    durationMinutes: null,
  };
  // 所要時間はコースだけ（フード・ドリンクに入っていても無視する＝商品編集画面と同じ扱い）
  if (data.itemType === 'course' && duration.ok) data.durationMinutes = duration.value;
  return { ok: true, data, dupKey: menuItemDupKey(data.categoryName, data.name) };
}

/**
 * 商品の重複判定キー（「カテゴリ名|商品名」を小文字化）。
 * dinii 等と同じく、同じ商品名でもカテゴリが違えば別の商品として登録できる
 * （例: 「F. 枝豆」を A(F)・B(F) の両方の食べ放題カテゴリに置く）。同じカテゴリ内の同名だけを重複とみなす。
 */
export function menuItemDupKey(categoryName: string | null | undefined, name: string): string {
  return `${(categoryName ?? '').trim().toLowerCase()}|${name.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------
// 選択肢グループ (menu_option_groups) — セットの中身（カレーを選ぶ／ご飯かナン／ドリンク）
// ---------------------------------------------------------------

export interface NormalizedOptionGroupRow {
  groupName: string;
  optionName: string;
  optionNameEn: string | null;
  price: number;
  /** 行に指定が無ければ null（グループ作成時は既定: 必須・1〜1） */
  isRequired: boolean | null;
  minSelect: number | null;
  maxSelect: number | null;
  /** 「;」「；」「,」区切りの商品名 */
  targetItems: string[];
}

function optionalBool(values: Record<string, string>, key: string): boolean | null {
  const raw = cell(values, key).toLowerCase();
  if (raw === '') return null;
  if (['1', 'true', 'yes', 'y', 'はい', '必須', '○', '◯', 'o'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'いいえ', '任意', '×', 'x', '-'].includes(raw)) return false;
  return null;
}

export function validateOptionGroupRow(values: Record<string, string>): ValidateResult<NormalizedOptionGroupRow> {
  const errors: string[] = [];
  const group = requiredText(values, 'groupName', 'グループ名');
  if (!group.ok) errors.push(group.error);
  // 選択肢名が空でも「対象商品」があれば、既存グループを商品に付けるだけの行として受け付ける
  const optionText = optionalText(values, 'optionName');
  const targets = cell(values, 'targetItems');
  if (!optionText && !targets) errors.push('選択肢名（または対象商品）を入力してください');
  const price = optionalInt(values, 'price', '追加料金');
  if (!price.ok) errors.push(price.error);
  else if (price.value !== null && price.value < 0) errors.push('追加料金は0以上で入力してください');
  const min = optionalInt(values, 'minSelect', '最小');
  if (!min.ok) errors.push(min.error);
  const max = optionalInt(values, 'maxSelect', '最大');
  if (!max.ok) errors.push(max.error);
  // 最大0は「1つも選べないグループ」になってしまい、登録時にDBの制約で弾かれる
  else if (max.value !== null && max.value < 1) errors.push('最大は1以上で入力してください');
  if (min.ok && min.value !== null && min.value < 0) errors.push('最小は0以上で入力してください');
  if (min.ok && max.ok && min.value !== null && max.value !== null && min.value > max.value) {
    errors.push('最小は最大以下にしてください');
  }
  if (errors.length > 0) return { ok: false, errors };

  const data: NormalizedOptionGroupRow = {
    groupName: group.ok ? group.value : '',
    optionName: optionText ?? '',
    optionNameEn: optionalText(values, 'optionNameEn'),
    price: price.ok && price.value !== null ? price.value : 0,
    isRequired: optionalBool(values, 'isRequired'),
    minSelect: min.ok ? min.value : null,
    maxSelect: max.ok ? max.value : null,
    targetItems: cell(values, 'targetItems')
      .split(/[;；,、]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
  // 紐付けだけの行は重複判定しない（同じグループを何行にも書けるように）
  return { ok: true, data, dupKey: data.optionName ? `${data.groupName.toLowerCase()}|${data.optionName.toLowerCase()}` : null };
}

// ---------------------------------------------------------------
// 顧客 (customers)
// ---------------------------------------------------------------

export interface NormalizedCustomerRow {
  name: string;
  nameKana: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  allergyNote: string | null;
}

export function validateCustomerRow(values: Record<string, string>): ValidateResult<NormalizedCustomerRow> {
  const errors: string[] = [];
  const name = requiredText(values, 'name', '名前');
  if (!name.ok) errors.push(name.error);
  const phone = optionalPhone(values, 'phone', '電話番号');
  if (!phone.ok) errors.push(phone.error);
  const email = optionalEmail(values, 'email', 'メールアドレス');
  if (!email.ok) errors.push(email.error);
  const birthday = optionalDate(values, 'birthday', '誕生日');
  if (!birthday.ok) errors.push(birthday.error);

  if (errors.length > 0) return { ok: false, errors };

  const data: NormalizedCustomerRow = {
    name: name.ok ? name.value : '',
    nameKana: optionalText(values, 'nameKana'),
    phone: phone.ok ? phone.value : null,
    email: email.ok ? email.value : null,
    birthday: birthday.ok ? birthday.value : null,
    allergyNote: optionalText(values, 'allergyNote'),
  };
  // 電話番号がない行は重複判定の対象にできない（=常に登録対象）
  return { ok: true, data, dupKey: data.phone };
}

// ---------------------------------------------------------------
// 仕入先 (vendors)
// ---------------------------------------------------------------

export interface NormalizedVendorRow {
  name: string;
  nameKana: string | null;
  phone: string | null;
  email: string | null;
  closingDay: number | null;
  paymentDay: number | null;
}

export function validateVendorRow(values: Record<string, string>): ValidateResult<NormalizedVendorRow> {
  const errors: string[] = [];
  const name = requiredText(values, 'name', '仕入先名');
  if (!name.ok) errors.push(name.error);
  const phone = optionalPhone(values, 'phone', '電話番号');
  if (!phone.ok) errors.push(phone.error);
  const email = optionalEmail(values, 'email', 'メールアドレス');
  if (!email.ok) errors.push(email.error);
  const closingDay = optionalDayOfMonth(values, 'closingDay', '締め日');
  if (!closingDay.ok) errors.push(closingDay.error);
  const paymentDay = optionalDayOfMonth(values, 'paymentDay', '支払日');
  if (!paymentDay.ok) errors.push(paymentDay.error);

  if (errors.length > 0) return { ok: false, errors };

  const data: NormalizedVendorRow = {
    name: name.ok ? name.value : '',
    nameKana: optionalText(values, 'nameKana'),
    phone: phone.ok ? phone.value : null,
    email: email.ok ? email.value : null,
    closingDay: closingDay.ok ? closingDay.value : null,
    paymentDay: paymentDay.ok ? paymentDay.value : null,
  };
  return { ok: true, data, dupKey: data.name.toLowerCase() };
}

// ---------------------------------------------------------------
// 在庫品目 (inventory_items)
// ---------------------------------------------------------------

export interface NormalizedInventoryItemRow {
  name: string;
  itemKind: 'ingredient' | 'supply' | 'product';
  unit: string;
  currentQuantity: number;
  reorderPoint: number | null;
  avgCost: number | null;
  purchaseUnit: string | null;
  purchaseToStockFactor: number;
}

const INVENTORY_ITEM_KINDS = ['ingredient', 'supply', 'product'] as const;
const INVENTORY_ITEM_KIND_LABELS: Record<(typeof INVENTORY_ITEM_KINDS)[number], string> = {
  ingredient: '食材',
  supply: '備品・消耗品',
  product: '商品（販売連動）',
};

export function validateInventoryItemRow(values: Record<string, string>): ValidateResult<NormalizedInventoryItemRow> {
  const errors: string[] = [];
  const name = requiredText(values, 'name', '品目名');
  if (!name.ok) errors.push(name.error);
  const unit = requiredText(values, 'unit', '単位');
  if (!unit.ok) errors.push(unit.error);
  const currentQuantity = optionalDecimal(values, 'currentQuantity', '現在庫');
  if (!currentQuantity.ok) errors.push(currentQuantity.error);
  const reorderPoint = optionalDecimal(values, 'reorderPoint', '発注点');
  if (!reorderPoint.ok) errors.push(reorderPoint.error);
  const avgCost = optionalInt(values, 'avgCost', '平均単価');
  if (!avgCost.ok) errors.push(avgCost.error);
  const purchaseToStockFactor = optionalDecimal(values, 'purchaseToStockFactor', '変換係数');
  if (!purchaseToStockFactor.ok) errors.push(purchaseToStockFactor.error);
  else if (purchaseToStockFactor.value !== null && purchaseToStockFactor.value <= 0) {
    errors.push('変換係数は正の数で入力してください');
  }

  const itemKindRaw = cell(values, 'itemKind');
  const itemKindMatch = INVENTORY_ITEM_KINDS.find(
    (k) => k === itemKindRaw.toLowerCase() || INVENTORY_ITEM_KIND_LABELS[k] === itemKindRaw
  );
  if (itemKindRaw !== '' && !itemKindMatch) errors.push('種別の値が不正です（食材/備品・消耗品/商品（販売連動））');

  if (errors.length > 0) return { ok: false, errors };

  const data: NormalizedInventoryItemRow = {
    name: name.ok ? name.value : '',
    itemKind: itemKindMatch ?? 'ingredient',
    unit: unit.ok ? unit.value : '個',
    currentQuantity: currentQuantity.ok && currentQuantity.value !== null ? currentQuantity.value : 0,
    reorderPoint: reorderPoint.ok ? reorderPoint.value : null,
    avgCost: avgCost.ok ? avgCost.value : null,
    purchaseUnit: optionalText(values, 'purchaseUnit'),
    purchaseToStockFactor: purchaseToStockFactor.ok && purchaseToStockFactor.value !== null ? purchaseToStockFactor.value : 1,
  };
  return { ok: true, data, dupKey: data.name.toLowerCase() };
}
