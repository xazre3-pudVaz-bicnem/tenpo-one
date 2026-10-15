import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** 2026-10-15 Ronnie「台帳で予約がどこから来たか（経路）を選べるように」 */
describe('予約詳細の経路を選び直せる', () => {
  it('予約詳細に経路の選択（未設定＋経路の一覧）', () => {
    const dlg = read('components/reservations/reservation-detail-dialog.tsx');
    expect(dlg).toContain('id="detail-source"');
    expect(dlg).toContain("await updateReservationSource(reservation.id, value || null);");
    expect(dlg).toContain(".from('reservation_sources').select('id, name').eq('status', 'active').order('sort_order')");
  });

  it('保存：予約の登録の権限・自分の企業の予約・使える経路だけ・監査ログ', () => {
    const actions = read('app/app/reservations/actions.ts');
    expect(actions).toContain('export async function updateReservationSource(reservationId: string, sourceId: string | null)');
    expect(actions).toContain("source.organization_id == null || source.organization_id === ctx.organizationId");
    expect(actions).toContain("p_action: 'reservation.source_change',");
  });

  it('台帳・一覧の行に経路のIDを持たせる', () => {
    expect(read('components/reservations/row-mapper.ts')).toContain('sourceId: r.source_id ?? null,');
    expect(read('app/app/reservations/list/page.tsx')).toContain('sourceId: r.source_id ?? null,');
  });
});
