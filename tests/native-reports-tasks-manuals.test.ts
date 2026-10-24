import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeDailyMetrics,
  parseDailyReportGenerate,
  parseDailyReportSubmit,
  parseDailyReportsQuery,
  parseNativeId,
} from '@/lib/native-modules/daily-reports-input';
import { parseTaskComment, parseTaskSave, parseTaskStatus, parseTasksQuery } from '@/lib/native-modules/tasks-input';
import { manualFileKind, manualFileName, manualUploadPath, parseManualCreate, NATIVE_MANUAL_MAX_BYTES } from '@/lib/native-modules/manuals-input';

// iPad ネイティブの日報・タスク・マニュアル（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('native daily reports input', () => {
  it('reads the search query and drops bad values', () => {
    const q = parseDailyReportsQuery(new URLSearchParams({ date: '2026-10-23', from: '2026-09-24', to: 'x', store: ID, status: 'submitted' }));
    expect(q).toEqual({ date: '2026-10-23', from: '2026-09-24', to: undefined, store: ID, status: 'submitted' });
    expect(parseDailyReportsQuery(new URLSearchParams({ store: 'abc', status: 'nope' }))).toEqual({
      date: undefined, from: undefined, to: undefined, store: undefined, status: undefined,
    });
  });

  it('parses generate / submit / approve', () => {
    expect(parseDailyReportGenerate({ storeId: ID, date: '2026-10-23' })).toEqual({ ok: true, value: { storeId: ID, date: '2026-10-23' } });
    expect(parseDailyReportGenerate({ storeId: ID, date: '10/23' }).ok).toBe(false);
    expect(parseDailyReportGenerate({ storeId: 'x', date: '2026-10-23' }).ok).toBe(false);
    expect(parseDailyReportSubmit({ id: ID, comment: '申し送り' })).toEqual({ ok: true, value: { id: ID, comment: '申し送り' } });
    expect(parseDailyReportSubmit({ id: ID })).toEqual({ ok: true, value: { id: ID, comment: '' } });
    expect(parseDailyReportSubmit({ id: ID, comment: 3 }).ok).toBe(false);
    expect(parseNativeId({ id: ID }, '日報')).toEqual({ ok: true, value: { id: ID } });
    expect(parseNativeId({ id: null }, '日報')).toEqual({ ok: false, error: '日報が正しくありません' });
  });

  it('normalizes metrics, including reports made before v0.4.2', () => {
    const now = normalizeDailyMetrics({
      grossSales: 120000, discounts: 2000, refunds: 1000, netSales: 119000, guests: 40, avgSpend: 2975,
      cashDifference: null, closingExists: false, reservationsCount: 5, cancelCount: 1, wasteAmount: 800, laborCost: 30000,
    });
    expect(now).toEqual({
      legacy: false, grossSales: 120000, discounts: 2000, refunds: 1000, netSales: 119000, guests: 40, avgSpend: 2975,
      cashDifference: null, closingExists: false, reservationsCount: 5, cancelCount: 1, wasteAmount: 800, laborCost: 30000,
    });
    const old = normalizeDailyMetrics({ sales: 50000, discounts: 100, guests: 10, avgSpend: 5000, cashDifference: -200, closingExists: true });
    expect(old.legacy).toBe(true);
    expect(old.grossSales).toBe(50000);
    expect(old.discounts).toBeNull();
    expect(old.netSales).toBeNull();
    expect(old.cashDifference).toBe(-200);
    expect(old.closingExists).toBe(true);
    expect(normalizeDailyMetrics(null).grossSales).toBeNull();
  });
});

