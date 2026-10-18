'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, ImagePlus, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { importRows } from '@/app/app/settings/import/actions';
import type { ImportResult } from '@/components/import/types';
import { parseMenuLines, pdfTextLines, type MenuOcrRow, type PdfTextItem } from '@/lib/menu-ocr-parse';

/**
 * メニューの写真・PDF から商品をまとめて登録する（2026-10-18 Ronnie「メニューの PDF・写真をアップロードして
 * 自動でメニューに入るように」→「お金がかからないもので」）。
 *
 * - 文字の読み取りはこの端末のブラウザの中だけ（Tesseract・pdf.js。外の AI やサーバーに画像を送らない・料金なし）
 *   読み取りのファイルは /ocr（build のときに node_modules からコピー。scripts/copy-ocr-assets.mjs）
 * - 文字が入っている PDF はその文字をそのまま使う（読み間違いなし）。写真・スキャンの PDF は文字を読み取る
 * - 読み取った行を「カテゴリ・商品名・英語名・価格・種別」に分ける（lib/menu-ocr-parse.ts）
 * - 確実ではないので、表で確認・修正してから登録する。登録は CSV 取り込みと同じ処理（importRows）
 *   （同じカテゴリに同じ商品名があれば新しく作らない）
 */

type Row = MenuOcrRow & { key: number; on: boolean };

