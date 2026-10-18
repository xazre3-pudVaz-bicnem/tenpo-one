import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { MenuScanImport } from '@/components/settings/menu-scan-import';

export const metadata: Metadata = { title: '写真・PDFからメニューを登録 | 設定' };

/**
 * メニューの写真・PDF から商品をまとめて登録（2026-10-18 Ronnie「メニューの PDF・写真をアップロードして自動でメニューに。
 * お金がかからないもので」）。読み取りは端末のブラウザの中だけ（components/settings/menu-scan-import.tsx）。
 * 登録はデータ取込（CSV）と同じ処理・同じ権限（org.settings）。
 */
export default async function MenuScanPage() {
  const ctx = await requirePermission('org.settings');
  const store = ctx.currentStore ?? ctx.stores[0];
  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="写真・PDFからメニューを登録"
        en="Scan menu"
        description="メニューの写真か PDF を選ぶと、商品名・価格を読み取って表にします。確認してから登録します"
      />
      {store ? (
        <MenuScanImport storeName={store.name} />
      ) : (
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから登録してください" />
      )}
    </div>
  );
}
