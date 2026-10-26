import SwiftUI

// iPhone の店長・オーナー：店舗日次締め・開店チェックリスト・売上の内訳（Web の /app/cash の下の段と /app/cash/close の下の段。2026-10-25 Ronnie「101% native」）
// 前は「Web の画面で」（/app/cash?web=1・/app/cash/close?web=1）だったもの。サーバー：GET part=cashDay&period=day|month&date= ／ POST storeDayClose
// （lib/native-modules/cash-day.ts。中身は Web と同じ loadRegisterBoard・loadCloseBreakdown・closeStoreDay）。
// レジ精算レシートのプレビュー・再印刷は印刷のチームの持ち物（iPad のレジから）なので、ここには出さない

/// GET ?part=cashDay の中身
struct NOMCashDay: Decodable {
    struct Item: Decodable, Hashable, Identifiable {
        let key: String
        let label: String
        let valueLabel: String
        /// ok ／ warn ／ info
        let status: String
        let href: String?
        var id: String { key }
    }
    struct Pay: Decodable, Hashable { let method: String; let label: String; let amount: Double }
    struct Reg: Decodable, Hashable { let registerName: String; let expectedCash: Double; let countedCash: Double; let difference: Double; let closedByName: String }
    struct Closing: Decodable {
        let status: String
        let statusLabel: String
        let salesTotal: Double
        let refundTotal: Double
        let netSales: Double
        let discountTotal: Double
        let pettyInTotal: Double
        let pettyOutTotal: Double
        let expectedCash: Double?
        let countedCash: Double?
        let cashDifference: Double
        let payments: [Pay]
        let registers: [Reg]
    }
    struct CountRow: Decodable, Hashable { let label: String; let orders: Double; let guests: Double; let sales: Double; let items: Double? }
    struct ItemRow: Decodable, Hashable { let name: String; let quantity: Double; let sales: Double }
    struct Nomihoudai: Decodable { let planCount: Double; let plans: [ItemRow]; let glasses: Double; let drinks: [ItemRow]; let orders: Double }
    struct Totals: Decodable { let orders: Double; let guests: Double; let sales: Double }
    struct TaxRow: Decodable, Hashable { let rate: Double; let taxable: Double; let tax: Double }
    struct Tax: Decodable { let byRate: [TaxRow]; let orderTax: Double }
    struct Breakdown: Decodable {
        let bySource: [CountRow]
        let byClerk: [CountRow]
        let courses: [ItemRow]
        let foods: [ItemRow]
        let drinks: [ItemRow]
        let nomihoudai: Nomihoudai
        let totals: Totals
        let tax: Tax
    }
    let store: NOMNamed
    let businessDate: String
    let period: String
    let date: String
    let openingItems: [Item]
    let preCloseItems: [Item]
    let alreadyClosed: Bool
    let canClose: Bool
    let closing: Closing?
    let breakdown: Breakdown
}

@MainActor
final class NOMStoreDayModel: ObservableObject {
    @Published var payload: NOMCashDay?
    @Published var period = "day"
    @Published var date = ""
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    init() {
        payload = NativeModuleAPI.cached(NOMCashDay.self, part: "cashDay", query: ["period": "day"])
    }

    func query() -> [String: String] {
        var d = ["period": period]
        if !date.isEmpty { d["date"] = date }
        return d
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let q = query()
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOMCashDay.self, part: "cashDay", query: q)
            guard q == query() else { return }
            payload = p
            period = p.period
            date = p.date
            error = nil
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
    }

    func setPeriod(_ p: String) {
        guard p != period else { return }
        period = p
        date = ""
        Task { await refresh() }
    }

    /// 前後の日・月（未来は出さない）
    func shift(_ n: Int) {
        guard !date.isEmpty else { return }
        date = period == "month" ? NOS.shiftMonth(date, n) : NOS.addDays(date, n)
        Task { await refresh() }
    }

    var canGoNext: Bool {
        guard let p = payload, !date.isEmpty else { return false }
        return period == "month" ? date < String(p.businessDate.prefix(7)) : date < p.businessDate
    }

    /// 店舗日次締め（Web と同じ closeStoreDay。未締めレジが残っていればサーバーが断る）
    func closeDay() async {
        guard let p = payload, !busy else { return }
        busy = true
        defer { busy = false }
        if NativePreview.current != nil { toast = "店舗日次締めを実行しました"; return }
        let r = await NPZApi.post(["type": "storeDayClose", "businessDate": p.businessDate])
        guard r.ok else { error = r.error ?? "店舗日次締めに失敗しました"; return }
        toast = p.alreadyClosed ? "店舗日次締めを更新しました" : "店舗日次締めを実行しました"
        await refresh()
    }
}

