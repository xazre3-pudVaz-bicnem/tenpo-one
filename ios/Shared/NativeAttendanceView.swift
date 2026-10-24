import SwiftUI

// 勤怠のネイティブ。Web の /app/attendance と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   打刻     … 時計・本日のシフト・他店舗の出勤の注意・出勤／休憩開始／休憩終了／退勤（自分）・共用端末モード（PIN で打刻）
//   勤怠一覧 … 月・スタッフで絞る・打刻履歴（行を開く）・打刻漏れ・ロック・修正申請・区分を変更・勤怠を手動追加（有給・欠勤）
//   承認     … 承認待ちの修正申請（現在値・希望値・理由）・承認・却下（店長以上）
// サーバーは lib/native-modules/attendance.ts（読み込みは Web と同じ lib/attendance-server.ts、操作は Web と同じ Server Action）。
// スタッフの勤怠は iPad に残さない（レジの iPad は何人も使う）：読んだらすぐ保存を消す・前の中身を先に出さない・PIN はすぐ消す。

// MARK: - 中身（サーバーの返事）

struct NATOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NATChoice: Decodable, Hashable {
    let value: String
    let label: String
}

struct NATStore: Decodable, Hashable {
    let id: String
    let name: String
}

struct NATPunch: Decodable, Hashable {
    let open: Bool
    let onBreak: Bool
    let canClockIn: Bool
    let canClockOut: Bool
    let canBreakStart: Bool
    let canBreakEnd: Bool
    /// 「本日のシフト: 10:00〜18:00」
    let todayShift: String?
    /// 「新宿店で出勤打刻が残っています。…」
    let elsewhere: String?
}

struct NATEvent: Decodable, Hashable, Identifiable {
    let id: String
    let label: String
    let timeLabel: String
    let sourceLabel: String
    let viaPin: Bool
}

struct NATRow: Decodable, Hashable, Identifiable {
    let id: String
    let workDate: String
    let workDateLabel: String
    let staffName: String?
    let profileId: String
    let clockInLabel: String
    let clockOutLabel: String
    let breakMinutes: Double
    let workedLabel: String
    let entryType: String
    let entryTypeLabel: String
    let missing: Bool
    let status: String
    let statusLabel: String
    let locked: Bool
    let defaultClockIn: String
    let defaultClockOut: String
    let events: [NATEvent]
}

struct NATRequest: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let workDate: String
    let current: String
    let desired: String
    let reason: String
}

struct NATPayload: Decodable {
    let ok: Bool
    let tab: String
    let store: NATStore
    let displayName: String
    let isApprover: Bool
    let canReview: Bool
    let canPunch: Bool
    let isRegisterDevice: Bool?
    let today: String
    let entryTypes: [NATChoice]
    let punchEvents: [NATChoice]
    let punch: NATPunch?
    let month: String?
    let monthLabel: String?
    let staffId: String?
    let staffOptions: [NATOption]?
    let showStaff: Bool?
    let rows: [NATRow]?
    let requests: [NATRequest]?
}

/// 操作の返事（Server Action の { ok, message, warning }）
struct NATResult: Decodable {
    let ok: Bool
    let error: String?
    let message: String?
    let warning: Bool?
}

// MARK: - 読み込み・操作（勤怠・有給で共通）

enum NATApi {
    /// GET part=attendance／leave。スタッフの勤怠・有給は iPad に残さない（NativeAPI.send が保存した分をすぐ消す。前の中身も先に出さない）
    static func get<T: Decodable>(_ type: T.Type, part: String, _ query: [String: String]) async throws -> T {
        defer { NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url(part, query))) }
        return try await NativeModuleAPI.get(T.self, part: part, query: query)
    }

    /// POST（{ type: …, … }）。返事の message（「出勤を記録しました」など）・warning も返す
    @MainActor
    static func post(_ body: [String: Any]) async -> NATResult {
        do {
            var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            return try JSONDecoder().decode(NATResult.self, from: data)
        } catch {
            return NATResult(ok: false, error: NativeModuleAPI.message(error), message: nil, warning: nil)
        }
    }
}

/// 下に出すお知らせ（成功・注意・失敗で色を変える）
struct NATToast: Equatable {
    enum Tone { case ok, warn, error }
    let text: String
    var tone: Tone = .ok

    static func from(_ r: NATResult) -> NATToast {
        if r.ok { return NATToast(text: r.message ?? "できました", tone: r.warning == true ? .warn : .ok) }
        return NATToast(text: r.error ?? r.message ?? "できませんでした", tone: .error)
    }
}

