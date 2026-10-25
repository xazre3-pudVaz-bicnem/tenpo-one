import SwiftUI
import PhotosUI
import UIKit

// iPhone の店長・オーナー：スキャン（Web の /app/scan。?tx=<出金> はその出金にレシートを紐付ける。2026-10-25 Ronnie「iPhone も native に」）
// サーバーは iPad と同じ（返事の形は変えない）：GET ?part=scan&type&tx ／ POST scanUpload（JPEG を本文で。長い辺 2400px・3MB まで）
//   iPhone のカメラで撮る（写真から選ぶことも）→ 四隅を動かして切り取る・回転 → 保存（出金があれば紐付け）
//   レシート未添付の出金（本日）・最近のスキャン（日ごとのフォルダ・読み取った金額・仕分けの状態）・種別の絞り込み
// ScanSnap のまとめて取り込み（/app/scan#scan-bulk）は NativePhoneOwnerScanBulk.swift（2026-10-25）。保存ボックスの仕分け（/app/invoices）は Web のまま。

/// GET ?part=scan の中身（使うところだけ）
struct NOMScan: Decodable {
    struct Target: Decodable, Hashable {
        let id: String
        let main: String
        let sub: String?
        let date: String
        let occurredAt: String
        let kindLabel: String
        let amount: Double
        let hasReceipt: Bool
    }
    struct Need: Decodable, Hashable, Identifiable {
        let id: String
        let occurredAt: String
        let main: String
        let sub: String?
        let amount: Double
        let isAdvance: Bool
    }
    struct Month: Decodable, Hashable {
        let count: Double
        let receipts: Double
        let inbox: Double
    }
    struct Doc: Decodable, Hashable, Identifiable {
        let id: String
        let createdAt: String
        let fileName: String
        let title: String?
        let docType: String
        let typeLabel: String
        let status: String
        let amount: Double?
        let linked: Bool
    }
    struct Folder: Decodable, Hashable {
        let day: String
        let docs: [Doc]
    }
    let canUpload: Bool
    let canLink: Bool
    let canClose: Bool
    let today: String
    let filter: String
    let target: Target?
    let txMissing: Bool
    let needsReceipt: [Need]
    let needsTotal: Double
    let month: Month
    let folders: [Folder]
}

/// アップロードの 1 件
struct NOMUploadTask: Identifiable {
    let id = UUID()
    let name: String
    /// uploading ／ success ／ failed
    var status: String
    var message: String?
    let thumb: UIImage?
}

@MainActor
final class NOMScanModel: ObservableObject {
    @Published var payload: NOMScan?
    @Published var filter = ""
    /// 紐付ける出金（?tx=）
    @Published var tx: String?
    @Published var tasks: [NOMUploadTask] = []
    @Published var loading = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    /// 出金に紐付けた（「入出金に戻る」を出す）
    @Published var linked = false

    init(tx: String? = nil) {
        if let tx, NOS.isUuid(tx) { self.tx = tx }
    }

    private var query: [String: String] { ["type": filter, "tx": tx ?? ""] }

