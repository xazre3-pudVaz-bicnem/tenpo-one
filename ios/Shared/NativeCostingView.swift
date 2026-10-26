import SwiftUI

// 原価管理のネイティブ。Web と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   /app/costing                 … 商品原価（平均原価率・レシピ設定済み・要注意／カテゴリ・商品名で絞り込み・並び替え・CSV出力）
//                                  仕入影響（乖離している食材・食材を選んで影響）／廃棄・在庫差異（7日・30日・90日・期間・直近の棚卸）
//   /app/costing/<menuItemId>    … レシピ編集（売価・レシピ原価・原価率・粗利益／食材の追加・編集・削除。入力中に原価・原価率をその場で計算）
// サーバーは lib/native-modules/costing.ts（読み込みは Web と同じ lib/costing-server.ts、操作は Web と同じ Server Action）。
// 計算は Web の lib/costing.ts と同じ（行の原価は切り上げ、原価率は %小数1桁・JS の Math.round と同じ丸め）。

// MARK: - 中身（サーバーの返事）

struct NCoCategory: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NCoSummary: Decodable, Hashable {
    let avgCostRate: Double?
    let recipeSetCount: Int
    let warningCount: Int
    let total: Int
}

struct NCoRow: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let categoryName: String
    let itemType: String
    let itemTypeLabel: String
    let price: Double
    let manualCost: Double?
    let recipeCost: Double?
    let ingredientCount: Int
    let missingCostCount: Int
    let displayCost: Double?
    let costRate: Double?
    let grossProfitYen: Double?
    let grossProfitRate: Double?
    let rateTone: String
}

struct NCoItemsPayload: Decodable {
    let ok: Bool
    let canExport: Bool
    let warningThreshold: Double
    let dangerThreshold: Double
    let summary: NCoSummary
    let categories: [NCoCategory]
    let rows: [NCoRow]
}

struct NCoIngredient: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let avgCost: Double
    let lastCost: Double
    /// 乖離している食材の一覧のときだけ
    let deviationRate: Double?
}

struct NCoImpactRow: Decodable, Hashable {
    let menuItemName: String
    let costDelta: Double
    let newCost: Double
    let oldCostRate: Double?
    let newCostRate: Double?
}

struct NCoImpactPayload: Decodable {
    let ok: Bool
    let threshold: Double
    let ingredients: [NCoIngredient]
    let deviations: [NCoIngredient]
    let selected: NCoIngredient?
    let impactRows: [NCoImpactRow]
}

struct NCoPeriod: Decodable, Hashable {
    let label: String
    let from: String
    let to: String
}

struct NCoWasteRow: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let quantity: Double
    let amount: Double
    let reasonSummary: String
}

struct NCoDiffRow: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let expected: Double?
    let counted: Double?
    let diff: Double
    let diffAmount: Double?
}

struct NCoWastePayload: Decodable {
    let ok: Bool
    let from: String
    let to: String
    let periods: [NCoPeriod]
    let totalWasteAmount: Double
    let wasteRows: [NCoWasteRow]
    let latestCountDate: String?
    let diffRows: [NCoDiffRow]
}

struct NCoItemHead: Decodable, Hashable {
    let id: String
    let name: String
    let itemType: String
    let itemTypeLabel: String
    let price: Double
    let manualCost: Double?
}

struct NCoLine: Decodable, Hashable, Identifiable {
    let id: String
    let inventoryItemId: String
    let ingredientName: String
    let unit: String
    let quantity: Double
    let avgCost: Double?
    let lineCost: Double?
    let note: String?
}

struct NCoOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let avgCost: Double?
}

struct NCoItemPayload: Decodable {
    let ok: Bool
    let item: NCoItemHead
    let recipeCost: Double?
    let displayCost: Double?
    let costRate: Double?
    let rateTone: String
    let grossProfit: Double?
    let grossProfitRate: Double?
    let missingCostCount: Int
    let lines: [NCoLine]
    let ingredientOptions: [NCoOption]
}

// MARK: - 計算（Web の lib/costing.ts・components/costing/labels.ts と同じ）

struct NCoPreview {
    /// この食材の原価（単価未設定は nil）
    let lineCost: Double?
    /// 保存したあとのレシピ原価（食材0件は nil）・表示する原価（レシピ原価を優先、なければ手入力原価）
    let recipeCost: Double?
    let displayCost: Double?
    let rate: Double?
    let profit: Double?
    let profitRate: Double?
    let missing: Int
}

enum NCoMath {
    /// 原価率のしきい値（%）。30%超は要注意、40%超は危険水準（Web と同じ）
    static let warning: Double = 30
    static let danger: Double = 40

    /// JS の Math.round（.5 は大きい方へ。負の数でも Web と同じ値）
    static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    /// 行の原価 = 使用量 × 平均仕入単価（切り上げ）。単価未設定は nil
    static func lineCost(quantity: Double, avgCost: Double?) -> Double? {
        guard let a = avgCost else { return nil }
        return (quantity * a).rounded(.up)
    }

    /// 原価率（%小数1桁）。売価0以下は nil
    static func costRate(_ cost: Double, _ price: Double) -> Double? {
        guard price > 0 else { return nil }
        return jsRound(cost / price * 1000) / 10
    }

    static func tone(_ rate: Double?) -> String {
        guard let r = rate else { return "gray" }
        if r > danger { return "danger" }
        if r > warning { return "warning" }
        return "success"
    }

    /// 食材を足す・変える・消したあとのレシピ原価・原価率・粗利（calcRecipeCost → resolveDisplayCost → costRate・grossProfit）
    /// replacing: 編集・削除する行の id。added: 足す（変えたあとの）行（使用量・単価）
    static func preview(lines: [NCoLine], replacing: String?, added: (quantity: Double, avgCost: Double?)?, price: Double, manualCost: Double?) -> NCoPreview {
        var parts: [(quantity: Double, avgCost: Double?)] = lines.filter { $0.id != replacing }.map { (quantity: $0.quantity, avgCost: $0.avgCost) }
        if let added { parts.append(added) }
        var total: Double = 0
        var missing = 0
        for p in parts {
            if let c = lineCost(quantity: p.quantity, avgCost: p.avgCost) { total += c } else { missing += 1 }
        }
        let recipe: Double? = parts.isEmpty ? nil : total
        let display: Double? = recipe ?? manualCost
        var rate: Double? = nil
        var profit: Double? = nil
        var profitRate: Double? = nil
        if let d = display {
            rate = costRate(d, price)
            profit = price - d
            profitRate = costRate(price - d, price)
        }
        let line: Double? = added.flatMap { lineCost(quantity: $0.quantity, avgCost: $0.avgCost) }
        return NCoPreview(lineCost: line, recipeCost: recipe, displayCost: display, rate: rate, profit: profit, profitRate: profitRate, missing: missing)
    }
}

