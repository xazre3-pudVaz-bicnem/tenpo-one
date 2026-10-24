import SwiftUI

// 在庫（ネイティブ）。Web の /app/inventory と同じ（2026-10-24）
//   タブ：品目・メニュー売切（在庫設定の画面）・棚卸・移動・発注提案・予測
//   操作（品目の追加・編集、入出庫、即時移動、棚卸、移動の申請・発送・受取・取消）は Web と同じ Server Action を呼ぶ

// MARK: - データ

struct NIItem: Codable, Identifiable, Hashable {
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
    let purchaseToStockFactor: Double
    let warning: String?
    let priceUp: Bool
    let stockValue: Double
}
struct NIStats: Codable { let totalStockValue: Double; let reorderCount: Int; let dangerCount: Int; let priceUpCount: Int }
struct NICount: Codable, Identifiable, Hashable { let id: String; let countDate: String; let status: String }
struct NITransferLine: Codable, Identifiable, Hashable { let id: String; let name: String; let quantity: Double; let unit: String }
struct NITransfer: Codable, Identifiable, Hashable {
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
    let items: [NITransferLine]
}
struct NIOption: Codable, Identifiable, Hashable { let id: String; let name: String; let unit: String; let currentQuantity: Double }
struct NIReorder: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let currentQuantity: Double
    let avgDailySales: Double
    let incomingQuantity: Double
    let needed: Bool
    let suggestedQuantity: Double
    let basis: String
}
struct NIForecastResult: Codable { let tomorrow: Double; let thisWeekRemaining: Double; let nextWeek: Double; let lowConfidence: Bool }
struct NIWeekday: Codable, Hashable { let weekday: String; let avg: Double }
struct NITop: Codable, Identifiable, Hashable { let id: String; let name: String; let unit: String; let tomorrow: Double }
struct NIForecast: Codable {
    let itemOptions: [NFNamed]
    let result: NIForecastResult?
    let weekdayChart: [NIWeekday]
    let unit: String
    let selectedName: String
    let top: [NITop]
}
struct NIPayload: Codable {
    let store: NFNamed
    let tab: String
    let canWrite: Bool
    let canTransfer: Bool
    let otherStores: [NFNamed]
    let units: [String]
    let items: [NIItem]?
    let stats: NIStats?
    let reorderList: [String]?
    let counts: [NICount]?
    let transfers: [NITransfer]?
    let transferItems: [NIOption]?
    let reorder: [NIReorder]?
    let forecast: NIForecast?
}
struct NICountItem: Codable, Identifiable, Hashable { let id: String; let name: String; let unit: String; let expectedQuantity: Double; let countedQuantity: Double? }
struct NICountDetail: Codable { let id: String; let countDate: String; let status: String; let storeName: String; let canWrite: Bool; let items: [NICountItem] }
struct NIHistRow: Codable, Identifiable, Hashable { let id: String; let movementType: String; let quantity: Double; let reason: String?; let occurredAt: String; let toStoreName: String? }
struct NIHistory: Codable { let rows: [NIHistRow] }
struct NIPurchaseRow: Codable, Identifiable, Hashable { let id: String; let businessDate: String; let vendorName: String?; let unitCost: Double?; let quantity: Double }
struct NIPurchases: Codable {
    let unit: String
    let currentAvgCost: Double?
    let previousUnitCost: Double?
    let priorUnitCost: Double?
    let changeRatePct: Double?
    let isSignificantIncrease: Bool
    let rows: [NIPurchaseRow]
}
struct NIActResult: Decodable { let ok: Bool; let error: String?; let id: String? }

// MARK: - 表示の決まり（Web の labels.ts と同じ）

enum NI {
    static let kinds: [(String, String)] = [("ingredient", "食材"), ("supply", "備品・消耗品"), ("product", "商品（販売連動）")]
    static func kindLabel(_ k: String) -> String { kinds.first { $0.0 == k }?.1 ?? k }
    static let movementLabels: [String: String] = [
        "in": "入庫", "out": "出庫", "waste": "廃棄", "return": "返品", "transfer_in": "移動入庫",
        "transfer_out": "移動出庫", "count_adjust": "棚卸調整", "sale": "販売",
    ]
    static let manualMovements = ["in", "out", "waste", "count_adjust"]
    static func needsReason(_ t: String) -> Bool { t == "out" || t == "waste" || t == "count_adjust" }
    static let countStatus: [String: (String, Color)] = ["draft": ("入力中", NFColor.saffron), "completed": ("確定済み", NFColor.success)]
    static let transferStatus: [String: (String, Color)] = [
        "requested": ("申請中", NFColor.saffron), "shipped": ("発送済み", NFColor.iris),
        "received": ("受取済み", NFColor.success), "cancelled": ("取消", NFColor.ink3),
    ]
    static let warningLabel: [String: (String, Color)] = ["danger": ("在庫切れ間近", NFColor.danger), "warning": ("要発注", NFColor.saffron)]

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

    /// 数量（整数なら小数なし。Web の数字の出し方と同じく余分な0は出さない）
    static func q(_ v: Double) -> String {
        if v == v.rounded() && abs(v) < 1e15 { return String(Int(v)) }
        var s = String(format: "%.4f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }
    static func q(_ v: Double?) -> String { v.map { q($0) } ?? "—" }
    static func yen(_ v: Double?) -> String { v.map { NT.yen(Int($0.rounded())) } ?? "—" }
    /// 2026-10-24 → 2026/10/24（Web の formatDate）
    static func date(_ s: String) -> String {
        let p = s.prefix(10).split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return s }
        return "\(y)/\(m)/\(d)"
    }
    /// ISO → 2026/10/24 12:05（Web の formatDateTime。日本時間）
    static func dateTime(_ iso: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        let o = DateFormatter(); o.locale = Locale(identifier: "ja_JP"); o.timeZone = TimeZone(identifier: "Asia/Tokyo"); o.dateFormat = "yyyy/M/d HH:mm"
        return o.string(from: d)
    }
    /// 入力の数字（全角・カンマも受ける）
    static func num(_ s: String) -> Double? {
        let t = s.applyingTransform(.fullwidthToHalfwidth, reverse: false)?.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces) ?? s
        return t.isEmpty ? nil : Double(t)
    }
}

// MARK: - モデル

@MainActor
final class NativeInventoryModel: ObservableObject {
    @Published var tab = "items"
    @Published var kind = ""
    @Published var q = ""
    @Published var sort = ""
    @Published var forecastItem = ""
    @Published var payload: NIPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いている棚卸（/app/inventory/counts/<id>）
    @Published var countId: String?

