import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadDailyReportsPage } from '@/lib/daily-reports-server';
import { approveDailyReport, generateDailyReport, getDailyReportDetail, submitDailyReport } from '@/app/app/daily-reports/actions';
import {
  normalizeDailyMetrics,
  parseDailyReportGenerate,
  parseDailyReportSubmit,
  parseDailyReportsQuery,
  parseNativeId,
} from '@/lib/native-modules/daily-reports-input';
import { nativeBad, nativeErrorText, nativePageGuard, nativeRun } from '@/lib/native-modules/guard';
import type { NativeModuleGet, NativeModulePost } from '@/lib/native-modules/registry';

/**
 * 日報の iPad ネイティブ（GET part=dailyReports・dailyReport ／ POST dailyReportGenerate・dailyReportSubmit・dailyReportApprove）。
 * 中身・操作は Web の /app/daily-reports と同じ（lib/daily-reports-server.ts・app/app/daily-reports/actions.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

const PATH = '/app/daily-reports';

/** 対象日の店舗ごとの日報・過去の日報の検索（Web の画面と同じ） */
export const dailyReportsGet: NativeModuleGet = async ({ ctx, url }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const sp = parseDailyReportsQuery(url.searchParams);
  const d = await loadDailyReportsPage(ctx, await createClient(), sp);
  return {
    body: {
      ok: true,
      today: d.today,
      date: d.date,
      from: d.histFrom,
      to: d.histTo,
      store: sp.store ?? null,
      status: sp.status ?? null,
      canWrite: d.canWrite,
      canApprove: d.canApprove,
      stores: d.targetStores.map((s) => ({ id: s.id, name: s.name })),
      day: d.rows.map((r) => ({
        storeId: r.store.id,
        storeName: r.store.name,
        closed: r.closed,
        reportId: r.report?.id ?? null,
        status: r.report?.status ?? null,
      })),
      history: d.history,
    },
  };
};

/** 日報の詳細（?id=。担当店舗のみ。Web の ReportDetailDialog と同じ getDailyReportDetail） */
export const dailyReportGet: NativeModuleGet = async ({ ctx, url }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const id = parseNativeId({ id: url.searchParams.get('id') }, '日報');
  if (!id.ok) return nativeBad(id.error);
  try {
    const r = await getDailyReportDetail(id.value.id);
    return {
      body: {
        ok: true,
        report: {
          id: r.id,
          storeId: r.storeId,
          storeName: r.storeName,
          businessDate: r.businessDate,
          status: r.status,
          comment: r.comment,
          submittedAt: r.submittedAt,
          approvedAt: r.approvedAt,
          metrics: normalizeDailyMetrics(r.metrics),
        },
      },
    };
  } catch (e) {
    return nativeBad(nativeErrorText(e, '読み込みに失敗しました'), 404);
  }
};

/** 当日集計をスナップショットして日報を作る（作り直す）。承認済みは不可（generateDailyReport が確かめる） */
export const dailyReportGeneratePost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const p = parseDailyReportGenerate(raw);
  if (!p.ok) return nativeBad(p.error);
  return nativeRun(() => generateDailyReport(p.value.storeId, p.value.date), '生成に失敗しました');
};

/** コメントを付けて提出（下書き→提出済み） */
export const dailyReportSubmitPost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const p = parseDailyReportSubmit(raw);
  if (!p.ok) return nativeBad(p.error);
  return nativeRun(() => submitDailyReport(p.value.id, p.value.comment), '提出に失敗しました');
};

/** 本社の承認（提出済み→承認済み・監査ログ） */
export const dailyReportApprovePost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const p = parseNativeId(raw, '日報');
  if (!p.ok) return nativeBad(p.error);
  return nativeRun(() => approveDailyReport(p.value.id), '承認に失敗しました');
};
