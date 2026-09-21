import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ThemeBody } from '@/components/layout/theme-body';
import { HandyChrome } from '@/components/handy/handy-chrome';
import type { HandyServiceCall } from '@/components/handy/logic';
import { resolveServiceCall } from '@/app/app/handy/actions';

/**
 * ハンディは TENPO ONE 本体（/app）の外に置く独立した全画面アプリ。
 * 承認済みレイアウト（2026-09-21）どおり、本体の上部バー・左メニュー・下部5タブは出さず、
 * 濃紫の上部バーと「SELECT / HANDY・RESERVATION」だけで構成する。
 * 認証・機能フラグは本体と同じ（未ログインは /login へ）。
 */

export const metadata: Metadata = { title: 'ハンディ' };
export const viewport = { themeColor: '#241436' };

/** 描画の基準時刻（リクエスト時点）。クライアントの時計のハイドレーション初期値にも使う */
function requestTime() {
  return Date.now();
}

export default async function HandyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;

  let calls: HandyServiceCall[] = [];
  if (store) {
    const supabase = await createClient();
    const [{ data: rows }, { data: tables }] = await Promise.all([
      supabase
        .from('service_calls')
        .select('id, table_id, kind, note, created_at')
        .eq('store_id', store.id)
        .eq('status', 'open')
        .order('created_at'),
      supabase
        .from('restaurant_tables')
        .select('id, name')
        .eq('store_id', store.id),
    ]);
    const nameById = new Map((tables ?? []).map((t) => [t.id, t.name]));
    calls = (rows ?? []).map((c) => ({
      id: c.id,
      tableId: c.table_id,
      tableName: nameById.get(c.table_id) ?? null,
      kind: c.kind === 'checkout' ? 'checkout' : 'staff',
      createdAtMs: new Date(c.created_at).getTime(),
      note: c.note,
    }));
  }

  return (
    <>
      {/* トースト等 body 直下の要素にも店舗画面の配色を効かせる */}
      <ThemeBody />
      <HandyChrome
        storeId={store?.id ?? ''}
        storeName={store?.name ?? '店舗が未選択です'}
        staffName={ctx.displayName}
        stores={ctx.stores}
        currentStoreId={ctx.currentStore?.id ?? null}
        allowAll={ctx.isHq}
        calls={calls}
        serverNow={requestTime()}
        resolveServiceCallAction={resolveServiceCall}
      >
        {children}
      </HandyChrome>
    </>
  );
}
