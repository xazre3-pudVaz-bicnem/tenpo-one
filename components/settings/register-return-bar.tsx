'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { FROM_REGISTER, registerBackUrl, registerSettingsUrl } from '@/lib/register-settings';

/**
 * レジの設定（/app/pos/settings）から開いた設定画面の上に出す「レジの設定に戻る」。
 * ?from=register のときだけ出す（設定メニューから普通に開いたときは出さない）。
 * iPad をホーム画面から開いているとブラウザの戻るボタンが無いため、画面の中に戻り口を置く。
 */
export function RegisterReturnBar() {
  const params = useSearchParams();
  if (params?.get('from') !== FROM_REGISTER) return null;
  const order = params.get('order');
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft/50 px-3 py-2 print:hidden">
      <Link
        href={registerSettingsUrl(order)}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-white px-4 text-sm font-bold text-navy shadow-sm hover:bg-gray-50"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        レジの設定に戻る
      </Link>
      <Link href={registerBackUrl(order)} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary hover:underline">
        POSレジへ
      </Link>
      <span className="text-xs text-gray-500">レジから開いています。保存すると、レジ・ハンディ・お客様QRに反映されます。</span>
    </div>
  );
}
