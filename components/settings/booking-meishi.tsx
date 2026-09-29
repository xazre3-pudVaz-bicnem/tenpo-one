/**
 * 店舗名刺（立名刺 55×91mm）。予約QRカード（booking-qr-card.tsx）と同じ TENPO ONE の黒と紫。
 * A4 1枚に 3×3＝9枚並べ、切り取り線（点線）とトンボ（用紙の余白の線）を入れる。
 * お店で A4 に印刷して、線に沿って切ってレジに置く（2026-09-30 Ronnie「店舗名刺としてプリントする。
 * A4 に名刺サイズが入るだけ。切る線も全部。立名刺」）。
 */

/** 立名刺の大きさ（mm） */
export const MEISHI_W = 55;
export const MEISHI_H = 91;
/** A4 に 3列 × 3段 */
export const MEISHI_COLS = 3;
export const MEISHI_ROWS = 3;
const A4_W = 210;
const A4_H = 297;
const GRID_W = MEISHI_W * MEISHI_COLS; // 165
const GRID_H = MEISHI_H * MEISHI_ROWS; // 273
const LEFT = (A4_W - GRID_W) / 2; // 22.5
const TOP = (A4_H - GRID_H) / 2; // 12

export interface MeishiData {
  storeName: string;
  address: string | null;
  phone: string | null;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  qrDataUrl: string;
  /** 当店のクーポン（表示する文。名刺はいちばん上の1つだけ） */
  coupons?: string[];
}

