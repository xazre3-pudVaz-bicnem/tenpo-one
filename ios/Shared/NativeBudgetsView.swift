import SwiftUI

// 予算管理（ネイティブ）。Web の /app/budgets と同じ（2026-10-24）
//   今月の売上目標（万円で入れて保存）・ご予約から見込む売上・店舗別の予算と実績（編集）。日別予算登録は別の画面

struct NBMBudget: Codable, Hashable {
    let salesBudget: Double
    let costRateTarget: Double?
    let laborRateTarget: Double?
    let profitTarget: Double?
    let guestsTarget: Double?
    let avgSpendTarget: Double?
    let note: String?
}
struct NBMActual: Codable, Hashable {
    let sales: Double
    let guests: Double
    let avgSpend: Double
    let cost: Double
    let costRate: Double
    let labor: Double
    let laborRate: Double
    let expense: Double
    let profit: Double
}
struct NBMRow: Codable, Identifiable, Hashable {
    var id: String { storeId ?? "__all__" }
    let storeId: String?
    let storeName: String
    let editable: Bool
    let budget: NBMBudget?
    let actual: NBMActual
    let achievementPct: Double?
    let forecast: Double?
    let forecastPct: Double?
}
struct NBMTarget: Codable { let storeId: String?; let storeName: String; let editable: Bool; let amount: Double?; let sales: Double; let achievementPct: Double? }
struct NBMPart: Codable { let count: Int; let guests: Int; let amount: Double }
struct NBMBooking: Codable { let course: NBMPart; let seatOnly: NBMPart; let total: Double }
struct NBMUnit: Codable { let unit: Double; let basis: String; let samples: Int }
struct NBMPayload: Codable {
    let month: String
    let monthFirst: String
    let monthLast: String
    let elapsedDays: Int
    let daysInMonth: Int
    let canEdit: Bool
    let includeTakeoutGuests: Bool
    let rows: [NBMRow]
    let target: NBMTarget
    let monthLabel: String
    let forecastFrom: String
    let booking: NBMBooking?
    let singleUnit: NBMUnit?
    let landing: Double?
    let seatOnlyUnitDays: Int
}

@MainActor
final class NativeBudgetsModel: ObservableObject {
    @Published var payload: NBMPayload?
    @Published var month = String(NPDate.str(Date()).prefix(7))
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "budgets"), URLQueryItem(name: "month", value: month)]
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NBMPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NBMPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func act(_ body: [String: Any]) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do { return try await NativeAPI.shared.floorAct(body) } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

struct NativeBudgetsView: View {
    @ObservedObject var model: NativeBudgetsModel
    let onHome: () -> Void
    let onDaily: (String) -> Void

