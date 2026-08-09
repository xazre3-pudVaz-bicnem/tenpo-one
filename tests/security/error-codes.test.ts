import { describe, expect, it, vi, afterEach } from 'vitest';
import { safePublicErrorCode } from '@/lib/observability';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('公開アクションのエラーコード漏洩対策 safePublicErrorCode', () => {
  it('契約コード（大文字＋アンダースコア）はそのまま通過する', () => {
    expect(safePublicErrorCode('SLOT_UNAVAILABLE')).toBe('SLOT_UNAVAILABLE');
    expect(safePublicErrorCode('RATE_LIMITED')).toBe('RATE_LIMITED');
    expect(safePublicErrorCode('CONSENT_REQUIRED')).toBe('CONSENT_REQUIRED');
    expect(safePublicErrorCode('INVALID_PARTY')).toBe('INVALID_PARTY');
  });

  it('コロン付き契約コードは先頭コードのみ通過する', () => {
    expect(safePublicErrorCode('PAYMENT_MISMATCH: total=100 payments=50')).toBe('PAYMENT_MISMATCH');
  });

  it('内部Postgresエラーはログのみ・UNKNOWNを返す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safePublicErrorCode('permission denied for table profiles')).toBe('UNKNOWN');
    expect(safePublicErrorCode('duplicate key value violates unique constraint "reservations_pkey"')).toBe('UNKNOWN');
    expect(safePublicErrorCode('null value in column "x" violates not-null constraint')).toBe('UNKNOWN');
    expect(spy).toHaveBeenCalled();
  });

  it('小文字・空白・記号を含む文字列は内部エラー扱い', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safePublicErrorCode('slot unavailable')).toBe('UNKNOWN');
    expect(safePublicErrorCode('Error: something broke')).toBe('UNKNOWN');
  });

  it('null/空はUNKNOWN（ログ不要）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safePublicErrorCode(null)).toBe('UNKNOWN');
    expect(safePublicErrorCode('')).toBe('UNKNOWN');
    expect(spy).not.toHaveBeenCalled();
  });
});
