import { describe, it, expect } from 'vitest';
import { generateOrgCode, isOrgCode, normalizeOrgCode } from '@/lib/org-code';
import { decideRegisterLogin, type RegisterLoginCandidate } from '@/lib/register-login';
import { generateRegisterPassword, hashRegisterPassword, verifyRegisterPassword } from '@/lib/register-password';

const store = (over: Partial<RegisterLoginCandidate> & { storeId: string }): RegisterLoginCandidate => ({
  storeName: over.storeId,
  onNetwork: false,
  passwordOk: false,
  ...over,
});

describe('企業番号', () => {
  it('t1 + 5桁で作る', () => {
    expect(generateOrgCode(() => 0)).toBe('t100000');
    expect(generateOrgCode(() => 0.84203)).toBe('t184203');
    for (let i = 0; i < 50; i++) expect(isOrgCode(generateOrgCode())).toBe(true);
  });

  it('打ち間違いを吸収して比べる', () => {
    expect(normalizeOrgCode(' T1-84203 ')).toBe('t184203');
    expect(normalizeOrgCode('ｔ１８４２０３')).toBe('t184203');
    expect(isOrgCode('t18420')).toBe(false);
    expect(isOrgCode('t1842031')).toBe(false);
    expect(isOrgCode('x184203')).toBe(false);
  });
});

describe('レジ（iPad）のログインの決め方', () => {
  it('お店の回線から来ていなければ入れない', () => {
    expect(decideRegisterLogin([store({ storeId: 'a', passwordOk: true })])).toEqual({ kind: 'no_network' });
  });

  it('回線が合っていてもパスワードが違えば入れない', () => {
    expect(decideRegisterLogin([store({ storeId: 'a', onNetwork: true })])).toEqual({ kind: 'bad_password' });
  });

  it('回線とパスワードが合えば、その店舗のレジになる', () => {
    const list = [store({ storeId: 'a', onNetwork: true, passwordOk: true }), store({ storeId: 'b' })];
    expect(decideRegisterLogin(list)).toEqual({ kind: 'ok', storeId: 'a' });
  });

  it('同じ回線に複数の店舗があるときは選んでもらう', () => {
    const list = [
      store({ storeId: 'a', storeName: '1号店', onNetwork: true, passwordOk: true }),
      store({ storeId: 'b', storeName: '2号店', onNetwork: true, passwordOk: true }),
    ];
    expect(decideRegisterLogin(list)).toEqual({
      kind: 'choose',
      stores: [
        { id: 'a', name: '1号店' },
        { id: 'b', name: '2号店' },
      ],
    });
    expect(decideRegisterLogin(list, 'b')).toEqual({ kind: 'ok', storeId: 'b' });
    // 回線の外の店舗を指定しても通らない
    expect(decideRegisterLogin(list, 'zzz')).toEqual({ kind: 'no_network' });
  });
});

describe('レジ用パスワード', () => {
  it('読み間違えやすい文字を使わない', () => {
    for (let i = 0; i < 20; i++) expect(generateRegisterPassword()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('ハッシュで突き合わせる（平文は保存しない）', () => {
    const hash = hashRegisterPassword('ABCD2345');
    expect(hash).not.toContain('ABCD2345');
    expect(verifyRegisterPassword('ABCD2345', hash)).toBe(true);
    expect(verifyRegisterPassword('abcd2345', hash)).toBe(false);
    expect(verifyRegisterPassword('ABCD2345', null)).toBe(false);
    expect(verifyRegisterPassword('ABCD2345', 'こわれた値')).toBe(false);
  });
});
