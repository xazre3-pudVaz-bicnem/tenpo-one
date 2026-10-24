import SwiftUI

// iPhone の店長・オーナー：原価管理（Web の /app/costing・/app/costing/<menuItemId>。2026-10-25 Ronnie「iPhone も native に」）
//   商品原価：平均原価率・レシピ設定済み・要注意（30%超）／カテゴリ・商品名・しぼり込み（要注意・レシピ未設定・原価未設定の食材あり）・並び替え
//   仕入影響：最終仕入単価が平均から 10% 以上ずれた食材・食材を選ぶとその食材を使う商品の原価・原価率の変化
//   廃棄・在庫差異：7日・30日・90日の廃棄額・品目ごとの廃棄・直近の棚卸の差異
//   商品を押すとレシピ（NativePhoneOwnerCostingItem.swift）：食材の追加・編集・削除（その場で原価・原価率を計算）
// サーバーは iPad と同じ：GET part=costing|costingImpact|costingWaste|costingItem ／ POST costingLineAdd・Update・Delete
// CSV 出力・売価や手入力原価の変更は Web の画面で。

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPZCoSummary: Decodable, Hashable {
    let avgCostRate: Double?
    let recipeSetCount: Int
    let warningCount: Int
    let total: Int
}

struct NPZCoRow: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let categoryName: String?
    let itemType: String
    let itemTypeLabel: String?
    let price: Double
    let manualCost: Double?
    let recipeCost: Double?
    let ingredientCount: Int
    let missingCostCount: Int
    let displayCost: Double?
    let costRate: Double?
    let grossProfitYen: Double?
    let grossProfitRate: Double?
}

struct NPZCoItemsPayload: Decodable {
    let store: NPZNamed?
    let canExport: Bool?
    let summary: NPZCoSummary
    let categories: [NPZNamed]
    let rows: [NPZCoRow]
}

struct NPZCoIngredient: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let avgCost: Double
    let lastCost: Double
    /// 乖離している食材の一覧のときだけ
    let deviationRate: Double?
}

struct NPZCoImpactRow: Decodable, Hashable {
    let menuItemName: String
    let costDelta: Double
    let newCost: Double
    let oldCostRate: Double?
    let newCostRate: Double?
}

struct NPZCoImpactPayload: Decodable {
    let threshold: Double?
    let ingredients: [NPZCoIngredient]
    let deviations: [NPZCoIngredient]
    let selected: NPZCoIngredient?
    let impactRows: [NPZCoImpactRow]
}

struct NPZCoPeriod: Decodable, Hashable {
    let label: String
    let from: String
    let to: String
}

struct NPZCoWasteRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let quantity: Double
    let amount: Double
    let reasonSummary: String?
}

struct NPZCoDiffRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let expected: Double?
    let counted: Double?
    let diff: Double
    let diffAmount: Double?
}

struct NPZCoWastePayload: Decodable {
    let from: String
    let to: String
    let periods: [NPZCoPeriod]
    let totalWasteAmount: Double
    let wasteRows: [NPZCoWasteRow]
    let latestCountDate: String?
    let diffRows: [NPZCoDiffRow]
}

/// 計算・色（Web の lib/costing.ts・components/costing/labels.ts と同じ）
enum NPZCoMath {
    static let warning: Double = 30
    static let danger: Double = 40

    /// JS の Math.round（.5 は大きい方へ）
    static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    /// 行の原価 = 使用量 × 平均仕入単価（切り上げ）。単価未設定は nil
    static func lineCost(_ quantity: Double, _ avgCost: Double?) -> Double? {
        guard let a = avgCost else { return nil }
        return (quantity * a).rounded(.up)
    }

    /// 原価率（%・小数1桁）。売価0以下は nil
    static func costRate(_ cost: Double, _ price: Double) -> Double? {
        guard price > 0 else { return nil }
        return jsRound(cost / price * 1000) / 10
    }

    static func tone(_ rate: Double?) -> Color {
        guard let r = rate else { return NT.ink3 }
        if r > danger { return NT.danger }
        if r > warning { return NT.warn }
        return NT.ok
    }

