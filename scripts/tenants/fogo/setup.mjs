/**
 * FOGO De BRASIA 新宿 本番テナント セットアップ（冪等）
 *
 *   node --env-file=.env.local scripts/tenants/fogo/setup.mjs
 *
 * - is_demo=false の正式テナントを作成。demoデータとは完全分離。
 * - 何度実行しても二重登録しない（org=名称/store=slug/table=名称/hardware=種別+型番でget-or-create）。
 * - 不明情報（オーナー・営業時間・定休日・キャンセルポリシー等）は設定しない＝オーナーが後から入力。
 * - 破壊的操作なし（DELETE/TRUNCATE/DROP・demo/他テナント変更は一切しない）。
 * - 秘密情報（パスワード等）は扱わない。オーナーアカウントはCYPRESS管理画面から別途発行。
 */
import { createClient } from '@supabase/supabase-js';
import { TABLES } from './data.mjs';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ORG_NAME = 'FOGO De BRASIA 新宿';                    // ブランド名（法人名は不明のため未設定）
const STORE_NAME = 'シュラスコテーブル FOGO De BRASIA 新宿';
const SLUG = 'fogo-de-brasia-shinjuku';
const ENABLED_MODULES = ['reservations', 'pos', 'qr_order', 'kds', 'crm', 'reports'];

async function main() {
  console.log('=== FOGO 本番テナント セットアップ（冪等）===');

  // 1) organization（is_demo=false）get-or-create
  let { data: org } = await admin.from('organizations').select('*').eq('name', ORG_NAME).eq('is_demo', false).maybeSingle();
  if (!org) {
    const { data, error } = await admin.from('organizations')
      .insert({ name: ORG_NAME, plan_code: 'standard', status: 'active', is_demo: false })
      .select('*').single();
    if (error) throw new Error('org作成: ' + error.message);
    org = data;
    console.log('organization 作成:', org.id);
  } else {
    console.log('organization 既存:', org.id);
  }
  if (org.is_demo !== false) throw new Error('安全確認失敗: org.is_demo が false ではありません');

  // 2) store（slug）get-or-create
  let { data: store } = await admin.from('stores').select('*').eq('slug', SLUG).maybeSingle();
  if (store && store.organization_id !== org.id) {
    throw new Error(`slug ${SLUG} は別の組織で使用中です。処理を中止します（上書きしません）。`);
  }
  if (!store) {
    const { data, error } = await admin.from('stores')
      .insert({ organization_id: org.id, slug: SLUG, name: STORE_NAME, booking_enabled: true })
      .select('*').single();
    if (error) throw new Error('store作成: ' + error.message);
    store = data;
    console.log('store 作成:', store.id);
  } else {
    console.log('store 既存:', store.id);
  }

  // 3) store_settings（席のみ/コース 両方可。不明項目は既定/未設定のまま）
  const { data: settings } = await admin.from('store_settings').select('store_id').eq('store_id', store.id).maybeSingle();
  if (!settings) {
    await admin.from('store_settings').insert({ organization_id: org.id, store_id: store.id, seat_only_enabled: true, course_enabled: true });
  } else {
    await admin.from('store_settings').update({ seat_only_enabled: true, course_enabled: true }).eq('store_id', store.id);
  }
  console.log('store_settings: 席のみ/コース 両方有効');

  // 4) store_onboarding（environment=production・モジュール・stage）
  //    トリガーで既に行が生成されている（is_demo=false かつ名称非[PILOT]→ production）
  await admin.from('store_onboarding').update({
    environment: 'production', enabled_modules: ENABLED_MODULES, stage: 'onboarding', updated_at: new Date().toISOString(),
  }).eq('store_id', store.id);
  const { data: ob } = await admin.from('store_onboarding').select('environment, stage').eq('store_id', store.id).single();
  console.log(`store_onboarding: environment=${ob.environment} stage=${ob.stage} modules=${ENABLED_MODULES.join('/')}`);

  // 5) テーブル15卓 get-or-create（名称でユニーク）
  let created = 0;
  // sort_order は TABLES の並び（T1..T15）に一致させる。全テーブル同値だとフロアの表示順が不定になるため必須。
  for (let i = 0; i < TABLES.length; i++) {
    const t = TABLES[i];
    const sortOrder = i + 1;
    const { data: existing } = await admin.from('restaurant_tables').select('id, sort_order').eq('store_id', store.id).eq('name', t.name).maybeSingle();
    if (existing) {
      // 既存店舗の sort_order をベキ等に補正（過去に未設定=0で作られた行の並びを正す）
      if (existing.sort_order !== sortOrder) {
        const { error } = await admin.from('restaurant_tables').update({ sort_order: sortOrder }).eq('id', existing.id);
        if (error) throw new Error(`table ${t.name} sort_order: ${error.message}`);
      }
      continue;
    }
    const { error } = await admin.from('restaurant_tables').insert({
      organization_id: org.id, store_id: store.id, name: t.name,
      capacity_min: 1, capacity_max: t.cap, status: 'active', sort_order: sortOrder,
    });
    if (error) throw new Error(`table ${t.name}: ${error.message}`);
    created++;
  }
  const { data: tableRows, count: tableCount } = await admin.from('restaurant_tables')
    .select('capacity_max', { count: 'exact' }).eq('store_id', store.id).eq('status', 'active');
  const totalSeats = (tableRows ?? []).reduce((a, r) => a + (r.capacity_max ?? 0), 0);
  console.log(`テーブル: ${tableCount}卓（新規${created}）・総席数 ${totalSeats}`);

  // 6) ハードウェア placeholder（詳細不明→status=planned・秘密は保存しない）
  const hardware = [
    { category: 'payment_terminal', provider: 'stera', model: 'JT-C60', note: '外部キャッシュレス端末（手動決済確認方式）' },
    { category: 'printer', provider: 'Star Micronics', model: 'mC-Print3系', note: '型番・IP要確認（Printer setup pending）' },
    { category: 'cash_drawer', provider: null, model: null, note: '既存ドロア流用予定・型番/接続 要確認' },
  ];
  for (const hw of hardware) {
    const q = admin.from('store_hardware').select('id').eq('store_id', store.id).eq('category', hw.category);
    const { data: ex } = hw.model ? await q.eq('model', hw.model).maybeSingle() : await q.is('model', null).maybeSingle();
    if (ex) continue;
    await admin.from('store_hardware').insert({
      organization_id: org.id, store_id: store.id, category: hw.category,
      provider: hw.provider, model: hw.model, status: 'planned', note: hw.note,
    });
  }
  console.log('ハードウェア: stera JT-C60 / Star mC-Print3系 / ドロア を planned 登録');

  console.log('\n--- 完了 ---');
  console.log('organization_id:', org.id);
  console.log('store_id       :', store.id);
  console.log('slug           :', store.slug);
  console.log('公開予約URL     : /book/' + store.slug);
  console.log('※ メニュー投入は import-menu.mjs、検証は verify.mjs を実行してください。');
}

main().catch((e) => { console.error(e); process.exit(1); });
