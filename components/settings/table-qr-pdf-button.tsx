"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/toast";

/**
 * 画面に並んだ A6 の QR カード（data-qr-card）を、1枚1ページの A6 の PDF にしてダウンロードする。
 * ダウンロードした PDF は「倍率 100%・用紙 A6」で印刷するだけ（2026-09-29 Ronnie「ダウンロードして印刷するだけ」）。
 * 1枚ずつ画像（約300dpi）にしてページに貼るので、印刷しても見た目が崩れない。
 * format="png" は最初の1枚を PNG 画像で保存する（お店の予約QR。SNS・HP に載せる用。2026-09-30）。
 */
export function TableQrPdfButton({
  fileName,
  className,
  format = "pdf",
  label,
}: {
  fileName: string;
  className?: string;
  format?: "pdf" | "png";
  /** ボタンの文字（既定は「PDFでダウンロード（A6）」） */
  label?: string;
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
      const pdf = new jsPDF({
        unit: "mm",
        format: "a6",
        orientation: "portrait",
        compress: true,
      });
      for (let i = 0; i < cards.length; i++) {
        const png = await toPng(cards[i], {
          pixelRatio: 3,
          backgroundColor: "#ffffff",
          fontEmbedCSS,
        });
        if (i > 0) pdf.addPage("a6", "portrait");
        pdf.addImage(png, "PNG", 0, 0, 105, 148, undefined, "FAST");
        setBusy({ done: i + 1, total: cards.length });
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
