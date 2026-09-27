import { cn } from '@/lib/utils';
import type { PaperRow } from '@/lib/receipt-paper';

/**
 * 画面で「レシートそっくり」に出す紙（2026-09-28 Ronnie）。印字用の行を lib/receipt-paper.ts で列に分けて flex でそろえる。
 * 白い紙・細い罫線・数字は等幅。印字の内容と同じものだけを出す（画面だけの内訳は別のカード）。
 */
export function ReceiptPaper({ rows, className }: { rows: PaperRow[]; className?: string }) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[420px] rounded-md border border-line bg-[#fffdf9] px-3 py-4 text-[12.5px] leading-[1.35] text-[#1c1626] shadow-[0_8px_24px_rgba(44,24,80,.12)] tabular-nums',
        className
      )}
    >
      {rows.map((r, i) => {
        switch (r.t) {
          case 'big':
            return (
              <p key={i} className="py-0.5 text-center text-[19px] font-extrabold tracking-[.14em]">
                {r.text}
              </p>
            );
          case 'center':
            return (
              <p key={i} className="py-px text-center">
                {r.text}
              </p>
            );
          case 'text':
            return (
              <p key={i} className="whitespace-pre-wrap py-px [overflow-wrap:anywhere]">
                {r.text}
              </p>
            );
          case 'kv':
            return (
              <div key={i} className="flex items-baseline gap-2 py-px">
                <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.label}</span>
                <span className="shrink-0 text-right">{r.value}</span>
              </div>
            );
          case 'kcv':
            return (
              <div key={i} className="flex items-baseline gap-2 py-px">
                <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.label}</span>
                <span className="w-[3.4em] shrink-0 text-right text-[#6b6478]">{r.count}</span>
                <span className="w-[6em] shrink-0 text-right">{r.value}</span>
              </div>
            );
          case 'solid':
            return <div key={i} className="my-1.5 h-px bg-[#b9b3c4]" />;
          case 'dotted':
            return <div key={i} className="my-1.5 border-t border-dashed border-[#b9b3c4]" />;
          default:
            return <div key={i} className="h-2" />;
        }
      })}
    </div>
  );
}