describe('native tasks input', () => {
  it('reads the filters', () => {
    expect(parseTasksQuery(new URLSearchParams({ status: 'done', priority: 'high', assignee: ID, store: ID2 }))).toEqual({
      status: 'done', priority: 'high', assignee: ID, store: ID2,
    });
    expect(parseTasksQuery(new URLSearchParams({ status: 'x', priority: 'urgent' }))).toEqual({
      status: undefined, priority: undefined, assignee: undefined, store: undefined,
    });
  });

  it('parses create / edit like the web form (empty → null, priority defaults to normal)', () => {
    expect(parseTaskSave({ storeId: ID, title: '冷蔵庫の掃除', body: '', assigneeId: '', dueDate: '', priority: '' })).toEqual({
      ok: true,
      value: { id: undefined, input: { storeId: ID, title: '冷蔵庫の掃除', body: null, assigneeId: null, dueDate: null, priority: 'normal' } },
    });
    expect(parseTaskSave({ id: ID2, storeId: ID, title: 'a', body: 'b', assigneeId: ID2, dueDate: '2026-10-30', priority: 'high' })).toEqual({
      ok: true,
      value: { id: ID2, input: { storeId: ID, title: 'a', body: 'b', assigneeId: ID2, dueDate: '2026-10-30', priority: 'high' } },
    });
    expect(parseTaskSave({ storeId: ID, title: '  ' })).toEqual({ ok: false, error: 'タイトルを入力してください' });
    expect(parseTaskSave({ storeId: ID, title: 'a', priority: 'urgent' }).ok).toBe(false);
    expect(parseTaskSave({ storeId: ID, title: 'a', dueDate: '2026/10/30' }).ok).toBe(false);
    expect(parseTaskSave({ storeId: ID, title: 'a', assigneeId: 'someone' }).ok).toBe(false);
    expect(parseTaskSave({ id: 'x', storeId: ID, title: 'a' }).ok).toBe(false);
  });

  it('parses status changes and comments', () => {
    expect(parseTaskStatus({ id: ID, next: 'in_progress' })).toEqual({ ok: true, value: { id: ID, next: 'in_progress' } });
    expect(parseTaskStatus({ id: ID, next: 'archived' }).ok).toBe(false);
    expect(parseTaskComment({ id: ID, body: '対応しました' })).toEqual({ ok: true, value: { id: ID, body: '対応しました' } });
    expect(parseTaskComment({ id: ID, body: ' ' })).toEqual({ ok: false, error: 'コメントを入力してください' });
  });
});

describe('native manuals input', () => {
  const base = { title: '開店手順', category: 'register', target: 'store', note: '' };

  it('parses a URL manual', () => {
    expect(parseManualCreate({ ...base, mode: 'url', url: ' https://example.com/manual ' })).toEqual({
      ok: true,
      value: { title: '開店手順', category: 'register', target: 'store', note: null, source: { kind: 'url', url: 'https://example.com/manual' } },
    });
    expect(parseManualCreate({ ...base, mode: 'url', url: '' })).toEqual({ ok: false, error: 'URLを入力してください' });
    expect(parseManualCreate({ ...base, mode: 'url', url: 'javascript:alert(1)' }).ok).toBe(false);
  });

  it('parses a file manual and checks type / size', () => {
    const r = parseManualCreate({ ...base, target: 'all', mode: 'file', fileName: 'a/b.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0x' });
    expect(r).toEqual({
      ok: true,
      value: { title: '開店手順', category: 'register', target: 'all', note: null, source: { kind: 'file', fileName: 'a_b.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0x' } },
    });
    expect(parseManualCreate({ ...base, mode: 'file', fileName: 'a.gif', mimeType: 'image/gif', dataBase64: 'R0lG' }).ok).toBe(false);
    expect(parseManualCreate({ ...base, mode: 'file', fileName: 'a.jpg', mimeType: 'image/jpeg', dataBase64: '' }).ok).toBe(false);
    const big = 'A'.repeat(Math.ceil(((NATIVE_MANUAL_MAX_BYTES + 100) * 4) / 3));
    expect(parseManualCreate({ ...base, mode: 'file', fileName: 'a.jpg', mimeType: 'image/jpeg', dataBase64: big }).ok).toBe(false);
  });

  it('checks title / category / target', () => {
    expect(parseManualCreate({ ...base, title: '', mode: 'url', url: 'https://x.jp' })).toEqual({ ok: false, error: 'タイトルを入力してください' });
    expect(parseManualCreate({ ...base, category: 'party', mode: 'url', url: 'https://x.jp' }).ok).toBe(false);
    expect(parseManualCreate({ ...base, target: 'hq', mode: 'url', url: 'https://x.jp' }).ok).toBe(false);
    expect(parseManualCreate({ ...base, mode: 'fax' }).ok).toBe(false);
  });

  it('builds the storage path like the web form and tells PDF from images', () => {
    expect(manualUploadPath('org', 'u', 'image/jpeg')).toBe('org/manuals/u.jpg');
    expect(manualUploadPath('org', 'u', 'application/pdf')).toBe('org/manuals/u.pdf');
    expect(manualUploadPath('org', 'u', 'image/webp')).toBe('org/manuals/u.webp');
    expect(manualFileKind('org/manuals/u.PDF')).toBe('pdf');
    expect(manualFileKind('org/manuals/u.jpeg')).toBe('image');
    expect(manualFileKind('org/manuals/u.docx')).toBe('other');
  });

  it('fixes the file name so the web upload check (extension) passes', () => {
    expect(manualFileName('手順書.pdf', 'application/pdf')).toBe('手順書.pdf');
    expect(manualFileName('IMG_0001.HEIC', 'image/jpeg')).toBe('IMG_0001.HEIC.jpg');
    expect(manualFileName('photo.JPEG', 'image/jpeg')).toBe('photo.JPEG');
    expect(manualFileName('scan', 'image/png')).toBe('scan.png');
    expect(manualFileName('a/b\\c.webp', 'image/webp')).toBe('a_b_c.webp');
    expect(manualFileName('   ', 'application/pdf')).toBe('');
    expect(manualFileName(`${'x'.repeat(200)}.pdf`, 'application/pdf')).toHaveLength(120);
    expect(manualFileName(`${'x'.repeat(200)}.pdf`, 'application/pdf').endsWith('.pdf')).toBe(true);
  });
});

