/**
 * レジ（iPad）のログインの決め方（2026-09-23 要望）。
 *
 *   企業番号（6桁の数字・会社で1つ）   → どの会社か
 *   店舗ユーザー名（店舗ごと）          → どの店舗か
 *   レジ用パスワード（店舗ごと）        → 本人確認
 *   ＋ お店の回線（契約時に登録したIP） → 外からは入れない
 *
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

/** 店舗ユーザー名の形：小文字の英数字とハイフン、2〜32文字 */
const STORE_USER_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** 打ち間違いを吸収して比べられる形に直す（全角・大文字・空白） */
export function normalizeStoreUser(input: string): string {
  return input.normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();
}

export function isStoreUser(input: string): boolean {
  return STORE_USER_PATTERN.test(normalizeStoreUser(input));
}

/** 店舗名から店舗ユーザー名の候補を作る（運営が入れなかったとき用） */
export function suggestStoreUser(seed: string): string {
  const base = seed
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  if (STORE_USER_PATTERN.test(base)) return base;
  return `store-${Math.random().toString(36).slice(2, 8)}`;
}

export interface RegisterLoginStore {
  storeId: string;
  storeName: string;
  /** その店舗のレジ用パスワードと一致したか */
  passwordOk: boolean;
  /** 契約で回線を登録している店舗か */
  restricted: boolean;
  /** 契約で登録したお店の回線から来ているか */
  onNetwork: boolean;
}

export type RegisterLoginDecision =
  | { kind: 'ok'; storeId: string }
  | { kind: 'unknown_store' }
  | { kind: 'bad_password' }
  | { kind: 'off_network' };

/**
 * 店舗が見つかったあとの判定。
 * 回線 → パスワード の順に見る（外からはパスワードが合っているかも分からない）。
 */
export function decideRegisterLogin(store: RegisterLoginStore | null): RegisterLoginDecision {
  if (!store) return { kind: 'unknown_store' };
  if (store.restricted && !store.onNetwork) return { kind: 'off_network' };
  if (!store.passwordOk) return { kind: 'bad_password' };
  return { kind: 'ok', storeId: store.storeId };
}

export const REGISTER_LOGIN_MESSAGE = {
  unknownOrg: '企業番号が見つかりません。番号をご確認ください',
  badFormat: '企業番号は6桁の数字です（例: 184203）',
  unknownStore: '企業番号と店舗ユーザー名の組み合わせが見つかりません',
  badStoreUser: '店舗ユーザー名は半角の英数字とハイフンです',
  badPassword: 'レジ用パスワードが正しくありません',
  offNetwork: 'この端末はお店の回線ではありません。お店のWi-Fi・有線につないでから、もう一度お試しください',
  /** iPhone・iPad は プライベートリレー が入っていると回線が変わってしまう */
  offNetworkHint:
    'iPhone・iPad は「設定 > Apple ID > iCloud > プライベートリレー」と、Wi-Fi の「IPアドレスを追跡させない」を切ってください',
  noIp: '接続元が確認できませんでした。もう一度お試しください',
} as const;
