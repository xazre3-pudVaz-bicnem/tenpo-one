import SwiftUI

// iPhone の店長・オーナー：発注（Web の /app/purchases・/app/purchases/new・/app/purchases/<id>。2026-10-25 Ronnie「iPhone も native に」）
//   一覧（状態・仕入先で絞り込み）・発注書を押すと詳細（明細・入荷の進み・合計・入荷予定日・メモ）
//   操作（vendors.manage）：申請・承認・発注確定（仕入先へ発注。必ず確認のシートを出す）・入荷登録（検品）・取消（理由）
//   発注書を送る：iPad と同じく発注書を PDF にして共有（メール・FAX のアプリ・印刷）。送る前に必ず確認を出す
//   作成（?item= ?items=id:数量 ?vendor=）は NativePhoneOwnerPurchaseForms.swift
// サーバーは iPad と同じ：GET part=purchases|po|poNew ／ POST poCreate・poStatus・poCancel・poReceive（返事の形は変えない）
// CSV はアプリの中で取り出して共有（NPOCsvButton）。仕入仕訳一覧は会計の画面で。

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPZPoRow: Decodable, Identifiable, Hashable {
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

struct NPZPurchasesPayload: Decodable {
    let rows: [NPZPoRow]
    let vendors: [NPZNamed]
    let canManage: Bool
    let canCsv: Bool?
    let storeId: String?
}

struct NPZPoItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: Double
    let unit: String
    let unitCost: Double
    let taxRate: Double
    let receivedQuantity: Double
    let stockUnit: String?
    let factor: Double?

    var remaining: Double { max(0, quantity - receivedQuantity) }
    var conv: Double { (factor ?? 1) > 0 ? (factor ?? 1) : 1 }
}

struct NPZPo: Decodable, Hashable {
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
    let items: [NPZPoItem]
}

struct NPZPoPayload: Decodable {
    let po: NPZPo
    let canManage: Bool
}

/// 名前・色（Web の PO_STATUS と同じ）
enum NPZPoText {
    static let order = ["draft", "requested", "approved", "ordered", "partially_received", "received", "cancelled"]
    static let filters: [(String, String)] = [("", "すべて")] + NPZPoText.order.map { ($0, NPZPoText.status($0).0) }

    static func status(_ s: String) -> (String, Color) {
        switch s {
        case "draft": return ("下書き", NT.ink3)
        case "requested": return ("承認待ち", NT.warn)
        case "approved": return ("承認済み", NT.purple)
        case "ordered": return ("発注済み", NT.purple)
        case "partially_received": return ("一部入荷", NT.warn)
        case "received": return ("入荷済み", NT.ok)
        case "cancelled": return ("取消", NT.danger)
        default: return (s, NT.ink3)
        }
    }
}

/// 発注書を作るシートの最初の中身（?item= ?items=id:数量 ?vendor=）
struct NPZPoNewRef: Identifiable {
    let id = UUID()
    var item: String? = nil
    var items: [(String, Double)] = []
    var vendor: String? = nil