    func refresh() async {
        var items = [URLQueryItem(name: "part", value: "inventory"), URLQueryItem(name: "tab", value: tab)]
        if tab == "items" {
            items += [URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "q", value: q), URLQueryItem(name: "sort", value: sort)]
        }
        if tab == "forecast", !forecastItem.isEmpty { items.append(URLQueryItem(name: "item", value: forecastItem)) }
        // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = items
        if payload?.tab != tab, let saved = NativeAPI.cached(NIPayload.self, comps.url), saved.tab == tab { payload = saved }
        do {
            let p: NIPayload = try await get(items)
            if p.tab == tab { payload = p }
            error = nil
        } catch {
            let e = error as? NativeAPIError
            self.error = e?.message ?? "通信できませんでした"
            if e?.useWeb == true { useWeb = true }
        }
    }

    func get<T: Decodable>(_ items: [URLQueryItem]) async throws -> T {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = items
        let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// 操作。失敗したら error（ダイアログの中で出すときは返り値の error を使う）
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

// MARK: - 画面

struct NativeInventoryView: View {
    @ObservedObject var model: NativeInventoryModel
    let onHome: () -> Void
    let onWeb: (String) -> Void
    let onStock: () -> Void

    @State private var itemForm: NIItemFormTarget?
    @State private var movementItem: NIItem?
    @State private var transferItem: NIItem?
    @State private var historyItem: NIItem?
    @State private var purchaseItem: NIItem?
    @State private var requestOpen = false
    @State private var cancelTarget: NITransfer?
    @State private var startingCount = false

    private let tabs: [(String, String, String)] = [
        ("items", "品目", "Items"), ("menu", "メニュー売切", "Sold out"), ("counts", "棚卸", "Stocktake"),
        ("transfers", "移動", "Transfer"), ("reorder", "発注提案", "Reorder"), ("forecast", "予測", "Forecast"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "在庫", subtitle: "Inventory", onHome: onHome)
            if let p = model.payload {
                VStack(alignment: .leading, spacing: 12) {
                    header(p)
                    ScrollView {
                        content(p).padding(.bottom, 24)
                    }
                }
                .padding(16)
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 12) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        HStack(spacing: 10) {
                            Button("もう一度") { Task { await model.refresh() } }
                            if model.useWeb { Button("Web で開く") { onWeb("/app/inventory") } }
                        }
                    }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task(id: model.tab) { await model.refresh() }
        .overlay { dialogs }
        .overlay {
            if let id = model.countId {
                NICountView(model: model, countId: id, onClose: { model.countId = nil; Task { await model.refresh() } })
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.countId)
    }

    // MARK: 上（タブと右のボタン）

    private func header(_ p: NIPayload) -> some View {
        HStack(spacing: 6) {
            ForEach(tabs, id: \.0) { t in
                let on = model.tab == t.0
                Button {
                    if t.0 == "menu" { onStock(); return }
                    model.tab = t.0
                } label: {
                    VStack(spacing: 1) {
                        Text(t.1).font(.system(size: 15, weight: .bold))
                        Text(t.2).font(.system(size: 9.5, weight: .semibold)).opacity(0.7)
                    }
                    .foregroundColor(on ? .white : NFColor.ink2)
                    .padding(.horizontal, 16).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NFColor.iris : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
            Spacer(minLength: 8)
            if model.tab == "items" && p.canWrite {
                primaryButton("plus", "品目を追加") { itemForm = NIItemFormTarget(item: nil) }
            } else if model.tab == "counts" && p.canWrite {
                primaryButton("checklist", startingCount ? "準備中…" : "棚卸を開始") { Task { await startCount() } }
                    .disabled(startingCount)
            } else if model.tab == "transfers" && p.canTransfer && !p.otherStores.isEmpty {
                primaryButton("plus", "移動を申請") { requestOpen = true }
            }
        }
    }

    private func primaryButton(_ icon: String, _ text: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: icon); Text(text) }
                .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 18).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
        }
        .buttonStyle(PressableStyle())
    }

    private func startCount() async {
        startingCount = true
        defer { startingCount = false }
        let r = await model.act(["type": "invCountStart"])
        if r.ok, let id = r.id { model.countId = id } else { model.error = r.error ?? "棚卸の開始に失敗しました" }
    }

    @ViewBuilder
    private func content(_ p: NIPayload) -> some View {
        if p.tab != model.tab {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
        } else {
            tabContent(p)
        }
    }

    private func tabContent(_ p: NIPayload) -> AnyView {
        switch model.tab {
        case "items": AnyView(NIItemsTab(model: model, p: p, onEdit: { itemForm = NIItemFormTarget(item: $0) }, onMove: { movementItem = $0 },
                                         onTransfer: { transferItem = $0 }, onHistory: { historyItem = $0 }, onPurchases: { purchaseItem = $0 }, onWeb: onWeb))
        case "counts": AnyView(NICountsTab(counts: p.counts ?? [], onOpen: { model.countId = $0 }))
        case "transfers": AnyView(NITransfersTab(model: model, p: p, onCancel: { cancelTarget = $0 }))
        case "reorder": AnyView(NIReorderTab(rows: p.reorder ?? [], onWeb: onWeb))
        default: AnyView(NIForecastTab(model: model, f: p.forecast))
        }
    }

    // MARK: ダイアログ

    @ViewBuilder private var dialogs: some View {
        if let t = itemForm, let p = model.payload {
            NativeModalCard(width: 720) {
                NIItemForm(model: model, item: t.item, units: p.units, onClose: { itemForm = nil })
            }
        } else if let it = movementItem {
            NativeModalCard(width: 600) { NIMovementForm(model: model, item: it, onClose: { movementItem = nil }) }
        } else if let it = transferItem, let p = model.payload {
            NativeModalCard(width: 600) { NIDirectTransferForm(model: model, item: it, stores: p.otherStores, onClose: { transferItem = nil }) }
        } else if let it = historyItem {
            NativeModalCard(width: 820) { NIHistoryView(model: model, item: it, onClose: { historyItem = nil }) }
        } else if let it = purchaseItem {
            NativeModalCard(width: 820) { NIPurchasesView(model: model, item: it, onClose: { purchaseItem = nil }) }
        } else if requestOpen, let p = model.payload {
            NativeModalCard(width: 820) { NIRequestTransferForm(model: model, stores: p.otherStores, items: p.transferItems ?? [], onClose: { requestOpen = false }) }
        } else if let t = cancelTarget {
            NativeModalCard(width: 560) { NICancelTransfer(model: model, row: t, onClose: { cancelTarget = nil }) }
        }
    }
}

struct NIItemFormTarget: Identifiable { let id = UUID(); let item: NIItem? }

// MARK: - 部品

func niCard<C: View>(@ViewBuilder _ c: () -> C) -> some View {
    c().background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
}

func niStat(_ label: String, _ value: String, tone: Color = NFColor.navy, sub: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
        Text(value).font(.system(size: 24, weight: .heavy)).monospacedDigit().foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.6)
        if let sub { Text(sub).font(.system(size: 11)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true) }
    }
    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
}

func niEmpty(_ title: String, _ desc: String) -> some View {
    VStack(spacing: 6) {
        Text(title).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2)
        Text(desc).font(.system(size: 13)).foregroundColor(NFColor.ink3).multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity).padding(.vertical, 48)
    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
}

func niSmallButton(_ text: String, icon: String? = nil, tone: Color = NFColor.ink2, fill: Color = Color.white, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 12, weight: .bold)) }
            Text(text)
        }
        .font(.system(size: 13, weight: .bold)).foregroundColor(tone)
        .padding(.horizontal, 10).frame(height: 36)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(fill))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(fill == Color.white ? NFColor.line : Color.clear, lineWidth: 1))
    }
    .buttonStyle(PressableStyle())
}

/// ダイアログの頭（題名・×）
struct NIDialogHead: View {
    let title: String
    let onClose: () -> Void
    var body: some View {
        HStack {
            Text(title).font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy).lineLimit(2)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 26)).foregroundColor(NFColor.ink3)
            }.buttonStyle(.plain)
        }
    }
}

/// ダイアログの下（キャンセル・決定）とエラー
struct NIDialogFoot: View {
    let error: String?
    let busy: Bool
    let okText: String
    let busyText: String
    var danger = false
    let onCancel: () -> Void
    let onOk: () -> Void
    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            if let e = error { Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger).frame(maxWidth: .infinity, alignment: .leading) }
            HStack(spacing: 10) {
                Button(action: onCancel) {
                    Text("キャンセル").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2)
                        .frame(maxWidth: .infinity).frame(height: 54)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                }.buttonStyle(PressableStyle()).disabled(busy)
                Button(action: onOk) {
                    Text(busy ? busyText : okText).font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 54)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(danger ? NFColor.danger : NFColor.iris))
                }.buttonStyle(PressableStyle()).disabled(busy)
            }
        }
    }
}