enum NCoFmt {
    private static let yenF: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "ja_JP")
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 3
        return f
    }()

    private static let numF: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US_POSIX")
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 6
        return f
    }()

    /// Web の yen()（null は —、小数は 3 桁まで）
    static func yen(_ v: Double?) -> String {
        guard let v else { return "—" }
        return "¥" + (yenF.string(from: NSNumber(value: v)) ?? String(v))
    }

    static func signedYen(_ v: Double) -> String { (v > 0 ? "+" : "") + yen(v) }

    /// 数（200 → "200"、0.5 → "0.5"）
    static func num(_ v: Double) -> String { numF.string(from: NSNumber(value: v)) ?? String(v) }

    static func pct(_ v: Double?) -> String {
        guard let v else { return "—" }
        return num(v) + "%"
    }

    static func signedNum(_ v: Double) -> String { (v > 0 ? "+" : "") + num(v) }

    /// 入力した数（全角・カンマも受ける）。読めなければ nil
    static func parse(_ s: String) -> Double? {
        let t = (s.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? s)
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return nil }
        return Double(t)
    }
}

/// バッジの色（Web の Badge の tone）
enum NCoTone {
    static func fg(_ t: String) -> Color {
        switch t {
        case "danger": return NFColor.danger
        case "warning": return NFColor.saffron
        case "success": return NFColor.success
        case "primary": return NFColor.iris
        default: return NFColor.ink3
        }
    }

    static func bg(_ t: String) -> Color {
        switch t {
        case "danger": return NFColor.dangerSoft
        case "warning": return NFColor.saffronSoft
        case "success": return NFColor.successSoft
        case "primary": return NFColor.irisSoft
        default: return NFColor.lilac
        }
    }
}

// MARK: - 入口（Web の道 → 画面）

enum NCoTab: String, CaseIterable {
    case items
    case impact
    case waste

    var label: String {
        switch self {
        case .items: return "商品原価"
        case .impact: return "仕入影響"
        case .waste: return "廃棄・在庫差異"
        }
    }
}

enum NCoScreen: Hashable {
    case list
    case item(String)

    /// /app/costing（?tab=impact|waste）・/app/costing/<menuItemId>
    static func from(_ route: NativeModuleRoute) -> NCoScreen {
        let first = route.rest.split(separator: "/").first.map(String.init) ?? ""
        if first.isEmpty || first == "export" { return .list }
        return .item(first)
    }
}

struct NativeCostingView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    @StateObject private var list: NCoListModel
    @State private var screen: NCoScreen

    init(route: NativeModuleRoute, onHome: @escaping () -> Void) {
        self.route = route
        self.onHome = onHome
        _list = StateObject(wrappedValue: NCoListModel(route: route))
        _screen = State(initialValue: NCoScreen.from(route))
    }

    var body: some View {
        content
            .id(screen)
            .onChange(of: route) { r in
                list.apply(route: r)
                screen = NCoScreen.from(r)
            }
    }

    @ViewBuilder private var content: some View {
        switch screen {
        case .list:
            NCoListScreen(model: list, onHome: onHome, open: { screen = .item($0) })
        case .item(let id):
            NCoItemScreen(menuItemId: id, onBack: { screen = .list })
        }
    }
}

// MARK: - 共通の部品

struct NCoLoading: View {
    let error: String?
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            if let error {
                Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center)
                Button("もう一度") { Task { await retry() } }
            } else {
                ProgressView("読み込み中…").tint(NFColor.iris)
            }
            Spacer()
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity)
    }
}

struct NCoToast: ViewModifier {
    @Binding var toast: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let t = toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(NT.ink.opacity(0.92)))
                    .padding(.horizontal, 40).padding(.bottom, 24)
                    .onTapGesture { toast = nil }
                    .task {
                        try? await Task.sleep(nanoseconds: 2_800_000_000)
                        if toast == t { toast = nil }
                    }
            }
        }
    }
}

/// 上の数字の札（Web の StatCard）
struct NCoStat: View {
    let label: String
    let value: String
    var tone: String = "default"
    var sub: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3).lineLimit(2)
            Text(value).font(.system(size: 26, weight: NT.strong)).monospacedDigit().foregroundColor(valueColor)
                .lineLimit(1).minimumScaleFactor(0.5)
            if let sub { Text(sub).font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(borderColor, lineWidth: 1))
    }

    private var valueColor: Color { tone == "default" ? NFColor.ink : NCoTone.fg(tone) }
    private var borderColor: Color { tone == "default" ? NFColor.line : NCoTone.fg(tone).opacity(0.35) }
}

struct NCoBadge: View {
    let text: String
    let tone: String
    var small = false

    var body: some View {
        Text(text).font(.system(size: small ? 11 : 13, weight: NT.strong)).monospacedDigit()
            .foregroundColor(NCoTone.fg(tone))
            .padding(.horizontal, small ? 6 : 9).padding(.vertical, small ? 2 : 4)
            .background(Capsule().fill(NCoTone.bg(tone)))
            .lineLimit(1)
    }
}

/// 白い枠（見出しなし）
struct NCoBox<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}

struct NCoEmpty: View {
    let title: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2)
            if let message {
                Text(message).font(.system(size: 13)).foregroundColor(NFColor.ink3).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28).padding(.horizontal, 16)
    }
}

/// 選ぶボタン（見出し＋今の値＋⌃⌄）
struct NCoMenuLabel: View {
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: 6) {
            Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            Text(value).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
        }
        .padding(.horizontal, 14).frame(height: 44)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}

/// 表の見出しの字
private func ncoTh(_ t: String) -> some View {
    Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).lineLimit(1)
}

/// 表の数字
private func ncoNum(_ t: String, color: Color = NFColor.ink, bold: Bool = false) -> some View {
    Text(t).font(.system(size: 15, weight: bold ? NT.strong : .semibold)).monospacedDigit().foregroundColor(color).lineLimit(1)
        .minimumScaleFactor(0.7)
}

private struct NCoDivider: View {
    var body: some View { Rectangle().fill(NFColor.line).frame(height: 1) }
}

/// 一覧から選ぶシート（仕入影響の食材）
struct NCoPickItem: Identifiable, Hashable {
    let id: String
    let title: String
    let sub: String
}

struct NCoPickSheet: View {
    let title: String
    let items: [NCoPickItem]
    let selected: String?
    let pick: (String) -> Void
    let close: () -> Void
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title).font(.system(size: 18, weight: NT.strong)).foregroundColor(NFColor.ink)
                Spacer()
                Button("閉じる") { close() }.font(.system(size: 16, weight: .bold))
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            NCoSearchField(text: $query, placeholder: "名前で探す", onSubmit: {})
                .padding(.horizontal, 20).padding(.bottom, 12)
            NCoDivider()
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filtered) { it in
                        Button { pick(it.id) } label: { pickRow(it) }
                            .buttonStyle(.plain)
                        NCoDivider()
                    }
                    if filtered.isEmpty { NCoEmpty(title: "見つかりません") }
                }
            }
        }
        .background(Color.white.ignoresSafeArea())
    }

    private var filtered: [NCoPickItem] {
        let t = query.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return items }
        return items.filter { $0.title.localizedCaseInsensitiveContains(t) }
    }

    private func pickRow(_ it: NCoPickItem) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(it.title).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink)
                Text(it.sub).font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
            }
            Spacer()
            if it.id == selected {
                Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.iris)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

