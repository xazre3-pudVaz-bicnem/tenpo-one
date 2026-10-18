import QRCode from 'qrcode';

/**
 * 印刷用 QR のマス（SVG の path）を作る。components/settings/qr-svg.tsx で使う。
 * logo を付けると真ん中にマークを置く穴をあける（そのマスは消す）。そのぶん誤り訂正を Q（約25%まで読み直せる）に上げ、
 * 穴は QR の約22%の幅（面積で5%ほど）に抑える。中身の URL は変わらない。
 */
export const QR_LOGO_LEVEL = 'Q' as const;
/** マークの幅（QR のマス数に対する割合） */
export const QR_LOGO_RATIO = 0.22;

export interface QrMatrix {
  /** 周りの白込みの一辺（マス数） */
  total: number;
  /** 周りの白（マス数） */
  margin: number;
  /** 黒マスの SVG path（横に続くマスは1本の長方形） */
  path: string;
  /** マークを置く穴（QR のマス目の座標。start ≦ 行・列 < end）。logo なしは null */
  hole: { start: number; end: number } | null;
}

export function qrMatrix(value: string, { logo = false, margin = 4 }: { logo?: boolean; margin?: number } = {}): QrMatrix {
  const qr = QRCode.create(value, { errorCorrectionLevel: logo ? QR_LOGO_LEVEL : 'M' });
  const n = qr.modules.size;

  let hole: QrMatrix['hole'] = null;
  if (logo) {
    let k = Math.round(n * QR_LOGO_RATIO);
    if ((n - k) % 2 !== 0) k += 1; // ぴったり真ん中に
    const start = (n - k) / 2;
    hole = { start, end: start + k };
  }
  const inHole = (r: number, c: number) =>
    hole !== null && r >= hole.start && r < hole.end && c >= hole.start && c < hole.end;

  let path = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c) || inHole(r, c)) {
        c++;
        continue;
      }
      let len = 1;
      while (c + len < n && qr.modules.get(r, c + len) && !inHole(r, c + len)) len++;
      path += `M${c + margin} ${r + margin}h${len}v1h-${len}z`;
      c += len;
    }
  }
  return { total: n + margin * 2, margin, path, hole };
}
