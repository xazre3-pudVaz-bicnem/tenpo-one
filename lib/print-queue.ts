import { kitchenDesign } from '@/lib/ticket-design';
import { renderTicketImage, ticketImagePayload } from '@/lib/ticket-design-server';
/**
 * プリンタ側からのポーリングで動く印刷キューの共通処理。
 * Star CloudPRNT（app/api/cloudprnt/[token]）と EPSON Server Direct Print（app/api/epson/[token]）が共有する。
 *
 * どちらの方式も「プリンタが定期的にサーバへ問い合わせ、ジョブがあれば受け取って印字し、結果を返す」ため、
 * ジョブの期限切れ・取りこぼし回収・厨房伝票の生成は同じロジックでよい。表現（Markup / StarPRNT / ePOS-Print XML）
 * だけが方式ごとに異なり、payload に3種とも載せてプリンタ側に選ばせる。
 */
import { createAdminClient } from '@/lib/supabase/admin';
import {
  groupKitchenTickets,
  isDrinkOptionGroupName,
  kitchenTicketSettingsFrom,
  splitSetDrinkRows,
  rotateLines180,
  layoutKitchenTicket,
  STATION_LABELS,
  STATION_LABELS_EN,
  ticketSlips,
  type ClaimedKitchenItem,
  type KitchenStation,
  type KitchenTicketSettings,
} from '@/lib/kitchen-ticket';
import { courseStepsFrom, expandCourseRows, type CourseDish, type CourseSteps } from '@/lib/course-steps';
import { kitchenTicketsMarkup } from '@/lib/receipt-markup';
import { colsFor, STAR_WIDTH_OPTIONS } from '@/lib/receipt-layout';
import { kitchenTicketsStarPrnt } from '@/lib/starprnt';
import { kitchenTicketsEpos, eposCols } from '@/lib/epos-print';

export const MARKUP = 'text/vnd.star.markup';
export const STARPRNT = 'application/vnd.star.starprnt';

export const RECLAIM_STALE_MS = 60_000; // claimed のまま確定されないジョブを再キュー化する猶予

/**
 * 未処理のまま古くなったジョブの有効期限。プリンタがオフラインの間に溜まったジョブが、
 * 復帰した瞬間に一斉に実行されるのを防ぐ（例: ドロアが何度も開く、昔のテスト印刷が大量に出る）。
 */
export const TTL_DRAWER_MS = 2 * 60_000; // 会計時のドロア開放は数分遅れたら意味がない
export const TTL_TEST_MS = 10 * 60_000;
export const TTL_PRINT_MS = 30 * 60_000; // レシート・厨房伝票（必要ならレシート画面から再印刷できる）

/** キッチン伝票の生成パラメータ（claim_kitchen_items） */
const KITCHEN_BATCH_DELAY_SECONDS = 3; // 連続タップを1枚にまとめる待ち
const KITCHEN_WINDOW_MINUTES = 30; // これより古い変更は伝票にしない（TTL_PRINT_MS と揃える）


/** ジョブのpayloadに入っている表現。body=Markup文字列 / starprnt=StarPRNTバイト列のbase64 / epos=ePOS-Print XML。 */
export interface JobPayload {
  body?: string;
  starprnt?: string;
  epos?: string;
  drawer?: boolean;
}

export interface PrinterRow {
  id: string;
  organization_id: string;
  store_id: string;
  name: string;
  usage: string;
  paper_width_mm: number;
  kitchen_stations: string[] | null;
  /** レジ機: 会計のあとレシートを自動で印字する（設定 > プリンター「自動印刷」）。お会計伝票の自動印字は無い（2026-09-28 Ronnie「自動はオフ」） */
  auto_print?: boolean;
  /** 担当フロア（floors.id）。空＝既定プリンター（lib/printer-floors.ts） */
  floor_ids?: string[] | null;
  /** 厨房（ドリンク）機から会計伝票も出す */
  bill_slips?: boolean;
  /** プリンターを上下さかさまに付けているとき true（印字を180度回して出す） */
  upside_down?: boolean;
  /** メーカー（'EPSON' / 'Star' 等）。接続方式の判定に使う */
  maker?: string | null;
  /** お店の中のアドレス（Wi-Fi で直接印刷するときの送り先。loadPrinterRow だけが読む） */
  ip_address?: string | null;
  /** つなぎ方（'lan' / 'wifi' / 'bluetooth' …。loadPrinterRow だけが読む） */
  connection_type?: string | null;
  /** 最後に印刷を取りに来た時刻（loadPrinterRow だけが読む。iPad から LAN で送るときの「接続中」の表示に使う） */
  last_polled_at?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** URLのトークンから、有効なプリンタ設定を引く。 */
export async function resolvePrinter(token: string): Promise<{ admin: Admin; printer: PrinterRow | null }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, name, usage, paper_width_mm, kitchen_stations, auto_print, floor_ids, bill_slips, upside_down, maker')
    .eq('cloudprnt_token', token)
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active')
    .maybeSingle();
  return { admin, printer: (data as PrinterRow | null) ?? null };
}

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

