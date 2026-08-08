import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Store, Clock, LayoutGrid, UtensilsCrossed, Percent, CalendarClock, Printer, CreditCard, ScrollText, ChevronRight,
  Building2, ShieldCheck, Plug, Upload, AlertTriangle, BookOpen,
} from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { canWriteAccounting } from '@/components/accounting/roles';

export const metadata: Metadata = { title: '設定' };

interface SettingsCard {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

export default async function SettingsHubPage() {
  const ctx = await requirePermission('store.settings');

  const cards: SettingsCard[] = [
    {
      href: '/app/settings/company',
      title: '企業情報',
      description: '会社名・住所・連絡先・請求情報の管理',
      icon: Building2,
      visible: can(ctx.role, 'org.settings'),
    },
    {
      href: '/app/settings/store',
      title: '店舗情報',
      description: '名称・住所・連絡先・紹介文・公開予約URL',
      icon: Store,
      visible: true,
    },
    {
      href: '/app/settings/hours',
      title: '営業時間・休業日',
      description: '曜日別の営業時間、定休日、臨時休業の設定',
      icon: Clock,
      visible: true,
    },
    {
      href: '/app/settings/tables',
      title: 'フロア・テーブル',
      description: 'フロア構成、テーブルの席数・種別・利用停止',
      icon: LayoutGrid,
      visible: true,
    },
    {
      href: '/app/settings/menu',
      title: 'メニュー',
      description: 'カテゴリ・商品の登録、価格、売切管理',
      icon: UtensilsCrossed,
      visible: can(ctx.role, 'menu.manage'),
    },
    {
      href: '/app/settings/tax',
      title: '税率',
      description: '税率マスタの登録・既定税率の設定',
      icon: Percent,
      visible: true,
    },
    {
      href: '/app/settings/accounts',
      title: '勘定科目',
      description: '複式簿記の勘定科目マスタ（資産・負債・純資産・収益・費用）の登録',
      icon: BookOpen,
      visible: canWriteAccounting(ctx.role),
    },
    {
      href: '/app/settings/booking',
      title: '予約設定',
      description: '予約枠間隔・受付期間・キャンセル期限',
      icon: CalendarClock,
      visible: true,
    },
    {
      href: '/app/settings/printers',
      title: 'レジ・プリンター',
      description: 'レジ端末とレシート・厨房プリンターの設定',
      icon: Printer,
      visible: true,
    },
    {
      href: '/app/settings/payments',
      title: '決済・端末',
      description: 'Stripe接続・決済端末・予約事前決済',
      icon: CreditCard,
      visible: true,
    },
    {
      href: '/app/settings/integrations',
      title: '連携',
      description: '決済・プリンター・外部サービス連携の状態確認',
      icon: Plug,
      visible: true,
    },
    {
      href: '/app/settings/audit',
      title: '監査ログ',
      description: '権限変更・停止・設定変更などの操作履歴',
      icon: ScrollText,
      visible: can(ctx.role, 'audit.view'),
    },
    {
      href: '/app/settings/loyalty',
      title: '会員・ポイント',
      description: 'ポイント付与率・利用設定（例: 100円=1pt）',
      icon: ShieldCheck,
      visible: can(ctx.role, 'org.settings'),
    },
    {
      href: '/app/settings/approvals',
      title: '承認ルール',
      description: '金額帯別の必要承認ロール・自己承認可否の設定',
      icon: ShieldCheck,
      visible: can(ctx.role, 'org.settings'),
    },
    {
      href: '/app/settings/import',
      title: 'データ取込',
      description: 'CSVから商品・顧客・仕入先・在庫品目をまとめて登録',
      icon: Upload,
      visible: can(ctx.role, 'org.settings'),
    },
    {
      href: '/app/settings/alerts',
      title: '異常検知の閾値',
      description: '現金差異・値引率・原価率・人件費率などアラート判定の閾値設定',
      icon: AlertTriangle,
      visible: true,
    },
  ];

  const targetStore = ctx.currentStore ?? ctx.stores[0];

  return (
    <div>
      <PageHeader
        title="設定"
        description={targetStore ? `対象店舗: ${targetStore.name}` : '対象店舗が選択されていません'}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards
          .filter((c) => c.visible)
          .map((c) => (
            <Link key={c.href} href={c.href}>
              <Card className="flex h-full items-start gap-4 p-5 transition-shadow hover:shadow-md">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-deep">
                  <c.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy">{c.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{c.description}</p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" />
              </Card>
            </Link>
          ))}
      </div>
    </div>
  );
}
