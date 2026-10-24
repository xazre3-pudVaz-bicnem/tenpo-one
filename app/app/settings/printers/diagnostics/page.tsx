import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { kitchenDesign } from '@/lib/ticket-design';
import { renderTicketImage } from '@/lib/ticket-design-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read-only, store-scoped comparison of queued pixels with the running renderer. */
export default async function KitchenPrintDiagnostics() {
  const ctx = await requirePermission('store.settings');
  if (!ctx.currentStore || !ctx.organizationId) return <p>店舗を選択してください</p>;
  const db = await createClient();
  const { data, error } = await db.from('print_jobs')
    .select('id, created_at, status, payload')
    .eq('organization_id', ctx.organizationId).eq('store_id', ctx.currentStore.id)
    .eq('job_type', 'kitchen').order('created_at', { ascending: false }).limit(8);
  const png = await renderTicketImage(kitchenDesign({
    orderId: 'preview', orderNo: 'PREVIEW', tableName: 'T1', guestCount: 2,
    clerkName: 'PREVIEW', lines: [{ name: 'Curry Rice Lunch', nameEn: 'Curry Rice Lunch', delta: 1, modifiers: [], memo: null }],
  }, { title: 'キッチン・ドリンク・デザート', printedAt: 'PREVIEW', textSize: 'medium', language: 'en' }));
  return <main>
    <h1>厨房伝票の確認 — {ctx.currentStore.name}</h1>
    <p>読み取り専用：印刷・再送・注文の変更は行いません。</p>
    <p>Renderer: heading-above-table / one-time-rule / {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local'}</p>
    <h2>現在のサーバーで生成した見本</h2>
    {/* Thermal raster pixels are shown at their native width. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`data:image/png;base64,${png.toString('base64')}`} width={576} alt="現在の厨房レイアウト" />
    <h2>この店舗で作成された直近の厨房伝票</h2>
    {error && <p>印刷履歴を取得できませんでした。</p>}
    {(data ?? []).map(job => {
      const payload = job.payload as { body?: string } | null;
      const images = [...(payload?.body ?? '').matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map(m => m[0]);
      return <section key={job.id}>
        <p>{new Date(job.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} / {job.status} / {job.id}</p>
        {images.length ? images.map((src, i) =>
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} width={576} alt={`保存済み厨房伝票 ${i + 1}`} />
        ) : <p>画像なし（テキスト印刷）</p>}
      </section>;
    })}
  </main>;
}
