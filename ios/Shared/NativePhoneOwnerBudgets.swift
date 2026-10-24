import SwiftUI

// iPhone の店長・オーナー：予算管理（Web の /app/budgets）と日別予算（Web の /app/budgets/daily）。2026-10-25 Ronnie「iPhone も native に」
// サーバーは iPad と同じ（返事の形は変えない）：
//   GET ?part=budgets&month=YYYY-MM ／ ?part=budgetDaily&month= ／ ?part=budgetAuto&month=（履歴・天気から日別予算の案）
//   POST budgetTargetSave（今月の売上目標。保存すると曜日の売上で日別にも分ける）／ budgetUpsert（店舗の予算の編集）／ budgetDailySave（日別）
// 予算管理：月の切り替え・今月の売上目標（実績・達成率・着地予測）・ご予約から見込む売上・店舗別の予算と実績（編集）
// 日別予算：月の切り替え・目標の入力・履歴から自動作成・1 日ずつテンキーで入力（前日と同じ・全部の日に）・保存
// PDF で出す・一時保存は iPad・Web で。

// MARK: - 予算管理（月）

/// GET ?part=budgets の中身（使うところだけ）
struct NOSBudgets: Decodable {
    struct Budget: Decodable, Hashable {
        let salesBudget: Double
        let costRateTarget: Double?
        let laborRateTarget: Double?
        let profitTarget: Double?
        let guestsTarget: Double?
        let avgSpendTarget: Double?
        let note: String?
    }
    struct Actual: Decodable, Hashable {
        let sales: Double
        let guests: Double
        let avgSpend: Double
        let costRate: Double
        let laborRate: Double
        let profit: Double
    }
    struct Row: Decodable, Identifiable, Hashable {
        var id: String { storeId ?? "__all__" }
        let storeId: String?
        let storeName: String
        let editable: Bool
        let budget: Budget?
        let actual: Actual
        let achievementPct: Double?
        let forecast: Double?
        let forecastPct: Double?
    }
    struct Target: Decodable {
        let storeId: String?
        let storeName: String
        let editable: Bool
        let amount: Double?
        let sales: Double
        let achievementPct: Double?
    }
    struct Part: Decodable { let count: Double; let guests: Double; let amount: Double }
    struct Booking: Decodable { let course: Part; let seatOnly: Part; let total: Double }
    struct Unit: Decodable { let unit: Double; let basis: String; let samples: Double }

    let month: String
    let monthFirst: String
    let monthLast: String
    let elapsedDays: Int
    let daysInMonth: Int
    let canEdit: Bool
    let includeTakeoutGuests: Bool?
    let rows: [Row]
    let target: Target
    let monthLabel: String
    let forecastFrom: String?
    let booking: Booking?
    let singleUnit: Unit?
    let landing: Double?
    let seatOnlyUnitDays: Int?
}

/// 予算の保存の返事
struct NOSSaveResult { let ok: Bool; let error: String?; let queued: Int }

private func nosPost(_ body: [String: Any]) async -> NOSSaveResult {
    if NativePreview.current != nil { return NOSSaveResult(ok: true, error: nil, queued: 0) }
    let r = await NSPApi.postJSON(body)
    let queued = (r.json?["queued"] as? Int) ?? (r.json?["queued"] as? Double).map { Int($0) } ?? 0
    return NOSSaveResult(ok: r.ok, error: r.error, queued: queued)
}

@MainActor
final class NPOBudgetsModel: ObservableObject {
    @Published var payload: NOSBudgets?
    /// "yyyy-MM"
    @Published var month: String
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false

    init(route: NativeModuleRoute? = nil) {
        let m = route?.query("month") ?? ""
        month = NOS.isMonth(m) ? m : String(NOS.today.prefix(7))
    }

    var isCurrent: Bool { payload?.month == month }

