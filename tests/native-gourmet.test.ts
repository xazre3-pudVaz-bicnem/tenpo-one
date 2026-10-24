import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GOURMET_IMPORT_STATUS_LABEL, isNativeGourmetActionType, NATIVE_GOURMET_ACTION_TYPES, parseNativeGourmetAction } from '@/lib/native-gourmet';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('ネイティブのグルメ連携（2026-10-24 Ronnie「iOS でもグルメ連携を台帳に。管理画面からも」）', () => {
  it('知らない形は受け付けない', () => {
    expect(parseNativeGourmetAction(null).ok).toBe(false);
    expect(parseNativeGourmetAction({ type: 'ledgerSeat' }).ok).toBe(false);
    expect(isNativeGourmetActionType('gourmetEnable')).toBe(true);
    expect(isNativeGourmetActionType('send')).toBe(false);
    expect(NATIVE_GOURMET_ACTION_TYPES.length).toBe(4);
  });

  it('オン・オフ／サイトの登録印／対応済み／作り直し', () => {
    expect(parseNativeGourmetAction({ type: 'gourmetEnable', enabled: true })).toEqual({ ok: true, action: { type: 'gourmetEnable', enabled: true } });
    expect(parseNativeGourmetAction({ type: 'gourmetEnable', enabled: 'yes' }).ok).toBe(false);
    expect(parseNativeGourmetAction({ type: 'gourmetMarkSite', site: 'tabelog', registered: true })).toEqual({ ok: true, action: { type: 'gourmetMarkSite', site: 'tabelog', registered: true } });
    expect(parseNativeGourmetAction({ type: 'gourmetMarkSite', site: 'foodie', registered: true }).ok).toBe(false);
    expect(parseNativeGourmetAction({ type: 'gourmetMarkSite', site: 'tabelog' }).ok).toBe(false);
    expect(parseNativeGourmetAction({ type: 'gourmetResolve', importId: U1 })).toEqual({ ok: true, action: { type: 'gourmetResolve', importId: U1 } });
    expect(parseNativeGourmetAction({ type: 'gourmetResolve', importId: 'x' }).ok).toBe(false);
    expect(parseNativeGourmetAction({ type: 'gourmetRegenerate' })).toEqual({ ok: true, action: { type: 'gourmetRegenerate' } });
  });

  it('取り込み履歴の状態の言葉は Web と同じ', () => {
    const web = readFileSync(new URL('../components/settings/gourmet-mail-imports.tsx', import.meta.url), 'utf8');
    for (const [k, v] of Object.entries(GOURMET_IMPORT_STATUS_LABEL)) expect(web).toContain(`${k}: { label: '${v}'`);
  });

  it('サーバー：GET part=gourmet と POST gourmet… は store.settings。中身は Web と同じ Server Action', () => {
    const route = readFileSync(new URL('../app/api/app/v1/pos/route.ts', import.meta.url), 'utf8');
    expect(route).toContain("if (part === 'gourmet') {");
    expect(route).toContain("isNativeGourmetActionType((raw as { type?: unknown }).type)");
    expect(route).toContain("if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);\n    const g = await loadNativeGourmet(");
    expect(route).toContain('const gourmetProblem = await networkProblem(ctx);');
    expect(route).toContain('await setGourmetMailEnabled(store.id, ga.enabled)');
    expect(route).toContain('await regenerateGourmetMailToken(store.id)');
  });

  it('店舗の設定画面・運営の管理画面・アプリが同じ保存のしかたを使う', () => {
    const tenant = readFileSync(new URL('../app/app/settings/reservation-book/actions.ts', import.meta.url), 'utf8');
    const admin = readFileSync(new URL('../app/admin/tenants/actions.ts', import.meta.url), 'utf8');
    for (const src of [tenant, admin]) {
      expect(src).toContain("from '@/lib/gourmet-mail-settings-server'");
      expect(src).toContain('setGourmetMailEnabledFor(');
      expect(src).toContain('regenerateGourmetMailTokenFor(');
      expect(src).toContain('markGourmetSiteRegisteredFor(');
      expect(src).toContain('resolveGourmetMailImportFor(');
    }
    // 運営の操作は requireCypressAdmin
    for (const name of ['adminSetGourmetMailEnabled', 'adminRegenerateGourmetMailToken', 'adminMarkGourmetSiteRegistered', 'adminResolveGourmetMailImport']) {
      const i = admin.indexOf(`export async function ${name}(`);
      expect(i).toBeGreaterThan(0);
      expect(admin.slice(i, i + 400)).toContain('await requireCypressAdmin()');
    }
    // 管理画面の店舗ページに出す
    const page = readFileSync(new URL('../app/admin/tenants/[storeId]/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('<TenantGourmet storeId={storeId}');
  });

  it('iPad：📅 のメニューにグルメ連携、台帳の箱・一覧・詳細に入り口の色つきの印', () => {
    const tools = readFileSync(new URL('../ios/Shared/NativeLedgerTools.swift', import.meta.url), 'utf8');
    expect(tools).toContain('Button(action: onGourmet) { Label("グルメ連携", systemImage: "envelope.badge") }');
    const ledger = readFileSync(new URL('../ios/Shared/NativeLedgerView.swift', import.meta.url), 'utf8');
    expect(ledger).toContain('NativeGourmetSheet(onClose: { gourmetOpen = false }');
    expect(ledger.match(/NLSource\.style\(for: r, in: p\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const sheet = readFileSync(new URL('../ios/Shared/NativeReservationSheets.swift', import.meta.url), 'utf8');
    expect(sheet).toContain('NLSourceChip(style: st, auto: r.createdVia == "gourmet_mail"');
    const view = readFileSync(new URL('../ios/Shared/NativeGourmetView.swift', import.meta.url), 'utf8');
    expect(view).toContain('URLQueryItem(name: "part", value: "gourmet")');
    for (const t of ['gourmetEnable', 'gourmetMarkSite', 'gourmetResolve', 'gourmetRegenerate']) expect(view).toContain(`"type": "${t}"`);
  });
});
