import { describe, expect, it } from 'vitest';
import {
  APPROVAL_LABELS,
  DEVICE_MESSAGE,
  MAX_PENDING_PER_TYPE,
  approvalApplies,
  approvalFrom,
  contractColumnsFrom,
  decideApprove,
  decideDeviceJoin,
  deviceLimitFrom,
  deviceStateLabel,
  isDeviceToken,
  isDeviceType,
  joinBlockMessage,
} from '@/lib/device-control';
import { ACCESS_MESSAGE, registerBlockMessage, registerDecisionFrom } from '@/lib/store-access';
import { QR_ORDER_OFF_MESSAGE, resolveQrOrderFlag } from '@/lib/qr-order-flag';
import { displayScreenOf } from '@/lib/display-monitor';

/**
 * コントロールセンター（2026-10-25 Ronnie）：端末の契約 ON/OFF・台数・運営の承認、テーブルQR の ON/OFF の決まり（純関数）。
 */

const join = (over: Partial<Parameters<typeof decideDeviceJoin>[0]> = {}) =>
  decideDeviceJoin({
    contractEnabled: true,
    approvalRequired: true,
    known: null,
    approvedActive: 0,
    pending: 0,
    limit: 2,
    reactivatable: false,
    ...over,
  });

describe('承認の状態の読み方（今使っている端末を止めない）', () => {
  it('列が無い（migration 00104 の前）・空・知らない値は承認済み', () => {
    expect(approvalFrom(undefined)).toBe('approved');
    expect(approvalFrom(null)).toBe('approved');
    expect(approvalFrom('')).toBe('approved');
    expect(approvalFrom('weird')).toBe('approved');
    expect(approvalFrom('approved')).toBe('approved');
    expect(approvalFrom('pending')).toBe('pending');
    expect(approvalFrom('rejected')).toBe('rejected');
    expect(approvalFrom('revoked')).toBe('revoked');
    expect(APPROVAL_LABELS.pending).toBe('承認待ち');
  });

  it('契約の列：行が無い・壊れた値は ON・既定の台数。明示的に false のときだけ OFF', () => {
    expect(contractColumnsFrom(null)).toEqual({ registerEnabled: true, handyEnabled: true, displayLimit: 2 });
    expect(contractColumnsFrom({ register_enabled: null, handy_enabled: 'no', display_limit: -1 })).toEqual({
      registerEnabled: true,
      handyEnabled: true,
      displayLimit: 2,
    });
    expect(contractColumnsFrom({ register_enabled: false, handy_enabled: false, display_limit: 99 })).toEqual({
      registerEnabled: false,
      handyEnabled: false,
      displayLimit: 20,
    });
    expect(deviceLimitFrom(0, 2)).toBe(0);
    expect(deviceLimitFrom(3.5, 2)).toBe(2);
  });

  it('承認制をかける店舗：migration の前はどこもかけない。レジは台数を数えている店舗だけ。ハンディ・ディスプレイは全店舗', () => {
    expect(approvalApplies('register', { ready: false, countsRegister: true })).toBe(false);
    expect(approvalApplies('handy', { ready: false, countsRegister: true })).toBe(false);
    expect(approvalApplies('display', { ready: false, countsRegister: false })).toBe(false);
    expect(approvalApplies('register', { ready: true, countsRegister: false })).toBe(false);
    expect(approvalApplies('register', { ready: true, countsRegister: true })).toBe(true);
    expect(approvalApplies('handy', { ready: true, countsRegister: false })).toBe(true);
    expect(approvalApplies('display', { ready: true, countsRegister: false })).toBe(true);
  });

  it('小さな道具', () => {
    expect(isDeviceType('register')).toBe(true);
    expect(isDeviceType('printer')).toBe(false);
    expect(isDeviceToken('ab'.repeat(24))).toBe(true);
    expect(isDeviceToken('xyz')).toBe(false);
    expect(deviceStateLabel({ approval: 'pending', active: true })).toBe('承認待ち');
    expect(deviceStateLabel({ approval: 'approved', active: true })).toBe('使用中');
    expect(deviceStateLabel({ approval: 'approved', active: false })).toBe('解除済み');
  });
});

