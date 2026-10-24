import SwiftUI
import PDFKit
import PhotosUI
import UniformTypeIdentifiers

// iPhone の店長・オーナー：マニュアル（ネイティブ）。Web の /app/manuals と同じ中身・同じ操作（2026-10-25 Ronnie「iPhone も native に」）
//   カテゴリのタブ（すべて・接客・衛生・調理・レジ・勤怠・緊急対応・その他）・探す・開く（PDF・画像はアプリの中で指で拡大、外部URL・動画のリンクはアプリの中の Safari）
//   マニュアルを登録（タイトル・カテゴリ・対象＝この店舗のみ／全店共通・写真・カメラ・PDF などのファイルか外部URL・メモ）・削除（確かめてから）
// サーバーは iPad と同じ：GET part=manuals・manualFile ／ POST manualCreate・manualDelete（lib/native-modules/manuals.ts）
// ファイルの表示・写真の縮小は iPad と同じもの（NMNViewer・NMNPDFView・NMNFile）を使う（中身は変えない）

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPMNCategory: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct NPMNItem: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let category: String
    let storeLabel: String?
    let hasFile: Bool
    let url: String?
    let note: String?
    let canDelete: Bool?
}

struct NPMNPayload: Decodable {
    let canWrite: Bool
    let canTargetAllStores: Bool?
    /// 「〇〇のみ」で登録する店舗
    let target: NPOCOption?
    let categories: [NPMNCategory]
    let manuals: [NPMNItem]
}

/// 添付ファイルを開く（1時間の署名URL・pdf／image）
struct NPMNFilePayload: Decodable {
    let url: String
    let kind: String?
}

// MARK: - 読み込み・操作

@MainActor
final class NPMNModel: ObservableObject {
    @Published var payload: NPMNPayload?
    @Published var toast: String?
    @Published var useWeb = false
    /// 開いているマニュアル（読み込み中）
    @Published var opening: String?
    /// 開いたファイル（PDF・画像）
    @Published var viewer: NMNViewer?

