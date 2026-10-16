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
 */
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
  /** PDF の用紙（既定 A6。店舗名刺の A4 シートは a4） */
  page?: "a6" | "a4";
  /** "a4-4up" は A4 1枚に A6 を4面＋切り取り線。既定は1枚1ページ */
  layout?: "one-per-page" | "a4-4up";
}) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(
    null,
  );
  const { toast } = useToast();

  const run = async () => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-qr-card]"),
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
          pixelRatio: 3,
          backgroundColor: "#ffffff",
          fontEmbedCSS,
        });
        const a = document.createElement("a");
        a.href = png;
        a.download = fileName;
        a.click();
        return;
      }
      const fourUp = layout === "a4-4up";
      const sheet = fourUp ? "a4" : page;
      const [pw, ph] = sheet === "a4" ? [210, 297] : [105, 148];
      const pdf = new jsPDF({
        unit: "mm",
        format: sheet,
        orientation: "portrait",
        compress: true,
      });
      // A4（210×297mm）をちょうど4等分すると A6 とほぼ同じ 105×148.5mm になる
      const CW = pw / 2;
      const CH = ph / 2;
      const slots: [number, number][] = [
        [0, 0],
        [CW, 0],
        [0, CH],
        [CW, CH],
      ];
      for (let i = 0; i < cards.length; i++) {
        const png = await toPng(cards[i], {
          pixelRatio: 3,
          backgroundColor: "#ffffff",
          fontEmbedCSS,
        });
        if (fourUp) {
          const slot = i % 4;
          if (i > 0 && slot === 0) pdf.addPage("a4", "portrait");
          const [x, y] = slots[slot];
          pdf.addImage(png, "PNG", x, y, CW, CH, undefined, "FAST");
        } else {
          if (i > 0) pdf.addPage(sheet, "portrait");
          pdf.addImage(png, "PNG", 0, 0, pw, ph, undefined, "FAST");
        }
        setBusy({ done: i + 1, total: cards.length });
      }
      if (fourUp) {
        // 切り取り線（ハサミで切る目印）。カードの上に薄いグレーの点線で入れる
        const pages = pdf.getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
          pdf.setPage(p);
          pdf.setDrawColor(160, 160, 160);
          pdf.setLineWidth(0.2);
          pdf.setLineDashPattern([2, 2], 0);
          pdf.line(CW, 0, CW, ph);
          pdf.line(0, CH, pw, CH);
        }
        pdf.setLineDashPattern([], 0);
      }
      pdf.save(fileName);
    } catch (e) {
      console.error("[table-qr-pdf]", e);
      toast(
        format === "png"
          ? "画像を作れませんでした。もう一度お試しください"
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
