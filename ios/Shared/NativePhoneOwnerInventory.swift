import SwiftUI

// iPhone の店長・オーナー：在庫（Web の /app/inventory。2026-10-25 Ronnie「iPhone も native に」）
//   タブ：品目（在庫数・警告・要発注・値上がり）／棚卸（開始・実数の入力・確定）／移動（発送・受取）／発注提案／予測
//   品目を押すと詳細：入出庫（入庫・出庫・廃棄・棚卸調整）・品目の編集・入出庫履歴・仕入価格履歴・発注書を作成
//   「品切れ・残り数」は在庫設定の画面（key stock・NativePhoneOwnerStock.swift）
// サーバーは iPad と同じ：GET part=inventory|inventoryCount|inventoryHistory|inventoryPurchases ／ POST inv…（返事の形は変えない）
// 即時移動・移動の申請・取消は NativePhoneOwnerTransfers.swift（Web には行かない）。

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPZInvItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let itemKind: String
    let category: String?
    let unit: String
    let currentQuantity: Double
    let reorderPoint: Double?
    let minQuantity: Double?
    let optimalQuantity: Double?
    let avgCost: Double?
    let lastPurchaseCost: Double?
    let purchaseUnit: String?
    let purchaseToStockFactor: Double?
    let warning: String?
    let priceUp: Bool?
    let stockValue: Double?

    var factor: Double { (purchaseToStockFactor ?? 1) > 0 ? (purchaseToStockFactor ?? 1) : 1 }
}

struct NPZInvStats: Decodable, Hashable {
    let totalStockValue: Double
    let reorderCount: Int
    let dangerCount: Int
    let priceUpCount: Int
}

struct NPZInvCount: Decodable, Identifiable, Hashable {
    let id: String
    let countDate: String
    let status: String
}

struct NPZInvTransferLine: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: Double
    let unit: String
}

struct NPZInvTransfer: Decodable, Identifiable, Hashable {
    let id: String
    let transferNo: Int
    let fromStoreId: String
    let fromStoreName: String
    let toStoreId: String
    let toStoreName: String
    let status: String
    let note: String?
    let requestedByName: String?
    let shippedByName: String?
    let receivedByName: String?
    let createdAt: String
    let items: [NPZInvTransferLine]
}

struct NPZInvReorder: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let currentQuantity: Double
    let avgDailySales: Double
    let incomingQuantity: Double
    let needed: Bool
    let suggestedQuantity: Double
    let basis: String?
}

struct NPZInvForecast: Decodable {
    struct Result: Decodable, Hashable {
        let tomorrow: Double
        let thisWeekRemaining: Double
        let nextWeek: Double
        let lowConfidence: Bool
    }
    struct Weekday: Decodable, Hashable {
        let weekday: String
        let avg: Double
    }
    struct Top: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let unit: String
        let tomorrow: Double
    }
    let itemOptions: [NPZNamed]
    let result: Result?
    let weekdayChart: [Weekday]
    let unit: String
    let selectedName: String
    let top: [Top]
}

/// GET ?part=inventory&tab=…
struct NPZInvPayload: Decodable {
    let store: NPZNamed
    let tab: String
    let canWrite: Bool
    let canTransfer: Bool
    let otherStores: [NPZNamed]?
    let units: [String]?
    let items: [NPZInvItem]?
    let stats: NPZInvStats?
    let reorderList: [String]?
    let counts: [NPZInvCount]?
    let transfers: [NPZInvTransfer]?
    /// 移動できる品目（移動のタブだけ。申請・即時移動の選択肢。NativePhoneOwnerTransfers.swift）
    let transferItems: [NPZInvTransferItem]?
    let reorder: [NPZInvReorder]?
    let forecast: NPZInvForecast?
}

/// GET ?part=inventoryHistory&id=
struct NPZInvHistRow: Decodable, Identifiable, Hashable {
    let id: String
    let movementType: String
    let quantity: Double
    let reason: String?
    let occurredAt: String
    let toStoreName: String?
}

struct NPZInvHistory: Decodable {
    let rows: [NPZInvHistRow]
}

/// GET ?part=inventoryPurchases&id=
struct NPZInvPurchases: Decodable {
    struct Row: Decodable, Identifiable, Hashable {
        let id: String
        let businessDate: String
        let vendorName: String?
        let unitCost: Double?
        let quantity: Double
    }
    let unit: String
    let currentAvgCost: Double?
    let previousUnitCost: Double?
    let priorUnitCost: Double?
    let changeRatePct: Double?
    let isSignificantIncrease: Bool?
    let rows: [Row]
}

/// 名前・色（Web の components/inventory/labels.ts と同じ）
enum NPZInv {
    static let kinds: [(String, String)] = [("ingredient", "食材"), ("supply", "備品・消耗品"), ("product", "商品（販売連動）")]
    static let kindFilters: [(String, String)] = [("", "すべて")] + kinds
    static func kindLabel(_ k: String) -> String { kinds.first { $0.0 == k }?.1 ?? k }

