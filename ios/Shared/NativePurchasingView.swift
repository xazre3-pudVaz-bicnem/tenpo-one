import SwiftUI

// 仕入先・発注（ネイティブ）。Web の /app/vendors・/app/purchases（一覧・作成・詳細）と同じ（2026-10-24）
//   操作（仕入先の登録・編集・削除、発注書の作成・申請・承認・発注確定・取消・入荷登録）は Web と同じ Server Action を呼ぶ

// MARK: - データ

struct NUVendor: Codable, Identifiable, Hashable {
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
    let monthlyInvoiceTotal: Double
    let monthlyPurchaseTotal: Double
    let activePoCount: Int
}
struct NUVendorsPayload: Codable { let rows: [NUVendor]; let canManage: Bool }
struct NUVendorOrder: Codable, Identifiable, Hashable { let id: String; let poNo: Int; let status: String; let total: Double; let expectedAt: String? }
struct NUVendorOrders: Codable { let rows: [NUVendorOrder] }

struct NUPoRow: Codable, Identifiable, Hashable {
    let id: String
    let poNo: Int
    let status: String
    let total: Double
    let expectedAt: String?
    let vendorName: String?
    let storeName: String?
    let requesterName: String?
    let createdAt: String
}
struct NUPurchasesPayload: Codable { let rows: [NUPoRow]; let vendors: [NFNamed]; let canManage: Bool; let canCsv: Bool; let storeId: String? }
struct NUPoItemOption: Codable, Identifiable, Hashable { let id: String; let name: String; let unit: String; let avgCost: Double?; let purchaseUnit: String? }
struct NUPoNewPayload: Codable { let store: NFNamed; let vendors: [NFNamed]; let items: [NUPoItemOption] }
struct NUPoItem: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: Double
    let unit: String
    let unitCost: Double
    let taxRate: Double
    let receivedQuantity: Double
    let stockUnit: String
    let factor: Double
}
struct NUPo: Codable {
    let id: String
    let poNo: Int
    let status: String
    let storeId: String
    let vendorName: String
    let storeName: String
    let storeAddress: String?
    let storePhone: String?
    let total: Double
    let taxTotal: Double
    let subtotal: Double
    let expectedAt: String?
    let orderedAt: String?
    let createdAt: String
    let note: String?
    let requiredApprovalRoleLabel: String?
    let items: [NUPoItem]
}
struct NUPoPayload: Codable { let po: NUPo; let canManage: Bool }

enum NU {
    static let poStatus: [String: (String, Color)] = [
        "draft": ("下書き", NFColor.ink3), "requested": ("承認待ち", NFColor.saffron), "approved": ("承認済み", NFColor.iris),
        "ordered": ("発注済み", NFColor.iris), "partially_received": ("一部入荷", NFColor.saffron), "received": ("入荷済み", NFColor.success),
        "cancelled": ("取消", NFColor.danger),
    ]
    static let poStatusOrder = ["draft", "requested", "approved", "ordered", "partially_received", "received", "cancelled"]
    static let vendorStatus: [String: (String, Color)] = ["active": ("取引中", NFColor.success), "inactive": ("休止", NFColor.ink3), "deleted": ("削除済み", NFColor.danger)]
    static func badge(_ map: [String: (String, Color)], _ k: String) -> some View {
        let v = map[k] ?? (k, NFColor.ink3)
        return NPBadge(text: v.0, color: v.1)
    }
}

@MainActor
final class NativePurchasingModel: ObservableObject {
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    func get<T: Decodable>(_ items: [URLQueryItem]) async -> T? {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = items
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }

    func act(_ body: [String: Any]) async -> NIActResult {
        busy = true
        defer { busy = false }
        do {
            var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let data = try await NativeAPI.shared.send(req)
            return try JSONDecoder().decode(NIActResult.self, from: data)
        } catch {
            return NIActResult(ok: false, error: (error as? NativeAPIError)?.message ?? "通信できませんでした", id: nil)
        }
    }
}

/// 日付の入力（空にできる。yyyy-MM-dd）
struct NUDateField: View {
    let label: String
    @Binding var value: String
    @State private var open = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            Button { open = true } label: {
                HStack {
                    Text(value.isEmpty ? "—" : NI.date(value)).foregroundColor(value.isEmpty ? NFColor.ink3 : NFColor.ink)
                    Spacer()
                    Image(systemName: "calendar").foregroundColor(NFColor.ink3)
                }
                .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 12).frame(width: 170, height: 40)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .popover(isPresented: $open) {
                VStack(spacing: 10) {
                    DatePicker("", selection: Binding(get: { value.isEmpty ? Date() : NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date)
                        .datePickerStyle(.graphical).labelsHidden()
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    HStack {
                        Button("クリア") { value = ""; open = false }.foregroundColor(NFColor.danger)
                        Spacer()
                        Button("OK") { if value.isEmpty { value = NPDate.str(Date()) }; open = false }.bold()
                    }
                }
                .padding(16).frame(width: 340)
            }
        }
    }
}

// MARK: - 仕入先（/app/vendors）

struct NativeVendorsView: View {
    @ObservedObject var model: NativePurchasingModel
    let onHome: () -> Void
    let onWeb: (String) -> Void
    let onOpenPo: (String) -> Void

