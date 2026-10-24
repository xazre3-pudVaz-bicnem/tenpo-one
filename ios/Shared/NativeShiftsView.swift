import SwiftUI

// シフト（/app/shifts）のネイティブ。Web と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   週の切り替え（前の週・次の週・今週・日付から）／今週分を公開（下書き → 公開）
//   シフト表（スタッフ × 7日。左のスタッフの列は横に動かしても残る）。マスを押すと：
//     店長系（shifts.manage）… 時間・種別（仮シフト／希望／確定）の変更・削除・変更申請の却下・同じマスにもう1つ追加
//     スタッフ … 自分のマスだけ。空き＝希望を出す／希望＝直す・消す／公開済み＝変更申請（休み希望・希望の時間・理由）
//   シフトを追加（他店舗スタッフ＝店舗間ヘルプも）／人員不足・連勤・週の勤務時間・営業時間外の注意
//   人件費シミュレーター（日別・予算比較）／人件費予測（スタッフ別）／時間帯別 必要人数（追加・削除）
// サーバーは lib/native-modules/shifts.ts（読み込みは Web と同じ lib/shifts-server.ts、操作は Web と同じ Server Action）。
// 人件費（時給から出る）が入るので iPad に残さない（読んだらすぐ保存を消す）。
// 従業員台帳（NativeEmployeesView.swift）と共通の部品（NHX…）もここに置く。

// MARK: - 中身（サーバーの返事）

struct NSHStore: Decodable, Hashable {
    let id: String
    let name: String
}

struct NSHDay: Decodable, Hashable {
    let date: String
    let label: String
}

struct NSHStaff: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let isHelp: Bool
}

struct NSHShift: Decodable, Hashable, Identifiable {
    let id: String
    let profileId: String
    let date: String
    let startTime: String
    let endTime: String
    let kind: String
    let status: String
    let note: String?
}

struct NSHOrgStaff: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let homeStores: String
}

struct NSHLabor: Decodable, Hashable {
    let name: String
    let isHelp: Bool
    let minutes: Double
    let cost: Double?
}

struct NSHForecast: Decodable, Hashable {
    let date: String
    let label: String
    let source: String
    let salesBasis: Double?
    let plannedLabor: Double
    let ratio: Double?
    let targetRatio: Double?
    let diff: Double?
}

struct NSHShortage: Decodable, Hashable {
    let date: String
    let label: String
    let timeFrom: String
    let timeTo: String
    let required: Double
    let actual: Double
}

struct NSHStreak: Decodable, Hashable {
    let profileId: String
    let name: String
    let streak: Double
}

struct NSHWeekly: Decodable, Hashable {
    let profileId: String
    let name: String
    let minutes: Double
}

struct NSHOutside: Decodable, Hashable {
    let date: String
    let label: String
    let name: String
    let startTime: String
    let endTime: String
    let reason: String
}

struct NSHRequirement: Decodable, Hashable, Identifiable {
    let id: String
    let dayOfWeek: Int
    let timeFrom: String
    let timeTo: String
    let requiredCount: Double
}

struct NSHThresholds: Decodable, Hashable {
    let laborRatio: Double
    let consecutiveDays: Double
    let weeklyHours: Double
}

struct NSHPayload: Decodable {
    let ok: Bool
    let store: NSHStore
    let selfId: String
    let canManage: Bool
    let todayWeekStart: String
    let weekStart: String
    let weekEnd: String
    let rangeLabel: String
    let weekDates: [NSHDay]
    let staff: [NSHStaff]
    let shifts: [NSHShift]
    let orgStaffOptions: [NSHOrgStaff]
    let laborRows: [NSHLabor]
    let totalCost: Double
    let forecastRows: [NSHForecast]
    let shortages: [NSHShortage]
    let consecutiveWarnings: [NSHStreak]
    let weeklyHourWarnings: [NSHWeekly]
    let outOfHoursWarnings: [NSHOutside]
    let requirements: [NSHRequirement]
    let thresholds: NSHThresholds
}

// MARK: - 読み込み

enum NSHApi {
    /// GET part=shifts&week=。人件費（時給から出る）が入るので、NativeAPI.send が保存した分をすぐ消す
    static func load(week: String?) async throws -> NSHPayload {
        var query: [String: String] = [:]
        if let week, !week.isEmpty { query["week"] = week }
        defer { NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url("shifts", query))) }
        return try await NativeModuleAPI.get(NSHPayload.self, part: "shifts", query: query)
    }
}

enum NSHFmt {
    static let kinds = ["planned", "requested", "confirmed"]
    static let weekdays = ["日", "月", "火", "水", "木", "金", "土"]

    /// 選ぶときの名前（Web の select と同じ）
    static func kindLabel(_ k: String) -> String {
        switch k {
        case "confirmed": return "確定"
        case "requested": return "希望"
        default: return "仮シフト"
        }
    }

    /// マスの中の短い名前（Web の KIND_LABEL と同じ）
    static func kindShort(_ k: String) -> String {
        switch k {
        case "confirmed": return "確定"
        case "requested": return "希望"
        default: return "仮"
        }
    }

    static func weekday(_ i: Int) -> String { (0..<7).contains(i) ? weekdays[i] : "?" }

