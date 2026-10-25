import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { MAX_FILE_SIZE, validateUploadMeta } from '@/components/invoices/labels';
import { checkScanDuplicate, createScanDocument, fileScan, planScanFiling, type ScanPlan } from '@/app/app/scan/actions';
import { readScan } from '@/lib/receipt-read';
import { scanFilingChoices } from '@/lib/scan-filing-choices';
import { NATIVE_SCAN_MAX_BYTES, nativeScanDayPath } from '@/lib/native-scan';
import {
  SCAN_BULK_MAX_FILES,
  parseScanCheck,
  parseScanFile,
  parseScanPlan,
  parseScanRegister,
  parseScanUploadMeta,
  scanBulkOptions,
} from '@/lib/native-scan-bulk';
import type { NativeModuleArgs, NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * ScanSnap のまとめて取り込み（Web の /app/scan#scan-bulk・components/scan/scan-bulk-import.tsx）の iPad ネイティブ。
 * 2026-10-25 Ronnie「iPad のサブメニューのサブメニューまで全部ネイティブ」。
 *
 *   GET  part=scanBulk          … 画面の準備（権限・今日・選択肢）
 *   POST scanBulkCheck          … 取り込む前の重複チェック（checkScanDuplicate）
 *   POST scanUpload（route.ts） … 3MB までのファイル（dayFolder・contentHash。lib/native-scan.ts）
 *   POST scanBulkUploadUrl      … 3MB を超えるファイル：保存ボックスへ直接上げる URL（Web がブラウザから上げるのと同じ場所）
 *   POST scanBulkRegister       … 直接上げたファイルを書類に（createScanDocument）
 *   POST scanBulkPlan           … 読み取った行 → readScan(lines, todayJst()) → planScanFiling。直した内容（reading）の出し直しも
 *   POST scanBulkFile           … 確かめた内容で仕分ける（fileScan）
 * 権限は Web と同じ：機能 accounting（/app/scan の requireFeature）・documents.write（どの Server Action も）。
 * 出金への紐付け（cash.write）は planScanFiling・fileScan の中で Web と同じに確かめる。文字の読み方はサーバーの lib/receipt-read.ts だけ。
 */

type Ctx = NativeModuleArgs['ctx'];

function gate(ctx: Ctx): NativeModuleResult | null {
  if (ctx.disabledFeatures?.has('accounting')) return { status: 403, body: { ok: false, error: 'この機能は使えません', useWeb: true } };
  if (!can(ctx.role, 'documents.write') || !ctx.organizationId) {
    return { status: 403, body: { ok: false, error: '書類をアップロードする権限がありません。店長・経理担当者に依頼してください。' } };
  }
  return null;
}

const fail = (error: string, status = 400): NativeModuleResult => ({ status, body: { ok: false, error } });

/** Server Action の投げたことば（Web の画面に出るのと同じ）。Next の内部のことばは出さない */
function messageOf(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  if (!raw || /Minified React error|Server Components render|digest|NEXT_REDIRECT/i.test(raw)) return fallback;
  return raw;
}

/** Web と同じ：今の店舗（「全店舗」のときは null＝本部 hq のフォルダ） */
const storeIdOf = (ctx: Ctx) => ctx.currentStore?.id ?? null;

const planBody = (plan: ScanPlan): NativeModuleResult => ({ body: { ok: true, plan, choices: scanFilingChoices(plan.reading, plan) } });

export const scanBulkGet: NativeModuleGet = async ({ ctx }) => {
  const g = gate(ctx);
  if (g) return g;
  return {
    body: {
      ok: true,
      storeName: ctx.currentStore?.name ?? null,
      canAttach: can(ctx.role, 'cash.write'),
      today: todayJst(),
      maxFiles: SCAN_BULK_MAX_FILES,
      maxBytes: MAX_FILE_SIZE,
      inlineMaxBytes: NATIVE_SCAN_MAX_BYTES,
      ...scanBulkOptions(),
    },
  };
};

export const scanBulkCheckPost: NativeModulePost = async ({ ctx, raw }) => {
  const g = gate(ctx);
  if (g) return g;
  const p = parseScanCheck(raw);
  if (!p.ok) return fail(p.error);
  try {
    const { duplicate } = await checkScanDuplicate(p.value);
    return { body: { ok: true, duplicate } };
  } catch (e) {
    return fail(messageOf(e, '確かめられませんでした'));
  }
};

export const scanBulkUploadUrlPost: NativeModulePost = async ({ ctx, raw }) => {
  const g = gate(ctx);
  if (g) return g;
  const p = parseScanUploadMeta(raw);
  if (!p.ok) return fail(p.error);
  const metaError = validateUploadMeta(p.value);
  if (metaError) return fail(metaError);
  const path = nativeScanDayPath(ctx.organizationId as string, storeIdOf(ctx), p.value.mimeType, crypto.randomUUID(), todayJst());
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from('documents').createSignedUploadUrl(path);
  if (error || !data) return fail('アップロードできませんでした');
  // apiKey は公開のキー（Web のブラウザにも入っている NEXT_PUBLIC_SUPABASE_ANON_KEY）。上げてよいかは URL の token で決まる
  return { body: { ok: true, path, signedUrl: data.signedUrl, apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' } };
};

export const scanBulkRegisterPost: NativeModulePost = async ({ ctx, raw }) => {
  const g = gate(ctx);
  if (g) return g;
  const p = parseScanRegister(raw);
  if (!p.ok) return fail(p.error);
  try {
    const { id } = await createScanDocument({
      filePath: p.value.path,
      fileName: p.value.fileName,
      mimeType: p.value.mimeType,
      sizeBytes: p.value.sizeBytes,
      storeId: storeIdOf(ctx),
      contentHash: p.value.contentHash,
    });
    return { body: { ok: true, documentId: id } };
  } catch (e) {
    return fail(messageOf(e, '登録に失敗しました'));
  }
};

export const scanBulkPlanPost: NativeModulePost = async ({ ctx, raw }) => {
  const g = gate(ctx);
  if (g) return g;
  const p = parseScanPlan(raw);
  if (!p.ok) return fail(p.error);
  // はじめは読み取った行から読む（Web と同じ readScan・同じ「今日」）。出し直しは画面で直した内容
  const reading = p.value.lines ? readScan(p.value.lines, todayJst()) : p.value.reading;
  if (!reading) return fail('内容が正しくありません');
  try {
    return planBody(await planScanFiling(p.value.documentId, reading));
  } catch (e) {
    return fail(messageOf(e, '確かめられませんでした'));
  }
};

export const scanBulkFilePost: NativeModulePost = async ({ ctx, raw }) => {
  const g = gate(ctx);
  if (g) return g;
  const p = parseScanFile(raw);
  if (!p.ok) return fail(p.error);
  try {
    const outcome = await fileScan(p.value.documentId, p.value.reading, { action: p.value.action, txId: p.value.txId });
    return { body: { ok: true, outcome } };
  } catch (e) {
    return fail(messageOf(e, '登録できませんでした'));
  }
};

/** registry.ts の NATIVE_MODULE_POST に入れる */
export const SCAN_BULK_POST: Record<string, NativeModulePost> = {
  scanBulkCheck: scanBulkCheckPost,
  scanBulkUploadUrl: scanBulkUploadUrlPost,
  scanBulkRegister: scanBulkRegisterPost,
  scanBulkPlan: scanBulkPlanPost,
  scanBulkFile: scanBulkFilePost,
};
