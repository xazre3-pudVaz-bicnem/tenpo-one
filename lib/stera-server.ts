/**
 * stera 連携のサーバー側（端末アプリからの API と、レジのサーバーアクションで共通）。
 * テーブルはサーバー専用（RLS・ポリシーなし）なので service role で読み書きする。呼ぶ側で権限を確かめること。
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { interpretSteraResult, normalizeLinkCode, STERA_QUEUE_TTL_MS, type SteraResultInput } from '@/lib/stera';

type Admin = ReturnType<typeof createAdminClient>;

export interface SteraTerminalRow {
  id: string;
  organization_id: string;
  store_id: string;
  name: string;
  terminal_no: string | null;
  link_code: string;
  status: string;
  last_seen_at: string | null;
  app_version: string | null;
}

export interface SteraRequestRow {
  id: string;
  organization_id: string;
  store_id: string;
  terminal_id: string;
  order_id: string;
  amount: number;
  tax: number;
  payment_type: string;
  slip_number: string;
  status: string;
  result: Record<string, unknown> | null;
  finalized_at: string | null;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
}

const TERMINAL_COLUMNS = 'id, organization_id, store_id, name, terminal_no, link_code, status, last_seen_at, app_version';
export const REQUEST_COLUMNS =
  'id, organization_id, store_id, terminal_id, order_id, amount, tax, payment_type, slip_number, status, result, finalized_at, created_at, sent_at, completed_at';

/** リンクコードから、使える端末を引く（止めた・消した端末は null） */
export async function resolveSteraTerminal(code: string): Promise<{ admin: Admin; terminal: SteraTerminalRow | null }> {
  const admin = createAdminClient();
  const normalized = normalizeLinkCode(code);
  if (!normalized) return { admin, terminal: null };
  const { data } = await admin
    .from('stera_terminals')
    .select(TERMINAL_COLUMNS)
    .eq('link_code', normalized)
    .eq('status', 'active')
    .maybeSingle();
  return { admin, terminal: (data as SteraTerminalRow | null) ?? null };
}

/** 受け取られないまま時間が過ぎた依頼を expired にする */
export async function expireStaleSteraRequests(admin: Admin, filter: { terminalId?: string; orderId?: string }) {
  let q = admin
    .from('stera_payment_requests')
    .update({ status: 'expired', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('status', 'queued')
    .lt('created_at', new Date(Date.now() - STERA_QUEUE_TTL_MS).toISOString());
  if (filter.terminalId) q = q.eq('terminal_id', filter.terminalId);
  if (filter.orderId) q = q.eq('order_id', filter.orderId);
  const { error } = await q;
  if (error) console.error('[stera] expire failed', error.message);
}

/**
 * 端末のポーリング：生きている印を付け、待っている依頼があれば1件だけ「送った」にして返す。
 * 同じ依頼を二度渡さない（status='queued' のときだけ sent に変える）。
 */
export async function claimNextSteraRequest(
  admin: Admin,
  terminal: SteraTerminalRow,
  appVersion: string | null
): Promise<SteraRequestRow | null> {
  const now = new Date().toISOString();
  await admin
    .from('stera_terminals')
    .update({ last_seen_at: now, ...(appVersion ? { app_version: appVersion.slice(0, 20) } : {}) })
    .eq('id', terminal.id);
  await expireStaleSteraRequests(admin, { terminalId: terminal.id });

  const { data: next } = await admin
    .from('stera_payment_requests')
    .select(REQUEST_COLUMNS)
    .eq('terminal_id', terminal.id)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return null;

  const { data: claimed } = await admin
    .from('stera_payment_requests')
    .update({ status: 'sent', sent_at: now, updated_at: now })
    .eq('id', (next as SteraRequestRow).id)
    .eq('status', 'queued')
    .select(REQUEST_COLUMNS)
    .maybeSingle();
  return (claimed as SteraRequestRow | null) ?? null;
}

/**
 * 端末から届いた結果を残す。送った依頼（sent）のほか、レジ側で「やめた」依頼（canceled/expired）に
 * あとから成功が届いた場合も成功として残す（お金は取れているので、レジを開き直したときに会計を確定させる）。
 */
export async function recordSteraResult(
  admin: Admin,
  terminal: SteraTerminalRow,
  requestId: string,
  input: SteraResultInput
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { data: row } = await admin
    .from('stera_payment_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', requestId)
    .eq('terminal_id', terminal.id)
    .maybeSingle();
  const req = row as SteraRequestRow | null;
  if (!req) return { ok: false, error: 'REQUEST_NOT_FOUND' };
  if (req.status === 'succeeded' || req.status === 'failed') return { ok: true, status: req.status };

  const result = interpretSteraResult(input, req.payment_type);
  // 取消済み・期限切れに届いた失敗・キャンセルは、そのままにする（成功だけ拾う）
  if ((req.status === 'canceled' || req.status === 'expired') && result.status !== 'succeeded') {
    return { ok: true, status: req.status };
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from('stera_payment_requests')
    .update({
      status: result.status,
      result: { ...result.saved, method: result.method, brand: result.brand },
      completed_at: now,
      updated_at: now,
    })
    .eq('id', req.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, status: result.status };
}