    /// ?items=id:数量,id:数量
    static func parseItems(_ s: String?) -> [(String, Double)] {
        guard let s, !s.isEmpty else { return [] }
        return s.split(separator: ",").compactMap { part in
            let kv = part.split(separator: ":")
            guard kv.count == 2, NOS.isUuid(String(kv[0])), let q = Double(kv[1]), q > 0 else { return nil }
            return (String(kv[0]), q)
        }
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPZPurchasesModel: ObservableObject {
    @Published var payload: NPZPurchasesPayload?
    @Published var status = ""
    @Published var vendor = ""
    @Published var loading = false
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いている発注書（/app/purchases/<id>）
    @Published var openId: String?
    @Published var details: [String: NPZPoPayload] = [:]
    @Published var detailError: String?
    /// 作成のシート（/app/purchases/new）
    @Published var newRef: NPZPoNewRef?

    init(route: NativeModuleRoute? = nil) {
        if let route {
            let parts = route.url.path.split(separator: "/").map(String.init)
            if parts.count >= 3, parts[1] == "purchases", parts[2] == "new" {
                newRef = NPZPoNewRef(item: route.query("item").flatMap { NOS.isUuid($0) ? $0 : nil },
                                     items: NPZPoNewRef.parseItems(route.query("items")),
                                     vendor: route.query("vendor").flatMap { NOS.isUuid($0) ? $0 : nil })
            } else {
                status = route.query("status") ?? ""
                if let v = route.query("vendor"), NOS.isUuid(v) { vendor = v }
                if parts.count >= 3, parts[1] == "purchases", NOS.isUuid(parts[2]) { openId = parts[2] }
            }
        }
        payload = NPZApi.cached(NPZPurchasesPayload.self, "purchases", query())
        if let id = openId { details[id] = NPZApi.cached(NPZPoPayload.self, "po", ["id": id]) }
    }

    func query() -> [String: String] {
        var d: [String: String] = [:]
        if !status.isEmpty { d["status"] = status }
        if !vendor.isEmpty { d["vendor"] = vendor }
        return d
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let qy = query()
        loading = true
        defer { loading = false }
        do {
            let p = try await NPZApi.get(NPZPurchasesPayload.self, "purchases", qy)
            guard qy == query() else { return }
            payload = p
            error = nil
        } catch {
            if NPZApi.useWeb(error) { useWeb = true; return }
            self.error = NPZApi.message(error)
        }
    }

    func loadDetail(_ id: String) async {
        if NativePreview.current != nil { return }
        detailError = nil
        if details[id] == nil, let saved = NPZApi.cached(NPZPoPayload.self, "po", ["id": id]) { details[id] = saved }
        do {
            details[id] = try await NPZApi.get(NPZPoPayload.self, "po", ["id": id])
        } catch {
            detailError = NPZApi.message(error)
        }
    }

    func act(_ body: [String: Any]) async -> NPZResult {
        busy = true
        defer { busy = false }
        return await NPZApi.post(body)
    }

    /// 申請・承認・発注確定
    func changeStatus(_ id: String, _ action: String, done: String) async -> Bool {
        let r = await act(["type": "poStatus", "id": id, "action": action])
        guard r.ok else {
            detailError = r.error ?? "操作に失敗しました"
            return false
        }
        toast = done
        await loadDetail(id)
        await refresh()
        return true
    }
}

// MARK: - 画面

/// key "purchases" の画面（NativePhoneOwnerScreen から）
struct NativePhonePurchasesScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPZPurchasesModel

    init(route: NativeModuleRoute) {
        _model = StateObject(wrappedValue: NPZPurchasesModel(route: route))
    }

    var body: some View {
        NativePhonePurchasesView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "purchases", useWeb: model.useWeb, state: state))
    }
}