    func shift(_ d: Int) {
        month = NOS.shiftMonth(month, d)
        Task { await refresh() }
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let m = month
        if !isCurrent, let saved = NativeModuleAPI.cached(NOSBudgets.self, part: "budgets", query: ["month": m]) { payload = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOSBudgets.self, part: "budgets", query: ["month": m])
            guard m == month else { return }
            payload = p
            error = nil
        } catch {
            guard m == month else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 今月の売上目標を保存（iPad・Web と同じ。店舗のときは曜日の売上で日別予算も作る）
    func saveTarget(_ amount: Int) async -> Bool {
        guard let p = payload else { return false }
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["type": "budgetTargetSave", "month": p.monthFirst, "amount": amount]
        body["storeId"] = p.target.storeId ?? NSNull()
        let r = await nosPost(body)
        guard r.ok else { error = r.error ?? "保存できませんでした"; return false }
        toast = r.queued > 0 ? "売上目標を保存しました。曜日ごとの売上に合わせて日別予算も作りました" : "売上目標を保存しました"
        await refresh()
        return true
    }

    /// 店舗の予算の編集（Web の BudgetForm と同じ項目）
    func saveBudget(row: NOSBudgets.Row, sales: Double, cost: Double?, labor: Double?, profit: Double?, guests: Double?, avg: Double?, note: String) async -> String? {
        guard let p = payload else { return "読み込み中です" }
        busy = true
        defer { busy = false }
        func opt(_ v: Double?) -> Any { v.map { $0 as Any } ?? NSNull() }
        var body: [String: Any] = [
            "type": "budgetUpsert", "month": p.monthFirst, "salesBudget": sales,
            "costRateTarget": opt(cost), "laborRateTarget": opt(labor), "profitTarget": opt(profit),
            "guestsTarget": opt(guests), "avgSpendTarget": opt(avg), "note": note,
        ]
        body["storeId"] = row.storeId ?? NSNull()
        let r = await nosPost(body)
        guard r.ok else { return r.error ?? "保存できませんでした" }
        toast = "予算を保存しました"
        await refresh()
        return nil
    }
}

struct NativePhoneOwnerBudgetsView: View {
    @ObservedObject var model: NPOBudgetsModel
    let onBack: () -> Void
    let onWeb: (String) -> Void