    @State private var payload: NUVendorsPayload?
    @State private var q = ""
    @State private var status = ""
    @State private var form: NUVendorFormTarget?
    @State private var deleting: NUVendor?
    @State private var history: NUVendor?

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "仕入先", subtitle: "Vendors", onHome: onHome)
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 10) {
                    Text("発注・請求書で使用する取引先マスタを管理します").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                    Spacer()
                    niSmallButton("入出金", icon: "arrow.left") { onWeb("/app/cash") }.frame(height: 44)
                    if payload?.canManage == true {
                        Button { form = NUVendorFormTarget(vendor: nil) } label: {
                            HStack(spacing: 6) { Image(systemName: "plus"); Text("仕入先を登録") }
                                .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 18).frame(height: 46)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
                        }.buttonStyle(PressableStyle())
                    }
                }
                filters
                ScrollView {
                    if let p = payload {
                        if p.rows.isEmpty {
                            niEmpty("仕入先が登録されていません", "「仕入先を登録」から取引先を追加してください")
                        } else { table(p) }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                    }
                }
            }
            .padding(16)
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: true))
        .task { await refresh() }
        .overlay {
            if let f = form {
                NativeModalCard(width: 720) { NUVendorForm(model: model, vendor: f.vendor, onClose: { form = nil }, onSaved: { Task { await refresh() } }) }
            } else if let v = deleting {
                NativeModalCard(width: 560) {
                    NUReasonDialog(model: model, title: "仕入先を削除", message: "「\(v.name)」を削除します。", okText: "削除する", request: ["type": "vendorDelete", "id": v.id], done: "仕入先を削除しました",
                                   onClose: { deleting = nil }, onDone: { Task { await refresh() } })
                }
            } else if let v = history {
                NativeModalCard(width: 760) { NUVendorHistory(model: model, vendor: v, onClose: { history = nil }, onOpenPo: { id in history = nil; onOpenPo(id) }) }
            }
        }
    }

    private func refresh() async {
        var items = [URLQueryItem(name: "part", value: "vendors")]
        if !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        if !status.isEmpty { items.append(URLQueryItem(name: "status", value: status)) }
        if let p: NUVendorsPayload = await model.get(items) { payload = p }
    }

    private var filters: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text("検索").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                TextField("仕入先名で検索", text: $q)
                    .font(.system(size: 15)).padding(.horizontal, 12).frame(width: 240, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    .submitLabel(.search).onSubmit { Task { await refresh() } }
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("状態").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                NIChoice(options: [("", "すべて（削除済み除く）"), ("active", "取引中"), ("inactive", "休止"), ("deleted", "削除済み")], value: $status).fixedSize()
            }
            niSmallButton("検索する", icon: "magnifyingglass", tone: .white, fill: NFColor.navy) { Task { await refresh() } }.frame(height: 40)
            Spacer(minLength: 0)
        }
    }

    private func table(_ p: NUVendorsPayload) -> some View {
        niCard {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text("名前").frame(maxWidth: .infinity, alignment: .leading)
                    Text("担当者").frame(width: 110, alignment: .leading)
                    Text("電話番号").frame(width: 130, alignment: .leading)
                    Text("状態").frame(width: 80, alignment: .leading)
                    Text("当月請求額").frame(width: 100, alignment: .trailing)
                    Text("今月仕入額").frame(width: 100, alignment: .trailing)
                    Text("進行中発注").frame(width: 80, alignment: .trailing)
                    Text("").frame(width: p.canManage ? 230 : 90)
                }
                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
                ForEach(p.rows) { v in
                    HStack(spacing: 8) {
                        (Text(v.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.navy)
                         + Text(v.nameKana.map { "（\($0)）" } ?? "").font(.system(size: 11)).foregroundColor(NFColor.ink3))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(v.contactName ?? "—").lineLimit(1).frame(width: 110, alignment: .leading)
                        Text(v.phone ?? "—").lineLimit(1).frame(width: 130, alignment: .leading)
                        NU.badge(NU.vendorStatus, v.status).frame(width: 80, alignment: .leading)
                        Text(NI.yen(v.monthlyInvoiceTotal)).monospacedDigit().frame(width: 100, alignment: .trailing)
                        Text(NI.yen(v.monthlyPurchaseTotal)).monospacedDigit().frame(width: 100, alignment: .trailing)
                        Text("\(v.activePoCount)件").monospacedDigit().frame(width: 80, alignment: .trailing)
                        HStack(spacing: 6) {
                            niSmallButton("発注履歴") { history = v }
                            if p.canManage {
                                niSmallButton("編集", icon: "pencil") { form = NUVendorFormTarget(vendor: v) }
                                if v.status != "deleted" { niSmallButton("削除", tone: .white, fill: NFColor.danger) { deleting = v } }
                            }
                        }
                        .frame(width: p.canManage ? 230 : 90, alignment: .trailing)
                    }
                    .font(.system(size: 13.5)).foregroundColor(NFColor.ink)
                    .padding(.horizontal, 14).frame(minHeight: 54)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                }
            }
        }
    }
}

struct NUVendorFormTarget: Identifiable { let id = UUID(); let vendor: NUVendor? }

