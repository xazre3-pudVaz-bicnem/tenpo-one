import { describe, expect, it } from 'vitest';
import { isNativeScanActionType, nativeScanPath, parseNativeScanAction } from '@/lib/native-scan';

describe('native scan', () => {
  it('validates the upload', () => {
    expect(isNativeScanActionType('scanUpload')).toBe(true);
    const ok = parseNativeScanAction({ type: 'scanUpload', fileName: 'a/b.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA', txId: null });
    expect(ok).toEqual({ ok: true, action: { type: 'scanUpload', fileName: 'a_b.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA', txId: null } });
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.gif', mimeType: 'image/gif', dataBase64: 'AAAA' }).ok).toBe(false);
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.jpg', mimeType: 'image/jpeg', dataBase64: 'A'.repeat(4_100_000) }).ok).toBe(false);
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.jpg', mimeType: 'image/jpeg', dataBase64: '<script>' }).ok).toBe(false);
  });

  it('builds the same storage path as the web', () => {
    expect(nativeScanPath('org', null, 'image/jpeg', 'u', new Date(2026, 9, 24))).toBe('org/hq/2026/10/u.jpg');
    expect(nativeScanPath('org', 's1', 'application/pdf', 'u', new Date(2026, 0, 2))).toBe('org/s1/2026/01/u.pdf');
  });
});