/// 日本時間の日付・時刻（入力欄 ⇄ 'YYYY-MM-DD'・'HH:mm'）
enum NATTime {
    static let tz = TimeZone(identifier: "Asia/Tokyo") ?? TimeZone.current

    private static func formatter(_ format: String, locale: String = "en_US_POSIX") -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: locale)
        f.timeZone = tz
        f.dateFormat = format
        return f
    }

    static let dayFmt = formatter("yyyy-MM-dd")
    static let hmFmt = formatter("HH:mm")
    static let clockDate = formatter("y年M月d日(E)", locale: "ja_JP")
    static let clockTime = formatter("HH:mm:ss")

    static func day(_ s: String) -> Date { dayFmt.date(from: s) ?? Date() }

    /// 今日のその時刻（日本時間）
    static func hm(_ s: String) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        let parts = s.split(separator: ":").compactMap { Int($0) }
        let h = parts.count > 0 ? parts[0] : 9
        let m = parts.count > 1 ? parts[1] : 0
        return cal.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
    }

    static func dayBinding(_ s: Binding<String>) -> Binding<Date> {
        Binding(get: { day(s.wrappedValue) }, set: { s.wrappedValue = dayFmt.string(from: $0) })
    }

    static func hmBinding(_ s: Binding<String>) -> Binding<Date> {
        Binding(get: { hm(s.wrappedValue) }, set: { s.wrappedValue = hmFmt.string(from: $0) })
    }

    /// '2026-01' と -1 → '2025-12'
    static func shiftMonth(_ month: String, _ delta: Int) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        let idx = parts[0] * 12 + (parts[1] - 1) + delta
        let y = idx / 12
        let m = idx % 12 + 1
        return "\(y)-" + (m < 10 ? "0\(m)" : "\(m)")
    }

    /// '2026-03' → '2026年3月'
    static func monthLabel(_ month: String) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        return "\(parts[0])年\(parts[1])月"
    }

    /// 数（0.5 → "0.5"、10 → "10"）
    static func num(_ v: Double) -> String {
        if v == v.rounded() && abs(v) < 1e9 { return String(Int(v)) }
        return String(v)
    }
}

// MARK: - 共通の部品（勤怠・有給で使う）

/// 画面の枠：上のバー（ネイビー・ホーム）・読み込み中／エラー・下のお知らせ
struct NATPage<Content: View>: View {
    let title: String
    var userName: String = ""
    let onHome: () -> Void
    let loaded: Bool
    let error: String?
    @Binding var toast: NATToast?
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: title, subtitle: "", userName: userName, onHome: onHome)
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
            Text(t.text).font(.system(size: 16, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 20).padding(.vertical, 13)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(toastColor(t.tone)))
                .padding(.horizontal, 40).padding(.bottom, 24)
                .onTapGesture { toast = nil }
                .task {
                    try? await Task.sleep(nanoseconds: 3_200_000_000)
                    if toast == t { toast = nil }
                }
        }
    }

    private func toastColor(_ tone: NATToast.Tone) -> Color {
        switch tone {
        case .ok: return NT.ink.opacity(0.92)
        case .warn: return NT.warn.opacity(0.95)
        case .error: return NT.danger.opacity(0.95)
        }
    }
}

struct NATTabItem: Hashable {
    let key: String
    let label: String
}

/// タブ（打刻・勤怠一覧・承認／自分の有給・管理）
struct NATTabBar: View {
    let items: [NATTabItem]
    let selected: String
    let pick: (String) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(items, id: \.key) { t in
                Button { pick(t.key) } label: {
                    Text(t.label)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(selected == t.key ? Color.white : NT.ink2)
                        .padding(.horizontal, 22).frame(height: 44)
                        .background(Capsule().fill(selected == t.key ? NT.purple : Color.white))
                        .overlay(Capsule().stroke(selected == t.key ? Color.clear : NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
            Spacer(minLength: 0)
        }
    }
}

/// 小さい札（区分・状態）
struct NATBadge: View {
    let text: String
    var icon: String? = nil
    var color: Color = NT.ink3

    var body: some View {
        HStack(spacing: 3) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .bold)) }
            Text(text)
        }
        .font(.system(size: 12, weight: .bold))
        .foregroundColor(color)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Capsule().fill(color.opacity(0.12)))
    }
}

/// 行の中の小さいボタン
struct NATSmallButton: View {
    let text: String
    var icon: String? = nil
    var tint: Color = NT.ink
    var filled = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon { Image(systemName: icon).font(.system(size: 12, weight: .bold)) }
                Text(text)
            }
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(filled ? Color.white : tint)
            .padding(.horizontal, 12).frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(filled ? tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(filled ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
    }
}

