/**
 * TENPO ONE v0.4.1 会計・給与バックオフィス 実環境検証スクリプト（VER-E2）
 *
 * 使い方: node --env-file=.env.local scripts/verify-backoffice.mjs
 *
 * verify-flow.mjs と同じ流儀（実ユーザーとして anon キーでログイン=RLS適用、
 * check()/section() での記録、service role は準備・後始末のみに使用）で、
 * ネイティブ会計（複式簿記・月次締め）とネイティブ労務（給与確定ロック）の
 * 整合性を実データで検証する。
 *
 * 冪等性の設計:
 *  - 仕訳の日付は「今日 + ランダムな遠い将来日」を使う（CASE1-5,11）。
 *    実業務データの日付レンジと衝突せず、何度再実行しても新しい source_id で
 *    フルフロー（作成→確定→GL/PL反映）を検証できる。
 *  - 月次締めのテストは固定月 2025-01 を使う。締め状態は毎回リセットする。
 *  - 確定済み（posted）の検証仕訳は void_journal_entry で取り消すのみとし、
 *    物理削除はしない（verify-flow.mjs と同じ方針。会計上の取消は履歴として残す）。
 *  - draft のまま終わった検証仕訳・legal_rule_versions のテスト行・給与runは
 *    物理削除する。
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

async function loginAs(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`ログイン失敗 ${email}: ${error.message}`);
  return c;
}

let pass = 0;
let fail = 0;
const failures = [];
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
function section(title) {
  console.log(`\n■ ${title}`);
}

// 後始末対象の記録
const postedEntryIds = [];      // void_journal_entryで取消のみ（物理削除しない）
const legalRuleIdsToDelete = [];
let payrollRunToCleanup = null;
let bankAccountToCleanup = null;
let org2ToCleanup = null;

async function main() {
  console.log('=== TENPO ONE 会計・給与バックオフィス検証 ===');

  // ---------- 参照データ ----------
  const { data: org } = await admin.from('organizations').select('*').eq('is_demo', true).limit(1).single();
  if (!org) throw new Error('デモ企業がありません。先に seed を実行してください');
  const { data: stores } = await admin.from('stores').select('*').eq('organization_id', org.id).order('slug');
  const shibuya = stores.find((s) => s.slug === 'tenpoone-shibuya');

  const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const uid = (email) => userList.users.find((u) => u.email === email)?.id;
  const staff1Id = uid('staff1@demo.tenpo.one');
  const staff2Id = uid('staff2@demo.tenpo.one');

  const owner = await loginAs('owner@demo.tenpo.one');
  const keiri = await loginAs('keiri@demo.tenpo.one');
  const staff1 = await loginAs('staff1@demo.tenpo.one');

  // 標準勘定科目テンプレートの導入（冪等: on conflict do nothing）
  await keiri.rpc('install_standard_accounts', { p_org: org.id });
  const { data: acctRows } = await admin.from('accounts')
    .select('id, code, name').eq('organization_id', org.id).eq('status', 'active');
  const accounts = { byCode: new Map((acctRows ?? []).map((a) => [a.code, a])) };
  function accId(code) {
    const a = accounts.byCode.get(code);
    if (!a) throw new Error(`勘定科目コード ${code} が未導入です`);
    return a.id;
  }

  // 検証専用の日付生成（今日 + ランダムなオフセット + CASE別ずらし。再実行のたびに新しい日付になる）
  const RUN_OFFSET = 4000 + (Date.now() % 3000); // 約11〜19年先
  function verifyDate(caseOffset) {
    const days = RUN_OFFSET + caseOffset * 41;
    return new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  }

  // 仕訳の作成（下書き）。post_journal_entry は別途RPCで呼ぶ
  async function insertEntry(client, { storeId, entryDate, description, sourceType, sourceId, lines }) {
    const { data: entry, error } = await client.from('journal_entries').insert({
      organization_id: org.id, store_id: storeId, entry_date: entryDate,
      description, source_type: sourceType, source_id: sourceId,
    }).select().single();
    if (error || !entry) throw new Error(`仕訳作成失敗(${description}): ${error?.message}`);
    const { error: lineErr } = await client.from('journal_entry_lines').insert(
      lines.map((l, i) => ({
        organization_id: org.id, entry_id: entry.id, line_no: i + 1,
        account_id: accId(l.accountCode), side: l.side, amount: l.amount,
        tax_treatment: l.taxTreatment, store_id: storeId,
      }))
    );
    if (lineErr) throw new Error(`仕訳明細作成失敗(${description}): ${lineErr.message}`);
    return entry.id;
  }

  // 指定した仕訳群のうち、特定の勘定科目コードの借方/貸方合計を集計（GL/PL相当）
  async function sumAccountLines(entryIds, code) {
    if (entryIds.length === 0) return { debit: 0, credit: 0 };
    const { data } = await admin.from('journal_entry_lines')
      .select('side, amount').in('entry_id', entryIds).eq('account_id', accId(code));
    const debit = (data ?? []).filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0);
    const credit = (data ?? []).filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0);
    return { debit, credit };
  }

  async function findSourceEntries(sourceType, sourceId) {
    const { data } = await admin.from('journal_entries').select('id, status')
      .eq('organization_id', org.id).eq('source_type', sourceType).eq('source_id', sourceId);
    return data ?? [];
  }

  // ============================================================
  section('CASE1: 現金売上の縦フロー');
  // ============================================================
  const d1 = verifyDate(1);
  const sourceId1 = `${shibuya.id}:${d1}`;
  const cashAmounts1 = [3200, 1800];
  for (const amt of cashAmounts1) {
    const { data: o } = await admin.from('orders').insert({
      organization_id: org.id, store_id: shibuya.id, order_type: 'dine_in', status: 'paid',
      business_date: d1, total: amt, subtotal: amt,
    }).select().single();
    await admin.from('payments').insert({
      organization_id: org.id, store_id: shibuya.id, order_id: o.id, method: 'cash',
      amount: amt, status: 'completed', business_date: d1,
    });
  }
  const cashTotal1 = cashAmounts1.reduce((a, b) => a + b, 0);

  const { data: pays1 } = await keiri.from('payments').select('amount')
    .eq('organization_id', org.id).eq('store_id', shibuya.id).eq('business_date', d1)
    .eq('method', 'cash').eq('status', 'completed');
  const aggCash1 = (pays1 ?? []).reduce((a, p) => a + p.amount, 0);
  check('経理ユーザーが当日の現金売上(payments)を集計できる', aggCash1 === cashTotal1, `実際:${aggCash1}`);

  const existingBefore1 = await findSourceEntries('pos_sales', sourceId1);
  check('二重生成防止: 初回は同一source_idの仕訳が存在しない', existingBefore1.length === 0);

  const entry1 = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d1, description: '[検証] 現金売上仕訳',
    sourceType: 'pos_sales', sourceId: sourceId1,
    lines: [
      { accountCode: '100', side: 'debit', amount: aggCash1, taxTreatment: 'out_of_scope' },
      { accountCode: '400', side: 'credit', amount: aggCash1, taxTreatment: 'taxable_standard' },
    ],
  });
  const { data: postRes1, error: postErr1 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry1 });
  check('現金/売上高の仕訳をpost_journal_entryで確定できる', !postErr1 && postRes1?.ok, postErr1?.message);
  postedEntryIds.push(entry1);

  const existingAfter1 = await findSourceEntries('pos_sales', sourceId1);
  check('二重生成防止: source_type+source_idの仕訳は1件のみ存在する',
    existingAfter1.length === 1 && existingAfter1[0].id === entry1);

  const cashLines1 = await sumAccountLines([entry1], '100');
  check('総勘定元帳相当: 現金勘定にこの仕訳の借方が反映される',
    cashLines1.debit === aggCash1 && cashLines1.credit === 0);
  const salesLines1 = await sumAccountLines([entry1], '400');
  check('P/L相当: 売上高（標準税率）にこの仕訳の貸方が反映される',
    salesLines1.credit === aggCash1 && salesLines1.debit === 0);

  // ============================================================
  section('CASE2: カード売上→売掛→入金消込');
  // ============================================================
  const d2 = verifyDate(2);
  const cardAmount2 = 4400;
  {
    const { data: o } = await admin.from('orders').insert({
      organization_id: org.id, store_id: shibuya.id, order_type: 'dine_in', status: 'paid',
      business_date: d2, total: cardAmount2, subtotal: cardAmount2,
    }).select().single();
    await admin.from('payments').insert({
      organization_id: org.id, store_id: shibuya.id, order_id: o.id, method: 'credit',
      amount: cardAmount2, status: 'completed', business_date: d2,
    });
  }

  const entry2a = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d2, description: '[検証] カード売上仕訳（売掛計上）',
    sourceType: 'pos_sales', sourceId: `${shibuya.id}:${d2}`,
    lines: [
      { accountCode: '130', side: 'debit', amount: cardAmount2, taxTreatment: 'out_of_scope' },
      { accountCode: '400', side: 'credit', amount: cardAmount2, taxTreatment: 'taxable_standard' },
    ],
  });
  const { data: pr2a, error: pe2a } = await keiri.rpc('post_journal_entry', { p_entry_id: entry2a });
  check('カード売上（売掛金/売上高）の仕訳を確定できる', !pe2a && pr2a?.ok, pe2a?.message);
  postedEntryIds.push(entry2a);

  const recv2Before = await sumAccountLines([entry2a], '130');
  check('確定直後は売掛金残高がカード売上額と一致する',
    recv2Before.debit - recv2Before.credit === cardAmount2);

  const entry2b = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d2, description: '[検証] カード入金消込仕訳',
    sourceType: 'bank', sourceId: `verify-deposit:${entry2a}`,
    lines: [
      { accountCode: '110', side: 'debit', amount: cardAmount2, taxTreatment: 'out_of_scope' },
      { accountCode: '130', side: 'credit', amount: cardAmount2, taxTreatment: 'out_of_scope' },
    ],
  });
  const { data: pr2b, error: pe2b } = await keiri.rpc('post_journal_entry', { p_entry_id: entry2b });
  check('銀行入金仕訳（普通預金/売掛金）を確定できる', !pe2b && pr2b?.ok, pe2b?.message);
  postedEntryIds.push(entry2b);

  const recv2After = await sumAccountLines([entry2a, entry2b], '130');
  check('入金消込後は売掛金残高がゼロになる',
    recv2After.debit - recv2After.credit === 0,
    `debit=${recv2After.debit} credit=${recv2After.credit}`);

  // ============================================================
  section('CASE3: 仕入→買掛→支払');
  // ============================================================
  const d3 = verifyDate(3);
  const purchaseAmount3 = 8400;
  const { data: inv3 } = await keiri.from('invoices').insert({
    organization_id: org.id, store_id: shibuya.id, vendor_name: '[検証] 仕入先株式会社',
    invoice_no: `VERIFY-ACC-${Date.now()}`, amount: purchaseAmount3, tax_amount: 764,
    issue_date: d3, status: 'approved',
  }).select().single();
  check('検証用の仕入請求書を登録できる', !!inv3);

  const entry3a = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d3, description: '[検証] 仕入計上仕訳',
    sourceType: 'purchase', sourceId: inv3.id,
    lines: [
      { accountCode: '500', side: 'debit', amount: purchaseAmount3, taxTreatment: 'taxable_reduced' },
      { accountCode: '200', side: 'credit', amount: purchaseAmount3, taxTreatment: 'out_of_scope' },
    ],
  });
  const { data: pr3a, error: pe3a } = await keiri.rpc('post_journal_entry', { p_entry_id: entry3a });
  check('仕入高/買掛金の仕訳を確定できる', !pe3a && pr3a?.ok, pe3a?.message);
  postedEntryIds.push(entry3a);

  const payable3Before = await sumAccountLines([entry3a], '200');
  check('確定直後は買掛金残高が仕入額と一致する',
    payable3Before.credit - payable3Before.debit === purchaseAmount3);

  const entry3b = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d3, description: '[検証] 買掛金支払仕訳',
    sourceType: 'bank', sourceId: `verify-payment:${inv3.id}`,
    lines: [
      { accountCode: '200', side: 'debit', amount: purchaseAmount3, taxTreatment: 'out_of_scope' },
      { accountCode: '110', side: 'credit', amount: purchaseAmount3, taxTreatment: 'out_of_scope' },
    ],
  });
  const { data: pr3b, error: pe3b } = await keiri.rpc('post_journal_entry', { p_entry_id: entry3b });
  check('支払仕訳（買掛金/普通預金）を確定できる', !pe3b && pr3b?.ok, pe3b?.message);
  postedEntryIds.push(entry3b);

  const payable3After = await sumAccountLines([entry3a, entry3b], '200');
  check('支払後は買掛金残高がゼロになる',
    payable3After.credit - payable3After.debit === 0,
    `debit=${payable3After.debit} credit=${payable3After.credit}`);

  // ============================================================
  section('CASE4: 経費→P/L');
  // ============================================================
  const d4 = verifyDate(4);
  const expenseAmount4 = 2750;
  const { data: exp4 } = await admin.from('expenses').insert({
    organization_id: org.id, store_id: shibuya.id, amount: expenseAmount4, tax_amount: 250,
    paid_via: 'register', vendor_name: '[検証] 文具店', business_date: d4,
    approval_status: 'approved', status: 'active',
  }).select().single();
  check('検証用の経費を登録できる', !!exp4);

  const entry4 = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d4, description: '[検証] 経費計上仕訳（水道光熱費）',
    sourceType: 'expense', sourceId: exp4.id,
    lines: [
      { accountCode: '521', side: 'debit', amount: expenseAmount4, taxTreatment: 'taxable_standard' },
      { accountCode: '100', side: 'credit', amount: expenseAmount4, taxTreatment: 'out_of_scope' },
    ],
  });
  const { data: pr4, error: pe4 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry4 });
  check('経費仕訳（費目/現金）を確定できる', !pe4 && pr4?.ok, pe4?.message);
  postedEntryIds.push(entry4);

  const expLines4 = await sumAccountLines([entry4], '521');
  check('P/L相当: 費用科目（水道光熱費）に経費額が反映される',
    expLines4.debit === expenseAmount4 && expLines4.credit === 0);

  // ============================================================
  section('CASE5: 給与→P/L（+ CASE8/9で使う検証用給与runを準備）');
  // ============================================================
  const periodStart5 = verifyDate(30);
  const periodEnd5 = verifyDate(59);
  const { data: run5, error: runErr5 } = await keiri.from('payroll_runs').insert({
    organization_id: org.id, store_id: shibuya.id, title: '[検証] 給与run',
    period_start: periodStart5, period_end: periodEnd5, status: 'draft',
    rules_snapshot: { note: 'verify-initial' },
  }).select().single();
  check('検証用の給与run（draft）を作成できる', !runErr5 && !!run5, runErr5?.message);
  payrollRunToCleanup = run5?.id ?? null;

  const { data: items5, error: itemsErr5 } = await keiri.from('payroll_items').insert([
    { organization_id: org.id, payroll_run_id: run5.id, profile_id: staff1Id, store_id: shibuya.id, gross_total: 25000 },
    { organization_id: org.id, payroll_run_id: run5.id, profile_id: staff2Id, store_id: shibuya.id, gross_total: 9000 },
  ]).select();
  check('給与明細を2名分（staff1・staff2）追加できる', !itemsErr5 && items5?.length === 2, itemsErr5?.message);

  const grossTotal5 = 25000 + 9000;
  const d5 = verifyDate(5);
  const entry5 = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: d5, description: '[検証] 給与確定仕訳',
    sourceType: 'payroll', sourceId: run5.id,
    lines: [
      { accountCode: '510', side: 'debit', amount: grossTotal5, taxTreatment: 'out_of_scope' },
      { accountCode: '211', side: 'credit', amount: grossTotal5, taxTreatment: 'out_of_scope' },
    ],
  });
  const { data: pr5, error: pe5 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry5 });
  check('給与仕訳（給与手当/未払費用）を確定できる', !pe5 && pr5?.ok, pe5?.message);
  postedEntryIds.push(entry5);

  const laborLines5 = await sumAccountLines([entry5], '510');
  check('P/L相当: 人件費（給与手当）に給与総額が反映される', laborLines5.debit === grossTotal5);

  // ============================================================
  section('CASE6: 月次締め→修正拒否');
  // ============================================================
  const closeMonth = '2025-01-01';
  await admin.from('accounting_periods').delete().eq('organization_id', org.id).eq('month', closeMonth);

  const { data: closeRes6, error: closeErr6 } = await keiri.rpc('close_accounting_period', {
    p_org: org.id, p_month: closeMonth,
  });
  check('未使用月(2025-01)を月次締めできる', !closeErr6 && closeRes6?.ok, closeErr6?.message);

  const entry6 = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: '2025-01-15', description: '[検証] 締め後の計上試行',
    sourceType: 'manual', sourceId: `verify-case6-${Date.now()}`,
    lines: [
      { accountCode: '599', side: 'debit', amount: 1000, taxTreatment: 'taxable_standard' },
      { accountCode: '100', side: 'credit', amount: 1000, taxTreatment: 'out_of_scope' },
    ],
  });
  const { error: postErr6 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry6 });
  check('締め済み月への計上はPERIOD_CLOSEDで拒否される',
    !!postErr6 && /PERIOD_CLOSED/.test(postErr6.message ?? ''), postErr6?.message);
  await admin.from('journal_entries').delete().eq('id', entry6); // draftのまま。cascadeで明細も削除される

  // ============================================================
  section('CASE7: 締め解除→修正→再締め');
  // ============================================================
  const { error: reopenErrNoReason } = await owner.rpc('reopen_accounting_period', {
    p_org: org.id, p_month: closeMonth, p_reason: '',
  });
  check('理由なしの締め解除はREASON_REQUIREDで拒否される',
    !!reopenErrNoReason && /REASON_REQUIRED/.test(reopenErrNoReason.message ?? ''), reopenErrNoReason?.message);

  const reopenReason7 = '[検証] 誤計上の修正のため';
  const { data: reopenRes7, error: reopenErr7 } = await owner.rpc('reopen_accounting_period', {
    p_org: org.id, p_month: closeMonth, p_reason: reopenReason7,
  });
  check('理由付きなら締め解除できる', !reopenErr7 && reopenRes7?.ok, reopenErr7?.message);

  const entry7 = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: '2025-01-20', description: '[検証] 締め解除後の修正仕訳',
    sourceType: 'manual', sourceId: `verify-case7-${Date.now()}`,
    lines: [
      { accountCode: '599', side: 'debit', amount: 1500, taxTreatment: 'taxable_standard' },
      { accountCode: '100', side: 'credit', amount: 1500, taxTreatment: 'out_of_scope' },
    ],
  });
  const { data: postRes7, error: postErr7 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry7 });
  check('締め解除後は同月への仕訳追加が成功する', !postErr7 && postRes7?.ok, postErr7?.message);
  postedEntryIds.push(entry7);

  const { data: reclose7, error: recloseErr7 } = await keiri.rpc('close_accounting_period', {
    p_org: org.id, p_month: closeMonth,
  });
  check('修正後に再度月次締めできる', !recloseErr7 && reclose7?.ok, recloseErr7?.message);

  const { data: auditClose7 } = await admin.from('audit_logs').select('*')
    .eq('organization_id', org.id).eq('target_table', 'accounting_periods')
    .eq('target_id', closeMonth).eq('action', 'accounting.period_close');
  check('audit_logsにperiod_closeが記録される（初回+再締めで2件以上）', (auditClose7?.length ?? 0) >= 2);

  const { data: auditReopen7 } = await admin.from('audit_logs').select('*')
    .eq('organization_id', org.id).eq('target_table', 'accounting_periods')
    .eq('target_id', closeMonth).eq('action', 'accounting.period_reopen');
  check('audit_logsにperiod_reopenが理由付きで記録される',
    (auditReopen7 ?? []).some((r) => r.note === reopenReason7));

  // 2025-01を締めた状態のままだとentry7(posted)がvoidできなくなるため、
  // 後始末段階の冒頭でこのperiod行自体を削除しopenへ戻す（cleanup()参照）

  // ============================================================
  section('CASE8: 給与確定の不変性');
  // ============================================================
  const { data: approveRun8, error: approveErr8 } = await keiri.from('payroll_runs')
    .update({ status: 'approved' }).eq('id', run5.id).select().single();
  check('給与runをapprovedへ確定できる', !approveErr8 && approveRun8?.status === 'approved', approveErr8?.message);

  const { error: lockItemErr8 } = await keiri.from('payroll_items')
    .update({ gross_total: 99999 }).eq('payroll_run_id', run5.id).eq('profile_id', staff1Id);
  check('確定後のpayroll_items更新はPAYROLL_RUN_LOCKEDで拒否される',
    !!lockItemErr8 && /PAYROLL_RUN_LOCKED/.test(lockItemErr8.message ?? ''), lockItemErr8?.message);

  const { error: lockSnapErr8 } = await keiri.from('payroll_runs')
    .update({ rules_snapshot: { note: 'tampered' } }).eq('id', run5.id);
  check('確定後のrules_snapshot書換もPAYROLL_RUN_LOCKEDで拒否される',
    !!lockSnapErr8 && /PAYROLL_RUN_LOCKED/.test(lockSnapErr8.message ?? ''), lockSnapErr8?.message);

  // ============================================================
  section('CASE9: 本人以外の給与拒否');
  // ============================================================
  const { data: s1Items9 } = await staff1.from('payroll_items').select('*').eq('payroll_run_id', run5.id);
  check('staff1は自分の給与明細のみ取得できる',
    (s1Items9 ?? []).length === 1 && s1Items9[0].profile_id === staff1Id, JSON.stringify(s1Items9));
  const { data: s1Other9 } = await staff1.from('payroll_items').select('*')
    .eq('payroll_run_id', run5.id).eq('profile_id', staff2Id);
  check('staff1は他人(staff2)の給与明細を取得できない', (s1Other9 ?? []).length === 0);

  // ============================================================
  section('CASE10: 企業間分離（会計・銀行口座）');
  // ============================================================
  const { data: bankRow10 } = await admin.from('bank_accounts').insert({
    organization_id: org.id, store_id: shibuya.id, bank_name: '[検証] テスト銀行',
    account_type: 'ordinary', account_id: accId('110'),
  }).select().single();
  bankAccountToCleanup = bankRow10?.id ?? null;

  const { data: org2 } = await admin.from('organizations').insert({
    name: '[検証] 会計RLSテスト用他社（削除予定）', status: 'active', is_demo: false,
  }).select().single();
  org2ToCleanup = org2.id;
  const { data: store2 } = await admin.from('stores').insert({
    organization_id: org2.id, slug: `verify-acct-rls-${Date.now()}`, name: '検証店舗2',
  }).select().single();

  const otherEmail10 = `verify-other-${Date.now()}@example.com`;
  const { data: newUser10, error: newUserErr10 } = await admin.auth.admin.createUser({
    email: otherEmail10, password: PASSWORD, email_confirm: true,
  });
  check('検証用の他社ユーザーを作成できる', !newUserErr10 && !!newUser10?.user, newUserErr10?.message);
  await admin.from('memberships').insert({
    organization_id: org2.id, profile_id: newUser10.user.id, role: 'org_owner', status: 'active',
  });
  const otherClient10 = await loginAs(otherEmail10);

  const { data: xJE10 } = await otherClient10.from('journal_entries').select('id').eq('id', entry1);
  check('他企業ユーザーはdemo企業のjournal_entriesを取得できない', (xJE10 ?? []).length === 0);
  const { data: xAcct10 } = await otherClient10.from('accounts').select('id').eq('id', accId('100'));
  check('他企業ユーザーはdemo企業のaccountsを取得できない', (xAcct10 ?? []).length === 0);
  const { data: xBank10 } = await otherClient10.from('bank_accounts').select('id').eq('id', bankRow10.id);
  check('他企業ユーザーはdemo企業のbank_accountsを取得できない', (xBank10 ?? []).length === 0);

  const { error: xWriteErr10 } = await otherClient10.from('accounts').insert({
    organization_id: org.id, code: '999', name: '不正試行', category: 'asset',
  });
  check('他企業ユーザーはdemo企業のaccountsへ書込できない', !!xWriteErr10);

  // 後始末（このCASE内で完結）
  await admin.from('memberships').delete().eq('organization_id', org2.id).eq('profile_id', newUser10.user.id);
  await admin.auth.admin.deleteUser(newUser10.user.id);
  await admin.from('stores').delete().eq('id', store2.id);
  await admin.from('organizations').delete().eq('id', org2.id);
  org2ToCleanup = null;

  // ============================================================
  section('CASE11: 仕訳の貸借強制');
  // ============================================================
  const entry11a = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: verifyDate(6), description: '[検証] 貸借不一致テスト',
    sourceType: 'manual', sourceId: `verify-case11a-${Date.now()}`,
    lines: [
      { accountCode: '599', side: 'debit', amount: 1000, taxTreatment: 'taxable_standard' },
      { accountCode: '100', side: 'credit', amount: 900, taxTreatment: 'out_of_scope' },
    ],
  });
  const { error: unbalancedErr11 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry11a });
  check('貸借不一致の仕訳はUNBALANCEDで拒否される',
    !!unbalancedErr11 && /UNBALANCED/.test(unbalancedErr11.message ?? ''), unbalancedErr11?.message);
  await admin.from('journal_entries').delete().eq('id', entry11a);

  const entry11b = await insertEntry(keiri, {
    storeId: shibuya.id, entryDate: verifyDate(6), description: '[検証] 明細不足テスト',
    sourceType: 'manual', sourceId: `verify-case11b-${Date.now()}`,
    lines: [{ accountCode: '599', side: 'debit', amount: 1000, taxTreatment: 'taxable_standard' }],
  });
  const { error: insufficientErr11 } = await keiri.rpc('post_journal_entry', { p_entry_id: entry11b });
  check('明細1行のみの仕訳はINSUFFICIENT_LINESで拒否される',
    !!insufficientErr11 && /INSUFFICIENT_LINES/.test(insufficientErr11.message ?? ''), insufficientErr11?.message);
  await admin.from('journal_entries').delete().eq('id', entry11b);

  // ============================================================
  section('CASE12: 法定ルールversionの状態遷移');
  // ============================================================
  const { error: badInsertErr12 } = await admin.from('legal_rule_versions').insert({
    rule_type: 'labor_standard', year: 2099, effective_from: '2099-01-01',
    version: 'verify-1', status: 'reviewed', note: '[検証]',
  });
  check('draft以外での新規insertはINSERT_MUST_BE_DRAFTで拒否される',
    !!badInsertErr12 && /INSERT_MUST_BE_DRAFT/.test(badInsertErr12.message ?? ''), badInsertErr12?.message);

  const { data: rule1_12, error: ruleInsertErr12 } = await admin.from('legal_rule_versions').insert({
    rule_type: 'labor_standard', year: 2099, effective_from: '2099-01-01',
    version: 'verify-1', status: 'draft', note: '[検証]',
  }).select().single();
  check('draftでの新規insertは成功する', !ruleInsertErr12 && !!rule1_12, ruleInsertErr12?.message);
  legalRuleIdsToDelete.push(rule1_12.id);

  const { error: reviewNoInfoErr12 } = await admin.from('legal_rule_versions')
    .update({ status: 'reviewed' }).eq('id', rule1_12.id);
  check('根拠・確認者・確認日なしでreviewed化はREVIEW_INFO_REQUIREDで拒否される',
    !!reviewNoInfoErr12 && /REVIEW_INFO_REQUIRED/.test(reviewNoInfoErr12.message ?? ''), reviewNoInfoErr12?.message);

  await admin.from('legal_rule_versions').update({
    basis: '[検証] 労働基準法第x条', reviewed_by_name: '検証 社労士', reviewed_at: '2099-01-01',
  }).eq('id', rule1_12.id);
  const { data: reviewedOk12, error: reviewOkErr12 } = await admin.from('legal_rule_versions')
    .update({ status: 'reviewed' }).eq('id', rule1_12.id).select().single();
  check('根拠・確認者・確認日を揃えるとreviewed化できる',
    !reviewOkErr12 && reviewedOk12?.status === 'reviewed', reviewOkErr12?.message);

  const { data: rule2_12 } = await admin.from('legal_rule_versions').insert({
    rule_type: 'labor_standard', year: 2099, effective_from: '2099-02-01',
    version: 'verify-2', status: 'draft', note: '[検証]',
  }).select().single();
  legalRuleIdsToDelete.push(rule2_12.id);
  const { error: invalidTransErr12 } = await admin.from('legal_rule_versions')
    .update({ status: 'active' }).eq('id', rule2_12.id);
  check('draftからactiveへの直接遷移はINVALID_STATUS_TRANSITIONで拒否される',
    !!invalidTransErr12 && /INVALID_STATUS_TRANSITION/.test(invalidTransErr12.message ?? ''), invalidTransErr12?.message);

  const { data: activatedOk12, error: activateErr12 } = await admin.from('legal_rule_versions')
    .update({ status: 'active' }).eq('id', rule1_12.id).select().single();
  check('reviewed→activeへの遷移は成功しactivated_by/atが記録される',
    !activateErr12 && activatedOk12?.status === 'active' && !!activatedOk12?.activated_at, activateErr12?.message);

  const { error: immutableErr12 } = await admin.from('legal_rule_versions')
    .update({ parameters: { foo: 1 } }).eq('id', rule1_12.id);
  check('active化後のparameters変更はACTIVE_RULE_IMMUTABLEで拒否される',
    !!immutableErr12 && /ACTIVE_RULE_IMMUTABLE/.test(immutableErr12.message ?? ''), immutableErr12?.message);

  const { data: supersededOk12, error: supersedeErr12 } = await admin.from('legal_rule_versions')
    .update({ status: 'superseded' }).eq('id', rule1_12.id).select().single();
  check('active→supersededへの遷移は成功する',
    !supersedeErr12 && supersededOk12?.status === 'superseded', supersedeErr12?.message);

  const { error: ownerInsertErr12 } = await owner.from('legal_rule_versions').insert({
    rule_type: 'labor_standard', year: 2099, effective_from: '2099-03-01', version: 'verify-owner', status: 'draft',
  });
  check('一般ユーザー(owner)はlegal_rule_versionsへinsertできない（RLS）', !!ownerInsertErr12);

  const { data: ownerUpdRows12 } = await owner.from('legal_rule_versions')
    .update({ note: '改ざん試行' }).eq('id', rule2_12.id).select();
  check('一般ユーザー(owner)はlegal_rule_versionsを更新できない（RLS・0件）', (ownerUpdRows12 ?? []).length === 0);

  // ============================================================
  section('CASE13: 数字の共通性（実売上とPOS仕訳の一致）');
  // ============================================================
  const { data: allPaysD1 } = await admin.from('payments').select('amount')
    .eq('organization_id', org.id).eq('store_id', shibuya.id).eq('business_date', d1)
    .eq('method', 'cash').eq('status', 'completed');
  const totalPaymentsD1 = (allPaysD1 ?? []).reduce((a, p) => a + p.amount, 0);
  const salesLinesD1 = await sumAccountLines([entry1], '400');
  check('当日の実売上合計(payments)とpos_sales仕訳の売上高が一致する',
    totalPaymentsD1 === salesLinesD1.credit, `payments:${totalPaymentsD1} 仕訳:${salesLinesD1.credit}`);
  const revenueNetD1 = salesLinesD1.credit - salesLinesD1.debit;
  check('P/L相当集計のrevenueとも一致する', revenueNetD1 === totalPaymentsD1);

  // ============================================================
  console.log('\n=== 検証結果 ===');
  console.log(`成功: ${pass} / 失敗: ${fail}`);
  if (failures.length) {
    console.log('\n失敗項目:');
    failures.forEach((f) => console.log(' -', f));
  }

  await cleanup(admin, keiri, org);

  if (failures.length) process.exit(1);
}

async function cleanup(admin, keiri, org) {
  console.log('\n■ 後始末');

  // 2025-01を締めたままだとposted仕訳のvoidが拒否されるため、まずperiod行を削除してopenへ戻す
  await safe('accounting_periods(2025-01)の削除', () =>
    admin.from('accounting_periods').delete().eq('organization_id', org.id).eq('month', '2025-01-01'));

  // 確定済み仕訳は取消のみ（物理削除しない）
  for (const id of postedEntryIds) {
    await safe(`journal_entry ${id} のvoid`, async () => {
      const { error } = await keiri.rpc('void_journal_entry', { p_entry_id: id, p_reason: '[検証] 後始末のため取消' });
      if (error && !/ENTRY_NOT_POSTED/.test(error.message ?? '')) throw error;
    });
  }

  // 安全網: draftのまま残った検証仕訳があれば削除
  await safe('残存draft検証仕訳の削除', async () => {
    const { data: leftovers } = await admin.from('journal_entries').select('id')
      .eq('organization_id', org.id).eq('status', 'draft').ilike('description', '[検証]%');
    for (const l of leftovers ?? []) {
      await admin.from('journal_entries').delete().eq('id', l.id);
    }
  });

  // legal_rule_versions テスト行の削除
  for (const id of legalRuleIdsToDelete) {
    await safe(`legal_rule_versions ${id} の削除`, () =>
      admin.from('legal_rule_versions').delete().eq('id', id));
  }

  // 給与run: approved→draftへ戻してから明細・runを削除
  if (payrollRunToCleanup) {
    await safe('payroll_run のdraft復帰・削除', async () => {
      await admin.from('payroll_runs').update({ status: 'draft' }).eq('id', payrollRunToCleanup);
      await admin.from('payroll_items').delete().eq('payroll_run_id', payrollRunToCleanup);
      await admin.from('payroll_runs').delete().eq('id', payrollRunToCleanup);
    });
  }

  // 検証用勘定科目関連の周辺データ
  if (bankAccountToCleanup) {
    await safe('bank_accounts テスト行の削除', () =>
      admin.from('bank_accounts').delete().eq('id', bankAccountToCleanup));
  }

  // CASE3/CASE4で作成した請求書・経費のテスト行（journal_entriesとはsource_idのテキスト参照のみでFK無し）
  await safe('検証用invoices/expensesの削除', async () => {
    await admin.from('invoices').delete().eq('organization_id', org.id).like('vendor_name', '[検証]%');
    await admin.from('expenses').delete().eq('organization_id', org.id).like('vendor_name', '[検証]%');
  });

  // CASE10のorg2が万一残っていた場合の保険（通常はCASE10内で削除済み）
  if (org2ToCleanup) {
    await safe('org2 の削除（保険）', () => admin.from('organizations').delete().eq('id', org2ToCleanup));
  }

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