    @State private var targetOpen = false
    @State private var editing: NOSBudgets.Row?

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "予算管理", subtitle: model.payload?.target.storeName ?? "Budgets", onBack: onBack, trailing: {
                Button { onWeb("/app/budgets/daily?month=\(model.month)") } label: {
                    VStack(spacing: 1) {
                        Image(systemName: "calendar.badge.plus").font(.system(size: 16, weight: .bold))
                        Text("日別予算").font(.system(size: 9.5, weight: .heavy)).lineLimit(1)
                    }
                    .foregroundColor(.white).frame(width: 56, height: 44)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("日別予算を開く")
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        ScrollView {
                            VStack(spacing: 12) {
                                NOSMonthBar(month: model.month) { model.shift($0) }
                                Group {
                                    targetCard(p)
                                    if p.booking != nil || p.landing != nil { bookingCard(p) }
                                    HStack {
                                        Text("店舗別の予算と実績").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                                        Spacer()
                                        Text("経過 \(p.elapsedDays)／\(p.daysInMonth)日").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit()
                                    }
                                    .padding(.horizontal, 4).padding(.top, 4)
                                    ForEach(p.rows) { r in rowCard(r, canEdit: p.canEdit) }
                                }
                                .opacity(model.isCurrent ? 1 : 0.45)
                                Text("売上実績は純売上（会計済みの合計 − 返金）。着地予測 ＝ 実績 ÷ 経過日数 × 月の日数。原価・人件費は「レポート」と同じ概算です。全社の行は本社の管理者だけが編集できます。" + (p.includeTakeoutGuests == false ? "客数は店内飲食だけで数えています。" : ""))
                                    .font(.system(size: 10.5)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 40)
                        }
                        .refreshable { await model.refresh() }
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .sheet(isPresented: $targetOpen) {
            if let p = model.payload {
                NOSAmountSheet(title: "\(p.monthLabel)の売上目標", caption: p.target.storeName, initial: p.target.amount.map { Int($0.rounded()) },
                               note: p.target.storeId != nil ? "保存すると、直近8週の曜日ごとの売上に合わせて日別予算を自動で作ります（よく売れる曜日ほど多め）。" : "",
                               okLabel: "目標を保存", onDone: { v in
                                   Task { if await model.saveTarget(v) { targetOpen = false } }
                               }, onCancel: { targetOpen = false })
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
            }
        }
        .sheet(item: $editing) { r in
            NOSBudgetEditSheet(model: model, row: r, onClose: { editing = nil })
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
        }
    }

    // MARK: 今月の売上目標

    private func forecast(_ p: NOSBudgets) -> NOSBudgets.Row? {
        p.rows.first { $0.storeId == p.target.storeId }
    }

    private func targetCard(_ p: NOSBudgets) -> some View {
        let t = p.target
        let pct = t.achievementPct ?? (t.amount.map { $0 > 0 ? t.sales / $0 * 100 : 0 })
        let f = forecast(p)
        return NPOCard {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "target").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                Text("\(p.monthLabel)の売上目標").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                Spacer(minLength: 4)
                if t.editable {
                    Button { targetOpen = true } label: {
                        Text(t.amount == nil ? "目標を入れる" : "変更").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.purpleDeep)
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(Capsule().fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.busy)
                }
            }
            if let a = t.amount {
                Text(NOS.yen(a)).font(.system(size: 24, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 13, weight: .bold))
                    Text("未設定").font(.system(size: 16, weight: .heavy))
                }
                .foregroundColor(NT.danger)
            }
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("実績（純売上）").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NOS.yen(t.sales)).font(.system(size: 28, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("達成率").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NOS.pct(pct)).font(.system(size: 24, weight: .heavy)).foregroundColor(NOS.tone(pct)).monospacedDigit()
                }
            }
            progress(pct, elapsed: Double(p.elapsedDays) / Double(max(1, p.daysInMonth)))
            if let f, let fv = f.forecast {
                HStack(spacing: 6) {
                    Text("着地予測").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                    Text(NOS.yen(fv)).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    if let fp = f.forecastPct { NOSBadge(text: "目標の\(String(format: "%.0f", fp))%", color: NOS.tone(fp)) }
                    Spacer()
                }
            }
            if !t.editable && t.amount == nil {
                Text("目標は店長以上が入れられます").font(.system(size: 11)).foregroundColor(NT.ink3)
            }
        }
    }

    /// 達成率の棒（うすい線＝今日までの日数の割合）
    private func progress(_ pct: Double?, elapsed: Double) -> some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(NT.page)
                Capsule().fill(NOS.tone(pct)).frame(width: max(6, g.size.width * CGFloat(min(1, max(0, (pct ?? 0) / 100)))))
                Rectangle().fill(NT.ink3).frame(width: 2, height: 16).offset(x: g.size.width * CGFloat(min(1, max(0, elapsed))) - 1)
            }
        }
        .frame(height: 12)
        .accessibilityLabel("達成率 \(NOS.pct(pct))")
    }

    // MARK: ご予約から見込む売上

    private func bookingCard(_ p: NOSBudgets) -> some View {
        NPOCard(title: "ご予約から見込む売上", trailing: "自動計算") {
            if let b = p.booking {
                if let from = p.forecastFrom {
                    Text("\(NOS.md(from))〜\(NOS.md(p.monthLast)) に入っているご予約（キャンセル・来店済みを除く）").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                bookingRow("コース", "\(NOS.int(b.course.count))件・\(NOS.int(b.course.guests))名", b.course.amount)
                bookingRow("席のみ", "\(NOS.int(b.seatOnly.count))件・\(NOS.int(b.seatOnly.guests))名", b.seatOnly.amount)
                Rectangle().fill(NT.line).frame(height: 1)
                HStack {
                    Text("予約見込み 合計").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                    Spacer()
                    Text(NOS.yen(b.total)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                }
                if let l = p.landing {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("実績 ＋ 予約見込み").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3)
                        HStack(spacing: 6) {
                            Text(NOS.yen(l)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                            if let a = p.target.amount, a > 0 {
                                let pct = l / a * 100
                                NOSBadge(text: "目標の\(String(format: "%.0f", pct))%", color: NOS.tone(pct))
                            }
                            Spacer()
                        }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac.opacity(0.6)))
                }
            } else {
                Text("過去の月のため、これからのご予約はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
        }
    }

    private func bookingRow(_ title: String, _ count: String, _ amount: Double) -> some View {
        HStack {
            Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            Text(count).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
            Spacer()
            Text(NOS.yen(amount)).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
        }
    }

    // MARK: 店舗別

    private func rowCard(_ r: NOSBudgets.Row, canEdit: Bool) -> some View {
        let b = r.budget
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return NPOCard {
            HStack(spacing: 6) {
                Text(r.storeName).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                if r.storeId == nil { NOSBadge(text: "全社", color: NT.topBar) }
                Spacer(minLength: 4)
                if canEdit && r.editable {
                    Button { editing = r } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil").font(.system(size: 12, weight: .bold))
                            Text("編集").font(.system(size: 13, weight: .heavy))
                        }
                        .foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(Capsule().fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("売上実績").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NOS.yen(r.actual.sales)).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("予算 \(NOS.yen(b?.salesBudget))").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                    if let a = r.achievementPct { NOSBadge(text: "達成 \(String(format: "%.1f", a))%", color: NOS.tone(a)) } else { Text("予算なし").font(.system(size: 11)).foregroundColor(NT.ink3) }
                }
            }
            if let f = r.forecast {
                HStack(spacing: 6) {
                    Text("着地予測").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NOS.yen(f)).font(.system(size: 13.5, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    if let fp = r.forecastPct { NOSBadge(text: "\(String(format: "%.0f", fp))%", color: NOS.tone(fp)) }
                    Spacer()
                }
            }
            LazyVGrid(columns: cols, spacing: 6) {
                pair("原価率", target: b?.costRateTarget.map { NOS.pct($0) } ?? "—", actual: NOS.pct(r.actual.costRate), over: b?.costRateTarget.map { r.actual.costRate > $0 } ?? false)
                pair("人件費率", target: b?.laborRateTarget.map { NOS.pct($0) } ?? "—", actual: NOS.pct(r.actual.laborRate), over: b?.laborRateTarget.map { r.actual.laborRate > $0 } ?? false)
                pair("利益", target: NOS.yen(b?.profitTarget), actual: NOS.yen(r.actual.profit), over: r.actual.profit < 0)
                pair("客数", target: b?.guestsTarget.map { "\(NOS.int($0))名" } ?? "—", actual: "\(NOS.int(r.actual.guests))名", over: false)
                pair("客単価", target: NOS.yen(b?.avgSpendTarget), actual: NOS.yen(r.actual.avgSpend), over: false)
            }
            if let n = b?.note, !n.isEmpty {
                Text("メモ：\(n)").font(.system(size: 11.5)).foregroundColor(NT.ink2)
            }
        }
    }

    /// 目標 / 実績 の小さな箱
    private func pair(_ label: String, target: String, actual: String, over: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.ink3)
            Text(actual).font(.system(size: 14, weight: .heavy)).foregroundColor(over ? NT.danger : NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            Text("目標 \(target)").font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
    }
}

/// 店舗の予算の編集（Web の BudgetForm と同じ項目）
struct NOSBudgetEditSheet: View {
    @ObservedObject var model: NPOBudgetsModel
    let row: NOSBudgets.Row
    let onClose: () -> Void

    @State private var sales = ""
    @State private var cost = ""
    @State private var labor = ""
    @State private var profit = ""
    @State private var guests = ""
    @State private var avg = ""
    @State private var note = ""
    @State private var problem: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("売上")) {
                    field("売上予算", unit: "円", text: $sales, pad: .numberPad)
                }
                Section(header: Text("目標（空欄なら目標なし）")) {
                    field("原価率", unit: "%", text: $cost, pad: .decimalPad)
                    field("人件費率", unit: "%", text: $labor, pad: .decimalPad)
                    field("利益", unit: "円", text: $profit, pad: .numbersAndPunctuation)
                    field("客数", unit: "名", text: $guests, pad: .numberPad)
                    field("客単価", unit: "円", text: $avg, pad: .numberPad)
                }
                Section(header: Text("メモ")) {
                    TextField("メモ", text: $note, axis: .vertical).lineLimit(1...4)
                }
                if let problem {
                    Section { Text(problem).foregroundColor(NT.danger).font(.system(size: 14, weight: .bold)) }
                }
            }
            .navigationTitle("\(row.storeName)の予算")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.busy ? "保存中…" : "保存") { Task { await save() } }
                        .font(.system(size: 16, weight: .bold))
                        .disabled(model.busy)
                }
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            let b = row.budget
            sales = NOS.plain(b?.salesBudget ?? 0)
            cost = NOS.plain(b?.costRateTarget)
            labor = NOS.plain(b?.laborRateTarget)
            profit = NOS.plain(b?.profitTarget)
            guests = NOS.plain(b?.guestsTarget)
            avg = NOS.plain(b?.avgSpendTarget)
            note = b?.note ?? ""
        }
    }

    private func field(_ label: String, unit: String, text: Binding<String>, pad: UIKeyboardType) -> some View {
        HStack {
            Text(label).font(.system(size: 15, weight: .semibold))
            Spacer()
            TextField("—", text: text)
                .keyboardType(pad)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 17, weight: .bold)).monospacedDigit()
                .frame(maxWidth: 170)
            Text(unit).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3).frame(width: 22, alignment: .leading)
        }
    }

    private func save() async {
        problem = nil
        guard let s = NOS.num(sales), s >= 0 else { problem = "売上予算を入れてください"; return }
        let c = NOS.num(cost), l = NOS.num(labor)
        if let c, c < 0 || c > 100 { problem = "原価率は 0〜100% で入れてください"; return }
        if let l, l < 0 || l > 100 { problem = "人件費率は 0〜100% で入れてください"; return }
        if let e = await model.saveBudget(row: row, sales: s, cost: c, labor: l, profit: NOS.num(profit), guests: NOS.num(guests), avg: NOS.num(avg), note: note) {
            problem = e
        } else {
            onClose()
        }
    }
}

