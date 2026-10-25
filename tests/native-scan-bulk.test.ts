import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SCAN_BULK_MAX_FILES,
  SCAN_BULK_MAX_LINES,
  parseScanCheck,
  parseScanFile,
  parseScanLines,
  parseScanPlan,
  parseScanReading,
  parseScanRegister,
  parseScanUploadMeta,
  scanBulkOptions,
} from '@/lib/native-scan-bulk';
import { scanFilingChoices } from '@/lib/scan-filing-choices';
import type { ScanReading } from '@/lib/receipt-read';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DOC = '11111111-2222-4333-8444-555555555555';
const TX = '99999999-8888-4777-8666-555555555555';
const R = (p: Partial<ScanReading> = {}): ScanReading => ({ kind: 'receipt', category: null, amount: 3280, date: '2026-10-24', vendorName: '業務スーパー', tax: 298, payment: null, ...p });

describe('まとめて取り込み（iPad）：送られてきた中身の確かめ', () => {
  it('読み取った行：文字列だけ・多すぎる行と長すぎる行は切る', () => {
    expect(parseScanLines(['合計 ¥3,280', 3, null])).toEqual(['合計 ¥3,280', '', '']);
    expect(parseScanLines('合計')).toBeNull();
    expect(parseScanLines(Array(SCAN_BULK_MAX_LINES + 10).fill('a'))).toHaveLength(SCAN_BULK_MAX_LINES);
    expect(parseScanLines(['x'.repeat(900)])?.[0]).toHaveLength(500);
  });

  it('直した読み取り結果：知らない値は null（範囲・空白はサーバーの cleanReading が Web と同じに整える）', () => {
    expect(parseScanReading(R())).toEqual(R());
    expect(parseScanReading({ kind: 'x', category: 'food', amount: '3280', date: 5, vendorName: 'A', tax: 1.5, payment: 'bitcoin' })).toEqual({
      kind: 'receipt',
      category: null,
      amount: null,
      date: null,
      vendorName: 'A',
      tax: null,
      payment: null,
    });
    expect(parseScanReading({ kind: 'bill', category: 'electric', amount: 12000, date: '2026-10-01', vendorName: null, tax: null, payment: 'debit' })).toMatchObject({ kind: 'bill', category: 'electric', payment: 'debit' });
    expect(parseScanReading(null)).toBeNull();
    expect(parseScanReading([1])).toBeNull();
  });

  it('重複チェック：ハッシュは SHA-256 の形だけ（違えば名前＋大きさで見る）', () => {
    const hash = 'ab'.repeat(32);
    expect(parseScanCheck({ hash, fileName: 'a.pdf', sizeBytes: 1234 })).toEqual({ ok: true, value: { hash, fileName: 'a.pdf', sizeBytes: 1234 } });
    expect(parseScanCheck({ hash: 'zz', fileName: 'a.pdf', sizeBytes: 1 })).toEqual({ ok: true, value: { hash: null, fileName: 'a.pdf', sizeBytes: 1 } });
    expect(parseScanCheck({ hash, fileName: '', sizeBytes: 1 }).ok).toBe(false);
    expect(parseScanCheck({ hash, fileName: 'a.pdf', sizeBytes: 0 }).ok).toBe(false);
  });

  it('登録先の案：はじめは行、出し直しは直した内容', () => {
    expect(parseScanPlan({ documentId: DOC, lines: ['合計 ¥310'] })).toEqual({ ok: true, value: { documentId: DOC, lines: ['合計 ¥310'], reading: null } });
    const re = parseScanPlan({ documentId: DOC, reading: R({ amount: 500 }) });
    expect(re.ok && re.value.reading?.amount).toBe(500);
    expect(parseScanPlan({ documentId: 'x', lines: [] }).ok).toBe(false);
    expect(parseScanPlan({ documentId: DOC }).ok).toBe(false);
  });

  it('仕分け：登録先は attach・receipt・bill・keep、出金は UUID', () => {
    expect(parseScanFile({ documentId: DOC, reading: R(), action: 'attach', txId: TX })).toEqual({ ok: true, value: { documentId: DOC, reading: R(), action: 'attach', txId: TX } });
    expect(parseScanFile({ documentId: DOC, reading: R(), action: 'keep' })).toMatchObject({ ok: true, value: { txId: null } });
    expect(parseScanFile({ documentId: DOC, reading: R(), action: 'delete' })).toEqual({ ok: false, error: '登録先が正しくありません' });
    expect(parseScanFile({ documentId: DOC, reading: R(), action: 'attach', txId: '1' }).ok).toBe(false);
    expect(parseScanFile({ documentId: DOC, reading: 'x', action: 'keep' }).ok).toBe(false);
  });

  it('3MB を超えるファイルの直接アップロード：PDF・JPEG・PNG（HEIC・WebP は iPad で JPEG にしてから）', () => {
    expect(parseScanUploadMeta({ fileName: 'a/b.pdf', mimeType: 'application/pdf', sizeBytes: 5_000_000 })).toEqual({ ok: true, value: { fileName: 'a_b.pdf', mimeType: 'application/pdf', sizeBytes: 5_000_000 } });
    expect(parseScanUploadMeta({ fileName: 'a.heic', mimeType: 'image/heic', sizeBytes: 10 }).ok).toBe(false);
    expect(parseScanUploadMeta({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok).toBe(false);
    const hash = 'cd'.repeat(32);
    expect(parseScanRegister({ path: 'org/hq/2026/10/25/u.pdf', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 9, contentHash: hash })).toEqual({
      ok: true,
      value: { path: 'org/hq/2026/10/25/u.pdf', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 9, contentHash: hash },
    });
    expect(parseScanRegister({ path: 'org/../x.pdf', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 9 }).ok).toBe(false);
    expect(parseScanRegister({ path: 'org/x.pdf', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 9, contentHash: 'no' }).ok).toBe(false);
  });

  it('選択肢は Web と同じ並び・同じ名前', () => {
    const o = scanBulkOptions();
    expect(o.receiptPayments.map((p) => p.value)).toEqual(['cash', 'card', 'emoney', 'qr']);
    expect(o.billPayments.map((p) => p.label)).toEqual(['振込', '口座振替', 'クレジットカード', '現金']);
    expect(o.categories).toEqual([
      { value: 'vendor', label: '仕入・経費' },
      { value: 'rent', label: '家賃' },
      { value: 'electric', label: '電気' },
      { value: 'water', label: '水道' },
      { value: 'gas', label: 'ガス' },
    ]);
    expect(SCAN_BULK_MAX_FILES).toBe(50);
  });
});

describe('登録先の選択肢（Web の ConfirmCard と iPad で同じ。lib/scan-filing-choices.ts）', () => {
  const cand = [
    { id: TX, businessDate: '2026-10-24', amount: 3280, label: '食材' },
    { id: DOC, businessDate: '2026-10-23', amount: 3280, label: '出金' },
  ];

  it('現金のレシート：出金ごとに紐付け → レシートとして保存 → あとで', () => {
    const c = scanFilingChoices(R(), { canAttach: true, candidates: cand });
    expect(c.map((x) => x.key)).toEqual([TX, DOC, 'receipt', 'keep']);
    expect(c[0]).toEqual({ key: TX, action: 'attach', txId: TX, label: '10/24 の出金 ¥3,280 に紐付け', sub: '食材' });
    expect(c[2].label).toBe('レシートとして保存（出金に紐付けない）');
    expect(c[3]).toEqual({ key: 'keep', action: 'keep', label: 'あとで（保存ボックスに残す）' });
  });

  it('紐付けられない（権限・本部）ときは出金を出さない', () => {
    expect(scanFilingChoices(R(), { canAttach: false, candidates: cand }).map((x) => x.key)).toEqual(['receipt', 'keep']);
    expect(scanFilingChoices(R(), undefined).map((x) => x.key)).toEqual(['receipt', 'keep']);
  });

  it('カード払いのレシートは出金に紐付けない', () => {
    const c = scanFilingChoices(R({ payment: 'card' }), { canAttach: true, candidates: cand });
    expect(c.map((x) => x.label)).toEqual(['レシートとして保存（クレジットカード払い）', 'あとで（保存ボックスに残す）']);
  });

  it('請求書：仕入先は月払い、家賃・電気・水道・ガスは月次清算', () => {
    expect(scanFilingChoices(R({ kind: 'bill', category: 'vendor' }), null)[0]).toEqual({ key: 'bill', action: 'bill', label: '月払いに登録（仕入先の請求書）' });
    expect(scanFilingChoices(R({ kind: 'bill', category: null }), null)[0].label).toBe('月払いに登録（仕入先の請求書）');
    expect(scanFilingChoices(R({ kind: 'bill', category: 'electric' }), null)[0].label).toBe('月払い：電気（月次清算で反映）');
  });
});

describe('まとめて取り込みのネイティブの配線', () => {
  it('サーバー：part=scanBulk と scanBulk* を registry に登録。権限は Web と同じ', () => {
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('scanBulk: scanBulkGet,');
    expect(registry).toContain('...SCAN_BULK_POST,');
    const mod = read('lib/native-modules/scan-bulk.ts');
    for (const t of ['scanBulkCheck', 'scanBulkUploadUrl', 'scanBulkRegister', 'scanBulkPlan', 'scanBulkFile']) expect(mod).toContain(`  ${t}: `);
    expect(mod).toContain("ctx.disabledFeatures?.has('accounting')");
    expect(mod).toContain("can(ctx.role, 'documents.write')");
    // 読み方は Web と同じ（readScan・planScanFiling・fileScan をそのまま）
    expect(mod).toContain('readScan(p.value.lines, todayJst())');
    expect(mod).toContain('planScanFiling(p.value.documentId, reading)');
    expect(mod).toContain('fileScan(p.value.documentId, p.value.reading');
  });

  it('アップロードは今までの scanUpload を広げて使う（PDF・contentHash・その日のフォルダ）', () => {
    const route = read('app/api/app/v1/pos/route.ts');
    expect(route).toContain('sa.dayFolder');
    expect(route).toContain('nativeScanDayPath(ctx.organizationId, storeId, sa.mimeType, crypto.randomUUID(), todayJst())');
    expect(route).toContain('contentHash: sa.contentHash');
    expect(route).toContain('documentId: id');
  });

  it('Web の ConfirmCard も同じ選択肢・同じ選べるもの（lib）を使う', () => {
    const web = read('components/scan/scan-bulk-import.tsx');
    expect(web).toContain('scanFilingChoices(r, plan)');
    expect(web).toContain('SCAN_RECEIPT_PAYMENTS as RECEIPT_PAYMENTS');
  });

  it('iPad：/app/scan#scan-bulk をネイティブで開く（スキャンのボタン・Web の道の両方）', () => {
    const app = read('ios/Shared/AppState.swift');
    expect(app).toContain('url.path == "/app/scan" && url.fragment == "scan-bulk"');
    expect(app).toContain('func openNativeScanBulk()');
    expect(app).not.toContain('url.path == "/app/scan" && url.fragment != "scan-bulk"');
    expect(read('ios/Shared/NativeModules.swift')).toContain('case "scanBulk": NativeScanBulkView(');
    expect(read('ios/Shared/NativePreview.swift')).toContain('onBulk: { state.openNativeScanBulk() }');
    expect(read('ios/Shared/NativeScanView.swift')).toContain('if let onBulk { onBulk() } else { onWeb("/app/scan#scan-bulk") }');
  });

  it('中身（iPad・iPhone で同じ）：iOS 16 で動く・Vision は perform の後に結果を読む・文字の読み方はサーバー', () => {
    const kit = read('ios/Shared/NativeScanBulkKit.swift');
    expect(kit).toContain('part: "scanBulk"');
    expect(kit).toContain('"type": "scanBulkPlan"');
    expect(kit).toContain('"type": "scanBulkFile"');
    expect(kit).toContain('"type": "scanUpload"');
    expect(kit).toContain('"type": "scanBulkCheck"');
    expect(kit).toContain('"type": "scanBulkUploadUrl"');
    expect(kit).toContain('"type": "scanBulkRegister"');
    expect(kit).toContain('"dayFolder": true');
    expect(kit).toContain('SHA256.hash(data:');
    expect(kit).toContain('req.recognitionLanguages = ["ja-JP", "en-US"]');
    expect(kit).toContain('req.recognitionLevel = .accurate');
    expect(kit).toContain('try handler.perform([req])');
    expect(kit).toContain('req.results');
    // ファイルアプリ（ScanSnap Home →「ファイルに保存」）と写真アプリ（「写真に保存」）の両方から何枚でも
    expect(kit).toContain('func run(files urls: [URL]) async');
    expect(kit).toContain('func run(photos picks: [PhotosPickerItem]) async');
    expect(kit).toContain('loadTransferable(type: Data.self)');
    // 見本（NativePreview）のときは通信しない
    expect(kit).toContain('if NativePreview.current != nil { return }');
    // 完了ハンドラ付きの VNRecognizeTextRequest は使わない（continuation を 2 回 resume しない）
    expect(kit).not.toMatch(/VNRecognizeTextRequest\s*\{/);
    expect(kit).not.toMatch(/VNRecognizeTextRequest\(completionHandler/);
    // 金額・日付の読み方を Swift に持たない（readScan はサーバーだけ）
    expect(kit).not.toContain('合計');
  });

  it('iPad・iPhone の画面：ファイル・写真を複数選ぶ・iOS 16 で動く', () => {
    for (const p of ['ios/Shared/NativeScanBulkView.swift', 'ios/Shared/NativePhoneOwnerScanBulk.swift']) {
      const v = read(p);
      expect(v).toContain('.fileImporter(isPresented: $showFiles, allowedContentTypes: NSBFile.types, allowsMultipleSelection: true)');
      expect(v).toContain('PhotosPicker(selection: $picks, maxSelectionCount: info.maxFiles, matching: .images)');
      expect(v).toContain('model.registerAll()');
      expect(v).toContain('model.progress');
      expect(v).not.toMatch(/onChange\(of: [^)]*\) \{ _?[a-zA-Z]*, [a-zA-Z_]* in/);
      expect(v).not.toContain('UnevenRoundedRectangle');
      expect(v).not.toContain('ContentUnavailableView');
      expect(v).not.toContain('合計');
    }
    expect(read('ios/Shared/NativeScanBulkView.swift')).toContain('NativeTopBar(');
    expect(read('ios/Shared/NativePhoneOwnerScanBulk.swift')).toContain('NPHTopBar(');
  });

  it('iPhone：/app/scan#scan-bulk をネイティブで開く（スキャンの画面はそのまま）', () => {
    const reg = read('ios/Shared/NativePhoneOwner.swift');
    expect(reg).toContain('if url.fragment == "scan-bulk" { return url.path == "/app/scan" ? NativeModuleRoute(key: "scanBulk"');
    expect(reg).not.toContain('if url.fragment == "scan-bulk" || url.path.hasSuffix("/export") { return nil }');
    expect(reg).toContain('case "scanBulk": NativePhoneOwnerScanBulkScreen(route: route)');
    expect(reg).toContain('case "scan": NativePhoneOwnerScanScreen(route: route)');
    expect(read('ios/Shared/NativePhoneOwnerScanBulk.swift')).toContain('NPOCWebFallback(key: "scanBulk"');
  });

  it('見本：scanBulk（iPad）・phoneOwnerScanBulk（iPhone）', () => {
    const prev = read('ios/Shared/NativePreview.swift');
    expect(prev).toContain('case scanBulk, phoneOwnerScanBulk');
    expect(prev).toContain('case .scanBulk, .phoneOwnerScanBulk: NativeScanBulkPreview(kind: kind.rawValue)');
    const sample = read('ios/Shared/NativeScanBulkPreview.swift');
    expect(sample).toContain('TENPO ONE 新宿店');
    expect(sample).toContain('NativePhoneOwnerScanBulkView(model: model');
    expect(sample).toContain('NativeScanBulkView(model: model');
  });
});