describe('registration (server registry + iPad)', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('registers the GET parts and POST types', () => {
    const registry = read('lib/native-modules/registry.ts');
    for (const line of [
      'dailyReports: dailyReportsGet',
      'dailyReport: dailyReportGet',
      'tasks: tasksGet',
      'manuals: manualsGet',
      'manualFile: manualFileGet',
      'dailyReportGenerate: dailyReportGeneratePost',
      'dailyReportSubmit: dailyReportSubmitPost',
      'dailyReportApprove: dailyReportApprovePost',
      'taskSave: taskSavePost',
      'taskStatus: taskStatusPost',
      'taskComment: taskCommentPost',
      'manualCreate: manualCreatePost',
      'manualDelete: manualDeletePost',
    ]) {
      expect(registry).toContain(line);
    }
  });

  it('opens the three web paths natively on the iPad', () => {
    const swift = read('ios/Shared/NativeModules.swift');
    expect(swift).toContain('("/app/daily-reports", "dailyReports")');
    expect(swift).toContain('("/app/tasks", "tasks")');
    expect(swift).toContain('("/app/manuals", "manuals")');
    expect(swift).toContain('case "dailyReports": NativeDailyReportsView(');
    expect(swift).toContain('case "tasks": NativeTasksView(');
    expect(swift).toContain('case "manuals": NativeManualsView(');
  });

  it('the iPad sends the same types the server reads', () => {
    const reports = read('ios/Shared/NativeDailyReportsView.swift');
    expect(reports).toContain('part: "dailyReports"');
    expect(reports).toContain('part: "dailyReport"');
    for (const t of ['dailyReportGenerate', 'dailyReportSubmit', 'dailyReportApprove']) expect(reports).toContain(`"type": "${t}"`);
    const tasks = read('ios/Shared/NativeTasksView.swift');
    expect(tasks).toContain('part: "tasks"');
    for (const t of ['taskSave', 'taskStatus', 'taskComment']) expect(tasks).toContain(`"type": "${t}"`);
    const manuals = read('ios/Shared/NativeManualsView.swift');
    expect(manuals).toContain('part: "manuals"');
    expect(manuals).toContain('part: "manualFile"');
    for (const t of ['manualCreate', 'manualDelete']) expect(manuals).toContain(`"type": "${t}"`);
    // iPad から送れる大きさはサーバーの上限と同じ
    expect(manuals).toContain(`${NATIVE_MANUAL_MAX_BYTES}`.replace(/\B(?=(\d{3})+(?!\d))/g, '_'));
  });
});
