import SwiftUI
import UIKit
import PhotosUI
import QuickLook
import UniformTypeIdentifiers

// 請求書・書類のネイティブ。Web の /app/invoices と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   請求書     … 未払合計・今月支払予定・期限超過／絞り込み（状態・取引先・費目・年月・期限超過のみ）／一覧（仕訳を見る）／
//                請求書CSV（共有シート）／請求書を登録（添付：ファイル・写真・撮影）／
//                詳細（編集・OCR・添付のプレビュー・コメント・確認待ちへ・承認へ回す・承認・支払予定・支払済み・差戻し）
//   保存ボックス … アップロード（複数・重複の確認＝スキップ／続行・完了分をクリア）／プレビュー／仕分け（OCR・種別・店舗・取引先・日付・金額・税額・メモ）
//   書類       … 絞り込み（種別・店舗・年月）／プレビュー／削除（理由必須）
// サーバーは lib/native-modules/invoices.ts（読み込みは Web と同じ lib/invoices-server.ts、操作は Web と同じ Server Action）。
// 添付は 3MB までは本文で送ってサーバーが上げる、それより大きいもの（20MB まで）は署名付き URL へ iPad から直接上げる。

// MARK: - 中身（サーバーの返事）

struct NInvOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NInvChoice: Decodable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct NInvFilters: Decodable {
    let status: String
    let vendor: String
    let expense: String
    let ym: String
    let overdue: Bool
    let docType: String
    let store: String
}

struct NInvSummary: Decodable {
    let unpaidTotal: Double
    let scheduledThisMonthTotal: Double
    let overdueCount: Int
    let overdueTotal: Double
}

struct NInvRow: Decodable, Hashable, Identifiable {
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

struct NInvInboxDoc: Decodable, Hashable, Identifiable {
    let id: String
    let fileName: String
    let mimeType: String
    let sub: String
}

struct NInvDocRow: Decodable, Hashable, Identifiable {
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

struct NInvListPayload: Decodable {
    let ok: Bool
    let tab: String
    let canWrite: Bool
    let canApprove: Bool
    let canExport: Bool
    let currentStoreId: String?
    let formStores: [NInvOption]
    let triageStores: [NInvOption]
    let vendors: [NInvOption]
    let accounts: [NInvOption]
    let filters: NInvFilters
    let summary: NInvSummary
    let invoices: [NInvRow]
    let inbox: [NInvInboxDoc]
    let documents: [NInvDocRow]
    let statusOptions: [NInvChoice]
    let paymentMethodOptions: [NInvChoice]
    let docTypeOptions: [NInvChoice]
    let csvPath: String
    let csvName: String
    let inlineMax: Int
    let maxFileSize: Int
}

struct NInvAttachment: Decodable, Hashable {
    let documentId: String
    let fileName: String
    let mimeType: String
    let ocrStatus: String?
    let ocrLabel: String?
}

struct NInvComment: Decodable, Hashable, Identifiable {
    let id: String
    let body: String
    let author: String
    let createdLabel: String
}

struct NInvActionItem: Decodable, Hashable, Identifiable {
    let action: String
    let label: String
    let done: String
    var id: String { action }
}

struct NInvDetail: Decodable {
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
    let attachment: NInvAttachment?
    let comments: [NInvComment]
    let requiredApprovalRoleLabel: String?
    let canEdit: Bool
    let canComment: Bool
    let actions: [NInvActionItem]
    let noPermission: Bool
}

struct NInvDetailPayload: Decodable {
    let ok: Bool
    let detail: NInvDetail
}

struct NInvFilePayload: Decodable {
    let ok: Bool
    let url: String
    let mimeType: String
    let fileName: String
}

struct NInvResult: Decodable {
    let ok: Bool
    let error: String?
    let message: String?
}

struct NInvDupResult: Decodable {
    let ok: Bool
    let duplicate: Bool?
}

struct NInvUploadFile: Decodable {
    let filePath: String
    let fileName: String
    let mimeType: String
    let sizeBytes: Int
}

struct NInvUploadTarget: Decodable {
    let url: String
    let apikey: String?
}

struct NInvUploadResult: Decodable {
    let ok: Bool
    let error: String?
    let file: NInvUploadFile?
    let upload: NInvUploadTarget?
}

struct NInvExtraction: Decodable {
    let vendor: String?
    let issuedDate: String?
    let dueDate: String?
    let total: Double?
    let tax: Double?
    let registrationNumber: String?
}

struct NInvOcrResult: Decodable {
    let ok: Bool
    let message: String?
    let extraction: NInvExtraction?
    let note: String?
}

// MARK: - 読み込み・操作

enum NInvAPI {
    static func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        try await NativeModuleAPI.get(T.self, part: "invoices", query: query)
    }

