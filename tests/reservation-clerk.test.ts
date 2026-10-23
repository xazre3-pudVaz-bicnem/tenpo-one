import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapReservationRow, type RawReservationRow } from '@/components/reservations/row-mapper';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** 2026-10-15 Ronnie「台帳の担当者は端末ではなくレジの担当名。レジと台帳は同じ」・「TABLE ONE から来た予約の経路は TABLE ONE」 */
describe('予約の担当者＝レジの担当名', () => {
  it('migration：列を足すだけ（消さない）・TABLE ONE の経路', () => {
    const sql = read('supabase/migrations/00095_reservation_clerk_table_one.sql');
    expect(sql).toContain('add column if not exists clerk_id uuid references public.pos_clerks(id) on delete set null');
    expect(sql).toContain('add column if not exists clerk_name text');
    expect(sql).toContain("select null, 'table_one', 'TABLE ONE', 22");
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bdrop\s+(table|column)\b/i);
  });

  it('選択肢はその店のレジの担当名（台帳・一覧・ホーム）', () => {
    expect(read('app/app/reservations/page.tsx')).toContain('reservationClerkOptions(supabase, [store.id]),');
    // ホームは他の読み込みと一緒に並列で取る（2026-10-21）
    expect(read('lib/floor-view-server.ts')).toContain('reservationClerkOptions(supabase, [store.id]),');
    expect(read('lib/floor-view-server.ts')).toContain('const staffOptions = clerkOptionsByStore[store.id] ?? [];');
    expect(read('app/app/reservations/list/page.tsx')).toContain('const staffByStore = await reservationClerkOptions(supabase, storeIds);');
  });

  it('保存：その予約の店の担当者だけ・名前も残す', () => {
    const actions = read('app/app/reservations/actions.ts');
    expect(actions).toContain('export async function updateReservationClerk(reservationId: string, clerkId: string | null)');
    expect(actions).toContain("clerk.store_id !== reservation.store_id || clerk.status !== 'active'");
    expect(actions).toContain('.update({ clerk_id: clerkId, clerk_name: clerkName, updated_by: ctx.userId })');
    expect(read('components/reservations/reservation-detail-dialog.tsx')).toContain('await updateReservationClerk(reservation.id, value || null);');
    expect(read('components/reservations/reservation-sheet.tsx')).toContain('await updateReservationClerk(r.id, form.staffId || null);');
  });

  it('表示はレジの担当名。無ければ前のログインアカウント名', () => {
    const base = {
      id: 'r1', code: 'C', store_id: 's', reserved_date: '2026-10-16', start_at: '2026-10-16T04:30:00Z', end_at: '2026-10-16T06:30:00Z',
      guest_name: 'Ronnie', guest_name_kana: null, guest_phone: '0900000000', guest_email: null, party_size: 2, adults: 2, children: 0,
      status: 'confirmed', seat_type: null, purpose: null, allergy_note: null, request_note: null, memo: null, created_via: 'web',
      created_at: '2026-10-15T00:00:00Z', is_private_hire: false, staff_id: 'p1', course_id: null, profiles: { display_name: 'レジ端末' },
      course: null, reservation_sources: { name: 'TABLE ONE' }, reservation_tables: [],
    } as unknown as RawReservationRow;
    const withClerk = mapReservationRow({ ...base, clerk_id: 'c1', clerk_name: 'Sankar' } as RawReservationRow, null);
    expect(withClerk.staffId).toBe('c1');
    expect(withClerk.staffName).toBe('Sankar');
    const legacy = mapReservationRow(base, null);
    expect(legacy.staffId).toBeNull();
    expect(legacy.staffName).toBe('レジ端末');
  });
});
