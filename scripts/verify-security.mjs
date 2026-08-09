/**
 * TENPO ONE v0.5.0 実環境セキュリティ検証スクリプト（TEST）
 *
 * 使い方: node --env-file=.env.local scripts/verify-security.mjs
 *
 * verify-flow.mjs / verify-backoffice.mjs と同じ流儀（実ユーザーとして anon キーで
 * ログイン=RLS適用、check()/section() での記録、service role は準備・後始末のみ）で、
 * PostgREST直叩き攻撃（anon key + 本人JWT）を再現し、以下の防御を確認する。
 *
 *  - C1: profiles 自己更新での機密列（is_cypress_admin/status/pin_code）書換防止（migration 00031）
 *  - C2: memberships 自己昇格・第三者への org_owner 付与防止（migration 00031）
 *  - 他企業IDOR: 他組織ユーザーがdemo企業のデータへ触れないこと
 *  - 他店舗IDOR: 横浜店長が渋谷店のデータへ触れないこと
 *  - 給与アクセス: 本人以外の給与明細が見えないこと
 *  - suspended状態のメンバーがRLSで遮断されること
 *  - finalize_order/refund_order への直接RPCが店舗/ロールの境界を越えられないこと
 *  - M2: log_audit が所属しないorgへ監査行を書けないこと（migration 00031）
 *  - feature_flags: フラグ書込がcypress管理者限定であること／機能フラグがDB層のアクセス制御では
 *    ないこと（UI層のみの制御である設計を実測で確認・報告用）
 *
 * 検証データには [SEC] の接頭辞を付け、後始末で削除する（会計済みに準ずるものはvoidに留める）。
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.DEMO_PASSWORD || 'TenpoOne-Demo1!';
if (!url || !anonKey || !serviceKey) {
  console.error('環境変数（URL / ANON_KEY / SERVICE_ROLE_KEY）を設定してください');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function loginAs(email, password = PASSWORD) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`ログイン失敗 ${email}: ${error.message}`);
  return c;
}

let pass = 0;
let fail = 0;
const failures = [];
const findings = []; // 「本体バグ」= 修正せず報告する実際の穴（passFail集計には含めるが、区別して最終報告する）
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}
function finding(name, detail = '') {
  findings.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ⚠ [所見] ${name} ${detail}`);
}
function section(title) {
  console.log(`\n■ ${title}`);
}

// 後始末対象
const cleanupUsers = [];       // auth.admin.deleteUser 対象
const cleanupOrgs = [];        // organizations 削除対象（子データも合わせて削除）
const cleanupOrders = [];      // 未会計のまま残った場合の物理削除対象
const cleanupOrdersVoid = [];  // paid状態のためvoidのみ
const cleanupRegisterSessions = [];
const cleanupDailyClosings = [];
const cleanupFeatureFlags = []; // {organization_id, flag_key}

async function main() {
  console.log('=== TENPO ONE 実環境セキュリティ検証 ===');

  // ---------- 参照データ ----------
  const { data: [org] } = await admin.from('organizations').select('*').eq('is_demo', true).limit(1);
  if (!org) throw new Error('デモ企業がありません。先に seed を実行してください');
  const { data: stores } = await admin.from('stores').select('*').eq('organization_id', org.id).order('slug');
  const shibuya = stores.find((s) => s.slug === 'tenpoone-shibuya');
  const yokohama = stores.find((s) => s.slug === 'tenpoone-yokohama');

  const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const uid = (email) => userList.users.find((u) => u.email === email)?.id;
  const staff1Id = uid('staff1@demo.tenpo.one');
  const staff2Id = uid('staff2@demo.tenpo.one');
  const shibuyaManagerId = uid('shibuya@demo.tenpo.one');

  const { data: shibuyaMembership } = await admin.from('memberships')
    .select('*').eq('organization_id', org.id).eq('profile_id', shibuyaManagerId).single();

  const staff1 = await loginAs('staff1@demo.tenpo.one');
  const mgr = await loginAs('shibuya@demo.tenpo.one');
  const mgrYokohama = await loginAs('yokohama@demo.tenpo.one');

  // ============================================================
  section('C1: profiles 自己更新での機密列書換防止（migration 00031）');
  // ============================================================
  {
    const before = await admin.from('profiles').select('*').eq('id', staff1Id).single();

    const { error: eAdmin } = await staff1.from('profiles')
      .update({ is_cypress_admin: true }).eq('id', staff1Id).select().single();
    check('staff1は自分のis_cypress_adminをtrueへ書換できない（拒否される）', !!eAdmin, eAdmin?.message ?? '成功してしまった');
    const afterAdmin = await admin.from('profiles').select('is_cypress_admin').eq('id', staff1Id).single();
    check('is_cypress_adminは実際に変更されていない',
      afterAdmin.data?.is_cypress_admin === before.data?.is_cypress_admin, `実際: ${afterAdmin.data?.is_cypress_admin}`);

    const { error: eStatus } = await staff1.from('profiles')
      .update({ status: 'suspended' }).eq('id', staff1Id).select().single();
    check('staff1は自分のstatusを書換できない（拒否される）', !!eStatus, eStatus?.message ?? '成功してしまった');
    const afterStatus = await admin.from('profiles').select('status').eq('id', staff1Id).single();
    check('statusは実際に変更されていない',
      afterStatus.data?.status === before.data?.status, `実際: ${afterStatus.data?.status}`);

    const { error: ePin } = await staff1.from('profiles')
      .update({ pin_code: '0000' }).eq('id', staff1Id).select().single();
    check('staff1は自分のpin_codeを直接書換できない（拒否される）', !!ePin, ePin?.message ?? '成功してしまった');
    const afterPin = await admin.from('profiles').select('pin_code').eq('id', staff1Id).single();
    check('pin_codeは実際に変更されていない',
      afterPin.data?.pin_code === before.data?.pin_code, `実際: ${afterPin.data?.pin_code}`);

    // 正常系: 機密列以外（display_name）は本人が変更できる（トリガーが過剰拒否していないことの確認）
    const { error: eName } = await staff1.from('profiles')
      .update({ display_name: before.data.display_name }).eq('id', staff1Id).select().single();
    check('機密列以外（display_name）の自己更新は許可される（過剰拒否でない）', !eName, eName?.message);
  }

  // ============================================================
  section('C2: memberships 自己昇格・第三者への org_owner 付与防止（migration 00031）');
  // ============================================================
  {
    const { data: updRows, error: eSelfRole } = await mgr.from('memberships')
      .update({ role: 'org_owner' }).eq('id', shibuyaMembership.id).select();
    check('渋谷店長は自分のmembership.roleをorg_ownerへ書換できない（0件）',
      (!!eSelfRole) || (updRows ?? []).length === 0, eSelfRole?.message);
    const afterRole = await admin.from('memberships').select('role').eq('id', shibuyaMembership.id).single();
    check('roleは実際にstore_managerのまま変更されていない',
      afterRole.data?.role === 'store_manager', `実際: ${afterRole.data?.role}`);

    // 第三者（ダミーユーザー）へのorg_owner付与INSERTも拒否される
    const dummyEmail = `sec-dummy-${Date.now()}@example.com`;
    const { data: dummyUser, error: eDummy } = await admin.auth.admin.createUser({
      email: dummyEmail, password: PASSWORD, email_confirm: true,
    });
    check('[準備] ダミーユーザーを作成できる', !eDummy && !!dummyUser?.user, eDummy?.message);
    if (dummyUser?.user) cleanupUsers.push(dummyUser.user.id);

    const { data: insRows, error: eInsertOwner } = await mgr.from('memberships').insert({
      organization_id: org.id, profile_id: dummyUser.user.id, role: 'org_owner', status: 'active',
    }).select();
    check('渋谷店長は第三者を新規org_ownerとしてINSERTできない（拒否される）',
      (!!eInsertOwner) || (insRows ?? []).length === 0, eInsertOwner?.message);
    const { data: leaked } = await admin.from('memberships')
      .select('id').eq('organization_id', org.id).eq('profile_id', dummyUser.user.id);
    check('DB上にも不正なmembership行が作成されていない', (leaked ?? []).length === 0);
  }

  // ============================================================
  section('他企業IDOR: 他組織ユーザーはdemo企業のデータへ触れない');
  // ============================================================
  let otherClient;
  let org2;
  {
    const { data: org2Row } = await admin.from('organizations').insert({
      name: '[SEC] IDOR検証用他社（削除予定）', status: 'active', is_demo: false,
    }).select().single();
    org2 = org2Row;
    cleanupOrgs.push(org2.id);

    const otherEmail = `sec-outsider-${Date.now()}@example.com`;
    const { data: otherUser, error: eOther } = await admin.auth.admin.createUser({
      email: otherEmail, password: PASSWORD, email_confirm: true,
    });
    check('[準備] 他組織ユーザーを作成できる', !eOther && !!otherUser?.user, eOther?.message);
    if (otherUser?.user) cleanupUsers.push(otherUser.user.id);
    await admin.from('memberships').insert({
      organization_id: org2.id, profile_id: otherUser.user.id, role: 'org_owner', status: 'active',
    });
    otherClient = await loginAs(otherEmail);

    const { data: sampleOrder } = await admin.from('orders')
      .select('id, memo').eq('organization_id', org.id).limit(1).single();
    const { data: sampleCustomer } = await admin.from('customers')
      .select('id, name').eq('organization_id', org.id).limit(1).maybeSingle();
    const { data: sampleJournal } = await admin.from('journal_entries')
      .select('id, description').eq('organization_id', org.id).limit(1).maybeSingle();
    const { data: samplePayment } = await admin.from('payments')
      .select('id, tendered').eq('organization_id', org.id).limit(1).maybeSingle();
    const { data: sampleRefund } = await admin.from('refunds')
      .select('id, reason').eq('organization_id', org.id).limit(1).maybeSingle();
    const { data: sampleMembership } = await admin.from('memberships')
      .select('id').eq('organization_id', org.id).limit(1).maybeSingle();

    const { data: xOrders } = await otherClient.from('orders').select('id').eq('organization_id', org.id).limit(5);
    check('他組織ユーザーはdemo企業のordersをselectできない（0件）', (xOrders ?? []).length === 0);
    const { data: xCustomers } = await otherClient.from('customers').select('id').eq('organization_id', org.id).limit(5);
    check('他組織ユーザーはdemo企業のcustomersをselectできない（0件）', (xCustomers ?? []).length === 0);
    const { data: xJournal } = await otherClient.from('journal_entries').select('id').eq('organization_id', org.id).limit(5);
    check('他組織ユーザーはdemo企業のjournal_entriesをselectできない（0件）', (xJournal ?? []).length === 0);
    const { data: xPayments } = await otherClient.from('payments').select('id').eq('organization_id', org.id).limit(5);
    check('他組織ユーザーはdemo企業のpaymentsをselectできない（0件）', (xPayments ?? []).length === 0);
    const { data: xRefunds } = await otherClient.from('refunds').select('id').eq('organization_id', org.id).limit(5);
    check('他組織ユーザーはdemo企業のrefundsをselectできない（0件）', (xRefunds ?? []).length === 0);
    const { data: xMemberships } = await otherClient.from('memberships').select('id').eq('organization_id', org.id).limit(5);
    check('他組織ユーザーはdemo企業のmembershipsをselectできない（0件）', (xMemberships ?? []).length === 0);

    if (sampleOrder) {
      const { data: uOrder } = await otherClient.from('orders')
        .update({ memo: '[SEC] 不正改ざん試行' }).eq('id', sampleOrder.id).select();
      check('他組織ユーザーはdemo企業のordersを更新できない（0件）', (uOrder ?? []).length === 0);
    }
    if (sampleCustomer) {
      const { data: uCustomer } = await otherClient.from('customers')
        .update({ name: '[SEC] 改ざん試行' }).eq('id', sampleCustomer.id).select();
      check('他組織ユーザーはdemo企業のcustomersを更新できない（0件）', (uCustomer ?? []).length === 0);
    }
    if (sampleJournal) {
      const { data: uJournal } = await otherClient.from('journal_entries')
        .update({ description: '[SEC] 改ざん試行' }).eq('id', sampleJournal.id).select();
      check('他組織ユーザーはdemo企業のjournal_entriesを更新できない（0件）', (uJournal ?? []).length === 0);
    }
    if (samplePayment) {
      const { data: uPayment } = await otherClient.from('payments')
        .update({ tendered: 999999 }).eq('id', samplePayment.id).select();
      check('他組織ユーザーはdemo企業のpaymentsを更新できない（0件）', (uPayment ?? []).length === 0);
    }
    if (sampleRefund) {
      const { data: uRefund } = await otherClient.from('refunds')
        .update({ reason: '[SEC] 改ざん試行' }).eq('id', sampleRefund.id).select();
      check('他組織ユーザーはdemo企業のrefundsを更新できない（0件）', (uRefund ?? []).length === 0);
    }
    if (sampleMembership) {
      const { data: uMembership } = await otherClient.from('memberships')
        .update({ role: 'org_owner' }).eq('id', sampleMembership.id).select();
      check('他組織ユーザーはdemo企業のmembershipsを更新できない（0件）', (uMembership ?? []).length === 0);
    }
  }

  // ============================================================
  section('他店舗IDOR: 横浜店長は渋谷店のデータへ触れない');
  // ============================================================
  {
    // 実データが無い場合に備え、テスト用の最小データを用意する（無ければ用意・あれば既存を使う）
    let { data: shibuyaOrder } = await admin.from('orders')
      .select('id').eq('store_id', shibuya.id).limit(1).maybeSingle();
    if (!shibuyaOrder) {
      const { data: created } = await admin.from('orders').insert({
        organization_id: org.id, store_id: shibuya.id, order_type: 'takeout', guest_count: 1,
        memo: '[SEC] 店舗間IDOR検証用',
      }).select().single();
      shibuyaOrder = created;
      cleanupOrders.push(created.id);
    }

    let { data: shibuyaSession } = await admin.from('register_sessions')
      .select('id').eq('store_id', shibuya.id).limit(1).maybeSingle();
    if (!shibuyaSession) {
      const { data: reg } = await admin.from('registers').select('id').eq('store_id', shibuya.id).limit(1).single();
      const { data: created } = await admin.from('register_sessions').insert({
        organization_id: org.id, store_id: shibuya.id, register_id: reg.id,
        status: 'closed', opening_float: 0, opened_by: shibuyaManagerId,
        opened_at: new Date().toISOString(), closed_at: new Date().toISOString(),
      }).select().single();
      shibuyaSession = created;
      cleanupRegisterSessions.push(created.id);
    }

    let { data: shibuyaClosing } = await admin.from('daily_closings')
      .select('id').eq('store_id', shibuya.id).limit(1).maybeSingle();
    if (!shibuyaClosing) {
      const { data: created } = await admin.from('daily_closings').insert({
        organization_id: org.id, store_id: shibuya.id,
        business_date: '2099-01-01', sales_total: 0, net_sales: 0, refund_total: 0,
      }).select().single();
      shibuyaClosing = created;
      cleanupDailyClosings.push(created.id);
    }

    const { data: xOrder } = await mgrYokohama.from('orders').select('id').eq('id', shibuyaOrder.id);
    check('横浜店長は渋谷店のordersをIDで直接selectできない（0件）', (xOrder ?? []).length === 0);
    const { data: xSession } = await mgrYokohama.from('register_sessions').select('id').eq('id', shibuyaSession.id);
    check('横浜店長は渋谷店のregister_sessionsをIDで直接selectできない（0件）', (xSession ?? []).length === 0);
    const { data: xClosing } = await mgrYokohama.from('daily_closings').select('id').eq('id', shibuyaClosing.id);
    check('横浜店長は渋谷店のdaily_closingsをIDで直接selectできない（0件）', (xClosing ?? []).length === 0);

    const { data: uOrder } = await mgrYokohama.from('orders')
      .update({ memo: '[SEC] 店舗間改ざん試行' }).eq('id', shibuyaOrder.id).select();
    check('横浜店長は渋谷店のordersを更新できない（0件）', (uOrder ?? []).length === 0);
  }

  // ============================================================
  section('給与アクセス: 一般スタッフは本人以外の給与明細を見られない');
  // ============================================================
  {
    const { data: s1Other } = await staff1.from('payroll_items').select('id, profile_id')
      .eq('profile_id', staff2Id).limit(5);
    check('staff1は他人(staff2)の給与明細をIDフィルタでも取得できない（0件）', (s1Other ?? []).length === 0);

    const { data: s1All } = await staff1.from('payroll_items').select('id, profile_id').limit(20);
    const onlySelf = (s1All ?? []).every((r) => r.profile_id === staff1Id);
    check('staff1のpayroll_items無条件select結果はすべて本人分のみ', onlySelf,
      `他人分が${(s1All ?? []).filter((r) => r.profile_id !== staff1Id).length}件見えている`);
  }

  // ============================================================
  section('disabledユーザー: membership status=suspended はRLSで遮断される');
  // ============================================================
  {
    const suspendedEmail = `sec-suspended-${Date.now()}@example.com`;
    const { data: suspUser, error: eSusp } = await admin.auth.admin.createUser({
      email: suspendedEmail, password: PASSWORD, email_confirm: true,
    });
    check('[準備] 検証用ユーザーを作成できる', !eSusp && !!suspUser?.user, eSusp?.message);
    if (suspUser?.user) cleanupUsers.push(suspUser.user.id);
    await admin.from('memberships').insert({
      organization_id: org.id, profile_id: suspUser.user.id, role: 'staff', status: 'suspended',
    });
    const suspClient = await loginAs(suspendedEmail);

    const { data: suspOrders } = await suspClient.from('orders').select('id').eq('organization_id', org.id).limit(5);
    check('status=suspendedのメンバーはordersをselectできない（0件）', (suspOrders ?? []).length === 0);
    const { data: suspCustomers } = await suspClient.from('customers').select('id').eq('organization_id', org.id).limit(5);
    check('status=suspendedのメンバーはcustomersをselectできない（0件）', (suspCustomers ?? []).length === 0);
    const { data: suspOrg } = await suspClient.from('organizations').select('id').eq('id', org.id);
    check('status=suspendedのメンバーは自組織のorganizationsすら見えない（0件）', (suspOrg ?? []).length === 0);
  }

  // ============================================================
  section('direct RPC: finalize_order / refund_order の店舗・ロール境界');
  // ============================================================
  {
    const { data: openOrder } = await admin.from('orders').insert({
      organization_id: org.id, store_id: yokohama.id, order_type: 'takeout', guest_count: 1,
      memo: '[SEC] 直接RPC検証用（open）',
    }).select().single();
    cleanupOrders.push(openOrder.id);

    const { error: eFinalize } = await staff1.rpc('finalize_order', {
      p_order_id: openOrder.id,
      p_payments: [{ method: 'cash', amount: 1000, tendered: 1000 }],
      p_register_session_id: null,
    });
    check('staff1(渋谷所属)は横浜店の注文をfinalize_orderで直接会計できない（FORBIDDEN）',
      !!eFinalize && /FORBIDDEN/.test(eFinalize.message ?? ''), eFinalize?.message ?? '成功してしまった');
    const { data: stillOpen } = await admin.from('orders').select('status').eq('id', openOrder.id).single();
    check('会計は実際には成立していない（status=open のまま）', stillOpen?.status === 'open');

    const { data: paidOrder } = await admin.from('orders').insert({
      organization_id: org.id, store_id: yokohama.id, order_type: 'takeout', guest_count: 1,
      status: 'paid', total: 1000, subtotal: 1000, closed_at: new Date().toISOString(),
      memo: '[SEC] 直接RPC検証用（paid）',
    }).select().single();
    cleanupOrdersVoid.push(paidOrder.id);

    const { error: eRefund } = await staff1.rpc('refund_order', {
      p_order_id: paidOrder.id, p_amount: 100, p_method: 'cash', p_reason: '[SEC] 不正試行',
    });
    check('staff1は横浜店の注文をrefund_orderで直接返金できない（FORBIDDEN）',
      !!eRefund && /FORBIDDEN/.test(eRefund.message ?? ''), eRefund?.message ?? '成功してしまった');
    const { data: noRefund } = await admin.from('refunds').select('id').eq('order_id', paidOrder.id);
    check('返金は実際には作成されていない', (noRefund ?? []).length === 0);
  }

  // ============================================================
  section('M2: log_audit が所属しないorgへ監査行を書けない（migration 00031）');
  // ============================================================
  {
    const fakeOrgId = randomUUID(); // 実在しない/所属しないorg
    const { data: fakeAuditId } = await staff1.rpc('log_audit', {
      p_org: fakeOrgId, p_store: null, p_action: '[SEC] escalation_attempt',
      p_target_table: 'x', p_target_id: 'y', p_before: null, p_after: null, p_note: '不正試行',
    });
    check('staff1が所属しないorg宛のlog_auditはnullを返す（記録されない）', fakeAuditId == null,
      `返り値: ${fakeAuditId}`);
    const { data: fakeAuditRows } = await admin.from('audit_logs')
      .select('id').eq('organization_id', fakeOrgId);
    check('所属しないorg向けaudit_logsは実際に作成されない（0件）', (fakeAuditRows ?? []).length === 0);

    // 正常系: 自分の所属org宛は記録される（over-blockingでないことの確認）
    const { data: legitAuditId } = await staff1.rpc('log_audit', {
      p_org: org.id, p_store: shibuya.id, p_action: '[SEC] legit_check',
      p_target_table: 'x', p_target_id: 'y', p_before: null, p_after: null, p_note: '検証: 正常系',
    });
    check('staff1が自分の所属org宛に呼んだlog_auditはidを返す', !!legitAuditId);
    const { data: legitRow } = await admin.from('audit_logs').select('actor_id').eq('id', legitAuditId).maybeSingle();
    check('自分の所属org向けaudit_logsは実際に作成され、actor_idが本人になる',
      legitRow?.actor_id === staff1Id);
  }

  // ============================================================
  section('feature_flags: 書込制限の確認と、機能OFFがDB層のアクセス制御ではないことの実測');
  // ============================================================
  {
    const { data: ffInsert } = await staff1.from('feature_flags')
      .insert({ organization_id: org.id, flag_key: 'qr_order', enabled: false }).select();
    check('非cypress管理者(staff1)はfeature_flagsへ書込できない（0件）', (ffInsert ?? []).length === 0);
    const { data: ffInsertMgr } = await mgr.from('feature_flags')
      .insert({ organization_id: org.id, flag_key: 'qr_order', enabled: false }).select();
    check('非cypress管理者(店長)もfeature_flagsへ書込できない（0件）', (ffInsertMgr ?? []).length === 0);

    // qr_order機能をservice role（cypress運営相当）でOFFにし、公開QR注文RPCが実際に塞がれるかを実測する。
    // 結論: create_qr_order（migration 00012/00013）は feature_flags を一切参照していない。
    // 機能ON/OFFは lib/nav.ts のナビ非表示 + lib/auth.ts の requireFeature()（ページ入口のみ）で
    // 実装されており、SECURITY DEFINER RPC・テーブルRLSのどちらにもDB層の制御が無い。
    // → 機能OFFはUI/ページ入口の抑止であり、セキュリティ境界（認可）としては機能していない。
    // これは「本体バグ」として修正はせず、所見として報告する（migration禁止のため対応不可）。
    await admin.from('feature_flags').upsert(
      { organization_id: org.id, flag_key: 'qr_order', enabled: false },
      { onConflict: 'organization_id,flag_key' }
    ).select();
    cleanupFeatureFlags.push({ organization_id: org.id, flag_key: 'qr_order' });

    const { data: qrTable } = await admin.from('restaurant_tables')
      .select('id, qr_token').eq('store_id', shibuya.id).eq('status', 'active')
      .not('qr_token', 'is', null).limit(1).single();
    const { data: menuItem } = await admin.from('menu_items')
      .select('id').eq('organization_id', org.id).eq('status', 'active').limit(1).single();
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: qrRes, error: eQr } = await anon.rpc('create_qr_order', {
      p_slug: 'tenpoone-shibuya', p_token: qrTable.qr_token,
      p_items: [{ menu_item_id: menuItem.id, quantity: 1, memo: '[SEC] feature flag bypass検証' }],
    });
    if (!eQr && qrRes?.ok) {
      finding('feature_flags でqr_orderをOFFにしても create_qr_order RPCは成功する',
        'DB層（RLS/SECURITY DEFINER関数）は feature_flags を参照していない。機能OFFはページ入口のUI制御のみで、' +
        'PostgREST直叩き・RPC直叩きに対する認可境界にはなっていない（設計上の既知ギャップ。修正はmigration禁止のため対象外）');
      await admin.from('orders').update({ status: 'void', void_reason: '[SEC] 検証取消' }).eq('id', qrRes.order_id);
      const { data: t } = await admin.from('restaurant_tables').select('id').eq('id', qrTable.id).single();
      if (t) await admin.from('restaurant_tables').update({ current_status: 'available' }).eq('id', t.id);
    } else {
      check('qr_order機能OFF時はcreate_qr_order RPCが拒否される', false, eQr?.message ?? '想定外の応答');
    }
  }

  // ============================================================
  console.log('\n=== 検証結果 ===');
  console.log(`成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    failures.forEach((f) => console.log(' -', f));
  }
  if (findings.length) {
    console.log('\n所見（DB層では防げていない・修正はmigration禁止のため対象外）:');
    findings.forEach((f) => console.log(' -', f));
  }

  await cleanup();

  if (failures.length) process.exit(1);
}

async function cleanup() {
  console.log('\n■ 後始末');
  await safe('feature_flags テスト行の削除', async () => {
    for (const f of cleanupFeatureFlags) {
      await admin.from('feature_flags').delete()
        .eq('organization_id', f.organization_id).eq('flag_key', f.flag_key);
    }
  });
  await safe('未会計の検証用注文の削除', async () => {
    for (const id of cleanupOrders) await admin.from('orders').delete().eq('id', id);
  });
  await safe('会計済み検証用注文のvoid化', async () => {
    for (const id of cleanupOrdersVoid) {
      await admin.from('orders').update({ status: 'void', void_reason: '[SEC] 検証後始末' }).eq('id', id);
    }
  });
  await safe('検証用register_sessionsの削除', async () => {
    for (const id of cleanupRegisterSessions) await admin.from('register_sessions').delete().eq('id', id);
  });
  await safe('検証用daily_closingsの削除', async () => {
    for (const id of cleanupDailyClosings) await admin.from('daily_closings').delete().eq('id', id);
  });
  await safe('検証用組織（org2）の削除', async () => {
    for (const id of cleanupOrgs) {
      await admin.from('memberships').delete().eq('organization_id', id);
      await admin.from('stores').delete().eq('organization_id', id);
      await admin.from('organizations').delete().eq('id', id);
    }
  });
  await safe('検証用ユーザーのmembership行の削除（FK制約のため先に削除）', async () => {
    if (cleanupUsers.length) await admin.from('memberships').delete().in('profile_id', cleanupUsers);
  });
  await safe('検証用ユーザーの削除', async () => {
    for (const id of cleanupUsers) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log(`  ! ユーザー削除失敗 ${id}: ${error.message}`);
    }
  });
  console.log('  後始末完了');
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`  ! 後始末で警告: ${label}: ${e.message ?? e}`);
  }
}

main().catch((e) => { console.error('\n検証中断:', e.message); process.exit(1); });
