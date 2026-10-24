import SwiftUI
import Charts

// 店舗分析（ネイティブ）。Web の /app/reports と同じ数字（サーバーは lib/reports-data-server.ts を Web と共用。2026-10-24）
//   期間（今日〜過去30日・自由な期間）／ P/Lカスケード ／ 原価差異分析 ／ 月別損益推移 ／ KPI ／ グラフ（日別・支払方法・時間帯・曜日・カテゴリ）
//   店舗別比較 ／ 商品別 TOP20 ／ スタッフ別 ／ 予約経路別 ／ 日別売上明細

struct NRPreset: Codable, Hashable { let label: String; let from: String; let to: String }
struct NRPlStep: Codable, Hashable { let label: String; let amount: Int; let isDeduction: Bool?; let emphasis: Bool?; let note: String? }
struct NRCostVariance: Codable { let theoreticalCost: Int; let actualCost: Int; let variance: Int; let varianceRate: Double; let breakdown: NRBreakdown }
struct NRBreakdown: Codable { let waste: Int; let countAdjustment: Int; let other: Int }
struct NRPurchaseVariance: Codable { let totalVariance: Int; let baselineAmount: Int; let varianceRate: Double; let excludedCount: Int }
struct NRMonth: Codable, Hashable { let label: String; let sales: Int; let cost: Int; let grossProfit: Int; let labor: Int; let expense: Int; let profit: Int; let budgetSales: Int?; let budgetProfit: Int? }
struct NRDailyChart: Codable, Hashable { let date: String; let sales: Int }
struct NRPayChart: Codable, Hashable { let label: String; let amount: Int }
struct NRHourChart: Codable, Hashable { let hour: String; let sales: Int }
struct NRWeekChart: Codable, Hashable { let weekday: String; let sales: Int }
struct NRCatChart: Codable, Hashable { let category: String; let sales: Int }
struct NRStoreRow: Codable, Hashable { let id: String; let name: String; let sales: Int; let count: Int; let guests: Int }
struct NRProductRow: Codable, Hashable { let key: String; let name: String; let quantity: Int; let revenue: Int; let cost: Int? }
struct NRStaffRow: Codable, Hashable { let name: String; let count: Int; let sales: Int; let avgSpend: Int }
struct NRSourceRow: Codable, Hashable { let name: String; let total: Int; let completionRate: Double; let cancelRate: Double }
struct NRDailyRow: Codable, Hashable { let date: String; let gross: Int; let refund: Int; let net: Int }

struct NRPayload: Codable {
    let canExport: Bool
    let from: String; let to: String; let scopeLabel: String; let storeOverrideId: String?
    let presets: [NRPreset]; let compareLabel: String; let plSteps: [NRPlStep]
    let salesTotal: Int; let prevSalesTotal: Int; let grossProfit: Int; let prevGrossProfit: Int; let storeProfit: Int; let prevStoreProfit: Int
    let costVariance: NRCostVariance; let purchasePriceVariance: NRPurchaseVariance; let monthlyPl: [NRMonth]
    let avgSpend: Int; let prevAvgSpend: Int; let guestCount: Int; let prevGuestCount: Int
    let flCost: Int; let flRatePct: Double; let costRatePct: Double; let prevCostRatePct: Double; let laborRatePct: Double; let prevLaborRatePct: Double
    let turnoverRate: Double; let totalSeats: Int; let tableUtilizationPct: Double
    let reservationCompletionRate: Double; let reservationCompleted: Int; let reservationCompletionBase: Int
    let cancelRatePct: Double; let noShowRatePct: Double; let repeatRatePct: Double; let repeatCustomerCount: Int; let visitedCustomerCount: Int
    let ltvAverage: Int; let customerCount: Int; let wasteRatePct: Double; let wasteAmount: Int; let includeTakeoutGuests: Bool
    let transactionCount: Int; let reservationCount: Int; let walkInCount: Int; let discountTotal: Int
    let dailyChartData: [NRDailyChart]; let paymentChartData: [NRPayChart]; let hourlyChartData: [NRHourChart]; let weekdayChartData: [NRWeekChart]; let categoryChartData: [NRCatChart]
    let storeComparison: [NRStoreRow]; let productRows: [NRProductRow]; let staffRows: [NRStaffRow]; let sourceRows: [NRSourceRow]; let dailyRows: [NRDailyRow]
}

