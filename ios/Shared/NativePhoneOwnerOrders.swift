import SwiftUI

// iPhone の店長・オーナー：伝票明細（Web の /app/orders・/app/orders/<id>。2026-10-25 Ronnie「iPhone も native に」）
// サーバーは iPad と同じ GET ?part=slips（一覧）／ ?part=slip&id=（詳細）。返事の形は変えない。
//   期間（今日・昨日・今週・今月・過去7日・過去30日・日付を選ぶ）／売上・会計件数・客数・客単価・未会計／
//   状態（未会計・会計済・返金済・取消・無効）・支払方法・伝票No で絞り込み／伝票を押すと詳細（品目・支払・返金履歴・担当・卓）
//   操作：レシートの再印刷・領収書（一度きり。iPad と同じ POST slipReceipt ／ slipRyoshusho）
//   返金・取消（VOID）・再会計は NativePhoneOwnerRefund.swift（iPad と同じ POST slipRefund ／ slipReopen。確認あり）

/// GET ?part=slips の中身（使うところだけ）
struct NOSSlips: Decodable {
    struct Store: Decodable { let id: String; let name: String }
    struct Preset: Decodable, Hashable { let label: String; let from: String; let to: String }
    struct Method: Decodable, Hashable { let key: String; let label: String }
    struct Sales: Decodable {
        let settledSales: Double
        let settledCount: Double
        let guests: Double
        let perGuest: Double
        let unsettledCount: Double
        let unsettledTotal: Double
    }
    struct Pay: Decodable, Hashable { let cash: Double; let credit: Double; let emoney: Double; let points: Double; let other: Double }
    struct Row: Decodable, Identifiable, Hashable {
        let id: String
        let orderNo: Int
        let place: String
        let status: String
        let voided: Bool
        let partiallyRefunded: Bool
        let total: Double
        let refundTotal: Double
        let discountTotal: Double
        let guestCount: Double
        let openedAt: String
        let closedAt: String?
        let clerk: String?
        let pay: Pay?
        let ryoshushoIssued: Bool?
    }
    let store: Store
    let today: String
    let from: String
    let to: String
    let status: String
    let method: String
    let q: String
    let page: Int
    let totalPages: Int
    let presets: [Preset]
    let methods: [Method]
    let sales: Sales
    let orders: [Row]
}

/// GET ?part=slip&id= の中身（使うところだけ）
struct NOSSlipDetail: Decodable, Identifiable {
    struct Item: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let unitPrice: Double
        let quantity: Double
        let lineTotal: Double
        let status: String
        let cancelReason: String?
    }
    struct Payment: Decodable, Identifiable, Hashable {
        let id: String
        let method: String
        let label: String
        let amount: Double
        let tendered: Double?
        let change: Double?
        let paidAt: String
        let status: String
    }
    struct Refund: Decodable, Identifiable, Hashable {
        let id: String
        let kind: String
        let label: String
        let amount: Double
        let reason: String?
        let at: String
        let items: [String]?
    }
    struct Derived: Decodable, Hashable { let id: String; let orderNo: Int }
    let id: String
    let orderNo: Int
    let place: String
    let status: String
    let guestCount: Double
    let subtotal: Double
    let taxTotal: Double
    let serviceCharge: Double
    let discountTotal: Double
    let discountReason: String?
    let total: Double
    let openedAt: String
    let closedAt: String?
    let customerName: String?
    let items: [Item]
    let payments: [Payment]
    let refunds: [Refund]
    let totalPaid: Double?
    let totalRefunded: Double?
    let refundable: Double?
    let hasVoid: Bool?
    let ryoshushoIssued: Bool?
    let openDerived: Derived?
}

/// 開いている伝票（一覧の行があれば担当の名前もそこから）
struct NOSOpenSlip: Identifiable, Hashable {
    let id: String
    let row: NOSSlips.Row?
}

