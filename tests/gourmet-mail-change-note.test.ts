import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

/** 2026-10-19 Ronnie「お客様が時間・コース・人数を変えたら TENPO ONE の台帳も自動で」：変更メールのコースもご要望欄に入る */
describe('グルメサイトの変更メール：ご要望欄（コース）', async () => {
  const { changedNote } = await import('@/lib/gourmet-mail-server');

  it('コースが変わったら新しいコースに。ご要望は前のまま', () => {
    expect(changedNote({ course: '極みコース', request: null }, 'コース: 通常コース\n窓側希望')).toBe('コース: 極みコース\n窓側希望');
  });
  it('ご要望だけ変わったらコースは前のまま', () => {
    expect(changedNote({ course: null, request: '誕生日プレート' }, 'コース: 通常コース\n窓側希望')).toBe('コース: 通常コース\n誕生日プレート');
  });
  it('どちらも無ければ前のまま・前も無ければ空', () => {
    expect(changedNote({ course: null, request: null }, 'コース: 通常コース')).toBe('コース: 通常コース');
    expect(changedNote({ course: null, request: null }, null)).toBeNull();
  });
});