    /// YYYY-MM-DD に n 日足す（日本の日付で）
    static func addDays(_ ymd: String, _ n: Int) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo") ?? .current
        guard let d = NPDate.f.date(from: ymd), let r = cal.date(byAdding: .day, value: n, to: d) else { return ymd }
        return NPDate.str(r)
    }

    /// 510 → 8:30（Web の人件費予測と同じ）
    static func hm(_ minutes: Double) -> String {
        let m = max(0, Int(minutes.rounded()))
        return "\(m / 60):" + String(format: "%02d", m % 60)
    }

    /// 2430 → 40時間30分
    static func hoursMinutes(_ minutes: Double) -> String {
        let m = max(0, Int(minutes.rounded()))
        return "\(m / 60)時間\(m % 60)分"
    }

    static func yen(_ v: Double) -> String { NT.yen(Int(v.rounded())) }
    static func pct(_ v: Double) -> String { String(format: "%.1f%%", v) }
    /// 予算人件費率との差（+1.2pt）
    static func pt(_ v: Double) -> String {
        let sign = v > 0 ? "+" : ""
        return sign + String(format: "%.1fpt", v)
    }
}

/// マスの色（Web の kindClass・cellClass と同じ考え）
struct NSHStyle {
    let bg: Color
    let fg: Color
    let border: Color
    let width: CGFloat

    static func of(_ s: NSHShift?) -> NSHStyle {
        guard let s else { return NSHStyle(bg: Color.white, fg: Color(hex: 0xB3B8C2), border: Color(hex: 0xCDD2DA), width: 1) }
        if s.status == "change_requested" { return NSHStyle(bg: NFColor.saffronSoft, fg: NT.warn, border: NT.warn, width: 2) }
        switch s.kind {
        case "confirmed": return NSHStyle(bg: NFColor.successSoft, fg: NFColor.success, border: NFColor.success.opacity(0.35), width: 1)
        case "requested": return NSHStyle(bg: NFColor.saffronSoft, fg: NT.warn, border: NT.warn.opacity(0.35), width: 1)
        default: return NSHStyle(bg: Color.white, fg: NT.purpleDeep, border: NT.purple.opacity(0.5), width: 2)
        }
    }
}

// MARK: - 画面の中身の持ち主

@MainActor
final class NSHModel: ObservableObject {
    @Published var payload: NSHPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var loading = false
    @Published var busy: String?
    /// スタッフ_日付 → その日のシフト（開始の早い順。Web の shiftsByKey と同じ）
    private(set) var byKey: [String: [NSHShift]] = [:]
    private var week: String?
    private var seq = 0

    init(week: String?) { self.week = week }

    func load() async {
        seq += 1
        let mine = seq
        loading = true
        do {
            let p = try await NSHApi.load(week: week)
            guard mine == seq else { return }
            var map: [String: [NSHShift]] = [:]
            for s in p.shifts { map[s.profileId + "_" + s.date, default: []].append(s) }
            byKey = map
            week = p.weekStart
            payload = p
            error = nil
        } catch {
            guard mine == seq else { return }
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
        loading = false
    }

    func go(_ w: String?) async {
        week = w
        await load()
    }

    func move(weeks n: Int) async {
        guard let p = payload else { return }
        await go(NSHFmt.addDays(p.weekStart, n * 7))
    }

    @discardableResult
    func post(_ req: [String: Any], key: String, done: String) async -> Bool {
        guard busy == nil else { return false }
        busy = key
        let r = await NHXApi.post(req)
        busy = nil
        if r.ok {
            toast = r.message ?? done
            await load()
            return true
        }
        toast = r.error ?? "保存できませんでした"
        return false
    }

    func publish() async {
        guard let p = payload else { return }
        await post(["type": "shiftPublish", "weekStart": p.weekStart], key: "publish", done: "今週分のシフトを公開しました")
    }

    func deleteRequirement(_ id: String) async {
        await post(["type": "shiftReqDelete", "id": id], key: "req", done: "必要人数設定を削除しました")
    }
}

/// マスを押したときに開く中身
struct NSHEdit: Identifiable {
    enum Mode { case manage, request, change }
    let id = UUID()
    let mode: Mode
    let staff: NSHStaff
    let day: NSHDay
    let shifts: [NSHShift]
}

// MARK: - 画面

struct NativeShiftsView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    /// ほかの画面（予算管理など）へ。ネイティブがあればネイティブで開く
    let onWeb: (String) -> Void
    @StateObject private var model: NSHModel
    @State private var edit: NSHEdit?
    @State private var creating = false
    @State private var addingRequirement = false
    @State private var confirmPublish = false
    @State private var deletingRequirement: NSHRequirement?