/// 伝票の状態の字と色（Web の伝票明細と同じ）
func nosSlipStatus(_ s: String) -> (String, Color) {
    switch s {
    case "open": return ("未会計", NT.warn)
    case "paid": return ("会計済", NT.ok)
    case "refunded": return ("返金済", NT.danger)
    case "cancelled": return ("取消", NT.ink2)
    case "void": return ("無効", NT.ink2)
    default: return (s, NT.ink2)
    }
}

@MainActor
final class NPOOrdersModel: ObservableObject {
    @Published var payload: NOSSlips?
    /// 読み込んだ伝票（「さらに読み込む」で足していく）
    @Published var rows: [NOSSlips.Row] = []
    @Published var from = ""
    @Published var to = ""
    @Published var status = ""
    @Published var method = ""
    @Published var q = ""
    @Published var page = 1
    @Published var loading = false
    @Published var loadingMore = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    @Published var open: NOSOpenSlip?
    @Published var detail: NOSSlipDetail?
    @Published var detailError: String?
    @Published var busy = false

    static let statuses: [(key: String, label: String)] = [("", "すべて"), ("open", "未会計"), ("paid", "会計済"), ("refunded", "返金済"), ("cancelled", "取消"), ("void", "無効")]

    init(route: NativeModuleRoute? = nil) {
        guard let route else { return }
        if let v = route.query("from"), NOS.isDay(v) { from = v }
        if let v = route.query("to"), NOS.isDay(v) { to = v }
        if let v = route.query("status") { status = v }
        if let v = route.query("method") { method = v }
        if let v = route.query("q") { q = v }
        // /app/orders/<id> → その伝票の詳細を開く
        let path = route.url.path
        let base = "/app/orders/"
        if path.hasPrefix(base), let id = path.dropFirst(base.count).split(separator: "/").first.map(String.init), NOS.isUuid(id) {
            open = NOSOpenSlip(id: id, row: nil)
        }
    }

    private func query(page: Int) -> [String: String] {
        var d: [String: String] = [:]
        for (k, v) in [("from", from), ("to", to), ("status", status), ("method", method), ("q", q)] where !v.isEmpty { d[k] = v }
        if page > 1 { d["page"] = String(page) }
        return d
    }