struct NCoSearchField: View {
    @Binding var text: String
    let placeholder: String
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink3)
            TextField(placeholder, text: $text)
                .font(.system(size: 16))
                .submitLabel(.search)
                .onSubmit { onSubmit() }
            if !text.isEmpty {
                Button {
                    text = ""
                    onSubmit()
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(NFColor.ink3)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).frame(height: 44)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}

// MARK: - 一覧（商品原価・仕入影響・廃棄・在庫差異）

enum NCoSort: String, CaseIterable {
    case name
    case rateDesc
    case rateAsc
    case profitDesc
    case priceDesc

    var label: String {
        switch self {
        case .name: return "名前順"
        case .rateDesc: return "原価率の高い順"
        case .rateAsc: return "原価率の低い順"
        case .profitDesc: return "粗利益の多い順"
        case .priceDesc: return "売価の高い順"
        }
    }
}

enum NCoQuick: String, CaseIterable {
    case all
    case warning
    case noRecipe
    case missing

    var label: String {
        switch self {
        case .all: return "すべて"
        case .warning: return "要注意（30%超）"
        case .noRecipe: return "レシピ未設定"
        case .missing: return "原価未設定食材あり"
        }
    }
}

@MainActor
final class NCoListModel: ObservableObject {
    @Published var tab: NCoTab = .items
    @Published var items: NCoItemsPayload?
    @Published var impact: NCoImpactPayload?
    @Published var waste: NCoWastePayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var refreshing = false
    // 商品原価（Web の ?category= ?q=）。並び替え・しぼり込みはこの iPad の中だけ
    @Published var category: String?
    @Published var query = ""
    @Published var appliedQuery = ""
    @Published var sort: NCoSort = .name
    @Published var quick: NCoQuick = .all
    @Published var exporting = false
    // 仕入影響（?ingredient=）
    @Published var ingredient: String?
    // 廃棄・在庫差異（?from= ?to=。無ければ30日）
    @Published var from: String?
    @Published var to: String?
    @Published var customFrom = ""
    @Published var customTo = ""

    init(route: NativeModuleRoute) {
        apply(route: route)
    }

    /// Web の道の ?tab= ?category= ?q= ?ingredient= ?from= ?to= をそのまま
    func apply(route: NativeModuleRoute) {
        switch route.query("tab") {
        case "impact": tab = .impact
        case "waste": tab = .waste
        default: tab = .items
        }
        let c = route.query("category") ?? ""
        category = c.isEmpty ? nil : c
        let q = route.query("q") ?? ""
        query = q
        appliedQuery = q
        let ing = route.query("ingredient") ?? ""
        ingredient = ing.isEmpty ? nil : ing
        let f = route.query("from") ?? ""
        let t = route.query("to") ?? ""
        from = f.isEmpty ? nil : f
        to = t.isEmpty ? nil : t
    }

    var itemsQuery: [String: String] {
        var q: [String: String] = [:]
        if let c = category { q["category"] = c }
        let t = appliedQuery.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { q["q"] = t }
        return q
    }

    var impactQuery: [String: String] {
        guard let i = ingredient else { return [:] }
        return ["ingredient": i]
    }

    var wasteQuery: [String: String] {
        var q: [String: String] = [:]
        if let f = from { q["from"] = f }
        if let t = to { q["to"] = t }
        return q
    }

    func switchTab(_ t: NCoTab) {
        guard t != tab else { return }
        error = nil
        tab = t
    }

    func loadTab() async {
        switch tab {
        case .items: await loadItems()
        case .impact: await loadImpact()
        case .waste: await loadWaste()
        }
    }