    @State private var editing: NBMRow?
    @State private var man = ""
    @State private var loadedKey = ""

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.target.storeName ?? "", title: "予算管理", subtitle: "Budgets", onHome: onHome)
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header(p)
                        Text("経過\(p.elapsedDays)日／\(p.daysInMonth)日（\(p.month.replacingOccurrences(of: "-", with: "/"))）。着地予測 = 実績 ÷ 経過日数 × 月日数（lib/forecast.ts の線形予測）。")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        HStack(alignment: .top, spacing: 14) {
                            targetCard(p).frame(maxWidth: .infinity)
                            bookingCard(p).frame(maxWidth: .infinity)
                        }
                        table(p)
                        Text("※ 売上実績は純売上（会計成立注文の合計 − 期間内の返金額）。原価・人件費は「レポート」画面と同じ概算ロジック（原価はレシピ原価優先、人件費は時給ルール×実働時間の概算）。全社行は本社管理者（org_owner/hq_admin）のみ編集できます。" + (p.includeTakeoutGuests ? "" : "　客数は店内飲食（テーブル会計・コース）のみで算出しています（設定 > 企業情報 > KPI設定）。"))
                            .font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                    }
                    .padding(16)
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await model.refresh() } } }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task(id: model.month) {
            await model.refresh()
            if let p = model.payload {
                let key = "\(p.target.storeId ?? "all")-\(p.monthFirst)"
                if key != loadedKey { loadedKey = key; man = p.target.amount.map { Self.manFromYen($0) } ?? "" }
            }
        }
        .overlay {
            if let r = editing, let p = model.payload {
                NativeModalCard(width: 640) { NBMEditForm(model: model, row: r, monthFirst: p.monthFirst, onClose: { editing = nil }) }
            }
        }
    }

    // MARK: 上

    private func header(_ p: NBMPayload) -> some View {
        HStack(spacing: 8) {
            Text("月別・店舗別の予算設定と実績・着地予測の比較").font(.system(size: 13)).foregroundColor(NFColor.ink2)
            Spacer()
            monthBtn("chevron.left") { shift(-1) }
            HStack(spacing: 6) { Image(systemName: "calendar"); Text(model.month.replacingOccurrences(of: "-", with: "年") + "月") }
                .font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.navy)
                .padding(.horizontal, 14).frame(height: 44).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            monthBtn("chevron.right") { shift(1) }
            Button { onDaily(p.month) } label: {
                HStack(spacing: 6) { Image(systemName: "calendar.badge.plus"); Text("日別予算登録"); Text("Daily").font(.system(size: 10, weight: .semibold)).opacity(0.7) }
                    .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 16).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: 0x6B4C9A)))
            }.buttonStyle(PressableStyle())
        }
    }

    private func monthBtn(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                .frame(width: 44, height: 44).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        }.buttonStyle(PressableStyle())
    }

    private func shift(_ d: Int) {
        let parts = model.month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return }
        var y = parts[0], m = parts[1] + d
        if m < 1 { m = 12; y -= 1 }
        if m > 12 { m = 1; y += 1 }
        model.month = String(format: "%04d-%02d", y, m)
    }

    // MARK: 今月の売上目標

    private func targetCard(_ p: NBMPayload) -> some View {
        let t = p.target
        let amount = Self.parseMan(man).map { ($0 * 10_000).rounded() }
        let changed = amount != nil && amount != (t.amount ?? 0)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: "target").foregroundColor(NFColor.iris)
                Text("\(p.monthLabel)の売上目標").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.navy)
                Text("Monthly sales target").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3)
                Spacer()
                Text("\(t.storeName)｜\(p.month.replacingOccurrences(of: "-", with: "/"))").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            }
            if t.editable {
                HStack(spacing: 8) {
                    ZStack {
                        TextField("例: 1,500", text: $man)
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .font(.system(size: 20, weight: .bold)).monospacedDigit()
                            .padding(.leading, 12).padding(.trailing, 52).frame(height: 50)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                        HStack {
                            if let a = amount, a > 0 { Text("＝\(NT.yen(Int(a)))").font(.system(size: 11)).foregroundColor(NFColor.ink3).monospacedDigit() }
                            Spacer()
                            Text("万円").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
                        }
                        .padding(.horizontal, 12).allowsHitTesting(false)
                    }
                    Button { Task { await saveTarget(p, amount: amount) } } label: {
                        HStack(spacing: 6) { Image(systemName: "target"); Text(model.busy ? "保存中…" : "目標を保存"); Text("Save").font(.system(size: 10, weight: .semibold)).opacity(0.7) }
                            .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 16).frame(height: 50)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: 0x6B4C9A)))
                            .opacity(model.busy || !changed ? 0.5 : 1)
                    }.buttonStyle(PressableStyle()).disabled(model.busy || !changed)
                }
            } else {
                Text(t.amount.map { NI.yen($0) } ?? "未設定").font(.system(size: 26, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink)
            }
            if t.storeId != nil {
                Text("保存すると、直近8週の曜日ごとの売上に合わせて日別予算を自動で作ります（よく売れる曜日ほど多め）。ホームの「予算売上高」はその日の分です。1日ずつ直すときは「日別予算」から。")
                    .font(.system(size: 12)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                miniStat("実績（純売上）", "Sales", NI.yen(t.sales), NFColor.saffron)
                miniStat("達成率", "Achievement", t.achievementPct.map { String(format: "%.1f%%", $0) } ?? "—", NFColor.royal)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func miniStat(_ label: String, _ en: String, _ value: String, _ tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text(label) + Text(" \(en)")).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            Text(value).font(.system(size: 19, weight: .bold)).monospacedDigit().foregroundColor(tone)
        }
        .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
    }

    private func saveTarget(_ p: NBMPayload, amount: Double?) async {
        guard let a = amount else { return }
        var body: [String: Any] = ["type": "budgetTargetSave", "month": p.monthFirst, "amount": a]
        body["storeId"] = p.target.storeId ?? NSNull()
        guard let r = await model.act(body) else { return }
        if r.ok {
            model.toast = (r.queued ?? 0) > 0 ? "売上目標を保存しました。曜日ごとの売上に合わせて日別予算も作りました" : "売上目標を保存しました"
            await model.refresh()
        } else { model.error = r.error ?? "保存できませんでした" }
    }

    // MARK: ご予約から見込む売上

    private func bookingCard(_ p: NBMPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: "calendar.badge.checkmark").foregroundColor(NFColor.iris)
                Text("ご予約から見込む売上").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.navy)
                Text("Booking forecast").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3)
                Spacer()
                NPBadge(text: "自動計算", color: NFColor.navy)
            }
            if let f = p.booking {
                Text("\(Self.md(p.forecastFrom))〜\(Self.md(p.monthLast)) に入っているご予約（キャンセル・来店済みを除く）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                VStack(spacing: 0) {
                    bookingRow("コースのご予約", "\(f.course.count)件・\(f.course.guests)名", "コースの金額 × 人数", f.course.amount)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                    bookingRow("席のみのご予約", "\(f.seatOnly.count)件・\(f.seatOnly.guests)名", seatBasis(p), f.seatOnly.amount)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                    HStack {
                        Text("予約見込み 合計").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
                        Spacer()
                        Text(NI.yen(f.total)).font(.system(size: 19, weight: NT.strong)).monospacedDigit().foregroundColor(NFColor.royal)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10).background(NFColor.irisSoft.opacity(0.6))
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                if let l = p.landing {
                    HStack(spacing: 6) {
                        (Text("実績 \(NI.yen(p.target.sales)) ＋ 予約見込み \(NI.yen(f.total)) ＝ ") + Text(NI.yen(l)).bold().foregroundColor(NFColor.navy))
                            .font(.system(size: 14)).foregroundColor(NFColor.ink2)
                        if let a = p.target.amount, a > 0 {
                            let pct = l / a * 100
                            NPBadge(text: "目標の \(String(format: "%.0f", pct))%", color: Self.tone(pct))
                        }
                    }
                }
            } else {
                Text("過去の月のため、これからのご予約はありません").font(.system(size: 14)).foregroundColor(NFColor.ink3)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func bookingRow(_ title: String, _ count: String, _ sub: String, _ amount: Double) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                (Text(title).foregroundColor(NFColor.ink) + Text("  \(count)").font(.system(size: 12)).foregroundColor(NFColor.ink3)).font(.system(size: 14))
                Text(sub).font(.system(size: 11)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Text(NI.yen(amount)).font(.system(size: 15, weight: .bold)).monospacedDigit()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func seatBasis(_ p: NBMPayload) -> String {
        let d = p.seatOnlyUnitDays
        guard let u = p.singleUnit else { return "店舗ごとの席のみ客単価（直近\(d)日の平均）× 人数" }
        switch u.basis {
        case "seat_only": return "席のみ客単価 \(NI.yen(u.unit)) × 人数（直近\(d)日の席のみ \(u.samples)組の平均）"
        case "store": return "客単価 \(NI.yen(u.unit)) × 人数（直近\(d)日に席のみが無いため店全体の平均）"
        default: return "直近\(d)日の会計が無いため計算できません"
        }
    }

    // MARK: 店舗別の表

    private func table(_ p: NBMPayload) -> some View {
        niCard {
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Text("店舗").frame(width: 150, alignment: .leading)
                        Text("売上予算").frame(width: 100, alignment: .trailing)
                        Text("売上実績（純）").frame(width: 110, alignment: .trailing)
                        Text("達成率").frame(width: 70, alignment: .trailing)
                        Text("着地予測").frame(width: 150, alignment: .trailing)
                        Text("原価率(目標/実績)").frame(width: 110, alignment: .trailing)
                        Text("人件費率(目標/実績)").frame(width: 120, alignment: .trailing)
                        Text("利益(目標/実績)").frame(width: 170, alignment: .trailing)
                        Text("客数(目標/実績)").frame(width: 100, alignment: .trailing)
                        Text("客単価(目標/実績)").frame(width: 130, alignment: .trailing)
                        if p.canEdit { Text("").frame(width: 70) }
                    }
                    .font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
                    ForEach(p.rows) { r in
                        row(r, canEdit: p.canEdit)
                        Rectangle().fill(NFColor.line).frame(height: 1)
                    }
                }
            }
        }
    }

    private func row(_ r: NBMRow, canEdit: Bool) -> some View {
        let b = r.budget
        func pct(_ v: Double?) -> String { v.map { "\(NI.q($0))%" } ?? "—" }
        return HStack(spacing: 8) {
            HStack(spacing: 6) {
                Text(r.storeName).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy).lineLimit(1)
                if r.storeId == nil { NPBadge(text: "全社", color: NFColor.navy) }
            }
            .frame(width: 150, alignment: .leading)
            Text(b.map { NI.yen($0.salesBudget) } ?? "—").frame(width: 100, alignment: .trailing)
            Text(NI.yen(r.actual.sales)).bold().foregroundColor(NFColor.navy).frame(width: 110, alignment: .trailing)
            Group {
                if let a = r.achievementPct { NPBadge(text: String(format: "%.1f%%", a), color: Self.tone(a)) } else { Text("—").foregroundColor(NFColor.ink3) }
            }
            .frame(width: 70, alignment: .trailing)
            HStack(spacing: 4) {
                Text(r.forecast.map { NI.yen($0) } ?? "—")
                if let fp = r.forecastPct { NPBadge(text: String(format: "%.0f%%", fp), color: Self.tone(fp)) }
            }
            .frame(width: 150, alignment: .trailing)
            Text("\(pct(b?.costRateTarget)) / \(String(format: "%.1f", r.actual.costRate))%").font(.system(size: 12)).frame(width: 110, alignment: .trailing)
            Text("\(pct(b?.laborRateTarget)) / \(String(format: "%.1f", r.actual.laborRate))%").font(.system(size: 12)).frame(width: 120, alignment: .trailing)
            Text("\(NI.yen(b?.profitTarget)) / \(NI.yen(r.actual.profit))").font(.system(size: 12)).frame(width: 170, alignment: .trailing)
            Text("\(b?.guestsTarget.map { NI.q($0) } ?? "—") / \(NI.q(r.actual.guests))").font(.system(size: 12)).frame(width: 100, alignment: .trailing)
            Text("\(NI.yen(b?.avgSpendTarget)) / \(NI.yen(r.actual.avgSpend))").font(.system(size: 12)).frame(width: 130, alignment: .trailing)
            if canEdit {
                Group {
                    if r.editable { niSmallButton("編集", icon: "pencil") { editing = r } } else { Text("—").foregroundColor(NFColor.ink3) }
                }
                .frame(width: 70, alignment: .trailing)
            }
        }
        .font(.system(size: 13.5)).monospacedDigit().foregroundColor(NFColor.ink)
        .padding(.horizontal, 14).frame(minHeight: 52)
    }

    // MARK: 決まり（Web と同じ）

    static func tone(_ rate: Double?) -> Color {
        guard let r = rate else { return NFColor.ink3 }
        if r >= 100 { return NFColor.success }
        if r >= 90 { return NFColor.saffron }
        return NFColor.danger
    }
    static func md(_ d: String) -> String { String(d.dropFirst(5)).replacingOccurrences(of: "-", with: "/") }
    /// 入力の文字から万円の数（小数は1桁まで）
    static func parseMan(_ text: String) -> Double? {
        let t = (text.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? text).filter { $0.isNumber || $0 == "." }
        guard !t.isEmpty, t != "." else { return nil }
        let parts = t.split(separator: ".", omittingEmptySubsequences: false)
        let i = parts.first.map(String.init) ?? "0"
        let f = parts.count > 1 ? String(parts[1].prefix(1)) : "0"
        return Double("\(i.isEmpty ? "0" : i).\(f.isEmpty ? "0" : f)")
    }
    /// 保存されている円を万円の文字に（1万円未満の端数は小数1桁まで）
    static func manFromYen(_ yen: Double) -> String {
        let m = (yen / 1_000).rounded() / 10
        return m == m.rounded() ? String(Int(m)) : String(format: "%.1f", m)
    }
}

