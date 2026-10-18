import type { ReactNode } from 'react';

const A4_W = 210;
const A4_H = 297;

/**
 * カードを A4（210×297mm）に並べて、切り取り線（点線）とトンボ（余白の切る位置の線）を入れる。
 * 画面の見本と「印刷する」（@page A4）はこの見た目のまま。PDF は TableQrPdfButton が同じ並べ方で作る。
 * 2026-10-19 Ronnie「全部のテーブルを A4 にまとめて印刷して切れるように」（名刺 2×5＝10枚、A6 2×2＝4枚）。
 */
export function A4CutSheets({
  cardW,
  cardH,
  cols,
  rows,
  note,
  children,
}: {
  /** カードの大きさ（mm） */
  cardW: number;
  cardH: number;
  /** 1枚の A4 に 横 cols × 縦 rows */
  cols: number;
  rows: number;
  /** 下の余白に出す切り方の説明（余白があるときだけ） */
  note?: string;
  children: ReactNode[];
}) {
  const per = cols * rows;
  const pages: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += per) pages.push(children.slice(i, i + per));
  const gridW = cardW * cols;
  const left = (A4_W - gridW) / 2;
  const top = (A4_H - cardH * rows) / 2;
  // 余白が 8mm 以上あるときだけトンボと説明を出す（A6 4枚は余白がほぼ無いので点線だけ）
  const marks = left >= 8 && top >= 8;
  const mark = 'absolute bg-[#292725]';

  return (
    <div className="flex flex-col items-start gap-6 print:block">
      {pages.map((items, p) => {
        const usedRows = Math.ceil(items.length / cols);
        const usedH = cardH * usedRows;
        const xs = Array.from({ length: cols + 1 }, (_, i) => left + i * cardW);
        const ys = Array.from({ length: usedRows + 1 }, (_, i) => top + i * cardH);
        return (
          <div
            key={p}
            className="relative shrink-0 overflow-hidden bg-white shadow-[0_1px_6px_rgba(41,39,37,0.15)] [break-inside:avoid] [-webkit-print-color-adjust:exact] [print-color-adjust:exact] not-last:[break-after:page] print:shadow-none"
            style={{ width: `${A4_W}mm`, height: `${A4_H - 0.5}mm` }}
          >
            <div
              className="absolute grid"
              style={{
                left: `${left}mm`,
                top: `${top}mm`,
                gridTemplateColumns: `repeat(${cols}, ${cardW}mm)`,
                gridAutoRows: `${cardH}mm`,
              }}
            >
              {items}
            </div>

            {/* 切り取り線（カードの境目。点線）。用紙の端と重なる線は引かない */}
            {xs
              .filter((x) => x > 0.5 && x < A4_W - 0.5)
              .map((x) => (
                <div
                  key={`v${x}`}
                  aria-hidden
                  className="absolute border-l border-dashed border-[#9c948a]"
                  style={{ left: `${x}mm`, top: marks ? `${top}mm` : 0, height: marks ? `${usedH}mm` : `${top + usedH}mm`, width: 0 }}
                />
              ))}
            {ys
              .filter((y) => y > 0.5 && y < A4_H - 1)
              .map((y) => (
                <div
                  key={`h${y}`}
                  aria-hidden
                  className="absolute border-t border-dashed border-[#9c948a]"
                  style={{ top: `${y}mm`, left: marks ? `${left}mm` : 0, width: marks ? `${gridW}mm` : `${A4_W}mm`, height: 0 }}
                />
              ))}

            {/* トンボ（余白に出す切る位置の目印。上下・左右） */}
            {marks &&
              xs.map((x) => (
                <div key={`tv${x}`} aria-hidden>
                  <div className={mark} style={{ left: `${x - 0.1}mm`, top: `${top - 9}mm`, width: '0.2mm', height: '7mm' }} />
                  <div className={mark} style={{ left: `${x - 0.1}mm`, top: `${top + usedH + 2}mm`, width: '0.2mm', height: '7mm' }} />
                </div>
              ))}
            {marks &&
              ys.map((y) => (
                <div key={`th${y}`} aria-hidden>
                  <div className={mark} style={{ top: `${y - 0.1}mm`, left: `${left - 12}mm`, height: '0.2mm', width: '10mm' }} />
                  <div className={mark} style={{ top: `${y - 0.1}mm`, left: `${left + gridW + 2}mm`, height: '0.2mm', width: '10mm' }} />
                </div>
              ))}

            {marks && note && (
              <p
                className="absolute text-center text-[5.8pt] leading-tight text-[#766b62]"
                style={{ top: `${top + usedH + 2.2}mm`, left: `${left + 20}mm`, width: '60mm' }}
              >
                {note}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
