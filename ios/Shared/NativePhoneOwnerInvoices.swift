import SwiftUI
import UIKit
import PhotosUI
import QuickLook
import UniformTypeIdentifiers

// iPhone の店長・オーナー：請求書・書類（ネイティブ）。Web の /app/invoices（?tab=invoices|inbox|documents）と同じ中身・同じ操作（2026-10-25 Ronnie「101% native」）:
//   請求書     … 未払合計・今月支払予定・期限超過／絞り込み（状態・取引先・費目・年月・期限超過のみ）／一覧（仕訳を見る＝ネイティブの仕訳）／
//                請求書CSV（共有シート）／請求書を登録（添付：ファイル・写真・撮影）／
//                詳細（編集・OCR・添付を見る・コメント・確認待ちへ・承認へ回す・承認・支払予定・支払済み（支払日）・差戻し（理由）。どれも確認してから）
//   保存ボックス … アップロード（複数・重複の確認＝スキップ／続行・完了分をクリア）／見る／仕分け（OCR・種別・店舗・取引先・日付・金額・税額・メモ）
//   書類       … 絞り込み（種別・店舗・年月）／見る／削除（理由必須）
// サーバーは iPad と同じ GET part=invoices ／ POST invoice*（lib/native-modules/invoices.ts。返事の形は変えない）。iPad の画面・型は使わない。
// 詳細・入力のシート：NativePhoneOwnerInvoicesSheets.swift

// MARK: - 中身（サーバーの返事）

struct NPIVOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NPIVChoice: Decodable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct NPIVFilters: Decodable {
    let status: String
    let vendor: String
    let expense: String
    let ym: String
    let overdue: Bool
    let docType: String
    let store: String
}

struct NPIVSummary: Decodable {
    let unpaidTotal: Double
    let scheduledThisMonthTotal: Double
    let overdueCount: Int
    let overdueTotal: Double
}

struct NPIVRow: Decodable, Hashable, Identifiable {
    let id: String
    let status: String
    let statusLabel: String
    let overdue: Bool
    let vendorName: String
    let expenseLabel: String
    let dueLabel: String
    let amount: Double
    let storeLabel: String
    let journaled: Bool
    let journalHref: String?
}

struct NPIVInboxDoc: Decodable, Hashable, Identifiable {
    let id: String
    let fileName: String
    let mimeType: String
    let sub: String
}

struct NPIVDocRow: Decodable, Hashable, Identifiable {
    let id: String
    let docTypeLabel: String
    let fileName: String
    let dateLabel: String
    let vendorLabel: String
    let storeLabel: String
    let amount: Double?
    let ocrStatus: String
    let ocrLabel: String
}

struct NPIVListPayload: Decodable {
    let tab: String
    let canWrite: Bool
    let canApprove: Bool
    let canExport: Bool
    let currentStoreId: String?
    let formStores: [NPIVOption]
    let triageStores: [NPIVOption]
    let vendors: [NPIVOption]
    let accounts: [NPIVOption]
    let filters: NPIVFilters
    let summary: NPIVSummary
    let invoices: [NPIVRow]
    let inbox: [NPIVInboxDoc]
    let documents: [NPIVDocRow]
    let statusOptions: [NPIVChoice]
    let paymentMethodOptions: [NPIVChoice]
    let docTypeOptions: [NPIVChoice]
    let csvPath: String
    let csvName: String
    let inlineMax: Int
    let maxFileSize: Int
}

struct NPIVAttachment: Decodable, Hashable {
    let documentId: String
    let fileName: String
    let mimeType: String
    let ocrStatus: String?
    let ocrLabel: String?
}

struct NPIVComment: Decodable, Hashable, Identifiable {
    let id: String
    let body: String
    let author: String
    let createdLabel: String
}

struct NPIVActionItem: Decodable, Hashable, Identifiable {
    let action: String
    let label: String
    let done: String
    var id: String { action }
}

struct NPIVDetail: Decodable {
    let id: String
    let status: String
    let statusLabel: String
    let vendorName: String
    let storeLabel: String
    let invoiceNo: String?
    let issueDate: String?
    let dueDate: String?
    let issueLabel: String
    let dueLabel: String
    let paidLabel: String
    let amount: Double
    let taxAmount: Double
    let registrationNumber: String?
    let paymentMethod: String?
    let paymentMethodLabel: String?
    let expenseAccountId: String?
    let expenseLabel: String
    let note: String?
    let documentId: String?
    let attachment: NPIVAttachment?
    let comments: [NPIVComment]
    let requiredApprovalRoleLabel: String?
    let canEdit: Bool
    let canComment: Bool
    let actions: [NPIVActionItem]
    let noPermission: Bool
}