    static let movementLabels: [String: String] = [
        "in": "入庫", "out": "出庫", "waste": "廃棄", "return": "返品", "transfer_in": "移動入庫",
        "transfer_out": "移動出庫", "count_adjust": "棚卸調整", "sale": "販売",
    ]
    static let manualMovements: [(String, String)] = [("in", "入庫"), ("out", "出庫"), ("waste", "廃棄"), ("count_adjust", "棚卸調整")]
    static func needsReason(_ t: String) -> Bool { t == "out" || t == "waste" || t == "count_adjust" }

    static func warning(_ w: String?) -> (String, Color)? {
        switch w ?? "" {
        case "danger": return ("在庫切れ間近", NT.danger)
        case "warning": return ("要発注", NT.warn)
        default: return nil
        }
    }

    static func countStatus(_ s: String) -> (String, Color) {
        s == "completed" ? ("確定済み", NT.ok) : s == "draft" ? ("入力中", NT.warn) : (s, NT.ink3)
    }

    static func transferStatus(_ s: String) -> (String, Color) {
        switch s {
        case "requested": return ("申請中", NT.warn)
        case "shipped": return ("発送済み", NT.purple)
        case "received": return ("受取済み", NT.ok)
        case "cancelled": return ("取消", NT.ink3)
        default: return (s, NT.ink3)
        }
    }

    /// 仕入単位と在庫単位からの推奨係数（lib/units.ts の suggestConversionFactor と同じ）
    static func suggestFactor(_ p: String, _ s: String) -> Double? {
        if p == s { return 1 }
        let known: [String: Double] = ["kg>g": 1000, "g>g": 1, "kg>kg": 1, "L>ml": 1000, "ml>ml": 1, "L>L": 1]
        return known["\(p)>\(s)"]
    }

    /// 変換後の在庫単価の丸め誤差が大きいか（lib/units.ts の hasCostPrecisionRisk と同じ）
    static func costRisk(_ cost: Double, _ factor: Double) -> Bool {
        guard factor > 0 else { return false }
        let exact = cost / factor
        guard exact > 0 else { return false }
        let r = exact.rounded()
        if r == 0 { return true }
        return abs(exact - r) / exact > 0.05
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPZInventoryModel: ObservableObject {
    @Published var tab = "items"
    @Published var kind = ""
    @Published var q = ""
    @Published var sortWarning = false
    @Published var forecastItem = ""
    /// タブごとの中身（タブを行き来しても前の中身をすぐ出す）
    @Published var payloads: [String: NPZInvPayload] = [:]
    @Published var loading = false
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いている棚卸（/app/inventory/counts/<id> ・「棚卸を開始」）
    @Published var countId: String?
    /// 品目の入出庫履歴・仕入価格履歴（品目 id → 中身）
    @Published var histories: [String: [NPZInvHistRow]] = [:]
    @Published var purchases: [String: NPZInvPurchases] = [:]

    static let tabs: [(String, String)] = [("items", "品目"), ("counts", "棚卸"), ("transfers", "移動"), ("reorder", "発注提案"), ("forecast", "予測")]

    init(route: NativeModuleRoute? = nil) {
        guard let route else { return }
        let t = route.query("tab") ?? "items"
        tab = Self.tabs.contains(where: { $0.0 == t }) ? t : "items"
        kind = route.query("kind") ?? ""
        q = route.query("q") ?? ""
        sortWarning = route.query("sort") == "warning"
        if let item = route.query("item"), NOS.isUuid(item) { forecastItem = item }
        // /app/inventory/counts/<id> → その棚卸の入力
        let parts = route.url.path.split(separator: "/").map(String.init)
        if parts.count >= 4, parts[1] == "inventory", parts[2] == "counts", NOS.isUuid(parts[3]) {
            tab = "counts"
            countId = parts[3]
        }
        payloads[tab] = NPZApi.cached(NPZInvPayload.self, "inventory", query(for: tab))
    }

    var payload: NPZInvPayload? { payloads[tab] }

    func query(for t: String) -> [String: String] {
        var d: [String: String] = ["tab": t]
        if t == "items" {
            if !kind.isEmpty { d["kind"] = kind }
            let s = NPZ.trimmed(q)
            if !s.isEmpty { d["q"] = s }
            if sortWarning { d["sort"] = "warning" }
        }
        if t == "forecast", !forecastItem.isEmpty { d["item"] = forecastItem }
        return d
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let t = tab
        let qy = query(for: t)
        if payloads[t] == nil, let saved = NPZApi.cached(NPZInvPayload.self, "inventory", qy) { payloads[t] = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NPZApi.get(NPZInvPayload.self, "inventory", qy)
            guard qy == query(for: t) else { return }
            payloads[t] = p
            error = nil
        } catch {
            if NPZApi.useWeb(error) { useWeb = true; return }
            self.error = NPZApi.message(error)
        }
    }

    func setTab(_ t: String) {
        guard t != tab else { return }
        tab = t
        error = nil
        Task { await refresh() }
    }

    func act(_ body: [String: Any]) async -> NPZResult {
        busy = true
        defer { busy = false }
        return await NPZApi.post(body)
    }

    /// 品目の履歴（入出庫・仕入価格）を読む
    func loadHistory(_ itemId: String) async {
        if NativePreview.current != nil { return }
        do {
            let h = try await NPZApi.get(NPZInvHistory.self, "inventoryHistory", ["id": itemId])
            histories[itemId] = h.rows
            purchases[itemId] = try await NPZApi.get(NPZInvPurchases.self, "inventoryPurchases", ["id": itemId])
        } catch {
            if histories[itemId] == nil { histories[itemId] = [] }
            self.error = NPZApi.message(error)
        }
    }

    /// 発注書の作成（ネイティブの「発注」で開く）。items は id:数量
    static func newPoPath(items: [(String, Double)]) -> String {
        var c = URLComponents()
        c.queryItems = [URLQueryItem(name: "items", value: items.map { "\($0.0):\(NPZ.q($0.1))" }.joined(separator: ","))]
        return "/app/purchases/new?\(c.percentEncodedQuery ?? "")"
    }
}

// MARK: - 画面

/// key "inventory" の画面（NativePhoneOwnerScreen から）。?tab=menu は在庫設定（品切れ・残り数）
struct NativePhoneInventoryScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPZInventoryModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NPZInventoryModel(route: route))
    }

    var body: some View {
        if route.query("tab") == "menu" {
            NativePhoneStockScreen(route: route)
        } else {
            NativePhoneInventoryView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
                .modifier(NPOCWebFallback(key: "inventory", useWeb: model.useWeb, state: state))
        }
    }
}