/** 死活情報の更新（ポーリングのたびに呼ぶ）。 */
export async function touchPrinter(admin: Admin, printerId: string, mac?: string | null) {
  const now = new Date().toISOString();
  await admin
    .from('printer_configs')
    .update({ last_polled_at: now, last_connected_at: now, ...(mac ? { mac_address: mac } : {}) })
    .eq('id', printerId);
}

/** このプリンタ宛ての期限切れジョブを破棄する（削除せず failed として履歴に残す）。 */
export async function expireStaleJobs(admin: Admin, printerId: string) {
  const base = () =>
    admin
      .from('print_jobs')
      .update({ status: 'failed', error: 'expired: プリンタ未接続の間に有効期限切れ' })
      .eq('printer_config_id', printerId)
      .eq('target', 'cloudprnt')
      .eq('status', 'queued');

  await Promise.all([
    base().eq('job_type', 'test').eq('payload->>drawer', 'true').lt('created_at', isoAgo(TTL_DRAWER_MS)),
    base().eq('job_type', 'test').lt('created_at', isoAgo(TTL_TEST_MS)),
    base().in('job_type', ['receipt', 'ryoshusho', 'kitchen', 'order_slip', 'register_report']).lt('created_at', isoAgo(TTL_PRINT_MS)),
  ]);
}

/** 確定されずに滞留した claimed ジョブを再キュー化（取りこぼし対策）。 */
export async function reclaimStaleJobs(admin: Admin, printerId: string) {
  await admin
    .from('print_jobs')
    .update({ status: 'queued', claimed_at: null })
    .eq('printer_config_id', printerId)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .lt('claimed_at', isoAgo(RECLAIM_STALE_MS));
}

/**
 * 店舗の「厨房伝票の分け方・文字の大きさ・商品名の言語」（設定 > レジ・プリンター）。読めなければ既定（種類ごと・大きめ・英語と日本語）。
 * 伝票が1枚も無いポーリングでは呼ばない（毎回の問い合わせを増やさない）。
 */
async function kitchenTicketSettingsForStore(
  admin: Admin,
  storeId: string
): Promise<KitchenTicketSettings & { courseSteps: CourseSteps }> {
  const { data, error } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  if (error) {
    console.error('[print-queue] store_settings read failed', storeId, error.message);
    return { ...kitchenTicketSettingsFrom(null), courseSteps: {} };
  }
  const settings = data?.settings ?? null;
  return { ...kitchenTicketSettingsFrom(settings), courseSteps: courseStepsFrom(settings) };
}

/**
 * コースの注文を「料理の行（1st, 2nd…）」に置き換える（lib/course-steps.ts）。
 * その店でコースの料理を決めていなければ何もしない。調べられなくても伝票は止めず、これまでどおりコース名で出す。
 */
async function expandCourseItems(admin: Admin, rows: ClaimedKitchenItem[], steps: CourseSteps): Promise<ClaimedKitchenItem[]> {
  if (Object.keys(steps).length === 0) return rows;
  const orderItemIds = rows.map((r) => r.order_item_id).filter((id): id is string => !!id);
  if (orderItemIds.length === 0) return rows;
  const { data: oi, error } = await admin.from('order_items').select('id, menu_item_id').in('id', orderItemIds);
  if (error) {
    console.error('[print-queue] course expand: order_items read failed', error.message);
    return rows;
  }
  const menuItemIdByOrderItem = new Map<string, string | null>((oi ?? []).map((x) => [x.id as string, (x.menu_item_id as string | null) ?? null]));
  const dishIds = new Set<string>();
  for (const id of menuItemIdByOrderItem.values()) {
    if (id && steps[id]) for (const d of steps[id]) dishIds.add(d);
  }
  if (dishIds.size === 0) return rows;
  const { data: items, error: dErr } = await admin
    .from('menu_items')
    .select('id, name, name_en, name_kana')
    .in('id', [...dishIds])
    .neq('status', 'deleted');
  if (dErr) {
    console.error('[print-queue] course expand: menu_items read failed', dErr.message);
    return rows;
  }
  const dishes = new Map<string, CourseDish>(
    (items ?? []).map((m) => [
      m.id as string,
      { id: m.id as string, name: m.name as string, nameEn: (m.name_en as string | null) ?? null, nameKana: (m.name_kana as string | null) ?? null },
    ])
  );
  return expandCourseRows(rows, menuItemIdByOrderItem, steps, dishes);
}

