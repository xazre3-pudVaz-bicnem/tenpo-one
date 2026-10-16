import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  claimNextJob,
  expireStaleJobs,
  finishJob,
  generateKitchenJobs,
  loadPrinterRow,
  reclaimStaleJobs,
  releaseJob,
  touchPrinter,
  type PrinterRow,
} from '@/lib/print-queue';
import {
  bluetoothMakerOf,
  eposSoapEnvelope,
  isEpsonMaker,
  isLanRelayPrinter,
  isLocalPrinterHost,
  parseLanTarget,
} from '@/lib/direct-print';
import { drawerKickEpos, testPrintEpos } from '@/lib/epos-print';
import { drawerKickStarPrnt, testPrintStarPrnt } from '@/lib/starprnt';
import { eposXmlToEscPos } from '@/lib/escpos';

/**
 * Wi-Fi で直接印刷する iPad 用（lib/direct-print.ts・components/printing/direct-print-agent.tsx）。
 *   next … そのプリンター宛ての印刷を1件受け取る（プリンター自身の Server Direct Print と同じキュー。同じ伝票は2枚出ない）
 *   done … iPad がプリンターに送った結果。つながらなかったときはキューに戻す（プリンター自身の印刷に任せる）
 *   test … 試し印刷・ドロアの中身（キューには積まない）
 *   next-bt / test-bt … iPad と Bluetooth・USB でつないだレシートプリンター（TENPO ONE レジ アプリ）用。
 *     Star は StarPRNT、EPSON・SII（RP-F10）・そのほかは ESC/POS のバイト列（base64）を返し、アプリが送る
 *     （2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth。チケットプリンターは LAN・Wi-Fi」）
 *     format: 'epos' … バイト列ではなく ePOS-Print XML を返す（Safari が画像・PDF にして SII URL Print Agent で印刷する。
 *     lib/sii-url-print.ts。2026-10-14 Ronnie「SII RP-F10 を Safari でも」）
 *   next-lan / test-lan … LAN（有線・Wi-Fi）のプリンターへ iPad（TENPO ONE アプリ）が ESC/POS をそのまま送る用
 *     （TCP 9100。ios/Shared/LanPrinters.swift）。SII RP-F10 など、自分から印刷を取りに来られないプリンター。
 *     EPSON の Server Direct Print の無い機種もこれで送れる（2026-10-16 Ronnie「EPSON と RP-F10 を LAN で」）
 * ログインしている人の店舗のプリンターだけ。Wi-Fi は EPSON・お店の中のアドレス（IP）があるものだけ。
 */