// MARK: - 入口の行（入出金・レジクローズの画面から）

/// 入出金の画面の下：開店チェックリスト・店舗日次締め・現金台帳 CSV（前は「Web の画面で開く」）
struct NOMCashDayLinks: View {
    let canExport: Bool
    let onOpen: (String) -> Void
    var onError: (String) -> Void = { _ in }
    @State private var open: NOMStoreDayFocus?

    var body: some View {
        VStack(spacing: 8) {
            row("開店チェックリスト", sub: "開局・本日の予約・出勤予定・重要在庫・未完了タスク", icon: "checklist") { open = NOMStoreDayFocus(kind: .opening) }
            row("店舗日次締め・売上の内訳", sub: "実行前チェック・本日の締めサマリ・予約経路・担当者・メニュー別", icon: "building.columns") { open = NOMStoreDayFocus(kind: .close) }
            if canExport {
                NPOCsvButton(title: "現金台帳 CSV", path: "/app/cash/export", query: ["from": NOS.addDays(NOS.str(Date()), -30), "to": NOS.str(Date())],
                             fileName: "cash.csv", onError: onError)
            }
        }
        .sheet(item: $open) { f in
            NOMStoreDaySheet(focus: f.kind, onClose: { open = nil }, onOpen: { path in
                open = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onOpen(path) }
            })
        }
    }

    private func row(_ title: String, sub: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(NT.purple).frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14.5, weight: NT.strong)).foregroundColor(NT.ink)
                    Text(sub).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 12).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }
}

/// レジクローズのあと：店舗日次締め・売上の内訳（前は「Web の画面で」）
struct NOMStoreDayLink: View {
    let onOpen: (String) -> Void
    @State private var open: NOMStoreDayFocus?

    var body: some View {
        Button { open = NOMStoreDayFocus(kind: .close) } label: {
            HStack(spacing: 10) {
                Image(systemName: "building.columns").font(.system(size: 16, weight: .bold)).foregroundColor(NT.purple).frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text("店舗日次締め・売上の内訳").font(.system(size: 14.5, weight: NT.strong)).foregroundColor(NT.ink)
                    Text("全部のレジを締めたら、店舗日次締めを実行します").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 12).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
        .sheet(item: $open) { f in
            NOMStoreDaySheet(focus: f.kind, onClose: { open = nil }, onOpen: { path in
                open = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onOpen(path) }
            })
        }
    }
}

struct NOMStoreDayFocus: Identifiable {
    enum Kind { case opening, close }
    let id = UUID()
    let kind: Kind
}

// MARK: - 画面

struct NOMStoreDaySheet: View {
    let focus: NOMStoreDayFocus.Kind
    let onClose: () -> Void
    let onOpen: (String) -> Void
    var sample: NOMStoreDayModel? = nil

    var body: some View {
        NOMStoreDayView(model: sample ?? NOMStoreDayModel(), focus: focus, onClose: onClose, onOpen: onOpen)
    }
}

struct NOMStoreDayView: View {
    @StateObject private var model: NOMStoreDayModel
    let focus: NOMStoreDayFocus.Kind
    let onClose: () -> Void
    let onOpen: (String) -> Void
    @State private var confirmClose = false

