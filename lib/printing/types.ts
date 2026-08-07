/**
 * 印刷・キャッシュドロア抽象化レイヤー。
 * 実機SDK（Epson ePOS / Star WebPRNT）は未接続。接続時はこのinterfaceを実装した
 * アダプターを追加し、printer_configs.connection_type で切り替える。
 * 実機検証が完了するまでUI上「対応済み」と表示しないこと。
 */

export type PaperWidth = 58 | 80;

export type PrintJobKind = 'receipt' | 'ryoshusho' | 'kitchen' | 'test';

export interface PrintPayload {
  kind: PrintJobKind;
  /** レンダリング済みレシートデータ（lib/receipts.ts の ReceiptData） */
  data: unknown;
  paperWidth: PaperWidth;
}

export type PrintResultStatus = 'success' | 'paper_out' | 'offline' | 'timeout' | 'error';

export interface PrintResult {
  status: PrintResultStatus;
  message?: string;
}

export interface PrintProvider {
  readonly name: string;
  /** 実機検証済みか（false のUIは「シミュレーション」「未検証」表示） */
  readonly verified: boolean;
  print(payload: PrintPayload): Promise<PrintResult>;
}

export type DrawerResultStatus = 'opened' | 'failed' | 'offline';

export interface DrawerProvider {
  readonly name: string;
  readonly verified: boolean;
  open(): Promise<{ status: DrawerResultStatus; message?: string }>;
}

/** 支払方法に応じてドロアを開くべきか（現金のみ自動開放が既定） */
export function shouldOpenDrawer(
  methods: string[],
  config: { autoOpenOnCash: boolean; openOnCashless: boolean }
): boolean {
  const hasCash = methods.includes('cash');
  if (hasCash) return config.autoOpenOnCash;
  return config.openOnCashless;
}

export const PRINT_STATUS_LABELS: Record<PrintResultStatus, string> = {
  success: '印刷しました',
  paper_out: '用紙切れです。ロール紙を交換してください',
  offline: 'プリンターがオフラインです。接続を確認してください',
  timeout: 'プリンターが応答しません。時間をおいて再試行してください',
  error: '印刷に失敗しました',
};
