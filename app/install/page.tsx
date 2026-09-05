import type { Metadata } from 'next';
import { Smartphone, Monitor, Share, MoreVertical } from 'lucide-react';
import { brand } from '@/lib/brand';
import { BrandLogo } from '@/components/layout/brand-logo';

export const metadata: Metadata = {
  title: 'アプリのインストール方法',
  description: `${brand.name} をスマホ・タブレット・PCのホーム画面にアプリとして追加する手順です。`,
};

const STEPS = [
  {
    icon: Smartphone,
    title: 'iPhone / iPad（Safari）',
    steps: [
      'Safari で tenpo-one.com を開く',
      '画面下（iPadは右上）の「共有」ボタンをタップ',
      'メニューから「ホーム画面に追加」を選ぶ',
      '右上の「追加」をタップ',
    ],
    note: 'Chromeなど他のブラウザではなく、必ず Safari から行ってください（iOSの仕様）。',
  },
  {
    icon: Smartphone,
    title: 'Android（Chrome）',
    steps: [
      'Chrome で tenpo-one.com を開く',
      '右上の「︙」メニューをタップ',
      '「アプリをインストール」または「ホーム画面に追加」を選ぶ',
      '確認画面で「インストール」をタップ',
    ],
    note: 'ログイン後の画面に表示される「インストール」バナーからも追加できます。',
  },
  {
    icon: Monitor,
    title: 'PC（Chrome / Edge）',
    steps: [
      'Chrome または Edge で tenpo-one.com を開く',
      'アドレスバー右端のインストールアイコンをクリック',
      '「インストール」をクリック',
    ],
    note: 'デスクトップアプリとして独立したウィンドウで起動します。',
  },
];

/**
 * 各OS向けのインストール手順ページ（公開ページ）。
 * iOS Safari は beforeinstallprompt が無くアプリ内バナーを出せないため、ここで手順を案内する。
 */
export default function InstallPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <BrandLogo className="text-2xl" />
      <h1 className="mt-6 text-2xl font-bold text-navy">アプリとしてインストールする</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        {brand.name} は、お使いのスマホ・タブレット・PCに<strong>アプリとして追加</strong>できます。
        ホーム画面のアイコンから全画面で起動でき、ブラウザのアドレスバーが消えるため、店舗のレジ端末でも使いやすくなります。
        アプリストアからのダウンロードや追加料金は不要です。
      </p>

      <div className="mt-8 space-y-5">
        {STEPS.map((s) => (
          <div key={s.title} className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <s.icon className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-navy">{s.title}</h2>
            </div>
            <ol className="mt-3 space-y-2">
              {s.steps.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm text-gray-700">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-deep">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-gray-500">{s.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
        <p className="flex items-center gap-1.5 font-semibold text-gray-700">
          <Share className="h-3.5 w-3.5" />
          うまくいかないときは
        </p>
        <p className="mt-1">
          「ホーム画面に追加」が見つからない場合は、ブラウザを最新版に更新してからお試しください。
          社用タブレットで<MoreVertical className="inline h-3 w-3" />メニューが制限されている場合は、管理者にご確認ください。
        </p>
      </div>
    </div>
  );
}