/**
 * ドリンクを料理と別の紙にする行に分ける（2026-10-17 Ronnie）。
 *   - ドリンクの商品（持ち場がドリンクのカテゴリ、または商品の種別がドリンク）
 *     「1台のキッチンプリンターでフードとドリンクを一緒に出すときは、ドリンクとフードを別の紙に切る」
 *   - セットのドリンク（ランチドリンクなど、名前に「ドリンク」が入る選択肢グループの選択肢）
 *     「ランチのドリンクの選択肢も、ランチの料理と一緒に出さず切って出す」
 * 調べられなくても伝票は止めない（持ち場がドリンクの行だけは分ける）。
 */
async function splitSetDrinks(admin: Admin, rows: ClaimedKitchenItem[]): Promise<ClaimedKitchenItem[]> {
  // 1品だけ・選択肢なしの注文は紙が1枚なので調べない（問い合わせを増やさない）
  const withOptions = rows.some((r) => (r.modifiers?.length ?? 0) > 0);
  if (rows.length <= 1 && !withOptions) return splitSetDrinkRows(rows, new Map());
  const ids = [
    ...new Set(rows.filter((r) => r.order_item_id && !r.course_step && r.station !== 'drink').map((r) => r.order_item_id as string)),
  ];
  if (ids.length === 0) return splitSetDrinkRows(rows, new Map());
  const { data: oi, error: oiErr } = await admin.from('order_items').select('id, menu_item_id').in('id', ids);
  if (oiErr) {
    console.error('[print-queue] drinks: order_items read failed', oiErr.message);
    return splitSetDrinkRows(rows, new Map());
  }
  const menuByOrderItem = new Map<string, string>();
  for (const x of oi ?? []) if (x.menu_item_id) menuByOrderItem.set(x.id as string, x.menu_item_id as string);
  const menuIds = [...new Set(menuByOrderItem.values())];
  if (menuIds.length === 0) return splitSetDrinkRows(rows, new Map());

  // 種別がドリンクの商品（カテゴリの持ち場がキッチンのままでも、ドリンクの紙にする）
  const drinkOrderItems = new Set<string>();
  const { data: menus, error: mErr } = await admin.from('menu_items').select('id, item_type').in('id', menuIds);
  if (mErr) console.error('[print-queue] drinks: menu_items read failed', mErr.message);
  const drinkMenus = new Set((menus ?? []).filter((m) => m.item_type === 'drink').map((m) => m.id as string));
  for (const [orderItemId, menuId] of menuByOrderItem) if (drinkMenus.has(menuId)) drinkOrderItems.add(orderItemId);

  // セットのドリンク（選択肢）
  const byOrderItem = new Map<string, Set<string>>();
  const rankByOrderItem = new Map<string, Map<string, number>>();
  if (withOptions) {
    const { data: links, error: lErr } = await admin
      .from('menu_item_option_groups')
      .select('menu_item_id, group_id')
      .in('menu_item_id', menuIds);
    const groupIds = [...new Set((links ?? []).map((l) => l.group_id as string))];
    const { data: groups, error: gErr } =
      !lErr && groupIds.length > 0
        ? await admin.from('menu_option_groups').select('id, name, sort_order').in('id', groupIds)
        : { data: [] as { id: string; name: string; sort_order: number | null }[], error: null };
    const groupName = new Map<string, string>((gErr ? [] : (groups ?? [])).map((g) => [g.id as string, g.name as string]));
    // 並べる順＝設定 > メニュー選択肢 の「上へ・下へ」（menu_option_groups.sort_order）。レジのダイアログ・レシートと同じ
    const groupOrder = new Map<string, number>(
      (gErr ? [] : (groups ?? [])).map((g) => [g.id as string, Number((g as { sort_order?: number | null }).sort_order ?? 0)])
    );
    if (groupName.size > 0) {
      // 全部の選択肢（ドリンクを分ける・設定の順に並べる）
      const { data: options, error: oErr } = await admin
        .from('menu_option_items')
        .select('group_id, name')
        .in('group_id', [...groupName.keys()]);
      // 商品 → 選択肢の名前 → グループ
      const groupsByMenu = new Map<string, string[]>();
      for (const l of links ?? []) {
        const m = l.menu_item_id as string;
        if (!groupsByMenu.has(m)) groupsByMenu.set(m, []);
        groupsByMenu.get(m)!.push(l.group_id as string);
      }
      const optionsByGroup = new Map<string, string[]>();
      for (const o of oErr ? [] : (options ?? [])) {
        const g = o.group_id as string;
        if (!optionsByGroup.has(g)) optionsByGroup.set(g, []);
        optionsByGroup.get(g)!.push(o.name as string);
      }
      for (const [orderItemId, menuId] of menuByOrderItem) {
        const drinks = new Set<string>();
        const ranks = new Map<string, number>();
        for (const g of groupsByMenu.get(menuId) ?? []) {
          const name = groupName.get(g);
          if (name === undefined) continue;
          const rank = groupOrder.get(g) ?? 0;
          for (const opt of optionsByGroup.get(g) ?? []) {
            if (!ranks.has(opt)) ranks.set(opt, rank);
            if (isDrinkOptionGroupName(name)) drinks.add(opt);
          }
        }
        if (drinks.size > 0) byOrderItem.set(orderItemId, drinks);
        if (ranks.size > 0) rankByOrderItem.set(orderItemId, ranks);
      }
    }
  }
  return splitSetDrinkRows(rows, byOrderItem, drinkOrderItems, rankByOrderItem);
}

