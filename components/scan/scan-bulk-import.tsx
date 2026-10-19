'use client';

/**
 * ScanSnap（iX100・iX1300 など）でスキャンした書類をまとめて取り込み、自動で仕分ける（2026-10-20 Ronnie）。
 *
 *   ScanSnap Home（iPad）でスキャン → 共有 →「ファイルに保存」→ ここで「ファイルを選ぶ」（何枚でも）
 *   1. 保存ボックスへアップロード（スキャンの撮影と同じ手順。createScanDocument）
 *   2. 文字の読み取りはこの端末のブラウザの中（文字入りの PDF はその文字、写真・画像は Tesseract。料金なし・外に送らない）
 *   3. 金額・日付・レシートか請求書かを読み（lib/receipt-read.ts）、サーバーで仕分け（autoFileScan）
 *      レシート → 合う出金に紐付け（レジクローズの出金レシートが OK に）／請求書 → 月払い／合わない → 要確認
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileText, FolderOpen, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkDuplicateDocument } from '@/app/app/invoices/actions';
import { autoFileScan, createScanDocument, type AutoFileResult } from '@/app/app/scan/actions';
import { extFromFile, validateAttachedFile } from '@/components/invoices/labels';
import { pdfTextLines, type PdfTextItem } from '@/lib/menu-ocr-parse';
import { readScan } from '@/lib/receipt-read';

type TessWorker = {
  recognize: (image: Blob | HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};
type CreateWorker = (langs: string[], oem: number, options: Record<string, unknown>) => Promise<unknown>;

type Row = {
  id: string;
  name: string;
  state: 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
  step?: string;
  outcome?: AutoFileResult;
  message?: string;
};

function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

const MAX_FILES = 50;

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
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const patch = (id: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const run = async (files: File[]) => {
    if (files.length === 0 || running) return;
    const list = files.slice(0, MAX_FILES);
    const created: Row[] = list.map((f) => ({ id: crypto.randomUUID(), name: f.name, state: 'waiting' }));
    setRows(created);
    setRunning(true);
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

    const readText = async (f: File, rowId: string): Promise<string[]> => {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf.worker.min.mjs';
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const lines: string[] = [];
        // レシート・請求書は1〜2ページ目に金額がある。長い PDF は最初の2ページだけ読む
        for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
          const page = await doc.getPage(p);
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
        await doc.destroy();
        return lines;
      }
      return ocr(f, rowId);
    };

    try {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const row = created[i];
        const err = validateAttachedFile(f);
        if (err) {
          patch(row.id, { state: 'failed', message: err });
          continue;
        }
        patch(row.id, { state: 'working', step: 'アップロードしています' });
        try {
          try {
            const { duplicate } = await checkDuplicateDocument(f.name, f.size);
            if (duplicate) {
              patch(row.id, { state: 'skipped', message: '同じファイルがすでに取り込まれています' });
              continue;
            }
          } catch {
            // 重複チェックの失敗では止めない
          }
          const supabase = createClient();
          const now = new Date();
          const path = `${organizationId}/${storeId ?? 'hq'}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${extFromFile(f)}`;
          const { error: upErr } = await supabase.storage.from('documents').upload(path, f, { contentType: f.type, upsert: false });
          if (upErr) throw new Error('アップロードできませんでした');
          const { id } = await createScanDocument({ filePath: path, fileName: f.name, mimeType: f.type, sizeBytes: f.size, storeId });

          let lines: string[] = [];
          try {
            lines = await readText(f, row.id);
          } catch (e) {
            console.error('[scan-bulk] read', e);
          }
          patch(row.id, { step: '仕分けています' });
          const outcome = await autoFileScan(id, readScan(lines, todayJst()));
          patch(row.id, { state: 'done', outcome, step: undefined });
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

  const done = rows.filter((r) => r.state === 'done');
  const count = (k: AutoFileResult['result']) => done.filter((r) => r.outcome?.result === k).length;
  const attached = count('attached');
  const bills = count('vendor_bill') + count('fixed_bill');
  const review = count('review') + rows.filter((r) => r.state === 'failed').length;

  return (
    <section id="scan-bulk" aria-label="スキャンした書類をまとめて取り込む" className={cn('rounded-2xl border border-line bg-white', compact ? 'p-4' : 'p-5')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#f2f2f7] text-[#0f4fc4]">
          <FolderOpen className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[15px] font-bold text-ink">ScanSnap の書類をまとめて取り込む</p>
          <p className="text-[11px] text-ink-3">Import scanned receipts & bills</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => run(Array.from(e.target.files ?? []))}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={running} className="on-brand">
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
          ファイルを選ぶ
        </Button>
      </div>
      {!compact && (
        <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-ink-2">
          <li>ScanSnap Home（iPad）でレシート・請求書をスキャン（何枚でも）</li>
          <li>共有 →「ファイルに保存」</li>
          <li>ここで「ファイルを選ぶ」→ まとめて選ぶ</li>
          <li>レシートは金額と日付が合う出金に自動で付きます。請求書は月払いに入ります。合わないものは「要確認」に残ります</li>
        </ol>
      )}
      {compact && rows.length === 0 && (
        <p className="mt-2 text-[12px] text-ink-3">ScanSnap Home でスキャン → 共有 →「ファイルに保存」→ ここで選ぶ。レシートは出金に、請求書は月払いに自動で入ります</p>
      )}

      {rows.length > 0 && (
        <div className="mt-3">
          {!running && (
            <p className="mb-2 text-[13px] font-bold text-ink" role="status">
              出金に紐付け {attached}件 ・ 月払い {bills}件 ・ 要確認 {review}件
              {review > 0 && (
                <Link href="/app/scan?type=inbox" className="ml-2 text-[12.5px] text-royal hover:underline">
                  要確認を見る ›
                </Link>
              )}
            </p>
          )}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
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
                  {r.state === 'skipped' && r.message}
                  {r.state === 'failed' && r.message}
                  {r.state === 'done' && r.outcome && (
                    <>
                      {r.outcome.result === 'attached' && '出金に紐付け：'}
                      {r.outcome.result === 'vendor_bill' && '月払い（請求書）：'}
                      {r.outcome.result === 'fixed_bill' && '月払い：'}
                      {r.outcome.result === 'review' && '要確認：'}
                      {r.outcome.label}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
