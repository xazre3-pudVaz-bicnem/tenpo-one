import { describe, expect, it } from 'vitest';
import { isNativeScanActionType, nativeScanDayPath, nativeScanPath, parseNativeScanAction } from '@/lib/native-scan';

describe('native scan', () => {
  it('validates the upload', () => {
    expect(isNativeScanActionType('scanUpload')).toBe(true);
    const ok = parseNativeScanAction({ type: 'scanUpload', fileName: 'a/b.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA', txId: null });
    // 撮影（今までの形）：contentHash・dayFolder は無し（null・false）＝今までと同じ保存先
    expect(ok).toEqual({ ok: true, action: { type: 'scanUpload', fileName: 'a_b.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA', txId: null, contentHash: null, dayFolder: false } });
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.gif', mimeType: 'image/gif', dataBase64: 'AAAA' }).ok).toBe(false);
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.jpg', mimeType: 'image/jpeg', dataBase64: 'A'.repeat(4_100_000) }).ok).toBe(false);
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.jpg', mimeType: 'image/jpeg', dataBase64: '<script>' }).ok).toBe(false);
  });

  it('ScanSnap のまとめて取り込み：PDF・中身の SHA-256・その日のフォルダ', () => {
    const hash = 'a'.repeat(64);
    const r = parseNativeScanAction({ type: 'scanUpload', fileName: 'scan.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0=', txId: null, contentHash: hash, dayFolder: true });
    expect(r).toEqual({ ok: true, action: { type: 'scanUpload', fileName: 'scan.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0=', txId: null, contentHash: hash, dayFolder: true } });
    // 形の違うハッシュは受けない
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.pdf', mimeType: 'application/pdf', dataBase64: 'AAAA', contentHash: 'XYZ' }).ok).toBe(false);
    expect(parseNativeScanAction({ type: 'scanUpload', fileName: 'x.pdf', mimeType: 'application/pdf', dataBase64: 'AAAA', contentHash: 'A'.repeat(64) }).ok).toBe(false);
    // dayFolder は true のときだけ
    const s = parseNativeScanAction({ type: 'scanUpload', fileName: 'x.pdf', mimeType: 'application/pdf', dataBase64: 'AAAA', dayFolder: 'yes' });
    expect(s.ok && s.action.dayFolder).toBe(false);
  });

  it('まとめて取り込みの保存先は Web の ScanBulkImport と同じ（…/年/月/日/）', () => {
    expect(nativeScanDayPath('org', null, 'application/pdf', 'u', '2026-10-25')).toBe('org/hq/2026/10/25/u.pdf');
    expect(nativeScanDayPath('org', 's1', 'image/jpeg', 'u', '2026-01-02')).toBe('org/s1/2026/01/02/u.jpg');
    expect(nativeScanDayPath('org', 's1', 'image/png', 'u', '2026-12-31')).toBe('org/s1/2026/12/31/u.png');
  });

  it('builds the same storage path as the web', () => {
    expect(nativeScanPath('org', null, 'image/jpeg', 'u', new Date(2026, 9, 24))).toBe('org/hq/2026/10/u.jpg');
    expect(nativeScanPath('org', 's1', 'application/pdf', 'u', new Date(2026, 0, 2))).toBe('org/s1/2026/01/u.pdf');
  });
});
