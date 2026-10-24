import SwiftUI
import UIKit
import PDFKit
import PhotosUI
import SafariServices
import UniformTypeIdentifiers

// マニュアルのネイティブ。Web の /app/manuals と同じ中身・同じ操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   カテゴリのタブ（すべて・接客・衛生・調理・レジ・勤怠・緊急対応・その他）・カード・開く（PDF・画像はアプリの中で、外部URLはアプリの中の Safari で）・削除
//   マニュアルを登録：タイトル・カテゴリ・対象（この店舗のみ／全店共通＝本社管理者だけ）・ファイル（写真・カメラ・PDF などのファイル）か外部URL・メモ
// サーバーは lib/native-modules/manuals.ts（読み込みは Web と同じ lib/manuals-server.ts、操作は Web と同じ Server Action）。
// ファイルは本文で送り、サーバーが Web と同じ場所（documents の 組織/manuals/）へ上げる（スキャンと同じ形）。iPad からは 3MB まで（写真は小さくして送る）。

// MARK: - 中身（サーバーの返事）

struct NMNCategory: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct NMNTarget: Decodable, Hashable {
    let id: String
    let name: String
}

struct NMNItem: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let category: String
    let storeLabel: String
    let hasFile: Bool
    let url: String?
    let note: String?
    let canDelete: Bool
}

struct NMNPayload: Decodable {
    let ok: Bool
    let canWrite: Bool
    let canTargetAllStores: Bool
    /// 「〇〇のみ」で登録する店舗
    let target: NMNTarget?
    let categories: [NMNCategory]
    let manuals: [NMNItem]
}

/// 添付ファイルを開く（1時間の署名URL・pdf／image）
struct NMNFilePayload: Decodable {
    let ok: Bool
    let url: String
    let kind: String
}

enum NMNLimit {
    /// iPad から送れる 1 ファイルの大きさ（サーバーの NATIVE_MANUAL_MAX_BYTES と同じ）
    static let maxBytes = 3_000_000
}

/// 開いたファイル（PDF も写真も PDFKit で出す＝指で拡大できる）
struct NMNViewer: Identifiable {
    let id = UUID()
    let title: String
    let document: PDFDocument
    /// 共有（保存・印刷）用の一時ファイル
    let file: URL?

    static func make(title: String, kind: String, data: Data) -> NMNViewer? {
        let base = NMNFile.safeName(title)
        if kind == "pdf" || data.starts(with: [0x25, 0x50, 0x44, 0x46]) {
            guard let doc = PDFDocument(data: data) else { return nil }
            return NMNViewer(title: title, document: doc, file: NLShare.tempFile(base + ".pdf", data: data))
        }
        guard let img = UIImage(data: data), let page = PDFPage(image: img) else { return nil }
        let doc = PDFDocument()
        doc.insert(page, at: 0)
        let ext = data.starts(with: [0x89, 0x50, 0x4E, 0x47]) ? "png" : "jpg"
        return NMNViewer(title: title, document: doc, file: NLShare.tempFile(base + "." + ext, data: data))
    }
}

/// 出しているシート（登録／開いたファイル）
enum NMNSheet: Identifiable {
    case create
    case viewer(NMNViewer)

    var id: String {
        switch self {
        case .create: return "create"
        case .viewer(let v): return v.id.uuidString
        }
    }
}

enum NMNFile {
    static func safeName(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        let cleaned = s.components(separatedBy: bad).joined(separator: "_").trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? "manual" : String(cleaned.prefix(60))
    }