struct NPIVDetailPayload: Decodable {
    let detail: NPIVDetail
}

struct NPIVFilePayload: Decodable {
    let url: String
    let mimeType: String
    let fileName: String
}

struct NPIVResult: Decodable {
    let ok: Bool
    let error: String?
    let message: String?
}

struct NPIVDupResult: Decodable {
    let ok: Bool
    let duplicate: Bool?
}

struct NPIVUploadFile: Decodable {
    let filePath: String
    let fileName: String
    let mimeType: String
    let sizeBytes: Int
}

struct NPIVUploadTarget: Decodable {
    let url: String
    let apikey: String?
}

struct NPIVUploadResult: Decodable {
    let ok: Bool
    let error: String?
    let file: NPIVUploadFile?
    let upload: NPIVUploadTarget?
}

struct NPIVExtraction: Decodable {
    let vendor: String?
    let issuedDate: String?
    let dueDate: String?
    let total: Double?
    let tax: Double?
    let registrationNumber: String?
}

struct NPIVOcrResult: Decodable {
    let ok: Bool
    let message: String?
    let extraction: NPIVExtraction?
    let note: String?
}

// MARK: - 読み込み・操作

enum NPIVApi {
    static func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        try await NativeModuleAPI.get(T.self, part: "invoices", query: query)
    }

    /// POST して中身を読む（失敗はサーバーのことばを投げる）
    static func post<T: Decodable>(_ body: [String: Any], as type: T.Type) async throws -> T {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await NativeAPI.shared.send(req, kickPrint: false)
        let head = try JSONDecoder().decode(NativeModuleOK.self, from: data)
        if !head.ok { throw NativeAPIError(message: head.error ?? "操作に失敗しました", useWeb: false) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// 操作して、返事の message を返す（見本のときは送らない）
    static func act(_ body: [String: Any]) async throws -> String? {
        if NativePreview.current != nil { return "見本のため保存していません" }
        let r = try await post(body, as: NPIVResult.self)
        return r.message
    }

    /// ファイルを上げて、Server Action に渡す参照（filePath・fileName・mimeType・sizeBytes）を返す
    ///   3MB まで＝本文で送ってサーバーが上げる ／ それより大きい（20MB まで）＝署名付き URL へ直接 PUT（iPad と同じ）
    static func upload(_ f: NPIVPicked, storeId: String?, inlineMax: Int) async throws -> [String: Any] {
        var body: [String: Any] = [
            "type": "invoiceUpload",
            "fileName": f.name,
            "mimeType": f.mimeType,
            "sizeBytes": f.data.count,
            "storeId": NPIVText.orNull(storeId),
        ]
        if f.data.count <= inlineMax { body["dataBase64"] = f.data.base64EncodedString() }
        let r = try await post(body, as: NPIVUploadResult.self)
        guard let file = r.file else { throw NativeAPIError(message: r.error ?? "アップロードに失敗しました", useWeb: false) }
        if let up = r.upload {
            guard let url = URL(string: up.url) else { throw NativeAPIError(message: "アップロードの準備に失敗しました", useWeb: false) }
            var req = URLRequest(url: url)
            req.httpMethod = "PUT"
            req.timeoutInterval = 180
            req.setValue(f.mimeType, forHTTPHeaderField: "content-type")
            req.setValue("false", forHTTPHeaderField: "x-upsert")
            req.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
            if let key = up.apikey { req.setValue(key, forHTTPHeaderField: "apikey") }
            let (_, response) = try await URLSession.shared.upload(for: req, from: f.data)
            if let http = response as? HTTPURLResponse, http.statusCode >= 300 {
                throw NativeAPIError(message: "ストレージへのアップロードに失敗しました", useWeb: false)
            }
        }
        return ["filePath": file.filePath, "fileName": file.fileName, "mimeType": file.mimeType, "sizeBytes": file.sizeBytes]
    }
}

enum NPIVText {
    static func yen(_ v: Double?) -> String {
        guard let v else { return "—" }
        return NT.yen(Int(v.rounded()))
    }

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// nil・空は JSON の null に
    static func orNull(_ v: String?) -> Any {
        guard let v, !v.isEmpty else { return NSNull() }
        return v
    }

    /// 金額の入力（空は nil、数でなければ -1）
    static func amount(_ s: String) -> Int? {
        let t = trimmed(s.replacingOccurrences(of: ",", with: ""))
        if t.isEmpty { return nil }
        guard let d = NOS.num(t), d.isFinite else { return -1 }
        return Int(d.rounded())
    }

    /// 1200 → "1200"（入力欄）
    static func num(_ v: Double?) -> String {
        guard let v else { return "" }
        return String(Int(v.rounded()))
    }

    /// 年月の選択肢（すべて・今月から 36 か月前まで。選んでいる月が外なら足す）
    static func months(selected: String) -> [(String, String)] {
        let thisMonth = String(NOS.today.prefix(7))
        var out: [(String, String)] = [("", "すべて")]
        for i in 0..<36 {
            let ym = NOS.shiftMonth(thisMonth, -i)
            out.append((ym, NOS.ymLabel(ym)))
        }
        if !selected.isEmpty && !out.contains(where: { $0.0 == selected }) {
            out.insert((selected, NOS.ymLabel(selected)), at: 1)
        }
        return out
    }

    /// 状態の色（Web の INVOICE_STATUS_TONES と同じ系統）
    static func statusColor(_ s: String) -> Color {
        switch s {
        case "review": return NT.warn
        case "pending_approval": return NT.purpleDeep
        case "approved", "scheduled": return NT.purple
        case "paid": return NT.ok
        case "rejected": return NT.danger
        default: return NT.ink3
        }
    }

    /// OCR の色
    static func ocrColor(_ s: String?) -> Color {
        switch s ?? "" {
        case "pending": return NT.warn
        case "done": return NT.ok
        case "failed": return NT.danger
        default: return NT.ink3
        }
    }
}

// MARK: - ファイル（選ぶ・JPEG・見る）

/// 選んだファイル（添付・保存ボックス）
struct NPIVPicked: Identifiable {
    let id = UUID()
    let name: String
    let mimeType: String
    let data: Data
}

final class NPIVPreviewSource: NSObject, QLPreviewControllerDataSource {
    let url: URL
    init(url: URL) { self.url = url }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}

enum NPIVFiles {
    /// Web と同じ：PDF・PNG・JPEG・WebP、1ファイル20MBまで
    static let accepted: [String] = ["application/pdf", "image/png", "image/jpeg", "image/webp"]
    static let pickerTypes: [UTType] = [.pdf, .png, .jpeg, UTType("org.webmproject.webp") ?? .image]

    /// QuickLook の中身（dataSource は弱い参照なので持っておく）
    private static var source: NPIVPreviewSource?

    /// Web の validateAttachedFile と同じ確認
    static func problem(_ f: NPIVPicked, maxSize: Int) -> String? {
        if !accepted.contains(f.mimeType) { return "PDF・PNG・JPEG・WebPのみアップロードできます" }
        if f.data.count > maxSize { return "ファイルサイズは20MBまでです" }
        return nil
    }

    /// ファイルアプリから選んだファイルを読む
    static func read(_ url: URL) -> NPIVPicked? {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let ext = url.pathExtension.lowercased()
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? (ext == "pdf" ? "application/pdf" : "application/octet-stream")
        return NPIVPicked(name: url.lastPathComponent, mimeType: mime, data: data)
    }

    /// 写真・撮影 → JPEG（長い辺 2400px・3MB まで。スキャンと同じ）
    static func photo(_ img: UIImage, index: Int = 0) -> NPIVPicked? {
        guard let d = NOM.jpeg(img.nomUpright()) else { return nil }
        return NPIVPicked(name: "photo_\(Int(Date().timeIntervalSince1970))_\(index + 1).jpg", mimeType: "image/jpeg", data: d)
    }

    /// 写真から選んだもの → JPEG
    static func photos(_ items: [PhotosPickerItem]) async -> [NPIVPicked] {
        var out: [NPIVPicked] = []
        for (i, it) in items.enumerated() {
            if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d), let f = photo(img, index: i) {
                out.append(f)
            }
        }
        return out
    }

    /// 書類のファイルを取ってきて開く（QuickLook：見る・共有・保存・印刷）。Web の「新しいタブで開く」の代わり
    @MainActor
    static func open(documentId: String, onError: @escaping (String) -> Void) async {
        if NativePreview.current != nil { onError("見本ではファイルを開けません"); return }
        let query = ["file": documentId]
        // 署名 URL は 1 時間だけ。端末に残さない
        defer { NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url("invoices", query))) }
        do {
            let f = try await NPIVApi.get(NPIVFilePayload.self, query)
            guard let remote = URL(string: f.url) else { onError("ファイルを開けませんでした"); return }
            let (data, response) = try await URLSession.shared.data(from: remote)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 { onError("ファイルを開けませんでした"); return }
            guard let local = NPACShare.tempFile(f.fileName.isEmpty ? "document" : f.fileName, data: data) else { onError("ファイルを開けませんでした"); return }
            present(local)
        } catch {
            onError(NativeModuleAPI.message(error))
        }
    }

    @MainActor
    static func present(_ url: URL) {
        guard let top = NPACShare.topController() else { return }
        let src = NPIVPreviewSource(url: url)
        source = src
        let vc = QLPreviewController()
        vc.dataSource = src
        top.present(vc, animated: true)
    }
}