/**
 * キッチン機のポーリング時に、担当ステーションの注文差分を確定して伝票ジョブにする。
 * 端末（iPad等）が起動していなくても、QR注文の伝票がプリンタから出る。
 * 店舗設定が「商品の種類ごと」なら1商品1枚に分け、1回の注文ぶんを1つのジョブ（1枚ごとにカット）にする。
 */
export async function generateKitchenJobs(admin: Admin, printer: PrinterRow, opts: { batchDelaySeconds?: number } = {}) {
  const { data, error } = await admin.rpc('claim_kitchen_items', {
    p_printer: printer.id,
    p_batch_delay_seconds: opts.batchDelaySeconds ?? KITCHEN_BATCH_DELAY_SECONDS,
    p_window_minutes: KITCHEN_WINDOW_MINUTES,
  });
  if (error) {
    console.error('[print-queue] claim_kitchen_items failed', printer.id, error.message);
    return;
  }
  const claimed = (data ?? []) as ClaimedKitchenItem[];
  if (claimed.length === 0) return;
  // The claim RPC deliberately stays unchanged; enrich only cancelled rows with their saved reason.
  const cancelIds = [...new Set(claimed.filter(r => r.delta < 0 && r.order_item_id).map(r => r.order_item_id!))];
  if (cancelIds.length) {
    const { data: cancelled, error: reasonError } = await admin.from('order_items')
      .select('id, cancel_reason').in('id', cancelIds);
    if (reasonError) console.error('[print-queue] cancellation reasons unavailable', reasonError.message);
    const reasons = new Map((cancelled ?? []).map(r => [r.id, r.cancel_reason]));
    for (const row of claimed) if (row.delta < 0) row.cancelReason = reasons.get(row.order_item_id!) ?? null;
  }
  const { split, textSize, language, buzzer, courseSteps } = await kitchenTicketSettingsForStore(admin, printer.store_id);
  // コースの注文は、その店で決めた料理の順（1st, 2nd…）に置き換えて伝票にする
  // セットのドリンク（ランチドリンクなど）は料理と別の紙にする
  const tickets = groupKitchenTickets(await splitSetDrinks(admin, await expandCourseItems(admin, claimed, courseSteps)));
  if (tickets.length === 0) return;

  const stations = (printer.kitchen_stations ?? ['kitchen']) as KitchenStation[];
  const title = `${stations.map((s) => STATION_LABELS[s] ?? s).join('・')} 伝票`;
  // 厨房伝票は英語を主にする（日本語を読まないスタッフが作るため）
  const titleEn = stations.map((s) => STATION_LABELS_EN[s] ?? String(s).toUpperCase()).join(' / ');
  // セットのドリンクだけの紙の見出し
  const drinkTitle = `${STATION_LABELS.drink} 伝票`;
  const drinkTitleEn = STATION_LABELS_EN.drink;
  const printedAt = new Date().toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
  const paperWidth = printer.paper_width_mm === 58 ? 58 : 80;

  const rows = [];
  for (const t of tickets) {
    const slips = ticketSlips(t, split);
    // Star 機向け: 全角がわずかに広い分を見込んで桁揃え（STAR_WIDTH_OPTIONS）
    const starSlips = slips.map((slip) => {
      const head = slip.drinkSlip ? { title: drinkTitle, titleEn: drinkTitleEn } : { title, titleEn };
      const lines = layoutKitchenTicket(slip, { ...head, printedAt, paperWidth, textSize, language, ...STAR_WIDTH_OPTIONS });
      // プリンターを上下さかさまに付けている店舗は、印字を180度回して出す
      return printer.upside_down ? rotateLines180(lines, colsFor(paperWidth)) : lines;
    });
    // EPSON機は1行の桁数が少ないため、専用の桁数で組み直す（Star用の行をそのまま渡すと折り返す）
    const eposSlips = slips.map((slip) => {
      const cols = eposCols(paperWidth);
      const head = slip.drinkSlip ? { title: drinkTitle, titleEn: drinkTitleEn } : { title, titleEn };
      const lines = layoutKitchenTicket(slip, { ...head, printedAt, columns: cols, textSize, language });
      return printer.upside_down ? rotateLines180(lines, cols) : lines;
    });
    let payload = {
      body: kitchenTicketsMarkup(starSlips, { buzzer }),
      starprnt: kitchenTicketsStarPrnt(starSlips, { buzzer }).toString('base64'),
      epos: kitchenTicketsEpos(eposSlips, { buzzer }),
    };
    let renderedAsImage = false;
    try {
      const images = [];
      for (const slip of slips) images.push(await renderTicketImage(kitchenDesign(slip, {
        title: slip.drinkSlip ? drinkTitle : title, printedAt, textSize, language,
      }), paperWidth === 58 ? 384 : 576, !!printer.upside_down));
      payload = await ticketImagePayload(images, buzzer);
      renderedAsImage = true;
    } catch (error) {
      // Claimed rows are already marked sent: keep a readable native-font ticket if rasterization fails.
      console.error('[print-queue] ticket image failed, using text fallback', error);
    }
    rows.push({
      organization_id: printer.organization_id,
      store_id: printer.store_id,
      printer_config_id: printer.id,
      job_type: 'kitchen',
      order_id: t.orderId,
      target: 'cloudprnt',
      content_type: MARKUP,
      payload: {
        ...payload,
        renderer: {
          version: "kitchen-heading-v2",
          commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          deployment: process.env.VERCEL_URL ?? null,
          mode: renderedAsImage ? "raster" : "native-fallback",
        },
      },
      status: 'queued',
    });
  }

  const { error: insErr } = await admin.from('print_jobs').insert(rows);
  if (insErr) {
    // 明細は伝達済みに更新済みのため、ここで失敗すると伝票が出ない。KDS画面で確認できるよう記録を残す。
    console.error('[print-queue] kitchen job insert failed', printer.id, insErr.message);
  }
}

