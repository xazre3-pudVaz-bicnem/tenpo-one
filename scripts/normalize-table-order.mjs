/**
 * 全店舗の restaurant_tables.sort_order を 1..N に正規化する（プラットフォーム全体・ベキ等）。
 * 現在の表示順（sort_order 昇順→name 昇順）を保ったまま連番を振り直すため、
 * 既に整っている店舗は見た目が変わらず、sort_order が全0・重複している店舗だけ並びが確定する。
 * 実行: node --env-file=.env.local scripts/normalize-table-order.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// name を自然順（T2 < T10）で比較する。数字を含む名前の並びを直感通りにする。
function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
}

const { data: stores } = await admin.from('stores').select('id, name').eq('status', 'active');
let touchedStores = 0;
let touchedRows = 0;

for (const s of stores ?? []) {
  const { data: tables } = await admin
    .from('restaurant_tables')
    .select('id, name, sort_order')
    .eq('store_id', s.id)
    .eq('status', 'active');
  if (!tables || tables.length === 0) continue;

  // 現状の表示順（sort_order 昇順→ name 自然順）で安定ソートし、1..N を割り当てる
  const ordered = [...tables].sort((a, b) => {
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return naturalCompare(a.name, b.name);
  });

  let changed = 0;
  for (let i = 0; i < ordered.length; i++) {
    const want = i + 1;
    if (ordered[i].sort_order !== want) {
      await admin.from('restaurant_tables').update({ sort_order: want }).eq('id', ordered[i].id);
      changed++;
    }
  }
  if (changed > 0) {
    touchedStores++;
    touchedRows += changed;
    console.log(`${s.name.padEnd(36)} 更新 ${changed}/${ordered.length} → ${ordered.map((t) => t.name).join(', ')}`);
  } else {
    console.log(`${s.name.padEnd(36)} 変更なし (${ordered.length}件)`);
  }
}

console.log(`\n完了: ${touchedStores}店舗 / ${touchedRows}行を更新`);
