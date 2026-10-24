import SwiftUI
import PhotosUI
import UIKit

// スキャン（レシート撮影・ネイティブ）。Web の /app/scan と同じ（2026-10-24）
//   撮影・取り込み（カメラ・写真から複数枚）→ 保存ボックスへ。?tx= の出金があればその出金にレシートを紐付ける
//   レシート未添付の出金（本日）・レシートボックス（日ごとのフォルダ）・種別の絞込
//   ScanSnap のまとめて取り込み（読み取り・自動仕分け）と保存ボックスの仕分けは Web

struct SCNTarget: Codable { let id: String; let main: String; let sub: String?; let date: String; let occurredAt: String; let kindLabel: String; let amount: Int; let hasReceipt: Bool }
struct SCNNeed: Codable, Identifiable { let id: String; let occurredAt: String; let main: String; let sub: String; let amount: Int; let isAdvance: Bool }
struct SCNMonth: Codable { let count: Int; let receipts: Int; let inbox: Int }
struct SCNDoc: Codable, Identifiable { let id: String; let createdAt: String; let fileName: String; let title: String?; let docType: String; let typeLabel: String; let status: String; let amount: Int?; let linked: Bool }
struct SCNFolder: Codable, Identifiable { var id: String { day }; let day: String; let docs: [SCNDoc] }
struct SCNPayload: Codable {
    let canUpload: Bool; let canLink: Bool; let canClose: Bool; let today: String; let filter: String
    let target: SCNTarget?; let txMissing: Bool; let needsReceipt: [SCNNeed]; let needsTotal: Int; let month: SCNMonth; let folders: [SCNFolder]
}

/// アップロードの1件（Web の ScanCapture の Task と同じ状態）
struct SCNTask: Identifiable { let id = UUID(); let name: String; var status: String; var message: String? }

