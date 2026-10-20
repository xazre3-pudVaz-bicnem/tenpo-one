import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cancelKindLabel, cancelKindOf, cancelReasonText, storeCancelMissingStaff } from '@/lib/reservation-cancel';

/**
 * 予約のキャンセルは3種類（2026-10-20 Ronnie）：
 * お客様キャンセル（連絡あり）・店舗キャンセル（担当を必ず選ぶ）・無断キャンセル（連絡なし・連絡が取れない）
 */
describe('キャンセルの種類', () => {
  it('理由の文', () => {
    expect(cancelReasonText('guest')).toBe('お客様キャンセル（連絡あり）');
    expect(cancelReasonText('store', { staffName: '佐藤' })).toBe('店舗キャンセル（担当: 佐藤）');
    expect(cancelReasonText('store', { staffName: '佐藤', note: '貸切のため' })).toBe('店舗キャンセル（担当: 佐藤）：貸切のため');
    expect(cancelReasonText('no_show')).toBe('無断キャンセル（連絡なし）');
  });
  it('店舗キャンセルは担当が無いと止める（画面・サーバーの両方）', () => {
    expect(() => cancelReasonText('store')).toThrow('担当');
    expect(() => cancelReasonText('store', { staffName: '  ' })).toThrow('担当');
    expect(storeCancelMissingStaff('店舗キャンセル')).toBe(true);
    expect(storeCancelMissingStaff('店舗キャンセル（担当: 佐藤）')).toBe(false);
    expect(storeCancelMissingStaff('お客様キャンセル（連絡あり）')).toBe(false);
    const actions = readFileSync(new URL('../app/app/reservations/actions.ts', import.meta.url), 'utf8');
    expect(actions).toContain("if (storeCancelMissingStaff(reason)) throw new Error('店舗キャンセルは担当を選んでください');");
  });
  it('メッセージの見出し：種類の名前（古い「貴店都合・お客様都合」も読む）', () => {
    expect(cancelKindLabel(cancelKindOf('cancelled', 'お客様キャンセル（連絡あり）'))).toBe('お客様キャンセル');
    expect(cancelKindLabel(cancelKindOf('cancelled', '店舗キャンセル（担当: 佐藤）'))).toBe('店舗キャンセル');
    expect(cancelKindLabel(cancelKindOf('cancelled', '貴店都合'))).toBe('店舗キャンセル');
    expect(cancelKindLabel(cancelKindOf('cancelled', 'お客様都合：電話あり'))).toBe('お客様キャンセル');
    expect(cancelKindLabel(cancelKindOf('no_show', null))).toBe('無断キャンセル');
    expect(cancelKindLabel(cancelKindOf('cancelled', 'ホットペッパーからキャンセル（メール取り込み）'))).toBe('キャンセル');
  });
  it('ハンディ・レジの予約台帳で同じ3種類を使い、店舗キャンセルは担当を選ぶ', () => {
    const handy = readFileSync(new URL('../components/handy/handy-reservation-detail.tsx', import.meta.url), 'utf8');
    const sheet = readFileSync(new URL('../components/reservations/reservation-sheet.tsx', import.meta.url), 'utf8');
    expect(handy).toContain('CANCEL_KINDS.map((k)');
    expect(handy).toContain('店舗キャンセル：担当を選んでください');
    expect(handy).toContain('onClick={() => cancel("store", st.name)}');
    expect(sheet).toContain('const CANCEL_REASONS = CANCEL_KINDS;');
    expect(sheet).toContain('店舗キャンセル：担当を選んでください（必須）');
    expect(handy).not.toContain('"貴店都合"');
  });
});