    init() {
        payload = NativeModuleAPI.cached(NPMNPayload.self, part: "manuals")
    }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            payload = try await NativeModuleAPI.get(NPMNPayload.self, part: "manuals")
        } catch {
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    /// 開く：ファイルは署名URL → 中身 → PDF・画像はアプリの中、それ以外は Safari。外部URLは Safari
    func open(_ m: NPMNItem) async {
        if m.hasFile {
            guard opening == nil else { return }
            if NativePreview.current != nil {
                toast = "見本のためファイルは開けません"
                return
            }
            opening = m.id
            defer { opening = nil }
            do {
                let f = try await NativeModuleAPI.get(NPMNFilePayload.self, part: "manualFile", query: ["id": m.id])
                guard let url = URL(string: f.url) else {
                    toast = "開けませんでした"
                    return
                }
                let (data, response) = try await URLSession.shared.data(from: url)
                if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                    toast = "開けませんでした"
                    return
                }
                if let v = NMNViewer.make(title: m.title, kind: f.kind ?? "", data: data) {
                    viewer = v
                } else {
                    NMNFile.openExternal(url)
                }
            } catch {
                toast = NativeModuleAPI.message(error)
            }
        } else if let s = m.url, let url = URL(string: s.trimmingCharacters(in: .whitespaces)) {
            NMNFile.openExternal(url)
        } else {
            toast = "開けませんでした"
        }
    }

    /// 削除（論理削除）
    func delete(_ m: NPMNItem) async {
        if NativePreview.current != nil {
            toast = "見本のため削除していません"
            return
        }
        do {
            try await NativeModuleAPI.post(["type": "manualDelete", "id": m.id])
            toast = "マニュアルを削除しました"
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 画面（AppState につなぐ）

struct NativePhoneManualsScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model = NPMNModel()

    init(route: NativeModuleRoute) {}

    var body: some View {
        NativePhoneManualsView(model: model, onBack: { state.closePhoneOwnerModule() })
            .modifier(NPOCWebFallback(key: "manuals", useWeb: model.useWeb, state: state))
    }
}

struct NativePhoneManualsView: View {
    @ObservedObject var model: NPMNModel
    let onBack: () -> Void
    @State private var tab = "all"
    @State private var query = ""
    @State private var creating = false
    @State private var confirmDelete: NPMNItem?

    var body: some View {
        NPOFrame(title: "マニュアル", subtitle: "Manuals", onBack: onBack, trailing: {
            if model.payload?.canWrite == true {
                NPOCBarButton(icon: "plus", label: "登録") { creating = true }
            }
        }) {
            NPOCBody(loaded: model.payload != nil, error: nil, retry: { await model.load() }) {
                if let p = model.payload { list(p) }
            }
        }
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .sheet(isPresented: $creating) {
            if let p = model.payload {
                NPMNFormSheet(
                    payload: p,
                    onSaved: { message in
                        creating = false
                        model.toast = message
                        Task { await model.load() }
                    },
                    onClose: { creating = false }
                )
            }
        }
        .fullScreenCover(item: $model.viewer) { v in
            NPMNViewerCover(viewer: v) { model.viewer = nil }
        }
        .confirmationDialog("マニュアルを削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
                            titleVisibility: .visible, presenting: confirmDelete) { m in
            Button("削除する", role: .destructive) { Task { await model.delete(m) } }
            Button("キャンセル", role: .cancel) {}
        } message: { m in
            Text("「\(m.title)」を削除します。よろしいですか？")
        }
    }

    // MARK: 一覧

    private func labels(_ p: NPMNPayload) -> [String: String] {
        Dictionary(p.categories.map { ($0.key, $0.label) }, uniquingKeysWith: { a, _ in a })
    }

    private func filtered(_ p: NPMNPayload) -> [NPMNItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return p.manuals.filter { m in
            (tab == "all" || m.category == tab)
                && (q.isEmpty || m.title.lowercased().contains(q) || (m.note ?? "").lowercased().contains(q))
        }
    }

    @ViewBuilder private func list(_ p: NPMNPayload) -> some View {
        searchField
        chips(p)
        let items = filtered(p)
        let names = labels(p)
        if p.manuals.isEmpty {
            NPOCEmpty(icon: "book.closed", title: "マニュアルはまだありません",
                      note: p.canWrite ? "右上の「登録」から、接客・衛生・調理などの手順書（PDF・写真・URL）を登録できます" : "")
        } else if items.isEmpty {
            NPOCEmpty(icon: "magnifyingglass", title: "該当するマニュアルはありません")
        } else if tab == "all" && query.trimmingCharacters(in: .whitespaces).isEmpty {
            // すべて：カテゴリごとに
            ForEach(p.categories) { c in
                let group = items.filter { $0.category == c.key }
                if !group.isEmpty {
                    NPOCSectionTitle(title: "\(c.label)（\(group.count)）")
                    ForEach(group) { m in row(m, category: c.label) }
                }
            }
            let known = Set(p.categories.map(\.key))
            let others = items.filter { !known.contains($0.category) }
            if !others.isEmpty {
                NPOCSectionTitle(title: "分類なし（\(others.count)）")
                ForEach(others) { m in row(m, category: names[m.category] ?? m.category) }
            }
        } else {
            NPOCSectionTitle(title: "\(items.count)件")
            ForEach(items) { m in row(m, category: names[m.category] ?? m.category) }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink3)
            TextField("タイトル・メモで探す", text: $query)
                .font(.system(size: 16))
                .submitLabel(.search)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("消す")
            }
        }
        .padding(.horizontal, 12).frame(height: 46)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func chips(_ p: NPMNPayload) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                NPOCChip(text: "すべて（\(p.manuals.count)）", selected: tab == "all") { tab = "all" }
                ForEach(p.categories) { c in
                    NPOCChip(text: "\(c.label)（\(count(p, c.key))）", selected: tab == c.key) { tab = c.key }
                }
            }
            .padding(.horizontal, 1)
        }
    }

    private func count(_ p: NPMNPayload, _ key: String) -> Int { p.manuals.filter { $0.category == key }.count }

    private func row(_ m: NPMNItem, category: String) -> some View {
        let isOpening = model.opening == m.id
        let busyOther = model.opening != nil && !isOpening
        return HStack(spacing: 6) {
            Button { Task { await model.open(m) } } label: {
                HStack(spacing: 12) {
                    Image(systemName: m.hasFile ? "doc.richtext" : "link")
                        .font(.system(size: 18, weight: .semibold)).foregroundColor(NT.purple)
                        .frame(width: 44, height: 44)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(m.title).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                        HStack(spacing: 6) {
                            NWKBadge(text: category, color: NT.ink2)
                            if let s = m.storeLabel { Text(s).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1) }
                        }
                        if let n = m.note, !n.isEmpty {
                            Text(n).font(.system(size: 12.5)).foregroundColor(NT.ink2).lineLimit(2).multilineTextAlignment(.leading)
                        }
                    }
                    Spacer(minLength: 4)
                    if isOpening {
                        ProgressView().tint(NT.purple)
                    } else {
                        Image(systemName: m.hasFile ? "chevron.right" : "arrow.up.right.square")
                            .font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink3)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busyOther || (!m.hasFile && m.url == nil))
            if m.canDelete == true {
                Menu {
                    Button { Task { await model.open(m) } } label: { Label("開く", systemImage: m.hasFile ? "doc.viewfinder" : "safari") }
                    Button(role: .destructive) { confirmDelete = m } label: { Label("削除", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2)
                        .frame(width: 36, height: 44)
                        .contentShape(Rectangle())
                }
            }
        }
        .padding(.leading, 12).padding(.trailing, m.canDelete == true ? 4 : 12).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard(14))
        .opacity(busyOther ? 0.6 : 1)
    }
}

// MARK: - 開いたファイル（PDF・画像。iPad と同じ PDFKit の表示＝指で拡大）