/// ラベルつきの入力
struct NIField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var number = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
            TextField(placeholder, text: $text)
                .keyboardType(number ? .decimalPad : .default)
                .font(.system(size: 17, weight: .semibold)).foregroundColor(NFColor.ink)
                .padding(.horizontal, 12).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
    }
}

/// 選ぶボタンの並び
struct NIChoice: View {
    let options: [(String, String)]
    @Binding var value: String
    var body: some View {
        NCFlow(spacing: 8) {
            ForEach(options, id: \.0) { o in
                let on = value == o.0
                Button { value = o.0 } label: {
                    Text(o.1).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NFColor.iris : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
                }.buttonStyle(PressableStyle())
            }
        }
    }
}

// MARK: - 品目タブ

struct NIItemsTab: View {
    @ObservedObject var model: NativeInventoryModel
    let p: NIPayload
    let onEdit: (NIItem) -> Void
    let onMove: (NIItem) -> Void
    let onTransfer: (NIItem) -> Void
    let onHistory: (NIItem) -> Void
    let onPurchases: (NIItem) -> Void
    let onWeb: (String) -> Void

    var body: some View {
        let items = p.items ?? []
        VStack(alignment: .leading, spacing: 14) {
            if let s = p.stats {
                HStack(spacing: 10) {
                    niStat("総在庫金額", NI.yen(s.totalStockValue), tone: NFColor.iris)
                    niStat("要発注品目数", "\(s.reorderCount)件", tone: s.reorderCount > 0 ? NFColor.saffron : NFColor.navy)
                    niStat("在庫切れ間近品目数", "\(s.dangerCount)件", tone: s.dangerCount > 0 ? NFColor.danger : NFColor.navy)
                    niStat("値上がり品目数", "\(s.priceUpCount)件", tone: s.priceUpCount > 0 ? NFColor.danger : NFColor.navy, sub: "前回仕入が前々回比10%以上値上がり")
                }
            }
            reorderBox(items)
            filters
            if items.isEmpty {
                niEmpty("品目が登録されていません", "「品目を追加」から在庫品目を登録してください")
            } else {
                table(items)
            }
        }
    }

    @ViewBuilder private func reorderBox(_ items: [NIItem]) -> some View {
        let ids = p.reorderList ?? []
        let list = ids.compactMap { id in items.first { $0.id == id } }
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("要発注リスト（発注点以下の品目 \(p.stats?.reorderCount ?? list.count)件中 \(list.count)件を表示）")
                    .font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.saffron)
                ForEach(list) { r in
                    HStack {
                        Text("\(r.name)（現在庫 \(NI.q(r.currentQuantity))\(r.unit)／発注点 \(NI.q(r.reorderPoint))\(r.unit)）")
                            .font(.system(size: 14)).foregroundColor(NFColor.navy).lineLimit(1)
                        Spacer()
                        Button { onWeb("/app/purchases/new?item=\(r.id)") } label: {
                            Text("発注書を作成").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.iris)
                        }.buttonStyle(.plain)
                    }
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.saffronSoft))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.saffron.opacity(0.3), lineWidth: 1))
        }
    }

    private var filters: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text("種別").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                NIChoice(options: [("", "すべて")] + NI.kinds, value: $model.kind).fixedSize()
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("検索").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                TextField("品目名で検索", text: $model.q)
                    .font(.system(size: 15)).padding(.horizontal, 12).frame(width: 200, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    .submitLabel(.search)
                    .onSubmit { Task { await model.refresh() } }
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("並び順").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                NIChoice(options: [("", "名前順"), ("warning", "警告品目を上位に")], value: $model.sort).fixedSize()
            }
            niSmallButton("絞り込む", icon: "line.3.horizontal.decrease", tone: .white, fill: NFColor.navy) { Task { await model.refresh() } }
                .frame(height: 40)
            Spacer(minLength: 0)
        }
    }

    // 列（Web の表と同じ並び）
    private let cols: [(String, CGFloat, Bool)] = [
        ("種別", 92, false), ("現在庫", 66, true), ("単位", 44, false), ("仕入単位", 60, false), ("発注点", 56, true),
        ("最低在庫", 62, true), ("適正在庫", 62, true), ("平均仕入単価", 84, true), ("最終仕入単価", 84, true), ("在庫金額", 84, true), ("警告", 110, false),
    ]

    private func table(_ items: [NIItem]) -> some View {
        niCard {
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Text("品目").frame(width: 170, alignment: .leading)
                        ForEach(cols, id: \.0) { c in Text(c.0).frame(width: c.1, alignment: c.2 ? .trailing : .leading) }
                        Spacer(minLength: 0).frame(width: actionsWidth)
                    }
                    .font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(NFColor.lilacSoft)
                    ForEach(items) { r in
                        row(r)
                        Rectangle().fill(NFColor.line).frame(height: 1)
                    }
                }
            }
        }
    }

    private var showTransfer: Bool { p.canTransfer && !p.otherStores.isEmpty }
    private var actionsWidth: CGFloat { (p.canWrite ? 44 + 72 : 0) + (showTransfer ? 92 : 0) + 84 }

    private func row(_ r: NIItem) -> some View {
        HStack(spacing: 8) {
            Button { onHistory(r) } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.navy).lineLimit(2).multilineTextAlignment(.leading)
                    if let c = r.category, !c.isEmpty { Text("（\(c)）").font(.system(size: 11)).foregroundColor(NFColor.ink3) }
                }
                .frame(width: 170, alignment: .leading)
            }.buttonStyle(.plain)
            cell(NI.kindLabel(r.itemKind), 0)
            cell(NI.q(r.currentQuantity), 1, bold: true)
            cell(r.unit, 2)
            cell(r.purchaseUnit ?? "—", 3)
            cell(NI.q(r.reorderPoint), 4)
            cell(NI.q(r.minQuantity), 5)
            cell(NI.q(r.optimalQuantity), 6)
            cell(NI.yen(r.avgCost), 7)
            cell(NI.yen(r.lastPurchaseCost), 8)
            cell(NI.yen(r.stockValue), 9)
            HStack(spacing: 4) {
                if let w = r.warning, let l = NI.warningLabel[w] { NPBadge(text: l.0, color: l.1) }
                if r.priceUp {
                    Button { onPurchases(r) } label: { NPBadge(text: "値上がり", color: NFColor.danger) }.buttonStyle(.plain)
                }
            }
            .frame(width: cols[10].1, alignment: .leading)
            HStack(spacing: 6) {
                if p.canWrite {
                    niSmallButton("", icon: "pencil") { onEdit(r) }.frame(width: 38)
                    niSmallButton("入出庫") { onMove(r) }
                }
                if showTransfer { niSmallButton("即時移動", icon: "arrow.left.arrow.right") { onTransfer(r) } }
                niSmallButton("仕入履歴") { onPurchases(r) }
            }
            .frame(width: actionsWidth, alignment: .trailing)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
    }

    private func cell(_ text: String, _ i: Int, bold: Bool = false) -> some View {
        Text(text).font(.system(size: 13.5, weight: bold ? .bold : .regular)).monospacedDigit().foregroundColor(NFColor.ink)
            .lineLimit(1).minimumScaleFactor(0.7)
            .frame(width: cols[i].1, alignment: cols[i].2 ? .trailing : .leading)
    }
}

