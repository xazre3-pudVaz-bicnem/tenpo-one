import SwiftUI

// 月次清算のネイティブ。Web の /app/settlement と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   月の切り替え（前の月・次の月・今月へ）
//   全店舗（本部）… 今週・今月の損益・売上・費用／店ごとの表（開く＝Web と同じ店舗の切り替え）
//   1店舗     … 今週・今月の損益（内訳）・売上・仕入経費／日ごとの売上と仕入（仕入先ごと・TOTAL・売上比）／
//                家賃・電気・水道・給料・その他（スキャン済みの請求書を「入れる」・保存は本部だけ）／仕入先の請求書
// Web と同じく、レジ端末のアカウントには出さない（サーバーが「パソコンで」と返す）。
// サーバーは lib/native-modules/settlement.ts（読み込みは Web と同じ lib/settlement-server.ts、保存は Web と同じ Server Action）。

// MARK: - 中身（サーバーの返事）

struct NSettleCard: Decodable, Hashable {
    let label: String
    let value: Double
    let sub: String
    let plain: Bool
    let detail: String?
}

struct NSettlePL: Decodable, Hashable {
    let sales: Double
    let purchases: Double
    let expenses: Double
    let fixed: Double
    let salary: Double
    let profit: Double
}

struct NSettleStoreRow: Decodable, Identifiable {
    let storeId: String
    let storeName: String
    let month: NSettlePL
    let weekProfit: Double
    var id: String { storeId }
}

struct NSettleTotals: Decodable {
    let month: NSettlePL
    let weekProfit: Double
}

struct NSettleDay: Decodable, Identifiable {
    let date: String
    let label: String
    let sales: Double
    let byVendor: [Double]
    let expenses: Double
    let outgo: Double
    var id: String { date }
}

struct NSettleTableTotals: Decodable {
    let sales: Double
    let byVendor: [Double]
    let expenses: Double
    let outgo: Double
}

struct NSettleTable: Decodable {
    let vendors: [String]
    let rows: [NSettleDay]
    let totals: NSettleTableTotals
    let vendorShare: [Double?]
    let expensesShare: Double?
    let outgoShare: Double?
}

struct NSettleOther: Decodable, Hashable {
    let name: String
    let amount: Double
}

struct NSettleCosts: Decodable {
    let rent: Double
    let electric: Double
    let water: Double
    let salary: Double
    let other: [NSettleOther]
}

struct NSettleKind: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct NSettleScanned: Decodable, Identifiable {
    let documentId: String
    let category: String
    let label: String
    let amount: Double
    let dateLabel: String?
    var id: String { documentId }
}

struct NSettleInvoice: Decodable, Identifiable {
    let id: String
    let dateLabel: String
    let vendor: String
    let invoiceNo: String?
    let amount: Double
    let dueLabel: String?
    let status: String
    let statusLabel: String
}

struct NSettlePayload: Decodable {
    let ok: Bool
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
    let cards: [NSettleCard]?
    let rows: [NSettleStoreRow]?
    let totals: NSettleTotals?
    let note: String?
    let storeId: String?
    let storeName: String?
    let canEdit: Bool?
    let table: NSettleTable?
    let costs: NSettleCosts?
    let costKinds: [NSettleKind]?
    let maxOther: Int?
    let scanned: [NSettleScanned]?
    let invoices: [NSettleInvoice]?
}

enum NSettleText {
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
final class NSettleModel: ObservableObject {
    @Published var payload: NSettlePayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    /// '' は今月（Web の ?month= が無いとき）
    @Published var month = ""

    var query: [String: String] { month.isEmpty ? [:] : ["month": month] }

    init(route: NativeModuleRoute) {
        apply(route: route)
    }

    func apply(route: NativeModuleRoute) {
        month = route.query("month") ?? ""
        payload = NativeModuleAPI.cached(NSettlePayload.self, part: "settlement", query: query)
    }

