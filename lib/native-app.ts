/**
 * TENPO ONE の iPhone/iPad アプリ（ios/）の中で動いているときに使える機能（window.TenpoNative）。
 * ブラウザ（Safari・Chrome）では undefined。呼ぶ側は必ず「無ければ今まで通り」にする。
 */
export interface TenpoNativeBridge {
  isApp: true;
  /** アプリの種類：regi（iPad）/ handy（iPhone） */
  app: 'regi' | 'handy';
  /** いまのモード：regi / handy / owner */
  mode: 'regi' | 'handy' | 'owner';
  version: string;
  /** 本当に振動できる端末（iPhone）か */
  canVibrate: boolean;
  haptic: (pattern?: number[]) => boolean;
  scanQR: () => void;
  changeMode: () => void;
  requestPush: () => void;
}

declare global {
  interface Window {
    TenpoNative?: TenpoNativeBridge;
  }
}

export function nativeBridge(): TenpoNativeBridge | null {
  if (typeof window === 'undefined') return null;
  return window.TenpoNative?.isApp ? window.TenpoNative : null;
}