/// 品目の追加・編集のシート（item が nil なら追加）
struct NPZInvFormRef: Identifiable {
    let item: NPZInvItem?
    var id: String { item?.id ?? "new" }
}

struct NativePhoneInventoryView: View {
    @ObservedObject var model: NPZInventoryModel
    let onBack: () -> Void
    /// 別の画面へ（発注書の作成・品切れ・Web）
    let onOpen: (String) -> Void

    @State private var openItem: NPZInvItem?
    @State private var form: NPZInvFormRef?
    @State private var startingCount = false

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "在庫", subtitle: model.payload?.store.name ?? "Inventory", onBack: onBack, trailing: {
                trailing
            }, content: {
                VStack(spacing: 0) {
                    tabs
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        content(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            NPHToast(text: $model.toast)
            if let id = model.countId {
                NPZCountView(countId: id, storeName: model.payload?.store.name ?? "", onClose: { changed in
                    model.countId = nil
                    if changed { Task { await model.refresh() } }
                })
                .transition(.move(edge: .trailing))
                .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.22), value: model.countId)
        .task { await model.refresh() }
        .sheet(item: $openItem) { it in
            NPZInvItemSheet(model: model, itemId: it.id, fallback: it, onClose: { openItem = nil }, onOpen: { path in
                openItem = nil
                onOpen(path)
            })
        }
        .sheet(item: $form) { f in
            NPZInvItemFormSheet(model: model, item: f.item, units: model.payloads["items"]?.units ?? [], onClose: { form = nil })
        }
    }

    @ViewBuilder private var trailing: some View {
        if model.tab == "items", model.payload?.canWrite == true {
            NPOCBarButton(icon: "plus", label: "品目") { form = NPZInvFormRef(item: nil) }
        } else {
            NPZRefreshButton(loading: model.loading) { Task { await model.refresh() } }
        }
    }

    // MARK: タブ

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(NPZInventoryModel.tabs, id: \.0) { t in
                    NPOCChip(text: t.1, selected: model.tab == t.0) { model.setTab(t.0) }
                }
                Button { onOpen("/app/inventory/menu-stock") } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark.octagon").font(.system(size: 12, weight: .bold))
                        Text("品切れ・残り数").font(.system(size: 14, weight: .bold))
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                    }
                    .foregroundColor(NT.purpleDeep)
                    .padding(.horizontal, 13).frame(height: 38)
                    .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .background(NT.page)
    }

    private func content(_ p: NPZInvPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                switch model.tab {
                case "counts": countsTab(p)
                case "transfers": NPZTransfersList(model: model, p: p, onOpen: onOpen)
                case "reorder": NPZReorderList(rows: p.reorder ?? [], onOpen: onOpen)
                case "forecast": NPZForecastView(model: model, f: p.forecast)
                default: itemsTab(p)
                }
            }
            .padding(.horizontal, 12).padding(.top, 2).padding(.bottom, 60)
        }
        .refreshable { await model.refresh() }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: 品目

    @ViewBuilder private func itemsTab(_ p: NPZInvPayload) -> some View {
        let items = p.items ?? []
        if let s = p.stats {
            NPZTileGrid {
                NPZTile(label: "総在庫金額", value: NPZ.yen(s.totalStockValue), tone: NT.purpleDeep)
                NPZTile(label: "要発注", value: "\(s.reorderCount)件", tone: s.reorderCount > 0 ? NT.warn : NT.ink)
                NPZTile(label: "在庫切れ間近", value: "\(s.dangerCount)件", tone: s.dangerCount > 0 ? NT.danger : NT.ink)
                NPZTile(label: "値上がり", value: "\(s.priceUpCount)件", tone: s.priceUpCount > 0 ? NT.danger : NT.ink, sub: "前回仕入が前々回比10%以上")
            }
        }
        reorderBox(p, items)
        filters
        if items.isEmpty {
            NPOCEmpty(icon: "shippingbox", title: model.q.isEmpty && model.kind.isEmpty ? "品目が登録されていません" : "該当する品目がありません",
                      note: p.canWrite ? "右上の「＋ 品目」から在庫品目を登録できます" : "")
        } else {
            Text("\(items.count)品目・押すと入出庫・履歴").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).padding(.leading, 4)
            ForEach(items) { it in
                Button { openItem = it } label: { NPZInvItemRow(item: it) }
                    .buttonStyle(PressableStyle(scale: 0.985))
            }
        }
    }

    @ViewBuilder private func reorderBox(_ p: NPZInvPayload, _ items: [NPZInvItem]) -> some View {
        let list: [NPZInvItem] = (p.reorderList ?? []).compactMap { id in items.first(where: { $0.id == id }) }
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 13, weight: .bold))
                    Text("要発注（発注点以下）\(p.stats?.reorderCount ?? list.count)件").font(.system(size: 14, weight: .heavy))
                    Spacer()
                    Button { model.setTab("reorder") } label: {
                        Text("発注提案へ").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                            .padding(.horizontal, 10).frame(height: 30)
                            .background(Capsule().fill(Color.white))
                    }
                    .buttonStyle(PressableStyle())
                }
                .foregroundColor(NT.warn)
                ForEach(list) { r in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            Text("現在庫 \(NPZ.q(r.currentQuantity))\(r.unit)／発注点 \(NPZ.q(r.reorderPoint))\(r.unit)")
                                .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1)
                        }
                        Spacer(minLength: 6)
                        Button { onOpen("/app/purchases/new?item=\(r.id)") } label: {
                            Text("発注書").font(.system(size: 13, weight: .heavy)).foregroundColor(.white)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(Capsule().fill(NT.purple))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.warn.opacity(0.1)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.warn.opacity(0.3), lineWidth: 1))
        }
    }

    private var filters: some View {
        VStack(spacing: 8) {
            NPZSearchField(text: $model.q, placeholder: "品目名で探す") { Task { await model.refresh() } }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(NPZInv.kindFilters, id: \.0) { k in
                        NPOCChip(text: k.1, selected: model.kind == k.0) {
                            model.kind = k.0
                            Task { await model.refresh() }
                        }
                    }
                    NPOCChip(text: "警告を上に", selected: model.sortWarning) {
                        model.sortWarning.toggle()
                        Task { await model.refresh() }
                    }
                }
                .padding(.vertical, 1)
            }
        }
    }

    // MARK: 棚卸

    @ViewBuilder private func countsTab(_ p: NPZInvPayload) -> some View {
        let counts = p.counts ?? []
        if p.canWrite {
            NPOCWideButton(text: startingCount ? "準備中…" : "棚卸を開始", icon: "checklist", busy: startingCount) { Task { await startCount() } }
            Text("今の理論在庫で棚卸表を作ります。実数を入れて確定すると在庫数が更新されます。")
                .font(.system(size: 11.5)).foregroundColor(NT.ink3).padding(.horizontal, 4)
        }
        if counts.isEmpty {
            NPOCEmpty(icon: "checklist", title: "棚卸の記録がありません", note: p.canWrite ? "「棚卸を開始」から始めてください" : "")
        } else {
            VStack(spacing: 0) {
                ForEach(counts) { c in
                    let st = NPZInv.countStatus(c.status)
                    Button { model.countId = c.id } label: {
                        HStack(spacing: 10) {
                            Image(systemName: c.status == "draft" ? "pencil.circle.fill" : "checkmark.seal.fill").font(.system(size: 20))
                                .foregroundColor(st.1)
                            Text(NPZ.date(c.countDate)).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                            NOSBadge(text: st.0, color: st.1)
                            Spacer()
                            Text(c.status == "draft" ? "入力する" : "見る").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                        }
                        .padding(.horizontal, 14).frame(minHeight: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if c.id != counts.last?.id { NPZDivider(inset: 14) }
                }
            }
            .background(npocCard())
        }
    }

    private func startCount() async {
        startingCount = true
        defer { startingCount = false }
        let r = await model.act(["type": "invCountStart"])
        if r.ok, let id = r.id {
            model.countId = id
        } else if !r.ok {
            model.error = r.error ?? "棚卸の開始に失敗しました"
        }
    }
}

/// 品目の 1 行（名前・在庫数・警告）
struct NPZInvItemRow: View {
    let item: NPZInvItem

    private var tone: Color {
        switch item.warning ?? "" {
        case "danger": return NT.danger
        case "warning": return NT.warn
        default: return NT.ink
        }
    }

    /// 適正在庫に対する今の量（0〜1）。適正在庫が無ければ出さない
    private var level: Double? {
        guard let o = item.optimalQuantity, o > 0 else { return nil }
        return max(0, min(1, item.currentQuantity / o))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                    Text([NPZInv.kindLabel(item.itemKind), item.category ?? ""].filter { !$0.isEmpty }.joined(separator: "・"))
                        .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 6)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(NPZ.q(item.currentQuantity)).font(.system(size: 24, weight: .heavy)).foregroundColor(tone).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text(item.unit).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            if let level {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(NT.page)
                        Capsule().fill(tone == NT.ink ? NT.purple.opacity(0.7) : tone.opacity(0.8)).frame(width: max(4, g.size.width * CGFloat(level)))
                    }
                }
                .frame(height: 6)
            }
            HStack(spacing: 5) {
                if let w = NPZInv.warning(item.warning) { NOSBadge(text: w.0, color: w.1) }
                if item.priceUp == true { NOSBadge(text: "値上がり", color: NT.danger) }
                Spacer(minLength: 4)
                if let rp = item.reorderPoint {
                    Text("発注点 \(NPZ.q(rp))").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                }
                Text(NPZ.yen(item.stockValue)).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .lineLimit(1)
        }
        .padding(12)
        .background(npocCard(14))
    }
}

