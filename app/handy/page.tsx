import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { handyDateLabel } from '@/lib/handy-clerk';
import { readHandyClerk } from '@/lib/handy-session';
import {
  HandyMain,
  HandyMenuButton,
  HandyRefreshButton,
  HandyTopBar,
} from '@/components/handy/handy-chrome';
import { HandyLoginScreen } from '@/components/handy/handy-login-screen';
import { HandyTableList } from '@/components/handy/handy-table-list';
import { loadHandyTables } from '@/lib/handy-view-server';
import { signOut } from '@/app/app/actions';
import { setTableAvailability } from '@/app/app/floor/actions';
import { saveTableGroup } from '@/app/app/floor/group-actions';
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
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#766b62]">
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

  // 卓・伝票・呼び出し・フロアの組み立ては lib/handy-view-server.ts（iPhone アプリのネイティブのテーブル一覧と共用。2026-10-24）
  const view = await loadHandyTables(supabase, store.id);

  return (
    <>
      <HandyTopBar
        left={<HandyMenuButton />}
        storeName={store.name}
        title="テーブル一覧"
        right={<HandyRefreshButton />}
      />
      {/* 担当者の行は出さない（≡ の中に「担当者を変更（名前）」。2026-10-20 Ronnie） */}
      <HandyMain>
        <HandyTableList
          tables={view.tables}
          calls={view.calls}
          serverNow={requestTime()}
          setTableLockAction={setTableAvailability}
          saveTableGroupAction={saveTableGroup}
          floors={view.floors}
          defaultFloorId={view.defaultFloorId}
          storeId={store.id}
        />
      </HandyMain>
    </>
  );
}