// MARK: - 品目の追加・編集（Web の ItemForm と同じ）

struct NIItemForm: View {
    @ObservedObject var model: NativeInventoryModel
    let item: NIItem?
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
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: isEdit ? "品目を編集：\(item!.name)" : "品目を追加", onClose: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    NIField(label: "名前", text: $name)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("種別").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                        NIChoice(options: NI.kinds, value: $kind)
                    }
                    HStack(alignment: .top, spacing: 12) {
                        NIField(label: "カテゴリ", text: $category)
                        unitField("在庫単位", text: $stockUnit) { applySuggestion(purchaseUnit, $0) }
                    }
                    HStack(alignment: .top, spacing: 12) {
                        if !isEdit { NIField(label: "初期数量", text: $initialQty, number: true) }
                        NIField(label: "発注点", text: $reorderPoint, number: true)
                        NIField(label: "最低在庫", text: $minQty, number: true)
                        NIField(label: "適正在庫", text: $optimalQty, number: true)
                    }
                    if !isEdit { NIField(label: "平均原価（円）", text: $avgCost, number: true).frame(maxWidth: 220) }
                    conversionBox
                    if let it = item {
                        Text("現在の平均仕入単価: \(NI.yen(it.avgCost))（数量・単価は入出庫・入荷・移動から更新されます）")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                }
            }
            NIDialogFoot(error: error, busy: model.busy, okText: isEdit ? "更新する" : "追加する", busyText: "保存中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let it = item {
                name = it.name; kind = it.itemKind; category = it.category ?? ""; stockUnit = it.unit
                reorderPoint = it.reorderPoint.map { NI.q($0) } ?? ""
                minQty = it.minQuantity.map { NI.q($0) } ?? ""
                optimalQty = it.optimalQuantity.map { NI.q($0) } ?? ""
                purchaseUnit = it.purchaseUnit ?? ""; factor = NI.q(it.purchaseToStockFactor)
            }
        }
    }

    private func unitField(_ label: String, text: Binding<String>, onChange: @escaping (String) -> Void) -> some View {
        let edited = Binding<String>(get: { text.wrappedValue }, set: { text.wrappedValue = $0; onChange($0) })
        return VStack(alignment: .leading, spacing: 6) {
            NIField(label: label, text: edited)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    ForEach(units, id: \.self) { u in
                        Button { text.wrappedValue = u; onChange(u) } label: {
                            Text(u).font(.system(size: 12.5, weight: .bold)).foregroundColor(text.wrappedValue == u ? .white : NFColor.ink2)
                                .padding(.horizontal, 9).frame(height: 30)
                                .background(Capsule().fill(text.wrappedValue == u ? NFColor.iris : NFColor.lilac))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var conversionBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("例: kgで仕入れgで在庫管理→係数1000。レシピはすべて在庫単位で記述します").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            HStack(alignment: .top, spacing: 12) {
                unitField("仕入単位（任意）", text: $purchaseUnit) { applySuggestion($0, stockUnit) }
                VStack(alignment: .leading, spacing: 5) {
                    Text("変換係数（仕入単位→在庫単位）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                    TextField("", text: Binding(get: { factor }, set: { factor = $0; factorTouched = true }))
                        .keyboardType(.decimalPad)
                        .font(.system(size: 17, weight: .semibold))
                        .padding(.horizontal, 12).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                }
            }
            let pu = purchaseUnit.trimmingCharacters(in: .whitespaces)
            if !pu.isEmpty && NI.suggestFactor(pu, stockUnit.trimmingCharacters(in: .whitespaces)) == nil {
                Text("この単位の組み合わせは自動提案できません。係数を手入力してください").font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.saffron)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    /// 単位を変えたら係数を提案（手で係数を触ったら変えない。Web と同じ）
    private func applySuggestion(_ p: String, _ s: String) {
        guard !factorTouched else { return }
        let pu = p.trimmingCharacters(in: .whitespaces)
        if pu.isEmpty { factor = "1"; return }
        if let f = NI.suggestFactor(pu, s.trimmingCharacters(in: .whitespaces)) { factor = NI.q(f) }
    }

    private func save() async {
        error = nil
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { error = "名前を入力してください"; return }
        guard let f = NI.num(factor), f > 0 else { error = "変換係数は正の数で入力してください"; return }
        var body: [String: Any] = [
            "type": isEdit ? "invItemUpdate" : "invItemCreate",
            "name": n, "itemKind": kind, "category": category.trimmingCharacters(in: .whitespaces),
            "unit": stockUnit.trimmingCharacters(in: .whitespaces).isEmpty ? "個" : stockUnit.trimmingCharacters(in: .whitespaces),
            "reorderPoint": NI.num(reorderPoint).map { $0 as Any } ?? NSNull(),
            "minQuantity": NI.num(minQty).map { $0 as Any } ?? NSNull(),
            "optimalQuantity": NI.num(optimalQty).map { $0 as Any } ?? NSNull(),
            "purchaseUnit": purchaseUnit.trimmingCharacters(in: .whitespaces),
            "purchaseToStockFactor": f,
        ]
        if let it = item { body["id"] = it.id } else {
            body["initialQuantity"] = NI.num(initialQty) ?? 0
            body["avgCost"] = NI.num(avgCost).map { $0 as Any } ?? NSNull()
        }
        let r = await model.act(body)
        if r.ok {
            model.toast = isEdit ? "品目を更新しました" : "品目を追加しました"
            onClose()
            await model.refresh()
        } else { error = r.error ?? "保存に失敗しました" }
    }
}

// MARK: - 入出庫（Web の MovementForm と同じ）

struct NIMovementForm: View {
    @ObservedObject var model: NativeInventoryModel
    let item: NIItem
    let onClose: () -> Void

    @State private var type = "in"
    @State private var qty = ""
    @State private var cost = ""
    @State private var reason = ""
    @State private var error: String?

    private var isReceipt: Bool { type == "in" }
    private var factor: Double { item.purchaseToStockFactor > 0 ? item.purchaseToStockFactor : 1 }
    private var usesPurchaseUnit: Bool { isReceipt && (item.purchaseUnit ?? "") != "" && factor != 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "入出庫：\(item.name)", onClose: onClose)
            VStack(alignment: .leading, spacing: 5) {
                Text("種別").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                NIChoice(options: NI.manualMovements.map { ($0, NI.movementLabels[$0] ?? $0) }, value: $type)
            }
            HStack(alignment: .top, spacing: 12) {
                NIField(label: isReceipt ? (usesPurchaseUnit ? "仕入数量（\(item.purchaseUnit!)）" : "数量（\(item.unit)）") : "数量（\(item.unit)）", text: $qty, number: true)
                if isReceipt { NIField(label: usesPurchaseUnit ? "単価（円/\(item.purchaseUnit!)）" : "単価（円）", text: $cost, number: true) }
            }
            preview
            NIField(label: "理由" + (NI.needsReason(type) ? "（必須）" : "（任意）"), text: $reason)
            NIDialogFoot(error: error, busy: model.busy, okText: "登録する", busyText: "更新中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear { if cost.isEmpty, let c = item.avgCost { cost = NI.q(c) } }
    }

    @ViewBuilder private var preview: some View {
        if isReceipt, let q = NI.num(qty), q > 0, let c = NI.num(cost), c >= 0 {
            let pu = usesPurchaseUnit ? item.purchaseUnit! : item.unit
            VStack(alignment: .leading, spacing: 4) {
                Text("変換プレビュー: \(NI.q(q))\(pu) → \(NI.q(q * factor))\(item.unit) ／ \(NI.yen(c))/\(pu) → \(NI.yen((c / factor).rounded()))/\(item.unit)")
                    .font(.system(size: 12)).foregroundColor(NFColor.ink2)
                if NI.costRisk(c, factor) {
                    Text("変換後の在庫単価の丸め誤差が大きくなります。在庫単位の見直しを推奨します").font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.saffron)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NFColor.lilacSoft))
        }
    }

    private func save() async {
        error = nil
        guard let q = NI.num(qty), q > 0 else { error = "数量を正しく入力してください"; return }
        let rs = reason.trimmingCharacters(in: .whitespaces)
        if NI.needsReason(type) && rs.isEmpty { error = "理由を入力してください"; return }
        var unitCost: Any = NSNull()
        if isReceipt {
            guard let c = NI.num(cost), c >= 0 else { error = "単価を正しく入力してください"; return }
            unitCost = c
        }
        let r = await model.act(["type": "invMovement", "itemId": item.id, "movementType": type, "quantity": q, "reason": rs, "unitCost": unitCost])
        if r.ok {
            model.toast = isReceipt ? "入荷を登録しました" : "在庫を更新しました"
            onClose()
            await model.refresh()
        } else { error = r.error ?? "更新に失敗しました" }
    }
}

// MARK: - 即時移動（Web の TransferForm と同じ）

struct NIDirectTransferForm: View {
    @ObservedObject var model: NativeInventoryModel
    let item: NIItem
    let stores: [NFNamed]
    let onClose: () -> Void

    @State private var toStore = ""
    @State private var qty = ""
    @State private var reason = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "即時移動（発送・受取を同時に記録）：\(item.name)", onClose: onClose)
            Text("発送と受取を同時に記録します。承認や追跡が必要な移動は「移動」タブの「移動を申請」をご利用ください")
                .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft))
            VStack(alignment: .leading, spacing: 5) {
                Text("移動先店舗").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                NIChoice(options: stores.map { ($0.id, $0.name) }, value: $toStore)
            }
            NIField(label: "数量（\(item.unit)／現在庫 \(NI.q(item.currentQuantity))\(item.unit)）", text: $qty, number: true)
            NIField(label: "理由（任意）", text: $reason)
            NIDialogFoot(error: error, busy: model.busy, okText: "移動する", busyText: "登録中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
    }

    private func save() async {
        error = nil
        guard !toStore.isEmpty else { error = "移動先店舗を選択してください"; return }
        guard let q = NI.num(qty), q > 0 else { error = "数量を正しく入力してください"; return }
        guard q <= item.currentQuantity else { error = "現在庫を超える数量は移動できません"; return }
        let r = await model.act(["type": "invTransferDirect", "fromItemId": item.id, "toStoreId": toStore, "quantity": q, "reason": reason.trimmingCharacters(in: .whitespaces)])
        if r.ok {
            model.toast = "店舗間移動を登録しました"
            onClose()
            await model.refresh()
        } else { error = r.error ?? "移動の登録に失敗しました" }
    }
}