    /// 写真を JPEG に（長い辺 2400px・3MB まで。スキャンと同じ）
    static func jpeg(_ img: UIImage) -> Data? {
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
            if let d = resized.jpegData(compressionQuality: q), d.count <= NMNLimit.maxBytes { return d }
            q -= 0.15
        }
        return nil
    }

    static func sizeText(_ bytes: Int) -> String {
        if bytes >= 1_000_000 { return String(format: "%.1fMB", Double(bytes) / 1_000_000) }
        return "\(max(1, bytes / 1000))KB"
    }

    /// 外部URL（Web は新しいタブ）。http(s) はアプリの中の Safari、それ以外はそのアプリで（出し方は NLShare.present と同じ）
    static func openExternal(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        guard scheme == "http" || scheme == "https", let top = topController() else {
            UIApplication.shared.open(url)
            return
        }
        top.present(SFSafariViewController(url: url), animated: true)
    }

    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first,
              var top = window.rootViewController else { return nil }
        while let presented = top.presentedViewController { top = presented }
        return top
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NMNModel: ObservableObject {
    @Published var payload: NMNPayload?
    @Published var error: String?
    @Published var toast: String?
    /// 開いているマニュアル
    @Published var opening: String?

    init() {
        payload = NativeModuleAPI.cached(NMNPayload.self, part: "manuals")
    }

    func load() async {
        do {
            payload = try await NativeModuleAPI.get(NMNPayload.self, part: "manuals")
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    /// 添付ファイルを読む（署名URL → 中身）。開けない形は Safari で
    func openFile(_ m: NMNItem) async -> NMNViewer? {
        guard opening == nil else { return nil }
        opening = m.id
        var viewer: NMNViewer?
        do {
            let f = try await NativeModuleAPI.get(NMNFilePayload.self, part: "manualFile", query: ["id": m.id])
            if let url = URL(string: f.url) {
                let (data, response) = try await URLSession.shared.data(from: url)
                if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                    toast = "開けませんでした"
                } else if let v = NMNViewer.make(title: m.title, kind: f.kind, data: data) {
                    viewer = v
                } else {
                    NMNFile.openExternal(url)
                }
            } else {
                toast = "開けませんでした"
            }
        } catch {
            toast = NativeModuleAPI.message(error)
        }
        opening = nil
        return viewer
    }

    /// 削除（論理削除）
    func delete(_ m: NMNItem) async {
        do {
            try await NativeModuleAPI.post(["type": "manualDelete", "id": m.id])
            toast = "マニュアルを削除しました"
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 画面

struct NativeManualsView: View {
    let onHome: () -> Void
    @StateObject private var model = NMNModel()
    @State private var tab = "all"
    @State private var sheet: NMNSheet?
    @State private var confirmDelete: NMNItem?

    var body: some View {
        NWKPage(title: "マニュアル", onHome: onHome, loaded: model.payload != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload {
                header(p)
                tabs(p)
                catalog(p)
            }
        }
        .task { await model.load() }
        .sheet(item: $sheet) { s in sheetView(s) }
        .alert(
            "マニュアルを削除",
            isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
            presenting: confirmDelete
        ) { m in
            Button("削除する", role: .destructive) { Task { await model.delete(m) } }
            Button("キャンセル", role: .cancel) {}
        } message: { _ in
            Text("このマニュアルを削除します。よろしいですか？")
        }
    }

    @ViewBuilder private func sheetView(_ s: NMNSheet) -> some View {
        switch s {
        case .create:
            if let p = model.payload {
                NMNFormSheet(
                    payload: p,
                    onSaved: { message in
                        sheet = nil
                        model.toast = message
                        Task { await model.load() }
                    },
                    onClose: { sheet = nil }
                )
            }
        case .viewer(let v):
            NMNViewerSheet(viewer: v) { sheet = nil }
        }
    }

    private func header(_ p: NMNPayload) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text("接客・衛生・調理・レジ・勤怠・緊急対応などの手順書を管理します")
                .font(.system(size: 13.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if p.canWrite {
                NWKButton(text: "マニュアルを登録", icon: "plus", kind: .primary, height: 44) { sheet = .create }
            }
        }
    }

    private func tabs(_ p: NMNPayload) -> some View {
        WrapLayout(spacing: 8) {
            chip("all", "すべて（\(p.manuals.count)）")
            ForEach(p.categories) { c in
                chip(c.key, "\(c.label)（\(p.manuals.filter { $0.category == c.key }.count)）")
            }
        }
    }

    private func chip(_ key: String, _ text: String) -> some View {
        Button { tab = key } label: {
            Text(text).font(.system(size: 14.5, weight: .bold))
                .foregroundColor(tab == key ? Color.white : NT.ink2)
                .padding(.horizontal, 14).frame(height: 38)
                .background(Capsule().fill(tab == key ? NT.topBar : Color.white))
                .overlay(Capsule().stroke(tab == key ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func catalog(_ p: NMNPayload) -> some View {
        let list = tab == "all" ? p.manuals : p.manuals.filter { $0.category == tab }
        let labels = Dictionary(p.categories.map { ($0.key, $0.label) }, uniquingKeysWith: { a, _ in a })
        return Group {
            if list.isEmpty {
                NWKEmpty(title: "該当するマニュアルはありません")
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                    ForEach(list) { m in card(m, category: labels[m.category] ?? m.category) }
                }
            }
        }
    }

    private func card(_ m: NMNItem, category: String) -> some View {
        let isOpening = model.opening == m.id
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: m.hasFile ? "doc.text" : "link")
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple).padding(.top, 2)
                Text(m.title).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
                Spacer(minLength: 6)
                NWKBadge(text: category, color: NT.ink2)
            }
            Text(m.storeLabel).font(.system(size: 12.5)).foregroundColor(NT.ink3)
            if let n = m.note, !n.isEmpty {
                Text(n).font(.system(size: 13)).foregroundColor(NT.ink2).lineLimit(2)
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                NWKButton(
                    text: isOpening ? "開いています…" : "開く",
                    icon: m.hasFile ? "doc.viewfinder" : "arrow.up.right.square",
                    busy: isOpening,
                    disabled: (!m.hasFile && m.url == nil) || (model.opening != nil && !isOpening)
                ) {
                    Task { await open(m) }
                }
                Spacer()
                if m.canDelete {
                    Button { confirmDelete = m } label: {
                        Image(systemName: "trash").font(.system(size: 16, weight: .semibold)).foregroundColor(NT.danger)
                            .frame(width: 44, height: 42)
                            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NT.dangerBg))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("削除")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    @MainActor private func open(_ m: NMNItem) async {
        if m.hasFile {
            if let v = await model.openFile(m) { sheet = .viewer(v) }
        } else if let s = m.url, let url = URL(string: s.trimmingCharacters(in: .whitespaces)) {
            NMNFile.openExternal(url)
        } else {
            model.toast = "開けませんでした"
        }
    }
}

// MARK: - 開いたファイル（PDF・画像）

struct NMNViewerSheet: View {
    let viewer: NMNViewer
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            NMNPDFView(document: viewer.document)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(viewer.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) }
                    ToolbarItem(placement: .confirmationAction) {
                        if let f = viewer.file {
                            Button { NLShare.present(url: f) } label: { Image(systemName: "square.and.arrow.up") }
                                .accessibilityLabel("共有・保存・印刷")
                        }
                    }
                }
        }
    }
}

/// PDFKit の表示（指で拡大・縦にスクロール）
struct NMNPDFView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.backgroundColor = UIColor.systemGray6
        v.document = document
        return v
    }

    func updateUIView(_ v: PDFView, context: Context) {
        if v.document !== document { v.document = document }
    }
}

