/**
 * 店舗名刺（横名刺 91×55mm）。予約QRカード（booking-qr-card.tsx）と同じデザイン：クリーム地＋テラコッタ。
 * A4 1枚に 2列×5段＝10枚並べ、切り取り線（点線）とトンボ（用紙の余白の線）を入れる。
 * お店で A4 に印刷して、線に沿って切ってレジに置く（2026-09-30 Ronnie「店舗名刺としてプリントする」→
 * 2026-10-19 Ronnie「このデザインも変えて」で黒の立名刺から、予約QRと同じ横名刺に）。
 */
import { BookingQrCard } from './booking-qr-card';

/** 横名刺の大きさ（mm） */
export const MEISHI_W = 91;
export const MEISHI_H = 55;
/** A4 に 2列 × 5段 */
export const MEISHI_COLS = 2;
export const MEISHI_ROWS = 5;
const A4_W = 210;
const A4_H = 297;
const GRID_W = MEISHI_W * MEISHI_COLS; // 182
const GRID_H = MEISHI_H * MEISHI_ROWS; // 275
const LEFT = (A4_W - GRID_W) / 2; // 14
const TOP = (A4_H - GRID_H) / 2; // 11

export interface MeishiData {
  storeName: string;
  address: string | null;
  phone: string | null;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  qrDataUrl: string;
  /** 当店のクーポン（表示する文。名刺はいちばん上の1つだけ） */
  coupons?: string[];
}

/**
 * A4（210×297mm）に横名刺 10枚。切り取り線（カードの境目の点線）と、余白のトンボ（切る位置の目印）。
 * data-qr-card を付けて、PDF（A4）ダウンロードでこの1枚をそのまま画像にする。
 */
export function BookingMeishiSheet(props: MeishiData) {
  const xs = Array.from({ length: MEISHI_COLS + 1 }, (_, i) => LEFT + i * MEISHI_W);
  const ys = Array.from({ length: MEISHI_ROWS + 1 }, (_, i) => TOP + i * MEISHI_H);
  const mark = 'absolute bg-[#292725]';
  return (
    <div
      data-qr-card
      className="relative shrink-0 bg-white text-[#292725] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      style={{ width: `${A4_W}mm`, height: `${A4_H}mm` }}
    >
      {/* 名刺 2×5（中身は予約QRカードと同じ。1枚ずつの印は付けない＝シート全体で PDF 1ページ） */}
      <div
        className="absolute grid"
        style={{
          left: `${LEFT}mm`,
          top: `${TOP}mm`,
          gridTemplateColumns: `repeat(${MEISHI_COLS}, ${MEISHI_W}mm)`,
          gridTemplateRows: `repeat(${MEISHI_ROWS}, ${MEISHI_H}mm)`,
        }}
      >
        {Array.from({ length: MEISHI_COLS * MEISHI_ROWS }, (_, i) => (
          <BookingQrCard
            key={i}
            storeName={props.storeName}
            address={props.address}
            phone={props.phone}
            dataUrl={props.qrDataUrl}
            coupons={props.coupons}
            printable={false}
          />
        ))}
      </div>

      {/* 切り取り線（カードの境目。点線） */}
      {xs.map((x) => (
        <div
          key={`v${x}`}
          aria-hidden
          className="absolute border-l border-dashed border-[#9c948a]"
          style={{ left: `${x}mm`, top: `${TOP}mm`, height: `${GRID_H}mm`, width: 0 }}
        />
      ))}
      {ys.map((y) => (
        <div
          key={`h${y}`}
          aria-hidden
          className="absolute border-t border-dashed border-[#9c948a]"
          style={{ top: `${y}mm`, left: `${LEFT}mm`, width: `${GRID_W}mm`, height: 0 }}
        />
      ))}

      {/* トンボ（余白に出す切る位置の目印。上下・左右） */}
      {xs.map((x) => (
        <div key={`tv${x}`} aria-hidden>
          <div className={mark} style={{ left: `${x - 0.1}mm`, top: `${TOP - 9}mm`, width: '0.2mm', height: '7mm' }} />
          <div className={mark} style={{ left: `${x - 0.1}mm`, top: `${TOP + GRID_H + 2}mm`, width: '0.2mm', height: '7mm' }} />
        </div>
      ))}
      {ys.map((y) => (
        <div key={`th${y}`} aria-hidden>
          <div className={mark} style={{ top: `${y - 0.1}mm`, left: `${LEFT - 12}mm`, height: '0.2mm', width: '10mm' }} />
          <div className={mark} style={{ top: `${y - 0.1}mm`, left: `${LEFT + GRID_W + 2}mm`, height: '0.2mm', width: '10mm' }} />
        </div>
      ))}

      {/* 下の余白：切り方（左の列の下。トンボに重ならないように） */}
      <p
        className="absolute text-center text-[5.8pt] leading-tight text-[#766b62]"
        style={{ top: `${TOP + GRID_H + 2.2}mm`, left: `${LEFT + 20}mm`, width: '60mm' }}
      >
        ✂ 線に沿って切ってください ／ 横名刺 91×55mm × 10枚
      </p>
    </div>
  );
}
