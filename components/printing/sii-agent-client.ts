'use client';

import type { PaperWidth } from '@/lib/receipt-layout';
import {
  LINE_GAP_DOTS,
  imagePdf,
  layoutRaster,
  parseEposForRaster,
  siiAgentUrl,
  toBase64,
  type PlacedPage,
} from '@/lib/sii-url-print';

/**
 * SII URL Print Agent（App Store の SII の無料アプリ）で印刷する（iPad の Safari 用。lib/sii-url-print.ts）。
 * ePOS-Print XML → この iPad の文字で画像（JPEG）にする → PDF → siiprintagent:// を開く。
 */

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif';

/** 1枚の紙を JPEG に */
async function drawPage(page: PlacedPage): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = Math.max(8, page.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  for (const line of page.lines) {
    for (const c of line.chars) {
      if (c.ch === ' ' || c.ch === '　') continue;
      const boxH = page.char * c.h;
      ctx.font = `${c.em ? 700 : 500} ${page.char}px ${FONT}`;
      const cellW = c.width / c.w; // 倍率をかける前の箱の幅
      const measured = ctx.measureText(c.ch).width;
      const drawW = Math.min(measured, cellW);
      ctx.save();
      // 行の下にそろえる（大きい文字と小さい文字が同じ行にあっても下がそろう）
      const bottom = line.y + line.height - LINE_GAP_DOTS;
      ctx.translate(c.x, bottom - boxH);
      ctx.scale(c.w, c.h);
      ctx.fillText(c.ch, (cellW - drawW) / 2, page.char * 0.86, cellW);
      ctx.restore();
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('jpeg');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface SiiAgentPrint {
  url: string;
  drawer: boolean;
  /** ドロアだけ（紙に何も出さない） */
  drawerOnly: boolean;
  /** PDF の大きさ（バイト） */
  bytes: number;
}

/** 印刷データ（ePOS-Print XML）から、SII URL Print Agent を開く URL を作る */
export async function buildSiiAgentPrint(eposXml: string, paper: PaperWidth, opts: { drawerAllowed: boolean }): Promise<SiiAgentPrint> {
  const doc = parseEposForRaster(eposXml);
  const drawer = doc.drawer && opts.drawerAllowed;
  const drawerOnly = doc.empty;
  const pages = drawerOnly
    ? [{ ...layoutRaster({ pages: [[]], drawer: false, empty: true }, paper)[0], height: 8 }]
    : layoutRaster(doc, paper);
  const jpegs: Uint8Array[] = [];
  for (const p of pages) jpegs.push(await drawPage(p));
  const pdf = imagePdf(jpegs);
  return { url: siiAgentUrl({ pdfBase64: toBase64(pdf), paper, drawer, drawerOnly }), drawer, drawerOnly, bytes: pdf.length };
}

/** SII URL Print Agent を開く（Safari が「開きますか？」と聞いたら「開く」） */
export function openSiiAgent(url: string): void {
  window.location.href = url;
}