struct NativePhonePurchasesView: View {
    @ObservedObject var model: NPZPurchasesModel
    let onBack: () -> Void
    let onOpen: (String) -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "発注", subtitle: "Purchase orders", onBack: onBack, trailing: {
                if model.payload?.canManage ?? true {
                    NPOCBarButton(icon: "plus", label: "作成") { model.newRef = NPZPoNewRef() }
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
            if let id = model.openId {
                NPZPoDetailView(model: model, poId: id, onBack: {
                    model.openId = nil
                    model.detailError = nil
                }, onOpen: onOpen)
                .transition(.move(edge: .trailing))
                .zIndex(2)
            }
            NPHToast(text: $model.toast).zIndex(3)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.22), value: model.openId)
        .task { await model.refresh() }
        .sheet(item: $model.newRef) { ref in
            NPZPoNewSheet(start: ref, onClose: { model.newRef = nil }, onCreated: { id in
                model.newRef = nil
                model.toast = "発注書を作成しました（下書き）"
                model.openId = id
                Task { await model.refresh() }
            })
        }
    }

    // MARK: 一覧

    private func list(_ p: NPZPurchasesPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                NPZChipRow(items: NPZPoText.filters, selection: model.status) { s in
                    model.status = s
                    Task { await model.refresh() }
                }
                HStack(spacing: 8) {
                    NPOCMenuChip(label: "仕入先", options: [("", "すべて")] + p.vendors.map { ($0.id, $0.name) }, selection: model.vendor) { v in
                        model.vendor = v
                        Task { await model.refresh() }
                    }
                    Spacer()
                }
                if p.rows.isEmpty {
                    NPOCEmpty(icon: "doc.text", title: "発注書がありません", note: p.canManage ? "右上の「＋ 作成」から発注書を作れます" : "")
                } else {
                    Text("\(p.rows.count)件（新しい順・最大300件）").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).padding(.leading, 4)
                    ForEach(p.rows) { r in
                        Button {
                            model.detailError = nil
                            model.openId = r.id
                        } label: { row(r) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                }
                if p.canCsv == true {
                    // CSV もアプリの中で取り出して共有（NativePhoneOwnerCsv.swift。Web の画面には行かない）
                    NPOCsvButton(title: "発注 CSV（明細）", path: "/app/purchases/export", query: model.status.isEmpty ? [:] : ["status": model.status],
                                 fileName: "purchases.csv", onError: { model.error = $0 })
                }
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 60)
        }
        .refreshable { await model.refresh() }
    }

    private func row(_ r: NPZPoRow) -> some View {
        let st = NPZPoText.status(r.status)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text("#\(r.poNo)").font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                NOSBadge(text: st.0, color: st.1)
                Spacer(minLength: 4)
                Text(NPZ.yen(r.total)).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            Text(r.vendorName ?? "—").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
            HStack(spacing: 10) {
                Label("入荷予定 \(NPZ.md(r.expectedAt))", systemImage: "calendar")
                if let s = r.storeName { Label(s, systemImage: "storefront") }
                if let n = r.requesterName { Label(n, systemImage: "person") }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).labelStyle(NOSCompactLabel()).lineLimit(1).minimumScaleFactor(0.85)
        }
        .padding(12)
        .background(npocCard(14))
    }
}

// MARK: - 発注書の詳細

struct NPZPoDetailView: View {
    @ObservedObject var model: NPZPurchasesModel
    let poId: String
    let onBack: () -> Void
    let onOpen: (String) -> Void

    @State private var confirm: String?
    @State private var orderConfirm = false
    @State private var receiving = false
    @State private var cancelling = false
    @State private var sendConfirm = false

    private var payload: NPZPoPayload? { model.details[poId] }

