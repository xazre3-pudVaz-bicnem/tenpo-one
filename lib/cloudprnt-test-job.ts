/**
 * 「プリンター接続」のテスト印刷・ドロア開放のジョブ（print_jobs に積む中身）と、接続用URLのトークン。
 * お店の管理画面（app/app/settings/printers/actions.ts の enqueueCloudPrntTest / regenerateCloudPrntToken）と
 * 運営コンソール（app/admin/organizations/printer-connection-actions.ts）で同じものを使う。
 * 印刷のしかたそのもの（Markup / StarPRNT / ePOS-Print XML を積み、対応形式はプリンタに選ばせる）は変えない。
 */

export type CloudPrntTestKind = 'receipt' | 'drawer';

/** テスト印刷に要る printer_configs の列 */
export interface CloudPrntTestPrinter {
  cloudprnt_enabled: boolean | null;
  paper_width_mm: number | null;
  drawer_command: string | null;
  usage: string | null;
  drawer_kick: boolean | null;
}

/** 積めないときの言葉。積めるなら null */
export function cloudPrntTestError(printer: CloudPrntTestPrinter | null | undefined, kind: CloudPrntTestKind): string | null {
  if (!printer) return 'プリンタ設定が見つかりません';
  if (!printer.cloudprnt_enabled) return '先にCloudPRNTを有効化してください';
  // ドロアはレシート機につながる前提（キッチン機へ開放命令を送っても意味がない）
  if (kind === 'drawer' && (printer.usage !== 'receipt' || !printer.drawer_kick)) {
    return 'ドロア開放はドロア連動が有効なレシート用プリンタでのみ使えます';
  }
  return null;
}

/** print_jobs の payload（Markup / StarPRNT / ePOS-Print XML の表現を積み、対応形式はプリンタに選ばせる） */
export async function cloudPrntTestPayload(
  printer: CloudPrntTestPrinter,
  kind: CloudPrntTestKind,
  storeName: string
): Promise<{ body: string; starprnt: string; epos: string; drawer: boolean }> {
  const { testPrintMarkup, drawerKickMarkup } = await import('@/lib/receipt-markup');
  const { testPrintStarPrnt, drawerKickStarPrnt } = await import('@/lib/starprnt');
  const { testPrintEpos, drawerKickEpos } = await import('@/lib/epos-print');

  const paper = printer.paper_width_mm === 58 ? 58 : 80;
  const drawerCommand = printer.drawer_command ?? '[drawer: 1]';
  const issuedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  // Markup / StarPRNT / ePOS-Print XML の表現を積み、対応形式はプリンタに選ばせる
  // （Markup非対応ファーム対策 兼 EPSON機対応）。
  const body = kind === 'drawer' ? drawerKickMarkup(drawerCommand) : testPrintMarkup({ storeName, paperWidth: paper, issuedAt });
  const starprnt = (
    kind === 'drawer' ? drawerKickStarPrnt(drawerCommand) : testPrintStarPrnt({ storeName, paperWidth: paper, issuedAt })
  ).toString('base64');
  const epos = kind === 'drawer' ? drawerKickEpos(drawerCommand) : testPrintEpos({ storeName, paperWidth: paper, issuedAt });
  return { body, starprnt, epos, drawer: kind === 'drawer' };
}

/** print_jobs の行の決まった列（organization_id・store_id・printer_config_id・payload・created_by は呼ぶ側で） */
export const CLOUDPRNT_TEST_JOB = {
  job_type: 'test',
  target: 'cloudprnt',
  content_type: 'text/vnd.star.markup',
  status: 'queued',
} as const;

/** 推測できない接続用URLのトークン（サーバー側で作る。node:crypto） */
export async function newCloudPrntToken(): Promise<string> {
  const { randomBytes } = await import('node:crypto');
  return randomBytes(24).toString('hex');
}
