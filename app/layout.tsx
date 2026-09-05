import type { Metadata } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import { brand } from '@/lib/brand';
import { ToastProvider } from '@/components/ui/toast';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import './globals.css';

const notoSansJp = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-jp',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: {
    default: `${brand.name}｜${brand.tagline} 飲食店向けオールインワン店舗管理システム`,
    template: `%s｜${brand.name}`,
  },
  description:
    '予約・POSレジ・売上管理・勤怠・給与・請求書・顧客管理を、ひとつのデータでつなぐ飲食店向けクラウド。TENPO ONEは店舗運営のすべてを1画面に統合します。',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  applicationName: brand.name,
  // iOSでホーム画面から全画面起動するための指定（Safariは beforeinstallprompt 非対応のため手順は /install で案内）
  appleWebApp: {
    capable: true,
    title: brand.name,
    statusBarStyle: 'default',
  },
  ...(siteUrl
    ? { metadataBase: new URL(siteUrl) }
    : { robots: { index: false, follow: false } }),
};

export const viewport = {
  themeColor: '#0F1120',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${notoSansJp.variable} font-sans antialiased`}>
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
