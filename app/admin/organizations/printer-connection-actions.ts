'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  cloudPrntConfigPatch,
  isConnectionPrinterOf,
  parsePrinterConnectionInput,
  parsePrinterConnectionRef,
  parsePrinterConnectionTestInput,
} from '@/lib/printer-connection';
import { CLOUDPRNT_TEST_JOB, cloudPrntTestError, cloudPrntTestPayload, newCloudPrntToken } from '@/lib/cloudprnt-test-job';

/**
 * 運営コンソール（コントロールセンター）：店舗の「プリンター接続」（Star CloudPRNT・EPSON Server Direct Print・iPad の Bluetooth / LAN）
 * （2026-10-25 Ronnie「yo data haru pani control centre mai rakhdeu — buti sano compact tarikale」）。
 *   - 保存 … このプリンタを使う（cloudprnt_enabled）・問い合わせ間隔・ドロア開放コマンド・伝票（kitchen_stations）
 *   - URLを再発行 … cloudprnt_token（前の接続用URLは使えなくなる）
 *   - テスト印刷・ドロアを開く … print_jobs に積む（お店の 設定 › プリンター接続 と同じ中身。lib/cloudprnt-test-job.ts）
 * どれも最初に requireCypressAdmin（運営だけ。ちがえば /app/dashboard へ）。画面から来た企業・店舗・プリンターは、
 * サービスロールで DB を読んで「その企業のその店舗のもの」か確かめてから書く。お店の管理画面からは見るだけ（テスト印刷は使える）。
 */

export interface AdminPrinterConnectionResult {
  error?: string;
}

type Admin = ReturnType<typeof createAdminClient>;

/** この店舗がこの企業のものなら店舗名、ちがえば null */
async function storeOfOrg(admin: Admin, organizationId: string, storeId: string): Promise<{ name: string } | null> {
  const { data: store } = await admin.from('stores').select('id, organization_id, name').eq('id', storeId).maybeSingle();
  if (!store || store.organization_id !== organizationId) return null;
  return { name: (store.name as string | null) ?? '' };
}

async function audit(organizationId: string, storeId: string, action: string, printerId: string, after: unknown) {
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: storeId,
    p_action: action,
    p_target_table: 'printer_configs',
    p_target_id: printerId,
    p_before: null,
    p_after: after as never,
    p_note: null,
  });
}

function revalidate(organizationId: string) {
  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath('/app/settings/printers');
}

const PRINTER_COLUMNS = 'id, organization_id, store_id, status, name, usage, cloudprnt_enabled, paper_width_mm, drawer_command, drawer_kick';

/** このプリンタを使う・問い合わせ間隔・ドロア開放コマンド・伝票を保存する（運営だけ） */
export async function saveAdminPrinterConnection(raw: unknown): Promise<AdminPrinterConnectionResult> {
  const ctx = await requireCypressAdmin();
  const parsed = parsePrinterConnectionInput(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const admin = createAdminClient();
  if (!(await storeOfOrg(admin, input.organizationId, input.storeId))) return { error: '店舗が見つかりません' };

  const { data: current } = await admin.from('printer_configs').select(PRINTER_COLUMNS).eq('id', input.printerId).maybeSingle();
  if (!isConnectionPrinterOf(current, input)) return { error: 'プリンターが見つかりません' };

  // 伝票（厨房ステーション）は厨房機だけ。レシート機に来ても書かない
  const built = cloudPrntConfigPatch({ ...input, kitchenStations: current?.usage === 'kitchen' ? input.kitchenStations : undefined });
  if (!built.ok) return { error: built.error };
  const patch: Record<string, unknown> = { ...built.value, updated_by: ctx.userId };

  const { error } = await admin
    .from('printer_configs')
    .update(patch)
    .eq('id', input.printerId)
    .eq('organization_id', input.organizationId)
    .eq('store_id', input.storeId);
  if (error) return { error: `プリンター接続の保存に失敗しました: ${error.message}` };

  await audit(input.organizationId, input.storeId, 'admin.printer_connection.update', input.printerId, {
    name: current?.name ?? null,
    enabled: patch.cloudprnt_enabled,
    poll_interval_seconds: patch.poll_interval_seconds ?? null,
    drawer_command: patch.drawer_command ?? null,
    kitchen_stations: patch.kitchen_stations ?? null,
  });
  revalidate(input.organizationId);
  revalidatePath('/app/pos/settings');
  return {};
}

/** 接続用URLを再発行する（前のURLは使えなくなる。プリンター側の設定のやり直しが要る・運営だけ） */
export async function regenerateAdminPrinterConnectionToken(raw: unknown): Promise<AdminPrinterConnectionResult> {
  const ctx = await requireCypressAdmin();
  const parsed = parsePrinterConnectionRef(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const admin = createAdminClient();
  if (!(await storeOfOrg(admin, input.organizationId, input.storeId))) return { error: '店舗が見つかりません' };

  const { data: current } = await admin.from('printer_configs').select(PRINTER_COLUMNS).eq('id', input.printerId).maybeSingle();
  if (!isConnectionPrinterOf(current, input)) return { error: 'プリンターが見つかりません' };

  const token = await newCloudPrntToken();
  const { error } = await admin
    .from('printer_configs')
    .update({ cloudprnt_token: token, updated_by: ctx.userId })
    .eq('id', input.printerId)
    .eq('organization_id', input.organizationId)
    .eq('store_id', input.storeId);
  if (error) return { error: `URLの再発行に失敗しました: ${error.message}` };

  // トークンそのものは監査ログに残さない
  await audit(input.organizationId, input.storeId, 'admin.printer_connection.token_regenerate', input.printerId, { name: current?.name ?? null });
  revalidate(input.organizationId);
  return {};
}

/** テスト印刷・ドロア開放を積む（プリンタが次に取りに来たときに出る・運営だけ） */
export async function enqueueAdminPrinterConnectionTest(raw: unknown): Promise<AdminPrinterConnectionResult> {
  const ctx = await requireCypressAdmin();
  const parsed = parsePrinterConnectionTestInput(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const admin = createAdminClient();
  const store = await storeOfOrg(admin, input.organizationId, input.storeId);
  if (!store) return { error: '店舗が見つかりません' };

  const { data: printer } = await admin.from('printer_configs').select(PRINTER_COLUMNS).eq('id', input.printerId).maybeSingle();
  if (!printer || !isConnectionPrinterOf(printer, input)) return { error: 'プリンターが見つかりません' };
  const testError = cloudPrntTestError(printer, input.kind);
  if (testError) return { error: testError };

  const payload = await cloudPrntTestPayload(printer, input.kind, store.name || 'TENPO ONE');
  const { error } = await admin.from('print_jobs').insert({
    organization_id: input.organizationId,
    store_id: input.storeId,
    printer_config_id: input.printerId,
    ...CLOUDPRNT_TEST_JOB,
    payload,
    created_by: ctx.userId,
  });
  if (error) return { error: `テストジョブの登録に失敗しました: ${error.message}` };

  await audit(input.organizationId, input.storeId, 'admin.printer_connection.test', input.printerId, { name: printer.name ?? null, kind: input.kind });
  revalidate(input.organizationId);
  return {};
}
