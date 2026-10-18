import { qrMatrix } from '@/lib/qr-matrix';

/**
 * 印刷用の QR（SVG。ベクターなので、どれだけ大きく刷ってもにじまない）。
 * 2026-10-19 Ronnie「印刷するとぼやける。画質を高く」→ PNG（data URL）をやめ、マスを SVG で描く。
 * PDF にするとき（TableQrPdfButton が html-to-image で画像にする）も、この SVG がそのまま高い解像度で描かれる。
 *
 * logo を付けると、真ん中に TENPO ONE のマークを置く（2026-10-19 Ronnie「QR の真ん中に TENPO ONE のロゴ」）。
 * マークの下のマスは消して白地にし、誤り訂正を Q に上げる（lib/qr-matrix.ts）。
 * 中身の URL・トークンは変わらない（刷り直し前の QR もそのまま使える）。
 */
export function QrSvg({
  value,
  sizeMm,
  logo = false,
  title,
}: {
  /** QR に入れる文字（URL） */
  value: string;
  /** 周りの白（4マス）込みの一辺（mm） */
  sizeMm: number;
  /** 真ん中に TENPO ONE のマーク */
  logo?: boolean;
  /** 読み上げ用 */
  title?: string;
}) {
  const { total, margin, path, hole } = qrMatrix(value, { logo });
  const pct = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className="relative shrink-0 bg-white" style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${total} ${total}`}
        width="100%"
        height="100%"
        shapeRendering="crispEdges"
        role="img"
        aria-label={title}
        className="block"
      >
        <rect width={total} height={total} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
      {hole && (
        // マーク（PDF でも写るように素の img。public/logo-mark.png は 512px で十分に細かい）。
        // 穴のまわり半マスは白のまま残す
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo-mark.png"
          alt=""
          width={512}
          height={512}
          className="absolute block object-contain"
          style={{
            left: pct(margin + hole.start + 0.5),
            top: pct(margin + hole.start + 0.5),
            width: pct(hole.end - hole.start - 1),
            height: pct(hole.end - hole.start - 1),
          }}
        />
      )}
    </div>
  );
}
