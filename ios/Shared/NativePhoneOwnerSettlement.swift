import SwiftUI

// iPhone の店長・オーナー：月次清算（ネイティブ）。Web の /app/settlement と同じ中身・同じ操作（2026-10-25 Ronnie「101% native」）:
//   月の切り替え（前の月・次の月・今月へ）
//   全店舗（本部）… 今週・今月の損益・売上・費用／店ごとのカード（開く＝Web と同じ店舗の切り替え）・合計
//   1店舗     … 今週・今月の損益（内訳）・売上・仕入経費／日ごとの売上と仕入（仕入先ごと・TOTAL・売上比。横にスクロール）／
//                家賃・電気・水道・給料・その他（スキャン済みの請求書を「入れる」・保存は本部だけ）／仕入先の請求書（→ 請求書・書類）
// レジ端末のアカウントには出さない（サーバーが「パソコンで」と返す。Web と同じ）。
// サーバーは iPad と同じ GET part=settlement&month= ／ POST settlementCostsSave・switchStore（返事の形は変えない）。

// MARK: - 中身（サーバーの返事）

struct NPSMCard: Decodable, Hashable {
    let label: String
    let value: Double
    let sub: String
    let plain: Bool
    let detail: String?
}

struct NPSMPL: Decodable, Hashable {
    let sales: Double
    let purchases: Double
    let expenses: Double
    let fixed: Double
    let salary: Double
    let profit: Double
}

struct NPSMStoreRow: Decodable, Identifiable {
    let storeId: String
    let storeName: String
    let month: NPSMPL
    let weekProfit: Double
    var id: String { storeId }
}

struct NPSMTotals: Decodable {
    let month: NPSMPL
    let weekProfit: Double
}

struct NPSMDay: Decodable, Identifiable {
    let date: String
    let label: String
    let sales: Double
    let byVendor: [Double]
    let expenses: Double
    let outgo: Double
    var id: String { date }
}

struct NPSMTableTotals: Decodable {
    let sales: Double
    let byVendor: [Double]
    let expenses: Double
    let outgo: Double
}

struct NPSMTable: Decodable {
    let vendors: [String]
    let rows: [NPSMDay]
    let totals: NPSMTableTotals
    let vendorShare: [Double?]
    let expensesShare: Double?
    let outgoShare: Double?
}

struct NPSMOther: Decodable, Hashable {
    let name: String
    let amount: Double
}

struct NPSMCosts: Decodable {
    let rent: Double
    let electric: Double
    let water: Double
    let salary: Double
    let other: [NPSMOther]
}

struct NPSMKind: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct NPSMScanned: Decodable, Identifiable {
    let documentId: String
    let category: String
    let label: String
    let amount: Double
    let dateLabel: String?
    var id: String { documentId }
}

struct NPSMInvoice: Decodable, Identifiable {
    let id: String
    let dateLabel: String
    let vendor: String
    let invoiceNo: String?
    let amount: Double
    let dueLabel: String?
    let status: String
    let statusLabel: String
}

struct NPSMPayload: Decodable {
    /// empty（レジ端末・店舗なし）／all（全店舗）／store（1店舗）
    let kind: String
    let month: String
    let prevMonth: String
    let nextMonth: String
    let isCurrentMonth: Bool
    let title: String?
    let message: String?
    let monthLabel: String?
    let description: String?
    let cards: [NPSMCard]?
    let rows: [NPSMStoreRow]?
    let totals: NPSMTotals?
    let note: String?
    let storeId: String?
    let storeName: String?
    let canEdit: Bool?
    let table: NPSMTable?
    let costs: NPSMCosts?
    let costKinds: [NPSMKind]?
    let maxOther: Int?
    let scanned: [NPSMScanned]?
    let invoices: [NPSMInvoice]?
}

enum NPSMText {
    static func yen(_ v: Double) -> String { NT.yen(Int(v.rounded())) }
    /// 表の中：0 は空
    static func cell(_ v: Double) -> String { v == 0 ? "" : yen(v) }
    static func share(_ v: Double?) -> String {
        guard let v else { return "—" }
        if v == v.rounded() { return "\(Int(v))%" }
        return String(format: "%.2f", v).replacingOccurrences(of: "\\.?0+$", with: "", options: .regularExpression) + "%"
    }
}

// MARK: - 読み込み