/// 仕入先の登録・編集（Web の VendorForm と同じ）
struct NUVendorForm: View {
    @ObservedObject var model: NativePurchasingModel
    let vendor: NUVendor?
    let onClose: () -> Void
    let onSaved: () -> Void

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
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: vendor == nil ? "仕入先を登録" : "仕入先を編集", onClose: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    NIField(label: "名前", text: $name)
                    HStack(spacing: 12) { NIField(label: "カナ", text: $kana); NIField(label: "担当者", text: $contact) }
                    HStack(spacing: 12) { NIField(label: "電話番号", text: $phone); NIField(label: "メール", text: $email) }
                    NIField(label: "住所", text: $address)
                    HStack(spacing: 12) { NIField(label: "締め日", text: $closing, placeholder: "31=月末", number: true); NIField(label: "支払日", text: $payment, number: true) }
                    NIField(label: "振込先", text: $bank)
                    NIField(label: "メモ", text: $note)
                }
            }
            NIDialogFoot(error: error, busy: model.busy, okText: vendor == nil ? "登録する" : "更新する", busyText: "保存中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear {
            guard !loaded, let v = vendor else { return }
            loaded = true
            name = v.name; kana = v.nameKana ?? ""; contact = v.contactName ?? ""; phone = v.phone ?? ""; email = v.email ?? ""
            address = v.address ?? ""; closing = v.closingDay.map(String.init) ?? ""; payment = v.paymentDay.map(String.init) ?? ""
            bank = v.bankInfo ?? ""; note = v.note ?? ""
        }
    }

    private func save() async {
        error = nil
        func dayValue(_ s: String) -> Any { NI.num(s).map { Int($0) as Any } ?? NSNull() }
        var body: [String: Any] = [
            "type": "vendorSave", "name": name, "nameKana": kana, "contactName": contact, "phone": phone, "email": email,
            "address": address, "closingDay": dayValue(closing), "paymentDay": dayValue(payment), "bankInfo": bank, "note": note,
        ]
        if let v = vendor { body["id"] = v.id }
        let r = await model.act(body)
        if r.ok {
            model.toast = vendor == nil ? "仕入先を登録しました" : "仕入先を更新しました"
            onClose(); onSaved()
        } else { error = r.error ?? "保存に失敗しました" }
    }
}

/// 理由が要る確認（仕入先の削除・発注の取消。Web の ConfirmDialog requireReason）
struct NUReasonDialog: View {
    @ObservedObject var model: NativePurchasingModel
    let title: String
    let message: String
    let okText: String
    /// 送る中身（reason を足して送る）
    let request: [String: Any]
    let done: String
    let onClose: () -> Void
    let onDone: () -> Void
    @State private var reason = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: title, onClose: onClose)
            Text(message).font(.system(size: 15)).foregroundColor(NFColor.ink2)
            NIField(label: "理由（必須）", text: $reason)
            NIDialogFoot(error: error, busy: model.busy, okText: okText, busyText: "処理中…", danger: true, onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
    }

    private func save() async {
        let rs = reason.trimmingCharacters(in: .whitespaces)
        guard !rs.isEmpty else { error = "理由を入力してください"; return }
        var b = request
        b["reason"] = rs
        let r = await model.act(b)
        if r.ok {
            model.toast = done
            onClose(); onDone()
        } else { error = r.error ?? "うまくいきませんでした" }
    }
}

/// 仕入先の直近の発注（最大5件）
struct NUVendorHistory: View {
    @ObservedObject var model: NativePurchasingModel
    let vendor: NUVendor
    let onClose: () -> Void
    let onOpenPo: (String) -> Void
    @State private var rows: [NUVendorOrder]?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "発注履歴：\(vendor.name)", onClose: onClose)
            if let rows {
                if rows.isEmpty {
                    Text("発注履歴はありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 28)
                } else {
                    VStack(spacing: 0) {
                        HStack { Text("発注番号").frame(width: 100, alignment: .leading); Text("状態").frame(width: 100, alignment: .leading); Text("金額").frame(maxWidth: .infinity, alignment: .trailing); Text("入荷予定").frame(width: 130, alignment: .trailing) }
                            .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(height: 32)
                        ForEach(rows) { r in
                            HStack {
                                Button { onOpenPo(r.id) } label: { Text("#\(r.poNo)").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.iris) }.buttonStyle(.plain).frame(width: 100, alignment: .leading)
                                NU.badge(NU.poStatus, r.status).frame(width: 100, alignment: .leading)
                                Text(NI.yen(r.total)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                                Text(r.expectedAt.map { NI.date($0) } ?? "—").frame(width: 130, alignment: .trailing)
                            }
                            .font(.system(size: 14)).frame(height: 46)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40) }
        }
        .padding(22)
        .task {
            let r: NUVendorOrders? = await model.get([URLQueryItem(name: "part", value: "vendorOrders"), URLQueryItem(name: "id", value: vendor.id)])
            rows = r?.rows ?? []
        }
    }
}

// MARK: - 発注（/app/purchases・new・[id]）

struct NativePurchasesView: View {
    @ObservedObject var model: NativePurchasingModel
    /// 開く画面（list・new・detail）と、作成のときに引き継ぐ品目（?item= / ?items=）
    @Binding var route: NUPurchasesRoute
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var payload: NUPurchasesPayload?
    @State private var status = ""
    @State private var vendor = ""
    @State private var from = ""
    @State private var to = ""
    @State private var vendorPicking = false