// MARK: - 入出庫履歴・仕入価格履歴

struct NIHistoryView: View {
    @ObservedObject var model: NativeInventoryModel
    let item: NIItem
    let onClose: () -> Void
    @State private var rows: [NIHistRow]?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "入出庫履歴：\(item.name)", onClose: onClose)
            if let rows {
                if rows.isEmpty {
                    Text("履歴はありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 30)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            HStack { Text("日時").frame(width: 150, alignment: .leading); Text("種別").frame(width: 90, alignment: .leading); Text("数量").frame(width: 100, alignment: .trailing); Text("理由").frame(maxWidth: .infinity, alignment: .leading) }
                                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(height: 32)
                            ForEach(rows) { r in
                                HStack {
                                    Text(NI.dateTime(r.occurredAt)).frame(width: 150, alignment: .leading)
                                    Text(NI.movementLabels[r.movementType] ?? r.movementType).frame(width: 90, alignment: .leading)
                                    Text((r.quantity > 0 ? "+" : "") + NI.q(r.quantity) + item.unit).monospacedDigit()
                                        .foregroundColor(r.quantity < 0 ? NFColor.danger : NFColor.success).frame(width: 100, alignment: .trailing)
                                    (Text(r.reason ?? "—") + Text(r.toStoreName.map { "（→ \($0)）" } ?? "").foregroundColor(NFColor.ink3))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .font(.system(size: 13.5)).padding(.vertical, 8)
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                        }
                    }
                    .frame(maxHeight: 520)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
            }
        }
        .padding(22)
        .task {
            do {
                let h: NIHistory = try await model.get([URLQueryItem(name: "part", value: "inventoryHistory"), URLQueryItem(name: "id", value: item.id)])
                rows = h.rows
            } catch { rows = []; model.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
}

struct NIPurchasesView: View {
    @ObservedObject var model: NativeInventoryModel
    let item: NIItem
    let onClose: () -> Void
    @State private var data: NIPurchases?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "仕入価格履歴：\(item.name)", onClose: onClose)
            if let d = data {
                HStack(spacing: 10) {
                    niStat("現在平均単価", NI.yen(d.currentAvgCost), tone: NFColor.iris, sub: "加重平均（入荷のたび自動更新）")
                    niStat("前回仕入単価", NI.yen(d.previousUnitCost))
                    niStat("前々回仕入単価", NI.yen(d.priorUnitCost))
                }
                if let c = d.changeRatePct {
                    HStack(spacing: 8) {
                        Text("前回比（前々回→前回）:").foregroundColor(NFColor.ink3)
                        Text((c > 0 ? "+" : "") + String(format: "%.1f", c) + "%").bold().monospacedDigit()
                            .foregroundColor(c > 0 ? NFColor.danger : (c < 0 ? NFColor.success : NFColor.navy))
                        if d.isSignificantIncrease { NPBadge(text: "前回比+\(String(format: "%.0f", c))%値上がり", color: NFColor.danger) }
                    }
                    .font(.system(size: 14))
                }
                if d.rows.isEmpty {
                    Text("入荷履歴はありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 24)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            HStack { Text("日付").frame(width: 110, alignment: .leading); Text("仕入先").frame(maxWidth: .infinity, alignment: .leading); Text("単価").frame(width: 100, alignment: .trailing); Text("数量").frame(width: 110, alignment: .trailing) }
                                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(height: 32)
                            ForEach(d.rows) { r in
                                HStack {
                                    Text(NI.date(r.businessDate)).frame(width: 110, alignment: .leading)
                                    Text(r.vendorName ?? "—").frame(maxWidth: .infinity, alignment: .leading)
                                    Text(NI.yen(r.unitCost)).monospacedDigit().frame(width: 100, alignment: .trailing)
                                    Text(NI.q(r.quantity) + d.unit).monospacedDigit().frame(width: 110, alignment: .trailing)
                                }
                                .font(.system(size: 13.5)).padding(.vertical, 8)
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                        }
                    }
                    .frame(maxHeight: 380)
                }
                Text("仕入先は発注書（purchase_orders）経由の入荷のみ判明します。手動登録した入荷は「—」表示です。").font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
            }
        }
        .padding(22)
        .task {
            do {
                data = try await model.get([URLQueryItem(name: "part", value: "inventoryPurchases"), URLQueryItem(name: "id", value: item.id)])
            } catch { onClose(); model.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
}

// MARK: - 棚卸タブ・棚卸の入力（Web の /app/inventory/counts/[id] と同じ）

struct NICountsTab: View {
    let counts: [NICount]
    let onOpen: (String) -> Void
    var body: some View {
        if counts.isEmpty {
            niEmpty("棚卸の記録がありません", "「棚卸を開始」から新しい棚卸を開始してください")
        } else {
            niCard {
                VStack(spacing: 0) {
                    HStack { Text("実施日").frame(width: 160, alignment: .leading); Text("状態"); Spacer() }
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 16).frame(height: 38).background(NFColor.lilacSoft)
                    ForEach(counts) { c in
                        Button { onOpen(c.id) } label: {
                            HStack {
                                Text(NI.date(c.countDate)).font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.navy).frame(width: 160, alignment: .leading)
                                if let s = NI.countStatus[c.status] { NPBadge(text: s.0, color: s.1) }
                                Spacer()
                                Text("開く").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.iris)
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 16).frame(height: 54).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Rectangle().fill(NFColor.line).frame(height: 1)
                    }
                }
            }
        }
    }
}

