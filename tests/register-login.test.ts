import { describe, it, expect } from 'vitest';
import { generateOrgCode, isOrgCode, normalizeOrgCode } from '@/lib/org-code';
import {
  decideRegisterLogin,
  isStoreUser,
  normalizeStoreUser,
  suggestStoreUser,
  type RegisterLoginStore,
} from '@/lib/register-login';
import { generateRegisterPassword, hashRegisterPassword, verifyRegisterPassword } from '@/lib/register-password';

describe('企業番号', () => {
  it('6桁の数字で作る', () => {
    expect(generateOrgCode(() => 0)).toBe('000000');
    expect(generateOrgCode(() => 0.184203)).toBe('184203');
    expect(generateOrgCode(() => 0.999999)).toBe('999999');
    for (let i = 0; i < 50; i++) expect(isOrgCode(generateOrgCode())).toBe(true);
  });

  it('打ち間違いを吸収して比べる', () => {
    expect(normalizeOrgCode(' 184-203 ')).toBe('184203');
    expect(normalizeOrgCode('１８４２０３')).toBe('184203');
    expect(isOrgCode('18420')).toBe(false);
    expect(isOrgCode('1842031')).toBe(false);
    expect(isOrgCode('t184203')).toBe(false);
  });
});

describe('店舗ユーザー名', () => {
  it('形と打ち間違いの吸収', () => {
    expect(normalizeStoreUser(' Ronnies-House ')).toBe('ronnies-house');
    expect(normalizeStoreUser('ＲＯＮＮＩＥＳ')).toBe('ronnies');
    expect(isStoreUser('ronnies-house')).toBe(true);
    expect(isStoreUser('a')).toBe(false);
    expect(isStoreUser('-abc')).toBe(false);
    expect(isStoreUser('ロンニー')).toBe(false);
  });

  it('店舗名から候補を作る', () => {
    expect(suggestStoreUser("Ronnie's House（デモ）")).toBe('ronnie-s-house');
    expect(suggestStoreUser('SHUNKA 新宿')).toBe('shunka');
    expect(isStoreUser(suggestStoreUser('新宿本店'))).toBe(true);
  });
});

describe('レジ（iPad）のログインの決め方', () => {
  const base: RegisterLoginStore = {
    storeId: 's1',
    storeName: '1号店',
    passwordOk: true,
    restricted: true,
    onNetwork: true,
  };

  it('企業番号と店舗ユーザー名が合わなければ入れない', () => {
    expect(decideRegisterLogin(null)).toEqual({ kind: 'unknown_store' });
  });

  it('お店の回線の外からは入れない（パスワードが合っていても）', () => {
    expect(decideRegisterLogin({ ...base, onNetwork: false })).toEqual({ kind: 'off_network' });
  });

  it('回線を登録していない店舗は、どこからでも入れる（今まで通り）', () => {
    expect(decideRegisterLogin({ ...base, restricted: false, onNetwork: false })).toEqual({
      kind: 'ok',
      storeId: 's1',
    });
  });

  it('パスワードが違えば入れない', () => {
    expect(decideRegisterLogin({ ...base, passwordOk: false })).toEqual({ kind: 'bad_password' });
  });

  it('全部そろえば、その店舗のレジになる', () => {
    expect(decideRegisterLogin(base)).toEqual({ kind: 'ok', storeId: 's1' });
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

describe('レジ用パスワードを運営が見る（暗号化して保存）', () => {
  it('暗号化して戻せる。DBの中身を見ても読めない', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    const { encryptRegisterPassword, decryptRegisterPassword } = await import('@/lib/register-password');
    const enc = encryptRegisterPassword('ABCD2345');
    expect(enc).toBeTruthy();
    expect(enc).not.toContain('ABCD2345');
    expect(enc!.startsWith('v1.')).toBe(true);
    expect(decryptRegisterPassword(enc)).toBe('ABCD2345');
    // 同じパスワードでも毎回ちがう暗号文になる
    expect(encryptRegisterPassword('ABCD2345')).not.toBe(enc);
  });

  it('こわれた値・鍵ちがいは null（画面では「再発行してください」）', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    const { encryptRegisterPassword, decryptRegisterPassword } = await import('@/lib/register-password');
    const enc = encryptRegisterPassword('ABCD2345')!;
    expect(decryptRegisterPassword(null)).toBeNull();
    expect(decryptRegisterPassword('こわれた値')).toBeNull();
    expect(decryptRegisterPassword(enc.replace('v1.', 'v9.'))).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'another-key';
    expect(decryptRegisterPassword(enc)).toBeNull();
  });
});
