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
  /**
   * iPad と Bluetooth でつないだレシートプリンター（Star mC-Print3 / EPSON）。アプリが対応していれば入っている
   * （2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth」。ios/Shared/BluetoothPrinters.swift）
   */
  bluetooth?: NativeBluetooth;
}

export interface NativeBluetoothDevice {
  deviceId: string;
  name: string;
  maker: 'star' | 'epson' | 'sii' | 'escpos';
  via?: 'bluetooth' | 'usb';
}

export interface NativeBluetooth {
  /** 近くの Bluetooth プリンターを探す（iPad の設定でペアリング済みのもの） */
  discover: (
    maker: 'star' | 'epson' | 'sii' | 'escpos' | 'all'
  ) => Promise<{ ok: boolean; devices?: NativeBluetoothDevice[]; code?: string }>;
  /** バイト列（base64）をそのまま送る。Star＝StarPRNT、それ以外＝ESC/POS */
  print: (job: {
    deviceId: string;
    maker: 'star' | 'epson' | 'sii' | 'escpos';
    via?: 'bluetooth' | 'usb';
    data: string;
  }) => Promise<{ ok: boolean; code?: string }>;
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

/** Bluetooth のレシートプリンターが使えるアプリか */
export function nativeBluetooth(): NativeBluetooth | null {
  return nativeBridge()?.bluetooth ?? null;
}
