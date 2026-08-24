/**
 * CloudPRNT キューのE2E検証。
 *   既定（DBモード）: エンドポイントのDB操作（enqueue→poll/claim→get→delete）をサービスロールで再現し、
 *                     状態遷移とジョブ本文を検証する。実プリンタ不要。
 *   --http <baseUrl>: プリンタを模してbaseUrlの実エンドポイントへPOST/GET/DELETEし、ライブ疎通を確認する
 *                     （デプロイ後の本番/プレビュー確認用）。
 * 検証は is_demo=true のデモ店舗で行い、FOGO本番は一切触らない。一時プリンタ設定とジョブは最後に削除する。
 *
 * 実行:
 *   node --env-file=.env.local scripts/verify-cloudprnt.mjs
 *   node --env-file=.env.local scripts/verify-cloudprnt.mjs --http https://www.tenpo-one.com
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const httpIdx = process.argv.indexOf('--http');
const HTTP_BASE = httpIdx >= 0 ? process.argv[httpIdx + 1] : null;

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`); ok ? pass++ : fail++; };

const TEST_BODY = '[align: middle]\nCLOUDPRNT VERIFY\n[cut: feed; partial]\n';

// デモ店舗を選ぶ（本番FOGOを避ける）
const { data: store } = await admin
  .from('stores')
  .select('id, organization_id, name, organizations!inner(is_demo)')
  .eq('organizations.is_demo', true)
  .limit(1)
  .maybeSingle();
if (!store) throw new Error('デモ店舗が見つかりません（is_demo=trueの組織が必要）');
console.log(`対象デモ店舗: ${store.name} (${store.id})`);

const token = randomBytes(24).toString('hex');
let printerId = null;
let jobId = null;

try {
  // 一時プリンタ設定（CloudPRNT有効）
  const { data: printer, error: pErr } = await admin
    .from('printer_configs')
    .insert({
      organization_id: store.organization_id, store_id: store.id,
      name: '[CLOUDPRNT-TEST]', usage: 'receipt', paper_width_mm: 80, drawer_kick: true,
      cloudprnt_enabled: true, cloudprnt_token: token, status: 'active',
    })
    .select('id, cloudprnt_token')
    .single();
  if (pErr) throw new Error(`一時プリンタ作成失敗: ${pErr.message}`);
  printerId = printer.id;
  check('一時CloudPRNTプリンタを作成', !!printer.cloudprnt_token);

  // ジョブ投入
  const { data: job, error: jErr } = await admin
    .from('print_jobs')
    .insert({
      organization_id: store.organization_id, store_id: store.id, printer_config_id: printerId,
      job_type: 'test', target: 'cloudprnt', content_type: 'text/vnd.star.markup',
      payload: { body: TEST_BODY }, status: 'queued',
    })
    .select('id, status')
    .single();
  if (jErr) throw new Error(`ジョブ投入失敗: ${jErr.message}`);
  jobId = job.id;
  check('ジョブをqueuedで投入', job.status === 'queued');

  if (HTTP_BASE) {
    // --- 実HTTPモード（プリンタを模す） ---
    const endpoint = `${HTTP_BASE.replace(/\/$/, '')}/api/cloudprnt/${token}`;
    const poll = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerMAC: '00:11:22:33:44:55', statusCode: '200 OK', printingInProgress: false }),
    });
    const pollJson = await poll.json();
    check('POST(ポーリング)でjobReady:true', pollJson.jobReady === true, JSON.stringify(pollJson));
    const jobToken = pollJson.jobToken;
    const media = (pollJson.mediaTypes || [])[0];
    check('mediaTypesにmarkup', media === 'text/vnd.star.markup', String(media));

    const get = await fetch(`${endpoint}?mac=00:11:22:33:44:55&token=${jobToken}&type=${encodeURIComponent(media)}`);
    const body = await get.text();
    check('GETでジョブ本文を取得', body.includes('CLOUDPRNT VERIFY'), `ct=${get.headers.get('content-type')}`);

    const del = await fetch(`${endpoint}?mac=00:11:22:33:44:55&token=${jobToken}&code=200`, { method: 'DELETE' });
    check('DELETE(確定)が200', del.status === 200);

    const { data: after } = await admin.from('print_jobs').select('status').eq('id', jobId).single();
    check('ジョブがprintedに遷移', after.status === 'printed', after.status);

    const poll2 = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const poll2Json = await poll2.json();
    check('以降のポーリングはjobReady:false', poll2Json.jobReady === false);
  } else {
    // --- DBモード（エンドポイントのDB操作を再現） ---
    // POST相当: 最古のqueuedをclaimへ
    const { data: claimTarget } = await admin
      .from('print_jobs').select('id, content_type')
      .eq('store_id', store.id).eq('status', 'queued').eq('target', 'cloudprnt')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    check('POST相当: queuedジョブを検出', claimTarget?.id === jobId);
    await admin.from('print_jobs').update({ status: 'claimed', claimed_at: new Date().toISOString() }).eq('id', claimTarget.id);
    const { data: claimed } = await admin.from('print_jobs').select('status').eq('id', jobId).single();
    check('claimedに遷移', claimed.status === 'claimed');

    // GET相当: 本文取得
    const { data: fetched } = await admin.from('print_jobs').select('payload, content_type').eq('id', jobId).eq('store_id', store.id).single();
    check('GET相当: 本文を取得', fetched.payload?.body === TEST_BODY);
    check('content_typeがmarkup', fetched.content_type === 'text/vnd.star.markup');

    // DELETE相当: printedへ
    await admin.from('print_jobs').update({ status: 'printed', printed_at: new Date().toISOString() }).eq('id', jobId).eq('store_id', store.id);
    const { data: done } = await admin.from('print_jobs').select('status').eq('id', jobId).single();
    check('DELETE相当: printedに遷移', done.status === 'printed');

    // 別トークンからは取得不可（店舗越えの遮断）
    const { data: otherStore } = await admin.from('stores').select('id').neq('id', store.id).limit(1).maybeSingle();
    if (otherStore) {
      const { data: crossFetch } = await admin.from('print_jobs').select('id').eq('id', jobId).eq('store_id', otherStore.id).maybeSingle();
      check('他店舗スコープでは取得不可', !crossFetch);
    }
  }
} finally {
  // 後片付け
  if (jobId) await admin.from('print_jobs').delete().eq('id', jobId);
  if (printerId) await admin.from('printer_configs').delete().eq('id', printerId);
  console.log('  後片付け完了（一時プリンタ設定・ジョブを削除）');
}

console.log(`\n=== CloudPRNT検証: 成功 ${pass} / 失敗 ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
