import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** レジ精算の「営業日 … 開局 10:55 担当」の担当＝開局の画面で選んでいた POS 担当者（2026-09-29 Ronnie） */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('レジ開局の担当者', () => {
  it('migration 00090：register_sessions.opened_clerk_name と set_register_open_clerk（開いているセッション・同じ店舗の人だけ）', () => {
    const sql = read('supabase/migrations/00090_register_open_clerk.sql');
    expect(sql).toContain('add column if not exists opened_clerk_name text');
    expect(sql).toContain('create or replace function public.set_register_open_clerk(p_session_id uuid, p_clerk_name text)');
    expect(sql).toContain('security definer');
    expect(sql).toContain("if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'");
    expect(sql).toContain('app_has_store_access(v_session.organization_id, v_session.store_id)');
    expect(sql).toContain('revoke execute on function public.set_register_open_clerk(uuid, text) from public, anon');
  });

  it('開局の直後に担当者を残す（失敗しても開局は止めない）', () => {
    const src = read('app/app/cash/actions.ts');
    expect(src).toContain('openedClerkName: string | null = null');
    expect(src).toContain("supabase.rpc('set_register_open_clerk', {");
    expect(src).toContain('(opened as { session_id?: string } | null)?.session_id');
  });

  it('レジ端末の開局は担当者を選んでから', () => {
    const src = read('components/cash/register-open-card.tsx');
    expect(src).toContain('clerkGate?.clerk?.name ?? null');
    expect(src).toContain("toast('レジ開局の担当者を選んでください', 'error')");
  });

  it('レジ精算：担当者が無い前からのセッションは開いたアカウント名。レジの共用アカウント「<店舗名>（レジ）」は出さない', () => {
    const src = read('lib/register-report-loader.ts');
    expect(src).toContain(".select('opened_clerk_name')");
    expect(src).toContain('n === `${sessionStoreName}（レジ）`');
    expect(src).toContain('openedBy: openerName,');
  });
});