    static func pct(_ v: Double?) -> String {
        guard let v else { return "—" }
        return NPZ.q(v) + "%"
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPZCostingModel: ObservableObject {
    @Published var tab = "items"
    @Published var items: NPZCoItemsPayload?
    @Published var impact: NPZCoImpactPayload?
    @Published var waste: NPZCoWastePayload?
    // 商品原価（?category= ?q=）。並び替え・しぼり込みはこの iPhone の中だけ
    @Published var category = ""
    @Published var q = ""
    @Published var sort = "name"
    @Published var quick = "all"
    // 仕入影響（?ingredient=）・廃棄（?from= ?to=。無ければ30日）
    @Published var ingredient = ""
    @Published var from = ""
    @Published var to = ""
    @Published var loading = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    /// 開いている商品のレシピ（/app/costing/<menuItemId>）
    @Published var openId: String?

    static let tabs: [(key: String, label: String)] = [(key: "items", label: "商品原価"), (key: "impact", label: "仕入影響"), (key: "waste", label: "廃棄・差異")]
    static let sorts: [(String, String)] = [("name", "名前順"), ("rateDesc", "原価率の高い順"), ("rateAsc", "原価率の低い順"), ("profitDesc", "粗利益の多い順"), ("priceDesc", "売価の高い順")]
    static let quicks: [(String, String)] = [("all", "すべて"), ("warning", "要注意（30%超）"), ("noRecipe", "レシピ未設定"), ("missing", "原価未設定の食材あり")]

    init(route: NativeModuleRoute? = nil) {
        if let route {
            switch route.query("tab") ?? "" {
            case "impact": tab = "impact"
            case "waste": tab = "waste"
            default: tab = "items"
            }
            if let c = route.query("category"), NOS.isUuid(c) { category = c }
            q = route.query("q") ?? ""
            if let i = route.query("ingredient"), NOS.isUuid(i) { ingredient = i }
            if let f = route.query("from"), NOS.isDay(f) { from = f }
            if let t = route.query("to"), NOS.isDay(t) { to = t }
            let parts = route.url.path.split(separator: "/").map(String.init)
            if parts.count >= 3, parts[1] == "costing", NOS.isUuid(parts[2]) { openId = parts[2] }
        }
        items = NPZApi.cached(NPZCoItemsPayload.self, "costing", itemsQuery())
        if tab == "impact" { impact = NPZApi.cached(NPZCoImpactPayload.self, "costingImpact", impactQuery()) }
        if tab == "waste" { waste = NPZApi.cached(NPZCoWastePayload.self, "costingWaste", wasteQuery()) }
    }

    func itemsQuery() -> [String: String] {
        var d: [String: String] = [:]
        if !category.isEmpty { d["category"] = category }
        let t = NPZ.trimmed(q)
        if !t.isEmpty { d["q"] = t }
        return d
    }

    func impactQuery() -> [String: String] { ingredient.isEmpty ? [:] : ["ingredient": ingredient] }

    func wasteQuery() -> [String: String] {
        var d: [String: String] = [:]
        if !from.isEmpty { d["from"] = from }
        if !to.isEmpty { d["to"] = to }
        return d
    }

    var loaded: Bool {
        switch tab {
        case "impact": return impact != nil
        case "waste": return waste != nil
        default: return items != nil
        }
    }

    func setTab(_ t: String) {
        guard t != tab else { return }
        tab = t
        error = nil
        Task { await refresh() }
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        loading = true
        defer { loading = false }
        do {
            switch tab {
            case "impact":
                let qy = impactQuery()
                if impact == nil { impact = NPZApi.cached(NPZCoImpactPayload.self, "costingImpact", qy) }
                let p = try await NPZApi.get(NPZCoImpactPayload.self, "costingImpact", qy)
                if qy == impactQuery() { impact = p }
            case "waste":
                let qy = wasteQuery()
                if waste == nil { waste = NPZApi.cached(NPZCoWastePayload.self, "costingWaste", qy) }
                let p = try await NPZApi.get(NPZCoWastePayload.self, "costingWaste", qy)
                if qy == wasteQuery() { waste = p }
            default:
                let qy = itemsQuery()
                let p = try await NPZApi.get(NPZCoItemsPayload.self, "costing", qy)
                if qy == itemsQuery() { items = p }
            }
            error = nil
        } catch {
            if NPZApi.useWeb(error) { useWeb = true; return }
            self.error = NPZApi.message(error)
        }
    }

    /// しぼり込み・並び替えを当てた商品（Web の画面と同じ決まり）
    func shownRows(_ rows: [NPZCoRow]) -> [NPZCoRow] {
        let filtered = rows.filter { r in
            switch quick {
            case "warning": return (r.costRate ?? 0) > NPZCoMath.warning
            case "noRecipe": return r.ingredientCount == 0
            case "missing": return r.missingCostCount > 0
            default: return true
            }
        }
        switch sort {
        case "rateDesc": return filtered.sorted { ($0.costRate ?? -1) > ($1.costRate ?? -1) }
        case "rateAsc": return filtered.sorted { ($0.costRate ?? 1e9) < ($1.costRate ?? 1e9) }
        case "profitDesc": return filtered.sorted { ($0.grossProfitYen ?? -1e12) > ($1.grossProfitYen ?? -1e12) }
        case "priceDesc": return filtered.sorted { $0.price > $1.price }
        default: return filtered
        }
    }
}

// MARK: - 画面

/// key "costing" の画面（NativePhoneOwnerScreen から）
struct NativePhoneCostingScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPZCostingModel

    init(route: NativeModuleRoute) {
        _model = StateObject(wrappedValue: NPZCostingModel(route: route))
    }

    var body: some View {
        NativePhoneCostingView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "costing", useWeb: model.useWeb, state: state))
    }
}