    func refresh() async {
        if NativePreview.current != nil { return }
        let q = query
        if payload == nil, let saved = NativeModuleAPI.cached(NOMScan.self, part: "scan", query: q) { payload = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOMScan.self, part: "scan", query: q)
            guard q == query else { return }
            payload = p
            error = nil
        } catch {
            guard q == query else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    func setFilter(_ f: String) {
        filter = f
        Task { await refresh() }
    }

    func setTx(_ t: String?) {
        tx = t
        linked = false
        Task { await refresh() }
    }

    /// 写真を JPEG にして送る（iPad と同じ POST scanUpload。出金があれば 1 枚だけ・紐付け）
    func upload(_ images: [UIImage]) async {
        let list = Array(images.prefix(tx != nil ? 1 : 20))
        for (i, img) in list.enumerated() {
            let name = "scan_\(Int(Date().timeIntervalSince1970))_\(i + 1).jpg"
            var task = NOMUploadTask(name: name, status: "uploading", message: nil, thumb: NOM.thumb(img))
            tasks.insert(task, at: 0)
            guard let jpeg = NOM.jpeg(img) else {
                task.status = "failed"
                task.message = "写真を読み込めませんでした"
                replace(task)
                continue
            }
            var linkTx: Any = NSNull()
            if let t = tx, payload?.target?.id == t, payload?.canLink == true { linkTx = t }
            let r = await NOM.post(["type": "scanUpload", "fileName": name, "mimeType": "image/jpeg", "dataBase64": jpeg.base64EncodedString(), "txId": linkTx])
            if r.ok {
                let queued = (r.json?["queued"] as? Int) ?? 0
                task.status = "success"
                task.message = queued > 0 ? "保存して出金に紐付けました" : "保存ボックスに保存しました"
                if queued > 0 { linked = true }
            } else {
                task.status = "failed"
                task.message = r.error ?? "登録に失敗しました"
            }
            replace(task)
        }
        tasks = Array(tasks.prefix(20))
        if tasks.first?.status == "success" { toast = linked ? "レシートを保存して出金に紐付けました" : "保存ボックスに保存しました" }
        await refresh()
    }

    private func replace(_ t: NOMUploadTask) {
        if let i = tasks.firstIndex(where: { $0.id == t.id }) { tasks[i] = t }
    }
}

/// 撮影・切り取りを始める印（image が nil ならカメラから）
struct NOMCaptureStart: Identifiable {
    let id = UUID()
    let image: UIImage?
}

// MARK: - 画面

struct NativePhoneOwnerScanView: View {
    @ObservedObject var model: NOMScanModel
    let onBack: () -> Void
    let onOpen: (String) -> Void

    @State private var capture: NOMCaptureStart?
    @State private var picks: [PhotosPickerItem] = []
    @State private var openedDays: Set<String> = []
    @State private var closedDays: Set<String> = []