    var body: some View {
        ZStack {
            list
            switch route {
            case .list: EmptyView()
            case .new(let item, let items):
                NUPoNewView(model: model, initialItem: item, initialItems: items, onClose: { route = .list; Task { await refresh() } }, onCreated: { id in route = .detail(id) })
                    .id("new-\(item ?? "")-\(items.map { "\($0.id):\($0.qty)" }.joined(separator: ","))")
                    .transition(.opacity)
            case .detail(let id):
                NUPoDetailView(model: model, poId: id, onClose: { route = .list; Task { await refresh() } }, onWeb: onWeb)
                    .id(id)
                    .transition(.opacity)
            }
        }
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: true))
    }

    private var list: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "発注", subtitle: "Purchase orders", onHome: onHome)
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Text("仕入先への発注状況・入荷を管理します").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                    Spacer()
                    if payload?.canCsv == true { niSmallButton("CSV出力", icon: "square.and.arrow.down") { exportCsv() }.frame(height: 46) }
                    Button { route = .new(item: nil, items: []) } label: {
                        Text("発注書を作成").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 18).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
                    }.buttonStyle(PressableStyle())
                }
                filters
                ScrollView {
                    if let p = payload {
                        if p.rows.isEmpty { niEmpty("発注書がありません", "「発注書を作成」から新しい発注を作成してください") } else { table(p) }
                    } else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60) }
                }
            }
            .padding(16)
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task { await refresh() }
    }

    private func query() -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if !status.isEmpty { items.append(URLQueryItem(name: "status", value: status)) }
        if !vendor.isEmpty { items.append(URLQueryItem(name: "vendor", value: vendor)) }
        if !from.isEmpty { items.append(URLQueryItem(name: "from", value: from)) }
        if !to.isEmpty { items.append(URLQueryItem(name: "to", value: to)) }
        return items
    }

    private func refresh() async {
        if let p: NUPurchasesPayload = await model.get([URLQueryItem(name: "part", value: "purchases")] + query()) { payload = p }
    }

    private func exportCsv() {
        var items = query().filter { $0.name != "vendor" }
        if let s = payload?.storeId { items.append(URLQueryItem(name: "store", value: s)) }
        var c = URLComponents(); c.queryItems = items
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/purchases/export?\(c.percentEncodedQuery ?? "")")
                if let url = NLShare.tempFile("発注_\(NPDate.str(Date())).csv", data: data) { NLShare.present(url: url) }
            } catch { model.error = (error as? NativeAPIError)?.message ?? "CSV を取り出せませんでした" }
        }
    }

    private var filters: some View {
        let vendors = payload?.vendors ?? []
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("状態").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                NIChoice(options: [("", "すべて")] + NU.poStatusOrder.map { ($0, NU.poStatus[$0]!.0) }, value: $status)
            }
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("仕入先").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                    Button { vendorPicking = true } label: {
                        HStack { Text(vendors.first { $0.id == vendor }?.name ?? "すべて").lineLimit(1); Spacer(); Image(systemName: "chevron.down").foregroundColor(NFColor.ink3) }
                            .font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink).padding(.horizontal, 12).frame(width: 220, height: 40)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $vendorPicking) {
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach([NFNamed(id: "", name: "すべて")] + vendors) { v in
                                    Button { vendor = v.id; vendorPicking = false } label: {
                                        HStack { Text(v.name); Spacer(); if vendor == v.id { Image(systemName: "checkmark").foregroundColor(NFColor.iris) } }
                                            .font(.system(size: 15)).foregroundColor(NFColor.navy).padding(.horizontal, 16).frame(height: 44).contentShape(Rectangle())
                                    }.buttonStyle(.plain)
                                    Rectangle().fill(NFColor.line).frame(height: 1)
                                }
                            }
                        }
                        .frame(width: 300, height: min(420, CGFloat(vendors.count + 1) * 45))
                    }
                }
                NUDateField(label: "発注日（開始）", value: $from)
                NUDateField(label: "発注日（終了）", value: $to)
                niSmallButton("絞り込む", icon: "line.3.horizontal.decrease", tone: .white, fill: NFColor.navy) { Task { await refresh() } }.frame(height: 40)
                Spacer(minLength: 0)
            }
        }
    }

    private func table(_ p: NUPurchasesPayload) -> some View {
        niCard {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text("発注番号").frame(width: 90, alignment: .leading)
                    Text("状態").frame(width: 90, alignment: .leading)
                    Text("仕入先").frame(maxWidth: .infinity, alignment: .leading)
                    Text("店舗").frame(width: 150, alignment: .leading)
                    Text("希望納期").frame(width: 110, alignment: .leading)
                    Text("担当者").frame(width: 110, alignment: .leading)
                    Text("金額").frame(width: 110, alignment: .trailing)
                }
                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
                ForEach(p.rows) { r in
                    Button { route = .detail(r.id) } label: {
                        HStack(spacing: 8) {
                            Text("#\(r.poNo)").font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.iris).frame(width: 90, alignment: .leading)
                            NU.badge(NU.poStatus, r.status).frame(width: 90, alignment: .leading)
                            Text(r.vendorName ?? "—").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text(r.storeName ?? "—").lineLimit(1).frame(width: 150, alignment: .leading)
                            Text(r.expectedAt.map { NI.date($0) } ?? "—").frame(width: 110, alignment: .leading)
                            Text(r.requesterName ?? "—").lineLimit(1).frame(width: 110, alignment: .leading)
                            Text(NI.yen(r.total)).monospacedDigit().frame(width: 110, alignment: .trailing)
                        }
                        .font(.system(size: 13.5)).foregroundColor(NFColor.ink)
                        .padding(.horizontal, 14).frame(minHeight: 52).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                }
            }
        }
    }
}

