import SwiftUI

// iPhone の店長・オーナー：レポート（Web の /app/reports。2026-10-25 Ronnie「iPhone も native に」）
// サーバーは iPad と同じ GET ?part=reports&from=&to=&store=（lib/reports-data-server.ts を Web と共用。返事の形は変えない）
//   日・週・月の切り替え（‹ › で前後）／純売上・客数・客単価・会計件数（前の期間との差）／
//   日別の売上（「日」は時間帯別）の棒グラフ／支払方法別／カテゴリ別／商品別 TOP／店舗別（全店舗のとき。押すとその店に絞る）／
//   スタッフ別／原価率・人件費率・FL・値引・予約など
// P/L カスケード・原価差異分析・月別損益・予約経路別・CSV 出力は Web（パソコン）か iPad で。

/// GET ?part=reports の中身（使うところだけ。足りない項目は nil でも読める）
struct NOSReport: Decodable {
    struct Daily: Decodable, Hashable { let date: String; let gross: Double; let refund: Double; let net: Double }
    struct Hour: Decodable, Hashable { let hour: String; let sales: Double }
    struct Pay: Decodable, Hashable { let label: String; let amount: Double }
    struct Cat: Decodable, Hashable { let category: String; let sales: Double }
    struct Product: Decodable, Hashable { let key: String; let name: String; let quantity: Double; let revenue: Double; let cost: Double? }
    struct Staff: Decodable, Hashable { let name: String; let count: Double; let sales: Double; let avgSpend: Double }
    struct StoreRow: Decodable, Hashable, Identifiable { let id: String; let name: String; let sales: Double; let count: Double; let guests: Double }

    let from: String
    let to: String
    let scopeLabel: String
    let storeOverrideId: String?
    let compareLabel: String?
    let salesTotal: Double
    let prevSalesTotal: Double?
    let grossProfit: Double?
    let prevGrossProfit: Double?
    let storeProfit: Double?
    let prevStoreProfit: Double?
    let avgSpend: Double
    let prevAvgSpend: Double?
    let guestCount: Double
    let prevGuestCount: Double?
    let transactionCount: Double
    let discountTotal: Double?
    let costRatePct: Double?
    let prevCostRatePct: Double?
    let laborRatePct: Double?
    let prevLaborRatePct: Double?
    let flRatePct: Double?
    let reservationCount: Double?
    let walkInCount: Double?
    let cancelRatePct: Double?
    let includeTakeoutGuests: Bool?
    let dailyRows: [Daily]
    let hourlyChartData: [Hour]?
    let paymentChartData: [Pay]
    let categoryChartData: [Cat]
    let productRows: [Product]
    let staffRows: [Staff]?
    let storeComparison: [StoreRow]?
}

@MainActor
final class NPOReportsModel: ObservableObject {
    enum Mode: String { case day, week, month, custom }

    @Published var payload: NOSReport?
    @Published var mode: Mode = .day
    /// 期間の中の 1 日（日・週・月の基準）
    @Published var anchor: String = NOS.today
    @Published var customFrom: String = NOS.today
    @Published var customTo: String = NOS.today
    /// 全店舗のときの店舗の絞り込み（Web の ?store=）
    @Published var store: String?
    @Published var loading = false
    @Published var error: String?
    /// 読めない（機能が切られている等）→ Web のまま見せる
    @Published var useWeb = false

    init(route: NativeModuleRoute? = nil) {
        guard let route else { return }
        if let s = route.query("store"), NOS.isUuid(s) { store = s }
        let f = route.query("from").flatMap { NOS.isDay($0) ? $0 : nil }
        let t = route.query("to").flatMap { NOS.isDay($0) ? $0 : nil }
        if let f, let t { applyRange(f, t) } else if let d = f ?? t { mode = .day; anchor = d }
    }