    func loadItems() async {
        let q = itemsQuery
        if let saved = NativeModuleAPI.cached(NCoItemsPayload.self, part: "costing", query: q) { items = saved }
        refreshing = true
        defer { refreshing = false }
        do {
            let p = try await NativeModuleAPI.get(NCoItemsPayload.self, part: "costing", query: q)
            if q == itemsQuery { items = p }
            error = nil
        } catch {
            if items == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func loadImpact() async {
        let q = impactQuery
        if let saved = NativeModuleAPI.cached(NCoImpactPayload.self, part: "costingImpact", query: q) { impact = saved }
        refreshing = true
        defer { refreshing = false }
        do {
            let p = try await NativeModuleAPI.get(NCoImpactPayload.self, part: "costingImpact", query: q)
            if q == impactQuery { impact = p }
            error = nil
        } catch {
            if impact == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func loadWaste() async {
        let q = wasteQuery
        if let saved = NativeModuleAPI.cached(NCoWastePayload.self, part: "costingWaste", query: q) { waste = saved }
        refreshing = true
        defer { refreshing = false }
        do {
            let p = try await NativeModuleAPI.get(NCoWastePayload.self, part: "costingWaste", query: q)
            if q == wasteQuery {
                waste = p
                customFrom = p.from
                customTo = p.to
            }
            error = nil
        } catch {
            if waste == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func setCategory(_ id: String?) {
        category = id
        Task { await self.loadItems() }
    }

    func applySearch() {
        appliedQuery = query.trimmingCharacters(in: .whitespaces)
        Task { await self.loadItems() }
    }

    func selectIngredient(_ id: String?) {
        ingredient = id
        Task { await self.loadImpact() }
    }

    func setRange(from f: String?, to t: String?) {
        from = f
        to = t
        Task { await self.loadWaste() }
    }

    func applyCustomRange() {
        guard !customFrom.isEmpty, !customTo.isEmpty else { return }
        if customFrom > customTo {
            toast = "期間の始めと終わりが逆です"
            return
        }
        setRange(from: customFrom, to: customTo)
    }

    /// 表に出す行（並び替え・しぼり込み。数字はサーバーのまま）
    func visibleRows(_ p: NCoItemsPayload) -> [NCoRow] {
        var rows = p.rows
        switch quick {
        case .all: break
        case .warning: rows = rows.filter { ($0.costRate ?? 0) > p.warningThreshold }
        case .noRecipe: rows = rows.filter { $0.ingredientCount == 0 }
        case .missing: rows = rows.filter { $0.ingredientCount > 0 && $0.missingCostCount > 0 }
        }
        switch sort {
        case .name: break
        case .rateDesc: rows.sort { NCoListModel.before($0.costRate, $1.costRate, desc: true) }
        case .rateAsc: rows.sort { NCoListModel.before($0.costRate, $1.costRate, desc: false) }
        case .profitDesc: rows.sort { NCoListModel.before($0.grossProfitYen, $1.grossProfitYen, desc: true) }
        case .priceDesc: rows.sort { $0.price > $1.price }
        }
        return rows
    }

    /// 並びの比べ方（値の無いものは後ろ）
    static func before(_ a: Double?, _ b: Double?, desc: Bool) -> Bool {
        if let x = a, let y = b { return desc ? x > y : x < y }
        return a != nil && b == nil
    }

    /// CSV出力（Web の /app/costing/export をそのまま取ってきて共有シートへ。今の絞り込みで）
    func exportCsv() {
        guard !exporting else { return }
        exporting = true
        var comps = URLComponents()
        comps.path = "/app/costing/export"
        let q = itemsQuery
        if !q.isEmpty {
            comps.queryItems = q.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        let path = comps.string ?? "/app/costing/export"
        Task {
            do {
                let data = try await NativeAPI.shared.download(path)
                let name = "menu_item_costs_\(NPDate.str(Date())).csv"
                if let url = NLShare.tempFile(name, data: data) { NLShare.present(url: url) } else { self.toast = "CSV を保存できませんでした" }
            } catch {
                self.toast = NativeModuleAPI.message(error)
            }
            self.exporting = false
        }
    }
}

struct NCoListScreen: View {
    @ObservedObject var model: NCoListModel
    let onHome: () -> Void
    let open: (String) -> Void
    @State private var picking = false

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "原価管理", subtitle: "", onHome: onHome)
            tabBar
            tabContent
        }
        .background(NT.page.ignoresSafeArea())
        .modifier(NCoToast(toast: $model.toast))
        .task(id: model.tab) { await model.loadTab() }
        .sheet(isPresented: $picking) {
            NCoPickSheet(
                title: "食材を選ぶ",
                items: pickItems,
                selected: model.ingredient,
                pick: { id in
                    picking = false
                    model.selectIngredient(id)
                },
                close: { picking = false }
            )
        }
    }

    /// 仕入影響の食材の選択肢（Web の「name（平均¥ / 最終¥）」）
    private var pickItems: [NCoPickItem] {
        let list = model.impact?.ingredients ?? []
        return list.map { i in
            NCoPickItem(id: i.id, title: i.name, sub: "平均\(NCoFmt.yen(i.avgCost)) / 最終\(NCoFmt.yen(i.lastCost))（\(i.unit)）")
        }
    }

    private var tabBar: some View {
        HStack(spacing: 8) {
            ForEach(NCoTab.allCases, id: \.self) { t in
                Button { model.switchTab(t) } label: { tabChip(t) }
                    .buttonStyle(PressableStyle())
            }
            Spacer()
            if model.refreshing { ProgressView().tint(NFColor.iris) }
        }
        .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 2)
        .frame(maxWidth: 1100)
        .frame(maxWidth: .infinity)
    }

    private func tabChip(_ t: NCoTab) -> some View {
        let on = model.tab == t
        return Text(t.label).font(.system(size: 15, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
            .padding(.horizontal, 18).frame(height: 42)
            .background(Capsule().fill(on ? NFColor.iris : Color.white))
            .overlay(Capsule().stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
    }

    @ViewBuilder private var tabContent: some View {
        switch model.tab {
        case .items:
            if let p = model.items {
                scroll { itemsTab(p) }
            } else {
                NCoLoading(error: model.error, retry: { await model.loadItems() })
            }
        case .impact:
            if let p = model.impact {
                scroll { impactTab(p) }
            } else {
                NCoLoading(error: model.error, retry: { await model.loadImpact() })
            }
        case .waste:
            if let p = model.waste {
                scroll { wasteTab(p) }
            } else {
                NCoLoading(error: model.error, retry: { await model.loadWaste() })
            }
        }
    }

    private func scroll<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        let c = content()
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) { c }
                .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 32)
                .frame(maxWidth: 1100, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.loadTab() }
    }

    // MARK: 商品原価

    @ViewBuilder private func itemsTab(_ p: NCoItemsPayload) -> some View {
        HStack(spacing: 12) {
            NCoStat(label: "平均原価率", value: NCoFmt.pct(p.summary.avgCostRate), tone: "primary")
            NCoStat(label: "レシピ設定済み商品数", value: "\(p.summary.recipeSetCount) / \(p.summary.total)件")
            NCoStat(label: "要注意商品数（原価率\(NCoFmt.num(p.warningThreshold))%超）", value: "\(p.summary.warningCount)件", tone: p.summary.warningCount > 0 ? "warning" : "default")
        }
        filterBar(p)
        itemsTable(p)
    }

    private func categoryName(_ p: NCoItemsPayload) -> String {
        guard let c = model.category else { return "すべて" }
        return p.categories.first { $0.id == c }?.name ?? "すべて"
    }

    private func filterBar(_ p: NCoItemsPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Menu {
                    Button("すべて") { model.setCategory(nil) }
                    ForEach(p.categories) { c in
                        Button(c.name) { model.setCategory(c.id) }
                    }
                } label: {
                    NCoMenuLabel(title: "カテゴリ", value: categoryName(p))
                }
                NCoSearchField(text: $model.query, placeholder: "商品名で検索", onSubmit: { model.applySearch() })
                    .frame(maxWidth: 320)
                NSPButton(text: "絞り込む") { model.applySearch() }
                Spacer(minLength: 0)
                if p.canExport {
                    NSPButton(text: "CSV出力", icon: "square.and.arrow.up", busy: model.exporting) { model.exportCsv() }
                }
            }
            HStack(spacing: 8) {
                ForEach(NCoQuick.allCases, id: \.self) { q in
                    Button { model.quick = q } label: { quickChip(q) }
                        .buttonStyle(PressableStyle())
                }
                Spacer(minLength: 0)
                Menu {
                    ForEach(NCoSort.allCases, id: \.self) { s in
                        Button {
                            model.sort = s
                        } label: {
                            if model.sort == s { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                        }
                    }
                } label: {
                    NCoMenuLabel(title: "並び", value: model.sort.label)
                }
            }
        }
    }

    private func quickChip(_ q: NCoQuick) -> some View {
        let on = model.quick == q
        return Text(q.label).font(.system(size: 13.5, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
            .padding(.horizontal, 14).frame(height: 36)
            .background(Capsule().fill(on ? NFColor.navy : Color.white))
            .overlay(Capsule().stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
    }

    private func itemsTable(_ p: NCoItemsPayload) -> some View {
        let rows = model.visibleRows(p)
        return NCoBox {
            if p.rows.isEmpty {
                NCoEmpty(title: "対象の商品がありません", message: "「メニュー」設定でフード・ドリンク・コースの商品を登録してください")
            } else if rows.isEmpty {
                NCoEmpty(title: "条件に合う商品がありません")
            } else {
                itemsHeader
                ForEach(rows) { r in
                    Button { open(r.id) } label: { itemRow(r) }
                        .buttonStyle(.plain)
                    NCoDivider()
                }
            }
        }
    }

    private var itemsHeader: some View {
        HStack(spacing: 10) {
            ncoTh("商品名").frame(maxWidth: .infinity, alignment: .leading)
            ncoTh("売価").frame(width: 84, alignment: .trailing)
            ncoTh("レシピ原価").frame(width: 120, alignment: .trailing)
            ncoTh("原価率").frame(width: 80, alignment: .trailing)
            ncoTh("粗利益").frame(width: 90, alignment: .trailing)
            ncoTh("粗利率").frame(width: 64, alignment: .trailing)
            ncoTh("食材数").frame(width: 50, alignment: .trailing)
            Color.clear.frame(width: 10)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(NFColor.lilacSoft)
    }

    private func itemRow(_ r: NCoRow) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(r.categoryName)・\(r.itemTypeLabel)").font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                    if r.ingredientCount > 0 && r.missingCostCount > 0 {
                        NCoBadge(text: "原価未設定食材あり（\(r.missingCostCount)件）", tone: "warning", small: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ncoNum(NCoFmt.yen(r.price)).frame(width: 84, alignment: .trailing)
            recipeCostCell(r).frame(width: 120, alignment: .trailing)
            rateCell(r.costRate, tone: r.rateTone).frame(width: 80, alignment: .trailing)
            ncoNum(r.grossProfitYen.map { NCoFmt.yen($0) } ?? "—").frame(width: 90, alignment: .trailing)
            ncoNum(NCoFmt.pct(r.grossProfitRate)).frame(width: 64, alignment: .trailing)
            ncoNum("\(r.ingredientCount)").frame(width: 50, alignment: .trailing)
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 10)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    @ViewBuilder private func recipeCostCell(_ r: NCoRow) -> some View {
        if r.ingredientCount > 0 {
            ncoNum(NCoFmt.yen(r.recipeCost))
        } else {
            VStack(alignment: .trailing, spacing: 3) {
                NCoBadge(text: "レシピ未設定", tone: "gray", small: true)
                if let m = r.manualCost {
                    Text("手入力原価: \(NCoFmt.yen(m))").font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1).minimumScaleFactor(0.7)
                }
            }
        }
    }

    @ViewBuilder private func rateCell(_ rate: Double?, tone: String) -> some View {
        if let rate {
            NCoBadge(text: NCoFmt.pct(rate), tone: tone)
        } else {
            ncoNum("—")
        }
    }

    // MARK: 仕入影響

    @ViewBuilder private func impactTab(_ p: NCoImpactPayload) -> some View {
        NSPCard(title: "最終仕入単価が平均と乖離している食材（乖離率\(NCoFmt.num(p.threshold))%以上）", note: "押すとその食材の影響を下に出します") {
            if p.deviations.isEmpty {
                NCoEmpty(title: "乖離している食材はありません")
            } else {
                VStack(spacing: 0) {
                    deviationHeader
                    ForEach(p.deviations) { d in
                        Button { model.selectIngredient(d.id) } label: { deviationRow(d, selected: p.selected?.id == d.id) }
                            .buttonStyle(.plain)
                        NCoDivider()
                    }
                }
            }
        }
        NSPCard(title: "食材を選んで影響を確認") {
            if p.ingredients.isEmpty {
                NCoEmpty(title: "対象の食材がありません", message: "平均仕入単価と最終仕入単価の両方が登録されている食材が対象です")
            } else {
                HStack(spacing: 10) {
                    Button { picking = true } label: {
                        NCoMenuLabel(title: "食材", value: selectedLabel(p))
                    }
                    .buttonStyle(PressableStyle())
                    if model.ingredient != nil {
                        NSPButton(text: "選ぶのをやめる") { model.selectIngredient(nil) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(18)
            }
        }
        if let s = p.selected {
            HStack(spacing: 12) {
                NCoStat(label: "対象食材", value: s.name)
                NCoStat(label: "現在の平均仕入単価", value: NCoFmt.yen(s.avgCost))
                NCoStat(label: "最終仕入単価", value: NCoFmt.yen(s.lastCost), tone: s.lastCost > s.avgCost ? "warning" : "default")
            }
            impactTable(p, selected: s)
        }
    }

    private func selectedLabel(_ p: NCoImpactPayload) -> String {
        guard let id = model.ingredient, let i = p.ingredients.first(where: { $0.id == id }) else { return "選択してください" }
        return "\(i.name)（平均\(NCoFmt.yen(i.avgCost)) / 最終\(NCoFmt.yen(i.lastCost))）"
    }

    private var deviationHeader: some View {
        HStack(spacing: 10) {
            ncoTh("食材").frame(maxWidth: .infinity, alignment: .leading)
            ncoTh("平均仕入単価").frame(width: 120, alignment: .trailing)
            ncoTh("最終仕入単価").frame(width: 120, alignment: .trailing)
            ncoTh("乖離率").frame(width: 90, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(NFColor.lilacSoft)
    }

    private func deviationRow(_ d: NCoIngredient, selected: Bool) -> some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Text(d.name).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                if selected { Image(systemName: "checkmark.circle.fill").foregroundColor(NFColor.iris) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ncoNum(NCoFmt.yen(d.avgCost)).frame(width: 120, alignment: .trailing)
            ncoNum(NCoFmt.yen(d.lastCost)).frame(width: 120, alignment: .trailing)
            NCoBadge(text: NCoFmt.pct(d.deviationRate), tone: "warning").frame(width: 90, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(selected ? NFColor.irisSoft : Color.clear)
        .contentShape(Rectangle())
    }

    private func impactTable(_ p: NCoImpactPayload, selected s: NCoIngredient) -> some View {
        NSPCard(title: "「\(s.name)」を使用する商品への影響") {
            if p.impactRows.isEmpty {
                NCoEmpty(title: "この食材を使用するレシピ設定商品はありません")
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        ncoTh("商品名").frame(maxWidth: .infinity, alignment: .leading)
                        ncoTh("原価変動額").frame(width: 110, alignment: .trailing)
                        ncoTh("新原価").frame(width: 100, alignment: .trailing)
                        ncoTh("原価率（変化前→変化後）").frame(width: 200, alignment: .trailing)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(NFColor.lilacSoft)
                    ForEach(Array(p.impactRows.enumerated()), id: \.offset) { _, r in
                        impactRow(r)
                        NCoDivider()
                    }
                }
            }
        }
    }

    private func impactRow(_ r: NCoImpactRow) -> some View {
        let worse = (r.newCostRate ?? 0) > (r.oldCostRate ?? 0)
        return HStack(spacing: 10) {
            Text(r.menuItemName).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            ncoNum(NCoFmt.signedYen(r.costDelta), color: r.costDelta > 0 ? NFColor.danger : NFColor.ink).frame(width: 110, alignment: .trailing)
            ncoNum(NCoFmt.yen(r.newCost)).frame(width: 100, alignment: .trailing)
            ncoNum("\(NCoFmt.pct(r.oldCostRate)) → \(NCoFmt.pct(r.newCostRate))", color: worse ? NFColor.danger : NFColor.ink, bold: worse)
                .frame(width: 200, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    // MARK: 廃棄・在庫差異

    @ViewBuilder private func wasteTab(_ p: NCoWastePayload) -> some View {
        HStack(spacing: 8) {
            ForEach(p.periods, id: \.label) { period in
                Button { model.setRange(from: period.from, to: period.to) } label: {
                    periodChip(period.label, on: period.from == p.from && period.to == p.to)
                }
                .buttonStyle(PressableStyle())
            }
            Spacer(minLength: 12)
            NPPeriod(from: $model.customFrom, to: $model.customTo)
            NSPButton(text: "適用") { model.applyCustomRange() }
        }
        HStack(spacing: 12) {
            NCoStat(label: "合計廃棄額", value: NCoFmt.yen(p.totalWasteAmount), tone: "danger", sub: "\(p.from) 〜 \(p.to)")
            NCoStat(label: "廃棄品目数", value: "\(p.wasteRows.count)件")
            NCoStat(label: "直近の棚卸", value: p.latestCountDate ?? "未実施")
        }
        wasteTable(p)
        diffTable(p)
    }

    private func periodChip(_ label: String, on: Bool) -> some View {
        Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
            .padding(.horizontal, 16).frame(height: 38)
            .background(Capsule().fill(on ? NFColor.iris : Color.white))
            .overlay(Capsule().stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
    }

    private func wasteTable(_ p: NCoWastePayload) -> some View {
        NSPCard(title: "廃棄一覧") {
            if p.wasteRows.isEmpty {
                NCoEmpty(title: "この期間の廃棄記録はありません")
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        ncoTh("品目").frame(width: 200, alignment: .leading)
                        ncoTh("廃棄数量").frame(width: 110, alignment: .trailing)
                        ncoTh("廃棄額").frame(width: 110, alignment: .trailing)
                        ncoTh("理由内訳").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(NFColor.lilacSoft)
                    ForEach(p.wasteRows) { r in
                        wasteRow(r)
                        NCoDivider()
                    }
                }
            }
        }
    }

    private func wasteRow(_ r: NCoWasteRow) -> some View {
        HStack(spacing: 10) {
            Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                .frame(width: 200, alignment: .leading)
            ncoNum(NCoFmt.num(r.quantity) + r.unit).frame(width: 110, alignment: .trailing)
            ncoNum(NCoFmt.yen(r.amount)).frame(width: 110, alignment: .trailing)
            Text(r.reasonSummary).font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    private func diffTable(_ p: NCoWastePayload) -> some View {
        NSPCard(title: "在庫差異（直近の棚卸）", note: "理論在庫はレシピ・販売・入出庫から自動計算された値です。実在庫との差異は棚卸で確定します。") {
            if p.latestCountDate == nil {
                NCoEmpty(title: "確定済みの棚卸がありません", message: "在庫から棚卸を実施すると差異が表示されます")
            } else if p.diffRows.isEmpty {
                NCoEmpty(title: "差異のあった品目はありません")
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        ncoTh("品目").frame(maxWidth: .infinity, alignment: .leading)
                        ncoTh("理論在庫").frame(width: 110, alignment: .trailing)
                        ncoTh("実在庫").frame(width: 110, alignment: .trailing)
                        ncoTh("差異").frame(width: 100, alignment: .trailing)
                        ncoTh("差異金額").frame(width: 110, alignment: .trailing)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(NFColor.lilacSoft)
                    ForEach(p.diffRows) { r in
                        diffRow(r)
                        NCoDivider()
                    }
                }
            }
        }
    }

    private func diffRow(_ r: NCoDiffRow) -> some View {
        let amountColor: Color = (r.diffAmount ?? 0) < 0 ? NFColor.danger : NFColor.ink
        return HStack(spacing: 10) {
            Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            ncoNum(r.expected.map { NCoFmt.num($0) + r.unit } ?? "—").frame(width: 110, alignment: .trailing)
            ncoNum(r.counted.map { NCoFmt.num($0) + r.unit } ?? "—").frame(width: 110, alignment: .trailing)
            ncoNum(NCoFmt.signedNum(r.diff) + r.unit, color: r.diff < 0 ? NFColor.danger : NFColor.ink).frame(width: 100, alignment: .trailing)
            ncoNum(NCoFmt.yen(r.diffAmount), color: amountColor).frame(width: 110, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }
}

// MARK: - レシピ編集（/app/costing/<menuItemId>）

@MainActor
final class NCoItemModel: ObservableObject {
    let menuItemId: String
    @Published var payload: NCoItemPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    init(menuItemId: String) {
        self.menuItemId = menuItemId
    }

    private var query: [String: String] { ["id": menuItemId] }

    func load() async {
        if payload == nil, let saved = NativeModuleAPI.cached(NCoItemPayload.self, part: "costingItem", query: query) { payload = saved }
        do {
            payload = try await NativeModuleAPI.get(NCoItemPayload.self, part: "costingItem", query: query)
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    /// 食材の追加・編集（Web の addRecipeLine・updateRecipeLine）。失敗はサーバーのことばを返す
    func save(line: NCoLine?, inventoryItemId: String, quantity: Double, note: String) async -> String? {
        var body: [String: Any] = [
            "type": line == nil ? "costingLineAdd" : "costingLineUpdate",
            "menuItemId": menuItemId,
            "inventoryItemId": inventoryItemId,
            "quantity": quantity,
            "note": note,
        ]
        if let line { body["lineId"] = line.id }
        busy = true
        defer { busy = false }
        do {
            try await NativeModuleAPI.post(body)
            toast = line == nil ? "食材を追加しました" : "レシピを更新しました"
            await load()
            return nil
        } catch {
            return NativeModuleAPI.message(error)
        }
    }

    /// 食材の削除（Web の deleteRecipeLine）
    func delete(_ line: NCoLine) async {
        busy = true
        defer { busy = false }
        do {
            try await NativeModuleAPI.post(["type": "costingLineDelete", "lineId": line.id, "menuItemId": menuItemId])
            toast = "食材を削除しました"
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
    }
}

/// 食材の追加（line なし）・編集（line あり）のシート
struct NCoEditorTarget: Identifiable {
    let id: String
    let line: NCoLine?
}

struct NCoItemScreen: View {
    @StateObject private var model: NCoItemModel
    let onBack: () -> Void
    @State private var editor: NCoEditorTarget?
    @State private var confirmDelete: NCoLine?

    private static let recipeExample = "例：唐揚げ定食＝鶏肉200g／油20ml／キャベツ80g／米200g のように、使用する食材と使用量を登録してください"

    init(menuItemId: String, onBack: @escaping () -> Void) {
        _model = StateObject(wrappedValue: NCoItemModel(menuItemId: menuItemId))
        self.onBack = onBack
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: model.payload?.item.name ?? "レシピ編集", subtitle: "", onHome: onBack, backIcon: "chevron.left")
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) { detail(p) }
                        .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 32)
                        .frame(maxWidth: 1100, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
                .refreshable { await model.load() }
            } else {
                NCoLoading(error: model.error, retry: { await model.load() })
            }
        }
        .background(NT.page.ignoresSafeArea())
        .modifier(NCoToast(toast: $model.toast))
        .task { await model.load() }
        .sheet(item: $editor) { t in
            if let p = model.payload {
                NCoLineEditor(model: model, payload: p, line: t.line, close: { editor = nil })
            }
        }
        .alert("食材を削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) {
                if let l = confirmDelete { Task { await model.delete(l) } }
                confirmDelete = nil
            }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: {
            Text("「\(confirmDelete?.ingredientName ?? "")」をレシピから削除します。")
        }
    }

    @ViewBuilder private func detail(_ p: NCoItemPayload) -> some View {
        Text("\(p.item.itemTypeLabel)｜売価 \(NCoFmt.yen(p.item.price))").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink3)
        HStack(spacing: 12) {
            NCoStat(label: "売価", value: NCoFmt.yen(p.item.price))
            NCoStat(label: "現在のレシピ原価", value: p.displayCost.map { NCoFmt.yen($0) } ?? "—", tone: "primary")
            NCoStat(label: "原価率", value: NCoFmt.pct(p.costRate), tone: p.rateTone == "gray" ? "default" : p.rateTone)
            NCoStat(label: "粗利益", value: p.grossProfit.map { NCoFmt.yen($0) } ?? "—", sub: p.grossProfitRate.map { "粗利率 \(NCoFmt.num($0))%" })
        }
        notices(p)
        recipeCard(p)
    }

    @ViewBuilder private func notices(_ p: NCoItemPayload) -> some View {
        if !p.lines.isEmpty, let manual = p.item.manualCost {
            notice("レシピ原価が優先して表示されています。手入力原価: \(NCoFmt.yen(manual))", tone: "primary")
        }
        if p.missingCostCount > 0 {
            notice("原価未設定の食材が\(p.missingCostCount)件あります。該当の食材原価はレシピ原価の計算に含まれていません。", tone: "warning")
        }
        notice("この商品を販売すると構成食材の理論在庫が自動で減算されます。", tone: "gray")
    }

    private func notice(_ text: String, tone: String) -> some View {
        Text(text).font(.system(size: 13, weight: .medium)).foregroundColor(tone == "gray" ? NFColor.ink2 : NCoTone.fg(tone))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NCoTone.bg(tone)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(tone == "gray" ? NFColor.line : NCoTone.fg(tone).opacity(0.3), lineWidth: 1))
    }

    private func recipeCard(_ p: NCoItemPayload) -> some View {
        NSPCard(title: "レシピ明細") {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Spacer()
                    NSPButton(text: "食材を追加", icon: "plus", primary: true, disabled: model.busy) { editor = NCoEditorTarget(id: "new", line: nil) }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                if p.lines.isEmpty {
                    NCoEmpty(title: "レシピが設定されていません", message: NCoItemScreen.recipeExample)
                } else {
                    linesHeader
                    ForEach(p.lines) { l in
                        lineRow(l)
                        NCoDivider()
                    }
                }
            }
        }
    }

    private var linesHeader: some View {
        HStack(spacing: 10) {
            ncoTh("食材").frame(maxWidth: .infinity, alignment: .leading)
            ncoTh("使用量").frame(width: 80, alignment: .trailing)
            ncoTh("単位").frame(width: 48, alignment: .leading)
            ncoTh("単価").frame(width: 90, alignment: .trailing)
            ncoTh("行原価").frame(width: 90, alignment: .trailing)
            ncoTh("メモ").frame(width: 170, alignment: .leading)
            ncoTh("操作").frame(width: 96, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(NFColor.lilacSoft)
    }

    private func lineRow(_ l: NCoLine) -> some View {
        HStack(spacing: 10) {
            Text(l.ingredientName).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            ncoNum(NCoFmt.num(l.quantity)).frame(width: 80, alignment: .trailing)
            Text(l.unit).font(.system(size: 14)).foregroundColor(NFColor.ink2).lineLimit(1).frame(width: 48, alignment: .leading)
            ncoNum(l.avgCost.map { NCoFmt.yen($0) } ?? "原価未設定", color: l.avgCost == nil ? NFColor.saffron : NFColor.ink).frame(width: 90, alignment: .trailing)
            ncoNum(l.lineCost.map { NCoFmt.yen($0) } ?? "—").frame(width: 90, alignment: .trailing)
            Text(l.note ?? "").font(.system(size: 12.5)).foregroundColor(NFColor.ink3).lineLimit(1).frame(width: 170, alignment: .leading)
            HStack(spacing: 6) {
                Button { editor = NCoEditorTarget(id: l.id, line: l) } label: { iconBox("pencil", color: NFColor.ink2) }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("行を編集")
                Button { confirmDelete = l } label: { iconBox("trash", color: NFColor.danger) }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("削除")
            }
            .disabled(model.busy)
            .frame(width: 96, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
    }

    private func iconBox(_ icon: String, color: Color) -> some View {
        Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(color)
            .frame(width: 42, height: 38)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}

/// 食材の追加・編集（Web の RecipeLineForm と同じ項目：食材・使用量・メモ）。入力中にこの食材の原価とレシピ原価・原価率を出す
struct NCoLineEditor: View {
    @ObservedObject var model: NCoItemModel
    let payload: NCoItemPayload
    let line: NCoLine?
    let close: () -> Void
    @State private var selected: String?
    @State private var quantity: String
    @State private var note: String
    @State private var search = ""
    @State private var error: String?
    @State private var saving = false

    init(model: NCoItemModel, payload: NCoItemPayload, line: NCoLine?, close: @escaping () -> Void) {
        _model = ObservedObject(wrappedValue: model)
        self.payload = payload
        self.line = line
        self.close = close
        _selected = State(initialValue: line?.inventoryItemId)
        _quantity = State(initialValue: line.map { NCoFmt.num($0.quantity) } ?? "")
        _note = State(initialValue: line?.note ?? "")
    }

    /// 選べる食材（編集中の行の食材が選択肢に無いとき＝ほかの店の品目は、その行の食材を先頭に足す）
    private var options: [NCoOption] {
        var list = payload.ingredientOptions
        if let l = line, !list.contains(where: { $0.id == l.inventoryItemId }) {
            list.insert(NCoOption(id: l.inventoryItemId, name: l.ingredientName, unit: l.unit, avgCost: l.avgCost), at: 0)
        }
        return list
    }

    /// すでにレシピにある食材（同じ食材は 2 回入れられない。編集中の行のものは選べる）
    private var taken: Set<String> {
        var s = Set(payload.lines.map(\.inventoryItemId))
        if let l = line { s.remove(l.inventoryItemId) }
        return s
    }

    private var filtered: [NCoOption] {
        let t = search.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return options }
        return options.filter { $0.name.localizedCaseInsensitiveContains(t) }
    }

    private var selectedOption: NCoOption? {
        guard let id = selected else { return nil }
        return options.first { $0.id == id }
    }

    /// 使用量（DB は小数3桁まで）
    private var qty: Double? {
        guard let q = NCoFmt.parse(quantity), q.isFinite else { return nil }
        return (q * 1000).rounded() / 1000
    }

    private var preview: NCoPreview {
        var added: (quantity: Double, avgCost: Double?)? = nil
        if let o = selectedOption, let q = qty, q > 0 { added = (quantity: q, avgCost: o.avgCost) }
        return NCoMath.preview(lines: payload.lines, replacing: line?.id, added: added, price: payload.item.price, manualCost: payload.item.manualCost)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(line == nil ? "食材を追加" : "食材を編集").font(.system(size: 19, weight: NT.strong)).foregroundColor(NFColor.ink)
                Spacer()
                Button { close() } label: {
                    Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2)
                        .frame(width: 40, height: 40)
                }
                .disabled(saving)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            NCoDivider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ingredientPicker
                    quantityField
                    noteField
                    previewBox
                    if let e = error {
                        Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            NCoDivider()
            HStack(spacing: 10) {
                Spacer()
                NSPButton(text: "キャンセル", disabled: saving) { close() }
                NSPButton(text: saving ? "保存中…" : (line == nil ? "追加する" : "更新する"), primary: true, busy: saving) { submit() }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .background(Color.white.ignoresSafeArea())
        .interactiveDismissDisabled(saving)
    }

    private func label(_ t: String) -> some View {
        Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
    }

    private var ingredientPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                label("食材")
                if let o = selectedOption {
                    Text(o.name).font(.system(size: 14, weight: NT.strong)).foregroundColor(NFColor.iris).lineLimit(1)
                } else {
                    Text("選択してください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                }
            }
            NCoSearchField(text: $search, placeholder: "食材の名前で探す", onSubmit: {})
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filtered) { o in
                        optionRow(o)
                        NCoDivider()
                    }
                    if filtered.isEmpty { NCoEmpty(title: options.isEmpty ? "食材が登録されていません" : "見つかりません", message: options.isEmpty ? "在庫で品目を登録してください" : nil) }
                }
            }
            .frame(height: 240)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func optionRow(_ o: NCoOption) -> some View {
        let isOn = selected == o.id
        let isTaken = taken.contains(o.id)
        return Button {
            selected = o.id
            error = nil
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isOn ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 18)).foregroundColor(isOn ? NFColor.iris : NFColor.ink3)
                Text(o.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                Text("（\(o.unit)／\(o.avgCost.map { NCoFmt.yen($0) } ?? "原価未設定")）").font(.system(size: 13)).foregroundColor(NFColor.ink3).lineLimit(1)
                Spacer(minLength: 4)
                if isTaken { NCoBadge(text: "レシピにあり", tone: "gray", small: true) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(isOn ? NFColor.irisSoft : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isTaken)
        .opacity(isTaken ? 0.5 : 1)
    }

    private var quantityField: some View {
        VStack(alignment: .leading, spacing: 8) {
            label("使用量（1商品あたり・品目の単位で入力）")
            HStack(spacing: 8) {
                TextField("例：鶏肉なら 200", text: $quantity)
                    .font(.system(size: 18, weight: .semibold)).monospacedDigit()
                    .keyboardType(.decimalPad)
                if let o = selectedOption {
                    Text(o.unit).font(.system(size: 15, weight: .medium)).foregroundColor(NFColor.ink3)
                }
            }
            .padding(.horizontal, 13).frame(height: 48).frame(maxWidth: 320)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private var noteField: some View {
        VStack(alignment: .leading, spacing: 8) {
            label("メモ")
            TextField("例：下味込みの使用量", text: $note, axis: .vertical)
                .lineLimit(2...4)
                .font(.system(size: 15))
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
    }

    /// その場の計算（保存したあとの数字。Web の計算と同じ）
    private var previewBox: some View {
        let pv = preview
        let afterTone = NCoMath.tone(pv.rate)
        return VStack(alignment: .leading, spacing: 8) {
            label("保存すると")
            previewLine("この食材の原価", value: lineCostText(pv))
            previewLine("レシピ原価", value: "\(NCoFmt.yen(payload.displayCost)) → \(NCoFmt.yen(pv.displayCost))")
            previewLine("原価率", value: "\(NCoFmt.pct(payload.costRate)) → \(NCoFmt.pct(pv.rate))", color: afterTone == "gray" ? NFColor.ink : NCoTone.fg(afterTone))
            previewLine("粗利益", value: pv.profit.map { "\(NCoFmt.yen($0))（粗利率 \(NCoFmt.pct(pv.profitRate))）" } ?? "—")
            if pv.missing > 0 {
                Text("原価未設定の食材が\(pv.missing)件あります（レシピ原価に含まれません）").font(.system(size: 12.5)).foregroundColor(NFColor.saffron)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func lineCostText(_ pv: NCoPreview) -> String {
        guard let o = selectedOption else { return "—" }
        guard let q = qty, q > 0 else { return "—" }
        guard let a = o.avgCost, let c = pv.lineCost else { return "原価未設定" }
        return "\(NCoFmt.yen(c))（\(NCoFmt.num(q))\(o.unit) × \(NCoFmt.yen(a))）"
    }

    private func previewLine(_ title: String, value: String, color: Color = NFColor.ink) -> some View {
        HStack(spacing: 10) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.ink3).frame(width: 110, alignment: .leading)
            Text(value).font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }

    /// Web のフォームと同じ確認・同じことば
    private func submit() {
        error = nil
        guard let id = selected, !id.isEmpty else {
            error = "食材を選択してください"
            return
        }
        guard let q = NCoFmt.parse(quantity), q.isFinite, q > 0 else {
            error = "使用量は0より大きい値で入力してください"
            return
        }
        saving = true
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            let failure = await model.save(line: line, inventoryItemId: id, quantity: q, note: text)
            saving = false
            if let failure { error = failure } else { close() }
        }
    }
}
