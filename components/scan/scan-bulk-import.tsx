'use client';

/**
 * ScanSnap（iX100・iX1300 など）でスキャンした書類をまとめて取り込み、確かめてから仕分ける（2026-10-20 Ronnie）。
 *
 *   ScanSnap Home（iPad）でスキャン → 共有 →「ファイルに保存」→ ここで「ファイルを選ぶ」（何枚でも）
 *   1. 同じファイルがもう入っていないか確かめる（中身の SHA-256。同じなら取り込まない）
 *   2. 保存ボックスへアップロード。その日のフォルダ（…/年/月/日/）に入れ、一覧も日ごとのフォルダにまとまる
 *   3. 文字の読み取りはこの端末のブラウザの中（文字入りの PDF はその文字、写真・画像は Tesseract。料金なし・外に送らない）
 *      iPad の写真（HEIC）は JPEG にしてから
 *   4. 金額・消費税・日付・支払い方法・発行元を読み（lib/receipt-read.ts）、登録先の案を出す（planScanFiling）
 *   5. 画面で確かめて・直してから「登録」（fileScan）。まとめて登録もできる
 *      レシート（現金）→ 合う出金に紐付け（レジクローズの出金レシートが OK に）／カード払いのレシート → レシートとして保存
 *      請求書 → 月払い／合わない・あとで → 保存ボックス
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileText, FolderOpen, Loader2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  checkScanDuplicate,
  createScanDocument,
  fileScan,
  planScanFiling,
  type AutoFileResult,
  type ScanAction,
  type ScanPlan,
} from '@/app/app/scan/actions';
import { extFromFile, validateAttachedFile } from '@/components/invoices/labels';
import { pdfTextLines, type PdfTextItem } from '@/lib/menu-ocr-parse';
import {
  BILL_CATEGORY_LABELS,
  PAYMENT_LABELS,
  isCashPayment,
  readScan,
  type BillCategory,
  type PaymentMethod,
  type ScanReading,
} from '@/lib/receipt-read';

type TessWorker = {
  recognize: (image: Blob | HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};
type CreateWorker = (langs: string[], oem: number, options: Record<string, unknown>) => Promise<unknown>;

type Row = {
  id: string;
  name: string;
  state: 'waiting' | 'working' | 'confirm' | 'saving' | 'done' | 'failed' | 'skipped';
  step?: string;
  docId?: string;
  reading?: ScanReading;
  plan?: ScanPlan;
  action?: ScanAction;
  txId?: string | null;
  /** 入力を直して、まだ案を出し直していない */
  dirty?: boolean;
  planning?: boolean;
  thumb?: string;
  preview?: { url: string; pdf: boolean };
  pages?: number;
  outcome?: AutoFileResult;
  message?: string;
};

function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

const MAX_FILES = 50;
const RECEIPT_PAYMENTS: PaymentMethod[] = ['cash', 'card', 'emoney', 'qr'];
const BILL_PAYMENTS: PaymentMethod[] = ['transfer', 'debit', 'card', 'cash'];
const CATEGORIES: BillCategory[] = ['vendor', 'rent', 'electric', 'water', 'gas'];
const CATEGORY_SHORT: Record<BillCategory, string> = { vendor: '仕入・経費', rent: '家賃', electric: '電気', water: '水道', gas: 'ガス' };
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function isHeic(f: File): boolean {
  return /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
}