@MainActor
final class NativeReportsModel: ObservableObject {
    @Published var payload: NRPayload?
    @Published var from: String?
    @Published var to: String?
    @Published var store: String?
    @Published var loading = false
    @Published var error: String?

    func refresh() async {
        loading = true
        defer { loading = false }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var q = [URLQueryItem(name: "part", value: "reports")]
            if let from { q.append(URLQueryItem(name: "from", value: from)) }
            if let to { q.append(URLQueryItem(name: "to", value: to)) }
            if let store { q.append(URLQueryItem(name: "store", value: store)) }
            comps.queryItems = q
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NRPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NRPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }
}

struct NativeReportsView: View {
    @ObservedObject var model: NativeReportsModel
    let onHome: () -> Void
    let onWeb: (String) -> Void

    private let green = Color(hex: 0x1E8F62)
    private let amber = Color(hex: 0xC27C0E)

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "レポート・経営分析", subtitle: "Analytics", onHome: onHome)
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header(p)
                        plCard(p)
                        varianceCard(p)
                        monthlyCard(p)
                        kpiGrid(p)
                        chartsGrid(p)
                        if !p.storeComparison.isEmpty { storeCard(p) }
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 16, alignment: .top), GridItem(.flexible(), spacing: 16, alignment: .top)], spacing: 16) {
                            productCard(p); staffCard(p); sourceCard(p); dailyCard(p)
                        }
                    }
                    .padding(16)
                }
                .overlay(alignment: .top) { if model.loading { ProgressView().padding(8).background(Capsule().fill(Color.white)).padding(.top, 8) } }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center); Button("もう一度") { Task { await model.refresh() } } }.padding(30)
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task { if model.payload == nil { await model.refresh() } }
    }

    // MARK: - 上（期間）

    private func header(_ p: NRPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(p.scopeLabel)｜\(NPDate.slash(p.from))〜\(NPDate.slash(p.to))の実績").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                Spacer()
                if p.canExport {
                    Button { exportCsv(p) } label: {
                        HStack(spacing: 5) { Image(systemName: "arrow.down.doc"); Text("CSV出力") }
                            .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                            .padding(.horizontal, 12).frame(height: 36)
                            .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
                    }.buttonStyle(PressableStyle())
                }
            }
            HStack(spacing: 10) {
                NCFlow(spacing: 6) {
                    ForEach(p.presets, id: \.self) { pr in
                        let on = pr.from == p.from && pr.to == p.to
                        Button { model.from = pr.from; model.to = pr.to; Task { await model.refresh() } } label: {
                            Text(pr.label).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                                .padding(.horizontal, 12).frame(height: 32)
                                .background(Capsule().fill(on ? NFColor.iris : Color.white))
                                .overlay(Capsule().stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
                        }.buttonStyle(.plain)
                    }
                }
                Spacer()
                DatePicker("", selection: Binding(get: { NPDate.date(p.from) }, set: { model.from = NPDate.str($0); model.to = model.to ?? p.to; Task { await model.refresh() } }), displayedComponents: .date).labelsHidden()
                Text("〜").foregroundColor(NFColor.ink3)
                DatePicker("", selection: Binding(get: { NPDate.date(p.to) }, set: { model.to = NPDate.str($0); model.from = model.from ?? p.from; Task { await model.refresh() } }), displayedComponents: .date).labelsHidden()
            }
            .environment(\.locale, Locale(identifier: "ja_JP"))
            if p.storeOverrideId != nil {
                HStack(spacing: 6) {
                    Text("\(p.scopeLabel.replacingOccurrences(of: "（全店舗から絞込中）", with: "")) に絞り込み中です。").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    Button("全店舗表示に戻す") { model.store = nil; Task { await model.refresh() } }.font(.system(size: 12, weight: .bold))
                }
            }
        }
    }

    // MARK: - カード

    private func card<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.navy)
            c()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
    }

    private func delta(_ cur: Double, _ prev: Double, _ label: String, positiveIsGood: Bool = true) -> some View {
        Group {
            if prev == 0 && cur != 0 {
                Text("\(label) —").foregroundColor(NFColor.ink3)
            } else {
                let pct = prev == 0 ? 0 : (cur - prev) / prev * 100
                let dir = pct > 0.05 ? 1 : pct < -0.05 ? -1 : 0
                let good = dir == 0 ? nil : ((dir > 0) == positiveIsGood)
                HStack(spacing: 3) {
                    Text(label).foregroundColor(NFColor.ink3)
                    Image(systemName: dir > 0 ? "arrow.up.right" : dir < 0 ? "arrow.down.right" : "minus")
                    Text("\(pct >= 0 ? "+" : "")\(String(format: "%.1f", pct))%")
                }
                .foregroundColor(good == nil ? NFColor.ink3 : good! ? green : NFColor.danger)
            }
        }
        .font(.system(size: 12, weight: .semibold))
    }

    private func plCard(_ p: NRPayload) -> some View {
        card("P/Lカスケード（総売上 − 値引 − 返金 = 純売上 − 原価（理論） = 粗利益 − 人件費 − 経費 = 店舗利益）") {
            let maxV = max(1, p.plSteps.map { abs($0.amount) }.max() ?? 1)
            VStack(spacing: 6) {
                ForEach(p.plSteps, id: \.self) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 10) {
                            Text(s.label).font(.system(size: 13.5, weight: s.emphasis == true ? .heavy : .semibold)).foregroundColor(NFColor.navy).frame(width: 130, alignment: .leading)
                            GeometryReader { g in
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(s.isDeduction == true ? NFColor.danger.opacity(0.25) : s.emphasis == true ? NFColor.iris : NFColor.iris.opacity(0.35))
                                    .frame(width: max(2, g.size.width * CGFloat(Double(abs(s.amount)) / Double(maxV))))
                            }.frame(height: 18)
                            Text("\(s.isDeduction == true ? "−" : "")\(NT.yen(s.amount))").font(.system(size: 14, weight: s.emphasis == true ? .heavy : .bold)).monospacedDigit()
                                .foregroundColor(s.isDeduction == true ? NFColor.danger : NFColor.navy).frame(width: 130, alignment: .trailing)
                        }
                        if let n = s.note, !n.isEmpty { Text(n).font(.system(size: 11)).foregroundColor(NFColor.ink3).padding(.leading, 140) }
                    }
                }
            }
            HStack(spacing: 18) {
                delta(Double(p.salesTotal), Double(p.prevSalesTotal), "純売上 \(p.compareLabel)")
                delta(Double(p.grossProfit), Double(p.prevGrossProfit), "粗利益 \(p.compareLabel)")
                delta(Double(p.storeProfit), Double(p.prevStoreProfit), "店舗利益 \(p.compareLabel)")
            }
            Text("純売上 = 総売上（会計成立注文の合計・値引後）− 返金。原価は理論原価（販売×レシピ×平均仕入単価）を使用しています。実際の原価（廃棄・棚卸差異を反映）は下記「原価差異分析」を参照してください。")
                .font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
        }
    }

    private func varianceCard(_ p: NRPayload) -> some View {
        let v = p.costVariance
        let pv = p.purchasePriceVariance
        return card("原価差異分析（理論原価 vs 実原価）") {
            HStack(alignment: .top, spacing: 12) {
                mini("理論原価", NT.yen(v.theoreticalCost))
                mini("実原価", NT.yen(v.actualCost), sub: "対純売上 \(String(format: "%.1f", p.salesTotal > 0 ? Double(v.actualCost) / Double(p.salesTotal) * 100 : 0))%")
                mini("差異（実原価−理論原価）", NPDate.signed(v.variance), tone: v.variance > 0 ? NFColor.danger : v.variance < 0 ? green : NFColor.navy)
                mini("差異率", "\(String(format: "%.1f", v.varianceRate))%")
            }
            HStack(spacing: 12) {
                mini("廃棄", NT.yen(v.breakdown.waste)); mini("棚卸差異", NT.yen(v.breakdown.countAdjustment)); mini("その他調整", NT.yen(v.breakdown.other))
            }
            HStack(spacing: 12) {
                mini("参考: 仕入価格変動", NPDate.signed(pv.totalVariance), tone: pv.totalVariance > 0 ? NFColor.danger : pv.totalVariance < 0 ? green : NFColor.navy,
                     sub: "比較できた仕入額 \(NT.yen(pv.baselineAmount))・変動率 \(String(format: "%.1f", pv.varianceRate))%\(pv.excludedCount > 0 ? "・比較不可 \(pv.excludedCount)件" : "")")
            }
        }
    }

    private func mini(_ label: String, _ value: String, tone: Color = NFColor.navy, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
            Text(value).font(.system(size: 19, weight: .heavy)).monospacedDigit().foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.7)
            if let sub { Text(sub).font(.system(size: 10.5)).foregroundColor(NFColor.ink3) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xF7F7FA)))
    }

    private func monthlyCard(_ p: NRPayload) -> some View {
        card("月別損益推移（前々月・前月・当月）") {
            VStack(spacing: 0) {
                mrow("項目", p.monthlyPl.map { AnyView(Text($0.label).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)) }, head: true)
                mrow("売上（純）", p.monthlyPl.map { m in AnyView(VStack(alignment: .trailing, spacing: 1) {
                    Text(NT.yen(m.sales))
                    if let b = m.budgetSales { Text("（予算比\(b > 0 ? String(format: "%.0f", Double(m.sales) / Double(b) * 100) : "0")%）").font(.system(size: 11)).foregroundColor(m.sales >= b ? green : NFColor.danger) }
                }) })
                mrow("原価（理論）", p.monthlyPl.map { AnyView(Text(NT.yen($0.cost))) })
                mrow("粗利益", p.monthlyPl.map { AnyView(Text(NT.yen($0.grossProfit))) })
                mrow("人件費（概算）", p.monthlyPl.map { AnyView(Text(NT.yen($0.labor))) })
                mrow("経費", p.monthlyPl.map { AnyView(Text(NT.yen($0.expense))) })
                mrow("店舗利益", p.monthlyPl.map { m in AnyView(VStack(alignment: .trailing, spacing: 1) {
                    Text(NT.yen(m.profit)).fontWeight(.heavy).foregroundColor(m.profit >= 0 ? green : NFColor.danger)
                    if let b = m.budgetProfit { Text("（予算比\(b != 0 ? String(format: "%.0f", Double(m.profit) / Double(b) * 100) : "0")%）").font(.system(size: 11)).foregroundColor(m.profit >= b ? green : NFColor.danger) }
                }) })
            }
            Text("※ 予算対比は「予算管理」（/app/budgets）に登録された値がある月のみ表示します。本社共通費（家賃・システム利用料等）の店舗への配賦は将来機能で、現状の経費は店舗（または選択スコープ）に直接紐づく経費のみを集計しています。")
                .font(.system(size: 11)).foregroundColor(NFColor.ink3)
        }
    }

    private func mrow(_ label: String, _ cells: [AnyView], head: Bool = false) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: head ? 12 : 13.5, weight: .bold)).foregroundColor(head ? NFColor.ink3 : NFColor.navy).frame(width: 140, alignment: .leading)
            ForEach(Array(cells.enumerated()), id: \.offset) { _, c in c.frame(maxWidth: .infinity, alignment: .trailing) }
        }
        .font(.system(size: 14)).monospacedDigit().foregroundColor(NFColor.ink)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: head ? 1 : 0.5) }
    }

    private func kpi(_ label: String, _ value: String, tone: Color = NFColor.navy, sub: AnyView? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3).lineLimit(1)
            Text(value).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.7)
            if let sub { sub }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
    }
    private func subText(_ t: String) -> AnyView { AnyView(Text(t).font(.system(size: 10.5)).foregroundColor(NFColor.ink3).lineLimit(2)) }
    private func pct(_ v: Double) -> String { "\(String(format: "%.1f", v))%" }

    private func kpiGrid(_ p: NRPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                kpi("客単価", NT.yen(p.avgSpend), sub: AnyView(delta(Double(p.avgSpend), Double(p.prevAvgSpend), p.compareLabel)))
                kpi("客数", "\(p.guestCount)名", sub: AnyView(delta(Double(p.guestCount), Double(p.prevGuestCount), p.compareLabel)))
                kpi("FLコスト", NT.yen(p.flCost), sub: subText("原価+人件費"))
                kpi("FL比率", pct(p.flRatePct), tone: p.flRatePct > 60 ? amber : NFColor.navy)
                kpi("原価率（理論）", pct(p.costRatePct), sub: AnyView(delta(p.costRatePct, p.prevCostRatePct, p.compareLabel, positiveIsGood: false)))
                kpi("人件費率", pct(p.laborRatePct), sub: AnyView(delta(p.laborRatePct, p.prevLaborRatePct, p.compareLabel, positiveIsGood: false)))
                kpi("回転率", "\(String(format: "%.2f", p.turnoverRate))回", sub: subText("客数÷総席数(\(p.totalSeats)席)"))
                kpi("テーブル稼働率", pct(p.tableUtilizationPct), sub: subText("簡易計算（日別利用テーブル数の平均）"))
                kpi("予約成約率", pct(p.reservationCompletionRate), sub: subText("\(p.reservationCompleted)/\(p.reservationCompletionBase)件"))
                kpi("キャンセル率", pct(p.cancelRatePct), tone: p.cancelRatePct > 10 ? amber : NFColor.navy)
                kpi("無断キャンセル率", pct(p.noShowRatePct), tone: p.noShowRatePct > 3 ? NFColor.danger : NFColor.navy)
                kpi("再来店率", pct(p.repeatRatePct), sub: subText("\(p.repeatCustomerCount)/\(p.visitedCustomerCount)人（期間内）"))
                kpi("LTV平均", NT.yen(p.ltvAverage), sub: subText("累計購入額の平均（\(p.customerCount)人）"))
                kpi("廃棄率", pct(p.wasteRatePct), tone: p.wasteRatePct > 3 ? amber : NFColor.navy, sub: subText(NT.yen(p.wasteAmount)))
                kpi("会計件数", "\(p.transactionCount)件")
                kpi("予約数", "\(p.reservationCount)件")
                kpi("ウォークイン数", "\(p.walkInCount)件")
                kpi("値引き額合計", NT.yen(p.discountTotal))
                kpi("粗利率（対純売上・理論原価）", p.salesTotal > 0 ? pct(Double(p.grossProfit) / Double(p.salesTotal) * 100) : "0.0%", tone: green)
            }
            Text("※ テーブル稼働率＝期間内の各日について「注文のあったテーブル数÷店舗のテーブル数」を算出し、日数で平均した簡易指標です。再来店率は選択期間内の来店回数（2回以上）で判定した近似値です。\(p.includeTakeoutGuests ? "" : "　客数・客単価は店内飲食（テーブル会計・コース）のみで算出しています（設定 > 企業情報 > KPI設定）。")")
                .font(.system(size: 11)).foregroundColor(NFColor.ink3)
        }
    }

    private func chartsGrid(_ p: NRPayload) -> some View {
        VStack(spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                card("日別売上推移") {
                    if p.salesTotal == 0 { Text("この期間の売上データがありません").font(.system(size: 13)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(30) }
                    else {
                        Chart(p.dailyChartData, id: \.self) { d in
                            AreaMark(x: .value("日付", d.date), y: .value("売上", d.sales)).foregroundStyle(NFColor.iris.opacity(0.15))
                            LineMark(x: .value("日付", d.date), y: .value("売上", d.sales)).foregroundStyle(NFColor.iris)
                        }
                        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 8)) }
                        .frame(height: 220)
                    }
                }
                .frame(maxWidth: .infinity)
                card("支払方法別構成") {
                    if p.paymentChartData.isEmpty { Text("支払データがありません").font(.system(size: 13)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(30) }
                    else {
                        let total = max(1, p.paymentChartData.reduce(0) { $0 + $1.amount })
                        VStack(spacing: 8) {
                            ForEach(p.paymentChartData, id: \.self) { d in
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack { Text(d.label).font(.system(size: 13)); Spacer(); Text("\(NT.yen(d.amount))（\(String(format: "%.0f", Double(d.amount) / Double(total) * 100))%）").font(.system(size: 13, weight: .bold)).monospacedDigit() }
                                    GeometryReader { g in RoundedRectangle(cornerRadius: 3).fill(NFColor.iris.opacity(0.6)).frame(width: g.size.width * CGFloat(Double(d.amount) / Double(total))) }.frame(height: 8)
                                }
                            }
                        }
                    }
                }
                .frame(width: 360)
            }
            HStack(alignment: .top, spacing: 16) {
                card("時間帯別売上") {
                    Chart(p.hourlyChartData, id: \.self) { d in BarMark(x: .value("時間", d.hour), y: .value("売上", d.sales)).foregroundStyle(NFColor.iris) }
                        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 8)) }
                        .frame(height: 200)
                }
                card("曜日別売上") {
                    Chart(p.weekdayChartData, id: \.self) { d in BarMark(x: .value("曜日", d.weekday), y: .value("売上", d.sales)).foregroundStyle(NFColor.royal) }
                        .frame(height: 200)
                }
                card("カテゴリ別売上 TOP8") {
                    if p.categoryChartData.isEmpty { Text("商品データがありません").font(.system(size: 13)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(30) }
                    else {
                        Chart(p.categoryChartData, id: \.self) { d in BarMark(x: .value("売上", d.sales), y: .value("カテゴリ", d.category)).foregroundStyle(NFColor.wisteria) }
                            .frame(height: 200)
                    }
                }
            }
        }
    }

    private func th(_ cols: [String]) -> some View {
        HStack(spacing: 8) {
            ForEach(Array(cols.enumerated()), id: \.offset) { i, c in
                Text(c).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity, alignment: i == 0 ? .leading : .trailing)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }
    private func tr(_ cols: [String], colors: [Color?] = [], bold: Int? = nil) -> some View {
        HStack(spacing: 8) {
            ForEach(Array(cols.enumerated()), id: \.offset) { i, c in
                Text(c).font(.system(size: 13, weight: i == 0 || i == bold ? .bold : .regular)).lineLimit(1)
                    .foregroundColor((i < colors.count ? colors[i] : nil) ?? (i == 0 ? NFColor.navy : NFColor.ink))
                    .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : .trailing)
            }
        }
        .monospacedDigit().padding(.vertical, 7)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 0.5) }
    }
    private func empty(_ t: String) -> some View { Text(t).font(.system(size: 13)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(24) }

    private func storeCard(_ p: NRPayload) -> some View {
        card("店舗別比較") {
            th(["店舗", "売上", "会計件数", "客数", ""])
            ForEach(p.storeComparison, id: \.self) { s in
                HStack(spacing: 8) {
                    Text(s.name).fontWeight(.bold).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                    Text(NT.yen(s.sales)).frame(maxWidth: .infinity, alignment: .trailing)
                    Text("\(s.count)件").frame(maxWidth: .infinity, alignment: .trailing)
                    Text("\(s.guests)名").frame(maxWidth: .infinity, alignment: .trailing)
                    Button("この店舗を見る") { model.store = s.id; Task { await model.refresh() } }.font(.system(size: 12, weight: .bold)).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.system(size: 13)).monospacedDigit().padding(.vertical, 7)
                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 0.5) }
            }
        }
    }

    private func productCard(_ p: NRPayload) -> some View {
        card("商品別売上 TOP20") {
            if p.productRows.isEmpty { empty("商品データがありません") } else {
                th(["商品名", "数量", "売上", "原価", "粗利"])
                ForEach(p.productRows, id: \.self) { r in
                    tr([r.name, "\(r.quantity)", NT.yen(r.revenue), r.cost.map { NT.yen($0) } ?? "—", r.cost.map { NT.yen(r.revenue - $0) } ?? "—"])
                }
            }
        }
    }

    private func staffCard(_ p: NRPayload) -> some View {
        card("スタッフ別売上") {
            if p.staffRows.isEmpty { empty("スタッフ別データがありません") } else {
                th(["スタッフ", "件数", "売上", "客単価"])
                ForEach(p.staffRows, id: \.self) { r in tr([r.name, "\(r.count)件", NT.yen(r.sales), NT.yen(r.avgSpend)]) }
            }
        }
    }

    private func sourceCard(_ p: NRPayload) -> some View {
        card("予約経路別") {
            if p.sourceRows.isEmpty { empty("予約データがありません") } else {
                th(["経路", "件数", "来店完了率", "キャンセル率"])
                ForEach(p.sourceRows, id: \.self) { r in tr([r.name, "\(r.total)件", pct(r.completionRate), pct(r.cancelRate)]) }
            }
        }
    }

    private func dailyCard(_ p: NRPayload) -> some View {
        card("日別売上明細") {
            th(["日付", "総売上", "返金", "純売上"])
            ForEach(p.dailyRows.reversed(), id: \.self) { r in
                tr(["\(NPDate.slash(r.date))（\(weekday(r.date))）", NT.yen(r.gross), r.refund > 0 ? "−\(NT.yen(r.refund))" : NT.yen(0), NT.yen(r.net)],
                   colors: [nil, nil, r.refund > 0 ? NFColor.danger : nil, NFColor.navy], bold: 3)
            }
        }
    }

    private func weekday(_ d: String) -> String {
        let w = ["日", "月", "火", "水", "木", "金", "土"]
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return w[max(0, min(6, cal.component(.weekday, from: NPDate.date(d)) - 1))]
    }

    private func exportCsv(_ p: NRPayload) {
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/reports/export?from=\(p.from)&to=\(p.to)")
                if let url = NLShare.tempFile("report_\(p.from)_\(p.to).csv", data: data) { NLShare.present(url: url) }
            } catch {
                model.error = (error as? NativeAPIError)?.message ?? "CSVを出せませんでした"
            }
        }
    }
}