// MARK: - 品目の詳細（入出庫・編集・履歴）

struct NPZInvItemSheet: View {
    @ObservedObject var model: NPZInventoryModel
    let itemId: String
    let fallback: NPZInvItem
    let onClose: () -> Void
    let onOpen: (String) -> Void

    @State private var moving = false
    @State private var editing = false
    @State private var historyTab = "history"

    private var p: NPZInvPayload? { model.payloads["items"] }
    private var item: NPZInvItem { p?.items?.first(where: { $0.id == itemId }) ?? fallback }

    var body: some View {
        let it = item
        return ZStack(alignment: .bottom) {
            NPOCSheetFrame(title: it.name, cancelText: "閉じる", onCancel: onClose, onConfirm: nil) {
                summary(it)
                actions(it)
                infoCard(it)
                historyCard(it)
            }
            NPHToast(text: $model.toast)
        }
        .task { await model.loadHistory(itemId) }
        .sheet(isPresented: $moving) {
            NPZInvMovementSheet(model: model, item: it, onClose: { moving = false }, onDone: { Task { await model.loadHistory(itemId) } })
        }
        .sheet(isPresented: $editing) {
            NPZInvItemFormSheet(model: model, item: it, units: p?.units ?? [], onClose: { editing = false })
        }
    }