    var body: some View {
        NPOCDetailFrame(title: payload.map { "発注書 #\($0.po.poNo)" } ?? "発注書", subtitle: payload?.po.vendorName ?? "", backLabel: "発注", onBack: onBack, trailing: {
            if payload != nil {
                NPOCBarButton(icon: "square.and.arrow.up", label: "送る") { sendConfirm = true }
            }
        }) {
            Group {
                if let p = payload {
                    content(p)
                } else {
                    NOSStateView(error: model.detailError) { Task { await model.loadDetail(poId) } }
                }
            }
        }
        .task(id: poId) { await model.loadDetail(poId) }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if confirm == "request" {
                Button("申請する") { Task { _ = await model.changeStatus(poId, "request", done: "申請しました") } }
            } else if confirm == "approve" {
                Button("承認する") { Task { _ = await model.changeStatus(poId, "approve", done: "承認しました") } }
            }
            Button("やめる", role: .cancel) {}
        }
        .confirmationDialog(sendTitle, isPresented: $sendConfirm, titleVisibility: .visible) {
            Button("PDF を作って送る・印刷する") { sharePdf() }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("宛先：\(payload?.po.vendorName ?? "")。共有の画面でメール・FAX のアプリ・印刷を選べます。送る前に宛先と内容を確かめてください。")
        }
        .sheet(isPresented: $orderConfirm) {
            if let p = payload {
                NPZPoOrderConfirmSheet(po: p.po, busy: model.busy, error: model.detailError, onClose: { orderConfirm = false }, onConfirm: {
                    Task {
                        if await model.changeStatus(poId, "order", done: "発注を確定しました") {
                            orderConfirm = false
                            // シートが閉じ終わってから「発注書を送る」の確認を出す（閉じている途中だと出ない）
                            try? await Task.sleep(nanoseconds: 700_000_000)
                            sendConfirm = true
                        }
                    }
                })
            }
        }
        .sheet(isPresented: $receiving) {
            if let p = payload {
                NPZPoReceiveSheet(po: p.po, busy: model.busy, onClose: { receiving = false }, send: { receipts in
                    let r = await model.act(["type": "poReceive", "id": poId, "receipts": receipts])
                    guard r.ok else { return r.error ?? "入荷登録に失敗しました" }
                    model.toast = "入荷を登録しました"
                    await model.loadDetail(poId)
                    await model.refresh()
                    return nil
                })
            }
        }
        .sheet(isPresented: $cancelling) {
            NPZReasonSheet(title: "発注を取消", message: "この発注書を取消します。入荷済みの明細がある発注は取消できません。", okText: "取消する", busy: model.busy, send: { reason in
                let r = await model.act(["type": "poCancel", "id": poId, "reason": reason])
                guard r.ok else { return r.error ?? "取消できませんでした" }
                model.toast = "発注を取消しました"
                await model.loadDetail(poId)
                await model.refresh()
                return nil
            }, onClose: { cancelling = false })
        }
    }

    private var confirmTitle: String {
        switch confirm ?? "" {
        case "request": return "この発注書を申請しますか？"
        case "approve": return "この発注書を承認しますか？"
        default: return ""
        }
    }

    private var sendTitle: String {
        guard let p = payload else { return "発注書を送りますか？" }
        return "発注書 #\(p.po.poNo) を送りますか？"
    }

    private func content(_ p: NPZPoPayload) -> some View {
        let po = p.po
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let e = model.detailError {
                    Text(e).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
                }
                header(po)
                if po.status == "requested", let l = po.requiredApprovalRoleLabel {
                    Text("この金額の承認には「\(l)」以上の役割が必要です").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 4)
                }
                if p.canManage { actions(po) }
                itemsCard(po)
                if let n = po.note, !n.isEmpty {
                    NPOCard(title: "メモ") {
                        Text(n).font(.system(size: 14)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
                NPOCWideButton(text: "発注書を送る・印刷（PDF）", icon: "square.and.arrow.up", kind: .secondary) { sendConfirm = true }
                Button { onOpen("/app/accounting?source_type=purchase&store=\(po.storeId)") } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text").font(.system(size: 13, weight: .bold))
                        Text("仕入仕訳一覧（店舗・Web の画面）").font(.system(size: 13.5, weight: .bold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    }
                    .foregroundColor(NT.ink2)
                    .padding(.horizontal, 14).frame(height: 46)
                    .background(npocCard(14))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 50)
        }
        .refreshable { await model.loadDetail(poId) }
    }

    private func header(_ po: NPZPo) -> some View {
        let st = NPZPoText.status(po.status)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(po.vendorName).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(2)
                Spacer(minLength: 6)
                NOSBadge(text: st.0, color: st.1)
            }
            Text(po.storeName).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
            HStack(alignment: .firstTextBaseline) {
                Text("合計（税込）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Text(NPZ.yen(po.total)).font(.system(size: 30, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
            NPZInfoRow(label: "小計（税抜）", value: NPZ.yen(po.subtotal))
            NPZInfoRow(label: "消費税", value: NPZ.yen(po.taxTotal))
            NPZDivider()
            NPZInfoRow(label: "入荷予定日", value: NPZ.date(po.expectedAt))
            NPZInfoRow(label: "発注日", value: po.orderedAt.map { NPZ.dateTime($0) } ?? "—")
            NPZInfoRow(label: "作成日", value: NPZ.dateTime(po.createdAt))
        }
        .padding(14)
        .background(npocCard())
    }

    @ViewBuilder private func actions(_ po: NPZPo) -> some View {
        let s = po.status
        VStack(spacing: 8) {
            if s == "draft" {
                NPOCWideButton(text: "申請する", icon: "paperplane", kind: .primary, busy: model.busy) { confirm = "request" }
            }
            if s == "requested" {
                NPOCWideButton(text: "承認する", icon: "checkmark.seal", kind: .success, busy: model.busy) { confirm = "approve" }
            }
            if s == "approved" {
                NPOCWideButton(text: "発注を確定する（仕入先へ発注）", icon: "cart.badge.plus", kind: .primary, busy: model.busy) {
                    model.detailError = nil
                    orderConfirm = true
                }
            }
            if s == "ordered" || s == "partially_received" {
                NPOCWideButton(text: "入荷を登録する（検品）", icon: "shippingbox", kind: .primary, busy: model.busy) { receiving = true }
            }
            if ["draft", "requested", "approved", "ordered"].contains(s) {
                NPOCWideButton(text: "発注を取消", icon: "xmark", kind: .secondary, disabled: model.busy) { cancelling = true }
            }
        }
    }

    private func itemsCard(_ po: NPZPo) -> some View {
        let receivedLines = po.items.filter { $0.receivedQuantity >= $0.quantity - 0.0001 }.count
        return NPOCard(title: "明細", trailing: "\(po.items.count)品・入荷 \(receivedLines)/\(po.items.count)") {
            ForEach(po.items) { i in
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(i.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
                        Spacer(minLength: 6)
                        Text(NPZ.yen((i.quantity * i.unitCost).rounded())).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    HStack(spacing: 8) {
                        Text("\(NPZ.q(i.quantity))\(i.unit) × \(NPZ.yen(i.unitCost))（税抜・\(NPZ.q(i.taxRate))%）")
                        Spacer(minLength: 4)
                        Text("入荷 \(NPZ.q(i.receivedQuantity))/\(NPZ.q(i.quantity))").foregroundColor(i.remaining <= 0 ? NT.ok : (i.receivedQuantity > 0 ? NT.warn : NT.ink3))
                    }
                    .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NT.page)
                            Capsule().fill(i.remaining <= 0 ? NT.ok : NT.warn)
                                .frame(width: i.quantity > 0 ? g.size.width * CGFloat(min(1, i.receivedQuantity / i.quantity)) : 0)
                        }
                    }
                    .frame(height: 5)
                }
                .padding(.vertical, 4)
                if i.id != po.items.last?.id { NPZDivider() }
            }
        }
    }

    /// 発注書を PDF にして共有（iPad の「印刷」と同じ中身）
    private func sharePdf() {
        guard let p = payload else { return }
        if NativePreview.current != nil { model.toast = "PDF を作りました"; return }
        if let url = NLShare.pdf(of: NPZPoPrintSheet(po: p.po), width: 595, name: "発注書_\(p.po.poNo).pdf") {
            NLShare.present(url: url)
        } else {
            model.detailError = "PDF を作れませんでした"
        }
    }
}