struct NativePhoneCostingView: View {
    @ObservedObject var model: NPZCostingModel
    let onBack: () -> Void
    let onOpen: (String) -> Void
    /// 見本（-tenpoNativePreview）のレシピ
    var sampleItem: NPZCoItemModel? = nil

    @State private var pickingIngredient = false

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "原価管理", subtitle: model.items?.store?.name ?? "Costing", onBack: onBack, trailing: {
                NPZRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }, content: {
                VStack(spacing: 0) {
                    NOSSegment(items: NPZCostingModel.tabs, selection: model.tab) { model.setTab($0) }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                    if model.loaded { NOSErrorBar(error: $model.error) }
                    if model.loaded {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 10) {
                                switch model.tab {
                                case "impact": impactTab
                                case "waste": wasteTab
                                default: itemsTab
                                }
                            }
                            .padding(.horizontal, 12).padding(.top, 2).padding(.bottom, 60)
                        }
                        .refreshable { await model.refresh() }
                        .scrollDismissesKeyboard(.interactively)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            if let id = model.openId {
                NPZCoItemView(menuItemId: id, sample: sampleItem, onBack: {
                    model.openId = nil
                    Task { await model.refresh() }
                })
                .transition(.move(edge: .trailing))
                .zIndex(2)
            }
            NPHToast(text: $model.toast).zIndex(3)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.22), value: model.openId)
        .task { await model.refresh() }
        .sheet(isPresented: $pickingIngredient) {
            NPZPickSheet(title: "食材を選ぶ", options: (model.impact?.ingredients ?? []).map {
                NPZPickOption(id: $0.id, title: $0.name, sub: "平均 \(NPZ.yen($0.avgCost))／最終 \(NPZ.yen($0.lastCost))（/\($0.unit)）")
            }, selected: model.ingredient, onPick: { id in
                pickingIngredient = false
                model.ingredient = id
                Task { await model.refresh() }
            }, onClose: { pickingIngredient = false })
        }
    }

    // MARK: 商品原価

    @ViewBuilder private var itemsTab: some View {
        if let p = model.items {
            let s = p.summary
            NPZTileGrid {
                NPZTile(label: "平均原価率", value: NPZCoMath.pct(s.avgCostRate), tone: NPZCoMath.tone(s.avgCostRate))
                NPZTile(label: "要注意（30%超）", value: "\(s.warningCount)品", tone: s.warningCount > 0 ? NT.warn : NT.ink)
                NPZTile(label: "レシピ設定済み", value: "\(s.recipeSetCount)/\(s.total)品", tone: NT.purpleDeep)
                NPZTile(label: "原価率の目安", value: "30%以下", sub: "30%超は要注意・40%超は危険")
            }
            NPZSearchField(text: $model.q, placeholder: "商品名で探す") { Task { await model.refresh() } }
            HStack(spacing: 8) {
                NPOCMenuChip(label: "カテゴリ", options: [("", "すべて")] + p.categories.map { ($0.id, $0.name) }, selection: model.category) { c in
                    model.category = c
                    Task { await model.refresh() }
                }
                NPOCMenuChip(label: "並び", options: NPZCostingModel.sorts, selection: model.sort == "name" ? "" : model.sort) { v in
                    model.sort = v.isEmpty ? "name" : v
                }
                Spacer(minLength: 0)
            }
            NPZChipRow(items: NPZCostingModel.quicks, selection: model.quick) { model.quick = $0 }
            let rows = model.shownRows(p.rows)
            if rows.isEmpty {
                NPOCEmpty(icon: "fork.knife", title: p.rows.isEmpty ? "商品がありません" : "該当する商品がありません")
            } else {
                Text("\(rows.count)品・押すとレシピ（食材）").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).padding(.leading, 4)
                ForEach(rows) { r in
                    Button { model.openId = r.id } label: { itemRow(r) }
                        .buttonStyle(PressableStyle(scale: 0.985))
                }
            }
            if p.canExport == true {
                Button { onOpen("/app/costing?web=1") } label: {
                    Label("CSV 出力は Web の画面で", systemImage: "square.and.arrow.down").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                }
                .buttonStyle(.plain)
                .padding(.leading, 4)
            }
        }
    }

    private func itemRow(_ r: NPZCoRow) -> some View {
        let tone = NPZCoMath.tone(r.costRate)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(r.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                    Text([r.categoryName ?? "", r.itemTypeLabel ?? ""].filter { !$0.isEmpty }.joined(separator: "・"))
                        .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("原価率").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NPZCoMath.pct(r.costRate)).font(.system(size: 22, weight: .heavy)).foregroundColor(tone).monospacedDigit()
                }
            }
            HStack(spacing: 10) {
                Text("売価 \(NPZ.yen(r.price))")
                Text("原価 \(NPZ.yen(r.displayCost))")
                if let gp = r.grossProfitYen { Text("粗利 \(NPZ.yen(gp))") }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1).minimumScaleFactor(0.85)
            HStack(spacing: 5) {
                if r.ingredientCount == 0 {
                    NOSBadge(text: r.manualCost != nil ? "レシピ未設定（手入力原価）" : "レシピ未設定", color: NT.ink3)
                } else {
                    NOSBadge(text: "食材 \(r.ingredientCount)", color: NT.purple)
                }
                if r.missingCostCount > 0 { NOSBadge(text: "原価未設定の食材 \(r.missingCostCount)", color: NT.warn) }
            }
        }
        .padding(12)
        .background(npocCard(14))
    }

    // MARK: 仕入影響

    @ViewBuilder private var impactTab: some View {
        if let p = model.impact {
            Text("最終仕入単価が平均から \(NPZ.q(p.threshold ?? 10))% 以上ずれている食材です。押すと、その食材を使う商品への影響が出ます。")
                .font(.system(size: 12)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
            if p.deviations.isEmpty {
                NPOCEmpty(icon: "checkmark.circle", title: "大きくずれている食材はありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(p.deviations) { d in
                        Button {
                            model.ingredient = d.id
                            Task { await model.refresh() }
                        } label: { deviationRow(d, selected: d.id == model.ingredient) }
                            .buttonStyle(.plain)
                        if d.id != p.deviations.last?.id { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
            NPZPickButton(label: "食材を選んで影響を見る", value: p.selected?.name, placeholder: "食材を選ぶ") { pickingIngredient = true }
            if let s = p.selected {
                NPOCard(title: s.name, trailing: "1\(s.unit)あたり") {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(NPZ.yen(s.avgCost)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink2).monospacedDigit()
                        Image(systemName: "arrow.right").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3)
                        Text(NPZ.yen(s.lastCost)).font(.system(size: 22, weight: .heavy)).foregroundColor(s.lastCost > s.avgCost ? NT.danger : NT.ok).monospacedDigit()
                        Spacer()
                    }
                    Text("平均仕入単価 → 最終仕入単価で計算した場合").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                if p.impactRows.isEmpty {
                    NPOCEmpty(icon: "fork.knife", title: "この食材を使う商品はありません")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(p.impactRows.enumerated()), id: \.offset) { i, r in
                            impactRow(r)
                            if i < p.impactRows.count - 1 { NPZDivider(inset: 14) }
                        }
                    }
                    .background(npocCard())
                }
            }
        }
    }

    private func deviationRow(_ d: NPZCoIngredient, selected: Bool) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(d.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Text("平均 \(NPZ.yen(d.avgCost)) → 最終 \(NPZ.yen(d.lastCost))（/\(d.unit)）").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
            }
            Spacer(minLength: 6)
            if let r = d.deviationRate {
                Text((r > 0 ? "+" : "") + String(format: "%.1f", r) + "%").font(.system(size: 16, weight: .heavy)).foregroundColor(r > 0 ? NT.danger : NT.ok).monospacedDigit()
            }
            Image(systemName: selected ? "checkmark.circle.fill" : "chevron.right").font(.system(size: selected ? 18 : 11, weight: .bold))
                .foregroundColor(selected ? NT.purple : NT.ink3)
        }
        .padding(.horizontal, 14).frame(minHeight: 54)
        .contentShape(Rectangle())
    }

    private func impactRow(_ r: NPZCoImpactRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(r.menuItemName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Spacer()
                Text((r.costDelta > 0 ? "+" : "") + NPZ.yen(r.costDelta)).font(.system(size: 15, weight: .heavy))
                    .foregroundColor(r.costDelta > 0 ? NT.danger : (r.costDelta < 0 ? NT.ok : NT.ink)).monospacedDigit()
            }
            HStack(spacing: 8) {
                Text("新しい原価 \(NPZ.yen(r.newCost))")
                Spacer()
                Text("原価率 \(NPZCoMath.pct(r.oldCostRate)) → ")
                Text(NPZCoMath.pct(r.newCostRate)).foregroundColor(NPZCoMath.tone(r.newCostRate))
            }
            .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    // MARK: 廃棄・在庫差異

    @ViewBuilder private var wasteTab: some View {
        if let p = model.waste {
            NPZChipRow(items: p.periods.map { ($0.label, $0.label + "間") }, selection: p.periods.first(where: { $0.from == p.from && $0.to == p.to })?.label ?? "") { label in
                guard let pr = p.periods.first(where: { $0.label == label }) else { return }
                model.from = pr.from
                model.to = pr.to
                Task { await model.refresh() }
            }
            NPZTile(label: "廃棄額（\(NPZ.md(p.from))〜\(NPZ.md(p.to))）", value: NPZ.yen(p.totalWasteAmount), tone: p.totalWasteAmount > 0 ? NT.danger : NT.ink,
                    sub: "単価のない記録は金額に入りません")
            NPOCSectionTitle(title: "品目ごとの廃棄", note: "廃棄は在庫の「入出庫 → 廃棄」で記録します")
            if p.wasteRows.isEmpty {
                NPOCEmpty(icon: "trash", title: "この期間の廃棄はありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(p.wasteRows) { r in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                if let s = r.reasonSummary, !s.isEmpty { Text(s).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(2) }
                            }
                            Spacer(minLength: 6)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(NPZ.yen(r.amount)).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.danger).monospacedDigit()
                                Text(NPZ.q(r.quantity) + r.unit).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        if r.id != p.wasteRows.last?.id { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
            NPOCSectionTitle(title: "在庫差異（直近の棚卸）", note: p.latestCountDate.map { "棚卸日 \(NPZ.date($0))" } ?? "確定した棚卸がありません")
            if p.latestCountDate != nil {
                if p.diffRows.isEmpty {
                    NPOCEmpty(icon: "checkmark.seal", title: "差異はありません")
                } else {
                    VStack(spacing: 0) {
                        ForEach(p.diffRows) { r in
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                    Text("理論 \(NPZ.q(r.expected))／実数 \(NPZ.q(r.counted))\(r.unit)").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                                }
                                Spacer(minLength: 6)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(NPZ.signed(r.diff) + r.unit).font(.system(size: 15, weight: .heavy)).foregroundColor(r.diff < 0 ? NT.danger : NT.ok).monospacedDigit()
                                    Text(r.diffAmount.map { ($0 > 0 ? "+" : "") + NPZ.yen($0) } ?? "—").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            if r.id != p.diffRows.last?.id { NPZDivider(inset: 14) }
                        }
                    }
                    .background(npocCard())
                }
            }
        }
    }
}