/**
 * 厨房へ送ったその場で、その店のキッチン機すべての伝票ジョブを作る（2026-10-17 Ronnie「印刷が遅い。すぐ出るように」）。
 * これまでは「プリンターが次に問い合わせてきたとき」に、送ってから 3 秒たった品だけを伝票にしていたので、
 * 問い合わせ間隔＋3 秒（MEAT CROWN で平均 11 秒）待ってから伝票ができていた。
 * Order のスライド・ハンディの送信・お客様QRの注文は「送る」と決めた瞬間なので、待たずに今つくる（まとめる待ちは 0 秒）。
 * プリンターは次の問い合わせ（1〜5 秒）ですぐ受け取る。同じ品を2枚にしないのは claim_kitchen_items（skip locked・印刷済み数）。
 * 失敗しても注文は成立させる（今まで通り、プリンターの問い合わせのときに作られる）。
 */
export async function generateKitchenJobsForStore(admin: Admin, storeId: string): Promise<number> {
  const { data } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, name, usage, paper_width_mm, kitchen_stations, auto_print, floor_ids, bill_slips, upside_down, maker')
    .eq('store_id', storeId)
    .eq('usage', 'kitchen')
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active');
  const printers = (data ?? []) as PrinterRow[];
  let done = 0;
  for (const printer of printers) {
    try {
      await generateKitchenJobs(admin, printer, { batchDelaySeconds: 0 });
      done += 1;
    } catch (e) {
      console.error('[print-queue] immediate kitchen jobs failed', printer.id, e instanceof Error ? e.message : e);
    }
  }
  return done;
}