    /// POST して中身を読む（失敗はサーバーのことばを投げる。NativeAPI.send が 4xx の error を読む）
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

    /// 操作して、返事の message を返す
    static func act(_ body: [String: Any]) async throws -> String? {
        let r = try await post(body, as: NInvResult.self)
        return r.message
    }

    /// ファイルを上げて、Server Action に渡す参照（filePath・fileName・mimeType・sizeBytes）を返す
    static func upload(_ f: NInvPickedFile, storeId: String?, inlineMax: Int) async throws -> [String: Any] {
        var body: [String: Any] = [
            "type": "invoiceUpload",
            "fileName": f.name,
            "mimeType": f.mimeType,
            "sizeBytes": f.data.count,
            "storeId": NInvText.orNull(storeId),
        ]
        if f.data.count <= inlineMax { body["dataBase64"] = f.data.base64EncodedString() }
        let r = try await post(body, as: NInvUploadResult.self)
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

enum NInvText {
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
        guard let d = Double(t), d.isFinite else { return -1 }
        return Int(d.rounded())
    }

    /// 1200 → "1200"（入力欄）
    static func num(_ v: Double?) -> String {
        guard let v else { return "" }
        return String(Int(v.rounded()))
    }

    /// 'YYYY-MM' → 'YYYY年M月'
    static func monthLabel(_ ym: String) -> String {
        let parts = ym.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return ym }
        return "\(parts[0])年\(parts[1])月"
    }

    /// 年月の選択肢（すべて・今月から 36 か月前まで。選んでいる月が外なら足す）
    static func months(selected: String) -> [NInvChoice] {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo") ?? .current
        let c = cal.dateComponents([.year, .month], from: Date())
        var y = c.year ?? 2026
        var m = c.month ?? 1
        var out: [NInvChoice] = [NInvChoice(value: "", label: "すべて")]
        for _ in 0..<36 {
            let v = String(format: "%04d-%02d", y, m)
            out.append(NInvChoice(value: v, label: "\(y)年\(m)月"))
            m -= 1
            if m == 0 { m = 12; y -= 1 }
        }
        if !selected.isEmpty && !out.contains(where: { $0.value == selected }) {
            out.insert(NInvChoice(value: selected, label: monthLabel(selected)), at: 1)
        }
        return out
    }

    /// 状態の色（Web の INVOICE_STATUS_TONES と同じ系統）
    static func statusColor(_ s: String) -> Color {
        switch s {
        case "review": return NT.warn
        case "pending_approval": return NFColor.royal
        case "approved", "scheduled": return NT.purple
        case "paid": return NT.ok
        case "rejected": return NT.danger
        default: return NT.ink3
        }
    }

    /// OCR の色（Web の OCR_STATUS_TONES と同じ系統）
    static func ocrColor(_ s: String?) -> Color {
        switch s ?? "" {
        case "pending": return NT.warn
        case "done": return NT.ok
        case "failed": return NT.danger
        default: return NT.ink3
        }
    }
}

// MARK: - ファイル（選ぶ・JPEG・プレビュー・共有）

/// 選んだファイル（添付・保存ボックス）
struct NInvPickedFile: Identifiable {
    let id = UUID()
    let name: String
    let mimeType: String
    let data: Data
}

final class NInvPreviewSource: NSObject, QLPreviewControllerDataSource {
    let url: URL
    init(url: URL) { self.url = url }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}

enum NInvFiles {
    /// Web と同じ：PDF・PNG・JPEG・WebP、1ファイル20MBまで
    static let accepted: [String] = ["application/pdf", "image/png", "image/jpeg", "image/webp"]
    static let pickerTypes: [UTType] = [.pdf, .png, .jpeg, UTType("org.webmproject.webp") ?? .image]

    /// QuickLook の中身（dataSource は弱い参照なので持っておく）
    private static var source: NInvPreviewSource?