    init(route: NativeModuleRoute, onHome: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.route = route
        self.onHome = onHome
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NSHModel(week: route.query("week")))
    }

    private var p: NSHPayload? { model.payload }

    var body: some View {
        NHXPage(title: "シフト", onBack: onHome, loaded: p != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p { content(p) }
        }
        .task { await model.load() }
        .onChange(of: route) { r in Task { await model.go(r.query("week")) } }
        .sheet(item: $edit) { e in
            NSHCellSheet(edit: e, onDone: { msg in
                edit = nil
                model.toast = msg
                Task { await model.load() }
            }, onClose: { edit = nil })
        }
        .sheet(isPresented: $creating) {
            if let p {
                NSHCreateSheet(payload: p, onDone: { msg in
                    creating = false
                    model.toast = msg
                    Task { await model.load() }
                }, onClose: { creating = false })
            }
        }
        .sheet(isPresented: $addingRequirement) {
            NSHRequirementSheet(onDone: { msg in
                addingRequirement = false
                model.toast = msg
                Task { await model.load() }
            }, onClose: { addingRequirement = false })
        }
        .alert("今週分を公開", isPresented: $confirmPublish) {
            Button("公開する") { Task { await model.publish() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("\(p?.rangeLabel ?? "") の下書きのシフトをまとめて公開します")
        }
        .alert("必要人数設定を削除", isPresented: Binding(get: { deletingRequirement != nil }, set: { if !$0 { deletingRequirement = nil } }), presenting: deletingRequirement) { r in
            Button("削除する", role: .destructive) {
                deletingRequirement = nil
                Task { await model.deleteRequirement(r.id) }
            }
            Button("やめる", role: .cancel) { deletingRequirement = nil }
        } message: { r in
            Text("\(NSHFmt.weekday(r.dayOfWeek))曜日 \(r.timeFrom)〜\(r.timeTo)（\(Int(r.requiredCount))人）")
        }
    }

    @ViewBuilder private func content(_ p: NSHPayload) -> some View {
        topRow(p)
        if !p.shortages.isEmpty { shortageNotice(p) }
        if !p.consecutiveWarnings.isEmpty || !p.weeklyHourWarnings.isEmpty || !p.outOfHoursWarnings.isEmpty { placementNotice(p) }
        gridSection(p)
        forecastCard(p)
        if !p.staff.isEmpty { laborCard(p) }
        if p.canManage { requirementsCard(p) }
    }

    // MARK: 週の切り替え・追加・公開（Web の WeekNav）

    private func topRow(_ p: NSHPayload) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                weekNav(p)
                Spacer(minLength: 8)
                actions(p)
            }
            VStack(alignment: .leading, spacing: 10) {
                weekNav(p)
                actions(p)
            }
        }
    }

    private func weekNav(_ p: NSHPayload) -> some View {
        HStack(spacing: 8) {
            NHXIconButton(icon: "chevron.left", label: "前の週") { Task { await model.move(weeks: -1) } }
            Text(p.rangeLabel).font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                .frame(minWidth: 140)
            NHXIconButton(icon: "chevron.right", label: "次の週") { Task { await model.move(weeks: 1) } }
            NHXButton(text: "今週", disabled: p.weekStart == p.todayWeekStart) { Task { await model.go(p.todayWeekStart) } }
            DatePicker("", selection: weekBinding(p), displayedComponents: .date)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "ja_JP"))
                .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo") ?? .current)
                .accessibilityLabel("日付から週を選ぶ")
            if model.loading { ProgressView().tint(NT.purple) }
        }
        .fixedSize()
    }

    @ViewBuilder private func actions(_ p: NSHPayload) -> some View {
        if p.canManage {
            HStack(spacing: 8) {
                NHXButton(text: "シフトを追加", icon: "plus", disabled: p.staff.isEmpty && p.orgStaffOptions.isEmpty) { creating = true }
                NHXButton(text: "今週分を公開", icon: "paperplane.fill", kind: .primary, busy: model.busy == "publish") { confirmPublish = true }
            }
            .fixedSize()
        }
    }

    private func weekBinding(_ p: NSHPayload) -> Binding<Date> {
        Binding(get: { NPDate.date(p.weekStart) }, set: { d in Task { await model.go(NPDate.str(d)) } })
    }

    // MARK: 注意

    private func shortageNotice(_ p: NSHPayload) -> some View {
        NHXNotice(title: "人員が不足している時間帯があります") {
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(p.shortages.enumerated()), id: \.offset) { _, sh in
                    Text("\(sh.label) \(sh.timeFrom)〜\(sh.timeTo)：必要\(Int(sh.required))人に対し確定シフト\(Int(sh.actual))人")
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func placementNotice(_ p: NSHPayload) -> some View {
        let streaks = p.consecutiveWarnings.map { "\($0.name)さん \(Int($0.streak))連勤" }
        let weekly = p.weeklyHourWarnings.map { "\($0.name)さん \(NSHFmt.hoursMinutes($0.minutes))" }
        let outside = p.outOfHoursWarnings.map { "\($0.name)さん \($0.label) \($0.startTime)〜\($0.endTime)（\($0.reason)）" }
        return NHXNotice(title: "スタッフ配置の注意（保存を妨げるものではありません）") {
            VStack(alignment: .leading, spacing: 10) {
                if !streaks.isEmpty { noticeGroup("連勤（確定シフトが\(Int(p.thresholds.consecutiveDays))日以上連続）", streaks) }
                if !weekly.isEmpty { noticeGroup("週勤務時間超過（当週合計が\(Int(p.thresholds.weeklyHours))時間超）", weekly) }
                if !outside.isEmpty { noticeGroup("営業時間外シフト", outside) }
            }
        }
    }

    private func noticeGroup(_ title: String, _ lines: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 13.5, weight: .bold))
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(size: 13.5)).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: シフト表

    @ViewBuilder private func gridSection(_ p: NSHPayload) -> some View {
        HStack(spacing: 12) {
            Text("シフト表").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
            Spacer(minLength: 8)
            legend
        }
        if p.staff.isEmpty {
            NHXCard(title: "スタッフ", trailing: { EmptyView() }) {
                NHXEmpty(title: "この店舗にスタッフが割り当てられていません", message: "スタッフ管理から店舗へ割当を行ってください")
            }
        } else {
            NSHGrid(payload: p, byKey: model.byKey, today: NPDate.str(Date())) { s, d, list in open(p, s, d, list) }
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            legendItem("仮", NSHStyle.of(NSHShift(id: "", profileId: "", date: "", startTime: "", endTime: "", kind: "planned", status: "draft", note: nil)))
            legendItem("希望", NSHStyle.of(NSHShift(id: "", profileId: "", date: "", startTime: "", endTime: "", kind: "requested", status: "published", note: nil)))
            legendItem("確定", NSHStyle.of(NSHShift(id: "", profileId: "", date: "", startTime: "", endTime: "", kind: "confirmed", status: "published", note: nil)))
            legendItem("変更申請中", NSHStyle.of(NSHShift(id: "", profileId: "", date: "", startTime: "", endTime: "", kind: "confirmed", status: "change_requested", note: nil)))
        }
    }

    private func legendItem(_ text: String, _ st: NSHStyle) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(st.bg)
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(st.border, lineWidth: st.width))
                .frame(width: 16, height: 16)
            Text(text).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
        }
    }

    /// マスを押した（Web の ShiftGrid の openCell と同じ分け方）
    private func open(_ p: NSHPayload, _ s: NSHStaff, _ d: NSHDay, _ list: [NSHShift]) {
        if p.canManage {
            edit = NSHEdit(mode: .manage, staff: s, day: d, shifts: list)
            return
        }
        guard s.id == p.selfId else { return }
        guard let first = list.first else {
            edit = NSHEdit(mode: .request, staff: s, day: d, shifts: [])
            return
        }
        if first.kind == "requested" {
            edit = NSHEdit(mode: .request, staff: s, day: d, shifts: [first])
            return
        }
        if first.status == "published" {
            edit = NSHEdit(mode: .change, staff: s, day: d, shifts: [first])
            return
        }
        // 変更申請中・下書きは本人は触れない（Web と同じ）。押したことだけは分かるように
        model.toast = first.status == "change_requested" ? "変更申請中です（店長の確認待ち）" : "このシフトはまだ公開されていません"
    }

    // MARK: 人件費シミュレーター（日別・予算比較）

    private static let forecastWidths: [CGFloat] = [104, 104, 108, 108, 84, 104, 84]

    private func forecastCard(_ p: NSHPayload) -> some View {
        let note = "当月の予算（店舗別 → 全社の順で優先）が設定されている日は予算売上の日割り（月の予算売上 ÷ 日数）を基準に、未設定の日は過去4週間の同曜日の売上実績（日次締め）の平均で人件費率を計算します。人件費率が\(Int(p.thresholds.laborRatio))%を超える日、予算人件費率との差がプラスの日は警告色で表示します。"
        return NHXCard(title: "人件費シミュレーター（日別・予算比較）", trailing: {
            Button { onWeb("/app/budgets") } label: {
                Text("予算は予算管理ページで設定できます").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
            }
            .buttonStyle(.plain)
        }) {
            VStack(alignment: .leading, spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        forecastHeader
                        ForEach(p.forecastRows, id: \.date) { r in
                            Rectangle().fill(NT.line).frame(height: 1)
                            forecastRow(p, r)
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 6)
                }
                Rectangle().fill(NT.line).frame(height: 1)
                Text(note).font(.system(size: 12)).foregroundColor(NT.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 18).padding(.vertical, 12)
            }
        }
    }

    private var forecastHeader: some View {
        let w = Self.forecastWidths
        let titles = ["日付", "基準", "売上基準", "予定人件費", "人件費率", "予算人件費率", "差"]
        return HStack(spacing: 10) {
            ForEach(0..<titles.count, id: \.self) { i in
                Text(titles[i]).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                    .lineLimit(1)
                    .frame(width: w[i], alignment: i < 2 ? .leading : .trailing)
            }
        }
        .padding(.vertical, 6)
    }

    private func forecastRow(_ p: NSHPayload, _ r: NSHForecast) -> some View {
        let w = Self.forecastWidths
        let over = (r.ratio ?? 0) > p.thresholds.laborRatio
        let plus = (r.diff ?? 0) > 0
        let budget = r.source == "budget"
        return HStack(spacing: 10) {
            Text(r.label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).frame(width: w[0], alignment: .leading)
            NPBadge(text: budget ? "予算日割り" : "過去4週平均", color: budget ? NT.purple : NT.ink3).frame(width: w[1], alignment: .leading)
            Text(r.salesBasis.map { NSHFmt.yen($0) } ?? "予測不可")
                .foregroundColor(r.salesBasis == nil ? NT.ink3 : NT.ink)
                .frame(width: w[2], alignment: .trailing)
            Text(NSHFmt.yen(r.plannedLabor)).foregroundColor(NT.ink).frame(width: w[3], alignment: .trailing)
            Text(r.ratio.map { NSHFmt.pct($0) } ?? "—").font(.system(size: 14, weight: .bold))
                .foregroundColor(over ? NT.danger : NT.ink).frame(width: w[4], alignment: .trailing)
            Text(r.targetRatio.map { NSHFmt.pct($0) } ?? "—").foregroundColor(NT.ink3).frame(width: w[5], alignment: .trailing)
            Text(r.diff.map { NSHFmt.pt($0) } ?? "—").font(.system(size: 14, weight: .bold))
                .foregroundColor(plus ? NT.danger : NT.ink).frame(width: w[6], alignment: .trailing)
        }
        .font(.system(size: 14))
        .monospacedDigit()
        .lineLimit(1)
        .padding(.vertical, 8)
    }

    // MARK: 人件費予測（当週・スタッフ別）

    private func laborCard(_ p: NSHPayload) -> some View {
        NHXCard(title: "人件費予測（当週・スタッフ別）", trailing: { EmptyView() }) {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Text("スタッフ").frame(maxWidth: .infinity, alignment: .leading)
                    Text("シフト時間").frame(width: 100, alignment: .trailing)
                    Text("予測人件費").frame(width: 180, alignment: .trailing)
                }
                .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                .padding(.horizontal, 18).padding(.vertical, 8)
                ForEach(Array(p.laborRows.enumerated()), id: \.offset) { _, r in
                    Rectangle().fill(NT.line).frame(height: 1)
                    HStack(spacing: 10) {
                        HStack(spacing: 6) {
                            Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                            if r.isHelp { Text("（ヘルプ）").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.purple) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(NSHFmt.hm(r.minutes)).font(.system(size: 14)).monospacedDigit().foregroundColor(NT.ink)
                            .frame(width: 100, alignment: .trailing)
                        Text(r.cost.map { NSHFmt.yen($0) } ?? "時給未設定のため除外")
                            .font(.system(size: r.cost == nil ? 12 : 14)).monospacedDigit()
                            .foregroundColor(r.cost == nil ? NT.ink3 : NT.ink)
                            .frame(width: 180, alignment: .trailing)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                }
                Rectangle().fill(NT.line).frame(height: 1)
                HStack {
                    Spacer()
                    Text("合計（判明分のみ）: \(NSHFmt.yen(p.totalCost))").font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
            }
        }
    }

    // MARK: 時間帯別 必要人数設定（Web の RequirementsPanel）

    private func requirementsCard(_ p: NSHPayload) -> some View {
        let rows = p.requirements.sorted { ($0.dayOfWeek, $0.timeFrom) < ($1.dayOfWeek, $1.timeFrom) }
        return NHXCard(title: "時間帯別 必要人数設定", trailing: {
            NHXButton(text: "追加", icon: "plus", kind: .primary) { addingRequirement = true }
        }) {
            if rows.isEmpty {
                NHXEmpty(title: "必要人数の設定がありません", message: "「追加」から曜日・時間帯ごとの必要人数を登録してください")
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { r in
                        if r.id != rows.first?.id { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 18) }
                        HStack(spacing: 14) {
                            Text("\(NSHFmt.weekday(r.dayOfWeek))曜日").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                                .frame(width: 80, alignment: .leading)
                            Text("\(r.timeFrom)〜\(r.timeTo)").font(.system(size: 15)).monospacedDigit().foregroundColor(NT.ink)
                            Spacer(minLength: 8)
                            Text("\(Int(r.requiredCount))人").font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                            Button { deletingRequirement = r } label: {
                                Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.danger)
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(PressableStyle())
                            .disabled(model.busy != nil)
                            .accessibilityLabel("削除")
                        }
                        .padding(.horizontal, 18).padding(.vertical, 4)
                    }
                }
            }
        }
    }
}