struct NICountView: View {
    @ObservedObject var model: NativeInventoryModel
    let countId: String
    let onClose: () -> Void

    @State private var detail: NICountDetail?
    @State private var values: [String: String] = [:]
    @State private var confirmOpen = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: detail?.storeName ?? model.payload?.store.name ?? "", title: "棚卸", subtitle: "Stocktake", onHome: onClose)
            if let d = detail {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        Button(action: onClose) {
                            HStack(spacing: 3) { Image(systemName: "chevron.left"); Text("在庫へ戻る") }.font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.royal)
                        }.buttonStyle(.plain)
                        Text("棚卸：\(NI.date(d.countDate))").font(.system(size: 20, weight: .heavy)).foregroundColor(NFColor.navy)
                        Text(d.storeName).font(.system(size: 14)).foregroundColor(NFColor.ink3)
                        if let s = NI.countStatus[d.status] { NPBadge(text: s.0, color: s.1) }
                        Spacer()
                    }
                    ScrollView { table(d) }
                    if d.status == "draft" && d.canWrite { foot }
                }
                .padding(16)
            } else {
                Spacer(); ProgressView("読み込み中…").tint(NFColor.iris); Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .overlay {
            if confirmOpen {
                NativeModalCard(width: 520) {
                    VStack(alignment: .leading, spacing: 14) {
                        NIDialogHead(title: "棚卸を確定", onClose: { confirmOpen = false })
                        Text("入力済みの実数で在庫数量を更新します。この操作は取り消せません。未入力の品目は変更されません。").font(.system(size: 15)).foregroundColor(NFColor.ink2)
                        NIDialogFoot(error: nil, busy: model.busy, okText: "確定する", busyText: "確定中…", onCancel: { confirmOpen = false }) {
                            Task { confirmOpen = false; await save(finalize: true) }
                        }
                    }.padding(22)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let d: NICountDetail = try await model.get([URLQueryItem(name: "part", value: "inventoryCount"), URLQueryItem(name: "id", value: countId)])
            detail = d
            values = Dictionary(uniqueKeysWithValues: d.items.map { ($0.id, $0.countedQuantity.map { NI.q($0) } ?? "") })
        } catch {
            model.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            onClose()
        }
    }

    private func table(_ d: NICountDetail) -> some View {
        let draft = d.status == "draft"
        return niCard {
            VStack(spacing: 0) {
                HStack {
                    Text("品目").frame(maxWidth: .infinity, alignment: .leading)
                    Text("理論在庫").frame(width: 120, alignment: .trailing)
                    Text("実数").frame(width: draft ? 160 : 120, alignment: .trailing)
                    if !draft { Text("差異").frame(width: 120, alignment: .trailing) }
                }
                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 16).frame(height: 38).background(NFColor.lilacSoft)
                ForEach(d.items) { i in
                    HStack {
                        Text(i.name).font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                        Text(NI.q(i.expectedQuantity) + i.unit).monospacedDigit().frame(width: 120, alignment: .trailing)
                        if draft {
                            HStack(spacing: 6) {
                                TextField("", text: Binding(get: { values[i.id] ?? "" }, set: { values[i.id] = $0 }))
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                    .font(.system(size: 17, weight: .bold)).monospacedDigit()
                                    .padding(.horizontal, 10).frame(width: 120, height: 42)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                                Text(i.unit).font(.system(size: 12)).foregroundColor(NFColor.ink3).frame(width: 30, alignment: .leading)
                            }
                            .frame(width: 160, alignment: .trailing)
                        } else {
                            Text(i.countedQuantity.map { NI.q($0) + i.unit } ?? "—").monospacedDigit().frame(width: 120, alignment: .trailing)
                            let diff = i.countedQuantity.map { $0 - i.expectedQuantity }
                            Text(diff.map { ($0 > 0 ? "+" : "") + NI.q($0) + i.unit } ?? "—").monospacedDigit()
                                .foregroundColor(diff == nil || diff == 0 ? NFColor.ink : (diff! > 0 ? NFColor.success : NFColor.danger))
                                .frame(width: 120, alignment: .trailing)
                        }
                    }
                    .font(.system(size: 14.5)).padding(.horizontal, 16).frame(minHeight: 54)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                }
            }
        }
    }

    private var foot: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let e = error { Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger) }
            HStack(spacing: 10) {
                Spacer()
                niSmallButton(model.busy ? "保存中…" : "一時保存する", icon: "tray.and.arrow.down") { Task { await save(finalize: false) } }
                    .frame(height: 50).disabled(model.busy)
                Button { confirmOpen = true } label: {
                    Text("棚卸を確定する").font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 22).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
                }.buttonStyle(PressableStyle()).disabled(model.busy)
            }
        }
    }

    private func save(finalize: Bool) async {
        error = nil
        let entries: [[String: Any]] = values.compactMap { id, v in
            guard let n = NI.num(v), n >= 0 else { return nil }
            return ["id": id, "countedQuantity": n]
        }
        let r = await model.act(["type": "invCountSave", "countId": countId, "entries": entries, "finalize": finalize])
        if r.ok {
            model.toast = finalize ? "棚卸を確定しました" : "実数を保存しました"
            await load()
        } else { error = r.error ?? (finalize ? "確定に失敗しました" : "保存に失敗しました") }
    }
}

// MARK: - 移動タブ（Web の TransferList と同じ）

struct NITransfersTab: View {
    @ObservedObject var model: NativeInventoryModel
    let p: NIPayload
    let onCancel: (NITransfer) -> Void
    @State private var expanded = Set<String>()
    @State private var busyId: String?