    /// Web の validateAttachedFile と同じ確認
    static func problem(_ f: NInvPickedFile, maxSize: Int) -> String? {
        if !accepted.contains(f.mimeType) { return "PDF・PNG・JPEG・WebPのみアップロードできます" }
        if f.data.count > maxSize { return "ファイルサイズは20MBまでです" }
        return nil
    }

    /// ファイルアプリから選んだファイルを読む
    static func read(_ url: URL) -> NInvPickedFile? {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let ext = url.pathExtension.lowercased()
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? (ext == "pdf" ? "application/pdf" : "application/octet-stream")
        return NInvPickedFile(name: url.lastPathComponent, mimeType: mime, data: data)
    }

    /// 写真・撮影 → JPEG（長い辺 2400px・3MB まで。スキャンと同じ）
    static func photo(_ img: UIImage, index: Int = 0) -> NInvPickedFile? {
        let maxSide: CGFloat = 2400
        let s = img.size
        guard s.width > 0, s.height > 0 else { return nil }
        let scale = min(1, maxSide / max(s.width, s.height))
        let size = CGSize(width: floor(s.width * scale), height: floor(s.height * scale))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        var q: CGFloat = 0.8
        while q >= 0.3 {
            if let d = resized.jpegData(compressionQuality: q), d.count <= 3_000_000 {
                let name = "photo_\(Int(Date().timeIntervalSince1970))_\(index + 1).jpg"
                return NInvPickedFile(name: name, mimeType: "image/jpeg", data: d)
            }
            q -= 0.15
        }
        return nil
    }

    /// 写真から選んだもの → JPEG
    static func photos(_ items: [PhotosPickerItem]) async -> [NInvPickedFile] {
        var out: [NInvPickedFile] = []
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
        let query = ["file": documentId]
        // 署名 URL は 1 時間だけ。iPad に残さない
        defer { NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url("invoices", query))) }
        do {
            let f = try await NInvAPI.get(NInvFilePayload.self, query)
            guard let remote = URL(string: f.url) else { onError("プレビューを開けませんでした"); return }
            let (data, response) = try await URLSession.shared.data(from: remote)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 { onError("プレビューを開けませんでした"); return }
            let name = f.fileName.replacingOccurrences(of: "[/:\\\\]", with: "_", options: .regularExpression)
            guard let local = NLShare.tempFile(name.isEmpty ? "document" : name, data: data) else { onError("プレビューを開けませんでした"); return }
            present(local)
        } catch {
            onError(NativeModuleAPI.message(error))
        }
    }

    @MainActor
    static func present(_ url: URL) {
        guard let top = topController() else { NLShare.present(url: url); return }
        let src = NInvPreviewSource(url: url)
        source = src
        let vc = QLPreviewController()
        vc.dataSource = src
        top.present(vc, animated: true)
    }

    @MainActor
    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first,
              var top = window.rootViewController else { return nil }
        while let presented = top.presentedViewController { top = presented }
        return top
    }
}

// MARK: - 入口（Web の道 → 画面）

enum NInvTab: String, CaseIterable, Identifiable {
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
struct NInvUploadTask: Identifiable {
    enum Status { case checking, needsConfirm, uploading, success, failed, skipped }
    let id = UUID()
    let file: NInvPickedFile?
    let name: String
    var status: Status
    var error: String?

    var label: String {
        switch status {
        case .checking: return "確認中…"
        case .needsConfirm: return "重複の可能性"
        case .uploading: return "アップロード中…"
        case .success: return "成功"
        case .failed: return "失敗" + (error.map { "：\($0)" } ?? "")
        case .skipped: return "スキップ済み"
        }
    }
}

@MainActor
final class NInvListModel: ObservableObject {
    @Published var payload: NInvListPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var tab: NInvTab = .invoices
    @Published var tasks: [NInvUploadTask] = []

    // 絞り込み（Web の URL の ?status=… と同じ。空は「すべて」）
    @Published var status = ""
    @Published var vendor = ""
    @Published var expense = ""
    @Published var ym = ""
    @Published var overdue = false
    @Published var docType = ""
    /// 書類の店舗（nil＝今の店舗、""＝すべて）
    @Published var store: String?

    init(route: NativeModuleRoute) {
        apply(route: route)
    }