    /// 1 ページ目から読み直す
    func refresh() async {
        if NativePreview.current != nil { return }
        let qy = query(page: 1)
        if let saved = NativeModuleAPI.cached(NOSSlips.self, part: "slips", query: qy), payload == nil || !isCurrent(saved) { apply(saved, append: false) }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOSSlips.self, part: "slips", query: qy)
            guard qy == query(page: 1) else { return }
            apply(p, append: false)
            error = nil
        } catch {
            guard qy == query(page: 1) else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 次のページを足す
    func loadMore() async {
        guard let p = payload, p.page < p.totalPages, !loadingMore else { return }
        if NativePreview.current != nil { return }
        loadingMore = true
        defer { loadingMore = false }
        let base = query(page: 1)
        do {
            let next = try await NativeModuleAPI.get(NOSSlips.self, part: "slips", query: query(page: p.page + 1))
            guard base == query(page: 1) else { return }
            apply(next, append: true)
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
    }

    private func isCurrent(_ p: NOSSlips) -> Bool {
        guard let cur = payload else { return false }
        return cur.from == p.from && cur.to == p.to && cur.status == p.status && cur.method == p.method && cur.q == p.q
    }

    private func apply(_ p: NOSSlips, append: Bool) {
        payload = p
        if from.isEmpty { from = p.from }
        if to.isEmpty { to = p.to }
        if append {
            let have = Set(rows.map(\.id))
            rows += p.orders.filter { !have.contains($0.id) }
        } else {
            rows = p.orders
        }
        page = p.page
    }

    func setPeriod(_ f: String, _ t: String) {
        from = f
        to = t
        Task { await refresh() }
    }

    func setStatus(_ s: String) {
        status = s
        Task { await refresh() }
    }

    func setMethod(_ m: String) {
        method = m
        Task { await refresh() }
    }

    func setQuery(_ text: String) {
        q = String(text.filter(\.isNumber).prefix(12))
        Task { await refresh() }
    }

    // MARK: 詳細

    func openSlip(_ row: NOSSlips.Row) {
        detail = nil
        detailError = nil
        open = NOSOpenSlip(id: row.id, row: row)
    }

    func loadDetail(_ id: String) async {
        if NativePreview.current != nil { return }
        detailError = nil
        if detail?.id != id, let saved = NativeModuleAPI.cached(NOSSlipDetail.self, part: "slip", query: ["id": id]) { detail = saved }
        do {
            let d = try await NativeModuleAPI.get(NOSSlipDetail.self, part: "slip", query: ["id": id])
            guard open?.id == id else { return }
            detail = d
        } catch {
            guard open?.id == id else { return }
            detailError = NativeModuleAPI.message(error)
        }
    }

    /// レシートをもう一度（iPad と同じ POST slipReceipt。印刷はお店のプリンター）
    func reprint(_ id: String) async {
        busy = true
        defer { busy = false }
        if NativePreview.current != nil { toast = "レシートを印刷します"; return }
        let r = await NSPApi.postJSON(["type": "slipReceipt", "orderId": id])
        if r.ok { toast = "レシートを印刷します" } else { detailError = r.error ?? "印刷できませんでした" }
    }

    /// 領収書（NSRyoshushoSheet から。nil＝受け付けた、文字＝エラー）
    func sendRyoshusho(_ body: [String: Any]) async -> String? {
        let r = await NSPApi.postJSON(body)
        guard r.ok else { return r.error ?? "領収書を印刷できませんでした" }
        toast = "領収書を印刷します"
        if let id = open?.id { await loadDetail(id) }
        await refresh()
        return nil
    }
}

struct NativePhoneOwnerOrdersView: View {
    @ObservedObject var model: NPOOrdersModel
    let onBack: () -> Void
    let onWeb: (String) -> Void

    @State private var rangeOpen = false
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool

    private var multiDay: Bool { (model.payload?.from ?? "") != (model.payload?.to ?? "") }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "伝票明細", subtitle: model.payload?.store.name ?? "Slips", onBack: onBack, trailing: {
                Button { Task { await model.refresh() } } label: {
                    Group {
                        if model.loading { ProgressView().tint(.white) } else { Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)) }
                    }
                    .foregroundColor(.white).frame(width: 44, height: 44)
                }
                .accessibilityLabel("更新")
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
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .sheet(isPresented: $rangeOpen) {
            NOSRangeSheet(from: model.payload?.from ?? NOS.today, to: model.payload?.to ?? NOS.today, onClose: { rangeOpen = false }) { f, t in
                rangeOpen = false
                model.setPeriod(f, t)
            }
            .presentationDetents([.medium, .large])
            .environment(\.colorScheme, .light)
        }
        .sheet(item: $model.open) { o in
            NOSSlipDetailSheet(model: model, open: o, onClose: { model.open = nil })
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
        }
    }

    // MARK: 一覧

    private func list(_ p: NOSSlips) -> some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                periodCard(p)
                salesCard(p)
                filters(p)
                if model.rows.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "doc.text.magnifyingglass").font(.system(size: 26, weight: .semibold)).foregroundColor(NT.ink3)
                        Text("該当する伝票がありません").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                        Text("期間や条件を変えてみてください").font(.system(size: 12)).foregroundColor(NT.ink3)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 36)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                } else {
                    ForEach(model.rows) { r in
                        Button { model.openSlip(r) } label: { row(r) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                    if p.page < p.totalPages {
                        Button { Task { await model.loadMore() } } label: {
                            HStack(spacing: 6) {
                                if model.loadingMore { ProgressView().tint(NT.purple) }
                                Text("さらに読み込む（\(p.page)/\(p.totalPages)ページ）").font(.system(size: 14, weight: .bold))
                            }
                            .foregroundColor(NT.purple).frame(maxWidth: .infinity).frame(height: 48)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(model.loadingMore)
                    }
                    Text("伝票を押すと品目・支払・担当が見られます。返金・取消・再会計は iPad のレジの「伝票明細」で。")
                        .font(.system(size: 11)).foregroundColor(NT.ink3).multilineTextAlignment(.center).padding(.top, 2)
                }
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    // MARK: 期間

    private func periodLabel(_ p: NOSSlips) -> String {
        if p.from == p.to { return NOS.mdw(p.from) }
        return "\(NOS.md(p.from))〜\(NOS.md(p.to))"
    }

    private func periodCard(_ p: NOSSlips) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                Text(periodLabel(p)).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                if p.from == p.to && p.from == p.today { NOSBadge(text: "今日", color: NT.purple) }
                Spacer(minLength: 4)
                Button { rangeOpen = true } label: {
                    Text("日付を選ぶ").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(p.presets, id: \.self) { pr in
                        chip(pr.label, on: pr.from == p.from && pr.to == p.to) { model.setPeriod(pr.from, pr.to) }
                    }
                }
                .padding(.vertical, 1)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func chip(_ t: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 13.5, weight: .bold)).foregroundColor(on ? .white : NT.ink2)
                .padding(.horizontal, 13).frame(height: 34)
                .background(Capsule().fill(on ? NT.purple : Color.white))
                .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 売上のまとめ

    private func salesCard(_ p: NOSSlips) -> some View {
        let s = p.sales
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("売上（\(multiDay ? "期間" : "当日")・会計済）").font(.system(size: 12, weight: .bold)).foregroundColor(.white.opacity(0.8))
                    Text(NOS.yen(s.settledSales)).font(.system(size: 30, weight: NT.strong)).foregroundColor(.white).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                }
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
            LazyVGrid(columns: cols, spacing: 8) {
                tile("会計件数", "\(NOS.int(s.settledCount))件")
                tile("客数", "\(NOS.int(s.guests))名")
                tile("客単価", NOS.yen(s.perGuest))
            }
            if s.unsettledCount > 0 {
                Button { model.setStatus("open") } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "clock.badge.exclamationmark").font(.system(size: 13, weight: .bold))
                        Text("未会計 \(NOS.int(s.unsettledCount))件").font(.system(size: 13, weight: NT.strong))
                        Text(NOS.yen(s.unsettledTotal)).font(.system(size: 13, weight: .bold)).monospacedDigit()
                        Spacer()
                        Text("見る").font(.system(size: 12, weight: .bold))
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    }
                    .foregroundColor(NT.warn)
                    .padding(.horizontal, 12).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.warn.opacity(0.1)))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1)
            Text(value).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
    }

    // MARK: 絞り込み（状態・支払方法・伝票No）

    private func filters(_ p: NOSSlips) -> some View {
        VStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(NPOOrdersModel.statuses, id: \.0) { s in
                        chip(s.label, on: p.status == s.key) { model.setStatus(s.key) }
                    }
                }
                .padding(.vertical, 1)
            }
            HStack(spacing: 8) {
                Menu {
                    Button { model.setMethod("") } label: { if p.method.isEmpty { Label("すべての支払方法", systemImage: "checkmark") } else { Text("すべての支払方法") } }
                    ForEach(p.methods, id: \.self) { m in
                        Button { model.setMethod(m.key) } label: { if p.method == m.key { Label(m.label, systemImage: "checkmark") } else { Text(m.label) } }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "creditcard").font(.system(size: 12, weight: .bold))
                        Text(p.method.isEmpty ? "支払方法" : (p.methods.first { $0.key == p.method }?.label ?? p.method)).font(.system(size: 13, weight: .bold)).lineLimit(1)
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                    }
                    .foregroundColor(p.method.isEmpty ? NT.ink2 : .white)
                    .padding(.horizontal, 12).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.method.isEmpty ? Color.white : NT.purple))
                }
                HStack(spacing: 6) {
                    Image(systemName: "number").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    TextField("伝票No", text: $searchText)
                        .keyboardType(.numberPad)
                        .focused($searchFocused)
                        .font(.system(size: 15, weight: .semibold))
                        .submitLabel(.search)
                        .onSubmit { model.setQuery(searchText) }
                    if !searchText.isEmpty || !p.q.isEmpty {
                        Button { searchText = ""; searchFocused = false; model.setQuery("") } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(NT.ink3)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                if searchFocused {
                    Button { searchFocused = false; model.setQuery(searchText) } label: {
                        Text("探す").font(.system(size: 14, weight: NT.strong)).foregroundColor(.white)
                            .padding(.horizontal, 14).frame(height: 40)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .onAppear { if searchText.isEmpty { searchText = p.q } }
    }

    // MARK: 伝票の行

    private func row(_ o: NOSSlips.Row) -> some View {
        let (sl, sc) = nosSlipStatus(o.status)
        let open = o.status == "open"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("#\(o.orderNo)").font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                Text(o.place).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(NOS.yen(o.total)).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    if o.refundTotal > 0 {
                        Text("純額 \(NOS.yen(o.total - o.refundTotal))").font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.danger).monospacedDigit()
                    }
                }
            }
            HStack(spacing: 5) {
                NOSBadge(text: sl, color: sc)
                if o.voided { NOSBadge(text: "取消", color: NT.ink2) }
                if o.partiallyRefunded { NOSBadge(text: "一部返金", color: NT.warn) }
                if o.ryoshushoIssued == true { NOSBadge(text: "領収書済", color: NT.ink3) }
                Spacer(minLength: 4)
                Text(payText(o.pay)).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
            }
            HStack(spacing: 10) {
                Label("\(NOS.time(o.openedAt, withDate: multiDay))〜\(open ? "" : NOS.time(o.closedAt, withDate: multiDay))", systemImage: "clock")
                Label("\(NOS.int(o.guestCount))名", systemImage: "person.2")
                if let c = o.clerk, !c.isEmpty { Label(c, systemImage: "person.badge.shield.checkmark").lineLimit(1) }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).labelStyle(NOSCompactLabel())
            .lineLimit(1).minimumScaleFactor(0.85)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }

    private func payText(_ pay: NOSSlips.Pay?) -> String {
        guard let pay else { return "" }
        let parts: [(String, Double)] = [("現金", pay.cash), ("クレジット", pay.credit), ("電子マネー", pay.emoney), ("ポイント", pay.points), ("その他", pay.other)]
        return parts.filter { $0.1 > 0 }.map { $0.0 }.joined(separator: "・")
    }
}

