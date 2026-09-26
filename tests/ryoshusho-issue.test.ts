import { describe, expect, it } from 'vitest';
import {
  RYOSHUSHO_DEFAULT_PURPOSE,
  jstShortDateTime,
  ryoshushoIssuedFrom,
} from '@/lib/ryoshusho-issue';

describe('領収書は一度きり（2026-09-26 Ronnie）', () => {
  it('領収書のジョブが無ければ未発行', () => {
    expect(ryoshushoIssuedFrom([])).toEqual({ issued: false, at: null, count: 0 });
    expect(ryoshushoIssuedFrom(null)).toEqual({ issued: false, at: null, count: 0 });
    // レシートだけ出していても領収書は未発行
    expect(ryoshushoIssuedFrom([{ job_type: 'receipt', status: 'printed' }]).issued).toBe(false);
  });

  it('プリンタ印字でもブラウザ印刷でも、1回出したら発行済み', () => {
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'printed', printed_at: '2026-09-26T12:12:00Z' }])).toEqual({
      issued: true,
      at: '2026-09-26T12:12:00Z',
      count: 1,
    });
    // プリンタが取りに来る途中（queued / claimed）も紙が出る前提なので発行済み
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'queued', created_at: '2026-09-26T12:00:00Z' }]).issued).toBe(true);
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'claimed', created_at: '2026-09-26T12:00:00Z' }]).issued).toBe(true);
  });

  it('失敗したジョブ（紙が出ていない）は数えない', () => {
    expect(ryoshushoIssuedFrom([{ job_type: 'ryoshusho', status: 'failed', created_at: '2026-09-26T12:00:00Z' }]).issued).toBe(false);
  });

  it('分割発行は枚数ぶん数え、最初の時刻を発行日時にする', () => {
    const s = ryoshushoIssuedFrom([
      { job_type: 'ryoshusho', status: 'printed', printed_at: '2026-09-26T12:12:30Z' },
      { job_type: 'ryoshusho', status: 'printed', printed_at: '2026-09-26T12:12:10Z' },
      { job_type: 'ryoshusho', status: 'failed', printed_at: null, created_at: '2026-09-26T11:00:00Z' },
    ]);
    expect(s.count).toBe(2);
    expect(s.at).toBe('2026-09-26T12:12:10Z');
  });

  it('既定の但し書きは「飲食代として」', () => {
    expect(RYOSHUSHO_DEFAULT_PURPOSE).toBe('飲食代として');
  });

  it('発行日時は日本時間の短い表記', () => {
    expect(jstShortDateTime('2026-09-26T12:12:00Z')).toBe('9/26 21:12');
    expect(jstShortDateTime(null)).toBe('');
    expect(jstShortDateTime('junk')).toBe('');
  });
});