@MainActor
final class NPSMModel: ObservableObject {
    @Published var payload: NPSMPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var loading = false
    /// 最初の読み込みで「Web で」と言われた → この画面を閉じて裏の Web を見せる
    @Published var useWeb = false
    /// '' は今月（Web の ?month= が無いとき）
    @Published var month = ""

    var query: [String: String] { month.isEmpty ? [:] : ["month": month] }

    init(route: NativeModuleRoute? = nil) {
        month = route?.query("month") ?? ""
        payload = NativeModuleAPI.cached(NPSMPayload.self, part: "settlement", query: query)
    }

    func load() async {
        let q = query
        if NativePreview.current != nil {
            if let o = NPACSamples.object("settlement", q), let p = NOS.decode(NPSMPayload.self, o) { payload = p }
            return
        }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NPSMPayload.self, part: "settlement", query: q)
            if q == query { payload = p }
            error = nil
        } catch {
            if payload == nil && NPACText.wantsWeb(error) { useWeb = true }
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func go(_ m: String) async {
        month = m
        if let c = NativeModuleAPI.cached(NPSMPayload.self, part: "settlement", query: query) { payload = c }
        await load()
    }

    /// 店を開く（Web の OpenStoreButton と同じ：店舗を切り替えて読み直す）
    func openStore(_ id: String) async {
        if NativePreview.current != nil { toast = "見本では店舗を切り替えません"; return }
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(["type": "switchStore", "storeId": id])
            if !r.ok { toast = r.error ?? "切り替えられませんでした"; return }
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 画面

/// key "settlement" の画面（NativePhoneOwnerScreen から）
struct NativePhoneSettlementScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @State private var useWeb = false

    var body: some View {
        NPSMRootView(route: route, onBack: { state.closePhoneOwnerModule() }, onLeave: { NPOCLink.open($0, state: state) }, onWeb: { useWeb = true })
            .modifier(NPOCWebFallback(key: "settlement", useWeb: useWeb, state: state))
    }
}

struct NPSMRootView: View {
    let onBack: () -> Void
    /// ほかの画面（請求書・書類）へ。ネイティブがあればネイティブで開く
    let onLeave: (String) -> Void
    let onWeb: () -> Void

    @StateObject private var model: NPSMModel

    init(route: NativeModuleRoute, onBack: @escaping () -> Void, onLeave: @escaping (String) -> Void, onWeb: @escaping () -> Void = {}) {
        self.onBack = onBack
        self.onLeave = onLeave
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NPSMModel(route: route))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "月次清算", subtitle: model.payload?.storeName ?? "Monthly P&L", onBack: onBack, trailing: {
                NOMRefreshButton(loading: model.loading || model.busy) { Task { await model.load() } }
            }) {
                if let p = model.payload {
                    content(p)
                } else {
                    NOSStateView(error: model.error) { Task { await model.load() } }
                }
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .task { await model.load() }
        .onChange(of: model.useWeb) { on in if on { onWeb() } }
    }

    private func content(_ p: NPSMPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if p.kind == "all" || p.kind == "store" {
                    monthBar(p)
                    if let d = p.description {
                        Text(d).font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
                    }
                }
                switch p.kind {
                case "all": allBody(p)
                case "store": storeBody(p)
                default:
                    // レジ端末・店舗なし（Web と同じく中身は出さない）
                    NPOCEmpty(icon: "desktopcomputer", title: p.title ?? "", note: p.message ?? "")
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 60)
        }
        .refreshable { await model.load() }
    }

    private func monthBar(_ p: NPSMPayload) -> some View {
        VStack(spacing: 6) {
            NOSStepper(title: p.monthLabel ?? NOS.ymLabel(p.month), caption: p.isCurrentMonth ? "今月" : "",
                       onPrev: { Task { await model.go(p.prevMonth) } },
                       onNext: { Task { await model.go(p.nextMonth) } })
            if !p.isCurrentMonth {
                NPACPill(title: "今月へ戻る", icon: "arrow.uturn.backward") { Task { await model.go("") } }
            }
        }
    }

    private func cards(_ list: [NPSMCard]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8, alignment: .top), GridItem(.flexible(), spacing: 8, alignment: .top)], spacing: 8) {
            ForEach(list, id: \.self) { c in NPSMPlCard(card: c) }
        }
    }

    // MARK: 全店舗

    @ViewBuilder private func allBody(_ p: NPSMPayload) -> some View {
        cards(p.cards ?? [])
        NPOCSectionTitle(title: "店舗ごと", note: "「開く」で店舗を切り替えて、日ごとの表と固定費・給料の入力を出します。")
        ForEach(p.rows ?? []) { r in storeCard(r, monthLabel: p.monthLabel ?? "") }
        if let t = p.totals {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("合計").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                    Spacer()
                    NPSMProfit(value: t.month.profit)
                }
                plLines(t.month)
                HStack {
                    Text("今週の損益").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                    Spacer()
                    NPSMProfit(value: t.weekProfit, small: true)
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
        }
        if let note = p.note {
            Text(note).font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
        }
    }

    private func plLines(_ m: NPSMPL) -> some View {
        VStack(spacing: 2) {
            NPZInfoRow(label: "売上", value: NPSMText.yen(m.sales))
            NPZInfoRow(label: "仕入（請求書）", value: NPSMText.yen(m.purchases))
            NPZInfoRow(label: "経費", value: NPSMText.yen(m.expenses))
            NPZInfoRow(label: "家賃・電気・水道", value: NPSMText.yen(m.fixed))
            NPZInfoRow(label: "給料", value: NPSMText.yen(m.salary))
        }
    }

    private func storeCard(_ r: NPSMStoreRow, monthLabel: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(r.storeName).font(.system(size: 15.5, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                NPACPill(title: "開く", icon: "chevron.right", enabled: !model.busy) { Task { await model.openStore(r.storeId) } }
            }
            HStack {
                Text("\(monthLabel)の損益").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                Spacer()
                NPSMProfit(value: r.month.profit)
            }
            plLines(r.month)
            HStack {
                Text("今週の損益").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                Spacer()
                NPSMProfit(value: r.weekProfit, small: true)
            }
        }
        .padding(14)
        .background(npocCard())
    }

    // MARK: 1店舗

    @ViewBuilder private func storeBody(_ p: NPSMPayload) -> some View {
        cards(p.cards ?? [])
        if let t = p.table { dailyCard(t) }
        if let costs = p.costs, let storeId = p.storeId {
            NPOCard(title: "家賃・電気・水道・給料", trailing: p.monthLabel ?? "") {
                NPSMCostsForm(
                    storeId: storeId,
                    storeName: p.storeName ?? "",
                    month: p.month,
                    initial: costs,
                    canEdit: p.canEdit ?? false,
                    kinds: p.costKinds ?? [],
                    maxOther: p.maxOther ?? 20,
                    scanned: p.scanned ?? [],
                    onSaved: { msg in
                        model.toast = msg
                        Task { await model.load() }
                    }
                )
                .id("\(storeId):\(p.month)")
            }
        }
        invoicesCard(p)
    }

    private func dailyCard(_ t: NPSMTable) -> some View {
        NPOCard(title: "日ごとの売上と仕入", trailing: "横にスクロール") {
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    dayRow(label: "日付", sales: "売上", vendors: t.vendors, expenses: "経費", outgo: "仕入・経費 計", style: .head)
                    ForEach(t.rows) { r in
                        dayRow(label: r.label, sales: NPSMText.cell(r.sales), vendors: r.byVendor.map { NPSMText.cell($0) },
                               expenses: NPSMText.cell(r.expenses), outgo: NPSMText.cell(r.outgo),
                               style: r.sales == 0 && r.outgo == 0 ? .muted : .normal)
                    }
                    dayRow(label: "TOTAL", sales: NPSMText.yen(t.totals.sales), vendors: t.totals.byVendor.map { NPSMText.yen($0) },
                           expenses: NPSMText.yen(t.totals.expenses), outgo: NPSMText.yen(t.totals.outgo), style: .total)
                    dayRow(label: "売上比", sales: "100%", vendors: t.vendorShare.map { NPSMText.share($0) },
                           expenses: NPSMText.share(t.expensesShare), outgo: NPSMText.share(t.outgoShare), style: .share)
                }
            }
            if t.vendors.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("この月の仕入先の請求書はまだありません。「請求書・書類」で仕入先の請求書を入れると、仕入先ごとの列が出ます。")
                        .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                    NPACPill(title: "請求書・書類へ", icon: "doc.text") { onLeave("/app/invoices") }
                }
            }
        }
    }

    private enum DayStyle { case head, normal, muted, total, share }

    private func dayRow(label: String, sales: String, vendors: [String], expenses: String, outgo: String, style: DayStyle) -> some View {
        let color: Color = style == .head || style == .share ? NT.ink3 : (style == .muted ? NT.ink3.opacity(0.7) : NT.ink)
        let bold = style == .head || style == .total
        let size: CGFloat = style == .head || style == .share ? 11 : 12.5
        return HStack(spacing: 8) {
            Text(label).font(.system(size: size, weight: .bold)).foregroundColor(style == .muted ? NT.ink3 : NT.ink).frame(width: 58, alignment: .leading)
            cell(sales, width: 84, bold: bold, color: color, size: size)
            ForEach(Array(vendors.enumerated()), id: \.offset) { item in
                cell(item.element, width: 92, bold: bold, color: color, size: size)
            }
            cell(expenses, width: 80, bold: bold, color: color, size: size)
            cell(outgo, width: 96, bold: true, color: color, size: size)
        }
        .lineLimit(1)
        .padding(.horizontal, 6).padding(.vertical, style == .head ? 7 : 6)
        .background(style == .head || style == .total || style == .share ? NT.page : Color.clear)
        .overlay(alignment: .bottom) { NPACDivider() }
    }

    private func cell(_ text: String, width: CGFloat, bold: Bool, color: Color, size: CGFloat) -> some View {
        Text(text).font(.system(size: size, weight: bold ? .bold : .regular)).monospacedDigit().foregroundColor(color)
            .minimumScaleFactor(0.7).frame(width: width, alignment: .trailing)
    }

    private func invoicesCard(_ p: NPSMPayload) -> some View {
        let list = p.invoices ?? []
        return NPOCard(title: "仕入先の請求書", trailing: "\(list.count)件") {
            if list.isEmpty {
                Text("この月の請求書はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                ForEach(list) { inv in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(inv.dateLabel).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                            Text(inv.vendor).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(NPSMText.yen(inv.amount)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                        }
                        HStack(spacing: 8) {
                            NOSBadge(text: inv.statusLabel, color: inv.status == "paid" ? NT.ok : NT.ink3)
                            if let n = inv.invoiceNo, !n.isEmpty { Text("No. \(n)").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                            Spacer(minLength: 0)
                            if let d = inv.dueLabel { Text("支払期日 \(d)").font(.system(size: 11)).foregroundColor(NT.ink3) }
                        }
                    }
                    .padding(.vertical, 4)
                    NPACDivider()
                }
            }
            NPACPill(title: "請求書の追加・支払の記録は「請求書・書類」", icon: "doc.text") { onLeave("/app/invoices") }
        }
    }
}