// MARK: - シフト表（スタッフ × 7日。左のスタッフの列は横に動かしても残る）

struct NSHGrid: View {
    let payload: NSHPayload
    let byKey: [String: [NSHShift]]
    /// 今日（日本の日付）。列の見出しを青くする
    let today: String
    let tap: (NSHStaff, NSHDay, [NSHShift]) -> Void

    // 幅・高さ（static にして memberwise init の引数に入らないように）
    private static let nameWidth: CGFloat = 184
    private static let minDayWidth: CGFloat = 112
    private static let headHeight: CGFloat = 46
    private static let rowHeight: CGFloat = 70
    private var nameW: CGFloat { Self.nameWidth }
    private var minDayW: CGFloat { Self.minDayWidth }
    private var headH: CGFloat { Self.headHeight }
    private var rowH: CGFloat { Self.rowHeight }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            nameColumn
            Rectangle().fill(NT.line).frame(width: 1, height: headH + rowH * CGFloat(payload.staff.count))
            GeometryReader { geo in
                ScrollView(.horizontal, showsIndicators: true) {
                    days(width: dayWidth(geo.size.width))
                }
            }
            .frame(height: headH + rowH * CGFloat(payload.staff.count))
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    /// 広い画面では 7 日がちょうど入る幅に、狭い画面では横に動かす
    private func dayWidth(_ total: CGFloat) -> CGFloat {
        let n = CGFloat(max(1, payload.weekDates.count))
        return max(minDayW, floor(total / n))
    }