/// 色つきの注意（シフト・他店舗・休憩中など）
struct NATNotice: View {
    let text: String
    var icon: String = "info.circle"
    var color: Color = NT.purple
    var background: Color = NFColor.irisSoft

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundColor(color)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(background))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(color.opacity(0.3), lineWidth: 1))
    }
}

/// 中身が無いとき
struct NATEmpty: View {
    let title: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
            if let message { Text(message).font(.system(size: 13)).foregroundColor(NT.ink3).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 16)
    }
}

/// 時刻の入力（空にもできる。Web の <input type="time">）
struct NATTimeField: View {
    let label: String
    @Binding var value: String
    var fallback = "09:00"

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
            Spacer()
            if value.isEmpty {
                Button("時刻を入れる") { value = fallback }
            } else {
                DatePicker("", selection: NATTime.hmBinding($value), displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .environment(\.timeZone, NATTime.tz)
                Button { value = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("時刻を消す")
            }
        }
    }
}

// MARK: - 入口（Web の道 → 画面）

struct NativeAttendanceView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void

    var body: some View {
        NATScreen(tab: route.query("tab"), month: route.query("month"), staffId: route.query("staffId"), onHome: onHome)
            .id(route)
    }
}

@MainActor
final class NATModel: ObservableObject {
    @Published var payload: NATPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    @Published var busy = false
    /// 押したタブ（読み終わるまで payload.tab と違う）
    @Published var tab: String
    @Published var month: String
    @Published var staffId: String

    init(tab: String?, month: String?, staffId: String?) {
        self.tab = tab ?? "punch"
        self.month = month ?? ""
        self.staffId = staffId ?? ""
    }

    var loading: Bool { payload != nil && payload?.tab != tab }

    func load() async {
        var q: [String: String] = ["tab": tab]
        if tab == "list" {
            if !month.isEmpty { q["month"] = month }
            if !staffId.isEmpty { q["staffId"] = staffId }
        }
        do {
            let p = try await NATApi.get(NATPayload.self, part: "attendance", q)
            payload = p
            // サーバーが決めたタブ・月（権限の無いタブ・正しくない月は直して返ってくる）
            tab = p.tab
            if let m = p.month { month = m }
            if let s = p.staffId { staffId = s }
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
    }

    func open(tab t: String) async {
        tab = t
        await load()
    }

    /// ボタンの操作：返事をお知らせに出して読み直す
    func act(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        let r = await NATApi.post(body)
        toast = NATToast.from(r)
        if r.ok { await load() }
    }

    /// 入力画面の操作：できたら nil（お知らせ・読み直し）、だめならことば（入力画面に出す）
    func submit(_ body: [String: Any]) async -> String? {
        busy = true
        defer { busy = false }
        let r = await NATApi.post(body)
        if r.ok {
            toast = NATToast.from(r)
            await load()
            return nil
        }
        return r.error ?? r.message ?? "できませんでした"
    }
}

/// 勤怠一覧から開く入力画面
enum NATSheet: Identifiable {
    case correction(NATRow)
    case entryType(NATRow)
    case manual

    var id: String {
        switch self {
        case .correction(let r): return "correction-" + r.id
        case .entryType(let r): return "type-" + r.id
        case .manual: return "manual"
        }
    }
}

struct NATScreen: View {
    let onHome: () -> Void
    @StateObject private var model: NATModel
    @State private var sheet: NATSheet?
    @State private var approving: NATRequest?
    @State private var prompt: NPReasonPrompt?

    init(tab: String?, month: String?, staffId: String?, onHome: @escaping () -> Void) {
        self.onHome = onHome
        _model = StateObject(wrappedValue: NATModel(tab: tab, month: month, staffId: staffId))
    }

    var body: some View {
        NATPage(title: "勤怠", userName: model.payload?.displayName ?? "", onHome: onHome, loaded: model.payload != nil,
                error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload { content(p) }
        }
        .task { await model.load() }
        .sheet(item: $sheet) { s in sheetView(s) }
        .sheet(item: $prompt) { pr in NPReasonSheet(prompt: pr) { prompt = nil }.presentationDetents([.medium]) }
        .alert("修正申請を承認", isPresented: Binding(get: { approving != nil }, set: { if !$0 { approving = nil } }), presenting: approving) { r in
            Button("キャンセル", role: .cancel) {}
            Button("承認する") { Task { await model.act(["type": "attendanceApprove", "requestId": r.id]) } }
        } message: { _ in
            Text("この内容で勤怠記録を更新します。よろしいですか。")
        }
    }