describe('端末がつなごうとしたとき（decideDeviceJoin）', () => {
  it('契約 OFF の種類は、承認済みの端末でも使えない', () => {
    expect(join({ contractEnabled: false, known: { approval: 'approved', active: true } })).toEqual({ kind: 'contract_off' });
    expect(join({ contractEnabled: false })).toEqual({ kind: 'contract_off' });
  });

  it('新しい端末：承認制なら承認待ちで作る。台数いっぱい・承認待ちが多すぎるなら作らない', () => {
    expect(join()).toEqual({ kind: 'request' });
    expect(join({ approvedActive: 2 })).toEqual({ kind: 'limit', limit: 2 });
    // 承認待ちは台数に数えない（運営が台数を増やしてから承認できる）
    expect(join({ approvedActive: 1, pending: 3 })).toEqual({ kind: 'request' });
    expect(join({ pending: MAX_PENDING_PER_TYPE })).toEqual({ kind: 'too_many_pending' });
    // 数えない（limit null）なら台数は見ない
    expect(join({ limit: null, approvedActive: 99 })).toEqual({ kind: 'request' });
  });

  it('承認制でない（migration の前・レジを数えない店舗）：今まで通り、台数に空きがあればそのまま作る', () => {
    expect(join({ approvalRequired: false })).toEqual({ kind: 'create' });
    expect(join({ approvalRequired: false, approvedActive: 2 })).toEqual({ kind: 'limit', limit: 2 });
    expect(join({ approvalRequired: false, pending: 99 })).toEqual({ kind: 'create' });
  });

  it('分かっている端末は承認の状態どおり', () => {
    expect(join({ known: { approval: 'pending', active: true } })).toEqual({ kind: 'pending' });
    expect(join({ known: { approval: 'rejected', active: false } })).toEqual({ kind: 'rejected' });
    expect(join({ known: { approval: 'revoked', active: false } })).toEqual({ kind: 'revoked' });
    // 承認済みで使用中：台数いっぱいでも使える（自分も数に入っている）
    expect(join({ known: { approval: 'approved', active: true }, approvedActive: 2 })).toEqual({ kind: 'allow', reactivate: false });
  });

  it('承認済みで止まっている端末：レジ（使い直せない種類）は解除のまま、ハンディは空きがあれば使い直す（承認し直し不要）', () => {
    expect(join({ known: { approval: 'approved', active: false } })).toEqual({ kind: 'revoked' });
    expect(join({ known: { approval: 'approved', active: false }, reactivatable: true })).toEqual({ kind: 'allow', reactivate: true });
    expect(join({ known: { approval: 'approved', active: false }, reactivatable: true, approvedActive: 2 })).toEqual({ kind: 'limit', limit: 2 });
  });

  it('止める判定 → 端末に出す文（種類ごと）', () => {
    expect(joinBlockMessage('handy', { kind: 'pending' })).toBe(DEVICE_MESSAGE.pendingHandy);
    expect(joinBlockMessage('register', { kind: 'pending' })).toBe(DEVICE_MESSAGE.pendingRegister);
    expect(joinBlockMessage('display', { kind: 'pending' })).toBe(DEVICE_MESSAGE.pending);
    expect(joinBlockMessage('handy', { kind: 'contract_off' })).toContain('契約が停止しています');
    expect(joinBlockMessage('display', { kind: 'limit', limit: 1 })).toBe(DEVICE_MESSAGE.limit.display);
    expect(joinBlockMessage('handy', { kind: 'too_many_pending' })).toBe(DEVICE_MESSAGE.tooManyPending);
    expect(joinBlockMessage('handy', { kind: 'request' })).toBeNull();
    expect(joinBlockMessage('handy', { kind: 'allow', reactivate: false })).toBeNull();
    expect(DEVICE_MESSAGE.pending).toBe('この端末は TENPO ONE 運営の承認待ちです。承認されると使えます');
  });
});