    static let chips: [(key: String, label: String)] = [("", "すべて"), ("inbox", "未仕分け"), ("receipt", "領収書・レシート"), ("invoice", "請求書"), ("delivery_note", "納品書"), ("other", "その他")]

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "スキャン", subtitle: "レシート・請求書を撮る", onBack: onBack, trailing: {
                NOMRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        content(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .fullScreenCover(item: $capture) { s in
            NOMCaptureFlow(initial: s.image, onSave: { img in
                capture = nil
                Task { await model.upload([img]) }
            }, onClose: { capture = nil })
        }
        .onChange(of: picks) { items in
            guard !items.isEmpty else { return }
            Task {
                var imgs: [UIImage] = []
                for it in items {
                    if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { imgs.append(img) }
                }
                picks = []
                if imgs.count == 1, let one = imgs.first {
                    // 1 枚なら切り取り・確認の画面へ
                    capture = NOMCaptureStart(image: one)
                } else if !imgs.isEmpty {
                    await model.upload(imgs)
                }
            }
        }
    }

    private func content(_ p: NOMScan) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    Color.clear.frame(height: 0).id("scan-top")
                    if p.txMissing {
                        NOMNote(text: "指定された出金が見つかりません（取消済み・他店舗の可能性があります）。ふつうのスキャンとして保存できます。", tint: NT.danger)
                    }
                    if let t = p.target { targetCard(t, p) }
                    captureCard(p)
                    if model.linked {
                        NOMButton(title: "入出金に戻る", icon: "arrow.uturn.backward", filled: false) { onOpen("/app/cash") }
                    }
                    needsCard(p)
                    boxCard(p)
                    links(p)
                }
                .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
            }
            .refreshable { await model.refresh() }
            .onChange(of: model.tx) { _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("scan-top", anchor: .top) }
            }
        }
    }

    // MARK: この出金のレシート

    private func targetCard(_ t: NOMScan.Target, _ p: NOMScan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "paperclip").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                Text("この出金のレシートを撮影").font(.system(size: 12.5, weight: .heavy)).foregroundColor(NT.purpleDeep)
                Spacer()
                Button { model.setTx(nil) } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 22)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("紐付けをやめる")
            }
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.main).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2)
                    if let s = t.sub, !s.isEmpty { Text(s).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(2) }
                    Text("\(NOS.mdw(t.date)) \(NOM.hm(t.occurredAt)) ・ \(t.kindLabel)").font(.system(size: 11.5)).foregroundColor(NT.ink3).monospacedDigit()
                }
                Spacer(minLength: 6)
                Text(NOS.yen(t.amount)).font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
            }
            NOSBadge(text: t.hasReceipt ? "✓ レシート登録済み（撮り直すと差し替え）" : "レシート未添付", color: t.hasReceipt ? NT.ok : NT.warn)
            if !p.canLink {
                Text("出金への紐付けには小口現金の登録権限が必要です（書類の保存だけできます）。").font(.system(size: 11.5)).foregroundColor(NT.danger)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.purple.opacity(0.45), lineWidth: 1.5))
    }

    // MARK: 撮影・取り込み

    private func captureCard(_ p: NOMScan) -> some View {
        NPOCard(title: "撮影・取り込み", trailing: p.target != nil ? "1枚ずつ" : "写真からは複数枚OK") {
            Button { capture = NOMCaptureStart(image: nil) } label: {
                HStack(spacing: 10) {
                    Image(systemName: "camera.fill").font(.system(size: 22, weight: .bold))
                    VStack(alignment: .leading, spacing: 0) {
                        Text("撮影する").font(.system(size: 19, weight: .heavy))
                        Text("Take a photo").font(.system(size: 10.5, weight: .semibold)).opacity(0.8)
                    }
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity).frame(height: 72)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
                .opacity(p.canUpload ? 1 : 0.4)
            }
            .buttonStyle(PressableStyle())
            .disabled(!p.canUpload)
            PhotosPicker(selection: $picks, maxSelectionCount: p.target != nil ? 1 : 20, matching: .images) {
                HStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle").font(.system(size: 16, weight: .bold))
                    Text("写真から選ぶ").font(.system(size: 15.5, weight: .heavy))
                }
                .foregroundColor(NT.purpleDeep)
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
            }
            .disabled(!p.canUpload)
            ForEach(model.tasks) { t in taskRow(t) }
            Text("撮った写真は四隅を動かして切り取れます。保存した書類は「保存ボックス」（Web）で種別・金額を仕分けできます。")
                .font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func taskRow(_ t: NOMUploadTask) -> some View {
        HStack(spacing: 10) {
            Group {
                if let th = t.thumb {
                    Image(uiImage: th).resizable().scaledToFill()
                } else {
                    Image(systemName: "doc").font(.system(size: 18)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, maxHeight: .infinity).background(NT.page)
                }
            }
            .frame(width: 46, height: 46)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(t.status == "uploading" ? "アップロード中…" : (t.message ?? "")).font(.system(size: 13, weight: .bold))
                    .foregroundColor(t.status == "failed" ? NT.danger : NT.ink).lineLimit(2)
                Text(t.name).font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            if t.status == "uploading" {
                ProgressView().tint(NT.purple)
            } else if t.status == "success" {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 20)).foregroundColor(NT.ok)
            } else {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 18)).foregroundColor(NT.danger)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
    }

    // MARK: レシート未添付の出金（本日）

    private func needsCard(_ p: NOMScan) -> some View {
        NPOCard(title: "レシート未添付の出金", trailing: "本日 \(p.needsReceipt.count)件\(p.needsReceipt.isEmpty ? "" : "（\(NOS.yen(p.needsTotal))）")") {
            if p.needsReceipt.isEmpty {
                Label("本日の出金はすべてレシートがあります", systemImage: "checkmark.circle.fill").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ok)
            }
            ForEach(p.needsReceipt) { r in
                let active = p.target?.id == r.id
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(NOM.hm(r.occurredAt)).font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink3).monospacedDigit()
                            Text(r.main).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        }
                        if let s = r.sub, !s.isEmpty { Text(s).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                    }
                    Spacer(minLength: 4)
                    Text(NOS.yen(r.amount)).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    if active {
                        NOSBadge(text: "撮影中", color: NT.purple)
                    } else if r.isAdvance {
                        NOMSmallButton(title: "精算へ") { onOpen("/app/cash?tab=petty") }
                    } else {
                        NOMSmallButton(title: "撮る", filled: true) { model.setTx(r.id) }
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(active ? NT.lilac : NT.dangerBg.opacity(0.7)))
            }
            if p.canClose {
                Button { onOpen("/app/cash/close") } label: {
                    Text("レジクローズで出金レシートを確認 ›").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    // MARK: 最近のスキャン（レシートボックス）

    private func boxCard(_ p: NOMScan) -> some View {
        NPOCard(title: "最近のスキャン", trailing: "今月 \(NOS.int(p.month.count))件") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Self.chips, id: \.0) { c in
                        NOMChip(title: c.label, on: model.filter == c.key) { model.setFilter(c.key) }
                    }
                }
                .padding(.vertical, 1)
            }
            HStack(spacing: 10) {
                Text("領収書 \(NOS.int(p.month.receipts))件")
                Text("未仕分け \(NOS.int(p.month.inbox))件").foregroundColor(p.month.inbox > 0 ? NT.warn : NT.ink2)
                Spacer()
            }
            .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
            if p.folders.isEmpty {
                Text(p.filter.isEmpty ? "まだスキャンした書類はありません。上の「撮影する」から始めましょう" : "この条件の書類はありません")
                    .font(.system(size: 13)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).padding(.vertical, 20).multilineTextAlignment(.center)
            }
            ForEach(Array(p.folders.enumerated()), id: \.element.day) { i, f in
                let open = !closedDays.contains(f.day) && (i == 0 || f.day == p.today || openedDays.contains(f.day))
                folderHeader(f, p, open: open)
                if open {
                    ForEach(f.docs) { d in docRow(d) }
                }
            }
        }
    }

    private func folderHeader(_ f: NOMScan.Folder, _ p: NOMScan, open: Bool) -> some View {
        let inbox = f.docs.filter { $0.status == "inbox" }.count
        let total = f.docs.reduce(0.0) { $0 + ($1.amount ?? 0) }
        return Button {
            if open {
                closedDays.insert(f.day)
                openedDays.remove(f.day)
            } else {
                closedDays.remove(f.day)
                openedDays.insert(f.day)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill").font(.system(size: 14)).foregroundColor(NT.purple)
                Text(NOS.mdw(f.day)).font(.system(size: 13.5, weight: .heavy)).foregroundColor(NT.ink)
                if f.day == p.today { NOSBadge(text: "今日", color: NT.purple) }
                Text("\(f.docs.count)件").font(.system(size: 12)).foregroundColor(NT.ink3)
                if inbox > 0 { Text("未仕分け \(inbox)").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.warn) }
                Spacer(minLength: 4)
                if total > 0 { Text(NOS.yen(total)).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink).monospacedDigit() }
                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 10).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func docRow(_ d: NOMScan.Doc) -> some View {
        Button { onOpen("/app/invoices?tab=\(d.status == "inbox" ? "inbox" : "documents")") } label: {
            HStack(spacing: 10) {
                Image(systemName: d.docType == "delivery_note" ? "shippingbox" : d.docType == "invoice" ? "doc.text" : "receipt")
                    .font(.system(size: 17)).foregroundColor(NT.purpleDeep)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(NT.lilac))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Text(d.typeLabel).font(.system(size: 10, weight: .heavy)).foregroundColor(.white)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(RoundedRectangle(cornerRadius: 5).fill(Self.tagColor(d.docType)))
                        Text(d.title ?? d.fileName).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                    }
                    HStack(spacing: 5) {
                        Text(NOM.hm(d.createdAt)).monospacedDigit()
                        if d.linked { Text("✓ 出金に紐付け済").fontWeight(.bold).foregroundColor(NT.ok) }
                    }
                    .font(.system(size: 11)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(d.amount.map { NOS.yen($0) } ?? "—").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    NOSBadge(text: d.status == "inbox" ? "未仕分け" : "仕分け済", color: d.status == "inbox" ? NT.warn : NT.ok)
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    static func tagColor(_ t: String) -> Color {
        switch t {
        case "receipt", "register_receipt": return Color(hex: 0xE0A21B)
        case "invoice": return NT.purple
        case "delivery_note": return NT.ok
        default: return NT.ink3
        }
    }

    // MARK: Web のまま（ScanSnap・保存ボックス）

    private func links(_ p: NOMScan) -> some View {
        VStack(spacing: 8) {
            if p.target == nil {
                NOMWebLink(title: "まとめて取り込む（ScanSnap など）", sub: "金額・日付を読んで自動で出金・月払いに仕分けます", icon: "square.stack.3d.down.right") {
                    onOpen("/app/scan#scan-bulk")
                }
            }
            NOMWebLink(title: "保存ボックス", sub: "種別・金額の仕分け（Web）", icon: "tray.full") { onOpen("/app/invoices?tab=inbox") }
        }
    }
}

// MARK: - 撮影 → 切り取り・確認

/// カメラ → 切り取り・確認（写真から選んだ 1 枚は、いきなり切り取り・確認）
struct NOMCaptureFlow: View {
    let onSave: (UIImage) -> Void
    let onClose: () -> Void
    @State private var image: UIImage?

    init(initial: UIImage?, onSave: @escaping (UIImage) -> Void, onClose: @escaping () -> Void) {
        self.onSave = onSave
        self.onClose = onClose
        _image = State(initialValue: initial)
    }

    var body: some View {
        if let img = image {
            NOMShotConfirmView(image: img, onRetake: { image = nil }, onCancel: onClose, onSave: onSave)
        } else {
            NOMCameraPicker { img in
                if let img { image = img } else { onClose() }
            }
            .ignoresSafeArea()
        }
    }
}

/// カメラ（UIImagePickerController。カメラが無い端末では写真から選ぶ）
struct NOMCameraPicker: UIViewControllerRepresentable {
    let onDone: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let vc = UIImagePickerController()
        vc.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (UIImage?) -> Void
        init(onDone: @escaping (UIImage?) -> Void) { self.onDone = onDone }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onDone(nil) }
    }
}

