import { fitPt, splitStoreName } from '@/lib/store-name';

/**
 * 印刷物（予約QR・テーブルQR）の店舗名。1行目に店名、2行目に支店名。途中で折り返さない
 * （2026-10-19 Ronnie「店名が上下に分かれるのはダメ。店名、その下に支店」）。長い名前は字を小さくして1行に収める。
 */
export function PrintStoreName({
  name,
  widthMm,
  brandPt,
  branchPt,
}: {
  name: string;
  /** 使える幅（mm） */
  widthMm: number;
  /** 店名・支店名のいちばん大きい字（pt） */
  brandPt: number;
  branchPt: number;
}) {
  const { brand, branch } = splitStoreName(name);
  return (
    <div className="w-full text-center whitespace-nowrap">
      <p className="leading-[1.2] font-extrabold tracking-[0.03em]" style={{ fontSize: `${fitPt(brand, widthMm, brandPt, brandPt * 0.55)}pt` }}>
        {brand}
      </p>
      {branch && (
        <p className="mt-[0.5mm] leading-[1.2] font-bold tracking-[0.08em]" style={{ fontSize: `${fitPt(branch, widthMm, branchPt, branchPt * 0.6)}pt` }}>
          {branch}
        </p>
      )}
    </div>
  );
}
