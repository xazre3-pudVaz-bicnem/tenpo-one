import SwiftUI

// iPhone の店長・オーナー：勤怠・打刻（/app/attendance）のネイティブ（2026-10-25 Ronnie「iPhone も native に」）。
//   今日     … 今日の打刻をスタッフごとに（勤務中・休憩中・退勤済・打刻漏れ・有給／欠勤）。承認する人には
//              公開済みのシフトがあるのにまだ出勤していない人も（シフト GET part=shifts を重ねる）。打刻履歴・修正申請・区分の変更
//   打刻     … 自分の出勤・休憩開始・休憩終了・退勤（本日のシフト・他店舗の出勤の注意）
//   勤怠一覧 … 月・スタッフで絞る・打刻履歴・修正申請・区分を変更・勤怠を手動追加（有給・欠勤）
//   承認     … 承認待ちの修正申請（現在値・希望値・理由）・承認・却下（店長以上）
// サーバーは iPad と同じ GET part=attendance（tab=list|punch|requests）と POST attendance…（lib/native-modules/attendance.ts）。
// iPad の中身の形（NATPayload …）・入力のシート（修正申請・区分・手動追加）・NATApi をそのまま使う（iPad は変えない）。
// 共用端末（PIN）の打刻は iPad のレジで（iPhone は本人の打刻だけ）。

// MARK: - 中身の持ち主

@MainActor
final class NPATModel: ObservableObject {
    enum Tab: String { case today, punch, list, requests }

    @Published var tab: Tab
    /// 今日（今月の勤怠一覧から今日の分を出す）
    @Published var todayP: NATPayload?
    /// 今週のシフト（今日シフトがあるのに出勤していない人。読めなくても今日は出す）
    @Published var shiftsP: NSHPayload?
    @Published var punchP: NATPayload?
    @Published var listP: NATPayload?
    @Published var requestsP: NATPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    @Published var busy = false
    @Published var loading = false
    /// 勤怠一覧の月（'YYYY-MM'。空＝今月）・スタッフ（空＝全員）
    @Published var month: String
    @Published var staffId: String

    init(tab: String?, month: String?, staffId: String?) {
        self.tab = NPATModel.parseTab(tab)
        self.month = month ?? ""
        self.staffId = staffId ?? ""
    }

    static func parseTab(_ raw: String?) -> Tab {
        switch raw {
        case "punch": return .punch
        case "list": return .list
        case "requests": return .requests
        default: return .today
        }
    }

    /// どれかのタブの返事（店舗名・権限はどれにも入っている）
    var base: NATPayload? { todayP ?? punchP ?? listP ?? requestsP }
    var isApprover: Bool { base?.isApprover ?? false }
    var requestCount: Int { requestsP?.requests?.count ?? 0 }

    func payload(_ t: Tab) -> NATPayload? {
        switch t {
        case .today: return todayP
        case .punch: return punchP
        case .list: return listP
        case .requests: return requestsP
        }
    }

    var current: NATPayload? { payload(tab) }

    static func thisMonth() -> String { String(NATTime.dayFmt.string(from: Date()).prefix(7)) }

    nonisolated static func weekShifts() async -> NSHPayload? {
        try? await NSHApi.load(week: nil)
    }

    func select(_ key: String) {
        let t = NPATModel.parseTab(key)
        tab = t
        Task { await load(t) }
    }

    func load() async { await load(tab) }

