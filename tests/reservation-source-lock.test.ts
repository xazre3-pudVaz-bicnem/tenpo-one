import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canChangeReservationSource } from '@/components/reservations/constants';

// 2026-10-16 Ronnie「予約リンク（Web）から入った予約の経路は変えられないように。手入力だけ変更できる。自動読み取りは変更できない」
describe('予約の経路を変えられるのは手入力の予約だけ', () => {
  it('電話・手動登録・ウォークインは変えられる', () => {
    expect(canChangeReservationSource('phone')).toBe(true);
    expect(canChangeReservationSource('manual')).toBe(true);
    expect(canChangeReservationSource('walk_in')).toBe(true);
  });

  it('予約リンク・TABLE ONE（web）とグルメサイトの自動取込は変えられない', () => {
    expect(canChangeReservationSource('web')).toBe(false);
    expect(canChangeReservationSource('gourmet_mail')).toBe(false);
    expect(canChangeReservationSource(null)).toBe(false);
    expect(canChangeReservationSource(undefined)).toBe(false);
  });

  it('台帳の詳細は自動の予約で経路を選ばせず、サーバーでも断る', () => {
    const dialog = readFileSync('components/reservations/reservation-detail-dialog.tsx', 'utf8');
    expect(dialog).toContain('sources.length > 0 && canChangeReservationSource(reservation.createdVia) ?');
    expect(dialog).toContain('（自動・変更不可）');
    const actions = readFileSync('app/app/reservations/actions.ts', 'utf8');
    expect(actions).toMatch(/updateReservationSource[\s\S]*?canChangeReservationSource\(/);
  });
});
