/**
 * EPSON Server Direct Print エンドポイント（/api/epson/[token]）の検証。
 * デモ店舗に一時プリンタとジョブを作り、プリンタの動きを真似てHTTPで叩き、最後に全て削除する。
 * 実行: node --env-file=.env.local scripts/verify-epson-print.mjs [--http http://localhost:3100]
 */
import { createClient } from '@supabase/supabase-js';

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (ok) pass++;
  else fail++;
};
const httpIdx = process.argv.indexOf('--http');
const BASE = httpIdx >= 0 ? process.argv[httpIdx + 1] : 'http://localhost:3100';
const created = { printers: [], jobs: [] };

const EPOS = (text) =>
  `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><text lang="ja"/><text>${text}&#10;</text><cut type="feed"/></epos-print>`;

/** プリンタからの印刷要求（Server Direct Print の GetRequest）を真似る */
const getRequest = (token) =>
  fetch(`${BASE}/api/epson/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'ConnectionType=GetRequest&ID=',
  });

/** 印字結果の通知（SetResponse）を真似る */
const setResponse = (token, jobId, success, code = '') =>
  fetch(`${BASE}/api/epson/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ConnectionType: 'SetResponse',
      ID: '',
      ResponseFile:
        `<PrintResponseInfo><ePOSPrint><Parameter><printjobid>${jobId}</printjobid></Parameter>` +
        `<PrintResponse><response success="${success}" code="${code}" status="251658262"/></PrintResponse></ePOSPrint></PrintResponseInfo>`,
    }).toString(),
  });

const addJob = async (org, storeId, printerId, payload) => {
  const { data, error } = await a
    .from('print_jobs')
    .insert({
      organization_id: org,
      store_id: storeId,
      printer_config_id: printerId,
      job_type: 'test',
      target: 'cloudprnt',
      content_type: 'text/vnd.star.markup',
      payload,
      status: 'queued',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  created.jobs.push(data.id);
  return data.id;
};

const jobStatus = async (id) => (await a.from('print_jobs').select('status, error').eq('id', id).single()).data;

try {
  const { data: store } = await a
    .from('stores')
    .select('id, organization_id, organizations!inner(is_demo)')
    .eq('organizations.is_demo', true)
    .limit(1)
    .single();
  const org = store.organization_id;

  const { data: printer, error: pErr } = await a
    .from('printer_configs')
    .insert({
      organization_id: org,
      store_id: store.id,
      name: '【検証】EPSON TM-m30III-H',
      maker: 'EPSON',
      model: 'TM-m30III-H',
      usage: 'receipt',
      paper_width_mm: 80,
      cloudprnt_enabled: true,
      status: 'active',
    })
    .select('id, cloudprnt_token')
    .single();
  if (pErr) throw new Error(pErr.message);
  created.printers.push(printer.id);
  const token = printer.cloudprnt_token;
  check('プリンタ登録でトークンが自動発行される', /^[0-9a-f]{48}$/.test(token ?? ''), token?.slice(0, 8) + '…');

  console.log('\n■ ジョブが無いとき');
  {
    const res = await getRequest(token);
    const xml = await res.text();
    check('200 が返る', res.status === 200, `status ${res.status}`);
    check('XMLで返す', (res.headers.get('content-type') ?? '').includes('text/xml'));
    check('空の応答（印刷データなし）', xml.includes('<PrintRequestInfo Version="2.00"></PrintRequestInfo>'));
    const { data } = await a.from('printer_configs').select('last_polled_at').eq('id', printer.id).single();
    check('最終通信時刻が記録される', !!data.last_polled_at, data.last_polled_at);
  }

  console.log('\n■ レシートのジョブがあるとき');
  const jobId = await addJob(org, store.id, printer.id, { body: '[align: left]', epos: EPOS('テスト印字') });
  {
    const xml = await (await getRequest(token)).text();
    check('ジョブIDを printjobid で渡す', xml.includes(`<printjobid>${jobId}</printjobid>`));
    check('ePOS-Print XML を本文に含む', xml.includes('<epos-print xmlns=') && xml.includes('テスト印字'));
    check('印刷先は local_printer', xml.includes('<devid>local_printer</devid>'));
    check('ジョブは claimed になる', (await jobStatus(jobId)).status === 'claimed');
  }

  console.log('\n■ 印字結果の通知');
  {
    await setResponse(token, jobId, 'true');
    check('成功なら printed', (await jobStatus(jobId)).status === 'printed');

    const failJob = await addJob(org, store.id, printer.id, { epos: EPOS('失敗テスト') });
    await getRequest(token);
    await setResponse(token, failJob, 'false', 'EPTR_COVER_OPEN');
    const st = await jobStatus(failJob);
    check('失敗なら failed とエラー内容', st.status === 'failed', st.error ?? '');
  }

  console.log('\n■ EPSON用データを持たない古いジョブ');
  {
    const starOnly = await addJob(org, store.id, printer.id, { body: '[align: left]', starprnt: 'AAAA' });
    const xml = await (await getRequest(token)).text();
    const st = await jobStatus(starOnly);
    check('印字せず failed にする', st.status === 'failed', st.error ?? '');
    check('空の応答を返す（プリンタは次の間隔まで待つ）', xml.includes('</PrintRequestInfo>') && !xml.includes('epos-print'));
  }

  console.log('\n■ 不正なトークン');
  {
    const res = await getRequest('0'.repeat(48));
    check('404 を返す', res.status === 404, `status ${res.status}`);
  }

  console.log('\n■ Star機のエンドポイントは従来どおり動く');
  {
    const starJob = await addJob(org, store.id, printer.id, { body: '[align: left]\nStar', starprnt: 'AAAA' });
    const res = await fetch(`${BASE}/api/cloudprnt/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerMAC: '00:11:22:33:44:55' }),
    });
    const json = await res.json();
    check('jobReady と mediaTypes を返す', json.jobReady === true && Array.isArray(json.mediaTypes), JSON.stringify(json.mediaTypes));
    const body = await (await fetch(`${BASE}/api/cloudprnt/${token}?token=${starJob}&type=text/vnd.star.markup`)).text();
    check('Markup本文を取得できる', body.includes('Star'));
    await fetch(`${BASE}/api/cloudprnt/${token}?token=${starJob}&code=200`, { method: 'DELETE' });
    check('DELETEで printed になる', (await jobStatus(starJob)).status === 'printed');
  }
} catch (e) {
  console.error('ERROR', e.message);
  fail++;
} finally {
  // 後片付け（ジョブ → プリンタの順）
  if (created.jobs.length) await a.from('print_jobs').delete().in('id', created.jobs);
  if (created.printers.length) await a.from('printer_configs').delete().in('id', created.printers);
  console.log(`\n結果: ${pass} 成功 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}