// MARK: - 一覧の読み込み・アップロード

enum NPIVTab: String, CaseIterable, Identifiable {
    case invoices, inbox, documents
    var id: String { rawValue }
    var label: String {
        switch self {
        case .invoices: return "請求書"
        case .inbox: return "保存ボックス"
        case .documents: return "書類"
        }
    }
}

/// アップロードの1件（Web の UploadZone の Task と同じ状態）
struct NPIVUploadTask: Identifiable {
    enum Status { case checking, needsConfirm, uploading, success, failed, skipped }
    let id = UUID()
    let file: NPIVPicked?
    let name: String
    var status: Status
    var error: String?

    var label: String {
        switch status {
        case .checking: return "確認中…"
        case .needsConfirm: return "重複の可能性（同じ名前・大きさのファイルがあります）"
        case .uploading: return "アップロード中…"
        case .success: return "保存しました"
        case .failed: return "失敗" + (error.map { "：\($0)" } ?? "")
        case .skipped: return "スキップしました"
        }
    }
}

@MainActor
final class NPIVListModel: ObservableObject {
    @Published var payload: NPIVListPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var loading = false
    /// 最初の読み込みで「Web で」と言われた → この画面を閉じて裏の Web を見せる
    @Published var useWeb = false
    @Published var tab: NPIVTab = .invoices
    @Published var tasks: [NPIVUploadTask] = []

