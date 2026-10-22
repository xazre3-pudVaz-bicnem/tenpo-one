import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// 2026-10-16 Ronnie「ハンディの予約一覧を押したら詳細をポップアップで」
describe('ハンディの予約の詳細（ポップアップ）', () => {
  const list = readFileSync('components/handy/handy-reservation-list.tsx', 'utf8');
  const detail = readFileSync('components/handy/handy-reservation-detail.tsx', 'utf8');
  const page = readFileSync('app/handy/reservations/page.tsx', 'utf8');

  it('予約のカードを押すと詳細を開く（電話番号は今まで通りそのまま動く。HANDYで注文は詳細の下だけ。2026-10-20）', () => {
    expect(list).toContain('onClick={() => setOpenId(r.id)}');
    expect(list).toContain('<HandyReservationDetail');
    // カードに電話は出さない（2026-10-22）ので、カードの中で押しても止めるものは無い
    expect(list).not.toContain('e.stopPropagation()');
  });

  it('詳細は要望・メモを全部（切らずに）出し、電話・メール・担当・人数の内訳も出す', () => {
    expect(detail).toContain('whitespace-pre-wrap');
    for (const label of ['"席"', '"コース"', '"経路"', '"担当"', '"電話"', '"要望"', '"メモ"']) expect(detail).toContain(`label=${label}`);
    expect(detail).toContain('href={`tel:${r.phone}`}');
    expect(detail).toContain('大人 ${r.adults}');
    expect(detail).toContain('閉じる');
  });

  it('予約台帳と同じ項目を読む（担当はレジの担当名 clerk_name）', () => {
    for (const col of ['code', 'guest_name_kana', 'guest_email', 'adults', 'children', 'allergy_note', 'clerk_name', 'created_at']) {
      expect(page).toContain(col);
    }
    expect(page).toContain('dateLabel={handyDayLabel(date)}');
  });
});
