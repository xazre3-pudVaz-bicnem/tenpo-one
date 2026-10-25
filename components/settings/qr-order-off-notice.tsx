import { CircleAlert } from 'lucide-react';
import { loadQrOrderFlag } from '@/lib/qr-order-flag-server';
import { QR_ORDER_OFF_STORE_NOTE } from '@/lib/qr-order-flag';

/**
 * テーブルQR（お客様の QR 注文）を TENPO ONE 運営が止めているときに、店舗の設定画面（QR印刷・QRのサービス）に出す案内。
 * ON/OFF はコントロールセンター（運営コンソール）だけで変える（2026-10-25 Ronnie）。受け付け中なら何も出さない。
 */
export async function QrOrderOffNotice({ organizationId, storeId }: { organizationId: string | null; storeId: string }) {
  if (!organizationId) return null;
  const flag = await loadQrOrderFlag(organizationId, storeId);
  // 店舗ごとの OFF（コントロールセンターで止めた店舗）だけ。企業ぜんぶの OFF（機能フラグ）は今まで通り何も出さない
  if (flag.reason !== 'store_off') return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{QR_ORDER_OFF_STORE_NOTE[flag.reason]}</span>
    </div>
  );
}
