/**
 * PostgREST（Supabase）は 1 回の読み取りを 1,000 行で切る。期間の集計（月・年）はそれを超えるので、
 * .range() で 1,000 行ずつ最後まで読む。page には from〜to の範囲を付けたクエリを返す関数を渡す
 * （順番がぶれないように .order('id') などを付けること）。
 */
export async function fetchAll<T = unknown>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<{ rows: T[]; truncated: boolean }> {
  const size = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? 100;
  const rows: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * size;
    const { data } = await page(from, from + size - 1);
    const list = (data ?? []) as T[];
    rows.push(...list);
    if (list.length < size) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