// MARK: - 部品

/// 損益のカード（plain は赤字黒字の色を付けない＝売上・費用）
struct NPSMPlCard: View {
    let card: NPSMCard

    var body: some View {
        let loss = card.value < 0
        let tone: Color = card.plain ? NT.ink : (loss ? NT.danger : NT.ok)
        return VStack(alignment: .leading, spacing: 4) {
            Text(card.label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8)
            HStack(spacing: 4) {
                if !card.plain { NOSBadge(text: loss ? "赤字" : "黒字", color: loss ? NT.danger : NT.ok) }
                Text(NPSMText.yen(card.value)).font(.system(size: 18, weight: NT.strong)).monospacedDigit().foregroundColor(tone)
                    .lineLimit(1).minimumScaleFactor(0.55)
            }
            Text(card.sub).font(.system(size: 10.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            if let d = card.detail {
                Text(d).font(.system(size: 10.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard(14))
    }
}

/// 損益（赤字・黒字の札＋金額）
struct NPSMProfit: View {
    let value: Double
    var small = false

    var body: some View {
        let loss = value < 0
        return HStack(spacing: 4) {
            NOSBadge(text: loss ? "赤字" : "黒字", color: loss ? NT.danger : NT.ok)
            Text(NPSMText.yen(value)).font(.system(size: small ? 13.5 : 16, weight: NT.strong)).monospacedDigit().foregroundColor(loss ? NT.danger : NT.ok)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

/// その他の1行（入力用）
struct NPSMOtherRow: Identifiable, Equatable {
    let id = UUID()
    var name: String
    var amount: String
}

/// 家賃・電気・水道・給料・その他の入力（Web の MonthlyCostsForm と同じ。保存は本部だけ）
struct NPSMCostsForm: View {
    let storeId: String
    let storeName: String
    let month: String
    let initial: NPSMCosts
    let canEdit: Bool
    let kinds: [NPSMKind]
    let maxOther: Int
    let scanned: [NPSMScanned]
    let onSaved: (String) -> Void

    @State private var values: [String: String]
    @State private var others: [NPSMOtherRow]
    /// 最後に保存した中身（「元に戻す」で戻す先。Web の saved）
    @State private var savedValues: [String: String]
    @State private var savedOthers: [NPSMOtherRow]
    @State private var saving = false
    @State private var error: String?

    init(storeId: String, storeName: String, month: String, initial: NPSMCosts, canEdit: Bool, kinds: [NPSMKind], maxOther: Int, scanned: [NPSMScanned], onSaved: @escaping (String) -> Void) {
        self.storeId = storeId
        self.storeName = storeName
        self.month = month
        self.initial = initial
        self.canEdit = canEdit
        self.kinds = kinds
        self.maxOther = maxOther
        self.scanned = scanned
        self.onSaved = onSaved
        let v: [String: String] = [
            "rent": Self.text(initial.rent),
            "electric": Self.text(initial.electric),
            "water": Self.text(initial.water),
            "salary": Self.text(initial.salary),
        ]
        let o = initial.other.map { NPSMOtherRow(name: $0.name, amount: Self.text($0.amount)) }
        _values = State(initialValue: v)
        _others = State(initialValue: o)
        _savedValues = State(initialValue: v)
        _savedOthers = State(initialValue: o)
    }

    /// 0 は空（Web の入力欄と同じ）
    static func text(_ v: Double) -> String { v == 0 ? "" : String(Int(v.rounded())) }

    static func yen(_ s: String) -> Int {
        let n = Int(s.trimmingCharacters(in: .whitespaces)) ?? 0
        return max(0, n)
    }

    /// 変更があるかを見るための形
    static func signature(_ v: [String: String], _ o: [NPSMOtherRow]) -> String {
        let k = ["rent", "electric", "water", "salary"].map { "\(yen(v[$0] ?? ""))" }.joined(separator: ",")
        let rest = o.map { "\($0.name)=\(yen($0.amount))" }.joined(separator: "|")
        return k + "#" + rest
    }

    private var dirty: Bool { Self.signature(values, others) != Self.signature(savedValues, savedOthers) }

    private var fixedTotal: Int {
        Self.yen(values["rent"] ?? "") + Self.yen(values["electric"] ?? "") + Self.yen(values["water"] ?? "") + others.reduce(0) { $0 + Self.yen($1.amount) }
    }

    private var salary: Int { Self.yen(values["salary"] ?? "") }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0.filter { "0123456789".contains($0) } })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !scanned.isEmpty { scannedBox }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 10) {
                ForEach(kinds) { k in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(k.label).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2)
                        HStack(spacing: 3) {
                            TextField("0", text: binding(k.key))
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .font(.system(size: 16, weight: .semibold)).monospacedDigit()
                                .disabled(!canEdit || saving)
                            Text("円").font(.system(size: 12)).foregroundColor(NT.ink3)
                        }
                        .padding(.horizontal, 10).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(canEdit ? Color.white : NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                }
            }
            otherBox
            footer
        }
    }

    private var scannedBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("レジで取り込んだ請求書（ScanSnap）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink)
            WrapLayout(spacing: 6) {
                ForEach(scanned) { b in
                    HStack(spacing: 6) {
                        Text(b.label).font(.system(size: 12, weight: .bold))
                        Text(NPSMText.yen(b.amount)).font(.system(size: 12)).monospacedDigit()
                        if let d = b.dateLabel { Text(d).font(.system(size: 11)).foregroundColor(NT.ink3) }
                        if canEdit {
                            if isApplied(b) {
                                Text("入力済み").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ok)
                            } else {
                                Button { apply(b) } label: {
                                    Text("入れる").font(.system(size: 11.5, weight: NT.strong)).foregroundColor(NT.purpleDeep).underline()
                                }
                                .buttonStyle(.plain)
                                .disabled(saving)
                            }
                        }
                    }
                    .foregroundColor(NT.ink)
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                }
            }
            if canEdit {
                Text("「入れる」で下の欄に入ります。確かめてから「保存」を押してください").font(.system(size: 10.5)).foregroundColor(NT.ink3)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }

    private var otherBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("その他（ガス・通信費・リースなど）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2)
            ForEach($others) { $o in
                HStack(spacing: 6) {
                    TextField("名前（例: ガス）", text: $o.name)
                        .font(.system(size: 15))
                        .disabled(!canEdit || saving)
                        .padding(.horizontal, 10).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(canEdit ? Color.white : NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    TextField("0", text: $o.amount)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .font(.system(size: 15)).monospacedDigit()
                        .disabled(!canEdit || saving)
                        .padding(.horizontal, 10).frame(width: 110, height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(canEdit ? Color.white : NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    if canEdit {
                        Button { others.removeAll { $0.id == o.id } } label: {
                            Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).frame(width: 32, height: 36)
                        }
                        .buttonStyle(.plain)
                        .disabled(saving)
                        .accessibilityLabel("消す")
                    }
                }
            }
            if canEdit && others.count < maxOther {
                NPACPill(title: "その他を追加", icon: "plus", enabled: !saving) { others.append(NPSMOtherRow(name: "", amount: "")) }
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            NPACDivider()
            HStack(alignment: .firstTextBaseline) {
                Text("月の合計").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(NT.yen(fixedTotal + salary)).font(.system(size: 18, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink)
            }
            Text("固定費 \(NT.yen(fixedTotal)) ＋ 給料 \(NT.yen(salary))").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            if canEdit {
                if dirty {
                    Text("保存していない変更があります").font(.system(size: 12, weight: .bold)).foregroundColor(NT.warn)
                }
                HStack(spacing: 8) {
                    NPOCWideButton(text: "元に戻す", kind: .secondary, disabled: !dirty || saving, height: 44) { reset() }
                    NPOCWideButton(text: saving ? "保存中…" : "この月を保存", kind: .primary, busy: saving, disabled: !dirty, height: 44) { save() }
                }
            } else {
                Text("入力は本部（契約企業オーナー・本社管理者・本社経理）のアカウントから").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            }
            if let error {
                NPACProblem(text: error)
            }
        }
    }

    // スキャン済みの請求書を欄に入れる（ガスは「その他」の行。同じ名前があれば金額を上書き。Web と同じ）
    private func apply(_ b: NPSMScanned) {
        let amount = String(Int(b.amount.rounded()))
        if b.category == "gas" {
            if let i = others.firstIndex(where: { $0.name.trimmingCharacters(in: .whitespaces) == "ガス" }) {
                others[i].amount = amount
            } else if others.count < maxOther {
                others.append(NPSMOtherRow(name: "ガス", amount: amount))
            }
        } else {
            values[b.category] = amount
        }
    }

    private func isApplied(_ b: NPSMScanned) -> Bool {
        let amount = Int(b.amount.rounded())
        if b.category == "gas" {
            return others.contains { $0.name.trimmingCharacters(in: .whitespaces) == "ガス" && Self.yen($0.amount) == amount }
        }
        return Self.yen(values[b.category] ?? "") == amount
    }

    private func reset() {
        values = savedValues
        others = savedOthers
    }

    private func save() {
        error = nil
        let other: [[String: Any]] = others.map { ["name": $0.name, "amount": Self.yen($0.amount)] }
        let costs: [String: Any] = [
            "rent": Self.yen(values["rent"] ?? ""),
            "electric": Self.yen(values["electric"] ?? ""),
            "water": Self.yen(values["water"] ?? ""),
            "salary": Self.yen(values["salary"] ?? ""),
            "other": other,
        ]
        saving = true
        Task {
            do {
                if NativePreview.current == nil {
                    try await NativeModuleAPI.post(["type": "settlementCostsSave", "storeId": storeId, "month": month, "costs": costs])
                }
                // 名前の無い「その他」は消える（Web と同じ）
                let cleaned = others.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
                others = cleaned
                savedValues = values
                savedOthers = cleaned
                saving = false
                onSaved("\(storeName) \(NOS.ymLabel(month)) の固定費・給料を保存しました")
            } catch {
                self.error = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}