enum NUPurchasesRoute: Equatable {
    case list
    case new(item: String?, items: [NUInitialItem])
    case detail(String)
}
struct NUInitialItem: Equatable, Hashable { let id: String; let qty: Double }

/// 発注書を作成（Web の PoForm と同じ）
struct NUPoNewView: View {
    @ObservedObject var model: NativePurchasingModel
    let initialItem: String?
    let initialItems: [NUInitialItem]
    let onClose: () -> Void
    let onCreated: (String) -> Void

    struct Line: Identifiable { let id = UUID(); var itemId = ""; var name = ""; var qty = "1"; var unit = "個"; var cost = "0"; var tax = "10" }
    @State private var data: NUPoNewPayload?
    @State private var vendorId = ""
    @State private var expectedAt = ""
    @State private var note = ""
    @State private var lines: [Line] = []
    @State private var picking: UUID?
    @State private var error: String?

    private func sub(_ l: Line) -> Int { Int(((NI.num(l.qty) ?? 0) * (NI.num(l.cost) ?? 0)).rounded()) }
    private func tax(_ l: Line) -> Int { Int((Double(sub(l)) * (NI.num(l.tax) ?? 0) / 100).rounded()) }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: data?.store.name ?? "", title: "発注書を作成", subtitle: "New purchase order", onHome: onClose)
            if let d = data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("店舗: \(d.store.name)").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("仕入先").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                            if d.vendors.isEmpty { Text("取引中の仕入先がありません").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                            NIChoice(options: d.vendors.map { ($0.id, $0.name) }, value: $vendorId)
                        }
                        HStack(alignment: .bottom, spacing: 12) {
                            NUDateField(label: "入荷予定日", value: $expectedAt)
                            NIField(label: "メモ", text: $note)
                        }
                        HStack {
                            Text("明細").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                            Spacer()
                            niSmallButton("行を追加", icon: "plus") { lines.append(Line()) }
                        }
                        ForEach($lines) { $l in lineRow($l, items: d.items) }
                        totals
                        if let e = error { Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger) }
                        HStack(spacing: 10) {
                            Spacer()
                            niSmallButton("キャンセル") { onClose() }.frame(height: 52).disabled(model.busy)
                            Button { Task { await create() } } label: {
                                Text(model.busy ? "作成中…" : "発注書を作成").font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                                    .padding(.horizontal, 24).frame(height: 52)
                                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
                            }.buttonStyle(PressableStyle()).disabled(model.busy)
                        }
                    }
                    .padding(16)
                }
            } else {
                Spacer(); ProgressView("読み込み中…").tint(NFColor.iris); Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task {
            guard data == nil, let d: NUPoNewPayload = await model.get([URLQueryItem(name: "part", value: "poNew")]) else { return }
            data = d
            lines = startLines(d.items)
        }
    }

    /// 発注提案（?items=id:qty,…）や要発注リスト（?item=）から引き継ぐ。Web と同じく仕入単位・平均単価を入れる
    private func startLines(_ items: [NUPoItemOption]) -> [Line] {
        func line(_ it: NUPoItemOption, qty: Double) -> Line {
            Line(itemId: it.id, name: it.name, qty: NI.q(qty), unit: (it.purchaseUnit?.isEmpty == false ? it.purchaseUnit! : it.unit), cost: it.avgCost.map { NI.q($0) } ?? "0")
        }
        let built = initialItems.compactMap { x in items.first { $0.id == x.id }.map { line($0, qty: x.qty) } }
        if !built.isEmpty { return built }
        if let id = initialItem, let it = items.first(where: { $0.id == id }) { return [line(it, qty: 1)] }
        return [Line()]
    }

    private func lineRow(_ l: Binding<Line>, items: [NUPoItemOption]) -> some View {
        let sel = items.first { $0.id == l.wrappedValue.itemId }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("品目").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                    Button { picking = picking == l.wrappedValue.id ? nil : l.wrappedValue.id } label: {
                        HStack { Text(sel?.name ?? "自由入力").foregroundColor(sel == nil ? NFColor.ink3 : NFColor.ink).lineLimit(1); Spacer(); Image(systemName: "chevron.down").foregroundColor(NFColor.ink3) }
                            .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 12).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    }.buttonStyle(.plain)
                }
                .frame(minWidth: 200)
                NIField(label: "数量", text: l.qty, number: true).frame(width: 100)
                NIField(label: "単位", text: l.unit).frame(width: 80)
                NIField(label: "単価（単位あたり・税抜）", text: l.cost, number: true).frame(width: 170)
                VStack(alignment: .leading, spacing: 5) {
                    Text("税率").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                    NIChoice(options: [("10", "10%"), ("8", "8%")], value: l.tax).fixedSize()
                }
                Text(NT.yen(sub(l.wrappedValue))).font(.system(size: 13)).monospacedDigit().foregroundColor(NFColor.ink3).frame(width: 80, height: 46, alignment: .trailing)
                Button { lines.removeAll { $0.id == l.wrappedValue.id } } label: {
                    Image(systemName: "trash").font(.system(size: 17, weight: .semibold)).foregroundColor(lines.count <= 1 ? NFColor.ink3 : NFColor.danger).frame(width: 40, height: 46)
                }.buttonStyle(.plain).disabled(lines.count <= 1)
            }
            if l.wrappedValue.itemId.isEmpty { NIField(label: "", text: l.name, placeholder: "品目名").frame(maxWidth: 420) }
            if picking == l.wrappedValue.id {
                ScrollView {
                    VStack(spacing: 0) {
                        itemOption("自由入力", selected: l.wrappedValue.itemId.isEmpty) { l.wrappedValue.itemId = ""; picking = nil }
                        ForEach(items) { it in
                            itemOption(it.name, selected: l.wrappedValue.itemId == it.id) {
                                l.wrappedValue.itemId = it.id
                                l.wrappedValue.name = it.name
                                // 品目に仕入単位が設定されていればそれを使う（発注・単価は仕入単位あたりで扱う。Web と同じ）
                                l.wrappedValue.unit = it.purchaseUnit?.isEmpty == false ? it.purchaseUnit! : it.unit
                                if let c = it.avgCost { l.wrappedValue.cost = NI.q(c) }
                                picking = nil
                            }
                        }
                    }
                }
                .frame(maxHeight: 240)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func itemOption(_ text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            Button(action: action) {
                HStack { Text(text); Spacer(); if selected { Image(systemName: "checkmark").foregroundColor(NFColor.iris) } }
                    .font(.system(size: 14)).foregroundColor(NFColor.navy).padding(.horizontal, 12).frame(height: 40).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Rectangle().fill(NFColor.line).frame(height: 1)
        }
    }

    private var totals: some View {
        let s = lines.reduce(0) { $0 + sub($1) }
        let t = lines.reduce(0) { $0 + tax($1) }
        return HStack {
            Spacer()
            VStack(spacing: 6) {
                HStack { Text("小計（税抜）"); Spacer(); Text(NT.yen(s)).monospacedDigit() }.font(.system(size: 14)).foregroundColor(NFColor.ink2)
                HStack { Text("消費税"); Spacer(); Text(NT.yen(t)).monospacedDigit() }.font(.system(size: 14)).foregroundColor(NFColor.ink2)
                Rectangle().fill(NFColor.line).frame(height: 1)
                HStack { Text("合計（税込）").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2); Spacer(); Text(NT.yen(s + t)).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy) }
            }
            .padding(14).frame(width: 320)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
        }
    }

    private func create() async {
        error = nil
        guard !vendorId.isEmpty else { error = "仕入先を選択してください"; return }
        let valid = lines.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && (NI.num($0.qty) ?? 0) > 0 }
        guard !valid.isEmpty else { error = "明細を1件以上入力してください"; return }
        let body: [String: Any] = [
            "type": "poCreate", "vendorId": vendorId, "expectedAt": expectedAt.isEmpty ? NSNull() : expectedAt, "note": note,
            "lines": valid.map { l -> [String: Any] in
                [
                    "inventoryItemId": l.itemId.isEmpty ? NSNull() : l.itemId, "name": l.name.trimmingCharacters(in: .whitespaces),
                    "quantity": NI.num(l.qty) ?? 0, "unit": l.unit.isEmpty ? "個" : l.unit,
                    "unitCost": ((NI.num(l.cost) ?? 0)).rounded(), "taxRate": Int(NI.num(l.tax) ?? 10),
                ]
            },
        ]
        let r = await model.act(body)
        if r.ok, let id = r.id {
            model.toast = "発注書を作成しました"
            onCreated(id)
        } else { error = r.error ?? "作成に失敗しました" }
    }
}

