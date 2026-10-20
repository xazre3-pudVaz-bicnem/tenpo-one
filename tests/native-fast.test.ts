import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNativePosAction } from '@/lib/native-pos';

/**
 * ネイティブのオーダー画面を Airレジ並みに（2026-10-21 Ronnie「メニュー・印刷は超速く」）：
 * メニューは iPad に保存して先に出す／厨房伝票は注文の返事と一緒に受け取って iPad から LAN で直接出す
 */
describe('ネイティブのレジ：メニューの保存・直接印刷', () => {
  const route = readFileSync(new URL('../app/api/app/v1/pos/route.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../lib/native-pos-server.ts', import.meta.url), 'utf8');
  const print = readFileSync(new URL('../lib/native-print-server.ts', import.meta.url), 'utf8');
  const model = readFileSync(new URL('../ios/Shared/NativePosModels.swift', import.meta.url), 'utf8');
  const cache = readFileSync(new URL('../ios/Shared/NativeCatalogCache.swift', import.meta.url), 'utf8');
  const lan = readFileSync(new URL('../ios/Shared/NativeLanPrint.swift', import.meta.url), 'utf8');
  const appState = readFileSync(new URL('../ios/Shared/AppState.swift', import.meta.url), 'utf8');

  it('サーバー：?part=catalog（店のメニューまわり＋version）と ?part=live（伝票・開局・stera）', () => {
    expect(route).toContain("if (part === 'catalog')");
    expect(route).toContain("if (part === 'live')");
    expect(server).toContain('export async function loadNativeCatalog(');
    expect(server).toContain('export async function loadNativeLive(');
    expect(server).toContain("return { ...body, version: versionOf(body) };");
    // 全部読むときも version を付ける（テイクアウトは保存させない）
    expect(server).toContain('catalogVersion: takeout ? undefined : version,');
  });
  it('サーバー：注文確定の返事に LAN の厨房伝票（claimed 済み）を付け、printDone で結果を受ける', () => {
    expect(route).toContain('const prints = row?.store_id ? await claimLanKitchenPrints(createAdminClient(), row.store_id as string) : [];');
    expect(route).toContain("case 'printDone':");
    expect(print).toContain("isLanRelayPrinter({ maker: p.maker, connection: p.connection_type, ip: p.ip_address })");
    expect(print).toContain('await generateKitchenJobs(admin, printer, { batchDelaySeconds: 0 });');
    expect(print).toContain('await claimNextJob(admin, printer.id)');
    // 出せなかったら戻す（Web の DirectPrintAgent かプリンター自身が出す）
    expect(print).toContain("await releaseJob(admin, printerId, jobId);");
    const ok = parseNativePosAction({ type: 'printDone', printerId: '11111111-1111-4111-8111-111111111111', jobId: '22222222-2222-4222-8222-222222222222', result: 'printed', code: null });
    expect(ok.ok).toBe(true);
    const bad = parseNativePosAction({ type: 'printDone', printerId: 'x', jobId: 'y', result: 'printed' });
    expect(bad.ok).toBe(false);
  });
  it('iPad：保存したメニューで先に出し、伝票だけ軽く読み、裏でメニューを読み直す', () => {
    expect(model).toContain('if let cached = NativeCatalogCache.shared.load() {');
    expect(model).toContain('let live = try await NativeAPI.shared.loadLive(orderId: orderId)');
    expect(model).toContain('NativeCatalogCache.shared.refresh(storeId: live.storeId)');
    expect(cache).toContain('appendingPathComponent("tenpo-catalog.json")');
    expect(cache).toContain('if c.version != current?.version || c.store.id != current?.store.id {');
    // ホーム・テーブル一覧のときに裏で読んでおく（最初の伝票もすぐ開く）
    expect(appState).toContain('Task { @MainActor in NativeCatalogCache.shared.refresh() }');
  });
  it('iPad：注文確定の返事の厨房伝票をその場で LAN へ送り、結果を printDone', () => {
    expect(model).toContain('if let prints = r.prints, !prints.isEmpty { NativeLanPrint.shared.send(prints) }');
    expect(lan).toContain('LanPrinters.shared.print(host: job.host, port: job.port, data: data)');
    expect(lan).toContain('"type": "printDone"');
  });
});