    init(model: NOMStoreDayModel, focus: NOMStoreDayFocus.Kind, onClose: @escaping () -> Void, onOpen: @escaping (String) -> Void) {
        _model = StateObject(wrappedValue: model)
        self.focus = focus
        self.onClose = onClose
        self.onOpen = onOpen
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOCDetailFrame(title: focus == .opening ? "開店チェックリスト" : "店舗日次締め", subtitle: model.payload.map { "\($0.store.name)・営業日 \(NOS.mdw($0.businessDate))" } ?? "",
                            backLabel: "閉じる", onBack: onClose, trailing: {
                NPZRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }) {
                NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.refresh() }) {
                    if let p = model.payload {
                        if model.payload != nil { NOSErrorBar(error: $model.error) }
                        if focus == .opening {
                            checklist("開店チェックリスト", note: "開局・本日の見込み・重要在庫・未完了タスクをまとめて確認できます", p.openingItems)
                            closeSection(p)
                        } else {
                            closeSection(p)
                            checklist("開店チェックリスト", note: "", p.openingItems)
                        }
                        breakdownSection(p)
                    }
                }
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .confirmationDialog(model.payload?.alreadyClosed == true ? "店舗日次締めを更新しますか？" : "店舗日次締めを実行しますか？", isPresented: $confirmClose, titleVisibility: .visible) {
            Button(model.payload?.alreadyClosed == true ? "更新する" : "実行する", role: .destructive) { Task { await model.closeDay() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("営業日 \(model.payload.map { NOS.mdw($0.businessDate) } ?? "") の全部のレジの締めをまとめて、店舗の 1 日の売上を確定します。未締めのレジがあると実行できません。")
        }
    }

    // MARK: チェックリスト

    private func checklist(_ title: String, note: String, _ items: [NOMCashDay.Item]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            NPOCSectionTitle(title: title, note: note)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { i, it in
                    itemRow(it)
                    if i < items.count - 1 { NPZDivider(inset: 40) }
                }
            }
            .background(npocCard())
        }
    }

    private func itemRow(_ it: NOMCashDay.Item) -> some View {
        let (icon, color): (String, Color) = it.status == "ok" ? ("checkmark.circle.fill", NT.ok) : it.status == "warn" ? ("exclamationmark.triangle.fill", NT.warn) : ("info.circle", NT.ink3)
        let target = it.href.flatMap { h -> String? in
            guard let url = URL(string: h, relativeTo: AppConfig.url("/"))?.absoluteURL, NativePhoneOwnerRegistry.route(for: url) != nil else { return nil }
            return h
        }
        return Button { if let t = target { onOpen(t) } } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(color).frame(width: 22)
                Text(it.label).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 6)
                Text(it.valueLabel).font(.system(size: 13.5, weight: it.status == "warn" ? NT.strong : .bold)).foregroundColor(it.status == "info" ? NT.ink2 : color).monospacedDigit()
                if target != nil { Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3) }
            }
            .padding(.horizontal, 12).frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
    }

    // MARK: 店舗日次締め

    @ViewBuilder private func closeSection(_ p: NOMCashDay) -> some View {
        checklist("店舗日次締め 実行前チェック", note: "警告があっても実行できます（未締めのレジが残っているときだけ実行できません）", p.preCloseItems)
        if p.canClose {
            NPOCWideButton(text: p.alreadyClosed ? "店舗日次締めを更新する" : "店舗日次締めを実行する", icon: "checkmark.seal", busy: model.busy) { confirmClose = true }
        } else {
            NPSLockNote(text: "店舗日次締めは店長・副店長以上のアカウントで実行できます")
        }
        if let c = p.closing { closingCard(c) }
    }

    private func closingCard(_ c: NOMCashDay.Closing) -> some View {
        NPOCard(title: "本日の締めサマリ", trailing: c.statusLabel) {
            NPZTileGrid {
                NPZTile(label: "総売上", value: NOS.yen(c.salesTotal))
                NPZTile(label: "純売上", value: NOS.yen(c.netSales), tone: NT.purpleDeep)
                NPZTile(label: "返金", value: NOS.yen(c.refundTotal), tone: c.refundTotal > 0 ? NT.danger : NT.ink)
                NPZTile(label: "値引", value: NOS.yen(c.discountTotal))
            }
            if !c.payments.isEmpty {
                VStack(spacing: 4) {
                    ForEach(c.payments, id: \.method) { pm in NPZInfoRow(label: pm.label, value: NOS.yen(pm.amount)) }
                }
            }
            NPZDivider()
            NPZInfoRow(label: "小口 入金／出金", value: "\(NOS.yen(c.pettyInTotal))／\(NOS.yen(c.pettyOutTotal))")
            NPZInfoRow(label: "理論現金", value: NOS.yen(c.expectedCash))
            NPZInfoRow(label: "実現金", value: NOS.yen(c.countedCash))
            NPZInfoRow(label: "現金差異", value: NOM.signed(c.cashDifference), tone: c.cashDifference != 0 ? NT.danger : NT.ink)
            if !c.registers.isEmpty {
                NPZDivider()
                ForEach(c.registers, id: \.self) { r in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(r.registerName).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink)
                            Spacer()
                            Text("差異 \(NOM.signed(r.difference))").font(.system(size: 13, weight: NT.strong)).foregroundColor(r.difference != 0 ? NT.danger : NT.ink2).monospacedDigit()
                        }
                        Text("理論 \(NOS.yen(r.expectedCash))・実 \(NOS.yen(r.countedCash))・締め \(r.closedByName)").font(.system(size: 11)).foregroundColor(NT.ink3)
                    }
                }
            }
        }
    }

    // MARK: 売上の内訳

    @ViewBuilder private func breakdownSection(_ p: NOMCashDay) -> some View {
        let b = p.breakdown
        NPOCSectionTitle(title: "売上の内訳", note: "予約経路・担当者・よく出たメニュー（画面だけ。レシートには出ません）")
        NOSSegment(items: [(key: "day", label: "日次"), (key: "month", label: "月次")], selection: model.period) { model.setPeriod($0) }
        HStack(spacing: 8) {
            Button { model.shift(-1) } label: { Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold)).frame(width: 44, height: 40) }
            Spacer()
            Text(model.period == "month" ? NOS.ymLabel(model.date) : (NOS.isDay(model.date) ? NOS.mdw(model.date) : model.date))
                .font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
            Spacer()
            Button { model.shift(1) } label: { Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).frame(width: 44, height: 40) }
                .disabled(!model.canGoNext)
        }
        .foregroundColor(NT.purpleDeep)
        .background(npocCard(12))
        NPZTileGrid {
            NPZTile(label: "売上", value: NOS.yen(b.totals.sales), tone: NT.purpleDeep)
            NPZTile(label: "伝票・客数", value: "\(NOS.int(b.totals.orders))件・\(NOS.int(b.totals.guests))名")
        }
        countCard("予約経路別", b.bySource)
        countCard("担当者別", b.byClerk)
        itemCard("よく出たコース・プラン", b.courses)
        itemCard("よく出たフード", b.foods)
        itemCard("よく出たドリンク", b.drinks)
        if b.nomihoudai.planCount > 0 {
            NPOCard(title: "飲み放題", trailing: "\(NOS.int(b.nomihoudai.planCount))名・\(NOS.int(b.nomihoudai.glasses))杯") {
                ForEach(b.nomihoudai.drinks.prefix(10), id: \.name) { r in NPZInfoRow(label: r.name, value: "\(NOS.int(r.quantity))杯") }
            }
        }
        if !b.tax.byRate.isEmpty {
            NPOCard(title: "消費税") {
                ForEach(b.tax.byRate, id: \.rate) { t in
                    NPZInfoRow(label: "\(NPS.num(t.rate))% 対象 \(NOS.yen(t.taxable))", value: "内消費税 \(NOS.yen(t.tax))")
                }
                NPZInfoRow(label: "伝票ごとの消費税の合計", value: NOS.yen(b.tax.orderTax))
            }
        }
    }

    @ViewBuilder private func countCard(_ title: String, _ rows: [NOMCashDay.CountRow]) -> some View {
        if !rows.isEmpty {
            NPOCard(title: title) {
                ForEach(rows, id: \.label) { r in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.label).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            Text("\(NOS.int(r.orders))件・\(NOS.int(r.guests))名\(r.items.map { "・\(NOS.int($0))品" } ?? "")").font(.system(size: 11)).foregroundColor(NT.ink3)
                        }
                        Spacer()
                        Text(NOS.yen(r.sales)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                }
            }
        }
    }

    @ViewBuilder private func itemCard(_ title: String, _ rows: [NOMCashDay.ItemRow]) -> some View {
        if !rows.isEmpty {
            NPOCard(title: title, trailing: "上位\(min(rows.count, 10))") {
                ForEach(Array(rows.prefix(10).enumerated()), id: \.offset) { i, r in
                    HStack {
                        Text("\(i + 1)").font(.system(size: 11, weight: NT.strong)).foregroundColor(NT.ink3).frame(width: 18)
                        Text(r.name).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        Spacer()
                        Text("\(NOS.int(r.quantity))").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                        Text(NOS.yen(r.sales)).font(.system(size: 13.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().frame(minWidth: 70, alignment: .trailing)
                    }
                }
            }
        }
    }
}
