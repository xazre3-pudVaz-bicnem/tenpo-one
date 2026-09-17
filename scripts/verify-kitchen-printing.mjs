/**
 * キッチン伝票（claim_kitchen_items）の検証。デモ店舗で実施し、最後に全て削除する。
 * 実行: node --env-file=.env.local scripts/verify-kitchen-printing.mjs [--http https://www.tenpo-one.com]
 *   --http を付けると、デプロイ済みの実エンドポイントでキッチン伝票の発行まで確認する。
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
const HTTP_BASE = httpIdx >= 0 ? process.argv[httpIdx + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = { printers: [], orderId: null, items: [], cats: [], menu: [] };
// バッチ待ちを0秒にして即時に確定させる（本番は既定3秒）
const claim = async (printerId) => {
  const { data, error } = await a.rpc('claim_kitchen_items', { p_printer: printerId, p_batch_delay_seconds: 0, p_window_minutes: 30 });
  if (error) throw new Error(error.message);
  return data;
};

try {
  const { data: store } = await a
    .from('stores')
    .select('id, organization_id, organizations!inner(is_demo)')
    .eq('organizations.is_demo', true)
    .limit(1)
    .single();
  const org = store.organization_id;

  // キッチン用とドリンク用のカテゴリ・商品
  const mkCat = async (name, station) => {
    const { data, error } = await a.from('menu_categories').insert({ organization_id: org, store_id: store.id, name, station, sort_order: 0 }).select('id').single();
    if (error) throw new Error(error.message);
    created.cats.push(data.id);
    return data.id;
  };
  const foodCat = await mkCat('【検証】フード', 'kitchen');
  const drinkCat = await mkCat('【検証】ドリンク', 'drink');
  const mkMenu = async (name, cat) => {
    const { data, error } = await a.from('menu_items').insert({ organization_id: org, store_id: store.id, category_id: cat, name, price: 500, item_type: 'food' }).select('id').single();
    if (error) throw new Error(error.message);
    created.menu.push(data.id);
    return data.id;
  };
  const curry = await mkMenu('【検証】カレー', foodCat);
  const beer = await mkMenu('【検証】ビール', drinkCat);

  const mkPrinter = async (name, stations) => {
    const { data, error } = await a.from('printer_configs').insert({
      organization_id: org, store_id: store.id, name, usage: 'kitchen', paper_width_mm: 80,
      cloudprnt_enabled: true, kitchen_stations: stations, status: 'active',
    }).select('id').single();
    if (error) throw new Error(error.message);
    created.printers.push(data.id);
    return data.id;
  };
  const kitchenP = await mkPrinter('【検証】キッチン', ['kitchen']);
  const barP = await mkPrinter('【検証】バー', ['drink']);

  // 不正なステーションはDB制約で拒否
  const { error: badSt } = await a.from('printer_configs').insert({
    organization_id: org, store_id: store.id, name: '【検証】不正', usage: 'kitchen', kitchen_stations: ['sushi'],
  });
  check('存在しないステーションは制約で拒否', !!badSt);

  const { data: order } = await a.from('orders').insert({
    organization_id: org, store_id: store.id, order_type: 'dine_in', guest_count: 2, status: 'open',
    business_date: new Date().toISOString().slice(0, 10), clerk_name: 'Ronnie',
  }).select('id, order_no').single();
  created.orderId = order.id;

  const addItem = async (menuId, name, qty, modifiers = []) => {
    const { data, error } = await a.from('order_items').insert({
      organization_id: org, store_id: store.id, order_id: order.id, menu_item_id: menuId,
      name, unit_price: 500, quantity: qty, line_total: 500 * qty, modifiers, status: 'active',
    }).select('id, kitchen_printed_qty').single();
    if (error) throw new Error(error.message);
    created.items.push(data.id);
    return data;
  };

  console.log('■ 新規注文');
  const c1 = await addItem(curry, '【検証】カレー', 2, [{ name: '大盛り', price: 200 }]);
  const b1 = await addItem(beer, '【検証】ビール', 3);
  check('新規明細は未伝達(0)で作られる', c1.kitchen_printed_qty === 0);
  await sleep(1100);

  const k1 = await claim(kitchenP);
  check('キッチン機はフードだけを受け取る', k1.length === 1 && k1[0].item_name === '【検証】カレー', JSON.stringify(k1.map((r) => `${r.item_name}:${r.delta}`)));
  check('数量2・選択肢・担当・人数が含まれる', k1[0]?.delta === 2 && k1[0]?.modifiers?.[0]?.name === '大盛り' && k1[0]?.clerk_name === 'Ronnie' && k1[0]?.guest_count === 2);
  const d1 = await claim(barP);
  check('バー機はドリンクだけを受け取る', d1.length === 1 && d1[0].item_name === '【検証】ビール' && d1[0].delta === 3);

  const k2 = await claim(kitchenP);
  check('2回目のポーリングでは再印刷しない', k2.length === 0);

  console.log('\n■ 数量変更');
  await a.from('order_items').update({ quantity: 3 }).eq('id', c1.id);
  await sleep(1100);
  const k3 = await claim(kitchenP);
  check('増量は差分(+1)だけ印字', k3.length === 1 && k3[0].delta === 1, JSON.stringify(k3.map((r) => r.delta)));

  console.log('\n■ 取消');
  await a.from('order_items').update({ status: 'cancelled' }).eq('id', b1.id);
  await sleep(1100);
  const d2 = await claim(barP);
  check('取消はマイナス(-3)で印字', d2.length === 1 && d2[0].delta === -3, JSON.stringify(d2.map((r) => r.delta)));

  console.log('\n■ 注文取消（void）');
  await a.from('orders').update({ status: 'void' }).eq('id', order.id);
  await sleep(1100);
  const k4 = await claim(kitchenP);
  check('注文取消で残り数量(-3)が取消になる', k4.length === 1 && k4[0].delta === -3, JSON.stringify(k4.map((r) => r.delta)));

  console.log('\n■ バッチ待ち');
  await a.from('orders').update({ status: 'open' }).eq('id', order.id);
  const { data: fresh } = await a.rpc('claim_kitchen_items', { p_printer: kitchenP, p_batch_delay_seconds: 60, p_window_minutes: 30 });
  check('直近に変わった明細は待機する（連続タップをまとめる）', (fresh ?? []).length === 0);

  console.log('\n■ 無効なプリンタ');
  const { data: none } = await a.rpc('claim_kitchen_items', { p_printer: '00000000-0000-0000-0000-000000000000' });
  check('存在しないプリンタは空を返す', (none ?? []).length === 0);

  console.log('\n■ 権限');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: anonErr } = await anon.rpc('claim_kitchen_items', { p_printer: kitchenP });
  check('匿名からは実行できない', !!anonErr, anonErr?.code ?? '');

  if (HTTP_BASE) {
    console.log(`\n■ 実エンドポイント（${HTTP_BASE}）`);
    const { data: kp } = await a.from('printer_configs').select('cloudprnt_token').eq('id', kitchenP).single();
    const { data: bp } = await a.from('printer_configs').select('cloudprnt_token').eq('id', barP).single();
    const endpoint = (tok) => `${HTTP_BASE.replace(/\/$/, '')}/api/cloudprnt/${tok}`;
    const poll = async (tok) =>
      (await fetch(endpoint(tok), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ printerMAC: '00:11:62:00:00:01' }) })).json();

    await addItem(curry, '【検証】HTTPカレー', 1, [{ name: '辛口', price: 0 }]);
    // バー機のジョブを混ぜ、キッチン機が取らないことも確認する
    await a.from('print_jobs').insert({
      organization_id: org, store_id: store.id, printer_config_id: barP, job_type: 'test', target: 'cloudprnt',
      content_type: 'text/vnd.star.markup', payload: { body: 'BAR ONLY\n' }, status: 'queued',
    });
    await sleep(4000); // エンドポイントのバッチ待ち（3秒）を越える

    const r1 = await poll(kp.cloudprnt_token);
    check('キッチン機のポーリングで伝票ジョブが出る', r1.jobReady === true, JSON.stringify(r1));
    const media = r1.mediaTypes ?? [];
    check('Markup と StarPRNT の両方を提示', media.includes('text/vnd.star.markup') && media.includes('application/vnd.star.starprnt'));

    const g = await fetch(`${endpoint(kp.cloudprnt_token)}?token=${r1.jobToken}&type=${encodeURIComponent('text/vnd.star.markup')}`);
    const body = await g.text();
    check('伝票に商品・選択肢が入っている', body.includes('HTTPカレー') && body.includes('辛口'), body.split('\n').filter((l) => !l.startsWith('[')).slice(0, 4).join(' / '));
    check('バー機のジョブは含まれない', !body.includes('BAR ONLY'));

    const s = await fetch(`${endpoint(kp.cloudprnt_token)}?token=${r1.jobToken}&type=${encodeURIComponent('application/vnd.star.starprnt')}`);
    const bin = Buffer.from(await s.arrayBuffer());
    check('StarPRNT版も取得できる（初期化コマンドで始まる）', bin[0] === 0x1b && bin[1] === 0x40, `${bin.length} bytes`);

    await fetch(`${endpoint(kp.cloudprnt_token)}?token=${r1.jobToken}&code=200`, { method: 'DELETE' });
    const r2 = await poll(kp.cloudprnt_token);
    check('印刷確定後は次のジョブなし', r2.jobReady === false);

    const r3 = await poll(bp.cloudprnt_token);
    check('バー機は自分宛てのジョブを受け取る', r3.jobReady === true);
    await fetch(`${endpoint(bp.cloudprnt_token)}?token=${r3.jobToken}&code=200`, { method: 'DELETE' });

    // 期限切れ: 11分前のテストジョブは破棄される
    await a.from('print_jobs').insert({
      organization_id: org, store_id: store.id, printer_config_id: barP, job_type: 'test', target: 'cloudprnt',
      content_type: 'text/vnd.star.markup', payload: { body: 'OLD\n' }, status: 'queued',
      created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    });
    const r4 = await poll(bp.cloudprnt_token);
    check('期限切れのテストジョブは印刷されない', r4.jobReady === false, JSON.stringify(r4));
    const { data: printed } = await a.from('printer_configs').select('last_polled_at, mac_address').eq('id', kitchenP).single();
    check('ポーリングで最終通信とMACが記録される', !!printed.last_polled_at && printed.mac_address === '00:11:62:00:00:01');
  }
} catch (e) {
  console.log('\n✗ 例外:', e.message);
  fail++;
} finally {
  // 印刷ジョブは注文・プリンタを参照するため先に消す
  if (created.printers.length) await a.from('print_jobs').delete().in('printer_config_id', created.printers);
  if (created.items.length) await a.from('order_items').delete().in('id', created.items);
  if (created.orderId) await a.from('orders').delete().eq('id', created.orderId);
  if (created.printers.length) await a.from('printer_configs').delete().in('id', created.printers);
  await a.from('printer_configs').delete().eq('name', '【検証】不正');
  if (created.menu.length) await a.from('menu_items').delete().in('id', created.menu);
  if (created.cats.length) await a.from('menu_categories').delete().in('id', created.cats);
  console.log('\n  検証データ削除完了');
}
console.log(`\n=== 結果: 成功 ${pass} / 失敗 ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
