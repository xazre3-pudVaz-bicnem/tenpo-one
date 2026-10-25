/**
 * ディスプレイ端末（キッチン）の持ち場の絞り込み（純関数・テスト対象）。
 * KDS の読み込み（lib/kds-server.ts の loadKdsBoard）はそのまま使い、その結果から
 * 端末に決めた持ち場（stations。空＝すべて）の品目だけを残す。件数・平均経過時間も残した品目で数え直す。
 */
import { STATION_FILTER_OPTIONS, type KdsOrderGroup, type Station, type StationFilter } from '@/components/kitchen/types';

export interface KdsStationView {
  groups: KdsOrderGroup[];
  unservedCount: number;
  avgElapsedMinutes: number;
  /** 上のタブに出す持ち場（「すべて」＋決めた持ち場。空なら全部） */
  stationOptions: StationFilter[];
}

export function filterKdsByStations(groups: readonly KdsOrderGroup[], stations: readonly string[], now: number): KdsStationView {
  const wanted = new Set(stations.filter((s): s is Station => (STATION_FILTER_OPTIONS as string[]).includes(s) && s !== 'all'));
  const kept =
    wanted.size === 0
      ? groups.map((g) => ({ ...g, items: [...g.items] }))
      : groups.map((g) => ({ ...g, items: g.items.filter((i) => wanted.has(i.station)) })).filter((g) => g.items.length > 0);

  // 注文時刻は「残した品目のうち未提供でいちばん古いもの」（KDS と同じ決め方）
  const withTime = kept.map((g) => {
    const active = g.items.filter((i) => i.kitchenStatus !== 'served').map((i) => new Date(i.createdAt).getTime());
    const pool = active.length > 0 ? active : g.items.map((i) => new Date(i.createdAt).getTime());
    return pool.length > 0 ? { ...g, orderTime: new Date(Math.min(...pool)).toISOString() } : g;
  });
  withTime.sort((a, b) => new Date(a.orderTime).getTime() - new Date(b.orderTime).getTime());

  const unservedCount = withTime.reduce((sum, g) => sum + g.items.filter((i) => i.kitchenStatus !== 'served').length, 0);
  const activeGroups = withTime.filter((g) => g.items.some((i) => i.kitchenStatus !== 'served'));
  const avgElapsedMinutes =
    activeGroups.length > 0
      ? Math.round(activeGroups.reduce((sum, g) => sum + (now - new Date(g.orderTime).getTime()) / 60000, 0) / activeGroups.length)
      : 0;

  const stationOptions: StationFilter[] =
    wanted.size === 0 ? [...STATION_FILTER_OPTIONS] : STATION_FILTER_OPTIONS.filter((s) => s === 'all' || wanted.has(s as Station));
  return { groups: withTime, unservedCount, avgElapsedMinutes, stationOptions };
}
