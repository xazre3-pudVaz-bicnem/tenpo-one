/**
 * 入出金の「買い物（経費）」まわりの純関数。
 * 2026-09-28 Ronnie：
 *  - 買い物先は企業の仕入先から選ぶ（ABC／五十音順）
 *  - 買い物で出金するときは「払った担当者」を必ず選ぶ
 *  - 持ち出した金額・買った物・お釣りを入れる。「ちょうど」ボタンでお釣り 0
 * レジからは実際に使った分（持出 − お釣り）だけが減るので、出金の金額は使った分で登録し、
 * 持出とお釣りは用途（purpose）の文に残す。
 */

/** 出金の買い物先（企業の仕入先） */
export interface EntryShop {
  id: string;
  name: string;
}

/** 買い物先の並び：英字は A→Z、日本語は五十音（読みがあれば読みで） */
export function sortShops<T extends { name: string; kana?: string | null }>(shops: T[]): T[] {
  const key = (s: T) => (s.kana?.trim() || s.name).trim();
  return [...shops].sort((a, b) => key(a).localeCompare(key(b), 'ja', { sensitivity: 'base', numeric: true }));
}

export interface ShoppingInput {
  /** 払った担当者（必須） */
  clerk: string;
  /** 買い物先（仕入先名。任意） */
  shop: string;
  /** 買った物（必須） */
  items: string;
  /** レジから持ち出した金額 */
  taken: number;
  /** 戻ってきたお釣り（ちょうど＝0） */
  change: number;
}

/** 実際に使った金額（＝レジから減る金額） */
export function shoppingSpent(taken: number, change: number): number {
  return taken - change;
}

/** 入力の確認。問題なければ null、あればメッセージ */
export function validateShopping(input: ShoppingInput): string | null {
  if (!input.clerk.trim()) return '買い物を払った担当者を選んでください';
  if (!input.items.trim()) return '買った物を入力してください';
  if (!Number.isInteger(input.taken) || input.taken <= 0) return '持ち出した金額は1円以上の整数で入力してください';
  if (!Number.isInteger(input.change) || input.change < 0) return 'お釣りは0円以上の整数で入力してください（ちょうどなら「ちょうど」）';
  if (input.change >= input.taken) return 'お釣りが持ち出した金額以上です。金額を確かめてください';
  return null;
}

const yenText = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

/**
 * 用途（purpose）の文。履歴では「：」の前が主表示、後ろが小さく出る（splitPurpose）。
 * 例：買い物：業務スーパー 野菜・肉｜担当 田中｜持出¥10,000 お釣り¥2,650
 */
export function buildShoppingPurpose(input: ShoppingInput): string {
  const what = [input.shop.trim(), input.items.trim()].filter(Boolean).join(' ');
  const money = input.change > 0 ? `持出${yenText(input.taken)} お釣り${yenText(input.change)}` : `持出${yenText(input.taken)} ちょうど`;
  return `買い物：${what}｜担当 ${input.clerk.trim()}｜${money}`;
}
