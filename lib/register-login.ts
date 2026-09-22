/**
 * レジ（iPad）のログインの決め方（2026-09-23 要望）。
 *
 *   企業番号 → 会社が決まる
 *   接続元IP → その会社の中で、どの店舗のレジかが決まる（契約時に登録したお店の回線）
 *   レジ用パスワード（店舗ごと） → 本人確認
 *
 * 同じ回線に同じ会社の店舗が2つ以上ある場合だけ、店舗を選んでもらう。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export interface RegisterLoginCandidate {
  storeId: string;
  storeName: string;
  /** 契約で登録したお店の回線から来ているか */
  onNetwork: boolean;
  /** その店舗のレジ用パスワードと一致したか */
  passwordOk: boolean;
}

export type RegisterLoginDecision =
  | { kind: 'ok'; storeId: string }
  | { kind: 'choose'; stores: { id: string; name: string }[] }
  | { kind: 'no_network' }
  | { kind: 'bad_password' };

export function decideRegisterLogin(
  candidates: RegisterLoginCandidate[],
  wantedStoreId?: string | null
): RegisterLoginDecision {
  const onNetwork = candidates.filter((c) => c.onNetwork);
  if (onNetwork.length === 0) return { kind: 'no_network' };

  const scope = wantedStoreId ? onNetwork.filter((c) => c.storeId === wantedStoreId) : onNetwork;
  if (scope.length === 0) return { kind: 'no_network' };

  const matched = scope.filter((c) => c.passwordOk);
  if (matched.length === 0) return { kind: 'bad_password' };
  if (matched.length === 1) return { kind: 'ok', storeId: matched[0].storeId };
  return { kind: 'choose', stores: matched.map((c) => ({ id: c.storeId, name: c.storeName })) };
}

export const REGISTER_LOGIN_MESSAGE = {
  unknownOrg: '企業番号が見つかりません。番号をご確認ください',
  badFormat: '企業番号は t1 ではじまる7文字です（例: t184203）',
  noNetwork:
    'この回線は、この会社の店舗として登録されていません。お店のWi-Fi・有線につないでから、もう一度お試しください',
  badPassword: 'レジ用パスワードが正しくありません',
  noIp: '接続元が確認できませんでした。もう一度お試しください',
} as const;
