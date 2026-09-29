import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  formatLinkCode,
  interpretSteraResult,
  isSteraOnline,
  isSteraPaymentType,
  maskPan,
  methodOfPaymentType,
  newLinkCode,
  normalizeLinkCode,
  steraSlipNumber,
  STERA_PAYMENT_COMPONENT,
} from '@/lib/stera';

/** stera 連携（2026-09-29 Ronnie「stera を押したら金額が端末へ行って、決済、会計、ドロアまで」） */

describe('支払種別と結果の読み方（stera developers の公開仕様）', () => {
  it('決済アプリの Intent', () => {
    expect(STERA_PAYMENT_COMPONENT).toBe('com.panasonic.smartpayment.android.salesmenu/.MainActivity');
  });

  it('支払種別', () => {
    expect(isSteraPaymentType('01')).toBe(true);
    expect(isSteraPaymentType('02-02')).toBe(true);
    expect(isSteraPaymentType('03')).toBe(true);
    expect(isSteraPaymentType('02')).toBe(false);
    expect(isSteraPaymentType('04')).toBe(false);
    expect(methodOfPaymentType('01')).toBe('credit');
    expect(methodOfPaymentType('02-05')).toBe('emoney');
    expect(methodOfPaymentType('03')).toBe('qr');
  });

  it('成功：SUCCESS かつ ErrorCode が空。ブランドは内訳の名前に', () => {
    const r = interpretSteraResult(
      { outcome: 'SUCCESS', resultCode: -1, extras: { PaymentType: '01', ErrorCode: '', CreditCardBrand: '01', Amount: '3300', CreditCardMaskedPAN: '4111********1111' } },
      '01'
    );
    expect(r.status).toBe('succeeded');
    expect(r.method).toBe('credit');
    expect(r.brand).toBe('VISA');
    expect(r.amount).toBe(3300);
    expect(r.saved.CreditCardMaskedPAN).toBe('4111********1111');
  });

  it('QR（PayPay）・電子マネー（交通系IC）', () => {
    expect(interpretSteraResult({ outcome: 'SUCCESS', extras: { PaymentType: '03', ErrorCode: '', QRPayType: '13' } }, '03').brand).toBe('PayPay');
    const ic = interpretSteraResult({ outcome: 'SUCCESS', extras: { PaymentType: '02', ErrorCode: '', EMoneyType: '02' } }, '02-02');
    expect(ic.method).toBe('emoney');
    expect(ic.brand).toBe('交通系IC');
  });

  it('ErrorCode があれば失敗、CANCEL は取消', () => {
    expect(interpretSteraResult({ outcome: 'SUCCESS', extras: { ErrorCode: 'FFFFFFFF' } }, '01').status).toBe('failed');
    expect(interpretSteraResult({ outcome: 'FAIL', extras: {} }, '01').status).toBe('failed');
    expect(interpretSteraResult({ outcome: 'CANCEL', extras: {} }, '01').status).toBe('canceled');
  });

  it('受け取る項目は決まったものだけ。カード番号らしいものはマスク', () => {
    const r = interpretSteraResult({ outcome: 'SUCCESS', extras: { ErrorCode: '', Secret: 'x', CreditCardMaskedPAN: '4111111111111111' } }, '01');
    expect(r.saved.Secret).toBeUndefined();
    expect(r.saved.CreditCardMaskedPAN).toBe('************1111');
    expect(maskPan('****1234')).toBe('****1234');
  });
});

describe('伝票番号・リンクコード・接続', () => {
  it('SlipNumber は5桁（00001〜99999）', () => {
    expect(steraSlipNumber(6467)).toBe('06467');
    expect(steraSlipNumber(123456)).toBe('23456');
    expect(steraSlipNumber(100000)).toBe('00001');
    expect(steraSlipNumber(null)).toBe('00001');
  });

  it('リンクコード：12文字（0/O・1/I なし）、区切って表示、入力はそろえる', () => {
    const code = newLinkCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 7));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(formatLinkCode('ABCDEFGHJKLM')).toBe('ABCD-EFGH-JKLM');
    expect(normalizeLinkCode('abcd-efgh-jklm')).toBe('ABCDEFGHJKLM');
    expect(normalizeLinkCode('ABCD-EFGH-JKL0')).toBeNull();
    expect(normalizeLinkCode('short')).toBeNull();
  });

  it('30秒以内にポーリングがあれば接続中', () => {
    const now = Date.parse('2026-09-30T03:00:30Z');
    expect(isSteraOnline('2026-09-30T03:00:05Z', now)).toBe(true);
    expect(isSteraOnline('2026-09-30T02:59:00Z', now)).toBe(false);
    expect(isSteraOnline(null, now)).toBe(false);
  });
});

describe('サーバー・画面', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('migration 00092：新しいテーブルだけ・サーバー専用・1伝票1依頼', () => {
    const sql = read('supabase/migrations/00092_stera_link.sql');
    expect(sql).toContain('create table if not exists public.stera_terminals');
    expect(sql).toContain('create table if not exists public.stera_payment_requests');
    expect(sql).toContain("where status in ('queued', 'sent')");
    expect(sql).toContain('revoke all on public.stera_payment_requests from anon, authenticated');
    expect(sql).not.toMatch(/drop table|delete from|update public\.(orders|payments)/i);
  });
  it('端末が受け取った依頼（sent）はレジから取り消せない。成功したのに会計がまだなら、新しく依頼せず会計', () => {
    const src = read('app/app/pos/stera-actions.ts');
    expect(src).toContain("if (req.status === 'sent' && !allowed)");
    expect(src).toContain('if (paid) return finalizeSucceeded(paid);');
  });
  it('stera の会計のあとはドロアを開ける', () => {
    expect(read('components/pos/pos-screen.tsx')).toContain('const handleSteraFinalized');
  });
  it('端末の設定は管理画面だけ', () => {
    expect(read('app/app/settings/payments/stera-actions.ts')).toContain('if (ctx.isRegisterDevice) return { ctx, error: ADMIN_ONLY };');
  });
});
