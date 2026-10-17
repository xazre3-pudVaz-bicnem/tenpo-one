import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QR_GUEST_MAX, parseQrGuestCounts, qrGuestLabel, stepGuest } from '@/lib/qr-visit';
import { QR_STRINGS } from '@/components/qr-order/strings';

// 2026-10-17 Ronnie「QR を読んだらすぐ注文ではなく、Air レジのように人数（Girls / Boys）を選んでから注文へ」
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('QR の最初の画面（ご来店の人数）', () => {
  it('人数は 0〜30 の整数、合計1名以上', () => {
    expect(parseQrGuestCounts(2, 1)).toEqual({ female: 2, male: 1, total: 3 });
    expect(parseQrGuestCounts(0, 1)).toEqual({ female: 0, male: 1, total: 1 });
    expect(parseQrGuestCounts(0, 0)).toBeNull();
    expect(parseQrGuestCounts(-1, 2)).toBeNull();
    expect(parseQrGuestCounts(1.5, 1)).toBeNull();
    expect(parseQrGuestCounts('2', 1)).toBeNull();
    expect(parseQrGuestCounts(QR_GUEST_MAX + 1, 0)).toBeNull();
    expect(stepGuest(0, -1)).toBe(0);
    expect(stepGuest(QR_GUEST_MAX, 1)).toBe(QR_GUEST_MAX);
    expect(qrGuestLabel({ female: 2, male: 1 })).toBe('女性2・男性1');
  });

  it('日本語・英語の文言', () => {
    expect(QR_STRINGS.ja.start.women).toBe('女性');
    expect(QR_STRINGS.ja.start.men).toBe('男性');
    expect(QR_STRINGS.ja.start.submit).toBe('人数を確定して、注文へ進む');
    expect(QR_STRINGS.en.start.women).toBe('Women');
    expect(QR_STRINGS.en.start.total(3)).toBe('Total 3');
  });

  it('卓にまだ伝票が無いときだけ出す（予約コースの卓・グループの別の卓は出さない）', () => {
    const page = read('app/order/[storeSlug]/[tableToken]/page.tsx');
    expect(page).toContain('resolved.redirected ? Promise.resolve(false) : qrStartRequired(storeSlug, tableToken)');
    expect(page).toContain('startRequired={noOpenOrder && !course}');
    const app = read('components/qr-order/qr-order-app.tsx');
    expect(app).toContain('useState(!startRequired)');
    expect(app).toContain("fetch('/api/qr/start'");
    expect(app).toContain('<QrGuestStart');
  });

  it('サーバー：すでに伝票がある卓は何もしない・人数は guest_count、内訳は guest_female / guest_male', () => {
    const s = read('lib/qr-visit-server.ts');
    expect(s).toContain('if (await openOrderOf(admin, table.id)) return { ok: true, started: false };');
    expect(s).toContain('guest_count: guests.total');
    expect(s).toContain('guest_female: guests.female, guest_male: guests.male');
    // 同時に2台で押したときは1枚に
    expect(s).toContain("status: 'cancelled'");
    // レジで開いて離れても、お客様が QR で開いた伝票は消さない
    expect(read('lib/discard-untouched-order.ts')).toContain("if (order.order_source === 'qr') return { discarded: false");
    const route = read('app/api/qr/start/route.ts');
    expect(route).toContain('parseQrGuestCounts(body.female, body.male)');
  });
});