    var body: some View {
        let rows = p.transfers ?? []
        if rows.isEmpty {
            niEmpty("店舗間移動の記録がありません", "「移動を申請」から他店舗への在庫移動を申請してください")
        } else {
            niCard {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Text("").frame(width: 16)
                        Text("番号").frame(width: 60, alignment: .leading)
                        Text("From").frame(maxWidth: .infinity, alignment: .leading)
                        Text("To").frame(maxWidth: .infinity, alignment: .leading)
                        Text("状態").frame(width: 90, alignment: .leading)
                        Text("品目数").frame(width: 56, alignment: .trailing)
                        Text("担当").frame(width: 100, alignment: .leading)
                        Text("申請日時").frame(width: 140, alignment: .leading)
                        Text("").frame(width: 190)
                    }
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
                    ForEach(rows) { r in
                        row(r)
                        if expanded.contains(r.id) { detail(r) }
                        Rectangle().fill(NFColor.line).frame(height: 1)
                    }
                }
            }
        }
    }

    private func row(_ r: NITransfer) -> some View {
        let isFrom = r.fromStoreId == p.store.id
        let isTo = r.toStoreId == p.store.id
        let canShip = isFrom && r.status == "requested" && p.canTransfer
        let canReceive = isTo && r.status == "shipped" && p.canTransfer
        let canCancel = isFrom && r.status == "requested" && p.canTransfer
        return HStack(spacing: 8) {
            Image(systemName: expanded.contains(r.id) ? "chevron.down" : "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 16)
            Text("#\(r.transferNo)").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy).frame(width: 60, alignment: .leading)
            Text(r.fromStoreName).frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
            Text(r.toStoreName).frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
            Group { if let s = NI.transferStatus[r.status] { NPBadge(text: s.0, color: s.1) } }.frame(width: 90, alignment: .leading)
            Text("\(r.items.count)").monospacedDigit().frame(width: 56, alignment: .trailing)
            Text(r.requestedByName ?? "—").lineLimit(1).frame(width: 100, alignment: .leading)
            Text(NI.dateTime(r.createdAt)).font(.system(size: 12.5)).frame(width: 140, alignment: .leading)
            HStack(spacing: 6) {
                if canShip { niSmallButton("発送", icon: "truck.box", tone: .white, fill: NFColor.iris) { Task { await run(r, ship: true) } }.disabled(busyId == r.id) }
                if canReceive { niSmallButton("受取", icon: "shippingbox", tone: .white, fill: NFColor.success) { Task { await run(r, ship: false) } }.disabled(busyId == r.id) }
                if canCancel { niSmallButton("取消", tone: .white, fill: NFColor.danger) { onCancel(r) }.disabled(busyId == r.id) }
            }
            .frame(width: 190, alignment: .trailing)
        }
        .font(.system(size: 13.5)).foregroundColor(NFColor.ink)
        .padding(.horizontal, 14).frame(minHeight: 52)
        .contentShape(Rectangle())
        .onTapGesture { if expanded.contains(r.id) { expanded.remove(r.id) } else { expanded.insert(r.id) } }
    }

    private func detail(_ r: NITransfer) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(r.items) { it in
                HStack { Text(it.name).foregroundColor(NFColor.navy); Spacer(); Text(NI.q(it.quantity) + it.unit).monospacedDigit().foregroundColor(NFColor.ink2) }
                    .font(.system(size: 14))
            }
            if let n = r.note, !n.isEmpty { Text("メモ: \(n)").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
            Text("発送: \(r.shippedByName ?? "—")／受取: \(r.receivedByName ?? "—")").font(.system(size: 12)).foregroundColor(NFColor.ink3)
        }
        .padding(.horizontal, 44).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NFColor.lilacSoft)
    }

    private func run(_ r: NITransfer, ship: Bool) async {
        busyId = r.id
        defer { busyId = nil }
        let res = await model.act(["type": ship ? "invTransferShip" : "invTransferReceive", "id": r.id])
        if res.ok {
            model.toast = ship ? "発送を登録しました" : "受取を登録しました"
            await model.refresh()
        } else { model.error = res.error ?? (ship ? "発送の登録に失敗しました" : "受取の登録に失敗しました") }
    }
}

/// 移動の取消（理由が要る。Web の ConfirmDialog requireReason）
struct NICancelTransfer: View {
    @ObservedObject var model: NativeInventoryModel
    let row: NITransfer
    let onClose: () -> Void
    @State private var reason = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "移動を取消", onClose: onClose)
            Text("#\(row.transferNo)（\(row.fromStoreName) → \(row.toStoreName)）を取消します。").font(.system(size: 15)).foregroundColor(NFColor.ink2)
            NIField(label: "理由（必須）", text: $reason)
            NIDialogFoot(error: error, busy: model.busy, okText: "取消する", busyText: "取消中…", danger: true, onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
    }

    private func save() async {
        let rs = reason.trimmingCharacters(in: .whitespaces)
        guard !rs.isEmpty else { error = "理由を入力してください"; return }
        let r = await model.act(["type": "invTransferCancel", "id": row.id, "reason": rs])
        if r.ok {
            model.toast = "移動を取消しました"
            onClose()
            await model.refresh()
        } else { error = r.error ?? "取消に失敗しました" }
    }
}

/// 店舗間移動を申請（Web の RequestTransferForm と同じ）
struct NIRequestTransferForm: View {
    @ObservedObject var model: NativeInventoryModel
    let stores: [NFNamed]
    let items: [NIOption]
    let onClose: () -> Void

    struct Line: Identifiable { let id = UUID(); var itemId = ""; var qty = "1" }
    @State private var toStore = ""
    @State private var note = ""
    @State private var lines = [Line()]
    @State private var picking: UUID?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "店舗間移動を申請", onClose: onClose)
            VStack(alignment: .leading, spacing: 5) {
                Text("移動先店舗").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                NIChoice(options: stores.map { ($0.id, $0.name) }, value: $toStore)
            }
            NIField(label: "メモ（任意）", text: $note)
            HStack {
                Text("品目").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                Spacer()
                niSmallButton("行を追加", icon: "plus") { lines.append(Line()) }
            }
            ScrollView {
                VStack(spacing: 8) {
                    ForEach($lines) { $l in
                        lineRow($l)
                    }
                }
            }
            .frame(maxHeight: 360)
            NIDialogFoot(error: error, busy: model.busy, okText: "申請する", busyText: "申請中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
    }

    private func lineRow(_ l: Binding<Line>) -> some View {
        let sel = items.first { $0.id == l.wrappedValue.itemId }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("品目").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                    Button { picking = picking == l.wrappedValue.id ? nil : l.wrappedValue.id } label: {
                        HStack {
                            Text(sel.map { "\($0.name)（現在庫 \(NI.q($0.currentQuantity))\($0.unit)）" } ?? "選択してください")
                                .foregroundColor(sel == nil ? NFColor.ink3 : NFColor.ink).lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.down").foregroundColor(NFColor.ink3)
                        }
                        .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 12).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    }.buttonStyle(.plain)
                }
                NIField(label: "数量" + (sel.map { "（\($0.unit)）" } ?? ""), text: l.qty, number: true).frame(width: 140)
                Button { lines.removeAll { $0.id == l.wrappedValue.id } } label: {
                    Image(systemName: "trash").font(.system(size: 17, weight: .semibold)).foregroundColor(lines.count <= 1 ? NFColor.ink3 : NFColor.danger).frame(width: 44, height: 46)
                }.buttonStyle(.plain).disabled(lines.count <= 1)
            }
            if picking == l.wrappedValue.id {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(items) { it in
                            Button { l.wrappedValue.itemId = it.id; picking = nil } label: {
                                HStack { Text(it.name).foregroundColor(NFColor.navy); Spacer(); Text("現在庫 \(NI.q(it.currentQuantity))\(it.unit)").foregroundColor(NFColor.ink3) }
                                    .font(.system(size: 14)).padding(.horizontal, 12).frame(height: 40).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Rectangle().fill(NFColor.line).frame(height: 1)
                        }
                    }
                }
                .frame(maxHeight: 200)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func save() async {
        error = nil
        guard !toStore.isEmpty else { error = "移動先店舗を選択してください"; return }
        let valid: [[String: Any]] = lines.compactMap { l in
            guard !l.itemId.isEmpty, let q = NI.num(l.qty), q > 0 else { return nil }
            return ["inventoryItemId": l.itemId, "quantity": q]
        }
        guard !valid.isEmpty else { error = "品目を1件以上選択してください"; return }
        let r = await model.act(["type": "invTransferRequest", "toStoreId": toStore, "note": note.trimmingCharacters(in: .whitespaces), "lines": valid])
        if r.ok {
            model.toast = "移動を申請しました"
            onClose()
            await model.refresh()
        } else { error = r.error ?? "申請に失敗しました" }
    }
}