/// 発注書の中身（Web の /app/purchases/[id] と同じ）
struct NUPoDetailView: View {
    @ObservedObject var model: NativePurchasingModel
    let poId: String
    let onClose: () -> Void
    let onWeb: (String) -> Void

    @State private var payload: NUPoPayload?
    @State private var receiving = false
    @State private var cancelling = false

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: payload?.po.storeName ?? "", title: payload.map { "発注書 #\($0.po.poNo)" } ?? "発注書", subtitle: "Purchase order", onHome: onClose)
            if let p = payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header(p)
                        if p.po.status == "requested", let l = p.po.requiredApprovalRoleLabel {
                            Text("この金額の承認には「\(l)」以上のロールが必要です").font(.system(size: 12.5)).foregroundColor(NFColor.irisDeep)
                        }
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("状態").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                                NU.badge(NU.poStatus, p.po.status)
                            }
                            .padding(14).frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                            niStat("小計（税抜）", NI.yen(p.po.subtotal))
                            niStat("消費税", NI.yen(p.po.taxTotal))
                            niStat("合計（税込）", NI.yen(p.po.total), tone: NFColor.irisDeep)
                            niStat("入荷予定日", p.po.expectedAt.map { NI.date($0) } ?? "—")
                        }
                        itemsTable(p.po)
                        if let n = p.po.note, !n.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("メモ").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                                Text(n).font(.system(size: 14)).foregroundColor(NFColor.ink2)
                            }
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                        }
                    }
                    .padding(16)
                }
            } else {
                Spacer(); ProgressView("読み込み中…").tint(NFColor.iris); Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task { await load() }
        .overlay {
            if receiving, let p = payload {
                NativeModalCard(width: 860) { NUReceiveForm(model: model, po: p.po, onClose: { receiving = false }, onDone: { Task { await load() } }) }
            } else if cancelling {
                NativeModalCard(width: 560) {
                    NUReasonDialog(model: model, title: "発注を取消", message: "この発注書を取消します。入荷済みの明細がある場合は取消できません。", okText: "取消する",
                                   request: ["type": "poCancel", "id": poId], done: "発注を取消しました", onClose: { cancelling = false }, onDone: { Task { await load() } })
                }
            }
        }
    }

    private func load() async {
        if let p: NUPoPayload = await model.get([URLQueryItem(name: "part", value: "po"), URLQueryItem(name: "id", value: poId)]) { payload = p } else if payload == nil { onClose() }
    }

    private func header(_ p: NUPoPayload) -> some View {
        let s = p.po.status
        return HStack(spacing: 8) {
            Button(action: onClose) {
                HStack(spacing: 3) { Image(systemName: "chevron.left"); Text("発注へ戻る") }.font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.royal)
            }.buttonStyle(.plain)
            Text("\(p.po.vendorName)／\(p.po.storeName)").font(.system(size: 14)).foregroundColor(NFColor.ink2).lineLimit(1)
            Spacer()
            if p.canManage {
                if s == "ordered" || s == "partially_received" { niSmallButton("入荷登録", icon: "shippingbox", tone: .white, fill: NFColor.iris) { receiving = true }.frame(height: 44) }
                if s == "draft" { niSmallButton("申請する", tone: .white, fill: NFColor.iris) { Task { await run("request", "申請しました") } }.frame(height: 44).disabled(model.busy) }
                if s == "requested" { niSmallButton("承認する", tone: .white, fill: NFColor.success) { Task { await run("approve", "承認しました") } }.frame(height: 44).disabled(model.busy) }
                if s == "approved" { niSmallButton("発注確定する", tone: .white, fill: NFColor.iris) { Task { await run("order", "発注確定しました") } }.frame(height: 44).disabled(model.busy) }
                if ["draft", "requested", "approved", "ordered"].contains(s) { niSmallButton("取消", tone: .white, fill: NFColor.danger) { cancelling = true }.frame(height: 44).disabled(model.busy) }
            }
            niSmallButton("印刷", icon: "printer") { printPo(p.po) }.frame(height: 44)
            niSmallButton("仕入仕訳一覧（店舗）", icon: "doc.text") { onWeb("/app/accounting?source_type=purchase&store=\(p.po.storeId)") }.frame(height: 44)
        }
    }

    private func run(_ action: String, _ done: String) async {
        let r = await model.act(["type": "poStatus", "id": poId, "action": action])
        if r.ok { model.toast = done; await load() } else { model.error = r.error ?? "操作に失敗しました" }
    }

    private func itemsTable(_ po: NUPo) -> some View {
        niCard {
            VStack(spacing: 0) {
                Text("明細").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 12)
                HStack(spacing: 8) {
                    Text("品目").frame(maxWidth: .infinity, alignment: .leading)
                    Text("数量").frame(width: 70, alignment: .trailing)
                    Text("単位").frame(width: 60, alignment: .leading)
                    Text("単価（税抜）").frame(width: 100, alignment: .trailing)
                    Text("税率").frame(width: 50, alignment: .trailing)
                    Text("金額（税抜）").frame(width: 110, alignment: .trailing)
                    Text("入荷済み").frame(width: 110, alignment: .trailing)
                }
                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 16).frame(height: 36).background(NFColor.lilacSoft)
                ForEach(po.items) { i in
                    HStack(spacing: 8) {
                        Text(i.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                        Text(NI.q(i.quantity)).frame(width: 70, alignment: .trailing)
                        Text(i.unit).frame(width: 60, alignment: .leading)
                        Text(NI.yen(i.unitCost)).frame(width: 100, alignment: .trailing)
                        Text("\(NI.q(i.taxRate))%").frame(width: 50, alignment: .trailing)
                        Text(NI.yen((i.quantity * i.unitCost).rounded())).frame(width: 110, alignment: .trailing)
                        Text("\(NI.q(i.receivedQuantity)) / \(NI.q(i.quantity))").frame(width: 110, alignment: .trailing)
                    }
                    .font(.system(size: 13.5)).monospacedDigit().foregroundColor(NFColor.ink)
                    .padding(.horizontal, 16).frame(minHeight: 48)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                }
            }
        }
    }

    /// 発注書の印刷（Web の印刷ビューと同じ中身を PDF にして、共有から印刷・保存）
    private func printPo(_ po: NUPo) {
        let sheet = NUPoPrintSheet(po: po)
        if let url = NLShare.pdf(of: sheet, width: 595, name: "発注書_\(po.poNo).pdf") { NLShare.present(url: url) } else { model.error = "PDF を作れませんでした" }
    }
}

