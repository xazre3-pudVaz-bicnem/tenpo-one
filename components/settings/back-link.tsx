import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/** スマホ用の「‹ 設定」戻るリンク。PC（lg以上）は左の設定メニューがあるため表示しない。 */
export function SettingsBackLink() {
  return (
    <Link
      href="/app/settings"
      className="-ml-1 mb-3 inline-flex min-h-[40px] items-center gap-0.5 rounded-lg pr-2 text-sm font-bold text-royal hover:bg-iris-soft lg:hidden print:hidden"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
      設定
      <span className="en-inline">Settings</span>
    </Link>
  );
}