    private func tabs(_ p: NATPayload) -> [NATTabItem] {
        var items = [NATTabItem(key: "punch", label: "打刻"), NATTabItem(key: "list", label: "勤怠一覧")]
        if p.isApprover { items.append(NATTabItem(key: "requests", label: "承認")) }
        return items
    }

    @ViewBuilder private func content(_ p: NATPayload) -> some View {
        Text("\(p.store.name)の打刻・勤怠管理").font(.system(size: 14, weight: .medium)).foregroundColor(NT.ink3)
        NATTabBar(items: tabs(p), selected: model.tab) { t in
            Task { await model.open(tab: t) }
        }
        if model.loading {
            HStack { Spacer(); ProgressView("読み込み中…").tint(NT.purple); Spacer() }.padding(.vertical, 40)
        } else {
            switch p.tab {
            case "punch":
                if let punch = p.punch {
                    NATPunchSection(p: p, punch: punch, model: model)
                }
            case "list":
                NATListSection(p: p, model: model, open: { sheet = $0 })
            default:
                requestsSection(p)
            }
        }
    }

    // MARK: 承認（Web の RequestsTab）

    @ViewBuilder private func requestsSection(_ p: NATPayload) -> some View {
        let requests = p.requests ?? []
        if requests.isEmpty {
            NSPCard(title: "承認待ちの修正申請") {
                NATEmpty(title: "承認待ちの申請はありません")
            }
        } else {
            if !p.canReview {
                Text("この申請の承認・却下は店長以上のロールのみ行えます。閲覧のみ可能です。")
                    .font(.system(size: 13)).foregroundColor(NT.ink3)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
            ForEach(requests) { r in
                requestCard(r, canReview: p.canReview)
            }
        }
    }

    private func requestCard(_ r: NATRequest, canReview: Bool) -> some View {
        NSPCard(title: r.title) {
            VStack(alignment: .leading, spacing: 12) {
                NATBadge(text: "承認待ち", color: NT.warn)
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("現在値").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                        Text(r.current).font(.system(size: 15)).foregroundColor(NT.ink)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("希望値").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                        Text(r.desired).font(.system(size: 15, weight: .bold)).foregroundColor(NT.purpleDeep)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("理由").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                    Text(r.reason.isEmpty ? "—" : r.reason).font(.system(size: 15)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                }
                if canReview {
                    HStack(spacing: 10) {
                        Spacer()
                        NATSmallButton(text: "承認", icon: "checkmark", tint: NT.ok, filled: true, disabled: model.busy) { approving = r }
                        NATSmallButton(text: "却下", icon: "xmark", tint: NT.danger, filled: true, disabled: model.busy) {
                            prompt = NPReasonPrompt(title: "修正申請を却下", message: "この申請を却下します。理由を入力してください。", confirm: "却下する") { reason in
                                await model.act(["type": "attendanceReject", "requestId": r.id, "reason": reason])
                            }
                        }
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: 入力画面

    @ViewBuilder private func sheetView(_ s: NATSheet) -> some View {
        let p = model.payload
        switch s {
        case .correction(let row):
            NATCorrectionSheet(row: row, submit: { await model.submit($0) }, onClose: { sheet = nil })
        case .entryType(let row):
            NATEntryTypeSheet(row: row, choices: p?.entryTypes ?? [], submit: { await model.submit($0) }, onClose: { sheet = nil })
        case .manual:
            NATManualSheet(staff: p?.staffOptions ?? [], today: p?.today ?? NATTime.dayFmt.string(from: Date()),
                           submit: { await model.submit($0) }, onClose: { sheet = nil })
        }
    }
}

// MARK: - 打刻（Web の PunchTab・ClockSection・PunchPad・PinPad）

struct NATPunchSection: View {
    let p: NATPayload
    let punch: NATPunch
    @ObservedObject var model: NATModel
    @State private var shared: Bool
    @State private var pinEvent = "clock_in"
    @State private var pin = ""

    private static let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"]

    init(p: NATPayload, punch: NATPunch, model: NATModel) {
        self.p = p
        self.punch = punch
        self.model = model
        // レジ端末のアカウントは人ではないので、共用端末（PIN）で開く
        _shared = State(initialValue: p.isRegisterDevice == true)
    }

    var body: some View {
        VStack(spacing: 16) {
            // 本日のシフト・他店舗の出勤は、ログインしている人のこと。共用端末（PIN）では名前と同じく出さない
            if let s = punch.todayShift, !shared {
                NATNotice(text: s, icon: "calendar")
            }
            if let e = punch.elsewhere, !shared {
                NATNotice(text: e, icon: "exclamationmark.triangle.fill", color: NT.danger, background: NT.dangerBg)
            }
            clockCard
            modeToggle
            if shared { pinPad } else { personalPad }
        }
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .onDisappear { pin = "" }
    }

    private var clockCard: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            VStack(spacing: 6) {
                Text(NATTime.clockDate.string(from: context.date))
                    .font(.system(size: 17, weight: .medium)).foregroundColor(Color.white.opacity(0.72))
                Text(NATTime.clockTime.string(from: context.date))
                    .font(.system(size: 76, weight: .bold)).monospacedDigit().foregroundColor(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
                if !shared {
                    HStack(spacing: 8) {
                        Text("\(p.displayName) さん").font(.system(size: 17, weight: .semibold)).foregroundColor(Color.white.opacity(0.85))
                        if punch.onBreak {
                            Text("休憩中").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 10).padding(.vertical, 3)
                                .background(Capsule().fill(NT.warn))
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28).padding(.horizontal, 20)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(NT.topBar))
        }
    }

    private var modeToggle: some View {
        Button {
            shared.toggle()
            pin = ""
        } label: {
            HStack(spacing: 8) {
                Image(systemName: shared ? "person.2" : "key")
                Text(shared ? "個人打刻に切り替える" : "共用端末モード（PINで打刻）")
            }
            .font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            .padding(.horizontal, 18).frame(height: 40)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 個人打刻

    private var personalPad: some View {
        VStack(spacing: 12) {
            if punch.onBreak {
                NATNotice(text: "休憩中です。退勤すると休憩を自動終了します。", icon: "cup.and.saucer", color: NT.warn, background: NFColor.saffronSoft)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                ForEach(p.punchEvents, id: \.value) { e in
                    punchButton(e)
                }
            }
        }
    }

    private func enabled(_ type: String) -> Bool {
        switch type {
        case "clock_in": return punch.canClockIn
        case "clock_out": return punch.canClockOut
        case "break_start": return punch.canBreakStart
        case "break_end": return punch.canBreakEnd
        default: return false
        }
    }

    private static func icon(_ type: String) -> String {
        switch type {
        case "clock_in": return "arrow.right.square"
        case "clock_out": return "arrow.left.square"
        case "break_start": return "cup.and.saucer"
        default: return "play.fill"
        }
    }

    private func punchButton(_ e: NATChoice) -> some View {
        let on = enabled(e.value) && p.canPunch
        let filled = e.value == "clock_in" || e.value == "clock_out"
        let tint: Color = e.value == "clock_out" ? NT.danger : NT.purple
        return Button {
            Task { await model.act(["type": "attendancePunch", "eventType": e.value]) }
        } label: {
            VStack(spacing: 10) {
                Image(systemName: Self.icon(e.value)).font(.system(size: 30, weight: .bold))
                Text(e.label).font(.system(size: 24, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundColor(filled ? Color.white : NT.ink)
            .frame(maxWidth: .infinity, minHeight: 120)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(filled ? tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(filled ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!on || model.busy)
        .opacity(on ? 1 : 0.4)
    }

    // MARK: 共用端末（PIN）

    private var pinLabel: String { p.punchEvents.first { $0.value == pinEvent }?.label ?? "" }

    private var pinPad: some View {
        VStack(spacing: 16) {
            HStack(spacing: 8) {
                ForEach(p.punchEvents, id: \.value) { e in
                    Button { pinEvent = e.value } label: {
                        Text(e.label)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(pinEvent == e.value ? Color.white : NT.ink)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(pinEvent == e.value ? NT.purple : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(pinEvent == e.value ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            HStack(spacing: 14) {
                ForEach(0..<6, id: \.self) { i in
                    Circle()
                        .fill(i < pin.count ? NT.topBar : Color.white)
                        .overlay(Circle().stroke(NT.ink3, lineWidth: 1))
                        .frame(width: 16, height: 16)
                }
            }
            .padding(.vertical, 4)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                ForEach(Self.keys, id: \.self) { k in
                    keyButton(k)
                }
            }
            Button(action: submitPin) {
                Text(model.busy ? "確認中…" : "\(pinLabel)を記録する")
                    .font(.system(size: 21, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.busy || pin.count < 4 || !p.canPunch)
            .opacity(pin.count < 4 || !p.canPunch ? 0.45 : 1)
        }
        .frame(maxWidth: 520)
    }

    @ViewBuilder private func keyButton(_ k: String) -> some View {
        if k.isEmpty {
            Color.clear.frame(height: 76)
        } else {
            Button { press(k) } label: {
                Group {
                    if k == "del" {
                        Image(systemName: "delete.left").font(.system(size: 26, weight: .semibold))
                    } else {
                        Text(k).font(.system(size: 28, weight: .semibold))
                    }
                }
                .foregroundColor(NT.ink)
                .frame(maxWidth: .infinity, minHeight: 76)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.busy)
            .accessibilityLabel(k == "del" ? "1文字消す" : k)
        }
    }

    private func press(_ k: String) {
        if model.busy { return }
        if k == "del" {
            if !pin.isEmpty { pin.removeLast() }
            return
        }
        if pin.count < 6 { pin += k }
    }

    private func submitPin() {
        guard pin.count >= 4 else {
            model.toast = NATToast(text: "PINは4桁以上で入力してください", tone: .error)
            return
        }
        // PIN は画面に残さない（送ったらすぐ消す）
        let entered = pin
        pin = ""
        let event = pinEvent
        Task { await model.act(["type": "attendancePunchPin", "pin": entered, "eventType": event]) }
    }
}

// MARK: - 勤怠一覧（Web の ListTab・AttendanceRow）

struct NATListSection: View {
    let p: NATPayload
    @ObservedObject var model: NATModel
    let open: (NATSheet) -> Void
    @State private var expanded: Set<String> = []

    private var rows: [NATRow] { p.rows ?? [] }
    private var staff: [NATOption] { p.staffOptions ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            filters
            if rows.isEmpty {
                NSPCard(title: "勤怠一覧") {
                    NATEmpty(title: "この期間の勤怠記録はありません", message: "打刻タブから出勤を記録してください")
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { row in
                        NATRowView(
                            row: row,
                            showStaff: p.showStaff == true,
                            isApprover: p.isApprover,
                            expanded: expanded.contains(row.id),
                            busy: model.busy,
                            toggle: { toggle(row.id) },
                            correct: { open(.correction(row)) },
                            changeType: { open(.entryType(row)) }
                        )
                        if row.id != rows.last?.id {
                            Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 18)
                        }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
        }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    private func go(month: String? = nil, staffId: String? = nil) {
        if let month { model.month = month }
        if let staffId { model.staffId = staffId }
        Task { await model.load() }
    }

    private var currentMonth: String { model.month.isEmpty ? (p.month ?? String(p.today.prefix(7))) : model.month }

    private var staffLabel: String {
        if model.staffId.isEmpty { return "スタッフ全員" }
        return staff.first { $0.id == model.staffId }?.name ?? "スタッフ全員"
    }

    private var filters: some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                Button { go(month: NATTime.shiftMonth(currentMonth, -1)) } label: {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold)).frame(width: 40, height: 44)
                }
                .accessibilityLabel("前の月")
                Text(NATTime.monthLabel(currentMonth)).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    .frame(minWidth: 110)
                Button { go(month: NATTime.shiftMonth(currentMonth, 1)) } label: {
                    Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).frame(width: 40, height: 44)
                }
                .accessibilityLabel("次の月")
            }
            .foregroundColor(NT.ink)
            .padding(.horizontal, 4)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
            .disabled(model.busy)

            if currentMonth != String(p.today.prefix(7)) {
                NATSmallButton(text: "今月") { go(month: String(p.today.prefix(7))) }
            }

            if p.isApprover && !staff.isEmpty {
                Menu {
                    Button("スタッフ全員") { go(staffId: "") }
                    ForEach(staff) { s in
                        Button(s.name) { go(staffId: s.id) }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "person.crop.circle")
                        Text(staffLabel).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                    .padding(.horizontal, 14).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
            Spacer(minLength: 0)
            if p.isApprover {
                NSPButton(text: "勤怠を手動追加", icon: "calendar.badge.plus", disabled: model.busy) { open(.manual) }
            }
        }
    }
}

/// 勤怠一覧の 1 行（開くと打刻履歴）
struct NATRowView: View {
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
            HStack(alignment: .center, spacing: 10) {
                Button(action: toggle) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(expanded ? "打刻履歴を閉じる" : "打刻履歴を開く")
                Text(row.workDateLabel).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                if showStaff {
                    Text(row.staffName ?? "—").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink2).lineLimit(1)
                }
                badges
                Spacer(minLength: 8)
                actions
            }
            HStack(spacing: 18) {
                cell("出勤", row.clockInLabel)
                cell("退勤", row.clockOutLabel, danger: row.missing)
                cell("休憩", "\(Int(row.breakMinutes.rounded()))分")
                cell("実働", row.workedLabel)
                if row.locked {
                    Text("確定済み（修正申請のみ可）").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 40)
            if expanded { history.padding(.leading, 40) }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private var badges: some View {
        WrapLayout(spacing: 4) {
            NATBadge(text: row.entryTypeLabel, color: Self.typeColor(row.entryType))
            if row.missing { NATBadge(text: "打刻漏れ", icon: "exclamationmark.triangle.fill", color: NT.danger) }
            if row.locked { NATBadge(text: "ロック", icon: "lock.fill", color: NT.topBar) }
            NATBadge(text: row.statusLabel, color: Self.statusColor(row.status))
        }
    }

    private var actions: some View {
        HStack(spacing: 6) {
            NATSmallButton(text: "修正申請", icon: "pencil", disabled: busy, action: correct)
            if isApprover && !row.locked {
                NATSmallButton(text: "区分を変更", icon: "tag", disabled: busy, action: changeType)
            }
        }
    }

    private func cell(_ label: String, _ value: String, danger: Bool = false) -> some View {
        HStack(spacing: 5) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 16, weight: .bold)).monospacedDigit().foregroundColor(danger ? NT.danger : NT.ink)
        }
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("打刻履歴（打刻イベントの生ログ）").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            if row.events.isEmpty {
                Text("打刻イベントの記録がありません（手動登録など）").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                VStack(spacing: 0) {
                    historyLine("種別", "時刻", "端末", "PIN打刻", header: true)
                    ForEach(row.events) { e in
                        Rectangle().fill(NT.line).frame(height: 1)
                        historyLine(e.label, e.timeLabel, e.sourceLabel, e.viaPin ? "あり" : "—")
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            }
        }
    }

    private func historyLine(_ a: String, _ b: String, _ c: String, _ d: String, header: Bool = false) -> some View {
        HStack(spacing: 10) {
            Text(a).frame(width: 90, alignment: .leading)
            Text(b).monospacedDigit().frame(width: 170, alignment: .leading)
            Text(c).frame(width: 140, alignment: .leading)
            Text(d).frame(width: 70, alignment: .leading)
            Spacer(minLength: 0)
        }
        .font(.system(size: header ? 11.5 : 13, weight: header ? Font.Weight.semibold : Font.Weight.regular))
        .foregroundColor(header ? NT.ink3 : NT.ink)
        .lineLimit(1)
        .padding(.vertical, 6)
    }

    /// 区分の色（Web の ENTRY_TYPE_TONE と同じ系統）
    static func typeColor(_ t: String) -> Color {
        switch t {
        case "late", "early_leave": return NT.warn
        case "absent": return NT.danger
        case "paid_leave": return NT.purple
        case "holiday_work": return NT.ok
        default: return NT.ink3
        }
    }

    static func statusColor(_ s: String) -> Color {
        switch s {
        case "approved": return NT.ok
        case "closed": return NT.purple
        default: return NT.ink3
        }
    }
}

// MARK: - 修正申請（Web の CorrectionDialog）

struct NATCorrectionSheet: View {
    let row: NATRow
    let submit: ([String: Any]) async -> String?
    let onClose: () -> Void
    @State private var clockIn: String
    @State private var clockOut: String
    @State private var breakText: String
    @State private var reason = ""
    @State private var error: String?
    @State private var saving = false

    init(row: NATRow, submit: @escaping ([String: Any]) async -> String?, onClose: @escaping () -> Void) {
        self.row = row
        self.submit = submit
        self.onClose = onClose
        _clockIn = State(initialValue: row.defaultClockIn)
        _clockOut = State(initialValue: row.defaultClockOut)
        _breakText = State(initialValue: String(Int(row.breakMinutes.rounded())))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NATTimeField(label: "希望出勤時刻", value: $clockIn, fallback: "09:00")
                    NATTimeField(label: "希望退勤時刻", value: $clockOut, fallback: "18:00")
                    HStack {
                        Text("休憩時間")
                        Spacer()
                        TextField("0", text: $breakText).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 120)
                        Text("分").foregroundColor(NT.ink3)
                    }
                }
                Section("理由（必須）") {
                    TextField("例: 打刻を忘れてしまいました", text: $reason, axis: .vertical).lineLimit(3...6)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("\(row.workDate) の修正申請")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "送信中…" : "申請する") { send() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func send() {
        if clockIn.isEmpty || clockOut.isEmpty {
            error = "出勤時刻・退勤時刻を入力してください"
            return
        }
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "理由を入力してください"
            return
        }
        error = nil
        saving = true
        let minutes = max(0, Int(breakText.filter { "0123456789".contains($0) }) ?? 0)
        let body: [String: Any] = [
            "type": "attendanceCorrection",
            "profileId": row.profileId,
            "timeEntryId": row.id,
            "workDate": row.workDate,
            "clockIn": clockIn,
            "clockOut": clockOut,
            "breakMinutes": minutes,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        Task {
            let e = await submit(body)
            saving = false
            if let e { error = e } else { onClose() }
        }
    }
}

// MARK: - 区分を変更（Web の EntryTypeDialog）

struct NATEntryTypeSheet: View {
    let row: NATRow
    let choices: [NATChoice]
    let submit: ([String: Any]) async -> String?
    let onClose: () -> Void
    @State private var entryType: String
    @State private var reason = ""
    @State private var error: String?
    @State private var saving = false

    init(row: NATRow, choices: [NATChoice], submit: @escaping ([String: Any]) async -> String?, onClose: @escaping () -> Void) {
        self.row = row
        self.choices = choices
        self.submit = submit
        self.onClose = onClose
        _entryType = State(initialValue: row.entryType)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("勤怠区分", selection: $entryType) {
                        ForEach(choices, id: \.value) { c in Text(c.label).tag(c.value) }
                    }
                }
                Section("変更理由（必須・操作履歴に記録されます）") {
                    TextField("例: 事前申請の有給を確認したため", text: $reason, axis: .vertical).lineLimit(3...6)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("\(row.workDate) の区分変更")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "保存中…" : "変更する") { send() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func send() {
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "理由を入力してください"
            return
        }
        error = nil
        saving = true
        let body: [String: Any] = [
            "type": "attendanceEntryType",
            "timeEntryId": row.id,
            "entryType": entryType,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        Task {
            let e = await submit(body)
            saving = false
            if let e { error = e } else { onClose() }
        }
    }
}

// MARK: - 勤怠を手動追加（有給・欠勤。Web の ManualEntryDialog）

struct NATManualSheet: View {
    let staff: [NATOption]
    let submit: ([String: Any]) async -> String?
    let onClose: () -> Void
    @State private var profileId = ""
    @State private var workDate: String
    @State private var entryType = "paid_leave"
    @State private var leaveUnit = "full"
    @State private var reason = ""
    @State private var error: String?
    @State private var saving = false

    init(staff: [NATOption], today: String, submit: @escaping ([String: Any]) async -> String?, onClose: @escaping () -> Void) {
        self.staff = staff
        self.submit = submit
        self.onClose = onClose
        _workDate = State(initialValue: today)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("対象スタッフ", selection: $profileId) {
                        Text("選択してください").tag("")
                        ForEach(staff) { s in Text(s.name).tag(s.id) }
                    }
                    DatePicker("日付", selection: NATTime.dayBinding($workDate), displayedComponents: .date)
                        .environment(\.timeZone, NATTime.tz)
                    Picker("区分", selection: $entryType) {
                        Text("有給").tag("paid_leave")
                        Text("欠勤").tag("absent")
                    }
                    .pickerStyle(.segmented)
                }
                if entryType == "paid_leave" {
                    Section {
                        Picker("取得区分", selection: $leaveUnit) {
                            Text("全休（1.0日）").tag("full")
                            Text("半休（0.5日）").tag("half")
                        }
                        .pickerStyle(.segmented)
                    } footer: {
                        Text("時間単位の有給（時間休）は今後対応予定です")
                    }
                }
                Section("理由（必須）") {
                    TextField("例: 事前に申請のあった有給休暇", text: $reason, axis: .vertical).lineLimit(3...6)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("勤怠を手動追加（有給・欠勤）")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "追加中…" : "追加する") { send() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func send() {
        if profileId.isEmpty {
            error = "対象スタッフを選択してください"
            return
        }
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "理由を入力してください"
            return
        }
        error = nil
        saving = true
        var body: [String: Any] = [
            "type": "attendanceManualEntry",
            "profileId": profileId,
            "workDate": workDate,
            "entryType": entryType,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        if entryType == "paid_leave" {
            let fraction: Double = leaveUnit == "half" ? 0.5 : 1
            body["leaveFraction"] = fraction
        }
        Task {
            let e = await submit(body)
            saving = false
            if let e { error = e } else { onClose() }
        }
    }
}