    // 絞り込み（Web の URL の ?status=… と同じ。空は「すべて」）
    @Published var status = ""
    @Published var vendor = ""
    @Published var expense = ""
    @Published var ym = ""
    @Published var overdue = false
    @Published var docType = ""
    /// 書類の店舗（nil＝今の店舗、""＝すべて）
    @Published var store: String?

    init(route: NativeModuleRoute? = nil) {
        if let route {
            tab = NPIVTab(rawValue: route.query("tab") ?? "") ?? .invoices
            status = route.query("status") ?? ""
            vendor = route.query("vendor") ?? ""
            expense = route.query("expense") ?? ""
            ym = route.query("ym") ?? ""
            overdue = route.query("overdue") == "1"
            docType = route.query("docType") ?? ""
            store = route.query("store")
        }
        payload = NativeModuleAPI.cached(NPIVListPayload.self, part: "invoices", query: query)
    }

    var query: [String: String] {
        var q: [String: String] = ["tab": tab.rawValue]
        switch tab {
        case .invoices:
            if !status.isEmpty { q["status"] = status }
            if !vendor.isEmpty { q["vendor"] = vendor }
            if !expense.isEmpty { q["expense"] = expense }
            if !ym.isEmpty { q["ym"] = ym }
            if overdue { q["overdue"] = "1" }
        case .documents:
            if !docType.isEmpty { q["docType"] = docType }
            if let store { q["store"] = store }
            if !ym.isEmpty { q["ym"] = ym }
        case .inbox:
            break
        }
        return q
    }

    func switchTab(_ t: NPIVTab) async {
        guard t != tab else { return }
        tab = t
        // Web のタブのリンク（?tab=…）と同じく、絞り込みはタブごとに空から
        status = ""; vendor = ""; expense = ""; ym = ""; overdue = false; docType = ""; store = nil
        if let c = NativeModuleAPI.cached(NPIVListPayload.self, part: "invoices", query: query) { payload = c }
        await load()
    }