/// アイコンと字を詰めて並べる
struct NOSCompactLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon.font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
            configuration.title
        }
    }
}

// MARK: - 伝票の詳細

struct NOSSlipDetailSheet: View {
    @ObservedObject var model: NPOOrdersModel
    let open: NOSOpenSlip
    let onClose: () -> Void

    @State private var reprintConfirm = false
    @State private var ryoshushoOpen = false

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                NT.page.ignoresSafeArea()
                if let d = model.detail, d.id == open.id {
                    content(d)
                } else if let e = model.detailError {
                    NOSStateView(error: e) { Task { await model.loadDetail(open.id) } }
                } else {
                    NOSStateView(error: nil) {}
                }
                NPHToast(text: $model.toast)
            }
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
        }
        .task(id: open.id) { await model.loadDetail(open.id) }
        .confirmationDialog("レシートをもう一度印刷しますか？", isPresented: $reprintConfirm, titleVisibility: .visible) {
            Button("レシートを印刷する") { Task { await model.reprint(open.id) } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("お店のレシートプリンターから出ます。")
        }
        .sheet(isPresented: $ryoshushoOpen) {
            if let d = model.detail {
                NSRyoshushoSheet(orderId: d.id, orderNo: d.orderNo, amount: Int((d.total - (d.totalRefunded ?? 0)).rounded()), onClose: { ryoshushoOpen = false }, send: { body in
                    await model.sendRyoshusho(body)
                })
                .environment(\.colorScheme, .light)
            }
        }
    }

    private var titleText: String {
        if let d = model.detail, d.id == open.id { return "伝票 #\(d.orderNo)" }
        if let r = open.row { return "伝票 #\(r.orderNo)" }
        return "伝票"
    }

    private func content(_ d: NOSSlipDetail) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                header(d)
                itemsCard(d)
                summaryCard(d)
                paymentsCard(d)
                if !d.refunds.isEmpty { refundsCard(d) }
                actions(d)
                if let e = model.detailError {
                    Text(e).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 40)
        }
        .refreshable { await model.loadDetail(open.id) }
    }

    private func header(_ d: NOSSlipDetail) -> some View {
        let (sl, sc) = nosSlipStatus(d.status)
        return NPOCard {
            HStack(spacing: 8) {
                Image(systemName: "fork.knife").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                Text(d.place).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                NOSBadge(text: sl, color: sc)
                if d.hasVoid == true { NOSBadge(text: "取消あり", color: NT.ink2) }
            }
            Text(NOS.yen(d.total)).font(.system(size: 30, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
            VStack(spacing: 6) {
                info("入店", NOS.time(d.openedAt, withDate: true))
                info("退店・会計", d.closedAt.map { NOS.time($0, withDate: true) } ?? "—")
                info("人数", "\(NOS.int(d.guestCount))名")
                if let c = open.row?.clerk, !c.isEmpty { info("会計担当", c) }
                if let c = d.customerName, !c.isEmpty { info("顧客", c) }
                if let dv = d.openDerived { info("再会計伝票", "#\(dv.orderNo)（未会計）") }
            }
        }
    }

    private func info(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
            Spacer()
            Text(value).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
        }
    }

    private func itemsCard(_ d: NOSSlipDetail) -> some View {
        NPOCard(title: "品目", trailing: "\(d.items.filter { $0.status == "active" }.count)品") {
            if d.items.isEmpty {
                Text("品目がありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(d.items) { it in
                let active = it.status == "active"
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(it.name).strikethrough(!active).font(.system(size: 14, weight: .bold)).foregroundColor(active ? NT.ink : NT.ink3)
                        Text("\(NOS.yen(it.unitPrice)) × \(NOS.plain(it.quantity))").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                        if !active {
                            Text("取消\(it.cancelReason.map { "：\($0)" } ?? "")").font(.system(size: 11, weight: .bold)).foregroundColor(NT.danger)
                        }
                    }
                    Spacer(minLength: 6)
                    Text(NOS.yen(it.lineTotal)).strikethrough(!active).font(.system(size: 14, weight: NT.strong)).foregroundColor(active ? NT.ink : NT.ink3).monospacedDigit()
                }
                .padding(.vertical, 4)
                .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1).offset(y: 4) }
            }
        }
    }

    private func summaryCard(_ d: NOSSlipDetail) -> some View {
        NPOCard(title: "会計") {
            sumRow("小計", NOS.yen(d.subtotal))
            if d.serviceCharge > 0 { sumRow("サービス料", NOS.yen(d.serviceCharge)) }
            if d.discountTotal > 0 { sumRow("値引\(d.discountReason.map { "（\($0)）" } ?? "")", "−\(NOS.yen(d.discountTotal))", color: NT.danger) }
            sumRow("うち消費税", NOS.yen(d.taxTotal))
            Rectangle().fill(NT.line).frame(height: 1)
            sumRow("合計", NOS.yen(d.total), bold: true)
            if let r = d.totalRefunded, r > 0 {
                sumRow("返金", "−\(NOS.yen(r))", color: NT.danger)
                sumRow("差し引き", NOS.yen(d.total - r), bold: true)
            }
        }
    }

    private func sumRow(_ label: String, _ value: String, bold: Bool = false, color: Color = NT.ink) -> some View {
        HStack {
            Text(label).font(.system(size: bold ? 15 : 13.5, weight: bold ? NT.strong : .semibold)).foregroundColor(bold ? NT.ink : NT.ink2).lineLimit(1)
            Spacer()
            Text(value).font(.system(size: bold ? 18 : 14, weight: bold ? NT.strong : .bold)).foregroundColor(color).monospacedDigit()
        }
    }

    private func paymentsCard(_ d: NOSSlipDetail) -> some View {
        NPOCard(title: "支払") {
            if d.payments.isEmpty {
                Text("支払の記録がありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(d.payments) { pm in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(pm.label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                        if pm.status != "completed" { Text("（\(pm.status)）").font(.system(size: 12)).foregroundColor(NT.ink3) }
                        Spacer()
                        Text(NOS.yen(pm.amount)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    HStack(spacing: 8) {
                        Text(NOS.time(pm.paidAt, withDate: true))
                        if let t = pm.tendered { Text("預り \(NOS.yen(t))") }
                        if let c = pm.change, c > 0 { Text("お釣り \(NOS.yen(c))") }
                    }
                    .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func refundsCard(_ d: NOSSlipDetail) -> some View {
        NPOCard(title: "返金・取消の履歴") {
            ForEach(d.refunds) { r in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(r.kind == "void" ? "取消（VOID）" : "返金").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink)
                        Text(r.label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
                        Spacer()
                        Text("−\(NOS.yen(r.amount))").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.danger).monospacedDigit()
                    }
                    Text("\(r.reason.map { "理由：\($0)　" } ?? "")\(NOS.time(r.at, withDate: true))").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                    if let items = r.items, !items.isEmpty {
                        Text(items.joined(separator: "、")).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: 操作（レシート・領収書）

    private func actions(_ d: NOSSlipDetail) -> some View {
        let canPrint = d.status != "open"
        let canRyoshusho = d.status == "paid" && d.hasVoid != true && open.row?.voided != true
        let issued = d.ryoshushoIssued == true
        return VStack(spacing: 8) {
            if canPrint {
                Button { reprintConfirm = true } label: {
                    actionLabel("レシートを再印刷", icon: "printer", filled: true)
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy)
                // レシート・領収書のプレビュー（ネイティブ。NativePhoneOwnerReceipt.swift。2026-10-25 Ronnie）
                Button { AppState.shared.leaveNativePhone(to: "/app/pos/receipt/\(d.id)?from=orders") } label: {
                    actionLabel("レシート・領収書を見る", icon: "doc.text.magnifyingglass", filled: false)
                }
                .buttonStyle(PressableStyle())
            }
            if canRyoshusho {
                if issued {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.seal").font(.system(size: 14, weight: .bold))
                        Text("領収書は発行済みです（一度きり）").font(.system(size: 13.5, weight: .bold))
                    }
                    .foregroundColor(NT.ink3).frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
                } else {
                    Button { ryoshushoOpen = true } label: {
                        actionLabel("領収書を発行", icon: "doc.text", filled: false)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            if d.status == "open" {
                Text("未会計の伝票です。注文・会計はハンディかレジ（iPad）で。").font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                // 返金・取消（VOID）・再会計もネイティブで（NativePhoneOwnerRefund.swift。2026-10-25「101% native」）
                NPOSlipMoneyActions(orderId: d.id) { msg in
                    model.toast = msg
                    Task { await model.loadDetail(d.id); await model.refresh() }
                }
            }
        }
        .padding(.top, 4)
    }

    private func actionLabel(_ t: String, icon: String, filled: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold))
            Text(t).font(.system(size: 15, weight: NT.strong))
        }
        .foregroundColor(filled ? .white : NT.purpleDeep)
        .frame(maxWidth: .infinity).frame(height: 50)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(filled ? NT.purple : NT.lilac))
    }
}

/// key "orders" の画面（NativePhoneOwnerScreen から）
struct NativePhoneOwnerOrdersScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPOOrdersModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NPOOrdersModel(route: route))
    }

    var body: some View {
        NativePhoneOwnerOrdersView(model: model, onBack: { state.closePhoneOwnerModule() }, onWeb: { state.leaveNativePhone(to: $0) })
            .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }
}
