import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { storeAccessBlock } from '@/components/pos/store-access-guard';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { FloorBoard } from '@/components/floor/floor-board';
import { loadFloorView } from '@/lib/floor-view-server';
import { saveTableGroup } from './group-actions';
import { clearTable, mergeOrders, setGuestCount, setPaymentMemo, setSeatTime } from '@/app/app/pos/actions';
import { enqueueExpoSlipPrint, enqueueSelectedItemsPrint } from '@/app/app/pos/print-actions';
import { startWalkIn, goToOrder, completeCleaning, setTableAvailability, releaseFinishedCleaning } from './actions';

export const metadata: Metadata = { title: 'テーブル一覧' };

/**
 * テーブル一覧（Web）。データの組み立ては lib/floor-view-server.ts（iPad アプリのネイティブのフロア画面と共通。2026-10-24）
 */
export default async function FloorPage() {
  const ctx = await requireFeature('pos');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="テーブル一覧" en="Tables" />
        <EmptyState
          title="アクセス可能な店舗がありません"
          description="管理者に店舗の割り当てを依頼してください"
        />
      </div>
    );
  }

  // 契約のアクセス制限は、読み込みと同時に（画面を速く。2026-10-21）
  const [accessBlock, view] = await Promise.all([
    storeAccessBlock(store, { countDevice: false }),
    loadFloorView(ctx, supabase, store),
  ]);
  if (accessBlock) return accessBlock;

  const {
    serverNow,
    stayMinutes,
    defaultFloorId,
    floors,
    tableRows,
    tables: tableViews,
    panel,
    panelRows,
    staffOptions,
    seatCourses,
    planItems,
    canOperate,
  } = view;

  return (
    <div>
      {/*
        画面名（オーダー・会計）は上部バーに出ているので、ここでは見出し・説明を出さない。
        レジの設定もここには置かない（設定 > デバイス管理 から開く）。2026-09-23 要望。
      */}
      {tableViews.length === 0 ? (
        <EmptyState
          title="テーブルが登録されていません"
          description="設定画面からフロア・テーブルを登録してください"
        />
      ) : (
        <FloorBoard
          storeId={store.id}
          floors={floors}
          defaultFloorId={defaultFloorId}
          tables={tableViews}
          reservations={panel}
          reservationRows={panelRows}
          assignableTables={tableRows.map((t) => ({ id: t.id, name: t.name, capacityMin: t.capacity_min, capacityMax: t.capacity_max }))}
          staffOptions={staffOptions}
          serverNow={serverNow}
          canOperate={canOperate}
          startWalkInAction={startWalkIn}
          defaultStayMinutes={stayMinutes}
          goToOrderAction={goToOrder}
          completeCleaningAction={completeCleaning}
          setTableAvailabilityAction={setTableAvailability}
          saveTableGroupAction={saveTableGroup}
          mergeOrdersAction={mergeOrders}
          setGuestCountAction={setGuestCount}
          setPaymentMemoAction={setPaymentMemo}
          printExpoSlipAction={enqueueExpoSlipPrint}
          printSelectedItemsAction={enqueueSelectedItemsPrint}
          seatCourses={seatCourses}
          planItems={planItems}
          setSeatTimeAction={setSeatTime}
          clearTableAction={clearTable}
          releaseFinishedCleaningAction={releaseFinishedCleaning}
          // テイクアウトは 即会計 の画面（メニュー選択の左）へ移した（2026-09-30 Ronnie）
          bottomSlot={<Legend />}
        />
      )}
    </div>
  );
}

const LEGEND = [
  { label: '着席中', dot: 'bg-iris-soft border border-wisteria' },
  { label: '注文済', dot: 'bg-iris' },
  { label: 'L.O.済', dot: 'bg-[#F7C948]' },
  { label: '時間超過', dot: 'bg-danger' },
  { label: '会計待ち', dot: 'bg-saffron' },
  { label: '空席', dot: 'bg-wisteria' },
];

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs font-medium text-ink-2">
      {LEGEND.map((l) => (
        <span key={l.label} className="inline-flex items-center">
          <i className={`mr-[5px] inline-block h-[9px] w-[9px] rounded-full ${l.dot}`} aria-hidden />
          {l.label}
        </span>
      ))}
      <span className="text-ink-3">下の線＝残り時間</span>
    </div>
  );
}