    func load() async {
        let q = query
        if NativePreview.current != nil {
            if let o = NPACSamples.object("invoices", q), let p = NOS.decode(NPIVListPayload.self, o) { payload = p }
            return
        }
        loading = true
        defer { loading = false }
        do {
            let p = try await NPIVApi.get(NPIVListPayload.self, q)
            // 読んでいる間にタブ・絞り込みが変わったら捨てる
            if q == query { payload = p }
            error = nil
        } catch {
            if payload == nil && NPACText.wantsWeb(error) { useWeb = true }
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    // MARK: 保存ボックスのアップロード（Web の UploadZone と同じ流れ：確認 → 重複ならスキップ／続行 → 上げる → 登録）

    func addFiles(_ files: [NPIVPicked]) {
        guard let p = payload else { return }
        var fresh: [NPIVUploadTask] = []
        for f in files {
            if let problem = NPIVFiles.problem(f, maxSize: p.maxFileSize) {
                fresh.append(NPIVUploadTask(file: nil, name: f.name, status: .failed, error: problem))
            } else {
                fresh.append(NPIVUploadTask(file: f, name: f.name, status: .checking, error: nil))
            }
        }
        tasks.append(contentsOf: fresh)
        for t in fresh where t.status == .checking {
            Task { await process(t.id) }
        }
    }

    private func update(_ id: UUID, _ change: (inout NPIVUploadTask) -> Void) {
        guard let i = tasks.firstIndex(where: { $0.id == id }) else { return }
        change(&tasks[i])
    }

    private func process(_ id: UUID) async {
        guard let t = tasks.first(where: { $0.id == id }), let f = t.file else { return }
        if NativePreview.current != nil { update(id) { $0.status = .success }; return }
        do {
            let r = try await NPIVApi.post(["type": "invoiceDupCheck", "fileName": f.name, "sizeBytes": f.data.count], as: NPIVDupResult.self)
            if r.duplicate == true {
                update(id) { $0.status = .needsConfirm }
                return
            }
        } catch {
            // 重複チェックに失敗してもアップロード自体は止めない（Web と同じ）
        }
        await upload(id)
    }

    func upload(_ id: UUID) async {
        guard let t = tasks.first(where: { $0.id == id }), let f = t.file, let p = payload else { return }
        update(id) { $0.status = .uploading; $0.error = nil }
        do {
            let ref = try await NPIVApi.upload(f, storeId: p.currentStoreId, inlineMax: p.inlineMax)
            _ = try await NPIVApi.act(["type": "invoiceInboxCreate", "file": ref])
            update(id) { $0.status = .success }
            await load()
        } catch {
            update(id) { $0.status = .failed; $0.error = NativeModuleAPI.message(error) }
        }
    }

    func skip(_ id: UUID) { update(id) { $0.status = .skipped } }

    func remove(_ id: UUID) { tasks.removeAll { $0.id == id } }

    func clearFinished() {
        tasks.removeAll { $0.status == .success || $0.status == .failed || $0.status == .skipped }
    }

    var uploading: Bool { tasks.contains { $0.status == .checking || $0.status == .uploading } }
    var hasFinished: Bool { tasks.contains { $0.status == .success || $0.status == .failed || $0.status == .skipped } }
}

// MARK: - 画面

/// key "invoices" の画面（NativePhoneOwnerScreen から）
struct NativePhoneInvoicesScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @State private var useWeb = false

    var body: some View {
        NPIVRootView(route: route, onBack: { state.closePhoneOwnerModule() }, onLeave: { NPOCLink.open($0, state: state) }, onWeb: { useWeb = true })
            .modifier(NPOCWebFallback(key: "invoices", useWeb: useWeb, state: state))
    }
}

struct NPIVRootView: View {
    let onBack: () -> Void
    /// ほかの画面（仕訳など）へ。ネイティブがあればネイティブで開く
    let onLeave: (String) -> Void
    let onWeb: () -> Void

    @StateObject private var model: NPIVListModel
    @State private var openId: String?
    @State private var creating = false
    @State private var triage: NPIVInboxDoc?
    @State private var deleting: NOMReasonPrompt?
    @State private var picking = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var camera = false

    init(route: NativeModuleRoute, onBack: @escaping () -> Void, onLeave: @escaping (String) -> Void, onWeb: @escaping () -> Void = {}) {
        self.onBack = onBack
        self.onLeave = onLeave
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NPIVListModel(route: route))
    }