    private var nameColumn: some View {
        VStack(spacing: 0) {
            Text("スタッフ").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                .padding(.horizontal, 14)
                .frame(width: nameW, height: headH, alignment: .leading)
                .background(NT.page)
            ForEach(payload.staff) { s in
                HStack(spacing: 6) {
                    Text(s.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                        .lineLimit(2).minimumScaleFactor(0.8)
                    if s.isHelp { NPBadge(text: "ヘルプ", color: NT.purple) }
                    if s.id == payload.selfId && !payload.canManage { NPBadge(text: "自分", color: NT.ink3) }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .frame(width: nameW, height: rowH)
                .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
            }
        }
    }

    private func days(width w: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(payload.weekDates, id: \.date) { d in
                    Text(d.label).font(.system(size: 13, weight: .bold)).monospacedDigit()
                        .foregroundColor(d.date == today ? Color.white : headColor(d))
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Capsule().fill(d.date == today ? NT.purple : Color.clear))
                        .frame(width: w, height: headH)
                }
            }
            .background(NT.page)
            ForEach(payload.staff) { s in
                HStack(spacing: 0) {
                    ForEach(payload.weekDates, id: \.date) { d in
                        cell(s, d).frame(width: w, height: rowH)
                    }
                }
                .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
            }
        }
    }

    private func headColor(_ d: NSHDay) -> Color {
        if d.label.hasSuffix("(土)") { return NT.purple }
        if d.label.hasSuffix("(日)") { return NT.danger }
        return NT.ink2
    }

    private func cell(_ s: NSHStaff, _ d: NSHDay) -> some View {
        let list = byKey[s.id + "_" + d.date] ?? []
        let clickable = payload.canManage || s.id == payload.selfId
        return Button { tap(s, d, list) } label: {
            NSHCellFace(list: list, clickable: clickable)
        }
        .buttonStyle(PressableStyle())
        .disabled(!clickable)
        .padding(5)
    }
}