/** このプリンタ宛ての最古の queued を1件取り出し、claimed にする。 */
export async function claimNextJob(
  admin: Admin,
  printerId: string,
  attempt = 0
): Promise<{ id: string; content_type: string | null; payload: JobPayload | null } | null> {
  const queued = () =>
    admin
      .from('print_jobs')
      .select('id, content_type, payload')
      .eq('printer_config_id', printerId)
      .eq('status', 'queued')
      .eq('target', 'cloudprnt');

  // ドロアは会計のたびに「すぐ」開かないとお釣りが出せず現場が止まるので、伝票より先に出す。
  // （これまでは古い順だったため、前のレシートや厨房伝票が詰まると数分待たされることがあった。
  //   2026-09-25 店舗報告「会計してもドロアが5分後に開く」）
  const { data: drawer } = await queued()
    .eq('job_type', 'test')
    .eq('payload->>drawer', 'true')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const job = drawer ?? (await queued().order('created_at', { ascending: true }).limit(1).maybeSingle()).data;
  if (!job) return null;

  // まだ queued のときだけ claimed にする（プリンター自身と、Wi-Fi で直接印刷する iPad が同時に取りに来ても
  // 同じ伝票が2枚出ないように。lib/direct-print.ts）
  const { data: claimed } = await admin
    .from('print_jobs')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');
  if (!claimed || claimed.length === 0) {
    // ほかが先に取った。次の1件を見る（1回だけ）
    if (attempt < 1) return claimNextJob(admin, printerId, attempt + 1);
    return null;
  }
  return job as { id: string; content_type: string | null; payload: JobPayload | null };
}

/** Wi-Fi で直接印刷できなかった（iPad からプリンターにつながらない）ジョブを、プリンター自身の印刷に戻す */
export async function releaseJob(admin: Admin, printerId: string, jobId: string) {
  await admin
    .from('print_jobs')
    .update({ status: 'queued', claimed_at: null })
    .eq('id', jobId)
    .eq('printer_config_id', printerId)
    .eq('status', 'claimed');
}

/** プリンター1台の行（Wi-Fi で直接印刷する iPad 用。トークンではなく id で引く。呼ぶ側で店舗の権限を確かめてから） */
export async function loadPrinterRow(admin: Admin, printerId: string): Promise<PrinterRow | null> {
  const { data } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, name, usage, paper_width_mm, kitchen_stations, auto_print, floor_ids, bill_slips, upside_down, maker, ip_address, connection_type, last_polled_at')
    .eq('id', printerId)
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active')
    .maybeSingle();
  return (data as PrinterRow | null) ?? null;
}

/**
 * このプリンタが現在取りかかっている（claimed の）ジョブのうち最も古いもの。
 * jobToken 非対応の旧ファーム（mC-Print3 3.2 未満、IFBD-HI01X/HI02X 1.8 未満）は GET/DELETE に
 * ?token= を付けてこないため、POST で払い出した直後のジョブをこれで特定する。
 * 「最も古い claimed」を GET と DELETE の両方で使えば、途中で次のジョブが claimed になっても
 * 取得と確定が同じジョブを指す。
 */
export async function currentClaimedJob(admin: Admin, printerId: string) {
  const { data: job } = await admin
    .from('print_jobs')
    .select('id, content_type, payload')
    .eq('printer_config_id', printerId)
    .eq('status', 'claimed')
    .eq('target', 'cloudprnt')
    .order('claimed_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (job as { id: string; content_type: string | null; payload: JobPayload | null } | null) ?? null;
}

/** 印字結果の確定。 */
export async function finishJob(
  admin: Admin,
  printerId: string,
  jobId: string,
  success: boolean,
  detail?: string | null
) {
  await admin
    .from('print_jobs')
    .update(
      success
        ? { status: 'printed', printed_at: new Date().toISOString() }
        : { status: 'failed', error: detail ? `printer: ${detail}` : 'printer error' }
    )
    .eq('id', jobId)
    .eq('printer_config_id', printerId);
}