describe('運営が承認を押したとき（decideApprove）', () => {
  const approve = (over: Partial<Parameters<typeof decideApprove>[0]> = {}) =>
    decideApprove({ type: 'handy', contractEnabled: true, current: 'pending', active: true, approvedActive: 0, limit: 2, ...over });

  it('承認待ち → 承認できる', () => {
    expect(approve()).toEqual({ ok: true, noop: false });
  });
  it('すでに承認済みで使用中なら何もしない', () => {
    expect(approve({ current: 'approved', active: true, contractEnabled: false, approvedActive: 9 })).toEqual({ ok: true, noop: true });
  });
  it('契約 OFF・台数いっぱいなら承認しない（理由つき）', () => {
    const off = approve({ contractEnabled: false });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toContain('契約が OFF');
    const full = approve({ approvedActive: 2 });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error).toContain('契約台数（2台）');
    expect(approve({ approvedActive: 2, limit: null })).toEqual({ ok: true, noop: false });
  });
  it('運営が解除・却下した端末の承認し直し', () => {
    expect(approve({ current: 'revoked', active: false })).toEqual({ ok: true, noop: false });
    expect(approve({ current: 'rejected', active: false })).toEqual({ ok: true, noop: false });
  });
});

describe('レジの判定（lib/store-access.ts）', () => {
  it('端末の判定 → レジの判定', () => {
    expect(registerDecisionFrom({ kind: 'allow', reactivate: false })).toEqual({ kind: 'allowed' });
    expect(registerDecisionFrom({ kind: 'request' })).toEqual({ kind: 'register' });
    expect(registerDecisionFrom({ kind: 'create' })).toEqual({ kind: 'register' });
    expect(registerDecisionFrom({ kind: 'limit', limit: 3 })).toEqual({ kind: 'limit', limit: 3 });
    expect(registerDecisionFrom({ kind: 'pending' })).toEqual({ kind: 'pending' });
    expect(registerDecisionFrom({ kind: 'contract_off' })).toEqual({ kind: 'contract_off' });
  });
  it('承認制の前は今までの文のまま。承認制では運営あての文', () => {
    expect(registerBlockMessage({ kind: 'allowed' }, true)).toBeNull();
    expect(registerBlockMessage({ kind: 'register' }, true)).toBeNull();
    expect(registerBlockMessage({ kind: 'limit', limit: 2 }, false)).toBe(ACCESS_MESSAGE.limit);
    expect(registerBlockMessage({ kind: 'revoked' }, false)).toBe(ACCESS_MESSAGE.revoked);
    expect(registerBlockMessage({ kind: 'revoked' }, true)).toBe(DEVICE_MESSAGE.revoked);
    expect(registerBlockMessage({ kind: 'pending' }, true)).toBe(DEVICE_MESSAGE.pendingRegister);
    expect(registerBlockMessage({ kind: 'contract_off' }, true)).toBe(DEVICE_MESSAGE.contractOff.register);
    expect(registerBlockMessage({ kind: 'rejected' }, true)).toBe(DEVICE_MESSAGE.rejected);
    expect(registerBlockMessage({ kind: 'too_many_pending' }, true)).toBe(DEVICE_MESSAGE.tooManyPending);
  });
});

describe('テーブルQR の ON/OFF（lib/qr-order-flag.ts）', () => {
  it('行が無い＝ON（今 QR 注文を使っている店舗はそのまま）', () => {
    expect(resolveQrOrderFlag({ orgEnabled: null, storeEnabled: null })).toEqual({ on: true, reason: 'on' });
    expect(resolveQrOrderFlag({ orgEnabled: true, storeEnabled: true })).toEqual({ on: true, reason: 'on' });
  });
  it('企業の OFF が先・店舗の OFF はその店舗だけ', () => {
    expect(resolveQrOrderFlag({ orgEnabled: false, storeEnabled: true })).toEqual({ on: false, reason: 'company_off' });
    expect(resolveQrOrderFlag({ orgEnabled: null, storeEnabled: false })).toEqual({ on: false, reason: 'store_off' });
    expect(QR_ORDER_OFF_MESSAGE).toBe('この店舗では QR 注文を受け付けていません');
  });
});

describe('ディスプレイ端末：承認待ちの画面', () => {
  it('承認待ち：案内を出して 30 秒ごとに読み直す（見守りは続ける＝承認されると自動で切り替わる）', () => {
    const s = displayScreenOf({ kind: 'pending', name: '厨房モニター', storeName: '新宿店' });
    expect(s).toMatchObject({ screen: 'notice', icon: 'loading', title: 'TENPO ONE 運営の承認待ちです', refreshMs: 30_000, heartbeat: true });
    if (s.screen === 'notice') {
      expect(s.body).toContain('承認されると使えます');
      expect(s.footer).toBe('新宿店・厨房モニター');
    }
  });
});
