import type { SessionContext } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';
import { loadFloorView, type FloorView } from '@/lib/floor-view-server';
import { loadStoreClerks } from '@/lib/pos-clerks-server';
import { cancelApprovers } from '@/lib/clerk-roles';
import { visitSourcesFrom, HANDY_PLANS } from '@/lib/handy-visit';
import type { TableView, PanelReservation, FloorRow } from '@/components/floor/types';
import type { SeatCourseOption } from '@/lib/seat-time';
import type { HandyPlanItem } from '@/lib/handy-visit';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * iPad アプリのネイティブのフロア（テーブル一覧）画面に返すもの（GET /api/app/v1/pos?part=floor）。
 * 中身は Web のテーブル一覧（lib/floor-view-server.ts）と同じ。それに、お客様情報（来店登録）で選ぶもの・承認できる担当者を足す
 */
export interface NativeFloorPayload {
  store: { id: string; name: string };
  serverNow: number;
  stayMinutes: number;
  defaultFloorId: string | null;
  floors: FloorRow[];
  tables: TableView[];
  /** 右パネル「本日のご予約」 */
  reservations: PanelReservation[];
  seatCourses: SeatCourseOption[];
  /** お客様情報のモードで選ぶプラン商品 */
  planItems: HandyPlanItem[];
  /** モードの一覧（アラカルト・飲み放題…。表示順） */
  plans: { id: string; name: string }[];
  /** 来店経路（この店で使うもの。設定 > レジ） */
  visitSources: { id: string; label: string }[];
  /** テーブルクリアを承認できる担当者（店長以上）。空なら承認なしで通す（Web と同じ） */
  approvers: { id: string; name: string }[];
  canOperate: boolean;
}

export async function loadNativeFloor(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeFloorPayload> {
  const [view, { data: settings }, clerks] = await Promise.all([
    loadFloorView(ctx, supabase, store),
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    loadStoreClerks(supabase, store.id),
  ]);
  return nativeFloorPayload(store, view, settings?.settings ?? null, clerks);
}

/** 純粋な組み立て（テスト用に分けてある） */
export function nativeFloorPayload(
  store: { id: string; name: string },
  view: FloorView,
  storeSettings: unknown,
  clerks: { id: string; name: string; role: Parameters<typeof cancelApprovers>[0][number]['role'] }[]
): NativeFloorPayload {
  return {
    store: { id: store.id, name: store.name },
    serverNow: view.serverNow,
    stayMinutes: view.stayMinutes,
    defaultFloorId: view.defaultFloorId,
    floors: view.floors,
    tables: view.tables,
    reservations: view.panel,
    seatCourses: view.seatCourses,
    planItems: view.planItems,
    plans: HANDY_PLANS.map((p) => ({ id: p.id, name: p.name })),
    visitSources: visitSourcesFrom(storeSettings).map((s) => ({ id: s.id, label: s.label })),
    approvers: cancelApprovers(clerks).map((c) => ({ id: c.id, name: c.name })),
    canOperate: view.canOperate,
  };
}