// MARK: - 発注提案（Web の ReorderTab と同じ）

struct NIReorderTab: View {
    let rows: [NIReorder]
    let onWeb: (String) -> Void
    @State private var checked: Set<String>?

    private var sorted: [NIReorder] {
        rows.sorted { a, b in
            if a.needed != b.needed { return a.needed && !b.needed }
            if a.suggestedQuantity != b.suggestedQuantity { return a.suggestedQuantity > b.suggestedQuantity }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    var body: some View {
        if rows.isEmpty {
            niEmpty("対象の品目がありません", "在庫品目を登録すると発注提案が表示されます")
        } else {
            let ck = checked ?? Set(rows.filter(\.needed).map(\.id))
            let selected = sorted.filter { ck.contains($0.id) && $0.suggestedQuantity > 0 }
            VStack(alignment: .leading, spacing: 12) {
                Text("自動発注は行いません。内容を確認して発注へ進んでください")
                    .font(.system(size: 12.5)).foregroundColor(NFColor.ink2)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft))
                niCard {
                    VStack(spacing: 0) {
                        HStack(spacing: 8) {
                            Text("").frame(width: 30)
                            Text("品目").frame(maxWidth: .infinity, alignment: .leading)
                            Text("現在庫").frame(width: 80, alignment: .trailing)
                            Text("平均日販（過去30日）").frame(width: 130, alignment: .trailing)
                            Text("入荷待ち").frame(width: 80, alignment: .trailing)
                            Text("推奨発注数").frame(width: 90, alignment: .trailing)
                            Text("根拠").frame(width: 240, alignment: .leading)
                            Text("要否").frame(width: 70, alignment: .leading)
                        }
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
                        ForEach(sorted) { r in
                            let on = ck.contains(r.id)
                            Button {
                                var s = ck
                                if on { s.remove(r.id) } else { s.insert(r.id) }
                                checked = s
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: on ? "checkmark.square.fill" : "square").font(.system(size: 20)).foregroundColor(on ? NFColor.iris : NFColor.ink3).frame(width: 30)
                                    Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                                    Text(NI.q(r.currentQuantity) + r.unit).frame(width: 80, alignment: .trailing)
                                    Text(NI.q(r.avgDailySales) + r.unit).frame(width: 130, alignment: .trailing)
                                    Text(NI.q(r.incomingQuantity) + r.unit).frame(width: 80, alignment: .trailing)
                                    Text(NI.q(r.suggestedQuantity) + r.unit).bold().foregroundColor(NFColor.navy).frame(width: 90, alignment: .trailing)
                                    Text(r.basis).font(.system(size: 11.5)).foregroundColor(NFColor.ink3).frame(width: 240, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                                    Group { if r.needed { NPBadge(text: "要発注", color: NFColor.saffron) } }.frame(width: 70, alignment: .leading)
                                }
                                .font(.system(size: 13.5)).monospacedDigit().foregroundColor(NFColor.ink)
                                .padding(.horizontal, 14).padding(.vertical, 10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Rectangle().fill(NFColor.line).frame(height: 1)
                        }
                    }
                }
                HStack {
                    Spacer()
                    Button {
                        let items = selected.map { "\($0.id):\(NI.q($0.suggestedQuantity))" }.joined(separator: ",")
                        var c = URLComponents(); c.queryItems = [URLQueryItem(name: "items", value: items)]
                        onWeb("/app/purchases/new?\(c.percentEncodedQuery ?? "")")
                    } label: {
                        Text("選択品目で発注書を作成（\(selected.count)件）").font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                            .padding(.horizontal, 22).frame(height: 52)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected.isEmpty ? NFColor.ink3 : NFColor.iris))
                    }.buttonStyle(PressableStyle()).disabled(selected.isEmpty)
                }
            }
        }
    }
}

// MARK: - 予測（Web の予測タブと同じ）

struct NIForecastTab: View {
    @ObservedObject var model: NativeInventoryModel
    let f: NIForecast?
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            picker
            if let f, let r = f.result {
                VStack(alignment: .leading, spacing: 12) {
                    if r.lowConfidence {
                        Text("データが不足しているため参考値です").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NFColor.saffron)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.saffronSoft))
                    }
                    HStack(spacing: 10) {
                        niStat("明日の見込み", NI.q(r.tomorrow) + f.unit, tone: NFColor.iris)
                        niStat("今週残りの見込み", NI.q(r.thisWeekRemaining) + f.unit)
                        niStat("来週の見込み", NI.q(r.nextWeek) + f.unit)
                    }
                    chart(f)
                }
            } else {
                niEmpty("品目を選択してください", "品目を選ぶと過去8週間の実績から需要予測を表示します")
            }
            Text("売れ筋上位10品目の明日見込み").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
            if (f?.top ?? []).isEmpty {
                niEmpty("販売実績がありません", "過去8週間の販売実績が蓄積すると表示されます")
            } else {
                niCard {
                    VStack(spacing: 0) {
                        HStack { Text("品目"); Spacer(); Text("明日の見込み") }
                            .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 16).frame(height: 38).background(NFColor.lilacSoft)
                        ForEach(f?.top ?? []) { t in
                            HStack { Text(t.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.navy); Spacer(); Text(NI.q(t.tomorrow) + t.unit).monospacedDigit() }
                                .font(.system(size: 14)).padding(.horizontal, 16).frame(height: 46)
                            Rectangle().fill(NFColor.line).frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    private var picker: some View {
        let opts = f?.itemOptions ?? []
        let sel = opts.first { $0.id == model.forecastItem }
        return VStack(alignment: .leading, spacing: 6) {
            Button { picking.toggle() } label: {
                HStack {
                    Text(sel?.name ?? "品目を選択").foregroundColor(sel == nil ? NFColor.ink3 : NFColor.ink)
                    Spacer()
                    Image(systemName: "chevron.down").foregroundColor(NFColor.ink3)
                }
                .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 14).frame(width: 360, height: 46)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            }.buttonStyle(.plain)
            if picking {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(opts) { o in
                            Button {
                                model.forecastItem = o.id; picking = false
                                Task { await model.refresh() }
                            } label: {
                                Text(o.name).font(.system(size: 14)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 14).frame(height: 40).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Rectangle().fill(NFColor.line).frame(height: 1)
                        }
                    }
                }
                .frame(width: 360).frame(maxHeight: 260)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
        }
    }

    /// 曜日別平均使用量（棒グラフ）
    private func chart(_ f: NIForecast) -> some View {
        let maxV = max(f.weekdayChart.map(\.avg).max() ?? 0, 0.0001)
        return VStack(alignment: .leading, spacing: 10) {
            Text("\(f.selectedName)：曜日別平均使用量").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
            HStack(alignment: .bottom, spacing: 14) {
                ForEach(f.weekdayChart, id: \.weekday) { w in
                    VStack(spacing: 6) {
                        Text(NI.q((w.avg * 10).rounded() / 10)).font(.system(size: 11.5, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink2)
                        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(NFColor.iris)
                            .frame(height: max(4, CGFloat(w.avg / maxV) * 160))
                        Text(w.weekday).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 210, alignment: .bottom)
            Text("単位: \(f.unit)").font(.system(size: 11)).foregroundColor(NFColor.ink3)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}