type TessWorker = {
  recognize: (image: Blob | HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type CreateWorker = (langs: string[], oem: number, options: Record<string, unknown>) => Promise<unknown>;

let keySeq = 1;
const withKeys = (rows: MenuOcrRow[]): Row[] => rows.map((r) => ({ ...r, key: keySeq++, on: true }));

export function MenuScanImport({ storeName }: { storeName: string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const read = async (files: File[]) => {
    if (files.length === 0) return;
    setResult(null);
    setProgress(0);
    const lines: string[] = [];
    let worker: TessWorker | null = null;
    let current = '';

    const ocr = async (image: Blob | HTMLCanvasElement): Promise<string[]> => {
      if (!worker) {
        setBusy('文字を読み取る準備をしています（はじめての時は少し時間がかかります）…');
        // tesseract.js は CommonJS。バンドラーによって default の中に入るので両方見る
        const mod = (await import('tesseract.js')) as unknown as { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } };
        const createWorker = mod.createWorker ?? mod.default?.createWorker;
        if (!createWorker) throw new Error('tesseract.js を読み込めませんでした');
        worker = (await createWorker(['jpn', 'eng'], 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr/core',
          langPath: '/ocr/lang',
          workerBlobURL: false,
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100));
          },
        })) as unknown as TessWorker;
      }
      setBusy(`${current} の文字を読み取っています…`);
      const { data } = await worker.recognize(image);
      return data.text.split('\n');
    };

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        current = files.length > 1 ? `${i + 1}/${files.length}枚目` : f.name;
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          setBusy(`${current}（PDF）を開いています…`);
          const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
          pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf.worker.min.mjs';
          const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
          for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            const pageLines = pdfTextLines(content.items as unknown as PdfTextItem[]);
            // 文字が入っている PDF はそのまま。文字が無い（写真・スキャン）ページは画像にして読み取る
            if (pageLines.join('').replace(/\s/g, '').length >= 20) {
              lines.push(...pageLines, '');
              continue;
            }
            const viewport = page.getViewport({ scale: 2.5 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvas, viewport }).promise;
            current = `${f.name} ${p}ページ`;
            lines.push(...(await ocr(canvas)), '');
          }
          await doc.destroy();
        } else {
          lines.push(...(await ocr(f)), '');
        }
      }
      const parsed = parseMenuLines(lines);
      setText(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
      setRows(withKeys(parsed));
      toast(parsed.length > 0 ? `${parsed.length}件の商品を読み取りました。確認してから登録してください` : '商品を読み取れませんでした。下の文字を直して「読み直す」か、行を足してください', parsed.length > 0 ? 'success' : 'error');
    } catch (e) {
      console.error('[menu-scan]', e);
      toast('読み取れませんでした。写真をはっきり撮り直すか、PDF でお試しください', 'error');
    } finally {
      if (worker) await (worker as TessWorker).terminate().catch(() => undefined);
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reparse = () => {
    const parsed = parseMenuLines(text.split('\n'));
    setRows(withKeys(parsed));
    setResult(null);
    toast(`${parsed.length}件の商品を読み直しました`);
  };

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => (prev ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const selected = (rows ?? []).filter((r) => r.on && r.name.trim() && Number.isFinite(r.price) && r.price >= 0);

  const doImport = async () => {
    if (selected.length === 0) return;
    setImporting(true);
    try {
      const res = await importRows(
        'menu_items',
        selected.map((r, i) => ({
          rowNumber: i + 1,
          values: {
            categoryName: r.categoryName.trim(),
            name: r.name.trim(),
            nameEn: r.nameEn.trim(),
            price: String(Math.round(r.price)),
            itemType: r.itemType,
          },
        }))
      );
      setResult(res);
      toast(`${res.inserted}件をメニューに登録しました`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : '登録できませんでした', 'error');
    } finally {
      setImporting(false);
    }
  };

  const cell = 'h-9 px-2 text-[13px]';

  return (
    <div className="space-y-4">
      {/* 1. 写真・PDF を選ぶ */}
      <section className="ui-card rounded-2xl border border-line bg-white p-5">
        <p className="text-[15px] font-bold text-ink">1. メニューの写真か PDF を選ぶ</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          {storeName} のメニューに入ります。文字はこの端末の中だけで読み取ります（料金はかかりません・外に送りません）。
          写真は明るい所で、メニューを正面からまっすぐ撮ると読み取りやすくなります。何枚でもまとめて選べます。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => read(Array.from(e.target.files ?? []))}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={busy !== null} className="on-brand">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
            写真・PDF を選ぶ
          </Button>
          {busy && (
            <span className="text-[12.5px] text-ink-2" role="status">
              {busy} {progress > 0 && progress < 100 ? `${progress}%` : ''}
            </span>
          )}
        </div>
      </section>

      {rows && (
        <>
          {/* 2. 確認・修正 */}
          <section className="ui-card rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[15px] font-bold text-ink">2. 読み取った商品を確認・修正</p>
                <p className="mt-1 text-[12.5px] text-ink-3">
                  読み間違いがあることがあります。名前・価格・カテゴリを確かめて、要らない行はチェックを外してください。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setRows((prev) => [
                    ...(prev ?? []),
                    { key: keySeq++, on: true, categoryName: prev?.at(-1)?.categoryName ?? 'メニュー', name: '', nameEn: '', price: 0, itemType: 'food' },
                  ])
                }
              >
                <Plus className="h-4 w-4" aria-hidden />
                行を足す
              </Button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-y-1 text-left">
                <thead>
                  <tr className="text-[11.5px] font-semibold text-ink-3">
                    <th className="w-9 px-1">登録</th>
                    <th className="w-[150px] px-1">カテゴリ</th>
                    <th className="px-1">商品名</th>
                    <th className="w-[160px] px-1">英語名</th>
                    <th className="w-[96px] px-1">価格（円）</th>
                    <th className="w-[100px] px-1">種別</th>
                    <th className="w-9 px-1" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={r.on ? '' : 'opacity-45'}>
                      <td className="px-1">
                        <input
                          type="checkbox"
                          checked={r.on}
                          onChange={(e) => update(r.key, { on: e.target.checked })}
                          aria-label={`${r.name || '商品'}を登録する`}
                          className="h-5 w-5 accent-[#BC5940]"
                        />
                      </td>
                      <td className="px-1">
                        <Input className={cell} value={r.categoryName} onChange={(e) => update(r.key, { categoryName: e.target.value })} aria-label="カテゴリ" />
                      </td>
                      <td className="px-1">
                        <Input className={cell} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} aria-label="商品名" />
                      </td>
                      <td className="px-1">
                        <Input className={cell} value={r.nameEn} onChange={(e) => update(r.key, { nameEn: e.target.value })} aria-label="英語名" />
                      </td>
                      <td className="px-1">
                        <Input
                          className={`${cell} text-right tabular-nums`}
                          inputMode="numeric"
                          value={String(r.price)}
                          onChange={(e) => update(r.key, { price: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })}
                          aria-label="価格"
                        />
                      </td>
                      <td className="px-1">
                        <Select className={cell} value={r.itemType} onChange={(e) => update(r.key, { itemType: e.target.value as Row['itemType'] })} aria-label="種別">
                          <option value="food">フード</option>
                          <option value="drink">ドリンク</option>
                        </Select>
                      </td>
                      <td className="px-1">
                        <button
                          type="button"
                          onClick={() => setRows((prev) => (prev ?? []).filter((x) => x.key !== r.key))}
                          className="grid h-9 w-9 place-items-center rounded-lg text-ink-3 hover:bg-lilac-soft hover:text-danger"
                          aria-label="この行を消す"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 読み取った文字（直して読み直せる） */}
            <details className="mt-4 rounded-xl border border-line bg-lilac-soft/40 p-3">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                <FileText className="h-4 w-4" aria-hidden />
                読み取った文字を見る・直す
              </summary>
              <Textarea className="mt-2 min-h-[220px] font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} rows={12} />
              <Button variant="outline" size="sm" className="mt-2" onClick={reparse}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                この文字で読み直す（表を作り直す）
              </Button>
            </details>
          </section>

          {/* 3. 登録 */}
          <section className="ui-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-5">
            <div>
              <p className="text-[15px] font-bold text-ink">3. メニューに登録</p>
              <p className="mt-1 text-[12.5px] text-ink-3">
                チェックの入った {selected.length}件 を登録します。カテゴリが無ければ新しく作ります。同じカテゴリに同じ名前の商品があれば新しく作りません。
              </p>
            </div>
            <Button onClick={doImport} disabled={importing || selected.length === 0} className="on-brand">
              {importing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {selected.length}件をメニューに登録
            </Button>
            {result && (
              <div className="w-full rounded-xl border border-line bg-lilac-soft/40 p-3 text-[13px] text-ink-2" role="status">
                登録 <b className="text-ink">{result.inserted}</b>件
                {result.updated ? `・更新 ${result.updated}件` : ''}
                {result.skipped ? `・すでにある ${result.skipped}件` : ''}
                {result.failed.length > 0 && (
                  <span className="text-danger">
                    ・登録できなかった {result.failed.length}件（{result.failed.slice(0, 3).map((f) => `${f.rowNumber}行目 ${f.reason}`).join('／')}）
                  </span>
                )}
                <Link href="/app/settings/menu" className="ml-2 font-bold text-iris hover:underline">
                  メニューを見る ›
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
