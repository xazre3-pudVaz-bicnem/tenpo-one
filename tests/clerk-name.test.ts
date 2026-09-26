import { describe, expect, it } from 'vitest';
import { normalizeClerkName } from '@/lib/clerk-name';

describe('担当者名の表記（先頭だけ大文字。2026-09-27 Ronnie）', () => {
  it('英字だけの単語は先頭だけ大文字', () => {
    expect(normalizeClerkName('XITRI')).toBe('Xitri');
    expect(normalizeClerkName('miyazaki')).toBe('Miyazaki');
    expect(normalizeClerkName('rONNIE')).toBe('Ronnie');
    expect(normalizeClerkName('  ronnie   shrestha ')).toBe('Ronnie Shrestha');
  });
  it('日本語・数字・記号入りはそのまま', () => {
    expect(normalizeClerkName('田中')).toBe('田中');
    expect(normalizeClerkName('Staff-2')).toBe('Staff-2');
    expect(normalizeClerkName("O'BRIEN")).toBe("O'BRIEN");
    expect(normalizeClerkName('ホール1')).toBe('ホール1');
  });
});