/** iPad の写真（HEIC）を JPEG に（iPad の Safari・Chrome は HEIC を開ける。長い辺は 3200px まで） */
async function heicToJpeg(f: File): Promise<File> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('convert');
    return new File([blob], `${f.name.replace(/\.hei[cf]$/i, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    throw new Error('HEIC の写真を開けませんでした。JPEG で保存してから選んでください');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** ファイルの中身の SHA-256（同じファイルの取り込み防止） */
async function sha256(f: File): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function ScanBulkImport({
  organizationId,
  storeId,
  compact,
}: {
  organizationId: string;
  storeId: string | null;
  /** 仕入・経費・レジクローズの上に置くときの小さい表示 */
  compact?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [preview, setPreview] = useState<{ url: string; pdf: boolean; name: string } | null>(null);
  const [folderDay, setFolderDay] = useState<string | null>(null);

  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const patch = (id: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const run = async (files: File[]) => {
    if (files.length === 0 || running) return;
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
    const list = files.slice(0, MAX_FILES);
    const created: Row[] = list.map((f) => ({ id: crypto.randomUUID(), name: f.name, state: 'waiting' }));
    setRows(created);
    setRunning(true);
    const day = todayJst();
    setFolderDay(day);
    const seen = new Set<string>();
    let worker: TessWorker | null = null;

    const ocr = async (image: Blob | HTMLCanvasElement, rowId: string): Promise<string[]> => {
      if (!worker) {
        patch(rowId, { step: '文字を読み取る準備（はじめは少し時間がかかります）' });
        const mod = (await import('tesseract.js')) as unknown as { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } };
        const createWorker = mod.createWorker ?? mod.default?.createWorker;
        if (!createWorker) throw new Error('tesseract.js を読み込めませんでした');
        worker = (await createWorker(['jpn', 'eng'], 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr/core',
          langPath: '/ocr/lang',
          workerBlobURL: false,
        })) as unknown as TessWorker;
      }
      patch(rowId, { step: '文字を読み取っています' });
      const { data } = await worker.recognize(image);
      return data.text.split('\n');
    };

    const readFile = async (f: File, rowId: string): Promise<{ lines: string[]; pages: number; thumb?: string }> => {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf.worker.min.mjs';
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const lines: string[] = [];
        let thumb: string | undefined;
        // レシート・請求書は1〜2ページ目に金額がある。長い PDF は最初の2ページだけ読む
        for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
          const page = await doc.getPage(p);
          if (p === 1) {
            try {
              const v1 = page.getViewport({ scale: 1 });
              const tv = page.getViewport({ scale: 240 / v1.width });
              const tc = document.createElement('canvas');
              tc.width = Math.ceil(tv.width);
              tc.height = Math.ceil(tv.height);
              await page.render({ canvas: tc, viewport: tv }).promise;
              thumb = tc.toDataURL('image/jpeg', 0.75);
            } catch {
              // 小さい絵が作れなくても読み取りは続ける
            }
          }
          const content = await page.getTextContent();
          const pageLines = pdfTextLines(content.items as unknown as PdfTextItem[]);
          // ScanSnap の「検索可能な PDF」は文字が入っているのでそのまま。文字が無いページは画像にして読む
          if (pageLines.join('').replace(/\s/g, '').length >= 15) {
            lines.push(...pageLines);
            continue;
          }
          const viewport = page.getViewport({ scale: 2.2 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          lines.push(...(await ocr(canvas, rowId)));
        }
        const pages = doc.numPages;
        await doc.destroy();
        return { lines, pages, thumb };
      }
      return { lines: await ocr(f, rowId), pages: 1 };
    };

    try {
      for (let i = 0; i < list.length; i++) {
        const row = created[i];
        let f = list[i];
        patch(row.id, { state: 'working', step: '確かめています' });
        try {
          if (isHeic(f)) {
            patch(row.id, { step: 'HEIC を JPEG にしています' });
            f = await heicToJpeg(f);
          }
          const err = validateAttachedFile(f);
          if (err) {
            patch(row.id, { state: 'failed', step: undefined, message: err });
            continue;
          }
          // 同じファイル（中身が同じ）は取り込まない
          const hash = await sha256(f);
          if (hash && seen.has(hash)) {
            patch(row.id, { state: 'skipped', step: undefined, message: '同じファイルを2回選んでいます' });
            continue;
          }
          if (hash) seen.add(hash);
          const { duplicate } = await checkScanDuplicate({ hash, fileName: f.name, sizeBytes: f.size }).catch(() => ({ duplicate: null }));
          if (duplicate) {
            patch(row.id, { state: 'skipped', step: undefined, message: duplicate });
            continue;
          }

          patch(row.id, { step: 'アップロードしています' });
          const supabase = createClient();
          const [y, m, d] = day.split('-');
          // その日のフォルダにまとめる（何回に分けてスキャンしても同じ日なら同じフォルダ）
          const path = `${organizationId}/${storeId ?? 'hq'}/${y}/${m}/${d}/${crypto.randomUUID()}.${extFromFile(f)}`;
          const { error: upErr } = await supabase.storage.from('documents').upload(path, f, { contentType: f.type, upsert: false });
          if (upErr) throw new Error('アップロードできませんでした');
          const { id } = await createScanDocument({ filePath: path, fileName: f.name, mimeType: f.type, sizeBytes: f.size, storeId, contentHash: hash });

          const isPdf = f.type === 'application/pdf';
          const url = URL.createObjectURL(f);
          urlsRef.current.push(url);
          let read: { lines: string[]; pages: number; thumb?: string } = { lines: [], pages: 1 };
          try {
            read = await readFile(f, row.id);
          } catch (e) {
            console.error('[scan-bulk] read', e);
          }
          patch(row.id, { step: '登録先を考えています' });
          const plan = await planScanFiling(id, readScan(read.lines, todayJst()));
          patch(row.id, {
            state: 'confirm',
            step: undefined,
            docId: id,
            reading: plan.reading,
            plan,
            action: plan.action,
            txId: plan.txId,
            pages: read.pages,
            thumb: read.thumb ?? (isPdf ? undefined : url),
            preview: { url, pdf: isPdf },
          });
        } catch (e) {
          patch(row.id, { state: 'failed', step: undefined, message: e instanceof Error ? e.message : '取り込めませんでした' });
        }
      }
    } finally {
      if (worker) await (worker as TessWorker).terminate().catch(() => undefined);
      setRunning(false);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    }
  };

  /** 直した内容で登録先の案を出し直す */
  const replan = async (row: Row, reading: ScanReading) => {
    if (!row.docId) return;
    patch(row.id, { planning: true, reading, dirty: false, message: undefined });
    try {
      const plan = await planScanFiling(row.docId, reading);
      patch(row.id, { planning: false, plan, action: plan.action, txId: plan.txId });
    } catch (e) {
      patch(row.id, { planning: false, message: e instanceof Error ? e.message : '確かめられませんでした' });
    }
  };

  const register = async (row: Row): Promise<boolean> => {
    if (!row.docId || !row.reading || !row.action) return false;
    patch(row.id, { state: 'saving', message: undefined });
    try {
      const outcome = await fileScan(row.docId, row.reading, { action: row.action, txId: row.txId ?? null });
      patch(row.id, { state: 'done', outcome });
      return true;
    } catch (e) {
      patch(row.id, { state: 'confirm', message: e instanceof Error ? e.message : '登録できませんでした' });
      return false;
    }
  };

  const confirmRows = rows.filter((r) => r.state === 'confirm' || r.state === 'saving');
  const ready = rows.filter((r) => r.state === 'confirm' && !r.planning && r.action && (r.action !== 'attach' || r.txId));

  const registerAll = async () => {
    setSavingAll(true);
    for (const r of ready) await register(r);
    setSavingAll(false);
    router.refresh();
  };

  const done = rows.filter((r) => r.state === 'done');
  const count = (k: AutoFileResult['result']) => done.filter((r) => r.outcome?.result === k).length;
  const finished = !running && rows.length > 0 && confirmRows.length === 0;

  return (
    <section id="scan-bulk" aria-label="スキャンした書類をまとめて取り込む" className={cn('rounded-2xl border border-line bg-white', compact ? 'p-4' : 'p-5')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-iris-soft text-iris">
          <FolderOpen className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[15px] font-bold text-ink">ScanSnap の書類をまとめて取り込む</p>
          <p className="text-[11px] text-ink-3">Import scanned receipts & bills</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => run(Array.from(e.target.files ?? []))}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={running || savingAll} className="on-brand">
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
          ファイルを選ぶ
        </Button>
      </div>
      {!compact && rows.length === 0 && (
        <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-ink-2">
          <li>ScanSnap Home（iPad）でレシート・請求書をスキャン（1日に何回に分けても同じ日のフォルダにまとまります）</li>
          <li>共有 →「ファイルに保存」</li>
          <li>ここで「ファイルを選ぶ」→ まとめて選ぶ（PDF・JPEG・PNG・HEIC）</li>
          <li>読み取った金額・消費税・日付・支払い方法を確かめて「登録」。同じファイルは取り込みません</li>
        </ol>
      )}
      {compact && rows.length === 0 && (
        <p className="mt-2 text-[12px] text-ink-3">ScanSnap Home でスキャン → 共有 →「ファイルに保存」→ ここで選ぶ。読み取った内容を確かめてから出金・月払いに入れます</p>
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {confirmRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-iris-soft px-3 py-2.5">
              <p className="min-w-0 flex-1 text-[13px] font-bold text-ink">
                内容を確かめて「登録」してください（{confirmRows.length}件）
                <span className="block text-[11px] font-normal text-ink-3">直したところがあれば、そのまま「登録」で直した内容で入ります</span>
              </p>
              <Button onClick={registerAll} disabled={ready.length === 0 || savingAll} className="on-brand">
                {savingAll && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                まとめて登録（{ready.length}件）
              </Button>
            </div>
          )}
          {finished && (
            <p className="text-[13px] font-bold text-ink" role="status">
              出金に紐付け {count('attached')}件 ・ レシート {count('receipt')}件 ・ 月払い {count('vendor_bill') + count('fixed_bill')}件 ・ 保存ボックス{' '}
              {count('review') + rows.filter((r) => r.state === 'failed').length}件
              {rows.some((r) => r.state === 'skipped') && <> ・ 取り込み済み {rows.filter((r) => r.state === 'skipped').length}件</>}
              {folderDay && (
                <Link href={`/app/scan#day-${folderDay}`} className="ml-2 text-[12.5px] text-royal hover:underline">
                  {md(folderDay)} のフォルダを見る ›
                </Link>
              )}
            </p>
          )}

          <ul className="space-y-2">
            {rows.map((r) =>
              r.state === 'confirm' || r.state === 'saving' ? (
                <ConfirmCard
                  key={r.id}
                  row={r}
                  onChange={(reading) => patch(r.id, { reading, dirty: true })}
                  onReplan={(reading) => replan(r, reading)}
                  onChoose={(action, txId) => patch(r.id, { action, txId: txId ?? null })}
                  onRegister={() => register(r).then(() => router.refresh())}
                  onKeep={() => {
                    patch(r.id, { action: 'keep', txId: null });
                    register({ ...r, action: 'keep', txId: null }).then(() => router.refresh());
                  }}
                  onPreview={() => r.preview && setPreview({ ...r.preview, name: r.name })}
                />
              ) : (
                <li key={r.id} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-[12.5px]">
                  {r.state === 'working' || r.state === 'waiting' ? (
                    <Loader2 className={cn('h-4 w-4 shrink-0 text-ink-3', r.state === 'working' && 'animate-spin')} aria-hidden />
                  ) : r.state === 'done' && r.outcome?.result !== 'review' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.name}</span>
                  <span className="shrink-0 text-right font-bold text-ink">
                    {r.state === 'waiting' && '待機中'}
                    {r.state === 'working' && (r.step ?? '処理中')}
                    {(r.state === 'skipped' || r.state === 'failed') && r.message}
                    {r.state === 'done' && r.outcome && (
                      <>
                        {r.outcome.result === 'attached' && '出金に紐付け：'}
                        {r.outcome.result === 'receipt' && 'レシート：'}
                        {r.outcome.result === 'vendor_bill' && '月払い（請求書）：'}
                        {r.outcome.result === 'fixed_bill' && '月払い：'}
                        {r.outcome.result === 'review' && '保存ボックス：'}
                        {r.outcome.label}
                      </>
                    )}
                  </span>
                </li>
              )
            )}
          </ul>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4" role="dialog" aria-label={preview.name} onClick={() => setPreview(null)}>
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between pb-2 text-white">
            <span className="truncate text-[13px]">{preview.name}</span>
            <button type="button" aria-label="閉じる" className="grid h-10 w-10 place-items-center rounded-full bg-white/15">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-auto rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
            {preview.pdf ? (
              <iframe src={preview.url} title={preview.name} className="h-full w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.name} className="mx-auto h-auto max-w-full" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-0.5 block text-[11px] font-bold text-ink-3">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'h-10 text-[16px]';

/** 1件の確かめ・直し・登録先の選択 */
function ConfirmCard({
  row,
  onChange,
  onReplan,
  onChoose,
  onRegister,
  onKeep,
  onPreview,
}: {
  row: Row;
  onChange: (reading: ScanReading) => void;
  onReplan: (reading: ScanReading) => void;
  onChoose: (action: ScanAction, txId?: string | null) => void;
  onRegister: () => void;
  onKeep: () => void;
  onPreview: () => void;
}) {
  const r = row.reading as ScanReading;
  const plan = row.plan;
  const busy = row.state === 'saving' || row.planning;
  const set = (p: Partial<ScanReading>) => onChange({ ...r, ...p });
  const setNow = (p: Partial<ScanReading>) => onReplan({ ...r, ...p });
  const blur = () => row.dirty && onReplan(r);
  const num = (v: string) => {
    const n = Number(v.replace(/[^\d]/g, ''));
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  };
  const isReceipt = r.kind === 'receipt';
  const cash = isReceipt && isCashPayment(r.payment);
  const payments = isReceipt ? RECEIPT_PAYMENTS : BILL_PAYMENTS;
  const canRegister = !busy && row.action && (row.action !== 'attach' || row.txId);

  type Choice = { key: string; action: ScanAction; txId?: string; label: string; sub?: string };
  const choices: Choice[] = [];
  if (isReceipt && cash && plan?.canAttach) {
    for (const c of plan.candidates) {
      choices.push({ key: c.id, action: 'attach', txId: c.id, label: `${md(c.businessDate)} の出金 ${yen(c.amount)} に紐付け`, sub: c.label });
    }
  }
  if (isReceipt) {
    choices.push({
      key: 'receipt',
      action: 'receipt',
      label: cash ? 'レシートとして保存（出金に紐付けない）' : `レシートとして保存（${r.payment ? PAYMENT_LABELS[r.payment] : ''}払い）`,
    });
  } else {
    const cat = r.category ?? 'vendor';
    choices.push({ key: 'bill', action: 'bill', label: cat === 'vendor' ? '月払いに登録（仕入先の請求書）' : `月払い：${BILL_CATEGORY_LABELS[cat]}（月次清算で反映）` });
  }
  choices.push({ key: 'keep', action: 'keep', label: 'あとで（保存ボックスに残す）' });
  const chosen = (c: Choice) => row.action === c.action && (c.action !== 'attach' || row.txId === c.txId);

  return (
    <li className="rounded-xl border border-iris/40 bg-white p-3">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPreview}
          aria-label="スキャンした書類を大きく見る"
          className="grid h-[88px] w-[66px] shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-lilac-soft"
        >
          {row.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.thumb} alt="" className="h-full w-full object-cover object-top" />
          ) : (
            <FileText className="h-6 w-6 text-ink-3" aria-hidden />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.name}</b>
            <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="種類">
              {(['receipt', 'bill'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    r.kind !== k &&
                    setNow({ kind: k, category: k === 'bill' ? (r.category ?? 'vendor') : null, payment: null })
                  }
                  className={cn('rounded-md px-3 py-1 text-[12.5px] font-bold', r.kind === k ? 'on-brand text-white' : 'text-ink-2')}
                >
                  {k === 'receipt' ? 'レシート' : '請求書'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[164px_minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
            <Field label="日付">
              <Input type="date" className={inputCls} value={r.date ?? ''} disabled={busy} onChange={(e) => set({ date: e.target.value || null })} onBlur={blur} />
            </Field>
            <Field label={isReceipt ? '店名' : '発行元'} className="col-span-2 sm:col-span-1">
              <Input className={inputCls} value={r.vendorName ?? ''} disabled={busy} onChange={(e) => set({ vendorName: e.target.value || null })} onBlur={blur} />
            </Field>
            <Field label="金額（税込）">
              <Input
                inputMode="numeric"
                className={cn(inputCls, 'text-right font-bold tabular-nums')}
                value={r.amount != null ? r.amount.toLocaleString('ja-JP') : ''}
                disabled={busy}
                onChange={(e) => set({ amount: num(e.target.value) })}
                onBlur={blur}
              />
            </Field>
            <Field label="うち消費税">
              <Input
                inputMode="numeric"
                className={cn(inputCls, 'text-right tabular-nums')}
                value={r.tax != null ? r.tax.toLocaleString('ja-JP') : ''}
                disabled={busy}
                onChange={(e) => set({ tax: num(e.target.value) })}
                onBlur={blur}
              />
            </Field>
            <Field label="支払い">
              <Select
                className={inputCls}
                value={r.payment ?? ''}
                disabled={busy}
                onChange={(e) => setNow({ payment: (e.target.value || null) as PaymentMethod | null })}
              >
                <option value="">{isReceipt ? 'わからない（現金）' : 'わからない'}</option>
                {payments.map((p) => (
                  <option key={p} value={p}>
                    {PAYMENT_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            {!isReceipt && (
              <Field label="費目">
                <Select
                  className={inputCls}
                  value={r.category ?? 'vendor'}
                  disabled={busy}
                  onChange={(e) => setNow({ category: e.target.value as BillCategory })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_SHORT[c]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </div>
      </div>

      {(plan?.duplicate || (row.pages ?? 1) >= 3) && (
        <div className="mt-2 space-y-1 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] font-bold text-warning">
          {plan?.duplicate && (
            <p className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {plan.duplicate}。二重にならないよう「あとで」にしています
            </p>
          )}
          {(row.pages ?? 1) >= 3 && (
            <p className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {row.pages}ページあります（読むのは最初の2ページ）。レシートが何枚も入っているときは ScanSnap で1枚ずつのファイルにしてください
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 rounded-lg border border-line bg-lilac-soft/60 p-2">
        <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] text-ink-2">
          {row.planning && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          <b className="text-ink">登録先</b>
          <span className="min-w-0 truncate">{row.dirty ? '直した内容で確かめ直します' : plan?.note}</span>
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={busy}
              aria-pressed={chosen(c)}
              onClick={() => onChoose(c.action, c.txId)}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors',
                chosen(c) ? 'border-iris bg-white font-bold text-ink shadow-[inset_0_0_0_1px_var(--color-iris)]' : 'border-line bg-white/70 text-ink-2'
              )}
            >
              <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full border-2', chosen(c) ? 'border-iris' : 'border-gray-300')}>
                {chosen(c) && <span className="h-2 w-2 rounded-full bg-iris" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{c.label}</span>
                {c.sub && <span className="block truncate text-[11px] font-normal text-ink-3">{c.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      {row.message && <p className="mt-2 text-[12.5px] font-bold text-danger">{row.message}</p>}

      <div className="mt-2.5 flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onKeep}>
          あとで
        </Button>
        <Button disabled={!canRegister} onClick={onRegister} className="on-brand min-w-[120px]">
          {row.state === 'saving' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          登録
        </Button>
      </div>
    </li>
  );
}
