"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/toast";

/**
 * 画面に並んだ A6 の QR カード（data-qr-card）を、1枚1ページの A6 の PDF にしてダウンロードする。
 * ダウンロードした PDF は「倍率 100%・用紙 A6」で印刷するだけ（2026-09-29 Ronnie「ダウンロードして印刷するだけ」）。
 * 1枚ずつ画像（約300dpi）にしてページに貼るので、印刷しても見た目が崩れない。
 * format="png" は最初の1枚を PNG 画像で保存する（お店の予約QR。SNS・HP に載せる用。2026-09-30）。
 * layout="a4-4up" は A4 1枚に A6 を4面並べて切り取り線を入れる（2026-10-16 Ronnie
 * 「a4 paper ma katna milne tarikale pdf」。A6 の紙が無くても A4 に刷って切れば同じ大きさ）。
 * layout="a4-business-card" は名刺サイズ（91×55mm。data-qr-card-bc）を A4 に 2列×5段＝10面並べて切り取り線を入れる
 * （2026-10-17 Ronnie「名刺サイズ・A4 に 10面」。余白 左右14mm・上下11mm で真ん中に）。
 * 2026-10-19 Ronnie「印刷するとぼやける。画質を高く」→ 画像の細かさを 約288dpi（pixelRatio 3）から
 * 約576dpi（pixelRatio 6）に上げた（QR は SVG なのでにじまない）。ただし iPad の Safari は 1枚の画像が
 * 約1600万画素までなので、A4 1枚まるごと（店舗名刺のシート）は自動で少し下げる（約400dpi）。
 */

/** 画像の細かさ。約576dpi（CSS の 1px＝1/96inch × 6）。大きい要素は 1600万画素に収まるまで下げる */
const MAX_PIXEL_RATIO = 6;
const MAX_PIXELS = 16_000_000;
function pixelRatioFor(el: HTMLElement): number {
  const area = Math.max(1, el.offsetWidth * el.offsetHeight);
  return Math.max(2, Math.min(MAX_PIXEL_RATIO, Math.floor(Math.sqrt(MAX_PIXELS / area) * 10) / 10));
}

