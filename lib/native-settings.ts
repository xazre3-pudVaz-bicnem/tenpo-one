import { isUuid } from '@/lib/native-pos';
import { BT_MAKERS, type BtMaker } from '@/lib/direct-print';

/**
 * iPad アプリのネイティブの「設定」（Web の /app/pos/settings「レジの設定」と /app/settings の入口。2026-10-24 Ronnie「iOS プリンター＋設定」）。
 *   読み込みは GET /api/app/v1/pos?part=settings（このiPadのプリンター・レシートの出し先・LAN・Wi-Fi・機種の一覧・設定の一覧）。
 *   操作は POST { type: 'settingsPrinterSelect' | 'settingsPrinterAdd' | 'settingsPrinterSave' }（中身は Web の
 *   app/app/pos/device-printer-actions.ts と同じ Server Action）。
 *   「この iPad から送る」などの端末ごとの ON/OFF は iPad の中（UserDefaults）に持ち、Web の localStorage と同じ形で同期する。
 */
export type NativeSettingsAction =
  /** このiPadのレシートの出し先（null＝おまかせ・店の既定）。cookie に入る */
  | { type: 'settingsPrinterSelect'; printerId: string | null }
  /** iPad で見つけた Bluetooth・USB のレシートプリンターを店のプリンターにする（printerId があればその行を使う） */
  | {
      type: 'settingsPrinterAdd';
      printerId: string | null;
      name: string | null;
      maker: BtMaker;
      via: 'bluetooth' | 'usb';
      modelId: string | null;
      paperWidthMm: 58 | 80 | null;
      autoPrint: boolean | null;
      drawerKick: boolean | null;
    }
  /** このiPadのプリンターの機種・紙幅・自動印刷・ドロアの保存 */
  | {
      type: 'settingsPrinterSave';
      printerId: string;
      modelId: string | null;
      paperWidthMm: 58 | 80 | null;
      autoPrint: boolean | null;
      drawerKick: boolean | null;
    };
export type NativeSettingsActionType = NativeSettingsAction['type'];
export const NATIVE_SETTINGS_ACTION_TYPES: readonly NativeSettingsActionType[] = ['settingsPrinterSelect', 'settingsPrinterAdd', 'settingsPrinterSave'];

export function isNativeSettingsActionType(v: unknown): v is NativeSettingsActionType {
  return typeof v === 'string' && (NATIVE_SETTINGS_ACTION_TYPES as readonly string[]).includes(v);
}

const optBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const optPaper = (v: unknown): 58 | 80 | null => (v === 58 || v === 80 ? v : null);
const optModel = (v: unknown): string | null | false =>
  v == null || v === '' ? null : typeof v === 'string' && /^[a-z0-9-]{1,60}$/.test(v) ? v : false;

export function parseNativeSettingsAction(raw: unknown): { ok: true; action: NativeSettingsAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type === 'settingsPrinterSelect') {
    if (b.printerId == null || b.printerId === '') return { ok: true, action: { type: 'settingsPrinterSelect', printerId: null } };
    if (!isUuid(b.printerId)) return { ok: false, error: 'プリンターが見つかりません' };
    return { ok: true, action: { type: 'settingsPrinterSelect', printerId: b.printerId } };
  }
  if (b.type === 'settingsPrinterAdd') {
    if (!BT_MAKERS.includes(b.maker as BtMaker)) return { ok: false, error: 'プリンターの種類が分かりません' };
    const modelId = optModel(b.modelId);
    if (modelId === false) return { ok: false, error: 'プリンターの機種が分かりません' };
    const printerId = b.printerId == null || b.printerId === '' ? null : isUuid(b.printerId) ? b.printerId : false;
    if (printerId === false) return { ok: false, error: 'プリンターが見つかりません' };
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) || null : null;
    return {
      ok: true,
      action: {
        type: 'settingsPrinterAdd',
        printerId,
        name,
        maker: b.maker as BtMaker,
        via: b.via === 'usb' ? 'usb' : 'bluetooth',
        modelId,
        paperWidthMm: optPaper(b.paperWidthMm),
        autoPrint: optBool(b.autoPrint),
        drawerKick: optBool(b.drawerKick),
      },
    };
  }
  if (b.type === 'settingsPrinterSave') {
    if (!isUuid(b.printerId)) return { ok: false, error: 'プリンターが見つかりません' };
    const modelId = optModel(b.modelId);
    if (modelId === false) return { ok: false, error: 'プリンターの機種が分かりません' };
    return {
      ok: true,
      action: {
        type: 'settingsPrinterSave',
        printerId: b.printerId,
        modelId,
        paperWidthMm: optPaper(b.paperWidthMm),
        autoPrint: optBool(b.autoPrint),
        drawerKick: optBool(b.drawerKick),
      },
    };
  }
  return { ok: false, error: '内容が正しくありません' };
}

/** ネイティブの設定画面に出すプリンター1台（Web の DevicePrinterOption と同じ＋どう届くか） */
export interface NativeSettingsPrinter {
  id: string;
  name: string;
  maker: string | null;
  /** iPad とつなぐときの種類（star / epson / sii / escpos） */
  btMaker: BtMaker | null;
  model: string | null;
  usage: string;
  usageLabel: string;
  billSlips: boolean;
  ip: string | null;
  /** LAN の送り先（IP が入っていて、この iPad から送れるものだけ） */
  lanHost: string | null;
  lanPort: number | null;
  enabled: boolean;
  connection: string | null;
  /** cloudprnt / sdp / ipad-lan / ipad / browser（lib/direct-print.ts の printerDeliveryOf） */
  delivery: string;
  paperWidthMm: 58 | 80;
  autoPrint: boolean;
  drawerKick: boolean;
  /** この iPad から LAN で送れる（Star 以外・お店の中の IP） */
  lanRelay: boolean;
  /** Wi-Fi で直接印刷できる（EPSON・お店の中の IP） */
  wifiDirect: boolean;
  /** Bluetooth・USB で iPad とつなぐ行 */
  deviceLink: boolean;
}

export interface NativeSettingsModel {
  id: string;
  maker: string;
  makerLabel: string;
  name: string;
  paper: 58 | 80;
  drawer: boolean;
  mobile: boolean;
  ready: boolean;
}

export interface NativeSettingsLink {
  id: string;
  title: string;
  description: string;
  url: string;
  allowed: boolean;
  hint: string | null;
}

export interface NativeSettingsSection {
  id: string;
  title: string;
  en: string;
  links: NativeSettingsLink[];
}

export interface NativeSettingsHub {
  label: string;
  en: string;
  href: string;
  children: { href: string; label: string; en: string; description: string }[];
}

export interface NativeSettingsPayload {
  store: { id: string; name: string };
  userName: string;
  isRegisterDevice: boolean;
  /** 店長以上（このiPadのプリンターの追加・保存・設定の変更） */
  canAdd: boolean;
  printers: NativeSettingsPrinter[];
  /** このiPadのレシートの出し先（cookie）。null＝おまかせ */
  selectedPrinterId: string | null;
  models: NativeSettingsModel[];
  /** レジから変えられる設定（Web の RegisterSettingsList と同じ） */
  sections: NativeSettingsSection[];
  /** 管理画面の設定の「まとめ」（Web の設定の左メニューと同じ） */
  hubs: NativeSettingsHub[];
}