/// 予算の編集（Web の BudgetForm と同じ）
struct NBMEditForm: View {
    @ObservedObject var model: NativeBudgetsModel
    let row: NBMRow
    let monthFirst: String
    let onClose: () -> Void

    @State private var sales = ""
    @State private var cost = ""
    @State private var labor = ""
    @State private var profit = ""
    @State private var guests = ""
    @State private var avg = ""
    @State private var note = ""
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "予算を編集：\(row.storeName)（\(monthFirst.prefix(7).replacingOccurrences(of: "-", with: "/"))）", onClose: onClose)
            NIField(label: "売上予算（円）", text: $sales, number: true)
            HStack(spacing: 12) { NIField(label: "原価率目標（%）", text: $cost, number: true); NIField(label: "人件費率目標（%）", text: $labor, number: true) }
            HStack(spacing: 12) { NIField(label: "利益目標（円）", text: $profit, number: true); NIField(label: "客数目標（名）", text: $guests, number: true) }
            NIField(label: "客単価目標（円）", text: $avg, number: true)
            NIField(label: "メモ", text: $note)
            NIDialogFoot(error: error, busy: model.busy, okText: "保存する", busyText: "保存中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            let b = row.budget
            sales = NI.q(b?.salesBudget ?? 0)
            cost = b?.costRateTarget.map { NI.q($0) } ?? ""
            labor = b?.laborRateTarget.map { NI.q($0) } ?? ""
            profit = b?.profitTarget.map { NI.q($0) } ?? ""
            guests = b?.guestsTarget.map { NI.q($0) } ?? ""
            avg = b?.avgSpendTarget.map { NI.q($0) } ?? ""
            note = b?.note ?? ""
        }
    }

    private func save() async {
        error = nil
        func opt(_ s: String) -> Any { NI.num(s).map { $0 as Any } ?? NSNull() }
        var body: [String: Any] = [
            "type": "budgetUpsert", "month": monthFirst, "salesBudget": NI.num(sales) ?? 0,
            "costRateTarget": opt(cost), "laborRateTarget": opt(labor), "profitTarget": opt(profit),
            "guestsTarget": opt(guests), "avgSpendTarget": opt(avg), "note": note,
        ]
        body["storeId"] = row.storeId ?? NSNull()
        guard let r = await model.act(body) else { error = model.error; return }
        if r.ok {
            model.toast = "予算を保存しました"
            onClose()
            await model.refresh()
        } else { error = r.error ?? "保存に失敗しました" }
    }
}