/// key "budgets" の画面（NativePhoneOwnerScreen から）
struct NativePhoneOwnerBudgetsScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPOBudgetsModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NPOBudgetsModel(route: route))
    }

    var body: some View {
        NativePhoneOwnerBudgetsView(model: model, onBack: { state.closePhoneOwnerModule() }, onWeb: { state.leaveNativePhone(to: $0) })
            .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }
}

// MARK: - 日別予算

/// GET ?part=budgetDaily の中身
struct NOSBudgetDaily: Decodable {
    struct Store: Decodable { let id: String; let name: String }
    let store: Store
    let month: String
    let values: [String: Double]
    let canEdit: Bool
    let target: Double?
}

/// GET ?part=budgetAuto の中身（履歴・天気から作った日別予算の案）
struct NOSBudgetAuto: Decodable {
    struct Day: Decodable, Hashable { let date: String; let amount: Double; let weather: String? }
    let month: String
    let values: [String: Double]
    let days: [Day]?
    let total: Double
    let basis: String?
}

/// 天気のアイコン名 → SF Symbols
func nosWeatherSymbol(_ icon: String?) -> String? {
    switch icon {
    case "sun": return "sun.max.fill"
    case "partly": return "cloud.sun.fill"
    case "cloud": return "cloud.fill"
    case "fog": return "cloud.fog.fill"
    case "drizzle": return "cloud.drizzle.fill"
    case "rain": return "cloud.rain.fill"
    case "snow": return "cloud.snow.fill"
    case "thunder": return "cloud.bolt.rain.fill"
    default: return nil
    }
}

