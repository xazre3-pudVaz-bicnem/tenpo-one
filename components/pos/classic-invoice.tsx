import { classicInvoiceLayout, type ClassicInvoiceOptions } from '@/lib/classic-invoice';
import type { ReceiptData } from '@/lib/receipts';

/** Same logical coordinates as the actual raster print, including split receipts. */
export function ClassicInvoice({ receipt, ...options }: ClassicInvoiceOptions & { receipt: ReceiptData }) {
  const layout = classicInvoiceLayout(receipt, options);
  return <>
    <style>{`@font-face{font-family:TenpoInvoice;src:url('/fonts/NotoSansCJKjp-Regular.otf') format('opentype');font-display:swap}`}</style>
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="領収書" className="block w-full min-w-[540px] bg-white" style={{ fontFamily: 'TenpoInvoice, sans-serif' }}>
      <rect width={layout.width} height={layout.height} fill="white" />
      {layout.items.map((item, i) => item.kind === 'text'
        ? <text key={i} x={item.x} y={item.y} dominantBaseline="text-before-edge" fontSize={item.size} fontWeight={item.bold ? 700 : 400}
            textAnchor={item.align === 'right' ? 'end' : item.align === 'center' ? 'middle' : 'start'}
            >{item.text}</text>
        : item.kind === 'line' ? <line key={i} x1={item.x} y1={item.y} x2={item.x + item.width} y2={item.y} stroke="#555" />
        : <rect key={i} x={item.x} y={item.y} width={item.width} height={item.height} fill="none" stroke="#888" strokeDasharray="4 4" />)}
    </svg>
  </>;
}
