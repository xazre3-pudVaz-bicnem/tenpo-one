/**
 * メニューの写真・PDF取り込み（ブラウザの中で文字を読む。お金のかかる AI は使わない）に使うファイルを
 * node_modules から public/ocr にコピーする（2026-10-19 Ronnie「お金のかからないもので」）。
 * build の前に毎回動く（package.json の build）。public/ocr は git に入れない（.gitignore）。
 *
 *   public/ocr/worker.min.js            … Tesseract の worker
 *   public/ocr/core/*.wasm.js           … Tesseract 本体（WebAssembly。端末に合わせて1つだけ読む）
 *   public/ocr/lang/{jpn,eng}.traineddata.gz … 日本語・英語の文字のデータ
 *   public/ocr/pdf.worker.min.mjs       … PDF の文字を取り出す worker（pdf.js）
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'public', 'ocr', p);

const files = [
  [nm('tesseract.js/dist/worker.min.js'), out('worker.min.js')],
  [nm('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'), out('core/tesseract-core-relaxedsimd-lstm.wasm.js')],
  [nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), out('core/tesseract-core-simd-lstm.wasm.js')],
  [nm('tesseract.js-core/tesseract-core-lstm.wasm.js'), out('core/tesseract-core-lstm.wasm.js')],
  [nm('@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz'), out('lang/jpn.traineddata.gz')],
  [nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), out('lang/eng.traineddata.gz')],
  [nm('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), out('pdf.worker.min.mjs')],
];

let copied = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.warn(`[copy-ocr-assets] 見つかりません: ${from}（メニューの写真取り込みが使えません）`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
console.log(`[copy-ocr-assets] ${copied}/${files.length} files → public/ocr`);
