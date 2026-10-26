import { ExternalLink } from 'lucide-react';
import { enterStoreAdmin } from '@/app/admin/support/enter-actions';

/**
 * コントロールセンターの「当店舗の管理画面へ」（2026-10-26 Ronnie）。target は店舗id、または 'org:<企業id>'（全店舗）。
 * 押すと監査ログに残してその店の管理画面へ（app/admin/support/enter-actions.ts）。
 */
export function EnterStoreAdminButton({ target, label = '当店舗の管理画面へ' }: { target: string; label?: string }) {
  return (
    <form action={enterStoreAdmin}>
      <input type="hidden" name="target" value={target} />
      <button
        type="submit"
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-navy px-3 text-[12.5px] font-bold text-white hover:opacity-90"
      >
        {label}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </button>
    </form>
  );
}