    private func summary(_ it: NPZInvItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                NOSBadge(text: NPZInv.kindLabel(it.itemKind), color: NT.purple)
                if let c = it.category, !c.isEmpty { NOSBadge(text: c, color: NT.ink2) }
                if let w = NPZInv.warning(it.warning) { NOSBadge(text: w.0, color: w.1) }
                if it.priceUp == true { NOSBadge(text: "値上がり", color: NT.danger) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("現在庫").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                Text(NPZ.q(it.currentQuantity)).font(.system(size: 38, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.5)
                Text(it.unit).font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text("在庫金額").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NPZ.yen(it.stockValue)).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
    }

    @ViewBuilder private func actions(_ it: NPZInvItem) -> some View {
        if p?.canWrite ?? true {
            HStack(spacing: 8) {
                NPOCWideButton(text: "入出庫", icon: "arrow.up.arrow.down", kind: .primary) { moving = true }
                NPOCWideButton(text: "編集", icon: "pencil", kind: .secondary) { editing = true }
            }
        }
        NPOCWideButton(text: "この品目で発注書を作成", icon: "doc.badge.plus", kind: .secondary) { onOpen("/app/purchases/new?item=\(it.id)") }
    }

    private func infoCard(_ it: NPZInvItem) -> some View {
        NPOCard(title: "在庫の設定") {
            NPZInfoRow(label: "発注点", value: it.reorderPoint.map { NPZ.q($0) + it.unit } ?? "—")
            NPZInfoRow(label: "最低在庫", value: it.minQuantity.map { NPZ.q($0) + it.unit } ?? "—")
            NPZInfoRow(label: "適正在庫", value: it.optimalQuantity.map { NPZ.q($0) + it.unit } ?? "—")
            NPZDivider()
            NPZInfoRow(label: "平均仕入単価", value: it.avgCost.map { NPZ.yen($0) + "/" + it.unit } ?? "—")
            NPZInfoRow(label: "最終仕入単価", value: it.lastPurchaseCost.map { NPZ.yen($0) + "/" + it.unit } ?? "—")
            if let pu = it.purchaseUnit, !pu.isEmpty {
                NPZInfoRow(label: "仕入単位", value: "1\(pu) ＝ \(NPZ.q(it.factor))\(it.unit)")
            }
        }
    }

    private func historyCard(_ it: NPZInvItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            NOSSegment(items: [(key: "history", label: "入出庫履歴"), (key: "purchases", label: "仕入価格")], selection: historyTab) { historyTab = $0 }
            if historyTab == "history" {
                historyList(it)
            } else {
                purchasesList(it)
            }
        }
    }

