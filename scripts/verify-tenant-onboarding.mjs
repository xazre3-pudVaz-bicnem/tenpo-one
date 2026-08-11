/**
 * 店舗導入管理基盤の実DB検証（RLS・トリガー・isolation・自動判定シグナル）。
 *
 * 使い方: node --env-file=.env.local scripts/verify-tenant-onboarding.mjs
 *
 * 専用テスト企業[PILOT]で動作。実顧客・デモ企業データは変更しない。
 *   T1 store作成トリガーが store_onboarding を自動生成（環境はorg由来）
 *   T2 非cypressの認証ユーザーは onboarding/hardware/support_notes を読めない（RLS）
 *   T3 他テナントの導入情報も取得できない（isolation）
 *   T4 cypress管理者は読める（app_is_cypress_admin() 肯定側。検証後に必ず復元）
 *   T5 ハードウェア登録が自動判定シグナル(hw_payment_terminal)へ反映
 *   T6 環境更新が反映
 *   T7 pagination（count + range）が機能
 */
import { createClient } from '@supabase/supabase-js';
import { ensurePilotOrg, loginPilotUser } from './pilot-org.mjs';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name} ${detail}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

async function main() {
  console.log('=== 店舗導入管理基盤 実DB検証 ===');
  const p = await ensurePilotOrg();
  const { org, store } = p;
  const owner = await loginPilotUser('pilot-owner@test.tenpo.one'); // 非cypress
  const { data: ownerProfile } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const ownerId = ownerProfile.users.find((u) => u.email === 'pilot-owner@test.tenpo.one')?.id;

  let tempStoreId = null;
  let noteId = null;

  try {
    // ============================================================
    section('T1: store作成トリガーで store_onboarding 自動生成');
    // ============================================================
    const { data: tempStore, error: eStore } = await admin.from('stores').insert({
      organization_id: org.id, slug: `pilot-onboarding-test-${Date.now()}`, name: '[PILOT] 導入テスト店',
    }).select('id').single();
    check('テスト店舗を作成できる', !eStore && !!tempStore, eStore?.message);
    tempStoreId = tempStore?.id;
    const { data: ob } = await admin.from('store_onboarding').select('*').eq('store_id', tempStoreId).maybeSingle();
    check('store_onboarding 行が自動生成される', !!ob, '未生成');
    check('環境が [PILOT] 由来で test になる', ob?.environment === 'test', ob?.environment);
    check('初期ステージは draft', ob?.stage === 'draft', ob?.stage);

    // ============================================================
    section('T2: 非cypressの認証ユーザーは導入情報を読めない（RLS）');
    // ============================================================
    const r1 = await owner.from('store_onboarding').select('store_id').limit(5);
    check('非cypressは store_onboarding を読めない（0件）', (r1.data?.length ?? 0) === 0, `件数:${r1.data?.length}`);
    const r2 = await owner.from('store_hardware').select('id').limit(5);
    check('非cypressは store_hardware を読めない（0件）', (r2.data?.length ?? 0) === 0, `件数:${r2.data?.length}`);
    const r3 = await owner.from('tenant_support_notes').select('id').limit(5);
    check('非cypressは tenant_support_notes を読めない（0件）', (r3.data?.length ?? 0) === 0, `件数:${r3.data?.length}`);
    // 書込も不可
    const w1 = await owner.from('store_onboarding').update({ stage: 'live' }).eq('store_id', store.id).select();
    check('非cypressは store_onboarding を書換できない（0件更新）', (w1.data?.length ?? 0) === 0, w1.error?.message);

    // ============================================================
    section('T3: 他テナントの導入情報も取得不可（isolation）');
    // ============================================================
    const { data: [demoOrg] } = await admin.from('organizations').select('id').eq('is_demo', true).limit(1);
    const { data: demoStores } = await admin.from('stores').select('id').eq('organization_id', demoOrg.id).limit(1);
    const otherStoreId = demoStores?.[0]?.id;
    const cross = await owner.from('store_onboarding').select('store_id').eq('store_id', otherStoreId);
    check('非cypressは他テナントの store_onboarding を取得できない', (cross.data?.length ?? 0) === 0, `件数:${cross.data?.length}`);

    // ============================================================
    section('T4: cypress管理者は読める（肯定側・検証後に復元）');
    // ============================================================
    await admin.from('profiles').update({ is_cypress_admin: true }).eq('id', ownerId);
    // app_is_cypress_admin() はクエリ時に profiles を読むため再ログイン不要
    const asCypress = await owner.from('store_onboarding').select('store_id').limit(10);
    check('cypress管理者は store_onboarding を読める', (asCypress.data?.length ?? 0) > 0, `件数:${asCypress.data?.length}`);
    // 復元（最優先で戻す）
    await admin.from('profiles').update({ is_cypress_admin: false }).eq('id', ownerId);
    const restored = await admin.from('profiles').select('is_cypress_admin').eq('id', ownerId).single();
    check('is_cypress_admin を false へ復元した', restored.data?.is_cypress_admin === false, `実際:${restored.data?.is_cypress_admin}`);

    // ============================================================
    section('T5: ハードウェア登録が自動判定シグナルへ反映');
    // ============================================================
    await admin.from('store_hardware').insert({
      organization_id: org.id, store_id: tempStoreId, category: 'payment_terminal', provider: 'stera', status: 'active',
    });
    const hw = await admin.from('store_hardware').select('id', { count: 'exact', head: true })
      .eq('store_id', tempStoreId).eq('category', 'payment_terminal').neq('status', 'removed');
    check('決済端末を登録すると hw_payment_terminal シグナルが立つ', (hw.count ?? 0) > 0, `件数:${hw.count}`);

    // ============================================================
    section('T6: 環境更新が反映');
    // ============================================================
    await admin.from('store_onboarding').update({ environment: 'pilot' }).eq('store_id', tempStoreId);
    const { data: ob2 } = await admin.from('store_onboarding').select('environment').eq('store_id', tempStoreId).single();
    check('環境を pilot へ更新できる', ob2?.environment === 'pilot', ob2?.environment);

    // ============================================================
    section('T7: サポートメモの isolation と pagination');
    // ============================================================
    const { data: note } = await admin.from('tenant_support_notes').insert({
      organization_id: org.id, store_id: tempStoreId, body: '[PILOT] プリンター型番確認待ち', author_id: ownerId,
    }).select('id').single();
    noteId = note?.id;
    const noteAsOwner = await owner.from('tenant_support_notes').select('id').eq('id', noteId);
    check('非cypressはサポートメモを読めない', (noteAsOwner.data?.length ?? 0) === 0, `件数:${noteAsOwner.data?.length}`);
    // pagination: count + range
    const paged = await admin.from('store_onboarding').select('store_id', { count: 'exact' }).order('updated_at', { ascending: false }).range(0, 1);
    check('pagination（count + range）が機能する', (paged.count ?? 0) >= 1 && (paged.data?.length ?? 0) <= 2, `count:${paged.count} rows:${paged.data?.length}`);

  } finally {
    section('後片付け');
    if (noteId) await admin.from('tenant_support_notes').delete().eq('id', noteId);
    if (tempStoreId) {
      await admin.from('store_hardware').delete().eq('store_id', tempStoreId);
      await admin.from('store_onboarding').delete().eq('store_id', tempStoreId);
      await admin.from('store_settings').delete().eq('store_id', tempStoreId);
      await admin.from('stores').delete().eq('id', tempStoreId);
    }
    // 念のため cypress_admin を必ず false へ
    if (ownerId) await admin.from('profiles').update({ is_cypress_admin: false }).eq('id', ownerId);
    console.log('  後片付け完了');
  }

  console.log(`\n=== 検証結果 ===\n成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
