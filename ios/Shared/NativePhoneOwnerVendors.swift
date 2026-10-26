import SwiftUI

// iPhone の店長・オーナー：仕入先（Web の /app/vendors。2026-10-25 Ronnie「iPhone も native に」）
//   一覧（名前で探す・状態：取引中・休止・削除済み）・今月仕入額・進行中の発注
//   仕入先を押すと詳細：電話・メール（押すとかける・書く）・締め日・支払日・振込先・メモ・直近の発注（押すと発注書）
//   登録・編集・削除（理由が要る）・この仕入先で発注書を作成（ネイティブの「発注」へ）
// サーバーは iPad と同じ：GET part=vendors|vendorOrders ／ POST vendorSave・vendorDelete（vendors.manage）

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPZVendor: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let nameKana: String?
    let contactName: String?
    let phone: String?
    let email: String?
    let address: String?
    let closingDay: Int?
    let paymentDay: Int?
    let bankInfo: String?
    let note: String?
    let status: String
    let monthlyInvoiceTotal: Double?
    let monthlyPurchaseTotal: Double?
    let activePoCount: Int?
}

struct NPZVendorsPayload: Decodable {
    let rows: [NPZVendor]
    let canManage: Bool
}

struct NPZVendorOrder: Decodable, Identifiable, Hashable {
    let id: String
    let poNo: Int
    let status: String
    let total: Double
    let expectedAt: String?
}

struct NPZVendorOrders: Decodable {
    let rows: [NPZVendorOrder]
}

enum NPZVendorText {
    static let statuses: [(String, String)] = [("", "すべて"), ("active", "取引中"), ("inactive", "休止"), ("deleted", "削除済み")]

    static func status(_ s: String) -> (String, Color) {
        switch s {
        case "active": return ("取引中", NT.ok)
        case "inactive": return ("休止", NT.ink3)
        case "deleted": return ("削除済み", NT.danger)
        default: return (s, NT.ink3)
        }
    }

    /// 31 は月末（Web と同じ）
    static func day(_ d: Int?) -> String {
        guard let d else { return "—" }
        return d >= 31 ? "月末" : "\(d)日"
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPZVendorsModel: ObservableObject {
    @Published var payload: NPZVendorsPayload?
    @Published var q = ""
    @Published var status = ""
    @Published var loading = false
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いている仕入先（一覧に無くなっても最後の中身で出す）
    @Published var open: NPZVendor?
    @Published var orders: [String: [NPZVendorOrder]] = [:]

    init(route: NativeModuleRoute? = nil) {
        if let route {
            q = route.query("q") ?? ""
            status = route.query("status") ?? ""
        }
        payload = NPZApi.cached(NPZVendorsPayload.self, "vendors", query())
    }

    func query() -> [String: String] {
        var d: [String: String] = [:]
        let t = NPZ.trimmed(q)
        if !t.isEmpty { d["q"] = t }
        if !status.isEmpty { d["status"] = status }
        return d
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let qy = query()
        loading = true
        defer { loading = false }
        do {
            let p = try await NPZApi.get(NPZVendorsPayload.self, "vendors", qy)
            guard qy == query() else { return }
            payload = p
            if let o = open, let fresh = p.rows.first(where: { $0.id == o.id }) { open = fresh }
            error = nil
        } catch {
            if NPZApi.useWeb(error) { useWeb = true; return }
            self.error = NPZApi.message(error)
        }
    }

    func loadOrders(_ id: String) async {
        if NativePreview.current != nil { return }
        do {
            orders[id] = try await NPZApi.get(NPZVendorOrders.self, "vendorOrders", ["id": id]).rows
        } catch {
            if orders[id] == nil { orders[id] = [] }
        }
    }

    func act(_ body: [String: Any]) async -> NPZResult {
        busy = true
        defer { busy = false }
        return await NPZApi.post(body)
    }
}

// MARK: - 画面

/// key "vendors" の画面（NativePhoneOwnerScreen から）
struct NativePhoneVendorsScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPZVendorsModel

    init(route: NativeModuleRoute) {
        _model = StateObject(wrappedValue: NPZVendorsModel(route: route))
    }

    var body: some View {
        NativePhoneVendorsView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "vendors", useWeb: model.useWeb, state: state))
    }
}

struct NPZVendorFormRef: Identifiable {
    let vendor: NPZVendor?
    var id: String { vendor?.id ?? "new" }
}

struct NativePhoneVendorsView: View {
    @ObservedObject var model: NPZVendorsModel
    let onBack: () -> Void
    let onOpen: (String) -> Void

