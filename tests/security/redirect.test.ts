import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/safe-redirect';

describe('オープンリダイレクト対策 safeNextPath', () => {
  it('自サイト内の絶対パスは許可する', () => {
    expect(safeNextPath('/app/dashboard')).toBe('/app/dashboard');
    expect(safeNextPath('/app/orders?store=abc')).toBe('/app/orders?store=abc');
    expect(safeNextPath('/app/employees/123')).toBe('/app/employees/123');
  });

  it('プロトコル相対URL（//host）を拒否しfallbackへ', () => {
    expect(safeNextPath('//evil.com')).toBe('/app/dashboard');
    expect(safeNextPath('//evil.com/path')).toBe('/app/dashboard');
  });

  it('バックスラッシュ経由のホスト偽装（/\\host）を拒否', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/app/dashboard');
    expect(safeNextPath('/\\/evil.com')).toBe('/app/dashboard');
  });

  it('絶対URL（スキーム付き）を拒否', () => {
    expect(safeNextPath('https://evil.com')).toBe('/app/dashboard');
    expect(safeNextPath('http://evil.com')).toBe('/app/dashboard');
    expect(safeNextPath('javascript:alert(1)')).toBe('/app/dashboard');
    expect(safeNextPath('/javascript:alert(1)')).toBe('/app/dashboard');
  });

  it('制御文字・改行・タブ・空白による回避を拒否', () => {
    expect(safeNextPath('/\tevil')).toBe('/app/dashboard');
    expect(safeNextPath('/\nevil')).toBe('/app/dashboard');
    expect(safeNextPath('/ /evil.com')).toBe('/app/dashboard');
  });

  it('空・null・非パスはfallbackへ', () => {
    expect(safeNextPath(null)).toBe('/app/dashboard');
    expect(safeNextPath(undefined)).toBe('/app/dashboard');
    expect(safeNextPath('')).toBe('/app/dashboard');
    expect(safeNextPath('app/dashboard')).toBe('/app/dashboard'); // スラッシュ始まりでない
  });

  it('fallbackを指定できる', () => {
    expect(safeNextPath('//evil.com', '/login')).toBe('/login');
  });
});
