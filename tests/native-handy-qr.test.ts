import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NATIVE_HANDY_QR_TYPES, handyQrExtraIps, isNativeHandyQrType, parseNativeHandyQrAction } from '@/lib/native-handy-qr';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// 2026-10-25 Ronnie「Make everything 101% native. We no longer need the Web iPad version」
// → 設定 › iPhoneハンディ（QR の作成・作り直し・お店の Wi-Fi・印刷）も iPad の中で
describe('iPad ネイティブの 設定 › iPhoneハンディ', () => {
  it('操作は 5 つ（作る・作り直す・回線を足す・外す・Wi-Fi だけ）', () => {
    expect([...NATIVE_HANDY_QR_TYPES]).toEqual(['handyQrSetup', 'handyQrRegenerate', 'handyQrNetworkAdd', 'handyQrNetworkRemove', 'handyQrWifiOnly']);
    expect(isNativeHandyQrType('handyQrRegenerate')).toBe(true);
    expect(isNativeHandyQrType('handyqr')).toBe(false);
    expect(isNativeHandyQrType(3)).toBe(false);
  });

  it('iPad が調べた IP は IPv4 / IPv6 の形だけ・2 つまで（Web の extraIpsFrom と同じ）', () => {
    expect(handyQrExtraIps(['203.0.113.5', '2001:db8::1', '198.51.100.7'])).toEqual(['203.0.113.5', '2001:db8::1']);
    expect(handyQrExtraIps(['not-ip', 5, '999.1.1.1'])).toEqual([]);
    expect(handyQrExtraIps('203.0.113.5')).toEqual([]);
    expect(handyQrExtraIps(undefined)).toEqual([]);
  });

  it('送られてきた中身を確かめる', () => {
    expect(parseNativeHandyQrAction({ type: 'handyQrSetup', extraIps: ['203.0.113.5', 'x'] })).toEqual({
      ok: true,
      value: { type: 'handyQrSetup', extraIps: ['203.0.113.5'] },
    });
    expect(parseNativeHandyQrAction({ type: 'handyQrRegenerate' })).toEqual({ ok: true, value: { type: 'handyQrRegenerate' } });
    expect(parseNativeHandyQrAction({ type: 'handyQrNetworkAdd', label: '  3F Wi-Fi  ', extraIps: [] })).toEqual({
      ok: true,
      value: { type: 'handyQrNetworkAdd', label: '3F Wi-Fi', extraIps: [] },
    });
    // 名前は 40 字まで・無ければ空（Server Action が「お店のWi-Fi」にする）
    const long = parseNativeHandyQrAction({ type: 'handyQrNetworkAdd', label: 'あ'.repeat(60) });
    expect(long.ok && long.value.type === 'handyQrNetworkAdd' && long.value.label.length).toBe(40);
    expect(parseNativeHandyQrAction({ type: 'handyQrNetworkAdd' })).toEqual({ ok: true, value: { type: 'handyQrNetworkAdd', label: '', extraIps: [] } });
    expect(parseNativeHandyQrAction({ type: 'handyQrNetworkRemove', key: '203.0.113.5' })).toEqual({
      ok: true,
      value: { type: 'handyQrNetworkRemove', key: '203.0.113.5' },
    });
    expect(parseNativeHandyQrAction({ type: 'handyQrNetworkRemove', key: '' }).ok).toBe(false);
    expect(parseNativeHandyQrAction({ type: 'handyQrNetworkRemove', key: 'x'.repeat(65) }).ok).toBe(false);
    expect(parseNativeHandyQrAction({ type: 'handyQrWifiOnly', wifiOnly: true })).toEqual({ ok: true, value: { type: 'handyQrWifiOnly', wifiOnly: true } });
    expect(parseNativeHandyQrAction({ type: 'handyQrWifiOnly', wifiOnly: 'true' }).ok).toBe(false);
    expect(parseNativeHandyQrAction({ type: 'nope' }).ok).toBe(false);
    expect(parseNativeHandyQrAction(null).ok).toBe(false);
  });

  it('Web とネイティブは同じ Server Action・同じ権限（store.settings）', () => {
    const page = read('app/app/settings/handy-qr/page.tsx');
    expect(page).toContain("requirePermission('store.settings')");
    const mod = read('lib/native-modules/handy-qr.ts');
    expect(mod).toContain("can(ctx.role, 'store.settings')");
    for (const fn of ['setupHandyQr(store.id', 'regenerateHandyQr(store.id', 'addCurrentShopNetwork(store.id', 'removeShopNetwork(store.id', 'setHandyWifiOnly(store.id']) {
      expect(mod).toContain(`await ${fn}`);
    }
    expect(mod).toContain('currentIsShop: isShopNetwork(qr, ip)');
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('handyQrAdmin: handyQrAdminGet');
    expect(registry).toContain('NATIVE_HANDY_QR_TYPES.map((t) => [t, handyQrAdminPost])');
  });

  it('iPad：設定の画面はネイティブの管理（作り直し・Wi-Fi・印刷）。Web の /app/settings/handy-qr を開かない', () => {
    const pages = read('ios/Shared/NativeSettingsPages.swift');
    expect(pages).toContain('NativeHandyQrAdminView(onBack: { state.goNativeSettings() })');
    const admin = read('ios/Shared/NativeHandyQrAdmin.swift');
    expect(admin).toContain('static let part = "handyQrAdmin"');
    for (const t of NATIVE_HANDY_QR_TYPES) expect(admin).toContain(`"type": "${t}"`);
    expect(admin).not.toContain('leaveNativeFloor');
    // 印刷は iPad の中で PDF を作って QuickLook（見る・印刷・共有）
    expect(admin).toContain('NativeQuickLookSheet(url:');
    expect(read('ios/Shared/NativeFileShare.swift')).toContain('QLPreviewController()');
  });
});