@MainActor
final class NativeScanModel: ObservableObject {
    @Published var payload: SCNPayload?
    @Published var filter = ""
    @Published var tx: String?
    @Published var tasks: [SCNTask] = []
    @Published var error: String?

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "scan"), URLQueryItem(name: "type", value: filter), URLQueryItem(name: "tx", value: tx ?? "")]
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(SCNPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(SCNPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    /// 写真を JPEG にして（長い辺 2400px・3MB まで）送る
    func upload(_ images: [UIImage]) async {
        let list = Array(images.prefix(tx != nil ? 1 : 20))
        for (i, img) in list.enumerated() {
            let name = "scan_\(Int(Date().timeIntervalSince1970))_\(i + 1).jpg"
            var task = SCNTask(name: name, status: "uploading")
            tasks.insert(task, at: 0)
            guard let jpeg = Self.jpeg(img) else {
                task.status = "failed"; task.message = "写真を読み込めませんでした"; replace(task); continue
            }
            let linkTx: Any = {
                if let t = tx, payload?.target?.id == t, payload?.canLink ?? false { return t }
                return NSNull()
            }()
            let body: [String: Any] = ["type": "scanUpload", "fileName": name, "mimeType": "image/jpeg", "dataBase64": jpeg.base64EncodedString(), "txId": linkTx]
            do {
                let r = try await NativeAPI.shared.floorAct(body)
                if r.ok {
                    task.status = "success"
                    task.message = (r.queued ?? 0) > 0 ? "保存して出金に紐付けました" : "保存ボックスに保存しました"
                } else {
                    task.status = "failed"; task.message = r.error ?? "登録に失敗しました"
                }
            } catch {
                task.status = "failed"; task.message = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            }
            replace(task)
        }
        tasks = Array(tasks.prefix(20))
        await refresh()
    }

    private func replace(_ t: SCNTask) { if let i = tasks.firstIndex(where: { $0.id == t.id }) { tasks[i] = t } }

    static func jpeg(_ img: UIImage) -> Data? {
        let maxSide: CGFloat = 2400
        let s = img.size
        let scale = min(1, maxSide / max(s.width, s.height))
        let size = CGSize(width: floor(s.width * scale), height: floor(s.height * scale))
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        var q: CGFloat = 0.8
        while q >= 0.3 {
            if let d = resized.jpegData(compressionQuality: q), d.count <= 3_000_000 { return d }
            q -= 0.15
        }
        return nil
    }
}

struct NativeScanView: View {
    @ObservedObject var model: NativeScanModel
    let onHome: () -> Void
    let onWeb: (String) -> Void
    let onCashClose: () -> Void
    let onPetty: () -> Void

    @State private var showCamera = false
    @State private var picks: [PhotosPickerItem] = []
    @State private var closed: Set<String> = []

    private let chips: [(String, String)] = [("", "すべて"), ("inbox", "未仕分け"), ("receipt", "領収書・レシート"), ("invoice", "請求書"), ("delivery_note", "納品書"), ("other", "その他")]

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "スキャン", subtitle: "Snap & file", onHome: onHome)
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Text("レシート・請求書を撮るだけで保存ボックスへ。出金のレシートはその場で紐付けできます").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            Spacer()
                            if p.canClose { pill("lock", "レジクローズ") { onCashClose() } }
                            pill("tray", "保存ボックス") { onWeb("/app/invoices?tab=inbox") }
                        }
                        if p.txMissing {
                            Label("指定された出金が見つかりません（取消済み・他店舗の可能性があります）。通常のスキャンとして保存できます。", systemImage: "exclamationmark.triangle")
                                .font(.system(size: 13)).foregroundColor(NFColor.danger).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft))
                        }
                        if let t = p.target { targetCard(t, p) }
                        if p.target == nil {
                            Button { onWeb("/app/scan#scan-bulk") } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "square.stack.3d.down.right")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("まとめて取り込む（ScanSnap など）").font(.system(size: 14, weight: .bold))
                                        Text("金額・日付を読んで自動で出金・月払いに仕分けます（Web）").font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                                    }
                                    Spacer(); Image(systemName: "chevron.right").foregroundColor(NFColor.ink3)
                                }
                                .foregroundColor(NFColor.navy).padding(14)
                                .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
                            }.buttonStyle(.plain)
                        }
                        HStack(alignment: .top, spacing: 14) {
                            VStack(spacing: 14) {
                                captureCard(p)
                                needsCard(p)
                            }
                            .frame(maxWidth: .infinity)
                            boxCard(p).frame(maxWidth: .infinity)
                        }
                    }
                    .padding(16)
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center); Button("もう一度") { Task { await model.refresh() } } }.padding(30)
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task { await model.refresh() }
        .onChange(of: model.filter) { _ in Task { await model.refresh() } }
        .onChange(of: model.tx) { _ in Task { await model.refresh() } }
        .fullScreenCover(isPresented: $showCamera) {
            SCNCameraPicker { img in
                showCamera = false
                if let img { Task { await model.upload([img]) } }
            }
            .ignoresSafeArea()
        }
        .onChange(of: picks) { items in
            guard !items.isEmpty else { return }
            Task {
                var imgs: [UIImage] = []
                for it in items {
                    if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { imgs.append(img) }
                }
                picks = []
                await model.upload(imgs)
            }
        }
    }

    private func pill(_ icon: String, _ t: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) { Image(systemName: icon); Text(t) }
                .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 38)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle())
    }

    private func card<C: View>(_ title: String, en: String, trailing: AnyView? = nil, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(.system(size: 16, weight: .heavy)).foregroundColor(NFColor.navy)
                Text(en).font(.system(size: 10.5, weight: .semibold)).foregroundColor(NFColor.ink3)
                Spacer()
                if let trailing { trailing }
            }.padding(14)
            c()
        }
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
    }

    private func targetCard(_ t: SCNTarget, _ p: SCNPayload) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) { Text("この出金のレシートを撮影").font(.system(size: 12, weight: .bold)); Text("Receipt for this payout").font(.system(size: 10)) }.foregroundColor(NFColor.royal)
                HStack(spacing: 8) {
                    Text(t.main).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                    if let s = t.sub { Text(s).font(.system(size: 13)).foregroundColor(NFColor.ink3).lineLimit(1) }
                }
                Text("\(NPDate.slash(t.date)) \(NFTime.hm(iso: t.occurredAt)) ・ \(t.kindLabel)").font(.system(size: 12)).monospacedDigit().foregroundColor(NFColor.ink3)
                if !p.canLink { Text("出金への紐付けには小口現金の登録権限が必要です（書類の保存のみ行えます）。").font(.system(size: 12)).foregroundColor(NFColor.danger) }
            }
            Spacer()
            NPBadge(text: t.hasReceipt ? "✓ レシート登録済み（撮り直すと差し替え）" : "レシート未添付", color: t.hasReceipt ? Color(hex: 0x1E8F62) : NFColor.ink3)
            Text(NT.yen(t.amount)).font(.system(size: 24, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
            Button { model.tx = nil } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundColor(NFColor.ink3) }.buttonStyle(.plain)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.iris.opacity(0.4), lineWidth: 1.5))
    }

    private func captureCard(_ p: SCNPayload) -> some View {
        card("撮影・取り込み", en: "Capture", trailing: AnyView(Text("\(p.target != nil ? "1枚ずつ" : "複数枚OK") ・ 写真から選ぶことも").font(.system(size: 12)).foregroundColor(NFColor.ink3))) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Button { showCamera = true } label: {
                        HStack(spacing: 8) { Image(systemName: "camera.fill"); Text("撮影する") }
                            .font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 64)
                            .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.iris))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                    PhotosPicker(selection: $picks, maxSelectionCount: p.target != nil ? 1 : 20, matching: .images) {
                        HStack(spacing: 8) { Image(systemName: "photo.on.rectangle"); Text("写真から選ぶ") }
                            .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.royal)
                            .frame(maxWidth: .infinity).frame(height: 64)
                            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.wisteria, lineWidth: 1.5))
                    }
                }
                ForEach(model.tasks) { t in
                    HStack(spacing: 8) {
                        if t.status == "uploading" { ProgressView().tint(NFColor.iris) }
                        else if t.status == "success" { Image(systemName: "checkmark.circle.fill").foregroundColor(Color(hex: 0x1E8F62)) }
                        else { Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NFColor.danger) }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(t.name).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                            Text(t.status == "uploading" ? "アップロード中…" : (t.message ?? "")).font(.system(size: 11.5)).foregroundColor(t.status == "failed" ? NFColor.danger : NFColor.ink3)
                        }
                        Spacer()
                    }
                    .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xF6F6F9)))
                }
                Text("写真は JPEG にして保存します。保存した書類は「保存ボックス」で種別・金額を仕分けできます。ScanSnap などでまとめて取り込むときは上の「まとめて取り込む」を使うと、金額・日付を読んで自動で仕分けます。")
                    .font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 14).padding(.bottom, 14)
        }
    }

    private func needsCard(_ p: SCNPayload) -> some View {
        card("レシート未添付の出金", en: "Needs receipt", trailing: AnyView(
            Text("本日 \(p.needsReceipt.count)件\(p.needsReceipt.isEmpty ? "" : "（\(NT.yen(p.needsTotal))）")").font(.system(size: 13, weight: .bold)).monospacedDigit()
                .foregroundColor(p.needsReceipt.isEmpty ? Color(hex: 0x1E8F62) : NFColor.ink2))) {
            VStack(spacing: 0) {
                if p.needsReceipt.isEmpty {
                    Label("本日の出金はすべてレシートがあります", systemImage: "checkmark.circle.fill").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                ForEach(p.needsReceipt) { r in
                    let active = p.target?.id == r.id
                    HStack(spacing: 10) {
                        Text(NFTime.hm(iso: r.occurredAt)).font(.system(size: 12, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink3).frame(width: 46, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.main).font(.system(size: 13)).foregroundColor(NFColor.ink).lineLimit(1)
                            Text(r.sub).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1)
                        }
                        Spacer()
                        Text(NT.yen(r.amount)).font(.system(size: 13, weight: .bold)).monospacedDigit()
                        if active { NPBadge(text: "撮影中", color: NFColor.ink3) }
                        else if r.isAdvance { small("精算へ") { onPetty() } }
                        else { small("撮る") { model.tx = r.id } }
                    }
                    .padding(.horizontal, 14).frame(minHeight: 48)
                    .background(active ? NFColor.lilacSoft : NFColor.dangerSoft.opacity(0.6))
                    .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                HStack {
                    Spacer()
                    Button("レジクローズで出金レシートを確認 →") { onCashClose() }.font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.royal)
                }
                .padding(.horizontal, 14).frame(height: 40)
                .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
            }
        }
    }

    private func small(_ t: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 12.5, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 12).frame(height: 32).background(RoundedRectangle(cornerRadius: 8).fill(NFColor.iris))
        }.buttonStyle(PressableStyle())
    }

    private func boxCard(_ p: SCNPayload) -> some View {
        card("レシートボックス", en: "Receipt box") {
            VStack(alignment: .leading, spacing: 0) {
                NCFlow(spacing: 6) {
                    ForEach(chips, id: \.0) { k, label in
                        let on = model.filter == k
                        Button { model.filter = k } label: {
                            Text(label).font(.system(size: 12.5, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                                .padding(.horizontal, 12).frame(height: 30)
                                .background(Capsule().fill(on ? NFColor.iris : NFColor.lilacSoft))
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 10)
                HStack(spacing: 4) {
                    Text("今月"); Text("\(p.month.count)").bold(); Text("件スキャン ・ 領収書"); Text("\(p.month.receipts)").bold(); Text("・ 未仕分け")
                    Text("\(p.month.inbox)").bold().foregroundColor(p.month.inbox > 0 ? Color(hex: 0xC27C0E) : NFColor.ink2)
                }
                .font(.system(size: 13)).monospacedDigit().foregroundColor(NFColor.ink2)
                .padding(.horizontal, 14).frame(height: 38).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                if p.folders.isEmpty {
                    Text(p.filter.isEmpty ? "まだスキャンした書類はありません。左の「撮影する」から始めましょう" : "この条件の書類はありません")
                        .font(.system(size: 13)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 40)
                        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                ForEach(Array(p.folders.enumerated()), id: \.element.day) { i, f in
                    let open = !closed.contains(f.day) && (i == 0 || f.day == p.today || closed.contains("open:" + f.day))
                    folderHeader(f, p, open: open)
                    if open { ForEach(f.docs) { d in docRow(d) } }
                }
            }
        }
    }

    private func folderHeader(_ f: SCNFolder, _ p: SCNPayload, open: Bool) -> some View {
        let inbox = f.docs.filter { $0.status == "inbox" }.count
        let total = f.docs.reduce(0) { $0 + ($1.amount ?? 0) }
        return Button {
            if open { closed.insert(f.day); closed.remove("open:" + f.day) } else { closed.remove(f.day); closed.insert("open:" + f.day) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill").foregroundColor(NFColor.iris)
                Text(Self.dayLabel(f.day)).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink)
                if f.day == p.today { Text("今日").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.iris) }
                Text("\(f.docs.count)件").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                if inbox > 0 { Text("・ 未仕分け \(inbox)").font(.system(size: 12, weight: .bold)).foregroundColor(Color(hex: 0xC27C0E)) }
                Spacer()
                if total > 0 { Text(NT.yen(total)).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink) }
                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .monospacedDigit().padding(.horizontal, 14).frame(height: 44)
            .background(NFColor.lilacSoft.opacity(0.6)).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func docRow(_ d: SCNDoc) -> some View {
        Button { onWeb("/app/invoices?tab=\(d.status == "inbox" ? "inbox" : "documents")") } label: {
            HStack(spacing: 10) {
                Image(systemName: d.docType == "delivery_note" ? "shippingbox" : d.docType == "invoice" ? "doc.text" : "receipt")
                    .font(.system(size: 18)).foregroundColor(NFColor.royal).frame(width: 42, height: 42)
                    .background(RoundedRectangle(cornerRadius: 9).fill(NFColor.lilac))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(d.typeLabel).font(.system(size: 10, weight: .heavy)).foregroundColor(.white).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(RoundedRectangle(cornerRadius: 5).fill(Self.tagColor(d.docType)))
                        Text(d.title ?? d.fileName).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                    }
                    HStack(spacing: 4) {
                        Text("\(NativeNoticesView.dateTime(d.createdAt).dropFirst(5)) ・ \(d.title != nil ? d.fileName : "スキャン")").lineLimit(1)
                        if d.linked { Text("✓ 出金に紐付け済").bold().foregroundColor(Color(hex: 0x1E8F62)) }
                    }
                    .font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(d.amount.map { NT.yen($0) } ?? "—").font(.system(size: 14, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
                    NPBadge(text: d.status == "inbox" ? "未仕分け" : "仕分け済", color: d.status == "inbox" ? Color(hex: 0xC27C0E) : Color(hex: 0x1E8F62))
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 8).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    static func tagColor(_ t: String) -> Color {
        switch t {
        case "receipt", "register_receipt": return Color(hex: 0xE0A21B)
        case "invoice": return NFColor.iris
        case "delivery_note": return Color(hex: 0x1E8F62)
        default: return NFColor.ink3
        }
    }

    /// 'YYYY-MM-DD' → '10/20（火）'
    static func dayLabel(_ day: String) -> String {
        let w = ["日", "月", "火", "水", "木", "金", "土"]
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        let wd = cal.component(.weekday, from: NPDate.date(day)) - 1
        return "\(Int(day.dropFirst(5).prefix(2)) ?? 0)/\(Int(day.suffix(2)) ?? 0)（\(w[max(0, min(6, wd))])）"
    }
}

/// カメラ（UIImagePickerController）
struct SCNCameraPicker: UIViewControllerRepresentable {
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