    @State private var form: NPZVendorFormRef?
    @State private var deleting: NPZVendor?

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "仕入先", subtitle: "Vendors", onBack: onBack, trailing: {
                if model.payload?.canManage == true {
                    NPOCBarButton(icon: "plus", label: "登録") { form = NPZVendorFormRef(vendor: nil) }
                } else {
                    NPZRefreshButton(loading: model.loading) { Task { await model.refresh() } }
                }
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        list(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            if let v = model.open {
                detail(v)
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
            }
            NPHToast(text: $model.toast).zIndex(3)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.22), value: model.open?.id)
        .task { await model.refresh() }
        .sheet(item: $form) { f in
            NPZVendorFormSheet(model: model, vendor: f.vendor, onClose: { form = nil })
        }
        .sheet(item: $deleting) { v in
            NPZReasonSheet(title: "仕入先を削除", message: "「\(v.name)」を削除します。発注・請求書の記録は残ります。", okText: "削除する", busy: model.busy, send: { reason in
                let r = await model.act(["type": "vendorDelete", "id": v.id, "reason": reason])
                guard r.ok else { return r.error ?? "削除できませんでした" }
                model.toast = "仕入先を削除しました"
                model.open = nil
                await model.refresh()
                return nil
            }, onClose: { deleting = nil })
        }
    }

    // MARK: 一覧

    private func list(_ p: NPZVendorsPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                NPZSearchField(text: $model.q, placeholder: "仕入先名で探す") { Task { await model.refresh() } }
                NPZChipRow(items: NPZVendorText.statuses, selection: model.status) { s in
                    model.status = s
                    Task { await model.refresh() }
                }
                if p.rows.isEmpty {
                    NPOCEmpty(icon: "building.2", title: "仕入先がありません", note: p.canManage ? "右上の「＋ 登録」から取引先を追加できます" : "")
                } else {
                    Text("\(p.rows.count)件・押すと連絡先・発注履歴").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).padding(.leading, 4)
                    ForEach(p.rows) { v in
                        Button { model.open = v } label: { row(v) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 60)
        }
        .refreshable { await model.refresh() }
        .scrollDismissesKeyboard(.interactively)
    }

    private func row(_ v: NPZVendor) -> some View {
        let st = NPZVendorText.status(v.status)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(v.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                    if let k = v.nameKana, !k.isEmpty { Text(k).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                }
                Spacer(minLength: 6)
                NOSBadge(text: st.0, color: st.1)
            }
            HStack(spacing: 10) {
                if let c = v.contactName, !c.isEmpty { Label(c, systemImage: "person") }
                if let ph = v.phone, !ph.isEmpty { Label(ph, systemImage: "phone") }
                Spacer(minLength: 0)
            }
            .font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2).labelStyle(NOSCompactLabel()).lineLimit(1)
            HStack(spacing: 10) {
                Text("今月仕入 \(NPZ.yen(v.monthlyPurchaseTotal ?? 0))")
                if (v.activePoCount ?? 0) > 0 { Text("進行中の発注 \(v.activePoCount ?? 0)件").foregroundColor(NT.purpleDeep) }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1)
        }
        .padding(12)
        .background(npocCard(14))
    }

    // MARK: 詳細

    private func detail(_ v: NPZVendor) -> some View {
        let canManage = model.payload?.canManage == true
        let st = NPZVendorText.status(v.status)
        return NPOCDetailFrame(title: v.name, subtitle: v.nameKana ?? "", backLabel: "仕入先", onBack: { model.open = nil }, trailing: {
            if canManage {
                NPOCBarButton(icon: "pencil", label: "編集") { form = NPZVendorFormRef(vendor: v) }
            }
        }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) {
                        NOSBadge(text: st.0, color: st.1)
                        Spacer()
                    }
                    NPZTileGrid {
                        NPZTile(label: "今月の仕入額", value: NPZ.yen(v.monthlyPurchaseTotal ?? 0), tone: NT.purpleDeep, sub: "入荷済みの発注")
                        NPZTile(label: "当月の請求額", value: NPZ.yen(v.monthlyInvoiceTotal ?? 0))
                    }
                    contactCard(v)
                    NPOCard(title: "取引条件") {
                        NPZInfoRow(label: "締め日", value: NPZVendorText.day(v.closingDay))
                        NPZInfoRow(label: "支払日", value: NPZVendorText.day(v.paymentDay))
                        if let b = v.bankInfo, !b.isEmpty { NPZInfoRow(label: "振込先", value: b) }
                        if let n = v.note, !n.isEmpty {
                            NPZDivider()
                            Text(n).font(.system(size: 13.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    ordersCard(v)
                    if canManage && v.status != "deleted" {
                        NPOCWideButton(text: "この仕入先で発注書を作成", icon: "doc.badge.plus", kind: .primary) { onOpen("/app/purchases/new?vendor=\(v.id)") }
                        NPOCWideButton(text: "仕入先を削除", icon: "trash", kind: .secondary) { deleting = v }
                    }
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 50)
            }
            .refreshable {
                await model.refresh()
                await model.loadOrders(v.id)
            }
        }
        .task(id: v.id) { await model.loadOrders(v.id) }
    }

    private func contactCard(_ v: NPZVendor) -> some View {
        NPOCard(title: "連絡先") {
            if let c = v.contactName, !c.isEmpty { NPZInfoRow(label: "担当者", value: c) }
            if let ph = v.phone, !ph.isEmpty {
                contactButton(icon: "phone.fill", text: ph, url: URL(string: "tel:" + ph.filter { $0.isNumber || $0 == "+" }))
            }
            if let m = v.email, !m.isEmpty {
                contactButton(icon: "envelope.fill", text: m, url: URL(string: "mailto:" + m))
            }
            if let a = v.address, !a.isEmpty { NPZInfoRow(label: "住所", value: a) }
            if (v.contactName ?? "").isEmpty && (v.phone ?? "").isEmpty && (v.email ?? "").isEmpty && (v.address ?? "").isEmpty {
                Text("連絡先は登録されていません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
        }
    }

    private func contactButton(icon: String, text: String, url: URL?) -> some View {
        Button {
            if let url { UIApplication.shared.open(url) }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .frame(width: 32, height: 32).background(Circle().fill(NT.purple))
                Text(text).font(.system(size: 15, weight: .bold)).foregroundColor(NT.purpleDeep).lineLimit(1)
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }

    @ViewBuilder private func ordersCard(_ v: NPZVendor) -> some View {
        NPOCard(title: "直近の発注", trailing: "最大5件") {
            if let rows = model.orders[v.id] {
                if rows.isEmpty {
                    Text("発注の記録はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
                } else {
                    ForEach(rows) { r in
                        let st = NPZPoText.status(r.status)
                        Button { onOpen("/app/purchases/\(r.id)") } label: {
                            HStack(spacing: 8) {
                                Text("#\(r.poNo)").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                                NOSBadge(text: st.0, color: st.1)
                                Spacer(minLength: 4)
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text(NPZ.yen(r.total)).font(.system(size: 14.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                                    Text("入荷予定 \(NPZ.date(r.expectedAt))").font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3)
                                }
                                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else {
                ProgressView().tint(NT.purple).frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - 仕入先の登録・編集（Web の VendorForm と同じ）

struct NPZVendorFormSheet: View {
    @ObservedObject var model: NPZVendorsModel
    let vendor: NPZVendor?
    let onClose: () -> Void

    @State private var name = ""
    @State private var kana = ""
    @State private var contact = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var address = ""
    @State private var closing = ""
    @State private var payment = ""
    @State private var bank = ""
    @State private var note = ""
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        NPOCSheetFrame(title: vendor == nil ? "仕入先を登録" : "仕入先を編集", confirmText: model.busy ? "保存中…" : (vendor == nil ? "登録する" : "更新する"),
                       busy: model.busy, onCancel: onClose, onConfirm: { Task { await save() } }) {
            NPZTextField(label: "名前（必須）", text: $name, placeholder: "例：TENPO ONE 青果")
            NPZTextField(label: "カナ", text: $kana)
            NPZTextField(label: "担当者", text: $contact)
            NPOCField(label: "電話番号") {
                TextField("03-0000-0000", text: $phone).keyboardType(.phonePad).font(.system(size: 17, weight: .semibold)).npocInputBox()
            }
            NPOCField(label: "メール") {
                TextField("example@example.com", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.system(size: 17, weight: .semibold)).npocInputBox()
            }
            NPZTextField(label: "住所", text: $address)
            HStack(alignment: .top, spacing: 10) {
                NPZTextField(label: "締め日（31＝月末）", text: $closing, placeholder: "31", number: true, suffix: "日")
                NPZTextField(label: "支払日", text: $payment, number: true, suffix: "日")
            }
            NPZTextField(label: "振込先", text: $bank)
            NPOCField(label: "メモ") {
                TextField("メモ", text: $note, axis: .vertical).lineLimit(2...6).font(.system(size: 16)).npocInputBox()
            }
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            guard let v = vendor else { return }
            name = v.name
            kana = v.nameKana ?? ""
            contact = v.contactName ?? ""
            phone = v.phone ?? ""
            email = v.email ?? ""
            address = v.address ?? ""
            closing = v.closingDay.map(String.init) ?? ""
            payment = v.paymentDay.map(String.init) ?? ""
            bank = v.bankInfo ?? ""
            note = v.note ?? ""
        }
    }

    private func save() async {
        error = nil
        guard !NPZ.trimmed(name).isEmpty else { error = "名前を入力してください"; return }
        func day(_ s: String) -> Any? {
            if NPZ.trimmed(s).isEmpty { return NSNull() }
            guard let n = NPZ.num(s), n == n.rounded(), n >= 1, n <= 31 else { return nil }
            return Int(n)
        }
        guard let c = day(closing), let pd = day(payment) else { error = "締め日・支払日は1〜31で入力してください"; return }
        var body: [String: Any] = [
            "type": "vendorSave", "name": NPZ.trimmed(name), "nameKana": kana, "contactName": contact, "phone": phone, "email": NPZ.trimmed(email),
            "address": address, "closingDay": c, "paymentDay": pd, "bankInfo": bank, "note": note,
        ]
        if let v = vendor { body["id"] = v.id }
        let r = await model.act(body)
        if r.ok {
            model.toast = vendor == nil ? "仕入先を登録しました" : "仕入先を更新しました"
            onClose()
            await model.refresh()
        } else {
            error = r.error ?? "保存に失敗しました"
        }
    }
}