// MARK: - 登録（Web の ManualForm）

/// 選んだファイル（送る形にしたもの）
struct NMNPicked: Equatable {
    let name: String
    let mime: String
    let data: Data
}

struct NMNFormSheet: View {
    let payload: NMNPayload
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var title = ""
    @State private var category = "other"
    @State private var target = "store"
    @State private var mode = "file"
    @State private var url = ""
    @State private var note = ""
    @State private var file: NMNPicked?
    @State private var photo: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showImporter = false
    @State private var preparing = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("タイトル") {
                    TextField("タイトル", text: $title)
                }
                Section {
                    Picker("カテゴリ", selection: $category) {
                        ForEach(payload.categories) { c in Text(c.label).tag(c.key) }
                    }
                    Picker("対象", selection: $target) {
                        Text("\(payload.target?.name ?? "この店舗")のみ").tag("store")
                        if payload.canTargetAllStores { Text("全店共通").tag("all") }
                    }
                }
                Section {
                    Picker("登録のしかた", selection: $mode) {
                        Text("ファイルをアップロード").tag("file")
                        Text("外部URL").tag("url")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    if mode == "file" {
                        fileRows
                    } else {
                        TextField("https://", text: $url)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                } footer: {
                    Text(mode == "file" ? "PDF・PNG・JPEG・WebP（iPad からは3MBまで。写真は小さくして送ります）" : "https:// から入力してください")
                }
                Section("メモ") {
                    TextField("メモ", text: $note, axis: .vertical).lineLimit(2...6)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("マニュアルを登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "登録する") { save() }.disabled(saving || preparing)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .onChange(of: photo) { item in
            guard let item else { return }
            Task { await loadPhoto(item) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            SCNCameraPicker { img in
                showCamera = false
                if let img { pickImage(img, name: "camera_\(Int(Date().timeIntervalSince1970)).jpg") }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf, .png, .jpeg, .webP], allowsMultipleSelection: false) { res in
            if case .success(let urls) = res, let u = urls.first { pickFile(u) }
        }
    }

    @ViewBuilder private var fileRows: some View {
        if let f = file {
            HStack(spacing: 10) {
                Image(systemName: f.mime == "application/pdf" ? "doc.richtext" : "photo").foregroundColor(NT.purple)
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.name).lineLimit(1)
                    Text(NMNFile.sizeText(f.data.count)).font(.system(size: 12)).foregroundColor(NT.ink3)
                }
                Spacer()
                Button { file = nil } label: { Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("選び直す")
            }
        }
        PhotosPicker(selection: $photo, matching: .images) {
            Label("写真から選ぶ", systemImage: "photo.on.rectangle")
        }
        Button { showCamera = true } label: { Label("カメラで撮る", systemImage: "camera") }
            .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
        Button { showImporter = true } label: { Label("ファイルを選ぶ（PDF など）", systemImage: "folder") }
        if preparing {
            HStack(spacing: 8) {
                ProgressView()
                Text("読み込み中…").foregroundColor(NT.ink3)
            }
        }
    }

    @MainActor private func loadPhoto(_ item: PhotosPickerItem) async {
        preparing = true
        error = nil
        if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
            pickImage(img, name: "photo_\(Int(Date().timeIntervalSince1970)).jpg")
        } else {
            error = "写真を読み込めませんでした"
        }
        photo = nil
        preparing = false
    }

    /// 写真・カメラ（JPEG にして 3MB まで）
    private func pickImage(_ img: UIImage, name: String) {
        guard let jpeg = NMNFile.jpeg(img) else {
            error = "写真を読み込めませんでした"
            return
        }
        error = nil
        file = NMNPicked(name: name, mime: "image/jpeg", data: jpeg)
    }

    /// ファイル（PDF はそのまま 3MB まで、画像は大きければ JPEG に）
    private func pickFile(_ u: URL) {
        let ok = u.startAccessingSecurityScopedResource()
        defer { if ok { u.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: u) else {
            error = "ファイルを読めませんでした"
            return
        }
        error = nil
        let ext = u.pathExtension.lowercased()
        switch ext {
        case "pdf":
            guard data.count <= NMNLimit.maxBytes else {
                error = "PDF は iPad からは3MBまでです（大きいものは Web から登録してください）"
                return
            }
            file = NMNPicked(name: u.lastPathComponent, mime: "application/pdf", data: data)
        case "png", "jpg", "jpeg", "webp":
            let mime = ext == "png" ? "image/png" : (ext == "webp" ? "image/webp" : "image/jpeg")
            if data.count <= NMNLimit.maxBytes {
                file = NMNPicked(name: u.lastPathComponent, mime: mime, data: data)
            } else if let img = UIImage(data: data), let jpeg = NMNFile.jpeg(img) {
                file = NMNPicked(name: u.deletingPathExtension().lastPathComponent + ".jpg", mime: "image/jpeg", data: jpeg)
            } else {
                error = "ファイルが大きすぎます（iPad からは3MBまで）"
            }
        default:
            error = "対応形式は PDF・PNG・JPEG・WebP です"
        }
    }

    private func save() {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "タイトルを入力してください"
            return
        }
        var req: [String: Any] = ["type": "manualCreate", "title": title, "category": category, "target": target, "mode": mode, "note": note]
        if mode == "url" {
            let u = url.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !u.isEmpty else {
                error = "URLを入力してください"
                return
            }
            req["url"] = u
        } else {
            guard let f = file else {
                error = "ファイルを選択してください"
                return
            }
            req["fileName"] = f.name
            req["mimeType"] = f.mime
            req["dataBase64"] = f.data.base64EncodedString()
        }
        saving = true
        error = nil
        Task {
            do {
                try await NativeModuleAPI.post(req)
                saving = false
                onSaved("マニュアルを登録しました")
            } catch {
                saving = false
                self.error = NativeModuleAPI.message(error)
            }
        }
    }
}
