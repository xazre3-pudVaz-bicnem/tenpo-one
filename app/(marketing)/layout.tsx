import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';

/**
 * マーケティングサイト共通レイアウト。
 * トップ・機能・料金・セキュリティ・問い合わせ・運営会社・法務ページに適用する。
 * 顧客向けの /book・/booking は (public) 側の最小レイアウトを継続利用する（別グループ）。
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
