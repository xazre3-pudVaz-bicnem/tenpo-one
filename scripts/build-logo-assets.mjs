/**
 * ロゴ元画像（public/ChatGPT Image ...）から、用途別のクリーンなアセットを生成する。
 *   - public/logo-mark.png        透過の六角マーク（濃色/淡色どちらの背景でも使える）
 *   - public/logo-horizontal.png  マーク+ワードマーク（余白トリム）
 *   - public/logo-tagline.png     マーク+ワードマーク+タグライン（余白トリム）
 *   - public/logo-stacked.png     縦組みロゴ（余白トリム）
 *   - public/favicon-32.png       透過マーク 32px（ファビコン）
 *   - public/icon-192.png         透過マーク 192px（PWA any）
 *   - public/icon-512.png         マーク on 白・余白付き 512px（PWA maskable）
 *   - public/apple-icon.png       マーク on 白 180px（Appleは不透明前提）
 *   - app/opengraph-image.png     1200x630 タグラインロゴ（OGP/Twitter）
 * 実行: node scripts/build-logo-assets.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC_MARK = 'scripts/brand-source/logo-mark-src.png';
const SRC_HORIZONTAL = 'scripts/brand-source/logo-horizontal-src.png';
const SRC_STACKED = 'scripts/brand-source/logo-stacked-src.png';
const SRC_TAGLINE = 'scripts/brand-source/logo-tagline-src.png';

/** 白背景（外側のみ）を透過にする。四辺から連結した「ほぼ白」画素だけをalpha=0にし、
 *  マーク内部の白（数字の"1"）は外周と非連結なので不透明のまま残す。 */
async function makeTransparentMark(srcPath) {
  const trimmed = await sharp(srcPath).trim({ threshold: 10 }).toBuffer();
  const img = sharp(trimmed).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info; // channels=4
  const isWhite = (i) => data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    if (isWhite(p * channels)) stack.push(p);
  };
  for (let x = 0; x < width; x++) { pushIf(x, 0); pushIf(x, height - 1); }
  for (let y = 0; y < height; y++) { pushIf(0, y); pushIf(width - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    data[p * channels + 3] = 0; // alpha 0
    const x = p % width;
    const y = (p / width) | 0;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }
  // 透過反映後に内容へトリム
  const out = await sharp(Buffer.from(data), { raw: { width, height, channels } })
    .png()
    .trim({ threshold: 0 })
    .toBuffer();
  return out;
}

await mkdir('app', { recursive: true });

// 1) 透過マーク
const markBuf = await makeTransparentMark(SRC_MARK);
await sharp(markBuf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('public/logo-mark.png');
console.log('✓ public/logo-mark.png');

// 2) ロックアップ（余白トリム、白背景のまま=淡色面用）
await sharp(SRC_HORIZONTAL).trim({ threshold: 10 }).png().toFile('public/logo-horizontal.png');
await sharp(SRC_TAGLINE).trim({ threshold: 10 }).png().toFile('public/logo-tagline.png');
await sharp(SRC_STACKED).trim({ threshold: 10 }).png().toFile('public/logo-stacked.png');
console.log('✓ public/logo-horizontal.png / logo-tagline.png / logo-stacked.png');

// 3) ファビコン & PWA（透過マーク）
await sharp(markBuf).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('public/favicon-32.png');
await sharp(markBuf).resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('public/icon-192.png');
console.log('✓ public/favicon-32.png / icon-192.png');

// maskable 512（安全域=約80%）と apple 180 は不透明（白背景）
const white = { r: 255, g: 255, b: 255, alpha: 1 };
const mark410 = await sharp(markBuf).resize(410, 410, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: white } })
  .composite([{ input: mark410, gravity: 'center' }]).png().toFile('public/icon-512.png');
const mark150 = await sharp(markBuf).resize(150, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: white } })
  .composite([{ input: mark150, gravity: 'center' }]).png().toFile('public/apple-icon.png');
console.log('✓ public/icon-512.png (maskable) / apple-icon.png');

// 4) OG画像 1200x630（薄グレー背景にタグラインロゴを中央配置）
const ogLogo = await sharp(SRC_TAGLINE).trim({ threshold: 10 }).resize(1000, null, { fit: 'inside' }).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: white } })
  .composite([{ input: ogLogo, gravity: 'center' }]).png().toFile('app/opengraph-image.png');
console.log('✓ app/opengraph-image.png (1200x630)');

console.log('\n完了');