/** 名刺サイズのカード（mm）と A4 への並べ方（2列×5段） */
const BC_W = 91;
const BC_H = 55;
const BC_COLS = 2;
const BC_ROWS = 5;
const BC_PER_PAGE = BC_COLS * BC_ROWS;
/** A4（210×297mm）の真ん中に寄せる余白：左右 (210-2×91)/2＝14mm、上下 (297-5×55)/2＝11mm */
const BC_MX = (210 - BC_COLS * BC_W) / 2;
const BC_MY = (297 - BC_ROWS * BC_H) / 2;
export function TableQrPdfButton({
  fileName,
  className,
  format = "pdf",
  label,
  page = "a6",
  layout = "one-per-page",
}: {
  fileName: string;
  className?: string;
  format?: "pdf" | "png";
  /** ボタンの文字（既定は「PDFでダウンロード（A6）」） */
  label?: string;
  /** PDF の用紙（既定 A6。店舗名刺の A4 シートは a4。card は横の名刺サイズ 91×55mm＝お店の予約QR） */
  page?: "a6" | "a4" | "card";
  /** "a4-4up" は A4 1枚に A6 を4面＋切り取り線。"a4-business-card" は名刺サイズを A4 に10面＋切り取り線。既定は1枚1ページ */
  layout?: "one-per-page" | "a4-4up" | "a4-business-card";
}) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(
    null,
  );
  const { toast } = useToast();

  const run = async () => {
    const businessCard = layout === "a4-business-card";
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        businessCard ? "[data-qr-card-bc]" : "[data-qr-card]",
      ),
    );
    if (cards.length === 0) {
      toast("印刷するQRがありません", "error");
      return;
    }
    setBusy({ done: 0, total: cards.length });
    try {
      const [{ jsPDF }, { toPng, getFontEmbedCSS }] = await Promise.all([
        import("jspdf"),
        import("html-to-image"),
      ]);
      // 文字（Noto Sans JP など）は1回だけ読み込んで全カードで使う
      const fontEmbedCSS = await getFontEmbedCSS(cards[0]).catch(
        () => undefined,
      );
      if (format === "png") {
        const png = await toPng(cards[0], {
          pixelRatio: pixelRatioFor(cards[0]),
          backgroundColor: "#ffffff",
          fontEmbedCSS,
        });
        const a = document.createElement("a");
        a.href = png;
        a.download = fileName;
        a.click();
        return;
      }
      if (businessCard) {
        // 名刺サイズ 91×55mm を A4 縦に 2列×5段。10枚ごとに次のページ
        const pdf = new jsPDF({
          unit: "mm",
          format: "a4",
          orientation: "portrait",
          compress: true,
        });
        for (let i = 0; i < cards.length; i++) {
          const png = await toPng(cards[i], {
            pixelRatio: pixelRatioFor(cards[i]),
            backgroundColor: "#F7F5F0",
            fontEmbedCSS,
          });
          const slot = i % BC_PER_PAGE;
          if (i > 0 && slot === 0) pdf.addPage("a4", "portrait");
          const x = BC_MX + (slot % BC_COLS) * BC_W;
          const y = BC_MY + Math.floor(slot / BC_COLS) * BC_H;
          pdf.addImage(png, "PNG", x, y, BC_W, BC_H, undefined, "FAST");
          setBusy({ done: i + 1, total: cards.length });
        }
        // 切り取り線（カードの境目に薄いグレーの点線）と、余白のトンボ（切る位置の短い線）。
        // 画面の A4 見本（components/settings/a4-cut-sheets.tsx）と同じ。そのページで使った段まで
        const pages = pdf.getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
          pdf.setPage(p);
          const onPage = Math.min(BC_PER_PAGE, cards.length - (p - 1) * BC_PER_PAGE);
          const rows = Math.ceil(onPage / BC_COLS);
          const right = BC_MX + BC_COLS * BC_W;
          const bottom = BC_MY + rows * BC_H;
          pdf.setDrawColor(156, 148, 138);
          pdf.setLineWidth(0.2);
          pdf.setLineDashPattern([1.5, 1.5], 0);
          for (let c = 0; c <= BC_COLS; c++) {
            const x = BC_MX + c * BC_W;
            pdf.line(x, BC_MY, x, bottom);
          }
          for (let r = 0; r <= rows; r++) {
            const y = BC_MY + r * BC_H;
            pdf.line(BC_MX, y, right, y);
          }
          pdf.setLineDashPattern([], 0);
          pdf.setDrawColor(41, 39, 37);
          for (let c = 0; c <= BC_COLS; c++) {
            const x = BC_MX + c * BC_W;
            pdf.line(x, BC_MY - 9, x, BC_MY - 2);
            pdf.line(x, bottom + 2, x, bottom + 9);
          }
          for (let r = 0; r <= rows; r++) {
            const y = BC_MY + r * BC_H;
            pdf.line(BC_MX - 12, y, BC_MX - 2, y);
            pdf.line(right + 2, y, right + 12, y);
          }
        }
        pdf.setLineDashPattern([], 0);
        pdf.save(fileName);
        return;
      }
      const fourUp = layout === "a4-4up";
      const sheet = fourUp ? "a4" : page;
      const card = sheet === "card";
      const [pw, ph] =
        sheet === "a4" ? [210, 297] : card ? [BC_W, BC_H] : [105, 148];
      // 横の名刺（91×55mm）は横向きの1ページ（jsPDF は [短辺, 長辺] ＋ landscape で横長になる）
      const pageFormat: string | number[] = card ? [BC_H, BC_W] : sheet;
      const pageOrientation = card ? "landscape" : "portrait";
      const pdf = new jsPDF({
        unit: "mm",
        format: pageFormat,
        orientation: pageOrientation,
        compress: true,
      });
      // A4（210×297mm）に A6（105×148mm）を 2×2。上下 0.5mm ずつあけて真ん中に（画面の A4 見本と同じ）
      const CW = 105;
      const CH = 148;
      const TOP4 = (297 - CH * 2) / 2;
      const slots: [number, number][] = [
        [0, TOP4],
        [CW, TOP4],
        [0, TOP4 + CH],
        [CW, TOP4 + CH],
      ];
      for (let i = 0; i < cards.length; i++) {
        const png = await toPng(cards[i], {
          pixelRatio: pixelRatioFor(cards[i]),
          backgroundColor: "#ffffff",
          fontEmbedCSS,
        });
        if (fourUp) {
          const slot = i % 4;
          if (i > 0 && slot === 0) pdf.addPage("a4", "portrait");
          const [x, y] = slots[slot];
          pdf.addImage(png, "PNG", x, y, CW, CH, undefined, "FAST");
        } else {
          if (i > 0) pdf.addPage(pageFormat, pageOrientation);
          pdf.addImage(png, "PNG", 0, 0, pw, ph, undefined, "FAST");
        }
        setBusy({ done: i + 1, total: cards.length });
      }
      if (fourUp) {
        // 切り取り線（ハサミで切る目印）。カードの上に薄いグレーの点線で入れる
        const pages = pdf.getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
          pdf.setPage(p);
          const onPage = Math.min(4, cards.length - (p - 1) * 4);
          pdf.setDrawColor(156, 148, 138);
          pdf.setLineWidth(0.2);
          pdf.setLineDashPattern([1.5, 1.5], 0);
          pdf.line(CW, 0, CW, onPage > 2 ? ph : TOP4 + CH);
          pdf.line(0, TOP4 + CH, pw, TOP4 + CH);
        }
        pdf.setLineDashPattern([], 0);
      }
      pdf.save(fileName);
    } catch (e) {
      console.error("[table-qr-pdf]", e);
      toast(
        format === "png"
          ? "画像を作れませんでした。もう一度お試しください"
          : businessCard
            ? "PDFを作れませんでした。もう一度お試しください"
            : "PDFを作れませんでした。「印刷する」から A6 で印刷してください",
        "error",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy !== null}
      className={className}
    >
      <Download className="h-4 w-4" aria-hidden />
      {busy
        ? format === "png"
          ? "画像を作成中…"
          : `PDFを作成中… ${busy.done}/${busy.total}`
        : (label ?? "PDFでダウンロード（A6）")}
    </button>
  );
}
