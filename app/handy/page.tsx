import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { handyDateLabel } from '@/lib/handy-clerk';
import { readHandyClerk } from '@/lib/handy-session';
import {
  HandyMain,
  HandyMenuButton,
  HandyOperatorBar,
  HandyRefreshButton,
  HandyTopBar,
} from '@/components/handy/handy-chrome';
import { HandyLoginScreen } from '@/components/handy/handy-login-screen';
import { HandyTableList, type HandyTableCard } from '@/components/handy/handy-table-list';
import type { HandyServiceCall } from '@/components/handy/logic';
import { signOut } from '@/app/app/actions';
import { setTableAvailability } from '@/app/app/floor/actions';
import { loginHandyClerk } from '@/app/app/handy/actions';

export const metadata: Metadata = { title: 'テーブル一覧' };

/** 描画の基準時刻（リクエスト時点）。クライアントの時計のハイドレーション初期値にも使う */
function requestTime() {
  return Date.now();
}

export default async function HandyTablesPage() {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return (
      <>
        <HandyTopBar left={<HandyMenuButton />} title="テーブル一覧" />
        <HandyMain>
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#7a7090]">
            {store
              ? '注文の権限がありません。店長・管理者に権限の付与を依頼してください。'
              : 'アクセス可能な店舗がありません。管理者に店舗の割り当てを依頼してください。'}
          </p>
        </HandyMain>
      </>
    );
  }

  const supabase = await createClient();

  // 承認済みレイアウトの起動画面：担当者を選ぶまではテーブル一覧を出さない
  const clerk = await readHandyClerk();
  if (!clerk) {
    const { data: clerks } = await supabase
      .from('pos_clerks')
      .select('id, name')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order')
      .order('name');
    return (
      <HandyLoginScreen
        storeName={store.name}
        accountName={ctx.displayName}
        clerks={(clerks ?? []).map((c) => ({ id: c.id, name: c.name }))}
        today={handyDateLabel(requestTime())}
        loginAction={loginHandyClerk}
        signOutAction={signOut}
      />
    );
  }

  const [{ data: tables }, { data: orders }, { data: calls }] = await Promise.all([
    supabase
      .from('restaurant_tables')
      .select('id, name, capacity_max, current_status, sort_order')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order')
      .order('name'),
    supabase
      .from('orders')
      .select('id, table_id, opened_at, guest_count, total')
      .eq('store_id', store.id)
      .eq('status', 'open')
      .not('table_id', 'is', null)
      .order('opened_at'),
    supabase
      .from('service_calls')
      .select('id, table_id, kind, note, created_at')
      .eq('store_id', store.id)
      .eq('status', 'open')
      .order('created_at'),
  ]);

  const tableRows = tables ?? [];
  const tableNameById = new Map(tableRows.map((t) => [t.id, t.name]));

  // 卓ごとに未会計注文を集計（相席・伝票分割で複数ある場合は合算し、経過は最初の伝票から数える）
  const byTable = new Map<
    string,
    { orderCount: number; openedAtMs: number; guestCount: number; total: number }
  >();
  for (const o of orders ?? []) {
    if (!o.table_id) continue;
    const openedAtMs = new Date(o.opened_at).getTime();
    const prev = byTable.get(o.table_id);
    byTable.set(o.table_id, {
      orderCount: (prev?.orderCount ?? 0) + 1,
      openedAtMs: prev ? Math.min(prev.openedAtMs, openedAtMs) : openedAtMs,
      guestCount: (prev?.guestCount ?? 0) + (o.guest_count ?? 0),
      total: (prev?.total ?? 0) + Number(o.total ?? 0),
    });
  }

  const serviceCalls: HandyServiceCall[] = (calls ?? []).map((c) => ({
    id: c.id,
    tableId: c.table_id,
    tableName: tableNameById.get(c.table_id) ?? null,
    kind: c.kind === 'checkout' ? 'checkout' : 'staff',
    createdAtMs: new Date(c.created_at).getTime(),
    note: c.note,
  }));

  const cards: HandyTableCard[] = tableRows.map((t) => {
    const summary = byTable.get(t.id) ?? null;
    return {
      id: t.id,
      name: t.name,
      capacityMax: t.capacity_max,
      currentStatus: t.current_status,
      orderCount: summary?.orderCount ?? 0,
      openedAtMs: summary?.openedAtMs ?? null,
      guestCount: summary?.guestCount ?? 0,
      total: summary?.total ?? 0,
    };
  });

  return (
    <>
      <HandyTopBar
        left={<HandyMenuButton />}
        storeName={store.name}
        title="テーブル一覧"
        right={<HandyRefreshButton />}
      />
      <HandyOperatorBar label={clerk.name} note={`${cards.length}テーブル · HANDY`} />
      <HandyMain>
        <HandyTableList
          tables={cards}
          calls={serviceCalls}
          serverNow={requestTime()}
          setTableLockAction={setTableAvailability}
        />
      </HandyMain>
    </>
  );
}