@MainActor
final class NPOBudgetDailyModel: ObservableObject {
    @Published var payload: NOSBudgetDaily?
    /// "yyyy-MM"
    @Published var month: String
    /// 画面で直している日別の金額（保存するまでこの端末だけ）
    @Published var values: [String: Int] = [:]
    /// 最後に読んだ・保存した金額（直したかどうかを見る）
    @Published var saved: [String: Int] = [:]
    @Published var auto: NOSBudgetAuto?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false

    init(route: NativeModuleRoute? = nil) {
        let m = route?.query("month") ?? ""
        month = NOS.isMonth(m) ? m : String(NOS.today.prefix(7))
    }

    var days: [String] { NOS.monthDays(month) }
    var total: Int { values.values.reduce(0, +) }
    var dirty: Bool { values != saved }
    var canEdit: Bool { payload?.canEdit ?? false }
    var isCurrent: Bool { payload?.month == month }

    private static func ints(_ d: [String: Double]) -> [String: Int] {
        var out: [String: Int] = [:]
        for (k, v) in d where v > 0 { out[k] = Int(v.rounded()) }
        return out
    }

    func shift(_ d: Int) {
        month = NOS.shiftMonth(month, d)
        auto = nil
        Task { await refresh(resetValues: true) }
    }

    /// 読み直す。resetValues なら画面の金額も読んだ値に戻す（直している途中は戻さない）
    func refresh(resetValues: Bool = false) async {
        if NativePreview.current != nil { return }
        let m = month
        if !isCurrent, let c = NativeModuleAPI.cached(NOSBudgetDaily.self, part: "budgetDaily", query: ["month": m]), c.month == m {
            payload = c
            values = Self.ints(c.values)
            saved = values
        }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOSBudgetDaily.self, part: "budgetDaily", query: ["month": m])
            guard m == month else { return }
            let fresh = Self.ints(p.values)
            if resetValues || !dirty || payload?.month != p.month {
                values = fresh
                saved = fresh
            } else {
                saved = fresh
            }
            payload = p
            error = nil
        } catch {
            guard m == month else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    func set(_ date: String, _ amount: Int) {
        if amount > 0 { values[date] = amount } else { values.removeValue(forKey: date) }
    }

    func fillAll(_ amount: Int) {
        guard amount > 0 else { return }
        var next: [String: Int] = [:]
        for d in days { next[d] = amount }
        values = next
    }

    /// 履歴（曜日・去年の同じ月・天気予報）から日別予算の案を入れる（保存はしない）
    func runAuto() async {
        guard canEdit else { return }
        if NativePreview.current != nil { return }
        busy = true
        defer { busy = false }
        do {
            let a = try await NativeModuleAPI.get(NOSBudgetAuto.self, part: "budgetAuto", query: ["month": month])
            guard a.month == month else { return }
            if a.values.isEmpty {
                error = "売上の記録がまだ無いので自動で作れません（直近8週の会計がありません）"
                return
            }
            values = Self.ints(a.values)
            auto = a
            toast = "履歴から作りました（合計 \(NOS.yen(a.total))）。見直してから保存してください"
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 今月の売上目標を保存 → サーバーが曜日の売上で日別に分ける → 読み直す
    func saveTarget(_ amount: Int) async -> Bool {
        guard canEdit, let p = payload else { return false }
        guard amount > 0 else { error = "目標の金額を入れてください"; return false }
        busy = true
        defer { busy = false }
        let r = await nosPost(["type": "budgetTargetSave", "storeId": p.store.id, "month": month + "-01", "amount": amount])
        guard r.ok else { error = r.error ?? "保存できませんでした"; return false }
        auto = nil
        await refresh(resetValues: true)
        toast = "目標 \(NT.yen(amount)) を保存し、曜日の売上で日別に分けました"
        return true
    }

    /// 日別予算を保存（Web と同じ。月の合計は月の予算にも入る）
    func save() async {
        guard canEdit, !busy else { return }
        busy = true
        defer { busy = false }
        let body = values
        let r = await nosPost(["type": "budgetDailySave", "month": month, "values": body])
        guard r.ok else { error = r.error ?? "保存できませんでした"; return }
        saved = body
        auto = nil
        toast = "保存しました（\(NOS.ymLabel(month)) 合計 \(NT.yen(body.values.reduce(0, +)))）"
        await refresh()
    }
}

/// テンキーで直している日
private struct NOSEditDay: Identifiable, Hashable { let date: String; var id: String { date } }

struct NativePhoneOwnerBudgetDailyView: View {
    @ObservedObject var model: NPOBudgetDailyModel
    let onBack: () -> Void
    let onWeb: (String) -> Void

    @State private var editDay: NOSEditDay?
    @State private var targetOpen = false
    /// 保存していないのに画面を離れようとしたとき
    @State private var pendingLeave: (() -> Void)?

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "日別予算", subtitle: model.payload?.store.name ?? "Daily budget", onBack: { leave(onBack) }, trailing: {
                Button { leave { onWeb("/app/budgets?month=\(model.month)") } } label: {
                    VStack(spacing: 1) {
                        Image(systemName: "chart.bar.doc.horizontal").font(.system(size: 16, weight: .bold))
                        Text("予算管理").font(.system(size: 9.5, weight: .heavy)).lineLimit(1)
                    }
                    .foregroundColor(.white).frame(width: 56, height: 44)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("予算管理を開く")
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if model.payload != nil {
                        ScrollView {
                            VStack(spacing: 12) {
                                NOSMonthBar(month: model.month) { d in leave { model.shift(d) } }
                                Group {
                                    targetCard
                                    dayList
                                }
                                .opacity(model.isCurrent ? 1 : 0.45)
                                if !model.canEdit {
                                    Text("見るだけです（日別予算は店長以上が入れられます）").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                                }
                            }
                            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 24)
                        }
                        .refreshable { await model.refresh() }
                        .safeAreaInset(edge: .bottom) { if model.canEdit { saveBar } }
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh(resetValues: true) } }
                    }
                }
            })
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh(resetValues: true) }
        .sheet(item: $editDay) { e in
            NOSDayEditor(model: model, date: e.date, onClose: { editDay = nil })
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $targetOpen) {
            NOSAmountSheet(title: "今月の売上目標", caption: "\(NOS.ymLabel(model.month))・\(model.payload?.store.name ?? "")", initial: model.payload?.target.map { Int($0.rounded()) },
                           note: "保存すると、直近8週の曜日ごとの売上に合わせて日別予算を自動で作ります（いま画面で直している金額は入れ替わります）。",
                           okLabel: "目標を保存して日別に分ける", onDone: { v in
                               Task { if await model.saveTarget(v) { targetOpen = false } }
                           }, onCancel: { targetOpen = false })
            .presentationDetents([.large])
            .environment(\.colorScheme, .light)
        }
        .confirmationDialog("保存していない変更があります", isPresented: Binding(get: { pendingLeave != nil }, set: { if !$0 { pendingLeave = nil } }), titleVisibility: .visible) {
            Button("保存してから移動") {
                let next = pendingLeave
                pendingLeave = nil
                Task { await model.save(); if !model.dirty { next?() } }
            }
            Button("保存せずに移動", role: .destructive) {
                let next = pendingLeave
                pendingLeave = nil
                next?()
            }
            Button("やめる", role: .cancel) { pendingLeave = nil }
        } message: {
            Text("日別予算を直したまま、まだ保存していません。")
        }
    }

    /// 直したまま離れるときは確かめる
    private func leave(_ action: @escaping () -> Void) {
        if model.canEdit && model.dirty { pendingLeave = action } else { action() }
    }

    // MARK: 今月の売上目標

    private var targetCard: some View {
        let target = model.payload?.target
        let diff = target.map { Double(model.total) - $0 }
        return NPOCard {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "target").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                Text("今月の売上目標").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
            }
            if let t = target {
                Text(NOS.yen(t)).font(.system(size: 26, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 13, weight: .bold))
                    Text("未設定").font(.system(size: 16, weight: .heavy))
                }
                .foregroundColor(NT.danger)
            }
            HStack(spacing: 6) {
                Text("日別の合計").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Text(NT.yen(model.total)).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                if let d = diff, abs(d) >= 1 {
                    Text("目標との差 \(d > 0 ? "+" : "−")\(NOS.yen(abs(d)))").font(.system(size: 11.5, weight: .bold)).foregroundColor(d > 0 ? NT.ok : NT.danger).monospacedDigit()
                }
                Spacer(minLength: 0)
            }
            if model.canEdit {
                HStack(spacing: 8) {
                    actionButton(target == nil ? "目標を入れる" : "目標を変える", en: "Monthly target", icon: "target") { targetOpen = true }
                    actionButton("履歴から自動作成", en: "Auto from history", icon: "wand.and.stars") { Task { await model.runAuto() } }
                }
            }
            if let a = model.auto {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "info.circle").font(.system(size: 11, weight: .bold))
                    Text("自動案：\(a.basis ?? "曜日・去年の同じ月・天気予報から")。合計 \(NOS.yen(a.total))。直してから「保存する」")
                        .font(.system(size: 11, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                }
                .foregroundColor(NT.ink3)
            }
        }
    }

    private func actionButton(_ ja: String, en: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13, weight: .bold))
                VStack(alignment: .leading, spacing: 0) {
                    Text(ja).font(.system(size: 13, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.8)
                    Text(en).font(.system(size: 9, weight: .semibold)).opacity(0.7).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .foregroundColor(NT.purpleDeep)
            .padding(.horizontal, 12).frame(maxWidth: .infinity).frame(height: 46)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy)
    }

    // MARK: 日の一覧

    private var dayList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("日付").frame(width: 70, alignment: .leading)
                Spacer()
                Text("売上予算（税込）")
            }
            .font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3)
            .padding(.horizontal, 14).frame(height: 34)
            .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
            ForEach(model.days, id: \.self) { d in dayRow(d) }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func dayRow(_ d: String) -> some View {
        let w = NOS.weekday(d)
        let tone = w == 0 ? NT.danger : w == 6 ? NT.purple : NT.ink
        let v = model.values[d] ?? 0
        let changed = (model.saved[d] ?? 0) != v
        let isToday = d == NOS.today
        let weather = nosWeatherSymbol(model.auto?.days?.first { $0.date == d }?.weather)
        return Button { if model.canEdit { editDay = NOSEditDay(date: d) } } label: {
            HStack(spacing: 8) {
                Text("\(Int(d.suffix(2)) ?? 0)").font(.system(size: 16, weight: .heavy)).foregroundColor(tone).monospacedDigit().frame(width: 28, alignment: .leading)
                Text(NOS.weekdays[w]).font(.system(size: 13, weight: .bold)).foregroundColor(w == 0 || w == 6 ? tone : NT.ink3)
                if isToday { NOSBadge(text: "今日", color: NT.purple) }
                if let weather { Image(systemName: weather).font(.system(size: 13)).foregroundColor(NT.purple) }
                Spacer(minLength: 4)
                if changed { Circle().fill(NT.warn).frame(width: 7, height: 7) }
                Text(v > 0 ? NT.yen(v) : "未入力").font(.system(size: 16, weight: .heavy)).foregroundColor(v > 0 ? NT.ink : NT.line).monospacedDigit()
                if model.canEdit { Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3) }
            }
            .padding(.horizontal, 14).frame(height: 48)
            .background(isToday ? NT.lilac.opacity(0.5) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.6)).frame(height: 1) }
    }

    // MARK: 下の保存バー

    private var saveBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(model.dirty ? "月合計（未保存）" : "月合計").font(.system(size: 11, weight: .bold)).foregroundColor(model.dirty ? NT.warn : NT.ink3)
                Text(NT.yen(model.total)).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            }
            Spacer(minLength: 4)
            Button { Task { await model.save() } } label: {
                HStack(spacing: 6) {
                    if model.busy { ProgressView().tint(.white) } else { Image(systemName: "square.and.arrow.down").font(.system(size: 15, weight: .bold)) }
                    Text(model.busy ? "保存中…" : "保存する").font(.system(size: 16, weight: .heavy))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 22).frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(model.dirty ? NT.purple : NT.ink3))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.busy || !model.dirty)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Color.white.shadow(color: .black.opacity(0.08), radius: 8, y: -2).ignoresSafeArea(edges: .bottom))
    }
}