/// マスの中（Web と同じ：時間・種別（変更申請中）・+N。下書きは「下書き」も）
struct NSHCellFace: View {
    let list: [NSHShift]
    let clickable: Bool

    var body: some View {
        let first = list.first
        let st = NSHStyle.of(first)
        return VStack(spacing: 2) {
            if let sh = first {
                Text("\(sh.startTime)–\(sh.endTime)").font(.system(size: 14, weight: .heavy)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                HStack(spacing: 3) {
                    Text(sh.status == "change_requested" ? "変更申請中" : NSHFmt.kindShort(sh.kind))
                    if sh.status == "draft" { Text("・下書き") }
                    if list.count > 1 { Text("+\(list.count - 1)") }
                }
                .font(.system(size: 11, weight: .bold))
                .lineLimit(1).minimumScaleFactor(0.7)
            } else if clickable {
                Image(systemName: "plus").font(.system(size: 16, weight: .semibold))
            } else {
                Text("—").font(.system(size: 14))
            }
        }
        .foregroundColor(st.fg)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(st.bg))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(st.border, style: StrokeStyle(lineWidth: st.width, dash: first == nil ? [4, 3] : []))
        )
        .contentShape(Rectangle())
    }
}

// MARK: - マスの編集（Web の CellDialog：店長の編集・本人の希望・変更申請）

struct NSHCellSheet: View {
    let edit: NSHEdit
    let onDone: (String) -> Void
    let onClose: () -> Void

    /// 編集するシフトの番号（shifts.count＝新しく追加）
    @State private var pick: Int
    @State private var start: String
    @State private var end: String
    @State private var kind: String
    @State private var dayOff = false
    @State private var reason = ""
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false

    init(edit: NSHEdit, onDone: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.edit = edit
        self.onDone = onDone
        self.onClose = onClose
        let first = edit.shifts.first
        _pick = State(initialValue: 0)
        _start = State(initialValue: first?.startTime ?? "09:00")
        _end = State(initialValue: first?.endTime ?? "17:00")
        _kind = State(initialValue: first?.kind ?? "planned")
    }

    /// 今編集しているシフト（nil＝新しく作る）
    private var shift: NSHShift? { pick < edit.shifts.count ? edit.shifts[pick] : nil }

    private var pickBinding: Binding<Int> {
        Binding(get: { pick }, set: { i in
            pick = i
            let s: NSHShift? = i < edit.shifts.count ? edit.shifts[i] : nil
            start = s?.startTime ?? "09:00"
            end = s?.endTime ?? "17:00"
            kind = s?.kind ?? "planned"
            error = nil
        })
    }

    private var title: String {
        edit.mode == .change ? "\(edit.day.label) のシフト変更申請" : "\(edit.staff.name) さん — \(edit.day.label)"
    }

    private var confirmText: String {
        if busy { return edit.mode == .change ? "送信中…" : "保存中…" }
        switch edit.mode {
        case .manage: return "保存する"
        case .request: return "希望を提出"
        case .change: return "変更申請を送る"
        }
    }

    private var canDelete: Bool {
        guard let s = shift else { return false }
        return edit.mode == .manage || (edit.mode == .request && s.kind == "requested")
    }

    private var canReject: Bool { edit.mode == .manage && shift?.status == "change_requested" }