/// 撮った写真の切り取り・回転・確認（四隅の ● を動かす）
struct NOMShotConfirmView: View {
    let onRetake: () -> Void
    let onCancel: () -> Void
    let onSave: (UIImage) -> Void
    @State private var image: UIImage
    /// 切り取る範囲（0〜1。写真の幅・高さに対して）
    @State private var crop = CGRect(x: 0, y: 0, width: 1, height: 1)
    @State private var dragStart: CGRect?
    @State private var saving = false

    private static let full = CGRect(x: 0, y: 0, width: 1, height: 1)

    init(image: UIImage, onRetake: @escaping () -> Void, onCancel: @escaping () -> Void, onSave: @escaping (UIImage) -> Void) {
        self.onRetake = onRetake
        self.onCancel = onCancel
        self.onSave = onSave
        _image = State(initialValue: image.nomUpright())
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("キャンセル", action: onCancel).font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                Spacer()
                Text("切り取り・確認").font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                Spacer()
                Button("撮り直す", action: onRetake).font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
            }
            .padding(.horizontal, 16).frame(height: 52)
            GeometryReader { g in
                let fit = Self.fitRect(image.size, in: CGRect(origin: .zero, size: g.size).insetBy(dx: 20, dy: 20))
                let r = CGRect(x: fit.minX + crop.minX * fit.width, y: fit.minY + crop.minY * fit.height,
                               width: crop.width * fit.width, height: crop.height * fit.height)
                ZStack {
                    Image(uiImage: image).resizable().scaledToFit()
                        .frame(width: fit.width, height: fit.height)
                        .position(x: fit.midX, y: fit.midY)
                    Path { path in
                        path.addRect(fit)
                        path.addRect(r)
                    }
                    .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
                    .allowsHitTesting(false)
                    Rectangle().stroke(Color.white, lineWidth: 2)
                        .frame(width: r.width, height: r.height)
                        .position(x: r.midX, y: r.midY)
                        .allowsHitTesting(false)
                    ForEach(0..<4, id: \.self) { c in handle(c, rect: r, fit: fit) }
                }
                .frame(width: g.size.width, height: g.size.height)
            }
            Text("四隅の ● を動かすと、レシートのところだけにできます").font(.system(size: 12)).foregroundColor(.white.opacity(0.75)).padding(.top, 4)
            HStack(spacing: 10) {
                tool("回転", icon: "rotate.right") {
                    image = image.nomRotated()
                    crop = Self.full
                }
                tool("全体", icon: "arrow.up.left.and.arrow.down.right") { crop = Self.full }
                Button {
                    guard !saving else { return }
                    saving = true
                    onSave(image.nomCropped(crop))
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark").font(.system(size: 15, weight: .heavy))
                        Text("この写真を保存").font(.system(size: 16, weight: .heavy))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
                .disabled(saving)
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 14)
        }
        .background(Color.black.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
    }