/** iPad から LAN で送っているプリンターの「最後に取りに来た時刻」を書く間隔（毎秒書かない） */
const LAN_TOUCH_EVERY_MS = 20_000;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body =
  | { action: 'next' | 'next-bt' | 'next-lan'; printerIds?: unknown; format?: unknown }
  | { action: 'done'; printerId?: unknown; jobId?: unknown; result?: unknown; code?: unknown }
  | { action: 'test' | 'test-bt' | 'test-lan'; printerId?: unknown; kind?: unknown; format?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx || !ctx.organizationId) return NextResponse.json({ ok: false, error: 'ログインしてください' }, { status: 401 });
  if (!can(ctx.role, 'pos.order')) return NextResponse.json({ ok: false, error: '権限がありません' }, { status: 403 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const admin = createAdminClient();
  const storeIds = new Set(ctx.stores.map((s) => s.id));
  /** この人の店舗のプリンター */
  const mine = async (id: unknown): Promise<PrinterRow | null> => {
    if (!isId(id)) return null;
    const row = await loadPrinterRow(admin, id);
    if (!row || row.organization_id !== ctx.organizationId) return null;
    if (!ctx.isHq && !storeIds.has(row.store_id)) return null;
    return row;
  };
  /** この人の店舗の EPSON で、アドレスが入っているプリンターだけ（Wi-Fi） */
  const usable = async (id: unknown): Promise<(PrinterRow & { host: string }) | null> => {
    const row = await mine(id);
    if (!row || !isEpsonMaker(row.maker)) return null;
    const host = (row.ip_address ?? '').trim();
    if (!isLocalPrinterHost(host)) return null;
    return { ...row, host };
  };

  if (body.action === 'next') {
    const ids = Array.isArray(body.printerIds) ? body.printerIds.slice(0, 8) : [];
    for (const id of ids) {
      const printer = await usable(id);
      if (!printer) continue;
      await expireStaleJobs(admin, printer.id);
      await reclaimStaleJobs(admin, printer.id);
      if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer);
      const job = await claimNextJob(admin, printer.id);
      if (!job) continue;
      const xml = job.payload?.epos;
      if (!xml) {
        await finishJob(admin, printer.id, job.id, false, 'EPSON用の印刷データがありません');
        continue;
      }
      return NextResponse.json({
        ok: true,
        job: { id: job.id, printerId: printer.id, printerName: printer.name, host: printer.host, soap: eposSoapEnvelope(xml) },
      });
    }
    return NextResponse.json({ ok: true, job: null });
  }

  /** この人の店舗の、iPad から LAN で送れるプリンター（Wi-Fi・有線LAN、Star 以外、お店の中の IP） */
  const lanUsable = async (id: unknown): Promise<(PrinterRow & { host: string; port: number }) | null> => {
    const row = await mine(id);
    if (!row || !isLanRelayPrinter({ maker: row.maker, connection: row.connection_type, ip: row.ip_address })) return null;
    const target = parseLanTarget(row.ip_address);
    return target ? { ...row, ...target } : null;
  };

  if (body.action === 'next-lan') {
    const ids = Array.isArray(body.printerIds) ? body.printerIds.slice(0, 8) : [];
    for (const id of ids) {
      const printer = await lanUsable(id);
      if (!printer) continue;
      // 「接続中」の表示（iPad が取りに来ている）。毎秒は書かない
      const last = printer.last_polled_at ? new Date(printer.last_polled_at).getTime() : 0;
      if (Date.now() - last > LAN_TOUCH_EVERY_MS) await touchPrinter(admin, printer.id);
      await expireStaleJobs(admin, printer.id);
      await reclaimStaleJobs(admin, printer.id);
      if (printer.usage === 'kitchen') await generateKitchenJobs(admin, printer);
      const job = await claimNextJob(admin, printer.id);
      if (!job) continue;
      const epos = job.payload?.epos;
      const bytes = epos ? eposXmlToEscPos(epos) : null;
      if (!bytes) {
        await finishJob(admin, printer.id, job.id, false, 'LAN 用の印刷データがありません');
        continue;
      }
      return NextResponse.json({
        ok: true,
        job: {
          id: job.id,
          printerId: printer.id,
          printerName: printer.name,
          host: printer.host,
          port: printer.port,
          data: Buffer.from(bytes).toString('base64'),
        },
      });
    }
    return NextResponse.json({ ok: true, job: null });
  }

  if (body.action === 'test-lan') {
    const printer = await lanUsable(body.printerId);
    if (!printer) {
      return NextResponse.json(
        { ok: false, error: 'Wi-Fi・有線LAN のプリンター（Star 以外）で、IPアドレス（192.168.…）が入っているものだけ送れます' },
        { status: 404 }
      );
    }
    const store = ctx.stores.find((s) => s.id === printer.store_id);
    const paper = printer.paper_width_mm === 58 ? 58 : 80;
    const issuedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const xml =
      body.kind === 'drawer'
        ? drawerKickEpos(null)
        : testPrintEpos({ storeName: `${store?.name ?? 'TENPO ONE'}（LAN）`, paperWidth: paper, issuedAt });
    return NextResponse.json({
      ok: true,
      host: printer.host,
      port: printer.port,
      data: Buffer.from(eposXmlToEscPos(xml)).toString('base64'),
    });
  }

  if (body.action === 'next-bt') {
    const ids = Array.isArray(body.printerIds) ? body.printerIds.slice(0, 8) : [];
    for (const id of ids) {
      const printer = await mine(id);
      const maker = printer ? bluetoothMakerOf(printer.maker) : null;
      if (!printer || !maker) continue;
      await expireStaleJobs(admin, printer.id);
      await reclaimStaleJobs(admin, printer.id);
      const job = await claimNextJob(admin, printer.id);
      if (!job) continue;
      if (body.format === 'epos') {
        const epos = job.payload?.epos;
        if (!epos) {
          await finishJob(admin, printer.id, job.id, false, 'SII URL Print Agent 用の印刷データがありません');
          continue;
        }
        return NextResponse.json({
          ok: true,
          job: {
            id: job.id,
            printerId: printer.id,
            printerName: printer.name,
            epos,
            paper: printer.paper_width_mm === 58 ? 58 : 80,
          },
        });
      }
      const bytes =
        maker === 'star'
          ? job.payload?.starprnt
            ? Buffer.from(job.payload.starprnt, 'base64')
            : null
          : job.payload?.epos
            ? eposXmlToEscPos(job.payload.epos)
            : null;
      if (!bytes) {
        await finishJob(admin, printer.id, job.id, false, 'Bluetooth 用の印刷データがありません');
        continue;
      }
      return NextResponse.json({
        ok: true,
        job: { id: job.id, printerId: printer.id, printerName: printer.name, data: bytes.toString('base64') },
      });
    }
    return NextResponse.json({ ok: true, job: null });
  }

  if (body.action === 'test-bt') {
    const printer = await mine(body.printerId);
    const maker = printer ? bluetoothMakerOf(printer.maker) : null;
    if (!printer || !maker) {
      return NextResponse.json({ ok: false, error: 'プリンターが見つかりません' }, { status: 404 });
    }
    const store = ctx.stores.find((s) => s.id === printer.store_id);
    const paper = printer.paper_width_mm === 58 ? 58 : 80;
    const issuedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const storeName = `${store?.name ?? 'TENPO ONE'}（Bluetooth）`;
    if (body.format === 'epos') {
      const epos = body.kind === 'drawer' ? drawerKickEpos(null) : testPrintEpos({ storeName, paperWidth: paper, issuedAt });
      return NextResponse.json({ ok: true, maker, epos, paper });
    }
    const bytes =
      maker === 'star'
        ? body.kind === 'drawer'
          ? drawerKickStarPrnt('[drawer: 1]')
          : testPrintStarPrnt({ storeName, paperWidth: paper, issuedAt })
        : eposXmlToEscPos(body.kind === 'drawer' ? drawerKickEpos(null) : testPrintEpos({ storeName, paperWidth: paper, issuedAt }));
    return NextResponse.json({ ok: true, maker, data: Buffer.from(bytes).toString('base64') });
  }

  if (body.action === 'done') {
    const printer = await mine(body.printerId);
    if (!printer || !isId(body.jobId)) return NextResponse.json({ ok: false }, { status: 404 });
    const code = typeof body.code === 'string' ? body.code.slice(0, 80) : null;
    if (body.result === 'printed') {
      await finishJob(admin, printer.id, body.jobId, true);
      await touchPrinter(admin, printer.id);
    } else if (body.result === 'unreachable') {
      // iPad からプリンターにつながらなかった → キューに戻す（プリンター自身の Server Direct Print が印刷する）
      await releaseJob(admin, printer.id, body.jobId);
    } else {
      await finishJob(admin, printer.id, body.jobId, false, code ?? 'direct: printer error');
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'test') {
    const printer = await usable(body.printerId);
    if (!printer) {
      return NextResponse.json(
        { ok: false, error: 'EPSON のプリンターで、IPアドレス（192.168.…）が入っているものだけ直接印刷できます' },
        { status: 404 }
      );
    }
    const store = ctx.stores.find((s) => s.id === printer.store_id);
    const paper = printer.paper_width_mm === 58 ? 58 : 80;
    const issuedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const xml =
      body.kind === 'drawer'
        ? drawerKickEpos(null)
        : testPrintEpos({ storeName: `${store?.name ?? 'TENPO ONE'}（Wi-Fi 直接）`, paperWidth: paper, issuedAt });
    return NextResponse.json({ ok: true, host: printer.host, soap: eposSoapEnvelope(xml) });
  }

  return NextResponse.json({ ok: false }, { status: 400 });
}