/// 発注確定の確認（仕入先・合計・明細を見せてから確定する）
struct NPZPoOrderConfirmSheet: View {
    let po: NPZPo
    let busy: Bool
    /// 確定できなかったときのサーバーのことば
    var error: String? = nil
    let onClose: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        NPOCSheetFrame(title: "発注を確定", confirmText: busy ? "確定中…" : "確定する", busy: busy, onCancel: onClose, onConfirm: onConfirm) {
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("仕入先「\(po.vendorName)」への発注を確定します。").font(.system(size: 15.5, weight: NT.strong)).foregroundColor(NT.ink)
                Text("確定すると「発注済み」になり、入荷登録ができるようになります。このあと発注書（PDF）を送る画面を出します。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            }
            NPOCard(title: "発注書 #\(po.poNo)") {
                NPZInfoRow(label: "仕入先", value: po.vendorName)
                NPZInfoRow(label: "店舗", value: po.storeName)
                NPZInfoRow(label: "入荷予定日", value: NPZ.date(po.expectedAt))
                NPZInfoRow(label: "明細", value: "\(po.items.count)品")
                NPZDivider()
                NPZInfoRow(label: "合計（税込）", value: NPZ.yen(po.total), tone: NT.purpleDeep)
            }
            NPOCard(title: "明細") {
                ForEach(po.items) { i in
                    HStack {
                        Text(i.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        Spacer()
                        Text("\(NPZ.q(i.quantity))\(i.unit)").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink2).monospacedDigit()
                    }
                }
            }
        }
        .presentationDetents([.large])
    }
}