    private var p: NPIVListPayload? { model.payload }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "請求書・書類", subtitle: "Invoices & documents", onBack: onBack, trailing: {
                if model.tab == .invoices && p?.canWrite == true {
                    NPOCBarButton(icon: "plus", label: "登録") { creating = true }
                }
            }) {
                VStack(spacing: 0) {
                    NOSSegment(items: NPIVTab.allCases.map { (key: $0.rawValue, label: $0.label) }, selection: model.tab.rawValue) { key in
                        if let t = NPIVTab(rawValue: key) { Task { await model.switchTab(t) } }
                    }
                    .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 4)
                    if let p {
                        page(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.load() } }
                    }
                }
            }
            if let id = openId {
                NPIVDetailView(invoiceId: id, accounts: p?.accounts ?? [], paymentMethods: p?.paymentMethodOptions ?? [],
                               onBack: { openId = nil },
                               onChanged: { Task { await model.load() } },
                               onLeave: onLeave)
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
            }
            NPHToast(text: $model.toast).zIndex(3)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.22), value: openId)
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .task { await model.load() }
        .onChange(of: model.useWeb) { on in if on { onWeb() } }
        .sheet(isPresented: $creating) {
            if let p {
                NPIVCreateSheet(payload: p, onSaved: { msg in
                    creating = false
                    model.toast = msg
                    Task { await model.load() }
                }, onClose: { creating = false })
            }
        }
        .sheet(item: $triage) { doc in
            NPIVTriageSheet(doc: doc, stores: p?.triageStores ?? [], vendors: p?.vendors ?? [], docTypes: p?.docTypeOptions ?? [],
                            currentStoreId: p?.currentStoreId,
                            onSaved: { msg in
                                triage = nil
                                model.toast = msg
                                Task { await model.load() }
                            },
                            onClose: { triage = nil })
        }
        .sheet(item: $deleting) { pr in
            NOMReasonSheet(prompt: pr, onDone: { deleting = nil })
                .environment(\.colorScheme, .light)
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: NPIVFiles.pickerTypes, allowsMultipleSelection: true) { res in
            if case .success(let urls) = res {
                let files = urls.compactMap { NPIVFiles.read($0) }
                if files.count < urls.count { model.toast = "読み込めないファイルがありました" }
                model.addFiles(files)
            }
        }
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            Task {
                let files = await NPIVFiles.photos(items)
                photoItems = []
                model.addFiles(files)
            }
        }
        .fullScreenCover(isPresented: $camera) {
            NOMCameraPicker { img in
                camera = false
                if let img, let f = NPIVFiles.photo(img) { model.addFiles([f]) }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder private func page(_ p: NPIVListPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                switch model.tab {
                case .invoices: invoicesTab(p)
                case .inbox: inboxTab(p)
                case .documents: documentsTab(p)
                }
            }
            .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 80)
        }
        .refreshable { await model.load() }
    }

    private func reload() { Task { await model.load() } }

    private func preview(_ documentId: String) {
        Task { await NPIVFiles.open(documentId: documentId) { model.toast = $0 } }
    }

    // MARK: 請求書

    @ViewBuilder private func invoicesTab(_ p: NPIVListPayload) -> some View {
        let s = p.summary
        HStack(spacing: 6) {
            NOMStat(label: "未払合計", value: NPIVText.yen(s.unpaidTotal), tone: NT.purpleDeep)
            NOMStat(label: "今月支払予定", value: NPIVText.yen(s.scheduledThisMonthTotal))
            NOMStat(label: "期限超過", value: NPIVText.yen(s.overdueTotal), tone: s.overdueCount > 0 ? NT.danger : NT.ink, sub: "\(s.overdueCount)件")
        }
        if s.overdueCount > 0 && !model.overdue {
            Button {
                model.overdue = true
                reload()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("支払期限を過ぎた請求書が \(s.overdueCount)件・合計 \(NPIVText.yen(s.overdueTotal)) あります。押すと期限超過だけを出します。")
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.dangerBg))
            }
            .buttonStyle(PressableStyle())
        }
        NPACChipScroll(items: [("", "すべて")] + p.statusOptions.map { ($0.value, $0.label) }, selection: model.status) { v in
            model.status = v
            reload()
        }
        NPACMenuRow {
            NOMChip(title: "期限超過のみ", on: model.overdue) {
                model.overdue.toggle()
                reload()
            }
            NPOCMenuChip(label: "取引先", options: [("", "すべて")] + p.vendors.map { ($0.id, $0.name) }, selection: model.vendor) { v in
                model.vendor = v
                reload()
            }
            NPOCMenuChip(label: "費目", options: [("", "すべて")] + p.accounts.map { ($0.id, $0.name) }, selection: model.expense) { v in
                model.expense = v
                reload()
            }
            NPOCMenuChip(label: "発行月", options: NPIVText.months(selected: model.ym), selection: model.ym) { v in
                model.ym = v
                reload()
            }
        }
        HStack(spacing: 8) {
            Text("\(p.invoices.count)件").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            Spacer()
            if p.canExport {
                NPACPill(title: "請求書CSV", icon: "square.and.arrow.up") {
                    NPACShare.csv(p.csvPath, name: p.csvName) { model.toast = $0 }
                }
            }
        }
        .padding(.horizontal, 4)
        if p.invoices.isEmpty {
            NPOCEmpty(icon: "doc.text", title: "該当する請求書はありません", note: p.canWrite ? "絞り込みを変えるか、右上の「＋ 登録」から請求書を登録してください" : "絞り込みを変えてください")
        } else {
            ForEach(p.invoices) { r in invoiceCard(r) }
        }
    }

    private func invoiceCard(_ r: NPIVRow) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Button { openId = r.id } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        NOSBadge(text: r.statusLabel, color: NPIVText.statusColor(r.status))
                        if r.overdue { NOSBadge(text: "期限超過", color: NT.danger) }
                        Spacer(minLength: 4)
                        Text(NPIVText.yen(r.amount)).font(.system(size: 16.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    Text(r.vendorName).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 10) {
                        Label("期限 \(r.dueLabel)", systemImage: "calendar").foregroundColor(r.overdue ? NT.danger : NT.ink2)
                        Label(r.expenseLabel, systemImage: "tag")
                        Label(r.storeLabel, systemImage: "storefront")
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).labelStyle(NOSCompactLabel()).lineLimit(1).minimumScaleFactor(0.8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let href = r.journalHref {
                Button { onLeave(href) } label: {
                    Label("この請求書の仕訳を見る", systemImage: "book").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(npocCard(14))
    }

    // MARK: 保存ボックス

    @ViewBuilder private func inboxTab(_ p: NPIVListPayload) -> some View {
        if p.canWrite { uploadZone }
        Text("ScanSnap等で取り込んだ未仕分けの書類はこちらへ。各書類の「仕分け」から種別・取引先・金額等を入力すると書類一覧へ移動します。")
            .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
        if p.inbox.isEmpty {
            NPOCEmpty(icon: "tray", title: "保存ボックスは空です", note: "撮った写真・PDF をここに上げてから仕分けます")
        } else {
            ForEach(p.inbox) { d in
                HStack(spacing: 10) {
                    Button { preview(d.id) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: d.mimeType == "application/pdf" ? "doc.richtext" : "photo")
                                .font(.system(size: 24)).foregroundColor(NT.ink3).frame(width: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(d.fileName).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                Text(d.sub).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                            }
                            Spacer(minLength: 4)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if p.canWrite {
                        NPACPill(title: "仕分け", filled: true) { triage = d }
                    }
                }
                .padding(12)
                .background(npocCard(14))
            }
        }
    }

    private var uploadZone: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 8) {
                if model.uploading {
                    ProgressView().tint(NT.purple)
                } else {
                    Image(systemName: "icloud.and.arrow.up").font(.system(size: 26)).foregroundColor(NT.ink3)
                }
                Text("ファイル・写真を保存ボックスへ").font(.system(size: 14.5, weight: NT.strong)).foregroundColor(NT.ink)
                Text("PDF・PNG・JPEG・WebP／1ファイル20MBまで／いくつでも").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                HStack(spacing: 8) {
                    uploadButton("ファイル", icon: "folder") { picking = true }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 20, matching: .images) {
                        uploadLabel("写真", icon: "photo.on.rectangle")
                    }
                    uploadButton("撮影", icon: "camera") { camera = true }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(14)
            .background(npocCard(14))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.purple.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))
            if !model.tasks.isEmpty {
                VStack(spacing: 0) {
                    ForEach(model.tasks) { t in taskRow(t) }
                    if model.hasFinished && !model.uploading {
                        HStack {
                            Spacer()
                            NPACPill(title: "完了分をクリア") { model.clearFinished() }
                        }
                        .padding(10)
                    }
                }
                .background(npocCard(14))
            }
        }
    }

    private func uploadLabel(_ title: String, icon: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 18, weight: .bold))
            Text(title).font(.system(size: 12.5, weight: .bold))
        }
        .foregroundColor(NT.purpleDeep)
        .frame(maxWidth: .infinity).frame(height: 58)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }

    private func uploadButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { uploadLabel(title, icon: icon) }
            .buttonStyle(PressableStyle())
    }

    private func taskRow(_ t: NPIVUploadTask) -> some View {
        let color: Color = t.status == .success ? NT.ok : ((t.status == .failed || t.status == .needsConfirm) ? NT.warn : NT.ink3)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Group {
                    switch t.status {
                    case .checking, .uploading: ProgressView().scaleEffect(0.8).tint(NT.purple)
                    case .success: Image(systemName: "checkmark.circle.fill").foregroundColor(NT.ok)
                    case .failed, .needsConfirm: Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NT.warn)
                    case .skipped: Image(systemName: "xmark").foregroundColor(NT.ink3)
                    }
                }
                .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.name).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                    Text(t.label).font(.system(size: 11.5)).foregroundColor(color).lineLimit(2)
                }
                Spacer(minLength: 4)
                if t.status == .failed {
                    Button { model.remove(t.id) } label: {
                        Image(systemName: "xmark.circle").font(.system(size: 18)).foregroundColor(NT.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("消す")
                }
            }
            if t.status == .needsConfirm {
                HStack(spacing: 8) {
                    Spacer()
                    NPACPill(title: "スキップ") { model.skip(t.id) }
                    NPACPill(title: "続けて上げる", filled: true) { Task { await model.upload(t.id) } }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .overlay(alignment: .bottom) { NPACDivider() }
    }

    // MARK: 書類

    @ViewBuilder private func documentsTab(_ p: NPIVListPayload) -> some View {
        let storeSel = model.store ?? p.filters.store
        NPACChipScroll(items: [("", "すべて")] + p.docTypeOptions.map { ($0.value, $0.label) }, selection: model.docType) { v in
            model.docType = v
            reload()
        }
        NPACMenuRow {
            if !p.formStores.isEmpty {
                NPOCMenuChip(label: "店舗", options: [("", "すべて")] + p.formStores.map { ($0.id, $0.name) }, selection: storeSel) { v in
                    model.store = v
                    reload()
                }
            }
            NPOCMenuChip(label: "年月", options: NPIVText.months(selected: model.ym), selection: model.ym) { v in
                model.ym = v
                reload()
            }
        }
        if p.documents.isEmpty {
            NPOCEmpty(icon: "doc", title: "該当する書類はありません", note: "絞り込みを変えてください")
        } else {
            ForEach(p.documents) { r in docCard(r, canDelete: p.canWrite) }
        }
    }

    private func docCard(_ r: NPIVDocRow, canDelete: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                NOSBadge(text: r.docTypeLabel, color: NT.ink2)
                NOSBadge(text: "OCR: \(r.ocrLabel)", color: NPIVText.ocrColor(r.ocrStatus))
                Spacer(minLength: 4)
                Text(NPIVText.yen(r.amount)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            Button { preview(r.id) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "eye").font(.system(size: 12, weight: .bold))
                    Text(r.fileName).font(.system(size: 14, weight: .bold)).lineLimit(1)
                }
                .foregroundColor(NT.purpleDeep)
            }
            .buttonStyle(.plain)
            HStack(spacing: 10) {
                Label(r.dateLabel, systemImage: "calendar")
                Label(r.vendorLabel, systemImage: "building.2")
                Label(r.storeLabel, systemImage: "storefront")
                Spacer(minLength: 0)
            }
            .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).labelStyle(NOSCompactLabel()).lineLimit(1).minimumScaleFactor(0.8)
            if canDelete {
                HStack {
                    Spacer()
                    NPACPill(title: "削除", icon: "trash", tint: NT.danger) {
                        let id = r.id
                        deleting = NOMReasonPrompt(
                            title: "書類を削除",
                            message: "「\(r.fileName)」を削除します。この操作は取り消せません（理由は操作履歴に残ります）。",
                            confirm: "削除する",
                            run: { reason in
                                do {
                                    let msg = try await NPIVApi.act(["type": "invoiceDocDelete", "documentId": id, "reason": reason])
                                    model.toast = msg ?? "書類を削除しました"
                                    await model.load()
                                    return nil
                                } catch {
                                    return NativeModuleAPI.message(error)
                                }
                            }
                        )
                    }
                }
            }
        }
        .padding(12)
        .background(npocCard(14))
    }
}