    @ViewBuilder private func historyList(_ it: NPZInvItem) -> some View {
        if let rows = model.histories[itemId] {
            if rows.isEmpty {
                NPOCEmpty(icon: "clock", title: "履歴はありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { r in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(NPZInv.movementLabels[r.movementType] ?? r.movementType).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                                Text(NPZ.dateTime(r.occurredAt)).font(.system(size: 11.5)).foregroundColor(NT.ink3).monospacedDigit()
                                if let reason = r.reason, !reason.isEmpty {
                                    Text(reason + (r.toStoreName.map { "（→ \($0)）" } ?? "")).font(.system(size: 12)).foregroundColor(NT.ink2)
                                } else if let to = r.toStoreName {
                                    Text("→ \(to)").font(.system(size: 12)).foregroundColor(NT.ink2)
                                }
                            }
                            Spacer(minLength: 6)
                            Text(NPZ.signed(r.quantity) + it.unit).font(.system(size: 15, weight: .heavy)).monospacedDigit()
                                .foregroundColor(r.quantity < 0 ? NT.danger : NT.ok)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        if r.id != rows.last?.id { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
        } else {
            ProgressView().tint(NT.purple).frame(maxWidth: .infinity).padding(.vertical, 24)
        }
    }

    @ViewBuilder private func purchasesList(_ it: NPZInvItem) -> some View {
        if let d = model.purchases[itemId] {
            NPZTileGrid {
                NPZTile(label: "現在の平均単価", value: NPZ.yen(d.currentAvgCost), tone: NT.purpleDeep, sub: "入荷のたび自動更新")
                NPZTile(label: "前回 → 前々回比", value: d.changeRatePct.map { ($0 > 0 ? "+" : "") + String(format: "%.1f", $0) + "%" } ?? "—",
                        tone: (d.changeRatePct ?? 0) > 0 ? NT.danger : (d.changeRatePct ?? 0) < 0 ? NT.ok : NT.ink,
                        sub: "前回 \(NPZ.yen(d.previousUnitCost))／前々回 \(NPZ.yen(d.priorUnitCost))")
            }
            if d.rows.isEmpty {
                NPOCEmpty(icon: "shippingbox", title: "入荷履歴はありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(d.rows) { r in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(NPZ.date(r.businessDate)).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).monospacedDigit()
                                Text(r.vendorName ?? "—").font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                            }
                            Spacer(minLength: 6)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(NPZ.yen(r.unitCost)).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                                Text(NPZ.q(r.quantity) + d.unit).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        if r.id != d.rows.last?.id { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
            Text("仕入先は発注書からの入荷だけ分かります。手で登録した入荷は「—」です。").font(.system(size: 11)).foregroundColor(NT.ink3)
        } else {
            ProgressView().tint(NT.purple).frame(maxWidth: .infinity).padding(.vertical, 24)
        }
    }
}

// MARK: - 入出庫（Web の MovementForm と同じ）

struct NPZInvMovementSheet: View {
    @ObservedObject var model: NPZInventoryModel
    let item: NPZInvItem
    let onClose: () -> Void
    let onDone: () -> Void

    @State private var type = "in"
    @State private var qty = ""
    @State private var cost = ""
    @State private var reason = ""
    @State private var error: String?

    private var isReceipt: Bool { type == "in" }
    private var usesPurchaseUnit: Bool { isReceipt && !(item.purchaseUnit ?? "").isEmpty && item.factor != 1 }
    private var qtyUnit: String { usesPurchaseUnit ? (item.purchaseUnit ?? item.unit) : item.unit }

    var body: some View {
        NPOCSheetFrame(title: "入出庫", confirmText: model.busy ? "登録中…" : "登録する", busy: model.busy, onCancel: onClose, onConfirm: { Task { await save() } }) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.name).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text("現在庫 \(NPZ.q(item.currentQuantity))\(item.unit)").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit()
            }
            NPOCField(label: "種別") {
                NOSSegment(items: NPZInv.manualMovements.map { (key: $0.0, label: $0.1) }, selection: type) { type = $0 }
            }
            NPZTextField(label: isReceipt && usesPurchaseUnit ? "仕入数量（\(qtyUnit)）" : "数量（\(item.unit)）", text: $qty, placeholder: "0", number: true, suffix: qtyUnit)
            if isReceipt {
                NPZTextField(label: usesPurchaseUnit ? "単価（円/\(qtyUnit)）" : "単価（円/\(item.unit)）", text: $cost, placeholder: "0", number: true, suffix: "円")
            }
            preview
            NPOCField(label: "理由" + (NPZInv.needsReason(type) ? "（必須）" : "（任意）")) {
                TextField(type == "waste" ? "例：期限切れ" : "理由", text: $reason)
                    .font(.system(size: 16))
                    .npocInputBox()
            }
            if type != "in" {
                Text("出庫・廃棄・棚卸調整は在庫から引きます（数え直して少なかった分など）。増やすときは「入庫」です。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            }
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            }
        }
        // 単価の最初の値は平均原価（Web の MovementForm と同じ）
        .onAppear { if cost.isEmpty, let c = item.avgCost { cost = NPZ.q(c) } }
    }

    @ViewBuilder private var preview: some View {
        if isReceipt, usesPurchaseUnit, let q = NPZ.num(qty), q > 0, let c = NPZ.num(cost), c >= 0 {
            VStack(alignment: .leading, spacing: 4) {
                Text("変換：\(NPZ.q(q))\(qtyUnit) → \(NPZ.q(q * item.factor))\(item.unit)／\(NPZ.yen(c))/\(qtyUnit) → \(NPZ.yen((c / item.factor).rounded()))/\(item.unit)")
                    .font(.system(size: 12)).foregroundColor(NT.ink2)
                if NPZInv.costRisk(c, item.factor) {
                    Text("変換後の在庫単価の丸め誤差が大きくなります。在庫単位の見直しをおすすめします").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.warn)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
        }
    }

    private func save() async {
        error = nil
        guard let q = NPZ.num(qty), q > 0 else { error = "数量を正しく入力してください"; return }
        let rs = NPZ.trimmed(reason)
        if NPZInv.needsReason(type) && rs.isEmpty { error = "理由を入力してください"; return }
        var unitCost: Any = NSNull()
        if isReceipt {
            guard let c = NPZ.num(cost), c >= 0 else { error = "単価を正しく入力してください"; return }
            unitCost = c
        }
        let r = await model.act(["type": "invMovement", "itemId": item.id, "movementType": type, "quantity": q, "reason": rs, "unitCost": unitCost])
        if r.ok {
            model.toast = isReceipt ? "入荷を登録しました" : "在庫を更新しました"
            onClose()
            onDone()
            await model.refresh()
        } else {
            error = r.error ?? "更新に失敗しました"
        }
    }
}

// MARK: - 品目の追加・編集（Web の ItemForm と同じ）

struct NPZInvItemFormSheet: View {
    @ObservedObject var model: NPZInventoryModel
    let item: NPZInvItem?
    let units: [String]
    let onClose: () -> Void

    @State private var name = ""
    @State private var kind = "ingredient"
    @State private var category = ""
    @State private var stockUnit = "個"
    @State private var initialQty = "0"
    @State private var reorderPoint = ""
    @State private var minQty = ""
    @State private var optimalQty = ""
    @State private var avgCost = ""
    @State private var purchaseUnit = ""
    @State private var factor = "1"
    @State private var factorTouched = false
    @State private var error: String?
    @State private var loaded = false

    private var isEdit: Bool { item != nil }

    var body: some View {
        NPOCSheetFrame(title: isEdit ? "品目を編集" : "品目を追加", confirmText: model.busy ? "保存中…" : (isEdit ? "更新する" : "追加する"), busy: model.busy,
                       onCancel: onClose, onConfirm: { Task { await save() } }) {
            NPZTextField(label: "名前", text: $name, placeholder: "例：鶏もも肉")
            NPOCField(label: "種別") {
                NOSSegment(items: [(key: "ingredient", label: "食材"), (key: "supply", label: "備品"), (key: "product", label: "商品")], selection: kind) { kind = $0 }
            }
            NPZTextField(label: "カテゴリ（任意）", text: $category, placeholder: "例：肉")
            unitField("在庫単位", text: $stockUnit) { applySuggestion(purchaseUnit, $0) }
            HStack(alignment: .top, spacing: 10) {
                if !isEdit { NPZTextField(label: "初期数量", text: $initialQty, number: true) }
                NPZTextField(label: "発注点", text: $reorderPoint, number: true)
            }
            HStack(alignment: .top, spacing: 10) {
                NPZTextField(label: "最低在庫", text: $minQty, number: true)
                NPZTextField(label: "適正在庫", text: $optimalQty, number: true)
            }
            if !isEdit { NPZTextField(label: "平均原価（円/在庫単位）", text: $avgCost, number: true, suffix: "円") }
            conversionBox
            if let it = item {
                Text("今の平均仕入単価：\(NPZ.yen(it.avgCost))（数量・単価は入出庫・入荷・移動で変わります）").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            }
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            guard let it = item else { return }
            name = it.name
            kind = it.itemKind
            category = it.category ?? ""
            stockUnit = it.unit
            reorderPoint = it.reorderPoint.map { NPZ.q($0) } ?? ""
            minQty = it.minQuantity.map { NPZ.q($0) } ?? ""
            optimalQty = it.optimalQuantity.map { NPZ.q($0) } ?? ""
            purchaseUnit = it.purchaseUnit ?? ""
            factor = NPZ.q(it.factor)
        }
    }

    private func unitField(_ label: String, text: Binding<String>, onChange: @escaping (String) -> Void) -> some View {
        let edited = Binding<String>(get: { text.wrappedValue }, set: { text.wrappedValue = $0; onChange($0) })
        return VStack(alignment: .leading, spacing: 6) {
            NPZTextField(label: label, text: edited)
            if !units.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(units, id: \.self) { u in
                            Button {
                                text.wrappedValue = u
                                onChange(u)
                            } label: {
                                Text(u).font(.system(size: 13, weight: .bold)).foregroundColor(text.wrappedValue == u ? .white : NT.ink2)
                                    .padding(.horizontal, 11).frame(height: 32)
                                    .background(Capsule().fill(text.wrappedValue == u ? NT.purple : Color.white))
                                    .overlay(Capsule().stroke(text.wrappedValue == u ? Color.clear : NT.line, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
        }
    }

    private var conversionBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("仕入単位（任意）").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink)
            Text("例：kg で仕入れて g で在庫管理 → 係数 1000。レシピは在庫単位で書きます").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            unitField("仕入単位", text: $purchaseUnit) { applySuggestion($0, stockUnit) }
            NPZTextField(label: "変換係数（1仕入単位 ＝ ◯在庫単位）", text: Binding(get: { factor }, set: { factor = $0; factorTouched = true }), number: true)
            let pu = NPZ.trimmed(purchaseUnit)
            if !pu.isEmpty && NPZInv.suggestFactor(pu, NPZ.trimmed(stockUnit)) == nil {
                Text("この単位の組み合わせは自動で提案できません。係数を入れてください").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.warn)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac.opacity(0.6)))
    }

    /// 単位を変えたら係数を提案（手で係数を触ったら変えない。Web と同じ）
    private func applySuggestion(_ p: String, _ s: String) {
        guard !factorTouched else { return }
        let pu = NPZ.trimmed(p)
        if pu.isEmpty { factor = "1"; return }
        if let f = NPZInv.suggestFactor(pu, NPZ.trimmed(s)) { factor = NPZ.q(f) }
    }

    private func save() async {
        error = nil
        let n = NPZ.trimmed(name)
        guard !n.isEmpty else { error = "名前を入力してください"; return }
        guard let f = NPZ.num(factor), f > 0 else { error = "変換係数は正の数で入力してください"; return }
        let su = NPZ.trimmed(stockUnit)
        var body: [String: Any] = [
            "type": isEdit ? "invItemUpdate" : "invItemCreate",
            "name": n, "itemKind": kind, "category": NPZ.trimmed(category),
            "unit": su.isEmpty ? "個" : su,
            "reorderPoint": NPZ.numOrNull(reorderPoint),
            "minQuantity": NPZ.numOrNull(minQty),
            "optimalQuantity": NPZ.numOrNull(optimalQty),
            "purchaseUnit": NPZ.trimmed(purchaseUnit),
            "purchaseToStockFactor": f,
        ]
        if let it = item {
            body["id"] = it.id
        } else {
            body["initialQuantity"] = NPZ.num(initialQty) ?? 0
            body["avgCost"] = NPZ.numOrNull(avgCost)
        }
        let r = await model.act(body)
        if r.ok {
            model.toast = isEdit ? "品目を更新しました" : "品目を追加しました"
            onClose()
            await model.refresh()
        } else {
            error = r.error ?? "保存に失敗しました"
        }
    }
}