describe('iPad：Web の画面へ行く残りの道をネイティブに（2026-10-25）', () => {
  it('オーダー・会計：サーバーの useWeb でも Web の伝票を開かない（ネイティブのまま知らせる）', () => {
    const model = read('ios/Shared/NativePosModels.swift');
    expect(model).not.toContain('if e.useWeb { openInWeb() }');
    const order = read('ios/Shared/NativeOrderView.swift');
    expect(order).not.toContain('今までの画面を開く');
    expect(order).toContain('NativeCatalogCache.shared.refresh(storeId: model.storeId)');
  });

  it('在庫の「Web で開く」・テーブル・フロアの「配置エディタ（Web）」は無い', () => {
    expect(read('ios/Shared/NativeInventoryView.swift')).not.toContain('Web で開く');
    expect(read('ios/Shared/NativeSettingsPages.swift')).not.toContain('配置エディタ（Web）');
  });

  it('CSV・PDF：裏の Web の画面でダウンロードが始まっても WKWebView に出さず、アプリで取ってきて共有シート／QuickLook', () => {
    // Web の CSV は attachment（lib/csv.ts の csvResponse）
    expect(read('lib/csv.ts')).toContain("'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`");
    const share = read('ios/Shared/NativeFileShare.swift');
    expect(share).toContain('decidePolicyFor navigationResponse: WKNavigationResponse');
    expect(share).toContain('let file = try await NativeFileShare.download(path, name: name)');
    expect(share).toContain('if type.contains("text/html")');
    expect(share).toContain('UIActivityViewController(activityItems: [url]');
    // ネイティブの画面を開く道（leaveNativeFloor）は、Web を読む前にネイティブを出す
    expect(read('ios/Shared/AppState.swift')).toContain('maybeOpenNativePos(for: AppConfig.url(path))\n        WebViewController.current?.load(AppConfig.url(path))');
  });

  it('入出金の知らない ?tab= もネイティブの入出金（Web の /app/cash も register 扱い）', () => {
    expect(read('app/app/cash/page.tsx')).toContain("sp.tab === 'petty' || sp.tab === 'closings' ? sp.tab : 'register'");
    const app = read('ios/Shared/AppState.swift');
    expect(app).not.toContain('if tab == nil || tab == "register" || tab == "petty" || tab == "closings" {');
  });
});