/// 発注書の印刷の中身（Web の印刷ビュー・iPad と同じ並び。A4 の幅）
struct NPZPoPrintSheet: View {
    let po: NPZPo

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("発注書").font(.system(size: 20, weight: .bold))
            Text("発注番号 #\(po.poNo)　発注日 \(NPZ.date(String((po.orderedAt ?? po.createdAt).prefix(10))))").font(.system(size: 10)).foregroundColor(.gray).padding(.top, 4)
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(po.vendorName) 御中").font(.system(size: 14, weight: .semibold))
                    Text("下記の通り発注いたします。").font(.system(size: 11)).padding(.top, 10)
                    Text("希望納期：\(NPZ.date(po.expectedAt))").font(.system(size: 11))
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
                HStack {
                    Text("品目").frame(maxWidth: .infinity, alignment: .leading)
                    Text("数量").frame(width: 50, alignment: .trailing)
                    Text("単位").frame(width: 44)
                    Text("単価").frame(width: 70, alignment: .trailing)
                    Text("税率").frame(width: 40, alignment: .trailing)
                    Text("金額").frame(width: 80, alignment: .trailing)
                }
                .font(.system(size: 10, weight: .bold)).padding(.vertical, 5)
                .overlay(alignment: .bottom) { Rectangle().fill(Color.gray).frame(height: 1) }
                ForEach(po.items) { i in
                    HStack {
                        Text(i.name).frame(maxWidth: .infinity, alignment: .leading)
                        Text(NPZ.q(i.quantity)).frame(width: 50, alignment: .trailing)
                        Text(i.unit).frame(width: 44)
                        Text(NPZ.yen(i.unitCost)).frame(width: 70, alignment: .trailing)
                        Text("\(NPZ.q(i.taxRate))%").frame(width: 40, alignment: .trailing)
                        Text(NPZ.yen((i.quantity * i.unitCost).rounded())).frame(width: 80, alignment: .trailing)
                    }
                    .font(.system(size: 10)).monospacedDigit().padding(.vertical, 5)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color.gray.opacity(0.3)).frame(height: 1) }
                }
            }
            .padding(.top, 18)
            HStack {
                Spacer()
                VStack(spacing: 4) {
                    HStack { Text("小計（税抜）"); Spacer(); Text(NPZ.yen(po.subtotal)).monospacedDigit() }
                    HStack { Text("消費税"); Spacer(); Text(NPZ.yen(po.taxTotal)).monospacedDigit() }
                    Rectangle().fill(Color.gray.opacity(0.5)).frame(height: 1)
                    HStack { Text("合計（税込）").bold(); Spacer(); Text(NPZ.yen(po.total)).bold().monospacedDigit() }.font(.system(size: 13))
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
        .environment(\.colorScheme, .light)
    }
}