    /// Web の ?from=&to= から 日・週・月（どれにも当たらなければ期間指定）
    func applyRange(_ f: String, _ t: String) {
        let a = min(f, t), b = max(f, t)
        let today = NOS.today
        if a == b { mode = .day; anchor = a; return }
        if a == NOS.monday(a) && (b == NOS.addDays(a, 6) || (b == today && NOS.monday(today) == a)) { mode = .week; anchor = a; return }
        if a == NOS.monthFirst(a) && (b == NOS.monthLast(a) || (b == today && NOS.monthFirst(today) == a)) { mode = .month; anchor = a; return }
        mode = .custom
        customFrom = a
        customTo = b
    }

    /// いま見たい期間（今日より先は今日まで）
    var range: (from: String, to: String) {
        let today = NOS.today
        switch mode {
        case .day:
            return (anchor, anchor)
        case .week:
            let m = NOS.monday(anchor)
            return (m, min(NOS.addDays(m, 6), max(m, today)))
        case .month:
            let f = NOS.monthFirst(anchor)
            return (f, min(NOS.monthLast(anchor), max(f, today)))
        case .custom:
            return (customFrom, customTo)
        }
    }

    var canNext: Bool {
        let today = NOS.today
        switch mode {
        case .day: return anchor < today
        case .week: return NOS.addDays(NOS.monday(anchor), 7) <= today
        case .month: return NOS.shiftMonth(anchor, 1) + "-01" <= today
        case .custom: return false
        }
    }

    var title: String {
        let r = range
        switch mode {
        case .day: return NOS.mdw(r.from)
        case .week, .custom: return "\(NOS.md(r.from))〜\(NOS.md(r.to))"
        case .month: return NOS.ymLabel(r.from)
        }
    }

    var caption: String {
        let today = NOS.today
        switch mode {
        case .day:
            if anchor == today { return "今日" }
            if anchor == NOS.addDays(today, -1) { return "昨日" }
            return ""
        case .week:
            let m = NOS.monday(anchor)
            if m == NOS.monday(today) { return "今週（月〜）" }
            if m == NOS.addDays(NOS.monday(today), -7) { return "先週" }
            return "月〜日"
        case .month:
            let ym = String(anchor.prefix(7)), cur = String(today.prefix(7))
            if ym == cur { return "今月（今日まで）" }
            if ym == NOS.shiftMonth(cur, -1) { return "先月" }
            return ""
        case .custom:
            return "期間指定"
        }
    }

    var query: [String: String] {
        let r = range
        var q = ["from": r.from, "to": r.to]
        if let store { q["store"] = store }
        return q
    }

    /// 今の中身が見たい期間のものか（違えば薄くして読み込み中）
    var isCurrent: Bool {
        guard let p = payload else { return false }
        let r = range
        // 店舗の絞り込みはサーバーが受けたときだけ storeOverrideId に入る（店舗を選んでいる人は無視される）ので、戻すときだけ見る
        return p.from == r.from && p.to == r.to && (store != nil || p.storeOverrideId == nil)
    }

    func setMode(_ m: Mode) {
        guard m != mode else { return }
        if mode == .custom { anchor = min(customTo, NOS.today) }
        if anchor > NOS.today { anchor = NOS.today }
        mode = m
        Task { await refresh() }
    }

    func shift(_ d: Int) {
        switch mode {
        case .day: anchor = NOS.addDays(anchor, d)
        case .week: anchor = NOS.addDays(NOS.monday(anchor), 7 * d)
        case .month: anchor = NOS.shiftMonth(anchor, d) + "-01"
        case .custom: return
        }
        if anchor > NOS.today { anchor = NOS.today }
        Task { await refresh() }
    }

    func setStore(_ id: String?) {
        store = id
        Task { await refresh() }
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let q = query
        // 前に開いた同じ期間の中身を先に出す（押した瞬間に出る。裏で読み直す）
        if let saved = NativeModuleAPI.cached(NOSReport.self, part: "reports", query: q), !isCurrent { payload = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOSReport.self, part: "reports", query: q)
            guard q == query else { return }
            payload = p
            error = nil
        } catch {
            guard q == query else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }
}