    func load() async {
        let q = query
        do {
            let p = try await NativeModuleAPI.get(NSettlePayload.self, part: "settlement", query: q)
            if q == query { payload = p }
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func go(_ m: String) async {
        month = m
        if let c = NativeModuleAPI.cached(NSettlePayload.self, part: "settlement", query: query) { payload = c }
        await load()
    }

    /// 店を開く（Web の OpenStoreButton と同じ：店舗を切り替えて読み直す）
    func openStore(_ id: String) async {
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

struct NativeSettlementView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    /// ほかの画面（請求書・書類）へ。ネイティブがあればネイティブで開く
    let onWeb: (String) -> Void

    @StateObject private var model: NSettleModel

    init(route: NativeModuleRoute, onHome: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.route = route
        self.onHome = onHome
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NSettleModel(route: route))
    }

    private var p: NSettlePayload? { model.payload }

    var body: some View {
        NPRPage(title: "月次清算", onBack: onHome, loaded: p != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p { pageBody(p) }
        }
        .task { await model.load() }
        .onChange(of: route) { r in
            model.apply(route: r)
            Task { await model.load() }
        }
    }

    @ViewBuilder private func pageBody(_ p: NSettlePayload) -> some View {
        switch p.kind {
        case "all":
            header(p)
            allBody(p)
        case "store":
            header(p)
            storeBody(p)
        default:
            // レジ端末・店舗なし（Web と同じく中身は出さない）
            NAccCard { NPREmpty(title: p.title ?? "", message: p.message) }
        }
    }

    private func header(_ p: NSettlePayload) -> some View {
        HStack(spacing: 12) {
            Text(p.description ?? "").font(.system(size: 13.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                navButton("chevron.left", label: "前の月") { Task { await model.go(p.prevMonth) } }
                Text(p.monthLabel ?? NInvText.monthLabel(p.month)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                    .frame(minWidth: 120)
                navButton("chevron.right", label: "次の月") { Task { await model.go(p.nextMonth) } }
                if !p.isCurrentMonth {
                    Button { Task { await model.go("") } } label: {
                        Text("今月へ").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple).underline()
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
    }

    private func navButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                .frame(width: 40, height: 38)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }

    private func cards(_ list: [NSettleCard]) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(list, id: \.self) { c in NSettlePlCard(card: c) }
        }
    }

    // MARK: 全店舗

    @ViewBuilder private func allBody(_ p: NSettlePayload) -> some View {
        cards(p.cards ?? [])
        NAccCard {
            NAccTableHead(cells: [("店舗", nil, false), ("売上", 100, true), ("仕入（請求書）", 100, true), ("経費", 90, true), ("家賃・電気・水道", 110, true), ("給料", 90, true), ("\(p.monthLabel ?? "")の損益", 140, true), ("今週の損益", 140, true), ("", 64, false)])
            ForEach(p.rows ?? []) { r in
                HStack(spacing: 10) {
                    NAccCell(text: r.storeName, bold: true)
                    NAccCell(text: NSettleText.yen(r.month.sales), width: 100, trailing: true)
                    NAccCell(text: NSettleText.yen(r.month.purchases), width: 100, trailing: true)
                    NAccCell(text: NSettleText.yen(r.month.expenses), width: 90, trailing: true)
                    NAccCell(text: NSettleText.yen(r.month.fixed), width: 110, trailing: true)
                    NAccCell(text: NSettleText.yen(r.month.salary), width: 90, trailing: true)
                    NSettleProfit(value: r.month.profit).frame(width: 140, alignment: .trailing)
                    NSettleProfit(value: r.weekProfit).frame(width: 140, alignment: .trailing)
                    Button { Task { await model.openStore(r.storeId) } } label: {
                        HStack(spacing: 2) {
                            Text("開く")
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                        }
                        .font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink)
                        .padding(.horizontal, 9).frame(height: 30)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.busy)
                    .frame(width: 64, alignment: .trailing)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
            }
            if let t = p.totals {
                HStack(spacing: 10) {
                    NAccCell(text: "合計", bold: true)
                    NAccCell(text: NSettleText.yen(t.month.sales), width: 100, trailing: true, bold: true)
                    NAccCell(text: NSettleText.yen(t.month.purchases), width: 100, trailing: true, bold: true)
                    NAccCell(text: NSettleText.yen(t.month.expenses), width: 90, trailing: true, bold: true)
                    NAccCell(text: NSettleText.yen(t.month.fixed), width: 110, trailing: true, bold: true)
                    NAccCell(text: NSettleText.yen(t.month.salary), width: 90, trailing: true, bold: true)
                    NSettleProfit(value: t.month.profit).frame(width: 140, alignment: .trailing)
                    NSettleProfit(value: t.weekProfit).frame(width: 140, alignment: .trailing)
                    Color.clear.frame(width: 64, height: 1)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(NT.page.opacity(0.7))
            }
        }
        if let note = p.note {
            Text(note).font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 1店舗

    @ViewBuilder private func storeBody(_ p: NSettlePayload) -> some View {
        cards(p.cards ?? [])
        if let t = p.table { dailyCard(t) }
        if let costs = p.costs, let storeId = p.storeId {
            NPRCard(title: "家賃・電気・水道・給料（\(p.monthLabel ?? "")）", trailing: { EmptyView() }) {
                NSettleCostsForm(
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
                .padding(16)
            }
        }
        invoicesCard(p)
    }

    private func dailyCard(_ t: NSettleTable) -> some View {
        NPRCard(title: "日ごとの売上と仕入（仕入先ごと）", trailing: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 0) {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        dayRow(label: "日付", sales: "売上", vendors: t.vendors, expenses: "経費", outgo: "仕入・経費 計", style: .head)
                        ForEach(t.rows) { r in
                            dayRow(
                                label: r.label,
                                sales: NSettleText.cell(r.sales),
                                vendors: r.byVendor.map { NSettleText.cell($0) },
                                expenses: NSettleText.cell(r.expenses),
                                outgo: NSettleText.cell(r.outgo),
                                style: r.sales == 0 && r.outgo == 0 ? .muted : .normal
                            )
                        }
                        dayRow(
                            label: "TOTAL",
                            sales: NSettleText.yen(t.totals.sales),
                            vendors: t.totals.byVendor.map { NSettleText.yen($0) },
                            expenses: NSettleText.yen(t.totals.expenses),
                            outgo: NSettleText.yen(t.totals.outgo),
                            style: .total
                        )
                        dayRow(
                            label: "売上比",
                            sales: "100%",
                            vendors: t.vendorShare.map { NSettleText.share($0) },
                            expenses: NSettleText.share(t.expensesShare),
                            outgo: NSettleText.share(t.outgoShare),
                            style: .share
                        )
                    }
                }
                if t.vendors.isEmpty {
                    HStack(spacing: 4) {
                        Text("この月の仕入先の請求書はまだありません。").font(.system(size: 12)).foregroundColor(NT.ink3)
                        Button { onWeb("/app/invoices") } label: {
                            Text("請求書・書類").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple).underline()
                        }
                        .buttonStyle(PressableStyle())
                        Text("で仕入先の請求書を入れると、仕入先ごとの列が出ます。").font(.system(size: 12)).foregroundColor(NT.ink3)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                }
            }
        }
    }

    private enum DayStyle { case head, normal, muted, total, share }

    private func dayRow(label: String, sales: String, vendors: [String], expenses: String, outgo: String, style: DayStyle) -> some View {
        let color: Color = style == .head || style == .share ? NT.ink3 : (style == .muted ? NT.ink3.opacity(0.7) : NT.ink)
        let bold = style == .head || style == .total
        let size: CGFloat = style == .head || style == .share ? 12 : 13.5
        return HStack(spacing: 10) {
            NAccCell(text: label, width: 70, bold: true, color: style == .muted ? NT.ink3 : NT.ink, size: size)
            NAccCell(text: sales, width: 100, trailing: true, bold: bold, color: color, size: size)
            ForEach(Array(vendors.enumerated()), id: \.offset) { item in
                NAccCell(text: item.element, width: 110, trailing: true, bold: bold, color: color, size: size)
            }
            NAccCell(text: expenses, width: 100, trailing: true, bold: bold, color: color, size: size)
            NAccCell(text: outgo, width: 120, trailing: true, bold: true, color: color, size: size)
        }
        .padding(.horizontal, 16).padding(.vertical, style == .head ? 8 : 7)
        .background(style == .head || style == .total || style == .share ? NT.page.opacity(0.7) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private func invoicesCard(_ p: NSettlePayload) -> some View {
        let list = p.invoices ?? []
        return NPRCard(title: "仕入先の請求書（\(p.monthLabel ?? "")・\(list.count)件）", trailing: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 0) {
                if list.isEmpty {
                    Text("この月の請求書はありません").font(.system(size: 14)).foregroundColor(NT.ink3)
                        .padding(.horizontal, 16).padding(.vertical, 14)
                } else {
                    NAccTableHead(cells: [("日付", 70, false), ("仕入先", nil, false), ("番号", 120, false), ("金額", 110, true), ("支払期日", 90, false), ("状態", 100, false)])
                    ForEach(list) { inv in
                        HStack(spacing: 10) {
                            NAccCell(text: inv.dateLabel, width: 70)
                            NAccCell(text: inv.vendor, bold: true)
                            NAccCell(text: inv.invoiceNo ?? "", width: 120, color: NT.ink3)
                            NAccCell(text: NSettleText.yen(inv.amount), width: 110, trailing: true)
                            NAccCell(text: inv.dueLabel ?? "", width: 90, color: NT.ink3)
                            NPBadge(text: inv.statusLabel, color: inv.status == "paid" ? NT.ok : NT.ink3).frame(width: 100, alignment: .leading)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                    }
                }
                HStack(spacing: 4) {
                    Text("請求書の追加・支払の記録は").font(.system(size: 12)).foregroundColor(NT.ink3)
                    Button { onWeb("/app/invoices") } label: {
                        Text("請求書・書類").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple).underline()
                    }
                    .buttonStyle(PressableStyle())
                    Text("から。").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
    }
}

// MARK: - 部品

/// 損益のカード（plain は赤字黒字の色を付けない＝売上・費用）
struct NSettlePlCard: View {
    let card: NSettleCard

    var body: some View {
        let loss = card.value < 0
        let tone: Color = card.plain ? NT.ink : (loss ? NT.danger : NT.ok)
        return VStack(alignment: .leading, spacing: 5) {
            Text(card.label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
            HStack(spacing: 6) {
                if !card.plain { NPBadge(text: loss ? "赤字" : "黒字", color: loss ? NT.danger : NT.ok) }
                Text(NSettleText.yen(card.value)).font(.system(size: 22, weight: NT.strong)).monospacedDigit().foregroundColor(tone)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            Text(card.sub).font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            if let d = card.detail {
                Text(d).font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

/// 表の損益（赤字・黒字の札＋金額）
struct NSettleProfit: View {
    let value: Double

    var body: some View {
        let loss = value < 0
        return HStack(spacing: 4) {
            NPBadge(text: loss ? "赤字" : "黒字", color: loss ? NT.danger : NT.ok)
            Text(NSettleText.yen(value)).font(.system(size: 13.5, weight: .bold)).monospacedDigit().foregroundColor(loss ? NT.danger : NT.ok)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

/// その他の1行（入力用）
struct NSettleOtherRow: Identifiable, Equatable {
    let id = UUID()
    var name: String
    var amount: String
}

/// 家賃・電気・水道・給料・その他の入力（Web の MonthlyCostsForm と同じ。保存は本部だけ）
struct NSettleCostsForm: View {
    let storeId: String
    let storeName: String
    let month: String
    let initial: NSettleCosts
    let canEdit: Bool
    let kinds: [NSettleKind]
    let maxOther: Int
    let scanned: [NSettleScanned]
    let onSaved: (String) -> Void

    @State private var values: [String: String]
    @State private var others: [NSettleOtherRow]
    /// 最後に保存した中身（「元に戻す」で戻す先。Web の saved）
    @State private var savedValues: [String: String]
    @State private var savedOthers: [NSettleOtherRow]
    @State private var saving = false
    @State private var error: String?

    init(storeId: String, storeName: String, month: String, initial: NSettleCosts, canEdit: Bool, kinds: [NSettleKind], maxOther: Int, scanned: [NSettleScanned], onSaved: @escaping (String) -> Void) {
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
        let o = initial.other.map { NSettleOtherRow(name: $0.name, amount: Self.text($0.amount)) }
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
    static func signature(_ v: [String: String], _ o: [NSettleOtherRow]) -> String {
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
        VStack(alignment: .leading, spacing: 14) {
            if !scanned.isEmpty { scannedBox }
            HStack(spacing: 12) {
                ForEach(kinds) { k in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(k.label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
                        TextField("0", text: binding(k.key))
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .font(.system(size: 16)).monospacedDigit()
                            .disabled(!canEdit || saving)
                            .padding(.horizontal, 12).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(canEdit ? Color.white : NT.page))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            otherBox
            footer
        }
    }

    private var scannedBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("レジで取り込んだ請求書（ScanSnap）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink)
            WrapLayout(spacing: 8) {
                ForEach(scanned) { b in
                    HStack(spacing: 8) {
                        Text(b.label).font(.system(size: 12.5, weight: .bold))
                        Text(NSettleText.yen(b.amount)).font(.system(size: 12.5)).monospacedDigit()
                        if let d = b.dateLabel { Text(d).font(.system(size: 12)).foregroundColor(NT.ink3) }
                        if canEdit {
                            if isApplied(b) {
                                Text("入力済み").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ok)
                            } else {
                                Button { apply(b) } label: {
                                    Text("入れる").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.royal).underline()
                                }
                                .buttonStyle(PressableStyle())
                                .disabled(saving)
                            }
                        }
                    }
                    .foregroundColor(NT.ink)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
            if canEdit {
                Text("「入れる」で下の欄に入ります。確かめてから「保存」を押してください").font(.system(size: 11)).foregroundColor(NT.ink3)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }

    private var otherBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("その他（ガス・通信費・リースなど）").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
            ForEach($others) { $o in
                HStack(spacing: 8) {
                    TextField("名前（例: ガス）", text: $o.name)
                        .disabled(!canEdit || saving)
                        .padding(.horizontal, 12).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(canEdit ? Color.white : NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    TextField("0", text: $o.amount)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                        .disabled(!canEdit || saving)
                        .padding(.horizontal, 12).frame(width: 150, height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(canEdit ? Color.white : NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    if canEdit {
                        Button { others.removeAll { $0.id == o.id } } label: {
                            Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink3)
                                .frame(width: 36, height: 36)
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(saving)
                        .accessibilityLabel("消す")
                    }
                }
            }
            if canEdit && others.count < maxOther {
                NPRButton(text: "その他を追加", icon: "plus", disabled: saving) { others.append(NSettleOtherRow(name: "", amount: "")) }
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(NT.line).frame(height: 1)
            HStack(spacing: 10) {
                Text("月の合計").font(.system(size: 14)).foregroundColor(NT.ink2)
                Text(NT.yen(fixedTotal + salary)).font(.system(size: 15, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink)
                Text("（固定費 \(NT.yen(fixedTotal)) ＋ 給料 \(NT.yen(salary))）").font(.system(size: 12)).foregroundColor(NT.ink3)
                Spacer(minLength: 8)
                if canEdit {
                    if dirty {
                        Text("保存していない変更があります").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.warn)
                    }
                    NPRButton(text: "元に戻す", disabled: !dirty || saving) { reset() }
                    NPRButton(text: saving ? "保存中…" : "この月の固定費・給料を保存", kind: .primary, busy: saving, disabled: !dirty) { save() }
                }
            }
            if !canEdit {
                Text("入力は本部（契約企業オーナー・本社管理者・本社経理）のアカウントから").font(.system(size: 12)).foregroundColor(NT.ink3)
            }
            if let error {
                Text(error).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.danger)
            }
        }
    }

    // スキャン済みの請求書を欄に入れる（ガスは「その他」の行。同じ名前があれば金額を上書き。Web と同じ）
    private func apply(_ b: NSettleScanned) {
        let amount = String(Int(b.amount.rounded()))
        if b.category == "gas" {
            if let i = others.firstIndex(where: { $0.name.trimmingCharacters(in: .whitespaces) == "ガス" }) {
                others[i].amount = amount
            } else if others.count < maxOther {
                others.append(NSettleOtherRow(name: "ガス", amount: amount))
            }
        } else {
            values[b.category] = amount
        }
    }

    private func isApplied(_ b: NSettleScanned) -> Bool {
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
                try await NativeModuleAPI.post(["type": "settlementCostsSave", "storeId": storeId, "month": month, "costs": costs])
                // 名前の無い「その他」は消える（Web と同じ）
                let cleaned = others.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
                others = cleaned
                savedValues = values
                savedOthers = cleaned
                saving = false
                onSaved("\(storeName) \(month) の固定費・給料を保存しました")
            } catch {
                self.error = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}
