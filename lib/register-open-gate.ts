/**
 * レジ端末（iPad）の「朝いちばんの開局」（2026-09-28 Ronnie）：
 *   レジ精算を印刷したら閉店＝ログアウト。翌日ログインしたら、まずレジの中の現金を数えて合計を入れる画面を出す。
 *   その金額が今日の釣銭準備金（レジオープン時現金）になり、レジ精算の現金の計算はここから始まる。
 * 純粋関数（テスト対象）。DB の読み書きは呼ぶ側。
 */

export interface OpenGateInput {
  /** レジ端末（/register-login でログインした iPad）か */
  isRegisterDevice: boolean;
  /** いま見ている店舗があるか */
  hasStore: boolean;
  /** この店舗に開局中（status=open）のレジセッションがあるか */
  hasOpenSession: boolean;
  /** この店舗にレジ（registers）が1台でもあるか */
  hasRegister: boolean;
}

/** ログイン直後のホームから開局画面へ送るか */
export function shouldGoToOpenRegister(input: OpenGateInput): boolean {
  return input.isRegisterDevice && input.hasStore && input.hasRegister && !input.hasOpenSession;
}

/** 開局画面そのものは、すでに開局していれば戻す（どの端末でも） */
export function openPageRedirect(input: { hasOpenSession: boolean }): string | null {
  return input.hasOpenSession ? '/app/dashboard' : null;
}