    func apply(route: NativeModuleRoute) {
        let t = route.query("tab") ?? ""
        tab = NInvTab(rawValue: t) ?? .invoices
        status = route.query("status") ?? ""
        vendor = route.query("vendor") ?? ""
        expense = route.query("expense") ?? ""
        ym = route.query("ym") ?? ""
        overdue = route.query("overdue") == "1"
        docType = route.query("docType") ?? ""
        store = route.query("store")
        payload = NativeModuleAPI.cached(NInvListPayload.self, part: "invoices", query: query)
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

    func switchTab(_ t: NInvTab) async {
        guard t != tab else { return }
        tab = t
        // Web のタブのリンク（?tab=…）と同じく、絞り込みはタブごとに空から
        status = ""; vendor = ""; expense = ""; ym = ""; overdue = false; docType = ""; store = nil
        payload = NativeModuleAPI.cached(NInvListPayload.self, part: "invoices", query: query)
        await load()
    }

    func load() async {
        let q = query
        do {
            let p = try await NInvAPI.get(NInvListPayload.self, q)
            // 読んでいる間にタブ・絞り込みが変わったら捨てる
            if q == query { payload = p }
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    // MARK: 保存ボックスのアップロード（Web の UploadZone と同じ流れ：確認 → 重複ならスキップ／続行 → 上げる → 登録）

    func addFiles(_ files: [NInvPickedFile]) {
        guard let p = payload else { return }
        var fresh: [NInvUploadTask] = []
        for f in files {
            if let problem = NInvFiles.problem(f, maxSize: p.maxFileSize) {
                fresh.append(NInvUploadTask(file: nil, name: f.name, status: .failed, error: problem))
            } else {
                fresh.append(NInvUploadTask(file: f, name: f.name, status: .checking, error: nil))
            }
        }
        tasks.append(contentsOf: fresh)
        for t in fresh where t.status == .checking {
            Task { await process(t.id) }
        }
    }

    private func update(_ id: UUID, _ change: (inout NInvUploadTask) -> Void) {
        guard let i = tasks.firstIndex(where: { $0.id == id }) else { return }
        change(&tasks[i])
    }

    private func process(_ id: UUID) async {
        guard let t = tasks.first(where: { $0.id == id }), let f = t.file else { return }
        do {
            let r = try await NInvAPI.post(["type": "invoiceDupCheck", "fileName": f.name, "sizeBytes": f.data.count], as: NInvDupResult.self)
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
            let ref = try await NInvAPI.upload(f, storeId: p.currentStoreId, inlineMax: p.inlineMax)
            _ = try await NInvAPI.act(["type": "invoiceInboxCreate", "file": ref])
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

struct NInvTarget: Identifiable, Hashable {
    let id: String
}

struct NativeInvoicesView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    /// ほかの画面（仕訳など）へ。ネイティブがあればネイティブで開く
    let onWeb: (String) -> Void

    @StateObject private var model: NInvListModel
    @State private var detail: NInvTarget?
    @State private var creating = false
    @State private var triage: NInvInboxDoc?
    @State private var deleting: NInvDocRow?
    @State private var picking = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var camera = false

    init(route: NativeModuleRoute, onHome: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.route = route
        self.onHome = onHome
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NInvListModel(route: route))
    }

    private var p: NInvListPayload? { model.payload }

    var body: some View {
        NPRPage(title: "請求書・書類", onBack: onHome, loaded: p != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p { pageBody(p) }
        }
        .task { await model.load() }
        .onChange(of: route) { r in
            model.apply(route: r)
            Task { await model.load() }
        }
        .sheet(item: $detail) { d in
            NInvDetailSheet(
                invoiceId: d.id,
                accounts: p?.accounts ?? [],
                paymentMethods: p?.paymentMethodOptions ?? [],
                onChanged: { Task { await model.load() } },
                onClose: { detail = nil }
            )
        }
        .sheet(isPresented: $creating) {
            if let p {
                NInvCreateSheet(
                    payload: p,
                    onSaved: { msg in creating = false; model.toast = msg; Task { await model.load() } },
                    onClose: { creating = false }
                )
            }
        }
        .sheet(item: $triage) { doc in
            NInvTriageSheet(
                doc: doc,
                stores: p?.triageStores ?? [],
                vendors: p?.vendors ?? [],
                docTypes: p?.docTypeOptions ?? [],
                currentStoreId: p?.currentStoreId,
                onSaved: { msg in triage = nil; model.toast = msg; Task { await model.load() } },
                onClose: { triage = nil }
            )
        }
        .sheet(item: $deleting) { doc in
            NInvReasonSheet(
                title: "書類を削除",
                message: "「\(doc.fileName)」を削除します。この操作は取り消せません。",
                confirmLabel: "削除する",
                onCancel: { deleting = nil },
                onConfirm: { reason in
                    do {
                        let msg = try await NInvAPI.act(["type": "invoiceDocDelete", "documentId": doc.id, "reason": reason])
                        deleting = nil
                        model.toast = msg ?? "書類を削除しました"
                        await model.load()
                        return nil
                    } catch {
                        return NativeModuleAPI.message(error)
                    }
                }
            )
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: NInvFiles.pickerTypes, allowsMultipleSelection: true) { res in
            if case .success(let urls) = res {
                let files = urls.compactMap { NInvFiles.read($0) }
                if files.count < urls.count { model.toast = "読み込めないファイルがありました" }
                model.addFiles(files)
            }
        }
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            Task {
                let files = await NInvFiles.photos(items)
                photoItems = []
                model.addFiles(files)
            }
        }
        .fullScreenCover(isPresented: $camera) {
            SCNCameraPicker { img in
                camera = false
                if let img, let f = NInvFiles.photo(img) { model.addFiles([f]) }
            }
            .ignoresSafeArea()
        }
    }

    // MARK: 画面

    @ViewBuilder private func pageBody(_ p: NInvListPayload) -> some View {
        HStack(spacing: 12) {
            tabs
            Spacer(minLength: 8)
            if model.tab == .invoices {
                if p.canExport {
                    NPRButton(text: "請求書CSV", icon: "square.and.arrow.down") { exportCsv(p) }
                }
                if p.canWrite {
                    NPRButton(text: "請求書を登録", icon: "plus", kind: .primary) { creating = true }
                }
            }
        }
        Text("請求書の承認・支払管理と、書類（領収書・納品書等）の保存を行います")
            .font(.system(size: 13)).foregroundColor(NT.ink3)
        switch model.tab {
        case .invoices: invoicesTab(p)
        case .inbox: inboxTab(p)
        case .documents: documentsTab(p)
        }
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach(NInvTab.allCases) { t in
                Button { Task { await model.switchTab(t) } } label: {
                    Text(t.label).font(.system(size: 15, weight: .bold))
                        .foregroundColor(model.tab == t ? Color.white : NT.ink2)
                        .padding(.horizontal, 18).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(model.tab == t ? NT.purple : Color.clear))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func reload() { Task { await model.load() } }

    /// 請求書CSV（Web の「請求書CSV」と同じファイルを共有シートへ。会計の CSV 出力と同じ仕組み）
    private func exportCsv(_ p: NInvListPayload) {
        NAccExport.csv(p.csvPath, name: p.csvName) { model.toast = $0 }
    }

    private func preview(_ documentId: String) {
        Task { await NInvFiles.open(documentId: documentId) { model.toast = $0 } }
    }

    // MARK: 請求書

    @ViewBuilder private func invoicesTab(_ p: NInvListPayload) -> some View {
        let s = p.summary
        HStack(spacing: 12) {
            NAccStat(label: "未払合計", value: Int(s.unpaidTotal.rounded()), tone: NT.purple)
            NAccStat(label: "今月支払予定合計", value: Int(s.scheduledThisMonthTotal.rounded()))
            NAccStat(label: "期限超過合計", value: Int(s.overdueTotal.rounded()), tone: s.overdueCount > 0 ? NT.danger : NT.ink, note: "\(s.overdueCount)件")
        }
        if s.overdueCount > 0 {
            HStack(spacing: 10) {
                Text("支払期限を過ぎた請求書が \(s.overdueCount)件・合計 \(NInvText.yen(s.overdueTotal)) あります。至急確認してください。")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button { model.overdue = true; reload() } label: {
                    Text("期限超過のみ表示").font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).underline()
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.dangerBg))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.danger.opacity(0.3), lineWidth: 1))
        }
        invoiceFilters(p)
        invoiceTable(p)
    }

    private func invoiceFilters(_ p: NInvListPayload) -> some View {
        let all = NInvChoice(value: "", label: "すべて")
        return NAccFilterBar {
            NInvMenu(label: "状態", options: [all] + p.statusOptions, selection: model.status) { model.status = $0; reload() }
            NInvMenu(label: "取引先", options: [all] + p.vendors.map { NInvChoice(value: $0.id, label: $0.name) }, selection: model.vendor) { model.vendor = $0; reload() }
            NInvMenu(label: "費目", options: [all] + p.accounts.map { NInvChoice(value: $0.id, label: $0.name) }, selection: model.expense) { model.expense = $0; reload() }
            NInvMenu(label: "年月（発行日）", options: NInvText.months(selected: model.ym), selection: model.ym) { model.ym = $0; reload() }
            NInvCheck(label: "期限超過のみ", on: model.overdue) { model.overdue.toggle(); reload() }
        }
    }

    private func invoiceTable(_ p: NInvListPayload) -> some View {
        let rows = p.invoices
        return NAccCard {
            if rows.isEmpty {
                NPREmpty(title: "該当する請求書はありません", message: "絞り込み条件を変更するか、新しい請求書を登録してください")
            } else {
                NAccTableHead(cells: [("状態", 150, false), ("取引先", nil, false), ("費目", 120, false), ("支払期限", 110, false), ("金額", 110, true), ("店舗", 120, false), ("仕訳", 64, false)])
                ForEach(rows) { r in
                    NInvInvoiceLine(row: r, onOpen: { detail = NInvTarget(id: r.id) }, onJournal: { href in onWeb(href) })
                }
            }
        }
    }

    // MARK: 保存ボックス

    @ViewBuilder private func inboxTab(_ p: NInvListPayload) -> some View {
        if p.canWrite { uploadZone(p) }
        Text("ScanSnap等で取り込んだ未仕分けの書類はこちらへアップロードしてください。各書類の「仕分け」から種別・取引先・金額等を入力すると書類一覧へ移動します。")
            .font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        NAccCard {
            if p.inbox.isEmpty {
                NPREmpty(title: "保存ボックスは空です", message: "ScanSnap等で取り込んだ未仕分けの書類をここへアップロードします")
            } else {
                ForEach(p.inbox) { d in
                    HStack(spacing: 12) {
                        Button { preview(d.id) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: d.mimeType == "application/pdf" ? "doc.richtext" : "photo")
                                    .font(.system(size: 26)).foregroundColor(NT.ink3).frame(width: 36)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(d.fileName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                    Text(d.sub).font(.system(size: 12.5)).foregroundColor(NT.ink3)
                                }
                                Spacer(minLength: 8)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableStyle())
                        if p.canWrite {
                            NPRButton(text: "仕分け", kind: .primary) { triage = d }
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                }
            }
        }
    }

    private func uploadZone(_ p: NInvListPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(spacing: 10) {
                if model.uploading {
                    ProgressView().tint(NT.purple)
                } else {
                    Image(systemName: "icloud.and.arrow.up").font(.system(size: 30)).foregroundColor(NT.ink3)
                }
                Text("ファイル・写真を選んで保存ボックスへ").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                Text("PDF・PNG・JPEG・WebP／1ファイル20MBまで／複数選択可").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                HStack(spacing: 10) {
                    NPRButton(text: "ファイルを選択", icon: "folder", kind: .primary) { picking = true }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 20, matching: .images) {
                        HStack(spacing: 6) {
                            Image(systemName: "photo.on.rectangle")
                            Text("写真から選ぶ")
                        }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                        .padding(.horizontal, 16).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        NPRButton(text: "撮影する", icon: "camera") { camera = true }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))

            if !model.tasks.isEmpty {
                NAccCard {
                    ForEach(model.tasks) { t in NInvTaskLine(task: t, model: model) }
                    if model.hasFinished && !model.uploading {
                        HStack {
                            Spacer()
                            NPRButton(text: "完了分をクリア") { model.clearFinished() }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                    }
                }
            }
        }
    }

    // MARK: 書類

    @ViewBuilder private func documentsTab(_ p: NInvListPayload) -> some View {
        documentFilters(p)
        NAccCard {
            if p.documents.isEmpty {
                NPREmpty(title: "該当する書類はありません", message: "絞り込み条件を変更してください")
            } else {
                NAccTableHead(cells: [("種別", 90, false), ("ファイル名", nil, false), ("日付", 100, false), ("取引先", 130, false), ("店舗", 110, false), ("金額", 100, true), ("OCR", 120, false), ("", 70, false)])
                ForEach(p.documents) { r in
                    NInvDocLine(row: r, canDelete: p.canWrite, onPreview: { preview(r.id) }, onDelete: { deleting = r })
                }
            }
        }
    }

    private func documentFilters(_ p: NInvListPayload) -> some View {
        let all = NInvChoice(value: "", label: "すべて")
        let storeSel = model.store ?? p.filters.store
        return NAccFilterBar {
            NInvMenu(label: "種別", options: [all] + p.docTypeOptions, selection: model.docType) { model.docType = $0; reload() }
            if !p.formStores.isEmpty {
                NInvMenu(label: "店舗", options: [all] + p.formStores.map { NInvChoice(value: $0.id, label: $0.name) }, selection: storeSel) { model.store = $0; reload() }
            }
            NInvMenu(label: "年月", options: NInvText.months(selected: model.ym), selection: model.ym) { model.ym = $0; reload() }
        }
    }
}

// MARK: - 共通の部品

/// 絞り込みの選ぶボタン（上に小さい名前）
struct NInvMenu: View {
    let label: String
    let options: [NInvChoice]
    let selection: String
    let pick: (String) -> Void

    private var current: String { options.first(where: { $0.value == selection })?.label ?? options.first?.label ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            Menu {
                ForEach(options) { o in
                    Button { pick(o.value) } label: {
                        if o.value == selection {
                            Label(o.label, systemImage: "checkmark")
                        } else {
                            Text(o.label)
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(current).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                .padding(.horizontal, 12).frame(width: 190, height: 42)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
        }
    }
}

/// チェック（期限超過のみ）
struct NInvCheck: View {
    let label: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(" ").font(.system(size: 12))
            Button(action: action) {
                HStack(spacing: 8) {
                    Image(systemName: on ? "checkmark.square.fill" : "square").font(.system(size: 20)).foregroundColor(on ? NT.purple : NT.ink3)
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                }
                .frame(height: 42)
            }
            .buttonStyle(PressableStyle())
        }
    }
}

/// 請求書の1行（押すと詳細。仕訳の「見る」は別のボタン）
struct NInvInvoiceLine: View {
    let row: NInvRow
    let onOpen: () -> Void
    let onJournal: (String) -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    NPBadge(text: row.statusLabel, color: NInvText.statusColor(row.status))
                    if row.overdue { NPBadge(text: "期限超過", color: NT.danger) }
                }
                .frame(width: 150, alignment: .leading)
                NAccCell(text: row.vendorName, bold: true)
                NAccCell(text: row.expenseLabel, width: 120)
                NAccCell(text: row.dueLabel, width: 110, bold: row.overdue, color: row.overdue ? NT.danger : NT.ink)
                NAccCell(text: NInvText.yen(row.amount), width: 110, trailing: true)
                NAccCell(text: row.storeLabel, width: 120)
            }
            .contentShape(Rectangle())
            .onTapGesture { onOpen() }
            Group {
                if let href = row.journalHref {
                    Button { onJournal(href) } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "doc.text")
                            Text("見る")
                        }
                        .font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.royal)
                    }
                    .buttonStyle(PressableStyle())
                } else {
                    Text("未仕訳").font(.system(size: 12)).foregroundColor(NT.ink3.opacity(0.6))
                }
            }
            .frame(width: 64, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

/// 書類の1行
struct NInvDocLine: View {
    let row: NInvDocRow
    let canDelete: Bool
    let onPreview: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            NPBadge(text: row.docTypeLabel, color: NT.ink2).frame(width: 90, alignment: .leading)
            Button(action: onPreview) {
                Text(row.fileName).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.purple).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(PressableStyle())
            NAccCell(text: row.dateLabel, width: 100)
            NAccCell(text: row.vendorLabel, width: 130)
            NAccCell(text: row.storeLabel, width: 110)
            NAccCell(text: NInvText.yen(row.amount), width: 100, trailing: true)
            NPBadge(text: row.ocrLabel, color: NInvText.ocrColor(row.ocrStatus)).frame(width: 120, alignment: .leading)
            Group {
                if canDelete {
                    Button(action: onDelete) {
                        Text("削除").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
                            .padding(.horizontal, 10).frame(height: 30)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.danger.opacity(0.09)))
                    }
                    .buttonStyle(PressableStyle())
                } else {
                    Color.clear.frame(height: 1)
                }
            }
            .frame(width: 70, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

/// アップロードの1件（Web の UploadZone の行）
struct NInvTaskLine: View {
    let task: NInvUploadTask
    @ObservedObject var model: NInvListModel

    private var color: Color {
        switch task.status {
        case .success: return NT.ok
        case .failed, .needsConfirm: return NT.warn
        default: return NT.ink3
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Group {
                switch task.status {
                case .checking, .uploading: ProgressView().scaleEffect(0.8).tint(NT.purple)
                case .success: Image(systemName: "checkmark.circle.fill").foregroundColor(NT.ok)
                case .failed, .needsConfirm: Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NT.warn)
                case .skipped: Image(systemName: "xmark").foregroundColor(NT.ink3)
                }
            }
            .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Text(task.label).font(.system(size: 12)).foregroundColor(color).lineLimit(2)
            }
            Spacer(minLength: 8)
            if task.status == .needsConfirm {
                NPRButton(text: "スキップ") { model.skip(task.id) }
                NPRButton(text: "続行", kind: .primary) { Task { await model.upload(task.id) } }
            }
            if task.status == .failed {
                Button { model.remove(task.id) } label: {
                    Image(systemName: "xmark.circle").font(.system(size: 18)).foregroundColor(NT.ink3)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("削除")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

/// 日付（空＝未設定）。フォームの1行
struct NInvOptionalDate: View {
    let label: String
    @Binding var value: String

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
            Spacer(minLength: 8)
            if value.isEmpty {
                Button { value = NPDate.str(Date()) } label: {
                    Text("未設定（押して入れる）").foregroundColor(NT.purple)
                }
                .buttonStyle(.borderless)
            } else {
                DatePicker("", selection: Binding(get: { NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date)
                    .labelsHidden()
                Button { value = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("消す")
            }
        }
    }
}

/// 金額の1行（フォーム）
struct NInvAmountRow: View {
    let label: String
    @Binding var text: String

    var body: some View {
        HStack {
            Text(label)
            Spacer(minLength: 8)
            TextField("0", text: $text).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 160)
            Text("円").foregroundColor(NT.ink3)
        }
    }
}

/// 理由を書いて実行（書類の削除）。onConfirm はエラーのことば（成功なら nil）
struct NInvReasonSheet: View {
    let title: String
    let message: String
    let confirmLabel: String
    let onCancel: () -> Void
    let onConfirm: (String) async -> String?

    @State private var reason = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(message).font(.system(size: 14)).foregroundColor(NT.ink2) }
                Section("理由（必須）") {
                    TextField("理由を入力", text: $reason, axis: .vertical).lineLimit(2...5)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onCancel).disabled(sending) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "送信中…" : confirmLabel) {
                        let r = NInvText.trimmed(reason)
                        sending = true
                        error = nil
                        Task {
                            error = await onConfirm(r)
                            sending = false
                        }
                    }
                    .disabled(sending || NInvText.trimmed(reason).isEmpty)
                }
            }
        }
    }
}

/// 添付ファイルの1区画（選んだファイル／ファイル・写真・撮影のボタン）。選ぶ画面はシートの側で出す
struct NInvAttachRow: View {
    @Binding var file: NInvPickedFile?
    @Binding var photoItems: [PhotosPickerItem]
    let onFiles: () -> Void
    let onCamera: () -> Void

    var body: some View {
        if let f = file {
            HStack(spacing: 10) {
                Image(systemName: f.mimeType == "application/pdf" ? "doc.richtext" : "photo").foregroundColor(NT.ink3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.name).lineLimit(1)
                    Text("\(f.data.count / 1024)KB").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 8)
                Button { file = nil } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("外す")
            }
        } else {
            HStack(spacing: 18) {
                Button(action: onFiles) { Label("ファイル", systemImage: "folder") }
                    .buttonStyle(.borderless)
                PhotosPicker(selection: $photoItems, maxSelectionCount: 1, matching: .images) {
                    Label("写真", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.borderless)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button(action: onCamera) { Label("撮影", systemImage: "camera") }
                        .buttonStyle(.borderless)
                }
                Spacer()
            }
        }
    }
}