/// 発注書の印刷の中身（Web の .print-area と同じ）
struct NUPoPrintSheet: View {
    let po: NUPo
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("発注書").font(.system(size: 20, weight: .bold))
            Text("発注番号 #\(po.poNo)　発注日 \(NI.date(String((po.orderedAt ?? po.createdAt).prefix(10))))").font(.system(size: 10)).foregroundColor(.gray).padding(.top, 4)
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(po.vendorName) 御中").font(.system(size: 14, weight: .semibold))
                    Text("下記の通り発注いたします。").font(.system(size: 11)).padding(.top, 10)
                    Text("希望納期：\(po.expectedAt.map { NI.date($0) } ?? "—")").font(.system(size: 11))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(po.storeName).font(.system(size: 12, weight: .semibold))
                    if let a = po.storeAddress { Text(a).font(.system(size: 10)).foregroundColor(.gray) }
                    if let t = po.storePhone { Text("TEL \(t)").font(.system(size: 10)).foregroundColor(.gray) }
                }
            }
            .padding(.top, 18)
            VStack(spacing: 0) {
                HStack { Text("品目").frame(maxWidth: .infinity, alignment: .leading); Text("数量").frame(width: 50, alignment: .trailing); Text("単位").frame(width: 44); Text("単価").frame(width: 70, alignment: .trailing); Text("税率").frame(width: 40, alignment: .trailing); Text("金額").frame(width: 80, alignment: .trailing) }
                    .font(.system(size: 10, weight: .bold)).padding(.vertical, 5)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color.gray).frame(height: 1) }
                ForEach(po.items) { i in
                    HStack { Text(i.name).frame(maxWidth: .infinity, alignment: .leading); Text(NI.q(i.quantity)).frame(width: 50, alignment: .trailing); Text(i.unit).frame(width: 44); Text(NI.yen(i.unitCost)).frame(width: 70, alignment: .trailing); Text("\(NI.q(i.taxRate))%").frame(width: 40, alignment: .trailing); Text(NI.yen((i.quantity * i.unitCost).rounded())).frame(width: 80, alignment: .trailing) }
                        .font(.system(size: 10)).monospacedDigit().padding(.vertical, 5)
                        .overlay(alignment: .bottom) { Rectangle().fill(Color.gray.opacity(0.3)).frame(height: 1) }
                }
            }
            .padding(.top, 18)
            HStack {
                Spacer()
                VStack(spacing: 4) {
                    HStack { Text("小計（税抜）"); Spacer(); Text(NI.yen(po.subtotal)).monospacedDigit() }
                    HStack { Text("消費税"); Spacer(); Text(NI.yen(po.taxTotal)).monospacedDigit() }
                    Rectangle().fill(Color.gray.opacity(0.5)).frame(height: 1)
                    HStack { Text("合計（税込）").bold(); Spacer(); Text(NI.yen(po.total)).bold().monospacedDigit() }.font(.system(size: 13))
                }
                .font(.system(size: 11)).frame(width: 220)
            }
            .padding(.top, 14)
            if let n = po.note, !n.isEmpty { Text("備考：\(n)").font(.system(size: 10)).foregroundColor(.gray).padding(.top, 20) }
        }
        .foregroundColor(.black)
        .padding(36)
        .frame(width: 595, alignment: .topLeading)
        .background(Color.white)
    }
}