    var body: some View {
        NavigationStack {
            Form {
                if edit.mode == .change { changeForm } else { editForm }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
                if canDelete || canReject {
                    Section {
                        if canReject {
                            Button("変更申請を却下", role: .destructive) { reject() }.disabled(busy)
                        }
                        if canDelete {
                            Button("このシフトを削除", role: .destructive) { confirmDelete = true }.disabled(busy)
                        }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(confirmText) { submit() }.disabled(busy) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .alert("シフトを削除", isPresented: $confirmDelete) {
            Button("削除する", role: .destructive) { remove() }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("\(edit.staff.name) さん \(edit.day.label) \(shift?.startTime ?? start)–\(shift?.endTime ?? end)")
        }
    }

    @ViewBuilder private var editForm: some View {
        if edit.mode == .manage && !edit.shifts.isEmpty {
            Section("シフト") {
                Picker("編集するシフト", selection: pickBinding) {
                    ForEach(Array(edit.shifts.enumerated()), id: \.offset) { i, s in
                        Text("\(s.startTime)–\(s.endTime) \(NSHFmt.kindShort(s.kind))").tag(i)
                    }
                    Text("＋ 新しく追加").tag(edit.shifts.count)
                }
            }
        }
        if let s = shift, edit.mode == .manage, s.status == "change_requested" {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("変更申請中").font(.system(size: 14, weight: .bold))
                    Text(s.note ?? "").font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
                }
                .foregroundColor(NT.warn)
            }
        }
        Section("時間") {
            DatePicker("開始", selection: NHXTime.binding($start), displayedComponents: .hourAndMinute)
            DatePicker("終了", selection: NHXTime.binding($end), displayedComponents: .hourAndMinute)
        }
        if edit.mode == .manage {
            Section("種別") {
                Picker("種別", selection: $kind) {
                    ForEach(NSHFmt.kinds, id: \.self) { k in Text(NSHFmt.kindLabel(k)).tag(k) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    @ViewBuilder private var changeForm: some View {
        Section {
            HStack {
                Text("現在のシフト")
                Spacer()
                Text(shift.map { "\($0.startTime)–\($0.endTime)" } ?? "—").monospacedDigit().foregroundColor(NT.ink2)
            }
            Toggle("休み希望（出勤なし）", isOn: $dayOff)
        }
        if !dayOff {
            Section("希望の時間") {
                DatePicker("希望開始", selection: NHXTime.binding($start), displayedComponents: .hourAndMinute)
                DatePicker("希望終了", selection: NHXTime.binding($end), displayedComponents: .hourAndMinute)
            }
        }
        Section("理由（必須）") {
            TextField("例: 通院のため", text: $reason, axis: .vertical).lineLimit(3...6)
        }
    }

    private func submit() {
        error = nil
        switch edit.mode {
        case .manage:
            guard start < end else { error = "終了時刻は開始時刻より後にしてください"; return }
            var req: [String: Any] = ["type": "shiftUpsert", "profileId": edit.staff.id, "date": edit.day.date, "startTime": start, "endTime": end, "kind": kind]
            if let s = shift { req["id"] = s.id }
            send(req, fallback: "シフトを保存しました")
        case .request:
            guard start < end else { error = "終了時刻は開始時刻より後にしてください"; return }
            var req: [String: Any] = ["type": "shiftRequest", "date": edit.day.date, "startTime": start, "endTime": end]
            if let s = shift { req["id"] = s.id }
            send(req, fallback: "希望を提出しました")
        case .change:
            let why = reason.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !why.isEmpty else { error = "理由を入力してください"; return }
            if !dayOff && start >= end { error = "終了時刻は開始時刻より後にしてください"; return }
            guard let s = shift else { return }
            let req: [String: Any] = [
                "type": "shiftChangeRequest",
                "shiftId": s.id,
                "dayOff": dayOff,
                "desiredStart": NHXApi.orNull(dayOff ? nil : start),
                "desiredEnd": NHXApi.orNull(dayOff ? nil : end),
                "reason": why,
            ]
            send(req, fallback: "変更申請を送信しました")
        }
    }

    private func remove() {
        guard let s = shift else { return }
        send(["type": "shiftDelete", "id": s.id], fallback: "シフトを削除しました")
    }

    private func reject() {
        guard let s = shift else { return }
        send(["type": "shiftRejectChange", "shiftId": s.id], fallback: "変更申請を却下しました")
    }

    private func send(_ req: [String: Any], fallback: String) {
        busy = true
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onDone(r.message ?? fallback) } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - シフトを追加（Web の CreateShiftDialog。店舗間ヘルプも）

struct NSHCreateSheet: View {
    let payload: NSHPayload
    let onDone: (String) -> Void
    let onClose: () -> Void

    @State private var includeHelp = false
    @State private var profileId = ""
    @State private var date: String
    @State private var start = "09:00"
    @State private var end = "17:00"
    @State private var kind = "planned"
    @State private var error: String?
    @State private var busy = false

    init(payload: NSHPayload, onDone: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.payload = payload
        self.onDone = onDone
        self.onClose = onClose
        _date = State(initialValue: payload.weekDates.first?.date ?? "")
    }

    /// 自店（＋この週にヘルプで入っている人）か、組織の店舗スタッフ全員（店舗間ヘルプ）
    private var options: [NSHOrgStaff] {
        includeHelp ? payload.orgStaffOptions : payload.staff.map { NSHOrgStaff(id: $0.id, name: $0.name, homeStores: "") }
    }

    private var helpBinding: Binding<Bool> {
        Binding(get: { includeHelp }, set: { v in
            includeHelp = v
            profileId = ""
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("他店舗スタッフを含める（店舗間ヘルプ）", isOn: helpBinding)
                    Picker("スタッフ", selection: $profileId) {
                        Text("選択してください").tag("")
                        ForEach(options) { s in
                            Text(s.homeStores.isEmpty ? s.name : "\(s.name)（\(s.homeStores)）").tag(s.id)
                        }
                    }
                    Picker("日付", selection: $date) {
                        ForEach(payload.weekDates, id: \.date) { d in Text(d.label).tag(d.date) }
                    }
                }
                Section("時間") {
                    DatePicker("開始", selection: NHXTime.binding($start), displayedComponents: .hourAndMinute)
                    DatePicker("終了", selection: NHXTime.binding($end), displayedComponents: .hourAndMinute)
                }
                Section("種別") {
                    Picker("種別", selection: $kind) {
                        ForEach(NSHFmt.kinds, id: \.self) { k in Text(NSHFmt.kindLabel(k)).tag(k) }
                    }
                    .pickerStyle(.segmented)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("シフトを追加")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? "保存中…" : "追加する") { submit() }.disabled(busy) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func submit() {
        if profileId.isEmpty { error = "スタッフを選択してください"; return }
        if start >= end { error = "終了時刻は開始時刻より後にしてください"; return }
        error = nil
        busy = true
        let req: [String: Any] = ["type": "shiftUpsert", "profileId": profileId, "date": date, "startTime": start, "endTime": end, "kind": kind]
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onDone(r.message ?? "シフトを保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 必要人数を追加（Web の RequirementDialog）

struct NSHRequirementSheet: View {
    let onDone: (String) -> Void
    let onClose: () -> Void

    @State private var day = 1
    @State private var from = "11:00"
    @State private var to = "15:00"
    @State private var count = 2
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("曜日", selection: $day) {
                        ForEach(0..<7, id: \.self) { i in Text("\(NSHFmt.weekday(i))曜日").tag(i) }
                    }
                    DatePicker("開始", selection: NHXTime.binding($from), displayedComponents: .hourAndMinute)
                    DatePicker("終了", selection: NHXTime.binding($to), displayedComponents: .hourAndMinute)
                    Stepper("必要人数：\(count)人", value: $count, in: 1...99)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("必要人数を追加")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? "保存中…" : "追加する") { submit() }.disabled(busy) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func submit() {
        if from >= to { error = "終了時刻は開始時刻より後にしてください"; return }
        error = nil
        busy = true
        let req: [String: Any] = ["type": "shiftReqAdd", "dayOfWeek": day, "timeFrom": from, "timeTo": to, "requiredCount": count]
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onDone(r.message ?? "必要人数設定を追加しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - シフト・従業員台帳で共通の部品（NHX）

struct NHXResult: Decodable {
    let ok: Bool
    let error: String?
    let message: String?
    let id: String?
}

enum NHXApi {
    private static func send(_ body: [String: Any]) async throws -> Data {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await NativeAPI.shared.send(req, kickPrint: false)
    }

    /// 操作（POST { type: …, … }）。返事の message（「シフトを保存しました」など）も返す
    static func post(_ body: [String: Any]) async -> NHXResult {
        do {
            let data = try await send(body)
            return try JSONDecoder().decode(NHXResult.self, from: data)
        } catch {
            return NHXResult(ok: false, error: NativeModuleAPI.message(error), message: nil, id: nil)
        }
    }

    /// 読み込みを POST で（個人情報。GET の返事は iPad に保存されるため。従業員台帳）
    static func load<T: Decodable>(_ type: T.Type, _ body: [String: Any]) async throws -> T {
        let data = try await send(body)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// nil は JSON の null に
    static func orNull<T>(_ v: T?) -> Any {
        if let v { return v }
        return NSNull()
    }
}

/// "HH:mm" ⇄ 時刻を選ぶ（DatePicker）
enum NHXTime {
    static let f: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static func binding(_ s: Binding<String>) -> Binding<Date> {
        Binding(
            get: { f.date(from: s.wrappedValue) ?? f.date(from: "09:00") ?? Date() },
            set: { s.wrappedValue = f.string(from: $0) }
        )
    }
}

/// 画面の枠：上のバー（ホーム／戻る）・読み込み中／エラー・下に出る知らせ
struct NHXPage<Content: View>: View {
    let title: String
    var backIcon: String = "house.fill"
    let onBack: () -> Void
    let loaded: Bool
    let error: String?
    @Binding var toast: String?
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: title, subtitle: "", onHome: onBack, backIcon: backIcon)
            if loaded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) { content() }
                        .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 32)
                        .frame(maxWidth: 1100, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
                .refreshable { await retry() }
            } else {
                Spacer()
                if let error {
                    VStack(spacing: 10) {
                        Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                        Button("もう一度") { Task { await retry() } }
                    }
                    .padding(.horizontal, 40)
                } else {
                    ProgressView("読み込み中…").tint(NT.purple)
                }
                Spacer()
            }
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .bottom) { toastView }
    }

    @ViewBuilder private var toastView: some View {
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

/// 白いカード（見出し＋右のボタン＋中身）
struct NHXCard<Trailing: View, Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let trailing: () -> Trailing
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    if let note { Text(note).font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 8)
                trailing()
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            Rectangle().fill(NT.line).frame(height: 1)
            content()
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

struct NHXButton: View {
    enum Kind { case primary, secondary, danger }
    let text: String
    var icon: String? = nil
    var kind: Kind = .secondary
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().scaleEffect(0.8).tint(kind == .secondary ? NT.purple : Color.white)
                } else if let icon {
                    Image(systemName: icon)
                }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(kind == .secondary ? NT.ink : Color.white)
            .padding(.horizontal, 16).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(background))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(kind == .secondary ? NT.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }

    private var background: Color {
        switch kind {
        case .primary: return NT.purple
        case .danger: return NT.danger
        case .secondary: return Color.white
        }
    }
}

/// 丸い枠の矢印だけのボタン（前の週・次の週）
struct NHXIconButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

struct NHXEmpty: View {
    let title: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
            if let message { Text(message).font(.system(size: 13)).foregroundColor(NT.ink3).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 16)
    }
}

/// 黄色い注意の枠（人員不足・配置の注意・機密情報の説明など）
struct NHXNotice<Content: View>: View {
    let title: String
    var icon: String = "exclamationmark.triangle.fill"
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).padding(.top, 1)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 14.5, weight: .heavy)).fixedSize(horizontal: false, vertical: true)
                content()
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 13.5))
        .foregroundColor(NT.warn)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.saffronSoft))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.warn.opacity(0.3), lineWidth: 1))
    }
}