    private func tool(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 17, weight: .bold))
                Text(title).font(.system(size: 11, weight: .bold))
            }
            .foregroundColor(.white)
            .frame(width: 64, height: 54)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.14)))
        }
        .buttonStyle(PressableStyle())
    }

    /// 0＝左上、1＝右上、2＝左下、3＝右下
    private func handle(_ corner: Int, rect r: CGRect, fit: CGRect) -> some View {
        let left = corner % 2 == 0
        let top = corner < 2
        return Circle().fill(Color.white)
            .frame(width: 26, height: 26)
            .overlay(Circle().stroke(NT.purple, lineWidth: 3))
            .frame(width: 52, height: 52)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        if dragStart == nil { dragStart = crop }
                        let base = dragStart ?? crop
                        let dx = v.translation.width / max(1, fit.width)
                        let dy = v.translation.height / max(1, fit.height)
                        let m: CGFloat = 0.08
                        var minX = base.minX, minY = base.minY, maxX = base.maxX, maxY = base.maxY
                        if left { minX = min(max(0, base.minX + dx), maxX - m) } else { maxX = max(min(1, base.maxX + dx), minX + m) }
                        if top { minY = min(max(0, base.minY + dy), maxY - m) } else { maxY = max(min(1, base.maxY + dy), minY + m) }
                        crop = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .position(x: left ? r.minX : r.maxX, y: top ? r.minY : r.maxY)
    }

    /// 枠の中に縦横比を保って入れたときの写真の場所
    static func fitRect(_ size: CGSize, in box: CGRect) -> CGRect {
        guard size.width > 0, size.height > 0, box.width > 0, box.height > 0 else { return box }
        let s = min(box.width / size.width, box.height / size.height)
        let w = size.width * s, h = size.height * s
        return CGRect(x: box.midX - w / 2, y: box.midY - h / 2, width: w, height: h)
    }
}

// MARK: - key "scan" の画面（NativePhoneOwnerScreen から。#scan-bulk は key "scanBulk"＝NativePhoneOwnerScanBulk.swift）

struct NativePhoneOwnerScanScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NOMScanModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NOMScanModel(tx: route.query("tx")))
    }

    var body: some View {
        NativePhoneOwnerScanView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "scan", useWeb: model.useWeb, state: state))
    }
}
