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
  /**
   * LAN（有線・Wi-Fi）のプリンターへ ESC/POS をそのまま送る（TCP 9100）。アプリが対応していれば入っている（iPad だけ）
   * （2026-10-16 Ronnie「EPSON と SII RP-F10 を LAN で」。ios/Shared/LanPrinters.swift）
   */
  lan?: NativeLan;
  /**
   * ネイティブのオーダー・会計画面（試験中）。アプリが対応していれば入っている（iPad だけ）
   * （2026-10-13 Ronnie「Airレジのように全部ネイティブ」。ios/Shared/NativeOrderView.swift）
   */
  nativePos?: NativeNativePos;
}

export interface NativeNativePos {
  /** いま ON か */
  enabled: boolean;
  /** ON/OFF を変える（この iPad だけ） */
  set: (on: boolean) => Promise<{ ok: boolean; enabled?: boolean }>;
}

export interface NativeBluetoothDevice {
  deviceId: string;
  name: string;
  maker: 'star' | 'epson' | 'sii' | 'escpos';
  via?: 'bluetooth' | 'usb';
  /** アプリがプリンターと判断した機械（Bluetooth LE でプリンターのサービスを出している）。古いアプリには無い */
  printer?: boolean | string;
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

export interface NativeLan {
  /**
   * バイト列（base64）を LAN のプリンター（host:port）へ送る。
   * code: unreachable（つながらない・送っていない）/ timeout_sent（送りかけて返事が無い＝出たか分からない）/ bad_host
   */
  print: (job: { host: string; port?: number; data: string }) => Promise<{ ok: boolean; code?: string }>;
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

/** ネイティブのオーダー・会計画面が使えるアプリか */
export function nativePos(): NativeNativePos | null {
  return nativeBridge()?.nativePos ?? null;
}

/** Bluetooth のレシートプリンターが使えるアプリか */
export function nativeBluetooth(): NativeBluetooth | null {
  return nativeBridge()?.bluetooth ?? null;
}

/** LAN のプリンターに送れるアプリか（iPad の TENPO ONE アプリ） */
export function nativeLan(): NativeLan | null {
  return nativeBridge()?.lan ?? null;
}
