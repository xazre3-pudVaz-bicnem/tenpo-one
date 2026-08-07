import type { DrawerProvider, PrintPayload, PrintProvider, PrintResult, PrintResultStatus } from './types';

/**
 * BrowserPrintProvider — window.print() によるブラウザ印刷。
 * 実際の印刷ダイアログ表示はクライアント側で行うため、この Provider は
 * 「印刷要求の受理」を表す（成功=ダイアログを開ける状態）。
 */
export const browserPrintProvider: PrintProvider = {
  name: 'ブラウザ印刷',
  verified: true, // ブラウザ印刷のみ検証済み
  async print(_payload: PrintPayload): Promise<PrintResult> {
    return { status: 'success' };
  },
};

/**
 * MockPrintProvider — 障害シミュレーション用。
 * printer_configs の設定画面から失敗モードを指定してテストできる。
 */
export function createMockPrintProvider(
  mode: PrintResultStatus = 'success',
  delayMs = 300
): PrintProvider {
  return {
    name: 'シミュレーション',
    verified: false,
    async print(_payload: PrintPayload): Promise<PrintResult> {
      await new Promise((r) => setTimeout(r, delayMs));
      if (mode === 'timeout') {
        await new Promise((r) => setTimeout(r, 1500));
        return { status: 'timeout' };
      }
      return { status: mode };
    },
  };
}

/**
 * EpsonPrintProvider / StarPrintProvider — アダプタースケルトン。
 * 実機・SDK接続後に実装する。呼び出されると常に未対応エラーを返す
 * （「対応済み」と誤認させないため verified=false・throw しない設計）。
 */
export const epsonPrintProviderSkeleton: PrintProvider = {
  name: 'Epson ePOS（未接続）',
  verified: false,
  async print(): Promise<PrintResult> {
    return { status: 'error', message: 'Epson ePOS SDKは未接続です（実機導入時に実装）' };
  },
};

export const starPrintProviderSkeleton: PrintProvider = {
  name: 'Star WebPRNT（未接続）',
  verified: false,
  async print(): Promise<PrintResult> {
    return { status: 'error', message: 'Star WebPRNT SDKは未接続です（実機導入時に実装）' };
  },
};

/** キャッシュドロア: Mock実装（実機はプリンターSDK経由で接続予定） */
export function createMockDrawerProvider(
  mode: 'opened' | 'failed' | 'offline' = 'opened'
): DrawerProvider {
  return {
    name: 'シミュレーションドロア',
    verified: false,
    async open() {
      await new Promise((r) => setTimeout(r, 200));
      return {
        status: mode,
        message:
          mode === 'failed' ? 'ドロアが開きませんでした'
          : mode === 'offline' ? 'ドロアがオフラインです' : undefined,
      };
    },
  };
}

/** connection_type からプロバイダーを解決 */
export function resolvePrintProvider(connectionType: string | null): PrintProvider {
  switch (connectionType) {
    case 'browser':
    case null:
      return browserPrintProvider;
    case 'wifi':
    case 'lan':
    case 'bluetooth':
    case 'usb':
      // 実機SDK未接続のためシミュレーションへフォールバック（UIで明示する）
      return createMockPrintProvider('success');
    default:
      return browserPrintProvider;
  }
}
