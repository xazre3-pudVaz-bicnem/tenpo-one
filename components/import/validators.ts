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
  price: number;
  takeoutPrice: number | null;
  cost: number | null;
  itemType: 'food' | 'drink' | 'course' | 'option';
}

export type ValidateResult<T> = { ok: true; data: T; dupKey: string | null } | { ok: false; errors: string[] };

export function validateMenuItemRow(values: Record<string, string>): ValidateResult<NormalizedMenuItemRow> {
  const errors: string[] = [];
  const name = requiredText(values, 'name', '商品名');
  if (!name.ok) errors.push(name.error);
  const price = optionalInt(values, 'price', '価格');
  if (!price.ok) errors.push(price.error);
  else if (price.value === null) errors.push('価格を入力してください');
  else if (price.value < 0) errors.push('価格は0以上で入力してください');
  const takeoutPrice = optionalInt(values, 'takeoutPrice', 'テイクアウト価格');
  if (!takeoutPrice.ok) errors.push(takeoutPrice.error);
  const cost = optionalInt(values, 'cost', '原価');
  if (!cost.ok) errors.push(cost.error);

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
    price: price.ok && price.value !== null ? price.value : 0,
    takeoutPrice: takeoutPrice.ok ? takeoutPrice.value : null,
    cost: cost.ok ? cost.value : null,
    itemType: (itemTypeMatch?.value as NormalizedMenuItemRow['itemType']) ?? 'food',
  };
  return { ok: true, data, dupKey: data.name.toLowerCase() };
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
