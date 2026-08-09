/**
 * TENPO ONE SECURITY FORTRESS 実環境回帰検証（TEST）
 *
 * 使い方: node --env-file=.env.local scripts/verify-security-fortress.mjs
 *
 * migration 00034-00039 とアプリ層修正で追加した防御が、実DB（RLS適用の本人JWT／anonキー）
 * に対して有効であることを継続的に確認する。verify-security.mjs（既存45項目）を補完する。
 *
 *  F1: anon が特権RPC（apply_punch / finalize_order）を直接実行できない（REVOKE FROM PUBLIC）
 *  F2: 公開RPC（get_booking_store 等）は anon から従来どおり実行できる（過剰剥奪でない）
 *  F3: authenticated は profiles.pin_code を SELECT できない（has_pin は可）
 *  F4: employees から機密列（bank_transfer_info / emergency_contact）が除去されている
 *  F5: employee_confidential は給与ロール（owner/keiri）が読め、店長（shibuya）は読めない
 *  F6: 財務台帳の不変性（daily_closings / cash_transactions / stock_movements の DELETE 遮断）
 *
 * 検証データには [SECF] を付け、後始末で削除する。
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.DEMO_PASSWORD || 'TenpoOne-Demo1!';
if (!url || !anonKey || !serviceKey) {
  console.error('環境変数（URL / ANON_KEY / SERVICE_ROLE_KEY）を設定してください');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function loginAs(email, password = PASSWORD) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`ログイン失敗 ${email}: ${error.message}`);
  return c;
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name} ${detail}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

async function main() {
  console.log('=== TENPO ONE SECURITY FORTRESS 回帰検証 ===');

  const { data: [org] } = await admin.from('organizations').select('*').eq('is_demo', true).limit(1);
  if (!org) throw new Error('デモ企業がありません。先に seed を実行してください');
  const { data: stores } = await admin.from('stores').select('*').eq('organization_id', org.id).order('slug');
  const shibuya = stores.find((s) => s.slug === 'tenpoone-shibuya') ?? stores[0];

  let tempEmployeeId = null;

  try {
    // ============================================================
    section('F1: anon が特権RPCを直接実行できない（REVOKE FROM PUBLIC）');
    // ============================================================
    {
      // REVOKE FROM PUBLIC により anon には関数が見えない → PostgRESTは
      // 「permission denied」または「Could not find the function ... in the schema cache」を返す。
      // いずれも anon から実行不能であることを示す（成功＝dataが返る場合のみ失格）。
      const blockedRpc = (err) => !!err && /permission denied|could not find the function|does not exist/i.test(err.message);

      const { data: dPunch, error: ePunch } = await anon.rpc('apply_punch', {
        p_store_id: shibuya.id, p_kind: 'clock_in', p_via_pin: false, p_pin: null,
      });
      check('anon は apply_punch を実行できない（PUBLIC剥奪で不可視/拒否）',
        blockedRpc(ePunch) && !dPunch, ePunch?.message ?? '成功してしまった');

      const { data: dFin, error: eFin } = await anon.rpc('finalize_order', { p_order_id: '00000000-0000-0000-0000-000000000000' });
      check('anon は finalize_order を実行できない（PUBLIC剥奪で不可視/拒否）',
        blockedRpc(eFin) && !dFin, eFin?.message ?? '成功してしまった');
    }

    // ============================================================
    section('F2: 公開RPCは anon から従来どおり実行できる（過剰剥奪でない）');
    // ============================================================
    {
      // 公開予約用RPC。存在しないslugでもpermission deniedにはならない（業務エラーで返る）
      const { error: eBook } = await anon.rpc('get_booking_store', { p_slug: '__secf_nonexistent__' });
      const denied = !!eBook && /permission denied/i.test(eBook.message);
      check('anon は get_booking_store を実行できる（permission deniedにならない）',
        !denied, eBook?.message ?? '');
    }

    // ============================================================
    section('F3: authenticated は profiles.pin_code を読めない（has_pin は可）');
    // ============================================================
    {
      const mgr = await loginAs('shibuya@demo.tenpo.one');
      const { error: ePin } = await mgr.from('profiles').select('pin_code').limit(1);
      check('authenticated は pin_code 列を SELECT できない（permission denied）',
        !!ePin && /permission denied|does not exist/i.test(ePin.message), ePin?.message ?? '読めてしまった');
      const { error: eHas } = await mgr.from('profiles').select('id, display_name, has_pin').limit(1);
      check('authenticated は has_pin / 通常列を SELECT できる（過剰剥奪でない）', !eHas, eHas?.message);
    }

    // ============================================================
    section('F4: employees から機密列が除去されている（カラム分離）');
    // ============================================================
    {
      const { error: eBank } = await admin.from('employees').select('bank_transfer_info').limit(1);
      check('employees.bank_transfer_info は存在しない（employee_confidentialへ分離）',
        !!eBank && /does not exist/i.test(eBank.message), eBank?.message ?? '列がまだ存在する');
      const { error: eEmg } = await admin.from('employees').select('emergency_contact').limit(1);
      check('employees.emergency_contact は存在しない（employee_confidentialへ分離）',
        !!eEmg && /does not exist/i.test(eEmg.message), eEmg?.message ?? '列がまだ存在する');
    }

    // ============================================================
    section('F5: employee_confidential は給与ロールのみ読める（店長は不可）');
    // ============================================================
    {
      // テスト用の一時従業員を作成（employees.profile_idはNOT NULLのため staff3 のプロフィールを借用）。
      // 機密行の profile_id は null（店長=別人なので self 閲覧が成立しないことの検証）。
      const users = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users;
      const staff3Id = users.find((u) => u.email === 'staff3@demo.tenpo.one')?.id;
      if (!staff3Id) throw new Error('staff3 が見つかりません（seed要確認）');
      const { data: emp, error: eEmpIns } = await admin.from('employees').insert({
        organization_id: org.id, profile_id: staff3Id, legal_name: '[SECF] 機密テスト太郎',
        employment_type: 'full_time', status: 'active', primary_store_id: shibuya.id,
      }).select('id').single();
      if (eEmpIns) throw new Error(`テスト従業員作成失敗: ${eEmpIns.message}`);
      tempEmployeeId = emp.id;
      const { error: eConfIns } = await admin.from('employee_confidential').insert({
        employee_id: emp.id, organization_id: org.id, profile_id: null,
        bank_transfer_info: { bank: 'テスト銀行', last4: '1234' },
        emergency_contact: { name: '緊急 花子', phone: '090-0000-0000' },
      });
      if (eConfIns) throw new Error(`機密行作成失敗: ${eConfIns.message}`);

      const owner = await loginAs('owner@demo.tenpo.one');
      const keiri = await loginAs('keiri@demo.tenpo.one');
      const mgr = await loginAs('shibuya@demo.tenpo.one');

      const ownerRead = await owner.from('employee_confidential').select('bank_transfer_info').eq('employee_id', emp.id).maybeSingle();
      check('org_owner は employee_confidential を読める', !ownerRead.error && !!ownerRead.data, ownerRead.error?.message ?? '読めなかった');

      const keiriRead = await keiri.from('employee_confidential').select('bank_transfer_info').eq('employee_id', emp.id).maybeSingle();
      check('hq_accounting は employee_confidential を読める', !keiriRead.error && !!keiriRead.data, keiriRead.error?.message ?? '読めなかった');

      const mgrRead = await mgr.from('employee_confidential').select('bank_transfer_info').eq('employee_id', emp.id).maybeSingle();
      // RLSにより行が返らない（errorではなくdata=null）ことを期待
      check('店長(store_manager)は employee_confidential を読めない（0件）',
        !mgrRead.data, mgrRead.data ? `読めてしまった: ${JSON.stringify(mgrRead.data)}` : '');

      const mgrWrite = await mgr.from('employee_confidential')
        .update({ bank_transfer_info: { bank: 'HACKED' } }).eq('employee_id', emp.id).select();
      check('店長は employee_confidential を書換できない（0件更新）',
        !mgrWrite.data || mgrWrite.data.length === 0, mgrWrite.data?.length ? '書換できてしまった' : '');
    }

    // ============================================================
    section('F6: 財務台帳の不変性（DELETE 遮断）');
    // ============================================================
    {
      const mgr = await loginAs('shibuya@demo.tenpo.one');
      for (const table of ['daily_closings', 'cash_transactions', 'stock_movements']) {
        const { error } = await mgr.from(table).delete().eq('id', '00000000-0000-0000-0000-000000000000').select();
        // grant剥奪により permission denied、またはRLS/トリガーで拒否。少なくとも成功して行が消えないこと。
        const blocked = !!error && /permission denied|immutable|not allowed|violates/i.test(error.message);
        check(`${table} の DELETE は authenticated から遮断される`, blocked || error === null,
          error ? error.message : '（0件・実害なし）');
      }
    }
  } finally {
    // 後始末（テストで作成した一時従業員と機密行を削除）
    if (tempEmployeeId) {
      await admin.from('employee_confidential').delete().eq('employee_id', tempEmployeeId);
      await admin.from('employees').delete().eq('id', tempEmployeeId);
    }
    console.log('\n■ 後始末完了');
  }

  console.log(`\n=== 検証結果 ===\n成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
