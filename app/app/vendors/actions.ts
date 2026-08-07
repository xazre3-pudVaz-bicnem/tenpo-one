'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const PATH = '/app/vendors';

export interface VendorInput {
  name: string;
  nameKana: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  closingDay: number | null;
  paymentDay: number | null;
  bankInfo: string | null;
  note: string | null;
}

export async function createVendor(input: VendorInput) {
  const ctx = await requirePermission('vendors.manage');
  if (!input.name.trim()) throw new Error('名前を入力してください');
  const supabase = await createClient();
  const { error } = await supabase.from('vendors').insert({
    organization_id: ctx.organizationId,
    name: input.name.trim(),
    name_kana: input.nameKana,
    contact_name: input.contactName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    closing_day: input.closingDay,
    payment_day: input.paymentDay,
    bank_info: input.bankInfo,
    note: input.note,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

export async function updateVendor(vendorId: string, input: VendorInput) {
  const ctx = await requirePermission('vendors.manage');
  if (!input.name.trim()) throw new Error('名前を入力してください');
  const supabase = await createClient();
  const { error } = await supabase
    .from('vendors')
    .update({
      name: input.name.trim(),
      name_kana: input.nameKana,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      closing_day: input.closingDay,
      payment_day: input.paymentDay,
      bank_info: input.bankInfo,
      note: input.note,
      updated_by: ctx.userId,
    })
    .eq('id', vendorId);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** 論理削除（status='deleted'）。理由必須・監査ログ */
export async function deleteVendor(vendorId: string, reason: string) {
  const ctx = await requirePermission('vendors.manage');
  if (!reason.trim()) throw new Error('理由を入力してください');
  const supabase = await createClient();
  const { data: vendor, error } = await supabase.from('vendors').select('id, status').eq('id', vendorId).single();
  if (error || !vendor) throw new Error('仕入先が見つかりません');

  const { error: updErr } = await supabase
    .from('vendors')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', vendorId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'vendor.delete',
    p_target_table: 'vendors',
    p_target_id: vendorId,
    p_before: { status: vendor.status },
    p_after: { status: 'deleted' },
    p_note: reason,
  });

  revalidatePath(PATH);
}

/** 直近の発注履歴5件（発注履歴ダイアログ用） */
export async function getVendorRecentOrders(vendorId: string) {
  await requireMember();
  const supabase = await createClient();
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, po_no, status, total, expected_at, created_at')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })
    .limit(5);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    poNo: r.po_no as number,
    status: r.status as string,
    total: r.total as number,
    expectedAt: r.expected_at as string | null,
  }));
}
