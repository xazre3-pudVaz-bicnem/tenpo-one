import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { costingGet, costingImpactGet, costingWasteGet, costingItemGet, costingLinePost } from '@/lib/native-modules/costing';
import { kitchenGet, kdsItemStatusPost, kdsOrderServedPost, kdsSettingsPost } from '@/lib/native-modules/kitchen';
import { onboardingGet, onboardingPost } from '@/lib/native-modules/onboarding';
import { businessCardsGet } from '@/lib/native-modules/business-cards';
import * as payroll from '@/lib/native-modules/payroll';
import { accountingGet, ACCOUNTING_POST } from '@/lib/native-modules/accounting';
import * as attendance from '@/lib/native-modules/attendance';
import * as leave from '@/lib/native-modules/leave';
import { shiftsGet, SHIFT_POSTS } from '@/lib/native-modules/shifts';
import { EMPLOYEE_POSTS } from '@/lib/native-modules/employees';
import { dailyReportsGet, dailyReportGet, dailyReportGeneratePost, dailyReportSubmitPost, dailyReportApprovePost } from '@/lib/native-modules/daily-reports';
import { tasksGet, taskSavePost, taskStatusPost, taskCommentPost } from '@/lib/native-modules/tasks';
import { manualsGet, manualFileGet, manualCreatePost, manualDeletePost } from '@/lib/native-modules/manuals';
import * as invoices from '@/lib/native-modules/invoices';
import { reconciliationGet } from '@/lib/native-modules/reconciliation';
import { settlementGet, settlementCostsSavePost } from '@/lib/native-modules/settlement';
import { handyFloorGet, handyMenuGet, handyOrderPost, handySetupGet, handyTableGet } from '@/lib/native-modules/handy-order';
import { NATIVE_HANDY_ORDER_TYPES } from '@/lib/native-handy-order';

/**
 * まだ専用の台が無かった画面（勤怠・日報・タスク …）の iPad ネイティブ用の API をまとめる所
 * （2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）。
 *
 * GET /api/app/v1/pos?part=<part> → NATIVE_MODULE_GET[part]
 * POST /api/app/v1/pos { type: <type>, ... } → NATIVE_MODULE_POST[type]
 * 画面ごとに lib/native-modules/<name>.ts を作り、ここに 1 行ずつ足す。権限は各 handler の中で can() で確かめる
 * （route.ts は「アプリから・ログイン済み・pos.order」までしか見ない）。
 */

export interface NativeModuleArgs {
  ctx: SessionContext;
  /** 今の店舗（ctx.currentStore か最初の店舗） */
  store: { id: string; name: string };
}

export interface NativeModuleResult {
  status?: number;
  body: Record<string, unknown>;
}

export type NativeModuleGet = (args: NativeModuleArgs & { url: URL }) => Promise<NativeModuleResult>;
export type NativeModulePost = (args: NativeModuleArgs & { raw: Record<string, unknown> }) => Promise<NativeModuleResult>;

/** GET の part → handler。追加は 1 行ずつ */
export const NATIVE_MODULE_GET: Record<string, NativeModuleGet> = {
  kitchen: kitchenGet,
  onboarding: onboardingGet,
  businessCards: businessCardsGet,
  payroll: payroll.payrollGet,
  accounting: accountingGet,
  costing: costingGet,
  costingImpact: costingImpactGet,
  costingWaste: costingWasteGet,
  costingItem: costingItemGet,
  attendance: attendance.attendanceGet,
  leave: leave.leaveGet,
  shifts: shiftsGet,
  dailyReports: dailyReportsGet,
  dailyReport: dailyReportGet,
  tasks: tasksGet,
  manuals: manualsGet,
  manualFile: manualFileGet,
  invoices: invoices.invoicesGet,
  reconciliation: reconciliationGet,
  settlement: settlementGet,
  // iPhone のネイティブのハンディ（卓・注文。2026-10-25 Ronnie）
  handyTable: handyTableGet,
  handyMenu: handyMenuGet,
  handySetup: handySetupGet,
  handyFloor: handyFloorGet,
};

/** POST の type → handler。追加は 1 行ずつ */
export const NATIVE_MODULE_POST: Record<string, NativeModulePost> = {
  kdsItemStatus: kdsItemStatusPost,
  kdsOrderServed: kdsOrderServedPost,
  kdsSettings: kdsSettingsPost,
  onboarding: onboardingPost,
  payrollRuleSave: payroll.payrollRuleSavePost,
  payrollCommissionSave: payroll.payrollCommissionSavePost,
  payrollRunCreate: payroll.payrollRunCreatePost,
  payrollBonusCreate: payroll.payrollBonusCreatePost,
  payrollRunRecalc: payroll.payrollRunRecalcPost,
  payrollRunConfirm: payroll.payrollRunConfirmPost,
  payrollRunApprove: payroll.payrollRunApprovePost,
  payrollRunRevert: payroll.payrollRunRevertPost,
  nenchoSave: payroll.nenchoSavePost,
  nenchoSubmit: payroll.nenchoSubmitPost,
  nenchoReviewing: payroll.nenchoReviewingPost,
  nenchoConfirm: payroll.nenchoConfirmPost,
  nenchoReject: payroll.nenchoRejectPost,
  ...ACCOUNTING_POST, // 会計（accJournalSave・accBankCsvPreview … lib/native-modules/accounting.ts）
  costingLineAdd: costingLinePost,
  costingLineUpdate: costingLinePost,
  costingLineDelete: costingLinePost,
  attendancePunch: attendance.attendancePunchPost,
  attendancePunchPin: attendance.attendancePunchPinPost,
  attendanceCorrection: attendance.attendanceCorrectionPost,
  attendanceApprove: attendance.attendanceApprovePost,
  attendanceReject: attendance.attendanceRejectPost,
  attendanceEntryType: attendance.attendanceEntryTypePost,
  attendanceManualEntry: attendance.attendanceManualEntryPost,
  leaveRequest: leave.leaveRequestPost,
  leaveWithdraw: leave.leaveWithdrawPost,
  leaveApprove: leave.leaveApprovePost,
  leaveReject: leave.leaveRejectPost,
  leaveGrant: leave.leaveGrantPost,
  leavePolicy: leave.leavePolicyPost,
  ...SHIFT_POSTS,
  ...EMPLOYEE_POSTS,
  dailyReportGenerate: dailyReportGeneratePost,
  dailyReportSubmit: dailyReportSubmitPost,
  dailyReportApprove: dailyReportApprovePost,
  taskSave: taskSavePost,
  taskStatus: taskStatusPost,
  taskComment: taskCommentPost,
  manualCreate: manualCreatePost,
  manualDelete: manualDeletePost,
  invoiceCreate: invoices.invCreatePost,
  invoiceUpdate: invoices.invUpdatePost,
  invoiceStatus: invoices.invStatusPost,
  invoiceComment: invoices.invCommentPost,
  invoiceOcr: invoices.invOcrPost,
  invoiceTriage: invoices.invTriagePost,
  invoiceDocDelete: invoices.invDocDeletePost,
  invoiceDupCheck: invoices.invDupCheckPost,
  invoiceUpload: invoices.invUploadPost,
  invoiceInboxCreate: invoices.invInboxCreatePost,
  settlementCostsSave: settlementCostsSavePost,
  // iPhone のネイティブのハンディ（卓・注文。2026-10-25 Ronnie）
  ...Object.fromEntries(NATIVE_HANDY_ORDER_TYPES.map((t) => [t, handyOrderPost])),
};