/// 入荷登録（Web の ReceiveForm と同じ）
struct NUReceiveForm: View {
    @ObservedObject var model: NativePurchasingModel
    let po: NUPo
    let onClose: () -> Void
    let onDone: () -> Void
    @State private var qty: [String: String] = [:]
    @State private var cost: [String: String] = [:]
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "入荷登録", onClose: onClose)
            ScrollView {
                VStack(spacing: 10) { ForEach(po.items) { row($0) } }
            }
            .frame(maxHeight: 560)
            NIDialogFoot(error: error, busy: model.busy, okText: "入荷を登録する", busyText: "登録中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear { if cost.isEmpty { for i in po.items { cost[i.id] = NI.q(i.unitCost) } } }
    }

    private func row(_ i: NUPoItem) -> some View {
        let remaining = max(0, i.quantity - i.receivedQuantity)
        let q = NI.num(qty[i.id] ?? "")
        let c = NI.num(cost[i.id] ?? "")
        let showsConversion = i.factor != 1
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(i.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy).lineLimit(1)
                    Text("発注 \(NI.q(i.quantity))\(i.unit)／入荷済み \(NI.q(i.receivedQuantity))\(i.unit)／残り \(NI.q(remaining))\(i.unit)").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                NIField(label: "今回入荷数量（\(i.unit)）", text: Binding(get: { qty[i.id] ?? "" }, set: { qty[i.id] = $0 }), placeholder: "0", number: true)
                    .frame(width: 180).disabled(remaining <= 0).opacity(remaining <= 0 ? 0.5 : 1)
                NIField(label: "単価（円/\(i.unit)・変更可）", text: Binding(get: { cost[i.id] ?? "" }, set: { cost[i.id] = $0 }), number: true)
                    .frame(width: 190).disabled(remaining <= 0).opacity(remaining <= 0 ? 0.5 : 1)
            }
            if showsConversion, let q, q > 0, let c, c >= 0 {
                VStack(alignment: .leading, spacing: 3) {
                    Text("変換プレビュー: \(NI.q(q))\(i.unit) → \(NI.q(q * i.factor))\(i.stockUnit) ／ \(NI.yen(c))/\(i.unit) → \(NI.yen((c / i.factor).rounded()))/\(i.stockUnit)")
                        .font(.system(size: 12)).foregroundColor(NFColor.ink2)
                    if NI.costRisk(c, i.factor) {
                        Text("変換後の在庫単価の丸め誤差が大きくなります。在庫単位の見直しを推奨します").font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.saffron)
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft))
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func save() async {
        error = nil
        var receipts: [[String: Any]] = []
        for i in po.items {
            guard let q = NI.num(qty[i.id] ?? ""), q > 0 else { continue }
            guard let c = NI.num(cost[i.id] ?? ""), c >= 0 else { error = "単価を正しく入力してください"; return }
            receipts.append(["itemId": i.id, "quantity": q, "unitCost": c])
        }
        guard !receipts.isEmpty else { error = "入荷数量を入力してください"; return }
        let r = await model.act(["type": "poReceive", "id": po.id, "receipts": receipts])
        if r.ok {
            model.toast = "入荷を登録しました"
            onClose(); onDone()
        } else { error = r.error ?? "入荷登録に失敗しました" }
    }
}