struct NPMNViewerCover: View {
    let viewer: NMNViewer
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            NPHTopBar(title: viewer.title, backLabel: "閉じる", onBack: onClose) {
                if let f = viewer.file {
                    Button { NLShare.present(url: f) } label: {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                            .frame(width: 42, height: 40)
                    }
                    .accessibilityLabel("共有・保存・印刷")
                } else {
                    Color.clear.frame(width: 42, height: 40)
                }
            }
            NMNPDFView(document: viewer.document)
                .ignoresSafeArea(edges: .bottom)
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
    }
}

// MARK: - 登録（Web の ManualForm）

struct NPMNFormSheet: View {
    let payload: NPMNPayload
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

    private var storeName: String { payload.target?.name ?? "この店舗" }

    var body: some View {
        NPOCSheetFrame(title: "マニュアルを登録", confirmText: saving ? "保存中…" : "登録する", busy: saving || preparing,
                       onCancel: onClose, onConfirm: { save() }) {
            NPOCField(label: "タイトル") {
                TextField("例：開店前の衛生チェック", text: $title).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "カテゴリ") {
                WrapLayout(spacing: 8) {
                    ForEach(payload.categories) { c in
                        NPOCChip(text: c.label, selected: category == c.key) { category = c.key }
                    }
                }
            }
            NPOCField(label: "対象") {
                if payload.canTargetAllStores == true {
                    Picker("対象", selection: $target) {
                        Text("\(storeName)のみ").tag("store")
                        Text("全店共通").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                } else {
                    HStack {
                        Image(systemName: "storefront").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink3)
                        Text("\(storeName)のみ").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                        Spacer()
                    }
                    .npocInputBox()
                }
            }
            NPOCField(label: "登録のしかた") {
                Picker("登録のしかた", selection: $mode) {
                    Text("ファイル・写真").tag("file")
                    Text("外部URL").tag("url")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            if mode == "file" {
                fileFields
            } else {
                NPOCField(label: "URL") {
                    VStack(alignment: .leading, spacing: 6) {
                        TextField("https://", text: $url)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.system(size: 16))
                            .npocInputBox()
                        Text("https:// から入力してください（動画のリンクもここに）").font(.system(size: 12)).foregroundColor(NT.ink3).padding(.leading, 4)
                    }
                }
            }
            NPOCField(label: "メモ") {
                TextField("メモ（任意）", text: $note, axis: .vertical).lineLimit(2...6).font(.system(size: 16)).npocInputBox()
            }
            if let error {
                Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
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

    private var fileFields: some View {
        NPOCField(label: "ファイル") {
            VStack(alignment: .leading, spacing: 8) {
                if let f = file {
                    HStack(spacing: 10) {
                        Image(systemName: f.mime == "application/pdf" ? "doc.richtext" : "photo")
                            .font(.system(size: 18, weight: .semibold)).foregroundColor(NT.purple)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.name).font(.system(size: 14.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(1)
                            Text(NMNFile.sizeText(f.data.count)).font(.system(size: 12)).foregroundColor(NT.ink3)
                        }
                        Spacer()
                        Button { file = nil } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundColor(NT.ink3)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("選び直す")
                    }
                    .npocInputBox()
                }
                PhotosPicker(selection: $photo, matching: .images) {
                    pickLabel("写真から選ぶ", icon: "photo.on.rectangle")
                }
                Button { showCamera = true } label: { pickLabel("カメラで撮る", icon: "camera") }
                    .buttonStyle(PressableStyle())
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                Button { showImporter = true } label: { pickLabel("ファイルを選ぶ（PDF など）", icon: "folder") }
                    .buttonStyle(PressableStyle())
                if preparing {
                    HStack(spacing: 8) {
                        ProgressView().tint(NT.purple)
                        Text("読み込み中…").font(.system(size: 13)).foregroundColor(NT.ink3)
                    }
                }
                Text("PDF・PNG・JPEG・WebP（iPhone からは3MBまで。写真は小さくして送ります）")
                    .font(.system(size: 12)).foregroundColor(NT.ink3).padding(.leading, 4).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func pickLabel(_ text: String, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).frame(width: 22)
            Text(text).font(.system(size: 15, weight: .bold))
            Spacer()
        }
        .foregroundColor(NT.purpleDeep)
        .padding(.horizontal, 14).frame(height: 48)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
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
                error = "PDF は iPhone からは3MBまでです（大きいものはパソコンの Web から登録してください）"
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
                error = "ファイルが大きすぎます（iPhone からは3MBまで）"
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
        if NativePreview.current != nil {
            onSaved("マニュアルを登録しました（見本）")
            return
        }
        saving = true
        error = nil
        let request = req
        Task {
            do {
                try await NativeModuleAPI.post(request)
                saving = false
                onSaved("マニュアルを登録しました")
            } catch {
                saving = false
                self.error = NativeModuleAPI.message(error)
            }
        }
    }
}
