/**
 * テーブルグループ（2026-09-25 店舗要望「空席の卓に テーブルグループ設定 を出す」）。
 *
 * 大人数のお客様を2卓・3卓に分けて通すとき、その卓を1組としてまとめる。
 * まとめた卓のどれかに伝票が立つと、同じグループの卓はすべて同じ伝票として扱う
 * （卓をタップすればその伝票が開く＝1組1伝票のまま）。
 *
 * データベースの列は増やさず、店舗設定に持つ:
 *   store_settings.settings.tableGroups = [{ id, tableIds: [...] }]
 */

export interface TableGroup {
  id: string;
  tableIds: string[];
}

/** 店舗設定から読む（壊れた値は捨てる） */
export function tableGroupsFrom(settings: unknown): TableGroup[] {
  const raw = (settings as { tableGroups?: unknown } | null)?.tableGroups;
  if (!Array.isArray(raw)) return [];
  const out: TableGroup[] = [];
  for (const g of raw) {
    const id = (g as { id?: unknown } | null)?.id;
    const ids = (g as { tableIds?: unknown } | null)?.tableIds;
    if (typeof id !== 'string' || !Array.isArray(ids)) continue;
    const tableIds = [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
    if (tableIds.length >= 2) out.push({ id, tableIds });
  }
  return out;
}

/** その卓が入っているグループ（無ければ null） */
export function groupOfTable(groups: TableGroup[], tableId: string): TableGroup | null {
  return groups.find((g) => g.tableIds.includes(tableId)) ?? null;
}

/**
 * 卓のまとまりを作り直す。
 * 選んだ卓は他のグループから外し、2卓以上なら新しいグループにする（1卓以下ならグループ無し）。
 * 卓が1つだけ残ったグループは意味がないので消す。
 */
export function setTableGroup(groups: TableGroup[], tableIds: string[], newId: string): TableGroup[] {
  const picked = new Set(tableIds);
  const rest = groups
    .map((g) => ({ ...g, tableIds: g.tableIds.filter((id) => !picked.has(id)) }))
    .filter((g) => g.tableIds.length >= 2);
  if (picked.size >= 2) rest.push({ id: newId, tableIds: [...picked] });
  return rest;
}

/**
 * グループの中で「伝票を持っている卓」を選ぶ（QR の振り向け先）。
 *
 * 2026-09-25 店舗報告（FULL MOoN 御茶ノ水）「グループにされた側に飲み放題などの設定が反映されない」:
 * QR は卓のトークンで動くため、伝票の立っていない側の卓からは飲み放題（プラン）が見えず、
 * 注文も別伝票になってしまっていた。グループの卓はどれも同じ伝票なので、
 * 伝票を持つ卓の QR として動かす（メニュー・プラン・注文・履歴がすべて同じ伝票になる）。
 *
 * @param group      その卓のグループ（無ければ null）
 * @param tableId    QR を開いた卓
 * @param openOrders 店の open 伝票の (table_id, opened_at ms)。新しい順でなくてよい
 * @returns 振り向け先の卓ID。振り向け不要（グループ無し・自分が伝票持ち・誰も伝票無し）なら null
 */
export function groupOrderTable(
  group: TableGroup | null,
  tableId: string,
  openOrders: { tableId: string; openedAtMs: number }[]
): string | null {
  if (!group || !group.tableIds.includes(tableId)) return null;
  const inGroup = openOrders
    .filter((o) => group.tableIds.includes(o.tableId))
    .sort((a, b) => b.openedAtMs - a.openedAtMs);
  if (inGroup.length === 0) return null;
  // 自分の卓に伝票があればそのまま（振り向け不要）
  if (inGroup.some((o) => o.tableId === tableId)) return null;
  return inGroup[0].tableId;
}