    func load(_ t: Tab) async {
        // 見本（-tenpoNativePreview phoneAttendance）は読み込まない
        if NativePreview.current != nil { return }
        loading = true
        do {
            switch t {
            case .today:
                async let shifts = Self.weekShifts()
                // 今月（サーバーの今日が分かっていればそちら。端末の時計がずれていても今日の分が出る）
                let month = base.map { String($0.today.prefix(7)) } ?? Self.thisMonth()
                let p = try await NATApi.get(NATPayload.self, part: "attendance", ["tab": "list", "month": month])
                todayP = p
                shiftsP = await shifts
            case .punch:
                punchP = try await NATApi.get(NATPayload.self, part: "attendance", ["tab": "punch"])
            case .list:
                var q: [String: String] = ["tab": "list"]
                if !month.isEmpty { q["month"] = month }
                if !staffId.isEmpty { q["staffId"] = staffId }
                let p = try await NATApi.get(NATPayload.self, part: "attendance", q)
                listP = p
                if let m = p.month { month = m }
                if let s = p.staffId { staffId = s }
            case .requests:
                let p = try await NATApi.get(NATPayload.self, part: "attendance", ["tab": "requests"])
                // 承認の権限が無い人にはサーバーが打刻タブを返す
                if p.tab == "requests" { requestsP = p } else { punchP = p; tab = .punch }
            }
            error = nil
        } catch {
            if payload(t) == nil && t == tab { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
        loading = false
        if t != .requests && requestsP == nil { await refreshRequestCount() }
    }

    /// 承認待ちの数（タブの赤い丸）。承認する人だけ
    func refreshRequestCount() async {
        guard isApprover, NativePreview.current == nil else { return }
        if let p = try? await NATApi.get(NATPayload.self, part: "attendance", ["tab": "requests"]), p.tab == "requests" { requestsP = p }
    }

    func go(month m: String? = nil, staffId s: String? = nil) {
        if let m { month = m }
        if let s { staffId = s }
        Task { await load(.list) }
    }

    /// ボタンの操作：返事をお知らせに出して読み直す
    func act(_ body: [String: Any]) async {
        if NativePreview.current != nil { toast = NATToast(text: "見本のため保存しません", tone: .warn); return }
        busy = true
        let r = await NATApi.post(body)
        busy = false
        toast = NATToast.from(r)
        if r.ok {
            await load(tab)
            if tab != .requests { await refreshRequestCount() }
        }
    }

    /// 入力のシートの操作：できたら nil（お知らせ・読み直し）、だめならことば（シートに出す）
    func submit(_ body: [String: Any]) async -> String? {
        if NativePreview.current != nil { toast = NATToast(text: "見本のため保存しません", tone: .warn); return nil }
        busy = true
        let r = await NATApi.post(body)
        busy = false
        if r.ok {
            toast = NATToast.from(r)
            await load(tab)
            return nil
        }
        return r.error ?? r.message ?? "できませんでした"
    }
}

// MARK: - 表示のきまり

enum NPATFmt {
    /// 今日の行の状態（ことば・色・並び順）
    static func state(_ r: NATRow) -> (label: String, color: Color, order: Int) {
        if r.entryType == "paid_leave" { return ("有給", NT.purple, 5) }
        if r.entryType == "absent" { return ("欠勤", NT.danger, 5) }
        if r.missing { return ("打刻漏れ", NT.danger, 3) }
        let inDone = r.clockInLabel != "—"
        let outDone = r.clockOutLabel != "—" && r.clockOutLabel != "未打刻"
        if inDone && !outDone {
            if r.events.last?.label == "休憩開始" { return ("休憩中", NT.warn, 1) }
            return ("勤務中", NT.ok, 0)
        }
        if outDone { return ("退勤済", NT.ink3, 6) }
        return (r.statusLabel, NT.ink3, 6)
    }

    /// '2026/10/25 9:02' → '9:02'
    static func time(_ label: String) -> String {
        guard let i = label.lastIndex(of: " ") else { return label }
        return String(label[label.index(after: i)...])
    }
}

/// 今日のスタッフ 1 人分（勤怠の行、または「シフトはあるけれど出勤していない」）
struct NPATTodayItem: Identifiable {
    let id: String
    let name: String
    let row: NATRow?
    let shift: NSHShift?
    let state: String
    let color: Color
    let order: Int
}

// MARK: - 入口（Web の道 → 画面）

struct NativePhoneAttendanceScreen: View {
    let onBack: () -> Void
    @StateObject private var model: NPATModel

    init(route: NativeModuleRoute, onBack: @escaping () -> Void) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: NPATModel(tab: route.query("tab"), month: route.query("month"), staffId: route.query("staffId")))
    }

    var body: some View {
        NativePhoneAttendanceView(model: model, onBack: onBack)
    }
}

// MARK: - 画面

struct NativePhoneAttendanceView: View {
    @ObservedObject var model: NPATModel
    let onBack: () -> Void
    @State private var sheet: NATSheet?
    @State private var approving: NATRequest?
    @State private var prompt: NPReasonPrompt?
    @State private var expanded: Set<String> = []

    private var tabs: [NPWTab] {
        var t = [NPWTab(key: "today", label: "今日"), NPWTab(key: "punch", label: "打刻"), NPWTab(key: "list", label: "勤怠一覧")]
        if model.isApprover { t.append(NPWTab(key: "requests", label: "承認", count: model.requestCount)) }
        return t
    }

