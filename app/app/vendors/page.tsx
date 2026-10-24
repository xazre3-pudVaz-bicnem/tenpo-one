import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadVendorRows } from '@/lib/purchasing-data-server';
import { PageHeader } from '@/components/ui/page-header';
import { Input, Select } from '@/components/ui/input';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { VendorForm } from './vendor-form';
import { VendorTable, type VendorRow } from './vendor-table';

export const metadata: Metadata = { title: '仕入先' };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const ctx = await requireFeature('inventory');
  const supabase = await createClient();
  const sp = await searchParams;

  // 読み込みは lib/purchasing-data-server.ts（iPad アプリのネイティブ画面と共用）
  const rows: VendorRow[] = await loadVendorRows(supabase, ctx.organizationId ?? '', { q: sp.q, status: sp.status });

  return (
    <div>
      <PageHeader
        title="仕入先"
        description="発注・請求書で使用する取引先マスタを管理します"
        actions={
          // 仕入先の画面から入出金へ（2026-10-14 宮崎さん「仕入先の画面から入出金の画面に進めるように」。レジクローズの「← 入出金」と同じボタン）
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/app/cash" className={buttonVariants({ variant: 'secondary' })}>
              <ArrowLeft className="h-4 w-4" />
              入出金
            </Link>
            <VendorForm />
          </div>
        }
      />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">検索</label>
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="仕入先名で検索" className="w-56" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">状態</label>
          <Select name="status" defaultValue={sp.status ?? ''} className="w-36">
            <option value="">すべて（削除済み除く）</option>
            <option value="active">取引中</option>
            <option value="inactive">休止</option>
            <option value="deleted">削除済み</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          検索する
        </Button>
      </form>

      <VendorTable rows={rows} />
    </div>
  );
}