/** 名刺1枚（55×91mm。縁なしの黒） */
export function BookingMeishiCard({ storeName, address, phone, qrDataUrl, coupons = [] }: MeishiData) {
  const coupon = coupons.find((c) => c.trim()) ?? null;
  const nameSize = storeName.length <= 10 ? 'text-[10.5pt]' : storeName.length <= 16 ? 'text-[9pt]' : 'text-[7.8pt]';
  return (
    <div
      className="relative flex flex-col overflow-hidden bg-[#15121a] text-white"
      style={{ width: `${MEISHI_W}mm`, height: `${MEISHI_H}mm` }}
    >
      <div
        aria-hidden
        className="absolute -top-[10mm] left-1/2 h-[24mm] w-[46mm] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(123,63,228,0.5),rgba(123,63,228,0)_70%)]"
      />
      {/* 上：店名・ご予約 */}
      <div className="relative px-[3.5mm] pt-[4.5mm] text-center">
        <p className={`line-clamp-2 leading-[1.25] font-extrabold tracking-[0.03em] text-balance ${nameSize}`}>{storeName}</p>
        <div aria-hidden className="mx-auto mt-[1.4mm] h-[0.45mm] w-[8mm] rounded-full bg-linear-to-r from-[#9d6bff] to-[#5b2c8f]" />
        <p className="mt-[1.6mm] inline-flex items-center gap-[1.2mm] rounded-full border border-[#7b3fe4]/70 bg-[#7b3fe4]/20 px-[2.2mm] py-[0.4mm]">
          <span className="text-[4.4pt] font-extrabold tracking-[0.25em] text-[#b89aff]">RESERVATION</span>
          <span className="text-[7pt] font-bold">ご予約</span>
        </p>
        {coupon && (
          <p className="mx-auto mt-[1.6mm] line-clamp-1 rounded-[1.4mm] border border-dashed border-[#f5c451]/80 bg-[#f5c451]/10 px-[1.6mm] py-[0.5mm] text-[5.6pt] font-bold">
            <span className="mr-[1mm] text-[4pt] tracking-[0.15em] text-[#f5c451]">COUPON</span>
            {coupon}
          </p>
        )}
      </div>

      {/* まんなか：QR と案内 */}
      <div className="relative flex flex-1 flex-col items-center justify-center">
        <div className="rounded-[2.2mm] bg-linear-to-br from-[#9d6bff] to-[#5b2c8f] p-[0.8mm]">
          <div className="rounded-[1.6mm] bg-white p-[1.2mm]">
            {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
            <img
              src={qrDataUrl}
              alt={`${storeName}の予約QRコード`}
              width={480}
              height={480}
              className={`block [image-rendering:pixelated] ${coupon ? 'h-[27mm] w-[27mm]' : 'h-[31mm] w-[31mm]'}`}
            />
          </div>
        </div>
        <p className="mt-[2mm] text-center text-[6.3pt] leading-[1.4] font-bold">
          スマホのカメラで読み取って
          <br />
          ご予約ください
        </p>
        <p className="mt-[0.4mm] text-[4.3pt] text-[#b9a9d9]">Scan to book a table</p>
      </div>

      {/* 下：住所・電話・帯 */}
      {(address || phone) && (
        <div className="relative mx-[3.5mm] border-t border-white/15 pt-[1.5mm] pb-[1.6mm] text-center">
          {address && <p className="line-clamp-2 text-[4.8pt] leading-[1.45] text-[#e3d6ff]">{address}</p>}
          {phone && (
            <p className="mt-[0.4mm] text-[7pt] font-bold tracking-[0.05em] tabular-nums">
              <span className="mr-[1mm] text-[4.4pt] font-extrabold tracking-[0.2em] text-[#b89aff]">TEL</span>
              {phone}
            </p>
          )}
        </div>
      )}
      <div className="relative flex shrink-0 items-center justify-between bg-linear-to-r from-[#7b3fe4] to-[#5b2c8f] px-[3.5mm] py-[1.3mm]">
        <span className="text-[4.4pt] font-bold tracking-[0.12em]">WEB RESERVATION</span>
        <span className="text-[4.4pt] font-extrabold tracking-[0.16em]">
          TENPO <span className="text-[#e3d6ff]">ONE</span>
        </span>
      </div>
    </div>
  );
}

/**
 * A4（210×297mm）に名刺 9枚。切り取り線（カードの境目の点線）と、余白のトンボ（切る位置の目印）。
 * data-qr-card を付けて、PDF（A4）ダウンロードでこの1枚をそのまま画像にする。
 */
export function BookingMeishiSheet(props: MeishiData) {
  const xs = Array.from({ length: MEISHI_COLS + 1 }, (_, i) => LEFT + i * MEISHI_W);
  const ys = Array.from({ length: MEISHI_ROWS + 1 }, (_, i) => TOP + i * MEISHI_H);
  const mark = 'absolute bg-[#15121a]';
  return (
    <div
      data-qr-card
      className="relative shrink-0 bg-white text-[#15121a] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      style={{ width: `${A4_W}mm`, height: `${A4_H}mm` }}
    >
      {/* 名刺 3×3 */}
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
          <BookingMeishiCard key={i} {...props} />
        ))}
      </div>

      {/* 切り取り線（カードの境目。点線） */}
      {xs.map((x) => (
        <div
          key={`v${x}`}
          aria-hidden
          className="absolute border-l border-dashed border-[#9a93a8]"
          style={{ left: `${x}mm`, top: `${TOP}mm`, height: `${GRID_H}mm`, width: 0 }}
        />
      ))}
      {ys.map((y) => (
        <div
          key={`h${y}`}
          aria-hidden
          className="absolute border-t border-dashed border-[#9a93a8]"
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

      {/* 下の余白：切り方（まんなかの列の下。トンボに重ならないように） */}
      <p
        className="absolute text-center text-[5.8pt] leading-tight text-[#7a7090]"
        style={{ top: `${TOP + GRID_H + 2.4}mm`, left: `${LEFT + MEISHI_W + 1}mm`, width: `${MEISHI_W - 2}mm` }}
      >
        ✂ 線に沿って切ってください
        <br />
        立名刺 55×91mm × 9枚
      </p>
    </div>
  );
}