/// 1 日の金額のテンキー（前日と同じ・全部の日に・決定して次の日へ）。シートは開いたまま日だけ進む
private struct NOSDayEditor: View {
    @ObservedObject var model: NPOBudgetDailyModel
    @State var date: String
    let onClose: () -> Void

    var body: some View {
        let days = model.days
        let i = days.firstIndex(of: date) ?? 0
        let prev: Int? = i > 0 ? model.values[days[i - 1]] : nil
        let next: String? = i + 1 < days.count ? days[i + 1] : nil
        var goNext: ((Int) -> Void)? = nil
        if let n = next {
            goNext = { (v: Int) in
                model.set(date, v)
                date = n
            }
        }
        return NOSAmountSheet(
            title: NOS.mdw(date), caption: "売上予算（税込）", initial: model.values[date],
            note: "0 を入れて決定すると、その日は未入力に戻ります。",
            okLabel: "決定", previous: prev,
            onNext: goNext,
            onFillAll: { (v: Int) in
                model.fillAll(v)
                onClose()
            },
            onDone: { (v: Int) in
                model.set(date, v)
                onClose()
            },
            onCancel: onClose
        )
        .id(date)
    }
}

/// key "budgetDaily" の画面（NativePhoneOwnerScreen から）
struct NativePhoneOwnerBudgetDailyScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPOBudgetDailyModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NPOBudgetDailyModel(route: route))
    }

    var body: some View {
        NativePhoneOwnerBudgetDailyView(model: model, onBack: { state.closePhoneOwnerModule() }, onWeb: { state.leaveNativePhone(to: $0) })
            .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }
}