    var body: some View {
        NPWPage(
            title: "勤怠・打刻",
            subtitle: model.base?.store.name ?? "",
            onBack: onBack,
            loaded: model.current != nil,
            error: model.error,
            toast: $model.toast,
            retry: { await model.load() },
            header: { NPWTabBar(tabs: tabs, selected: model.tab.rawValue) { k in model.select(k) } },
            content: { content }
        )
        .task { await model.load() }
        .sheet(item: $sheet) { s in sheetView(s) }
        .sheet(item: $prompt) { pr in
            NPReasonSheet(prompt: pr) { prompt = nil }
                .presentationDetents([.medium])
                .environment(\.colorScheme, .light)
        }
        .alert("修正申請を承認", isPresented: Binding(get: { approving != nil }, set: { if !$0 { approving = nil } }), presenting: approving) { r in
            Button("キャンセル", role: .cancel) {}
            Button("承認する") { Task { await model.act(["type": "attendanceApprove", "requestId": r.id]) } }
        } message: { _ in
            Text("この内容で勤怠記録を更新します。よろしいですか。")
        }
    }

    @ViewBuilder private var content: some View {
        switch model.tab {
        case .today:
            if let p = model.todayP { todaySection(p) }
        case .punch:
            if let p = model.punchP { punchSection(p) }
        case .list:
            if let p = model.listP { listSection(p) }
        case .requests:
            if let p = model.requestsP { requestsSection(p) }
        }
    }

    // MARK: 今日

    private func todayItems(_ p: NATPayload) -> [NPATTodayItem] {
        let today = p.today
        let rows = (p.rows ?? []).filter { $0.workDate == today }
        // 今日の公開済みのシフト（希望・下書きは入れない）
        let shifts = (model.shiftsP?.shifts ?? []).filter { $0.date == today && $0.kind != "requested" && $0.status != "draft" }
        var names: [String: String] = [:]
        for s in model.shiftsP?.staff ?? [] { names[s.id] = s.name }
        var items: [NPATTodayItem] = rows.map { r in
            let st = NPATFmt.state(r)
            let shift = shifts.filter { $0.profileId == r.profileId }.sorted { $0.startTime < $1.startTime }.first
            return NPATTodayItem(id: r.id, name: r.staffName ?? p.displayName, row: r, shift: shift, state: st.label, color: st.color, order: st.order)
        }
        if p.isApprover {
            let seen = Set(rows.map { $0.profileId })
            let now = NATTime.hmFmt.string(from: Date())
            var added = Set<String>()
            for s in shifts.sorted(by: { $0.startTime < $1.startTime }) where !seen.contains(s.profileId) && !added.contains(s.profileId) {
                added.insert(s.profileId)
                let late = s.startTime <= now
                items.append(NPATTodayItem(id: "shift-" + s.id, name: names[s.profileId] ?? "—", row: nil, shift: s,
                                           state: late ? "未出勤" : "出勤前", color: late ? NT.danger : NT.ink3, order: late ? 2 : 4))
            }
        }
        return items.sorted { a, b in
            if a.order != b.order { return a.order < b.order }
            let ta = a.shift?.startTime ?? a.row?.defaultClockIn ?? ""
            let tb = b.shift?.startTime ?? b.row?.defaultClockIn ?? ""
            if ta != tb { return ta < tb }
            return a.name < b.name
        }
    }

    @ViewBuilder private func todaySection(_ p: NATPayload) -> some View {
        let items = todayItems(p)
        let working = items.filter { $0.order <= 1 }.count
        let late = items.filter { $0.order == 2 || $0.order == 3 }.count
        let done = items.filter { $0.order == 6 }.count
        Text(NATTime.clockDate.string(from: NATTime.day(p.today)))
            .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
        if p.isApprover {
            HStack(spacing: 8) {
                NPWStat(label: "勤務中", value: "\(working)人", color: NT.ok)
                NPWStat(label: "未出勤・漏れ", value: "\(late)人", color: late > 0 ? NT.danger : NT.ink)
                NPWStat(label: "退勤済", value: "\(done)人")
            }
        }
        if items.isEmpty {
            NPWEmpty(icon: "clock", title: "今日の打刻はまだありません", message: p.isApprover ? "スタッフが出勤すると、ここに出ます" : "「打刻」から出勤を記録してください")
        } else {
            ForEach(items) { item in
                NPATTodayCard(item: item, isApprover: p.isApprover, busy: model.busy,
                              correct: { r in sheet = .correction(r) },
                              changeType: { r in sheet = .entryType(r) })
            }
        }
        if model.shiftsP == nil && p.isApprover {
            Text("シフトを読めなかったため、出勤前・未出勤の人は出ていません").font(.system(size: 11.5)).foregroundColor(NT.ink3)
        }
    }