struct NativePhoneOwnerReportsView: View {
    @ObservedObject var model: NPOReportsModel
    let onBack: () -> Void
    /// 別の画面へ（伝票明細など。ネイティブがあればネイティブ）
    let onWeb: (String) -> Void

    @State private var allProducts = false
    @State private var customOpen = false

    var body: some View {
        NPOFrame(title: "レポート", subtitle: model.payload?.scopeLabel ?? "Sales report", onBack: onBack, trailing: {
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
                if model.payload == nil {
                    VStack(spacing: 0) {
                        periodCard.padding(12)
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 12) {
                            periodCard
                            if let p = model.payload {
                                Group {
                                    heroCard(p)
                                    chartCard(p)
                                    payCard(p)
                                    categoryCard(p)
                                    productCard(p)
                                    if let rows = p.storeComparison, !rows.isEmpty, p.storeOverrideId == nil { storeCard(rows) }
                                    if let rows = p.staffRows, !rows.isEmpty { staffCard(rows) }
                                    kpiCard(p)
                                }
                                .opacity(model.isCurrent ? 1 : 0.45)
                                footer(p)
                            }
                        }
                        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 40)
                    }
                    .refreshable { await model.refresh() }
                }
            }
        })
        .task { await model.refresh() }
        .sheet(isPresented: $customOpen) {
            NOSRangeSheet(from: model.range.from, to: model.range.to, onClose: { customOpen = false }) { f, t in
                customOpen = false
                model.applyRange(f, t)
                Task { await model.refresh() }
            }
            .presentationDetents([.medium, .large])
            .environment(\.colorScheme, .light)
        }
    }

    // MARK: 期間（日・週・月 ／ ‹ › ／ 期間指定）

    private var periodCard: some View {
        VStack(spacing: 10) {
            NOSSegment(items: [(key: "day", label: "日"), (key: "week", label: "週"), (key: "month", label: "月")],
                       selection: model.mode.rawValue) { k in model.setMode(NPOReportsModel.Mode(rawValue: k) ?? .day) }
            NOSStepper(title: model.title, caption: model.caption, canNext: model.canNext && model.mode != .custom,
                       onPrev: { if model.mode == .custom { customOpen = true } else { model.shift(-1) } },
                       onNext: { model.shift(1) })
            HStack(spacing: 8) {
                Button { customOpen = true } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar").font(.system(size: 12, weight: .bold))
                        Text("期間を選ぶ").font(.system(size: 12.5, weight: .bold))
                    }
                    .foregroundColor(NT.purpleDeep)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                Spacer(minLength: 4)
                if let p = model.payload, p.storeOverrideId != nil {
                    Button { model.setStore(nil) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 12, weight: .bold))
                            Text("全店舗に戻す").font(.system(size: 12.5, weight: .bold))
                        }
                        .foregroundColor(NT.ink2)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Capsule().fill(Color.white))
                        .overlay(Capsule().stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    // MARK: 売上の大きい数字

    private func heroCard(_ p: NOSReport) -> some View {
        let cmp = p.compareLabel ?? "前期間比"
        return NPOCard {
            HStack(alignment: .firstTextBaseline) {
                Text("純売上").font(.system(size: 13, weight: NT.strong)).foregroundColor(NT.ink2)
                Text("Net sales").font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3)
                Spacer()
                NOSDelta(pct: NOS.change(p.salesTotal, p.prevSalesTotal), label: cmp)
            }
            Text(NOS.yen(p.salesTotal)).font(.system(size: 34, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.5)
            HStack(spacing: 0) {
                stat("客数", "\(NOS.int(p.guestCount))名", NOS.change(p.guestCount, p.prevGuestCount))
                divider
                stat("客単価", NOS.yen(p.avgSpend), NOS.change(p.avgSpend, p.prevAvgSpend))
                divider
                stat("会計件数", "\(NOS.int(p.transactionCount))件", nil)
            }
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
            if p.grossProfit != nil || p.storeProfit != nil {
                HStack(spacing: 10) {
                    if let g = p.grossProfit { miniMoney("粗利益", g, NOS.change(g, p.prevGrossProfit)) }
                    if let s = p.storeProfit { miniMoney("店舗利益", s, NOS.change(s, p.prevStoreProfit)) }
                }
            }
            if p.includeTakeoutGuests == false {
                Text("客数・客単価は店内飲食（テーブル会計・コース）だけで数えています").font(.system(size: 10.5)).foregroundColor(NT.ink3)
            }
        }
    }

    private var divider: some View { Rectangle().fill(NT.line).frame(width: 1, height: 34) }

    private func stat(_ label: String, _ value: String, _ change: Double?) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if change != nil { NOSDelta(pct: change) } else { Text(" ").font(.system(size: 11)) }
        }
        .frame(maxWidth: .infinity)
    }

    private func miniMoney(_ label: String, _ v: Double, _ change: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            Text(NOS.yen(v)).font(.system(size: 16, weight: NT.strong)).foregroundColor(v >= 0 ? NT.ink : NT.danger).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            NOSDelta(pct: change)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    // MARK: 棒グラフ（日＝時間帯別、週・月＝日別）

    private func chartCard(_ p: NOSReport) -> some View {
        let byHour = p.from == p.to
        let bars = byHour ? hourBars(p) : dayBars(p)
        let hasSales = bars.contains { $0.value > 0 }
        return NPOCard(title: byHour ? "時間帯別の売上" : "日別の売上", trailing: byHour ? "By hour" : "By day") {
            if hasSales {
                NOSBars(bars: bars, height: 150, summary: byHour ? "棒を押すとその時間の売上" : "棒を押すとその日の売上（純売上）")
                if !byHour {
                    HStack(spacing: 12) {
                        legend(NT.purple, "平日")
                        legend(Color(hex: 0x4F7FD9), "土")
                        legend(Color(hex: 0xD9534F), "日")
                        Spacer()
                        let days = max(1, p.dailyRows.count)
                        Text("1日平均 \(NOS.yen(p.salesTotal / Double(days)))").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                    }
                }
            } else {
                Text("この期間の売上はまだありません").font(.system(size: 13)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).padding(.vertical, 28)
            }
        }
    }

    private func legend(_ c: Color, _ t: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 9, height: 9)
            Text(t).font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3)
        }
    }

    private func dayBars(_ p: NOSReport) -> [NOSBar] {
        p.dailyRows.map { d in
            let w = NOS.weekday(d.date)
            let tint = w == 0 ? Color(hex: 0xD9534F) : w == 6 ? Color(hex: 0x4F7FD9) : NT.purple
            let label = p.dailyRows.count <= 7 ? NOS.weekdays[w] : String(Int(d.date.suffix(2)) ?? 0)
            return NOSBar(label: label, value: d.net, detail: NOS.mdw(d.date), tint: tint)
        }
    }

    /// 0〜23 時のうち、売上のある時間の前後だけ
    private func hourBars(_ p: NOSReport) -> [NOSBar] {
        let rows = p.hourlyChartData ?? []
        guard let first = rows.firstIndex(where: { $0.sales > 0 }), let last = rows.lastIndex(where: { $0.sales > 0 }) else { return [] }
        let lo = max(0, first - 1), hi = min(rows.count - 1, last + 1)
        return (lo...hi).map { i in
            let h = rows[i].hour.replacingOccurrences(of: "時", with: "")
            return NOSBar(label: h, value: rows[i].sales, detail: "\(h)時台")
        }
    }

    // MARK: 支払方法別

    private func payCard(_ p: NOSReport) -> some View {
        let total = max(1, p.paymentChartData.reduce(0.0) { $0 + $1.amount })
        return NPOCard(title: "支払方法別", trailing: "Payments") {
            if p.paymentChartData.isEmpty {
                empty("支払の記録がありません")
            } else {
                ForEach(p.paymentChartData, id: \.self) { d in
                    NOSMeterRow(label: d.label, value: NOS.yen(d.amount), ratio: d.amount / total, sub: "\(String(format: "%.0f", d.amount / total * 100))%")
                }
            }
        }
    }

    // MARK: カテゴリ別

    private func categoryCard(_ p: NOSReport) -> some View {
        let top = max(1, p.categoryChartData.first?.sales ?? 1)
        return NPOCard(title: "カテゴリ別の売上", trailing: "TOP \(p.categoryChartData.count)") {
            if p.categoryChartData.isEmpty {
                empty("商品の売上がありません")
            } else {
                ForEach(Array(p.categoryChartData.enumerated()), id: \.offset) { i, c in
                    NOSMeterRow(rank: i + 1, label: c.category, value: NOS.yen(c.sales), ratio: c.sales / top, tint: Color(hex: 0x6A5ACD))
                }
            }
        }
    }

    // MARK: 商品別

    private func productCard(_ p: NOSReport) -> some View {
        let rows = allProducts ? p.productRows : Array(p.productRows.prefix(10))
        return NPOCard(title: "商品別の売上", trailing: "TOP \(p.productRows.count)") {
            if p.productRows.isEmpty {
                empty("商品の売上がありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                        productRow(i + 1, r)
                    }
                }
                if p.productRows.count > 10 {
                    Button { allProducts.toggle() } label: {
                        Text(allProducts ? "10件だけ表示" : "すべて表示（\(p.productRows.count)件）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                            .frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func productRow(_ rank: Int, _ r: NOSReport.Product) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)").font(.system(size: 11, weight: NT.strong)).foregroundColor(rank <= 3 ? .white : NT.ink3)
                .frame(width: 22, height: 22).background(Circle().fill(rank <= 3 ? NT.purple : NT.page))
            VStack(alignment: .leading, spacing: 1) {
                Text(r.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(NOS.plain(r.quantity))点").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                    if let c = r.cost, r.revenue > 0 {
                        Text("粗利 \(NOS.yen(r.revenue - c))（\(String(format: "%.0f", (r.revenue - c) / r.revenue * 100))%）").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                }
                .monospacedDigit()
            }
            Spacer(minLength: 6)
            Text(NOS.yen(r.revenue)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1) }
    }

    // MARK: 店舗別（全店舗のとき）

    private func storeCard(_ rows: [NOSReport.StoreRow]) -> some View {
        let sorted = rows.sorted { $0.sales > $1.sales }
        let top = max(1, sorted.first?.sales ?? 1)
        return NPOCard(title: "店舗別", trailing: "押すとその店だけ") {
            ForEach(Array(sorted.enumerated()), id: \.element.id) { i, s in
                Button { model.setStore(s.id) } label: {
                    HStack(spacing: 8) {
                        NOSMeterRow(rank: i + 1, label: s.name, value: NOS.yen(s.sales), ratio: s.sales / top,
                                    sub: "\(NOS.int(s.count))件・\(NOS.int(s.guests))名")
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: スタッフ別

    private func staffCard(_ rows: [NOSReport.Staff]) -> some View {
        NPOCard(title: "スタッフ別", trailing: "By staff") {
            ForEach(Array(rows.prefix(10).enumerated()), id: \.offset) { _, r in
                HStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 20)).foregroundColor(NT.lilacLine)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        Text("\(NOS.int(r.count))件・客単価 \(NOS.yen(r.avgSpend))").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                    }
                    Spacer(minLength: 6)
                    Text(NOS.yen(r.sales)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: そのほかの数字

    private func kpiCard(_ p: NOSReport) -> some View {
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return NPOCard(title: "そのほかの数字", trailing: "KPI") {
            LazyVGrid(columns: cols, spacing: 8) {
                kpi("原価率（理論）", NOS.pct(p.costRatePct), NOSDelta(pct: rel(p.costRatePct, p.prevCostRatePct), positiveIsGood: false), warn: (p.costRatePct ?? 0) > 35)
                kpi("人件費率", NOS.pct(p.laborRatePct), NOSDelta(pct: rel(p.laborRatePct, p.prevLaborRatePct), positiveIsGood: false), warn: (p.laborRatePct ?? 0) > 35)
                kpi("FL比率", NOS.pct(p.flRatePct), nil, warn: (p.flRatePct ?? 0) > 60)
                kpi("値引き合計", NOS.yen(p.discountTotal), nil)
                kpi("予約", p.reservationCount.map { "\(NOS.int($0))件" } ?? "—", nil)
                kpi("ウォークイン", p.walkInCount.map { "\(NOS.int($0))件" } ?? "—", nil)
                kpi("キャンセル率", NOS.pct(p.cancelRatePct), nil, warn: (p.cancelRatePct ?? 0) > 10)
                kpi("粗利率", p.salesTotal > 0 && p.grossProfit != nil ? NOS.pct((p.grossProfit ?? 0) / p.salesTotal * 100) : "—", nil)
            }
            Text("原価率・人件費率の矢印は前の期間との比較（下がると緑）").font(.system(size: 10.5)).foregroundColor(NT.ink3)
        }
    }

    /// 率の前の期間との比較（Web・iPad と同じ：(今 − 前) ÷ 前）
    private func rel(_ cur: Double?, _ prev: Double?) -> Double? {
        guard let cur else { return nil }
        return NOS.change(cur, prev)
    }

    private func kpi(_ label: String, _ value: String, _ delta: NOSDelta?, warn: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 18, weight: NT.strong)).foregroundColor(warn ? NT.warn : NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if let delta { delta } else { Text(" ").font(.system(size: 11)) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
    }

    private func empty(_ t: String) -> some View {
        Text(t).font(.system(size: 13)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).padding(.vertical, 18)
    }

    private func footer(_ p: NOSReport) -> some View {
        VStack(spacing: 8) {
            Button { onWeb("/app/orders?from=\(p.from)&to=\(p.to)") } label: {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text").font(.system(size: 14, weight: .bold))
                    Text("この期間の伝票明細を見る").font(.system(size: 14, weight: NT.strong))
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                }
                .foregroundColor(NT.purpleDeep)
                .padding(.horizontal, 14).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            }
            .buttonStyle(PressableStyle())
            Text("純売上＝会計済みの合計（値引後）− 返金。P/L・原価差異・月別損益・予約経路別・CSV は、パソコンの管理画面か iPad のレポートで見られます。")
                .font(.system(size: 10.5)).foregroundColor(NT.ink3).multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// 期間を選ぶ（開始日・終了日）
struct NOSRangeSheet: View {
    let onClose: () -> Void
    let onApply: (String, String) -> Void
    @State private var from: Date
    @State private var to: Date

    init(from: String, to: String, onClose: @escaping () -> Void, onApply: @escaping (String, String) -> Void) {
        self.onClose = onClose
        self.onApply = onApply
        _from = State(initialValue: NOS.date(from) ?? Date())
        _to = State(initialValue: NOS.date(to) ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text("最長 1 年分まで。今日より先の日は売上がありません。")) {
                    DatePicker("開始日", selection: $from, in: ...Date(), displayedComponents: .date)
                    DatePicker("終了日", selection: $to, in: ...Date(), displayedComponents: .date)
                }
            }
            .environment(\.locale, Locale(identifier: "ja_JP"))
            .navigationTitle("期間を選ぶ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("表示") {
                        let a = NOS.str(from), b = NOS.str(to)
                        onApply(min(a, b), max(a, b))
                    }
                    .font(.system(size: 16, weight: .bold))
                }
            }
        }
    }
}

/// key "reports" の画面（NativePhoneOwnerScreen から）
struct NativePhoneOwnerReportsScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPOReportsModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NPOReportsModel(route: route))
    }

    var body: some View {
        NativePhoneOwnerReportsView(model: model, onBack: { state.closePhoneOwnerModule() }, onWeb: { state.leaveNativePhone(to: $0) })
            // 読めない（機能が切られている等）：Web の画面をそのまま見せる
            .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }
}