    // MARK: 打刻（自分）

    @ViewBuilder private func punchSection(_ p: NATPayload) -> some View {
        if let punch = p.punch {
            if let s = punch.todayShift { NATNotice(text: s, icon: "calendar") }
            if let e = punch.elsewhere { NATNotice(text: e, icon: "exclamationmark.triangle.fill", color: NT.danger, background: NT.dangerBg) }
            NPATClockCard(name: p.displayName, onBreak: punch.onBreak, working: punch.open)
            if punch.onBreak {
                NATNotice(text: "休憩中です。退勤すると休憩を自動終了します。", icon: "cup.and.saucer", color: NT.warn, background: NFColor.saffronSoft)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(["clock_in", "clock_out", "break_start", "break_end"], id: \.self) { type in
                    punchButton(type, p: p, punch: punch)
                }
            }
            if !p.canPunch {
                Text("この役割では打刻できません").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
            }
            Text("共用端末（PIN）での打刻は、お店の iPad（レジ）の勤怠から行えます。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func punchButton(_ type: String, p: NATPayload, punch: NATPunch) -> some View {
        let label = p.punchEvents.first { $0.value == type }?.label ?? type
        let enabled: Bool = {
            switch type {
            case "clock_in": return punch.canClockIn
            case "clock_out": return punch.canClockOut
            case "break_start": return punch.canBreakStart
            default: return punch.canBreakEnd
            }
        }()
        let on = enabled && p.canPunch
        let filled = type == "clock_in" || type == "clock_out"
        let tint: Color = type == "clock_out" ? NT.danger : NT.purple
        let icon: String = {
            switch type {
            case "clock_in": return "arrow.right.square"
            case "clock_out": return "arrow.left.square"
            case "break_start": return "cup.and.saucer"
            default: return "play.fill"
            }
        }()
        return Button {
            Task { await model.act(["type": "attendancePunch", "eventType": type]) }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 26, weight: .bold))
                Text(label).font(.system(size: 21, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundColor(filled ? Color.white : NT.ink)
            .frame(maxWidth: .infinity, minHeight: 104)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(filled ? tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(filled ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!on || model.busy)
        .opacity(on ? 1 : 0.38)
        .accessibilityLabel("\(label)を記録する")
    }

    // MARK: 勤怠一覧

    @ViewBuilder private func listSection(_ p: NATPayload) -> some View {
        let rows = p.rows ?? []
        let staff = p.staffOptions ?? []
        let month = model.month.isEmpty ? (p.month ?? String(p.today.prefix(7))) : model.month
        let thisMonth = String(p.today.prefix(7))
        NPWPeriodBar(label: NATTime.monthLabel(month), resetLabel: month == thisMonth ? nil : "今月", loading: model.loading,
                     onPrev: { model.go(month: NATTime.shiftMonth(month, -1)) },
                     onNext: { model.go(month: NATTime.shiftMonth(month, 1)) },
                     onReset: { model.go(month: thisMonth) })
        if p.isApprover {
            HStack(spacing: 8) {
                if !staff.isEmpty {
                    Menu {
                        Button("スタッフ全員") { model.go(staffId: "") }
                        ForEach(staff) { s in
                            Button(s.name) { model.go(staffId: s.id) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "person.crop.circle").foregroundColor(NT.purple)
                            Text(model.staffId.isEmpty ? "スタッフ全員" : (staff.first { $0.id == model.staffId }?.name ?? "スタッフ全員"))
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                        }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                        .padding(.horizontal, 12).frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                }
                NPWButton(text: "手動追加", icon: "calendar.badge.plus", kind: .primary, disabled: model.busy) { sheet = .manual }
            }
        }
        if rows.isEmpty {
            NPWEmpty(icon: "calendar", title: "この期間の勤怠記録はありません", message: "「打刻」から出勤を記録してください")
        } else {
            NPWSectionTitle(title: "勤怠記録", count: "\(rows.count)件")
            LazyVStack(spacing: 10) {
                ForEach(rows) { row in
                    NPATRowCard(row: row, showStaff: p.showStaff == true, isApprover: p.isApprover, expanded: expanded.contains(row.id), busy: model.busy,
                                toggle: { toggle(row.id) },
                                correct: { sheet = .correction(row) },
                                changeType: { sheet = .entryType(row) })
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    // MARK: 承認

    @ViewBuilder private func requestsSection(_ p: NATPayload) -> some View {
        let requests = p.requests ?? []
        if requests.isEmpty {
            NPWEmpty(icon: "checkmark.seal", title: "承認待ちの修正申請はありません")
        } else {
            if !p.canReview {
                Text("この申請の承認・却下は店長以上のロールのみ行えます。閲覧のみ可能です。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
            NPWSectionTitle(title: "承認待ちの修正申請", count: "\(requests.count)件")
            ForEach(requests) { r in
                requestCard(r, canReview: p.canReview)
            }
        }
    }

    private func requestCard(_ r: NATRequest, canReview: Bool) -> some View {
        NPOCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Text(r.title).font(.system(size: 15.5, weight: .heavy)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    NATBadge(text: "承認待ち", color: NT.warn)
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("現在").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).frame(width: 34, alignment: .leading)
                        Text(r.current).font(.system(size: 14)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("希望").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple).frame(width: 34, alignment: .leading)
                        Text(r.desired).font(.system(size: 14, weight: .bold)).foregroundColor(NT.purpleDeep).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                VStack(alignment: .leading, spacing: 3) {
                    Text("理由").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    Text(r.reason.isEmpty ? "—" : r.reason).font(.system(size: 14)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                }
                if canReview {
                    HStack(spacing: 10) {
                        NPWButton(text: "却下", icon: "xmark", kind: .danger, disabled: model.busy, wide: true) {
                            prompt = NPReasonPrompt(title: "修正申請を却下", message: "この申請を却下します。理由を入力してください。", confirm: "却下する") { reason in
                                await model.act(["type": "attendanceReject", "requestId": r.id, "reason": reason])
                            }
                        }
                        NPWButton(text: "承認", icon: "checkmark", kind: .ok, disabled: model.busy, wide: true) { approving = r }
                    }
                }
            }
        }
    }

    // MARK: 入力のシート（iPad と同じもの）

    @ViewBuilder private func sheetView(_ s: NATSheet) -> some View {
        let p = model.base
        switch s {
        case .correction(let row):
            NATCorrectionSheet(row: row, submit: { await model.submit($0) }, onClose: { sheet = nil })
                .environment(\.colorScheme, .light)
        case .entryType(let row):
            NATEntryTypeSheet(row: row, choices: p?.entryTypes ?? [], submit: { await model.submit($0) }, onClose: { sheet = nil })
                .environment(\.colorScheme, .light)
        case .manual:
            NATManualSheet(staff: model.listP?.staffOptions ?? p?.staffOptions ?? [], today: p?.today ?? NATTime.dayFmt.string(from: Date()),
                           submit: { await model.submit($0) }, onClose: { sheet = nil })
                .environment(\.colorScheme, .light)
        }
    }
}

// MARK: - 時計（打刻）

struct NPATClockCard: View {
    let name: String
    let onBreak: Bool
    let working: Bool

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            VStack(spacing: 4) {
                Text(NATTime.clockDate.string(from: context.date))
                    .font(.system(size: 14, weight: .medium)).foregroundColor(Color.white.opacity(0.72))
                Text(NATTime.clockTime.string(from: context.date))
                    .font(.system(size: 54, weight: .bold)).monospacedDigit().foregroundColor(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
                HStack(spacing: 8) {
                    Text("\(name) さん").font(.system(size: 15, weight: .semibold)).foregroundColor(Color.white.opacity(0.85)).lineLimit(1)
                    if onBreak {
                        Text("休憩中").font(.system(size: 11.5, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 9).padding(.vertical, 3)
                            .background(Capsule().fill(NT.warn))
                    } else if working {
                        Text("勤務中").font(.system(size: 11.5, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 9).padding(.vertical, 3)
                            .background(Capsule().fill(NT.ok))
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20).padding(.horizontal, 16)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(NT.topBar))
        }
    }
}

// MARK: - 今日のスタッフのカード

struct NPATTodayCard: View {
    let item: NPATTodayItem
    let isApprover: Bool
    let busy: Bool
    let correct: (NATRow) -> Void
    let changeType: (NATRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                NPWAvatar(name: item.name, size: 38, color: item.color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                    if let s = item.shift {
                        Text("シフト \(s.startTime)〜\(s.endTime)").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                    }
                }
                Spacer(minLength: 6)
                Text(item.state).font(.system(size: 12.5, weight: .heavy)).foregroundColor(.white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().fill(item.color))
            }
            if let r = item.row {
                HStack(spacing: 0) {
                    cell("出勤", r.clockInLabel)
                    cell("退勤", r.clockOutLabel, danger: r.missing)
                    cell("休憩", "\(Int(r.breakMinutes.rounded()))分")
                    cell("実働", r.workedLabel)
                }
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                if !r.events.isEmpty {
                    WrapLayout(spacing: 6) {
                        ForEach(r.events) { e in
                            HStack(spacing: 4) {
                                Text(e.label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink2)
                                Text(NPATFmt.time(e.timeLabel)).font(.system(size: 11.5, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                                if e.viaPin { Image(systemName: "key.fill").font(.system(size: 9)).foregroundColor(NT.ink3) }
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Capsule().fill(NT.lilac))
                        }
                    }
                }
                if r.entryType != "normal" || r.locked {
                    HStack(spacing: 6) {
                        if r.entryType != "normal" { NATBadge(text: r.entryTypeLabel, color: NATRowView.typeColor(r.entryType)) }
                        if r.locked { NATBadge(text: "確定済み", icon: "lock.fill", color: NT.topBar) }
                    }
                }
                HStack(spacing: 8) {
                    NPWButton(text: "修正申請", icon: "pencil", disabled: busy, height: 40, wide: true) { correct(r) }
                    if isApprover && !r.locked {
                        NPWButton(text: "区分を変更", icon: "tag", disabled: busy, height: 40, wide: true) { changeType(r) }
                    }
                }
            } else if item.order == 2 {
                Text("シフトの開始時刻を過ぎていますが、まだ出勤の打刻がありません").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func cell(_ label: String, _ value: String, danger: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(danger ? NT.danger : NT.ink)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 勤怠一覧の 1 行（開くと打刻履歴）

struct NPATRowCard: View {
    let row: NATRow
    let showStaff: Bool
    let isApprover: Bool
    let expanded: Bool
    let busy: Bool
    let toggle: () -> Void
    let correct: () -> Void
    let changeType: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.workDateLabel).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                if showStaff {
                    Text(row.staffName ?? "—").font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink2).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            WrapLayout(spacing: 4) {
                NATBadge(text: row.entryTypeLabel, color: NATRowView.typeColor(row.entryType))
                if row.missing { NATBadge(text: "打刻漏れ", icon: "exclamationmark.triangle.fill", color: NT.danger) }
                if row.locked { NATBadge(text: "ロック", icon: "lock.fill", color: NT.topBar) }
                NATBadge(text: row.statusLabel, color: NATRowView.statusColor(row.status))
            }
            HStack(spacing: 0) {
                cell("出勤", row.clockInLabel)
                cell("退勤", row.clockOutLabel, danger: row.missing)
                cell("休憩", "\(Int(row.breakMinutes.rounded()))分")
                cell("実働", row.workedLabel)
            }
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            if row.locked {
                Text("確定済み（修正申請のみ可）").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            }
            HStack(spacing: 8) {
                Button(action: toggle) {
                    HStack(spacing: 4) {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 11, weight: .bold))
                        Text("打刻履歴").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundColor(NT.ink2)
                    .frame(height: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(expanded ? "打刻履歴を閉じる" : "打刻履歴を開く")
                Spacer(minLength: 4)
                NPWButton(text: "修正申請", icon: "pencil", disabled: busy, height: 38, action: correct)
                if isApprover && !row.locked {
                    NPWButton(text: "区分", icon: "tag", disabled: busy, height: 38, action: changeType)
                }
            }
            if expanded { history }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func cell(_ label: String, _ value: String, danger: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(danger ? NT.danger : NT.ink)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 0) {
            if row.events.isEmpty {
                Text("打刻イベントの記録がありません（手動登録など）").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    .padding(.vertical, 8)
            } else {
                ForEach(row.events) { e in
                    if e.id != row.events.first?.id { NPWDivider() }
                    HStack(spacing: 8) {
                        Text(e.label).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).frame(width: 64, alignment: .leading)
                        Text(e.timeLabel).font(.system(size: 13)).monospacedDigit().foregroundColor(NT.ink)
                        Spacer(minLength: 4)
                        Text(e.viaPin ? "\(e.sourceLabel)・PIN" : e.sourceLabel).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1)
                    }
                    .padding(.vertical, 7)
                }
            }
        }
        .padding(.horizontal, 10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
    }
}
