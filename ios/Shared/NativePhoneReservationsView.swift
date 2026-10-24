import SwiftUI

// iPhone のネイティブのハンディ：予約（RESERVATION）の画面（2026-10-25 Ronnie「iPhone も native に。デザインは iPad のネイティブ」）。
// 中身・操作は Web のハンディの予約（/handy/reservations・/handy/reservations/new）と同じ：
//   上のタブ：予約一覧 ｜ 受付管理 ｜ メッセージ
//   予約一覧：日付（‹ 前の日・日付を押すとカレンダー・次の日 ›・今日）・件数・キャンセルを除く・予約のカード
//             押すと詳細：来店・予約キャンセル（お客様／店舗＝担当を選ぶ／無断）・テーブル変更・電話する・HANDYで注文（卓の画面）
//   受付管理：仮予約・要連絡・新しいネット予約・変更／キャンセル・グルメサイト要確認（確定する・連絡済み・確認済み・対応済み）
//   メッセージ：新しい予約・変更・キャンセルのお知らせ（14 日分。読んだところは端末ごと）
//   ＋予約登録：2 ステップ（日時・人数・予約可能なテーブル → お名前・電話番号・コース・キーワード・確保時間・ステータス・ご要望・経路・担当者）
// 色は iPad のネイティブと同じ（上のバー＝ネイビー NT.topBar、主の色＝青 NT.purple、地＝うすい灰色 NT.page、白い角丸のカード）。
//   GET  /api/app/v1/pos?part=handyReservations&date=        … 一覧・受付管理・メッセージ
//   GET  /api/app/v1/pos?part=handyReservationEntry&date=&exclude= … 卓・その日の予約（予約可能なテーブル）・経路・コース
//   GET  /api/app/v1/pos?part=handyReservationMonth&month=   … 日付選択のカレンダー
//   POST handyRsvArrive / handyRsvCancel / handyRsvTables / handyRsvInbox / handyRsvCreate
// サーバー：lib/native-modules/handy-reservations.ts（Web と同じ Server Action を呼ぶ）

// MARK: - データ

struct NPHRRow: Codable, Identifiable, Hashable {
    let id: String
    let time: String
    let endTime: String?
    let stayMinutes: Int
    let stayLabel: String
    let name: String
    let phone: String?
    let partySize: Int
    let tableLabel: String
    let tableIds: [String]
    let sourceLabel: String
    let tags: [String]
    let courseName: String?
    let status: String
    let statusLabel: String
    let upcoming: Bool
    /// 来店・キャンセル・テーブル変更ができる（来店前）
    let open: Bool
    let request: String?
    let memo: String?
    /// 会計前の伝票がある卓（HANDYで注文）
    let tableId: String?
    let code: String?
    let nameKana: String?
    let adults: Int?
    let children: Int?
    let email: String?
    let allergy: String?
    let seatType: String?
    let purpose: String?
    let clerkName: String?
    let cancelReason: String?
    let receivedAt: String?
    let walkIn: Bool
    let billTotal: Double?
    let billOrderNos: [Int]
    let paidAt: String?

    var cancelled: Bool { status == "cancelled" || status == "no_show" }
}

struct NPHRInbox: Codable {
    let tasks: [NLInboxTask]
    let notices: [NLInboxNotice]
    let canAcknowledge: Bool
}

struct NPHRPayload: Codable {
    let ok: Bool
    let store: NHDNamed
    let clerk: NHDNamed?
    let today: String
    let date: String
    let tab: String
    let title: String
    let dayLabel: String
    let emptyText: String
    let prevDate: String
    let nextDate: String
    let canWrite: Bool
    let canCancel: Bool
    let staff: [NHDNamed]
    let reservations: [NPHRRow]
    let inbox: NPHRInbox
}

struct NPHROption: Codable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

/// 予約登録の選ぶ欄（GET part=handyReservationEntry の中の、卓以外のところ）
struct NPHRFormInfo: Decodable {
    let today: String
    let sources: [NPHROption]
    let courses: [NPHROption]
    let clerk: NHDNamed?
}

struct NPHRMonthDay: Codable, Hashable {
    let date: String
    let day: Int
    let dow: Int
    let guests: Int
    let attention: Bool
    let closed: Bool
    let holiday: String?
}

struct NPHRMonthPayload: Codable {
    let today: String
    let month: String
    let prevMonth: String
    let nextMonth: String
    /// 日曜はじまり。月の外の日は null
    let weeks: [[NPHRMonthDay?]]
}

// MARK: - 日付（日本時間。Web の lib/handy-reservations.ts と同じ言い方）

enum NPHRDate {
    static let jst = TimeZone(identifier: "Asia/Tokyo") ?? .current
    private static let weekdays = ["日", "月", "火", "水", "木", "金", "土"]

    static let ymdFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = NPHRDate.jst
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = jst
        return c
    }

    static func parse(_ ymd: String) -> Date? { ymdFormatter.date(from: ymd) }
    static func string(_ d: Date) -> String { ymdFormatter.string(from: d) }
    static func today() -> String { string(Date()) }

    static func shift(_ ymd: String, _ days: Int) -> String {
        guard let d = parse(ymd), let n = calendar.date(byAdding: .day, value: days, to: d) else { return ymd }
        return string(n)
    }

    static func weekday(_ ymd: String) -> String {
        guard let d = parse(ymd) else { return "" }
        return weekdays[(calendar.component(.weekday, from: d) - 1) % 7]
    }

    /// 「10/16（木）」
    static func dayLabel(_ ymd: String) -> String {
        let p = ymd.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return ymd }
        return "\(p[1])/\(p[2])（\(weekday(ymd))）"
    }

    /// 今日の予約・明日の予約・昨日の予約・10/20（火）の予約
    static func title(_ ymd: String, today: String) -> String {
        if ymd == today { return "今日の予約" }
        if ymd == shift(today, 1) { return "明日の予約" }
        if ymd == shift(today, -1) { return "昨日の予約" }
        return "\(dayLabel(ymd))の予約"
    }

    static func iso(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// 「10/24 19:56」
    static func stamp(_ isoString: String) -> String {
        guard let d = iso(isoString) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = jst
        f.dateFormat = "M/d HH:mm"
        return f.string(from: d)
    }
}

// MARK: - 予約の画面のデータと動き

@MainActor
final class NativePhoneReservationsModel: ObservableObject {
    enum Tab: String, CaseIterable {
        case list, inbox, messages
        var label: String { self == .list ? "予約一覧" : self == .inbox ? "受付管理" : "メッセージ" }
    }

    /// 見ている日（nil＝今日）
    @Published var date: String?
    @Published var tab: Tab
    @Published var payload: NPHRPayload?
    @Published var error: String?
    @Published var busy: String?
    @Published var toast: String?
    @Published var hideCancelled = false
    /// メッセージ：最後に見た時刻（端末ごと。iPad の店舗台帳の箱と同じ置き場所）
    @Published var seen: Date?
    /// いま開いているメッセージで「新着」を付ける境目
    @Published var prevSeen: Date?
    /// 見本（シミュレーターの確認用）。通信しない
    var isSample = false
    private var refresher: Timer?

    init(date: String?, tab: Tab) {
        self.date = date
        self.tab = tab
        payload = NativeAPI.cached(NPHRPayload.self, NPHApi.url(part: "handyReservations", Self.query(date)))
    }

    private static func query(_ date: String?) -> [String: String] { date.map { ["date": $0] } ?? [:] }

    var today: String { payload?.today ?? NPHRDate.today() }
    /// 日付のバーに出す日（押した直後から新しい日を出す）
    var shownDate: String { date ?? today }
    /// いまの payload が見ている日のものか（違えば読み込み中）
    var isCurrent: Bool { payload?.date == shownDate }

    func start() {
        guard !isSample else { return }
        refresher?.invalidate()
        // ネット予約・ほかの端末の変更も入る。Web は更新ボタン、ネイティブは 30 秒ごとにも読み直す
        refresher = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { await refresh() }
    }

    func stop() {
        refresher?.invalidate()
        refresher = nil
    }

    func refresh() async {
        guard !isSample else { return }
        let asked = date
        do {
            let p = try await NPHApi.get(NPHRPayload.self, part: "handyReservations", Self.query(asked))
            // 読んでいる間に日を変えたら、古い返事は使わない
            guard asked == date else { return }
            payload = p
            if let s = UserDefaults.standard.object(forKey: seenKey(p.store.id)) as? Date { seen = s }
            if tab == .messages && prevSeen == nil { openMessages() }
            error = nil
        } catch {
            guard asked == date else { return }
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    /// ほかの日へ（今日は nil）
    func go(_ d: String) {
        let next: String? = d == today ? nil : d
        guard next != date else { Task { await refresh() }; return }
        date = next
        if let cached = NativeAPI.cached(NPHRPayload.self, NPHApi.url(part: "handyReservations", Self.query(next))) { payload = cached }
        Task { await refresh() }
    }

    func select(_ t: Tab) {
        tab = t
        if t == .messages { openMessages() } else { prevSeen = nil }
    }

    /// 操作。うまくいったら知らせを出して読み直す。うまくいかなければそのことば
    func perform(_ body: [String: Any], key: String) async -> String? {
        guard busy == nil else { return "ほかの操作の途中です" }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { return r.error ?? "変更できませんでした" }
        toast = (r.json?["message"] as? String) ?? "変更しました"
        await refresh()
        return nil
    }

    // MARK: メッセージの未読（Web の inbox-seen・iPad の NLInboxModel と同じ決まり）

    private func seenKey(_ storeId: String) -> String { "tenpo.inbox.seen.\(storeId)" }
    /// まだ一度も開いていない端末は「この 24 時間」を未読に
    private var seenLine: Date { seen ?? Date().addingTimeInterval(-24 * 3600) }

    var unreadNotices: Int {
        (payload?.inbox.notices ?? []).filter { (NPHRDate.iso($0.at) ?? .distantPast) > seenLine }.count
    }

    func openMessages() {
        prevSeen = seenLine
        let now = Date()
        seen = now
        if let id = payload?.store.id { UserDefaults.standard.set(now, forKey: seenKey(id)) }
    }

    func isNew(_ n: NLInboxNotice) -> Bool {
        guard let line = prevSeen else { return false }
        return (NPHRDate.iso(n.at) ?? .distantPast) > line
    }
}

enum NPHRApi {
    /// その日の卓・予約（予約可能なテーブル）と予約登録の選ぶ欄。exclude はテーブル変更のときのその予約
    static func entry(date: String, exclude: String? = nil) async throws -> (NRWEntry, NPHRFormInfo) {
        var q = ["date": date]
        if let exclude { q["exclude"] = exclude }
        guard let url = NPHApi.url(part: "handyReservationEntry", q) else { throw NativeAPIError(message: "通信できませんでした", useWeb: false) }
        let data = try await NativeAPI.shared.send(URLRequest(url: url))
        let decoder = JSONDecoder()
        return (try decoder.decode(NRWEntry.self, from: data), try decoder.decode(NPHRFormInfo.self, from: data))
    }
}

// MARK: - 色（状態のバッジ）

enum NPHRTone {
    /// 状態のバッジ（これから来るものは枠線、店にいる・終わったもの・キャンセルは塗り。Web の STATUS_TONE と同じ考え）
    static func badge(_ status: String) -> (fg: Color, bg: Color, border: Color) {
        switch status {
        case "pending": return (NT.ink2, Color.white, NT.ink3)
        case "confirmed", "waiting": return (NT.purpleDeep, Color.white, NT.purple)
        case "arrived": return (NT.warn, Color.white, NT.warn)
        case "seated": return (Color.white, NT.ok, NT.ok)
        case "billing": return (Color.white, NT.warn, NT.warn)
        case "completed", "cancelled": return (Color.white, NT.ink3, NT.ink3)
        case "no_show": return (Color.white, NT.danger, NT.danger)
        default: return (NT.ink2, Color.white, NT.ink3)
        }
    }
}

struct NPHRStatusBadge: View {
    let status: String
    let label: String
    var size: CGFloat = 11

    var body: some View {
        let t = NPHRTone.badge(status)
        Text(label).font(.system(size: size, weight: .heavy)).foregroundColor(t.fg).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(t.bg))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(t.border, lineWidth: 1.5))
    }
}

private func nphrYen(_ v: Double) -> String { NT.yen(Int(v.rounded())) }

/// キーワードの小さいチップ
struct NPHRTagChips: View {
    let tags: [String]
    var body: some View {
        WrapLayout(spacing: 4) {
            ForEach(tags, id: \.self) { t in
                Text(t).font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Capsule().fill(NT.lilac))
            }
        }
    }
}

// MARK: - 予約の画面（タブ・一覧・受付管理・メッセージ）

struct NativePhoneReservationsView: View {
    @ObservedObject var model: NativePhoneReservationsModel
    let onBack: () -> Void
    /// HANDYで注文（卓の画面を開く）
    let onOpenTable: (String) -> Void
    /// ＋予約登録
    let onAdd: () -> Void
    @State private var openRow: NPHRRow?
    @State private var calendarOpen = false

    private var title: String {
        switch model.tab {
        case .list: return NPHRDate.title(model.shownDate, today: model.today)
        case .inbox: return "予約受付管理"
        case .messages: return "メッセージ"
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NT.page.ignoresSafeArea()
            VStack(spacing: 0) {
                NPHTopBar(title: title, subtitle: model.payload?.store.name ?? "", backLabel: "テーブル", onBack: onBack) {
                    HStack(spacing: 0) {
                        Button { Task { await model.refresh() } } label: {
                            Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 38, height: 40)
                        }
                        .accessibilityLabel("更新")
                        if model.payload?.canWrite ?? false {
                            Button(action: onAdd) {
                                VStack(spacing: 1) {
                                    Image(systemName: "plus").font(.system(size: 17, weight: .heavy))
                                    Text("予約登録").font(.system(size: 9.5, weight: .heavy)).lineLimit(1)
                                }
                                .foregroundColor(.white).frame(width: 52, height: 44)
                            }
                            .buttonStyle(PressableStyle())
                            .accessibilityLabel("予約を登録")
                        }
                    }
                }
                tabBar
                if let e = model.error, model.payload != nil {
                    Text(e).font(.system(size: 12, weight: .bold)).foregroundColor(NT.danger)
                        .frame(maxWidth: .infinity).padding(.vertical, 6).background(NT.dangerBg)
                }
                content
            }
            NPHToast(text: $model.toast)
        }
        .environment(\.colorScheme, .light)
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .sheet(item: $openRow) { r in
            NPHRDetailSheet(model: model, row: r, onClose: { openRow = nil }, onOpenTable: { id in
                openRow = nil
                // シートが閉じてから卓の画面へ
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onOpenTable(id) }
            })
            .presentationDetents([.large])
            .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $calendarOpen) {
            NPHRCalendarSheet(selected: model.shownDate, today: model.today, onClose: { calendarOpen = false }) { d in
                calendarOpen = false
                model.go(d)
            }
            .presentationDetents([.large])
            .environment(\.colorScheme, .light)
        }
    }

    // MARK: 上のタブ（予約一覧 ｜ 受付管理 ｜ メッセージ）

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(NativePhoneReservationsModel.Tab.allCases, id: \.self) { t in
                let on = model.tab == t
                let count = badgeCount(t, on: on)
                Button { model.select(t) } label: {
                    VStack(spacing: 0) {
                        HStack(spacing: 5) {
                            Text(t.label).font(.system(size: 14, weight: .heavy)).foregroundColor(on ? NT.ink : NT.ink3).lineLimit(1)
                            if count > 0 {
                                Text(count > 99 ? "99+" : "\(count)").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                                    .padding(.horizontal, 5).frame(minWidth: 19, minHeight: 19)
                                    .background(Capsule().fill(t == .messages ? NT.purple : NT.danger))
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 43)
                        Rectangle().fill(on ? NT.purple : Color.clear).frame(height: 3)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    /// タブの数字：受付管理＝やること、メッセージ＝まだ読んでいないお知らせ（開いているときは出さない）
    private func badgeCount(_ t: NativePhoneReservationsModel.Tab, on: Bool) -> Int {
        switch t {
        case .list: return 0
        case .inbox: return model.payload?.inbox.tasks.count ?? 0
        case .messages: return on ? 0 : model.unreadNotices
        }
    }

    @ViewBuilder private var content: some View {
        if let p = model.payload {
            switch model.tab {
            case .list: listTab(p)
            case .inbox: NPHRInboxTasks(model: model, payload: p)
            case .messages: NPHRInboxNotices(model: model, payload: p)
            }
        } else if let e = model.error {
            VStack(spacing: 14) {
                Spacer()
                Image(systemName: "exclamationmark.circle").font(.system(size: 30, weight: .semibold)).foregroundColor(NT.ink3)
                Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center).padding(.horizontal, 28)
                Button { Task { await model.refresh() } } label: {
                    Text("もう一度読む").font(.system(size: 15, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 22).frame(height: 44)
                        .background(Capsule().fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack { Spacer(); ProgressView().tint(NT.purple); Spacer() }.frame(maxWidth: .infinity)
        }
    }

    // MARK: 予約一覧

    private func listTab(_ p: NPHRPayload) -> some View {
        ScrollView {
            VStack(spacing: 10) {
                dateBar
                if !model.isCurrent {
                    ProgressView().tint(NT.purple).padding(.top, 40)
                } else if p.reservations.isEmpty {
                    emptyText(p.emptyText)
                } else {
                    let shown = model.hideCancelled ? p.reservations.filter { !$0.cancelled } : p.reservations
                    HStack(spacing: 8) {
                        Text("\(shown.count)件").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                        Text("時間が早い順").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                        Spacer(minLength: 4)
                        Text("キャンセルを除く").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2)
                        Toggle("キャンセルを除く", isOn: $model.hideCancelled).labelsHidden().tint(NT.purple)
                    }
                    .padding(.horizontal, 4)
                    if shown.isEmpty {
                        emptyText("キャンセル以外の予約はありません。")
                    }
                    ForEach(shown) { r in
                        Button { openRow = r } label: { NPHRRowCard(row: r) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                    Text("予約を押すと、来店・キャンセル・テーブル変更ができます。").font(.system(size: 11)).foregroundColor(NT.ink3)
                        .multilineTextAlignment(.center).padding(.top, 4)
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    private func emptyText(_ t: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar").font(.system(size: 28, weight: .semibold)).foregroundColor(NT.ink3)
            Text(t).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 36)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    /// ‹ 前の日 ／ 10/16（木）（押すとカレンダー）／ 次の日 ›。今日でないときは左に「今日」
    private var dateBar: some View {
        let d = model.shownDate
        let isToday = d == model.today
        return HStack(spacing: 8) {
            navButton("chevron.left", label: "前の日") { model.go(NPHRDate.shift(d, -1)) }
            HStack(spacing: 0) {
                if !isToday {
                    Button { model.go(model.today) } label: {
                        Text("今日").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.purple)
                            .padding(.horizontal, 11).frame(height: 32)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                    }
                    .buttonStyle(PressableStyle())
                    .padding(.leading, 4)
                }
                Button { calendarOpen = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                        Text(NPHRDate.dayLabel(d)).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
                        if isToday { Text("今日").font(.system(size: 10.5, weight: .heavy)).foregroundColor(NT.purple) }
                    }
                    .frame(maxWidth: .infinity).frame(height: 42)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("日付を選ぶ")
            }
            .frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NT.lilac))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
            navButton("chevron.right", label: "次の日") { model.go(NPHRDate.shift(d, 1)) }
        }
    }

    private func navButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink2)
                .frame(width: 44, height: 42)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

/// 予約のカード（左：状態・お名前 ／ 右：時間〜人数・席・コース・経路・要望・メモ・会計。Web の一覧と同じ並び）
struct NPHRRowCard: View {
    let row: NPHRRow

    var body: some View {
        let r = row
        let dim = r.cancelled
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                NPHRStatusBadge(status: r.status, label: r.statusLabel)
                Text("\(r.name) 様").font(.system(size: 15, weight: .heavy)).foregroundColor(dim ? NT.ink2 : NT.ink)
                    .multilineTextAlignment(.leading).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                if r.walkIn {
                    Text("ウォークイン").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            .frame(width: 118, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("\(r.time)〜 \(r.partySize)名").font(.system(size: 15, weight: .heavy)).foregroundColor(dim ? NT.ink2 : NT.ink).monospacedDigit().lineLimit(1)
                    HStack(spacing: 3) {
                        Image(systemName: "rectangle.split.3x3").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
                        Text(r.tableLabel).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).lineLimit(1)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    line("fork.knife", r.courseName ?? "-")
                    line("tag", r.sourceLabel.isEmpty ? "-" : r.sourceLabel)
                    line("text.bubble", "要望：\(r.request ?? "-")")
                    line("note.text", "メモ：\(r.memo ?? "-")")
                    if let total = r.billTotal {
                        HStack(spacing: 4) {
                            Image(systemName: "doc.text").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3).frame(width: 13)
                            Text("会計 \(nphrYen(total))").font(.system(size: 11.5, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                            if let at = r.paidAt { Text(at).font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit() }
                        }
                    }
                }
                .padding(.leading, 7)
                .overlay(alignment: .leading) { Rectangle().fill(NT.line).frame(width: 2) }
                if !r.tags.isEmpty { NPHRTagChips(tags: r.tags).padding(.top, 2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(dim ? Color(hex: 0xEDEFF3) : Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
        .opacity(!r.upcoming && !dim ? 0.82 : 1)
    }

    private func line(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3).frame(width: 13)
            Text(text).font(.system(size: 11.5)).foregroundColor(NT.ink2).lineLimit(1)
        }
    }
}

// MARK: - 受付管理（Web の InboxTaskList と同じ）

struct NPHRInboxTasks: View {
    @ObservedObject var model: NativePhoneReservationsModel
    let payload: NPHRPayload

    private static let groups: [(kind: String, label: String, hint: String, icon: String)] = [
        ("pending", "仮予約", "確定するとお店の予約になります", "hourglass"),
        ("contact", "要連絡", "お客様に連絡したら「連絡済み」", "phone.arrow.up.right"),
        ("new", "新しいネット予約", "ネット・グルメサイトから入った予約。見たら「確認済み」", "calendar.badge.plus"),
        ("change", "変更・キャンセル", "お客様・グルメサイトからの変更とキャンセル", "calendar.badge.exclamationmark"),
        ("gourmet", "グルメサイト 要確認", "メールを読み取れませんでした。内容を見て台帳に入れてください", "envelope.badge"),
    ]

    /// 押すボタン（Web の primaryAction と同じ）
    private func action(_ t: NLInboxTask) -> (label: String, act: String, id: String)? {
        if t.kind == "pending", let id = t.reservationId { return ("確定する", "confirm", id) }
        if t.kind == "contact", let id = t.reservationId { return ("連絡済み", "contacted", id) }
        if let id = t.importId { return ("対応済み", "resolveImport", id) }
        if t.kind == "new" || t.kind == "change", let id = t.reservationId { return ("確認済み", "ack", id) }
        return nil
    }

    var body: some View {
        let tasks = payload.inbox.tasks
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if tasks.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle").font(.system(size: 32, weight: .semibold)).foregroundColor(NT.ok)
                        Text("やることはありません").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                        Text("仮予約・要連絡・新しいネット予約・変更・キャンセル・グルメサイトの要確認が入ると、ここに出ます。")
                            .font(.system(size: 12)).foregroundColor(NT.ink3).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 36).padding(.horizontal, 18)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                }
                ForEach(Self.groups, id: \.kind) { g in
                    let items = tasks.filter { $0.kind == g.kind }
                    if !items.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Image(systemName: g.icon).font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                                Text(g.label).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1).fixedSize()
                                Text("\(items.count)件").font(.system(size: 11, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                                    .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NT.lilac)).fixedSize()
                            }
                            Text(g.hint).font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(2)
                            VStack(spacing: 0) {
                                ForEach(items) { t in row(t) }
                            }
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
                        }
                    }
                }
                if !payload.inbox.canAcknowledge {
                    Text("「新しいネット予約」と「お客様のキャンセル」の確認は、データベースの更新（00100）のあとに出ます。")
                        .font(.system(size: 10.5)).foregroundColor(NT.ink3)
                }
            }
            .padding(12).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    private func row(_ t: NLInboxTask) -> some View {
        let a = action(t)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(t.title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                Text(t.detail).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1)
                HStack(spacing: 6) {
                    if let n = t.note, !n.isEmpty {
                        Text(n).font(.system(size: 10.5)).foregroundColor(NT.ink2).lineLimit(1)
                            .padding(.horizontal, 6).padding(.vertical, 1).background(RoundedRectangle(cornerRadius: 4).fill(NT.page))
                    }
                    Text("\(NPHRDate.stamp(t.at)) 受付").font(.system(size: 10.5)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 6) {
                if payload.canWrite, let a {
                    Button {
                        Task {
                            if let e = await model.perform(["type": "handyRsvInbox", "act": a.act, "id": a.id], key: t.key) { model.toast = e }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            if model.busy == t.key { ProgressView().tint(.white).scaleEffect(0.75) } else { Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)) }
                            Text(a.label).font(.system(size: 13, weight: .heavy)).lineLimit(1)
                        }
                        .foregroundColor(.white).padding(.horizontal, 12).frame(minWidth: 92).frame(height: 36)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.busy != nil)
                }
                if let d = t.date {
                    Button { model.select(.list); model.go(d) } label: {
                        Text("予約を見る").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                            .padding(.horizontal, 12).frame(minWidth: 92).frame(height: 34)
                            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

// MARK: - メッセージ（Web の InboxNoticeList と同じ）

struct NPHRInboxNotices: View {
    @ObservedObject var model: NativePhoneReservationsModel
    let payload: NPHRPayload

    private func look(_ kind: String) -> (icon: String, label: String, fg: Color, bg: Color) {
        switch kind {
        case "new": return ("calendar.badge.plus", "新規", Color(hex: 0x2F6B3F), Color(hex: 0xE8F3EC))
        case "change": return ("pencil.circle", "変更", Color(hex: 0x2B4FA8), Color(hex: 0xE8EEFB))
        case "cancel": return ("calendar.badge.minus", "キャンセル", Color(hex: 0xB42318), Color(hex: 0xFBEAEA))
        default: return ("door.left.hand.open", "退店", Color(hex: 0x6B625A), Color(hex: 0xEFEBE7))
        }
    }

    var body: some View {
        let notices = payload.inbox.notices
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: "bell").font(.system(size: 11, weight: .bold)).foregroundColor(NT.purple)
                    Text("お客様の新しい予約・変更・キャンセルのお知らせ（14日分）").font(.system(size: 11)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 4)
                if notices.isEmpty {
                    Text("お知らせはまだありません").font(.system(size: 13)).foregroundColor(NT.ink3)
                        .frame(maxWidth: .infinity).padding(.vertical, 36)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                } else {
                    VStack(spacing: 0) {
                        ForEach(notices) { n in row(n) }
                    }
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(12).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    private func row(_ n: NLInboxNotice) -> some View {
        let l = look(n.kind)
        let fresh = model.isNew(n)
        return Button {
            guard let d = n.date else { return }
            model.select(.list)
            model.go(d)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: l.icon).font(.system(size: 14, weight: .bold)).foregroundColor(l.fg)
                    .frame(width: 32, height: 32).background(Circle().fill(l.bg))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(n.title).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                        if fresh {
                            Text("新着").font(.system(size: 10, weight: .heavy)).foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NT.purple))
                        }
                    }
                    if !n.detail.isEmpty {
                        Text(n.detail).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1)
                    }
                    HStack(spacing: 6) {
                        Text(l.label).font(.system(size: 10.5, weight: .heavy)).foregroundColor(l.fg)
                            .padding(.horizontal, 6).padding(.vertical, 1).background(RoundedRectangle(cornerRadius: 4).fill(l.bg))
                        if let note = n.note, !note.isEmpty { Text(note).font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(1) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(NPHRDate.stamp(n.at)).font(.system(size: 10.5)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).fixedSize()
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(fresh ? Color(hex: 0xF3F7FF) : Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - 予約の詳細（Web の HandyReservationDetail と同じ中身・操作）

struct NPHRDetailSheet: View {
    @ObservedObject var model: NativePhoneReservationsModel
    let row: NPHRRow
    let onClose: () -> Void
    let onOpenTable: (String) -> Void

    enum Mode { case cancel, tables }
    @State private var mode: Mode?
    /// 店舗キャンセル：担当を選ぶところ
    @State private var storeCancel = false
    @State private var problem: String?
    @State private var entry: NRWEntry?
    @State private var entryError: String?
    @State private var picked: [String] = []
    @State private var now = Date()

    private var p: NPHRPayload? { model.payload }
    private var canAct: Bool { (p?.canWrite ?? false) && row.open }
    private var dateLabel: String { p.map { NPHRDate.dayLabel($0.date) } ?? "日時" }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        info
                        if canAct && mode == .tables {
                            tablesSection.id("tables")
                        }
                    }
                    .padding(16)
                }
                .onChange(of: mode) { m in
                    if m == .tables { withAnimation { proxy.scrollTo("tables", anchor: .top) } }
                }
            }
            if let problem {
                Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.vertical, 8).background(NT.dangerBg)
            }
            if canAct { actionPanel }
            bottomBar
        }
        .background(Color.white.ignoresSafeArea())
        .onAppear { picked = row.tableIds }
    }

    // MARK: 上：状態・予約番号・閉じる

    private var header: some View {
        HStack(spacing: 8) {
            NPHRStatusBadge(status: row.status, label: row.statusLabel, size: 12)
            if let code = row.code {
                Text("予約番号 \(code)").font(.system(size: 11.5)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1)
            }
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                    .frame(width: 36, height: 36).background(Circle().fill(NT.page))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("閉じる")
        }
        .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    // MARK: 中身（要望・メモは全部。電話・メールは押すとかけられる）

    private var guests: String {
        guard row.adults != nil || row.children != nil else { return "" }
        var parts: [String] = []
        if let a = row.adults, a > 0 { parts.append("大人 \(a)") }
        if let c = row.children, c > 0 { parts.append("子ども \(c)") }
        return parts.joined(separator: "・")
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(row.name) 様").font(.system(size: 21, weight: .heavy)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                if let k = row.nameKana { Text(k).font(.system(size: 12)).foregroundColor(NT.ink3) }
            }
            HStack(spacing: 8) {
                box(icon: "calendar", title: dateLabel, value: "\(row.time)〜\(row.endTime ?? "")", tint: NT.lilac, titleColor: NT.purpleDeep)
                box(icon: "person.2.fill", title: "人数", value: "\(row.partySize)名", sub: guests.isEmpty ? nil : "（\(guests)）", tint: NT.page, titleColor: NT.ink2)
            }
            VStack(spacing: 0) {
                infoRow("rectangle.split.3x3", "席") {
                    Text(row.tableLabel + (row.seatType.map { "（希望：\($0)）" } ?? ""))
                }
                infoRow("fork.knife", "コース") { Text(row.courseName ?? "-") }
                infoRow("clock", "確保時間") { Text(row.stayLabel) }
                infoRow("tag", "キーワード") {
                    if row.tags.isEmpty { Text("-") } else { NPHRTagChips(tags: row.tags) }
                }
                infoRow("tag", "経路") { Text(row.sourceLabel.isEmpty ? "-" : row.sourceLabel) }
                if let purpose = row.purpose { infoRow("list.bullet", "利用目的") { Text(purpose) } }
                infoRow("person.crop.circle", "担当") { Text(row.clerkName ?? "-") }
                infoRow("phone.fill", "電話") {
                    if let phone = row.phone, let url = Self.telURL(phone) {
                        Link(destination: url) { Text(phone).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purple).monospacedDigit() }
                    } else {
                        Text("-")
                    }
                }
                if let email = row.email, let url = URL(string: "mailto:\(email)") {
                    infoRow("envelope", "メール") {
                        Link(destination: url) { Text(email).font(.system(size: 13.5)).foregroundColor(NT.purple).multilineTextAlignment(.leading) }
                    }
                }
                if let allergy = row.allergy {
                    infoRow("exclamationmark.triangle.fill", "アレルギー", strong: true) { Text(allergy) }
                }
                infoRow("text.bubble", "要望") { Text(row.request ?? "-").fixedSize(horizontal: false, vertical: true) }
                infoRow("note.text", "メモ") { Text(row.memo ?? "-").fixedSize(horizontal: false, vertical: true) }
                if let total = row.billTotal {
                    infoRow("doc.text", "会計", strong: true) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(nphrYen(total)).monospacedDigit()
                            if !billSub.isEmpty { Text(billSub).font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit() }
                        }
                    }
                }
                if let reason = row.cancelReason {
                    infoRow("xmark.circle", "キャンセル理由") { Text(reason).fixedSize(horizontal: false, vertical: true) }
                }
            }
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
            if let at = row.receivedAt {
                Text("受付 \(at)").font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    /// 「21:35 退店　伝票 #101・#102」
    private var billSub: String {
        var parts: [String] = []
        if let at = row.paidAt { parts.append("\(at) 退店") }
        if !row.billOrderNos.isEmpty { parts.append("伝票 " + row.billOrderNos.map { "#\($0)" }.joined(separator: "・")) }
        return parts.joined(separator: "　")
    }

    static func telURL(_ phone: String) -> URL? {
        let digits = phone.filter { ("0"..."9").contains($0) || $0 == "+" }
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }

    private func box(icon: String, title: String, value: String, sub: String? = nil, tint: Color, titleColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold))
                Text(title).font(.system(size: 11, weight: .heavy)).lineLimit(1)
            }
            .foregroundColor(titleColor)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                if let sub { Text(sub).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.7) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tint))
    }

    private func infoRow<Content: View>(_ icon: String, _ label: String, strong: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return HStack(alignment: .top, spacing: 10) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold)).frame(width: 14)
                Text(label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            }
            .foregroundColor(NT.ink3)
            .frame(width: 92, alignment: .leading)
            .padding(.top, 1)
            inner
                .font(.system(size: 14, weight: strong ? .heavy : .regular))
                .foregroundColor(strong ? NT.danger : NT.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1) }
    }

    // MARK: テーブル変更（その時間に空いている卓・ピッタリ。この予約自身は数えない）

    private var tablesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let e = entry, let date = p?.date {
                if e.tables.isEmpty {
                    Text("テーブルが登録されていません").font(.system(size: 13)).foregroundColor(NT.ink3)
                } else {
                    NPHRTablePicker(entry: e, date: date, time: row.time, stay: row.stayMinutes, party: row.partySize,
                                   today: model.today, now: now, selected: picked, showLater: false) { ids, _ in picked = ids }
                }
            } else if let err = entryError {
                Text(err).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
            } else {
                HStack(spacing: 8) { ProgressView(); Text("空いているテーブルを確かめています…").font(.system(size: 13)).foregroundColor(NT.ink3) }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
    }

    private func loadEntry() async {
        guard let date = p?.date else { return }
        entryError = nil
        now = Date()
        do {
            entry = try await NPHRApi.entry(date: date, exclude: row.id).0
        } catch {
            entryError = (error as? NativeAPIError)?.message ?? "テーブルを読めませんでした"
        }
    }

    // MARK: 操作：来店・予約キャンセル・テーブル変更

    @ViewBuilder private var actionPanel: some View {
        VStack(spacing: 8) {
            switch mode {
            case .none:
                HStack(spacing: 8) {
                    panelButton("予約キャンセル", color: NT.danger) { problem = nil; storeCancel = false; mode = .cancel }
                    panelButton("テーブル変更", color: NT.ink) {
                        problem = nil
                        mode = .tables
                        if entry == nil { Task { await loadEntry() } }
                    }
                    Button { Task { await run(["type": "handyRsvArrive", "reservationId": row.id], key: "arrive") } } label: {
                        HStack(spacing: 5) {
                            if model.busy == "arrive" { ProgressView().tint(.white).scaleEffect(0.8) }
                            Text("来店").font(.system(size: 15, weight: .heavy))
                        }
                        .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.busy != nil)
                }
            case .some(.tables):
                HStack(spacing: 8) {
                    panelButton("やめる", color: NT.ink2) { mode = nil; picked = row.tableIds }
                    Button { Task { await run(["type": "handyRsvTables", "reservationId": row.id, "tableIds": picked], key: "tables") } } label: {
                        HStack(spacing: 5) {
                            if model.busy == "tables" { ProgressView().tint(.white).scaleEffect(0.8) }
                            Text("このテーブルにする").font(.system(size: 15, weight: .heavy)).lineLimit(1)
                        }
                        .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.busy != nil || entry == nil)
                    .layoutPriority(1)
                }
            case .some(.cancel):
                if storeCancel { storeStaffPicker } else { cancelKinds }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(NT.page)
        .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private func panelButton(_ title: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .heavy)).foregroundColor(color).lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy != nil)
    }

    /// キャンセルの種類（お客様キャンセル・店舗キャンセル・無断キャンセル。lib/reservation-cancel.ts と同じ）
    private var cancelKinds: some View {
        let kinds: [(key: String, label: String, hint: String)] = [
            ("guest", "お客様キャンセル", "連絡ありのキャンセル"),
            ("store", "店舗キャンセル", "担当を選んでください"),
            ("no_show", "無断キャンセル", "連絡なし・連絡が取れない"),
        ]
        return VStack(spacing: 8) {
            Text("キャンセルの種類を選んでください").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading)
            ForEach(kinds, id: \.key) { k in
                // 無断キャンセルは仮予約にはできない。お客様・店舗キャンセルはキャンセルの権限（Web と同じ）
                let allowed = k.key == "no_show" ? row.status != "pending" : (p?.canCancel ?? false)
                Button {
                    if k.key == "store" { storeCancel = true; return }
                    Task { await run(["type": "handyRsvCancel", "reservationId": row.id, "kind": k.key], key: "cancel") }
                } label: {
                    VStack(spacing: 1) {
                        Text(k.label).font(.system(size: 15, weight: .heavy))
                        Text(k.hint).font(.system(size: 10.5, weight: .semibold)).opacity(0.75)
                    }
                    .foregroundColor(k.key == "no_show" ? NT.danger : NT.ink)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Capsule().fill(k.key == "no_show" ? NT.dangerBg : Color.white))
                    .overlay(Capsule().stroke(k.key == "no_show" ? Color.clear : NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(!allowed || model.busy != nil)
                .opacity(allowed ? 1 : 0.4)
            }
            Button { mode = nil } label: {
                Text("やめる").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).frame(height: 36)
            }
            .buttonStyle(.plain)
        }
    }

    /// 店舗キャンセル：担当（レジの担当名）を選ぶ（2026-10-20 Ronnie「担当選択必ず」）
    private var storeStaffPicker: some View {
        let staff = p?.staff ?? []
        return VStack(spacing: 8) {
            Text("店舗キャンセル：担当を選んでください").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading)
            if staff.isEmpty {
                Text("担当がいません。レジの設定で担当を入れてください").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(staff) { s in
                            Button { Task { await run(["type": "handyRsvCancel", "reservationId": row.id, "kind": "store", "staffId": s.id], key: "cancel") } } label: {
                                Text(s.name).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1).minimumScaleFactor(0.75)
                                    .frame(maxWidth: .infinity).frame(height: 46)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                            }
                            .buttonStyle(PressableStyle())
                            .disabled(model.busy != nil)
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
            Button { storeCancel = false } label: {
                Text("もどる").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).frame(height: 36)
            }
            .buttonStyle(.plain)
        }
    }

    private func run(_ body: [String: Any], key: String) async {
        problem = nil
        if let e = await model.perform(body, key: key) {
            problem = e
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onClose()
        }
    }

    // MARK: 下：電話する・HANDYで注文・閉じる

    private var bottomBar: some View {
        HStack(spacing: 8) {
            if let phone = row.phone, let url = Self.telURL(phone) {
                Link(destination: url) {
                    HStack(spacing: 5) { Image(systemName: "phone.fill"); Text("電話する") }
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
            if let tableId = row.tableId, !row.cancelled {
                Button { onOpenTable(tableId) } label: {
                    Text("HANDYで注文").font(.system(size: 14, weight: .heavy)).foregroundColor(.white).lineLimit(1)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            Button(action: onClose) {
                Text("閉じる").font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.topBar))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

// MARK: - 予約可能なテーブル（Web の TableSuggest と同じ：人数に合う卓・ピッタリ・つなげる卓・30分後・ほかのテーブル）

struct NPHRTablePicker: View {
    let entry: NRWEntry
    let date: String
    let time: String
    let stay: Int
    let party: Int
    let today: String
    let now: Date
    let selected: [String]
    var showLater = true
    /// 卓を選んだ（30分後の卓を押したときは時間も変わる）
    let onSelect: ([String], String) -> Void
    @State private var showOther = false

    private struct Slot: Identifiable {
        let time: String
        let fits: [NRWChoice]
        let combos: [NRWCombo]
        let others: [NRWChoice]
        let busy: [NRWChoice]
        var id: String { time }
    }

    private var slots: [Slot] {
        let later = NRWMath.addMinutes(time, 30)
        let times = [time] + (showLater && later != time ? [later] : [])
        return times.map { t in
            let choices = NRWMath.choices(entry, date: date, time: t, stay: stay, party: party, today: today, now: now)
            let fits = choices.filter { $0.free && ($0.fit == .just || $0.fit == .ok) }
            let combos = fits.isEmpty ? NRWMath.combos(entry, choices: choices, party: party) : []
            let others = choices.filter { $0.free && ($0.fit == .big || $0.fit == .small) }
            let busy = choices.filter { !$0.free }
            return Slot(time: t, fits: fits, combos: combos, others: others, busy: busy)
        }
    }

    var body: some View {
        let list = slots
        let seats = entry.tables.filter { selected.contains($0.id) }.reduce(0) { $0 + $1.capacityMax }
        let names = entry.tables.filter { selected.contains($0.id) }.map(\.name).joined(separator: " + ")
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("予約可能なテーブル").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2)
                Text("（\(party)名に合う席・複数選択可）").font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8)
            }
            if !selected.isEmpty {
                HStack(spacing: 0) {
                    Text(names).foregroundColor(NT.purple)
                    Text(seatsNote(seats)).foregroundColor(seats < party ? NT.danger : NT.ink2)
                }
                .font(.system(size: 13, weight: .heavy))
                .lineLimit(2)
            }
            ForEach(Array(list.enumerated()), id: \.element.id) { index, slot in
                slotView(slot, first: index == 0)
            }
        }
    }

    /// 「・6名席」「・4名席（2名分たりません）」
    private func seatsNote(_ seats: Int) -> String {
        seats < party ? "・\(seats)名席（\(party - seats)名分たりません）" : "・\(seats)名席"
    }

    private func slotView(_ slot: Slot, first: Bool) -> some View {
        let otherCount = slot.others.count + slot.busy.count
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(slot.time)〜\(NRWMath.addMinutes(slot.time, stay))").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                if !first { Text("※押すと開始が30分後になります").font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8) }
            }
            .padding(.leading, 8)
            .overlay(alignment: .leading) { Rectangle().fill(NT.purple).frame(width: 3) }
            if !slot.fits.isEmpty {
                slider {
                    ForEach(slot.fits) { c in tableCard(c, on: slot.time == time && selected.contains(c.table.id)) { pick(slot.time, c.table.id) } }
                }
            } else if !slot.combos.isEmpty {
                Text("\(party)名は1つのテーブルに入りません。この組み合わせなら入ります：").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.purpleDeep)
                slider {
                    ForEach(slot.combos) { combo in comboCard(combo, on: slot.time == time && Set(selected) == Set(combo.ids)) { onSelect(combo.ids, slot.time) } }
                }
            } else {
                Text("この時間に\(party)名入るテーブルはありません").font(.system(size: 12)).foregroundColor(NT.danger)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
            }
            if first && otherCount > 0 {
                Button { withAnimation(.easeOut(duration: 0.15)) { showOther.toggle() } } label: {
                    HStack(spacing: 4) {
                        Image(systemName: showOther ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .bold))
                        Text("ほかのテーブル（\(otherCount)）").font(.system(size: 12, weight: .bold))
                    }
                    .foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                if showOther {
                    slider {
                        ForEach(slot.others) { c in tableCard(c, on: slot.time == time && selected.contains(c.table.id)) { pick(slot.time, c.table.id) } }
                        ForEach(slot.busy) { c in tableCard(c, on: false, action: nil) }
                    }
                }
            }
        }
    }

    private func slider<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let inner = content()
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { inner }
                .padding(.top, 10).padding(.bottom, 2).padding(.horizontal, 2)
        }
    }

    private func pick(_ slotTime: String, _ id: String) {
        if slotTime != time { onSelect([id], slotTime); return }
        onSelect(selected.contains(id) ? selected.filter { $0 != id } : selected + [id], time)
    }

    private func tableCard(_ c: NRWChoice, on: Bool, action: (() -> Void)?) -> some View {
        let t = c.table
        let cap = t.capacityMin > 1 && t.capacityMin != t.capacityMax ? "\(t.capacityMin)〜\(t.capacityMax)名" : "\(t.capacityMax)名"
        let fg: Color = !c.free ? NT.ink3 : on ? .white : NT.ink
        let bg: Color = !c.free ? Color(hex: 0xEDEFF3) : on ? NT.purple : c.best ? NT.lilac : .white
        let border: Color = !c.free ? NT.line : on ? Color.clear : c.best ? NT.purple : NT.line
        return Button { action?() } label: {
            VStack(spacing: 2) {
                Text(t.name).font(.system(size: 15, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
                Text(cap + (t.floorName.map { "・\($0)" } ?? "")).font(.system(size: 10.5)).opacity(on ? 0.85 : 0.75).lineLimit(1).minimumScaleFactor(0.7)
                if c.free && c.fit == .small {
                    Text("席が足りない").font(.system(size: 9.5, weight: .heavy)).foregroundColor(on ? .white : NT.danger)
                } else if c.free && c.fit == .big {
                    Text("大きめ").font(.system(size: 9.5)).opacity(0.75)
                } else if !c.free {
                    Text(c.reason ?? "").font(.system(size: 9.5, weight: .heavy))
                }
            }
            .foregroundColor(fg)
            .padding(.horizontal, 4)
            .frame(width: 84, height: 68)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(border, lineWidth: c.best && !on ? 1.5 : 1))
            .overlay(alignment: .topTrailing) {
                if on { Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundColor(.white).padding(5) }
            }
            .overlay(alignment: .top) {
                if c.best && !on {
                    Text("ピッタリ").font(.system(size: 9.5, weight: .heavy)).foregroundColor(.white).lineLimit(1).fixedSize()
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(NT.purple))
                        .offset(y: -8)
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .disabled(!c.free || action == nil)
    }

    private func comboCard(_ combo: NRWCombo, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(combo.tables.map(\.name).joined(separator: " + ")).font(.system(size: 14, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
                Text("合計\(combo.seats)名" + (combo.tables.first?.floorName.map { "・\($0)" } ?? "")).font(.system(size: 10.5)).opacity(0.8).lineLimit(1)
            }
            .foregroundColor(on ? .white : NT.ink)
            .padding(.horizontal, 6)
            .frame(width: 150, height: 64)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NT.purple : NT.lilac))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Color.clear : NT.purple, lineWidth: 1.5))
            .overlay(alignment: .topTrailing) {
                if on { Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundColor(.white).padding(5) }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.95))
    }
}

// MARK: - 日付選択（Web の ReservationCalendarSheet と同じ：日ごとの予約人数・休業日・仮予約／要連絡・祝日）

struct NPHRCalendarSheet: View {
    let selected: String
    let today: String
    let onClose: () -> Void
    let onPick: (String) -> Void
    @State private var month = ""
    @State private var payloads: [String: NPHRMonthPayload] = [:]
    @State private var problem: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 40)
                }
                .accessibilityLabel("閉じる")
                Spacer()
                Text("日付選択").font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                Spacer()
                Color.clear.frame(width: 40, height: 40)
            }
            .padding(.horizontal, 8).frame(height: 54)
            .background(NT.topBar)
            HStack(spacing: 10) {
                monthButton("chevron.left") { month = payloads[month]?.prevMonth ?? shift(month, -1) }
                Spacer()
                Text(monthLabel).font(.system(size: 19, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                Spacer()
                monthButton("chevron.right") { month = payloads[month]?.nextMonth ?? shift(month, 1) }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            HStack(spacing: 14) {
                Spacer()
                HStack(spacing: 5) { RoundedRectangle(cornerRadius: 3).fill(Color(hex: 0xE4E7EE)).frame(width: 18, height: 13); Text("休業日") }
                HStack(spacing: 5) { Circle().fill(NT.danger).frame(width: 8, height: 8); Text("仮予約／要連絡") }
            }
            .font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink2)
            .padding(.horizontal, 14).padding(.bottom, 6)
            HStack(spacing: 0) {
                ForEach(Array(["日", "月", "火", "水", "木", "金", "土"].enumerated()), id: \.offset) { i, w in
                    Text(w).font(.system(size: 12.5, weight: .heavy))
                        .foregroundColor(i == 0 ? NT.danger : i == 6 ? NT.purple : NT.ink2)
                        .frame(maxWidth: .infinity).frame(height: 30)
                }
            }
            .background(NT.page)
            ScrollView {
                if let weeks = payloads[month]?.weeks {
                    VStack(spacing: 4) {
                        ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                            HStack(spacing: 2) {
                                ForEach(Array(week.enumerated()), id: \.offset) { _, d in
                                    if let d { cell(d) } else { Color.clear.frame(maxWidth: .infinity).frame(height: 56) }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 8).padding(.top, 6)
                } else if let problem {
                    Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger).padding(.top, 40)
                } else {
                    ProgressView().padding(.top, 60)
                }
            }
            HStack(spacing: 10) {
                Button { month = String(today.prefix(7)) } label: {
                    Text("今月を出す").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                        .padding(.horizontal, 14).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(month == String(today.prefix(7)))
                Spacer()
                Button { onPick(today) } label: {
                    Text("今日へ").font(.system(size: 15, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 22).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Color.white)
            .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
        }
        .background(Color.white.ignoresSafeArea())
        .onAppear { if month.isEmpty { month = String(selected.prefix(7)) } }
        .task(id: month) { await load(month) }
    }

    private var monthLabel: String {
        let y = month.prefix(4)
        let m = Int(month.suffix(2)) ?? 0
        return "\(y)年\(m)月"
    }

    private func shift(_ m: String, _ n: Int) -> String {
        var y = Int(m.prefix(4)) ?? 2026
        var mm = (Int(m.suffix(2)) ?? 1) + n
        if mm < 1 { mm = 12; y -= 1 }
        if mm > 12 { mm = 1; y += 1 }
        return String(format: "%04d-%02d", y, mm)
    }

    private func monthButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2)
                .frame(width: 46, height: 40)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
        }
        .buttonStyle(PressableStyle())
    }

    private func cell(_ d: NPHRMonthDay) -> some View {
        let on = d.date == selected
        let isToday = d.date == today
        let red = d.dow == 0 || d.holiday != nil
        let color: Color = on ? .white : red ? NT.danger : d.dow == 6 ? NT.purple : NT.ink
        let bg: Color = on ? NT.purple : d.closed ? Color(hex: 0xE4E7EE) : Color.clear
        return Button { onPick(d.date) } label: {
            VStack(spacing: 1) {
                Text("\(d.day)").font(.system(size: 18, weight: on || isToday ? .heavy : .semibold)).foregroundColor(color).monospacedDigit()
                Text(d.guests > 0 ? "\(d.guests)名" : " ").font(.system(size: 10, weight: .semibold)).foregroundColor(on ? .white.opacity(0.9) : NT.ink3)
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity).frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(isToday && !on ? NT.purple.opacity(0.6) : Color.clear, lineWidth: 2))
            .overlay(alignment: .topTrailing) {
                if d.attention { Circle().fill(on ? Color.white : NT.danger).frame(width: 7, height: 7).padding(5) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityLabel("\(d.date)\(d.holiday.map { " \($0)" } ?? "")\(d.guests > 0 ? " \(d.guests)名" : "")")
    }

    private func load(_ m: String) async {
        guard !m.isEmpty, payloads[m] == nil else { return }
        do {
            payloads[m] = try await NPHApi.get(NPHRMonthPayload.self, part: "handyReservationMonth", ["month": m])
            problem = nil
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "カレンダーを読めませんでした"
        }
    }
}

// MARK: - 予約登録（Web の HandyReservationForm と同じ 2 ステップ）

struct NPHRNewReservationView: View {
    let storeName: String
    let onClose: () -> Void
    /// 登録できた（その日の一覧へ）
    let onSaved: (String) -> Void

    enum CountField: String, Identifiable { case adults, children; var id: String { rawValue } }

    @State private var step = 1
    @State private var date: String
    @State private var time = "18:00"
    @State private var adults = 2
    @State private var children = 0
    @State private var tableIds: [String] = []
    @State private var name = ""
    @State private var phone = ""
    @State private var sourceCode = ""
    @State private var courseId = ""
    @State private var tags: [String] = []
    @State private var stayCustom: Int? = nil
    @State private var status: NRWStatus = .confirmed
    @State private var clerkId = ""
    @State private var note = ""

    @State private var entry: NRWEntry? = nil
    @State private var info: NPHRFormInfo? = nil
    @State private var loadError: String? = nil
    @State private var loading = false
    @State private var saving = false
    @State private var problem: String? = nil
    @State private var countField: CountField? = nil
    @State private var now = Date()
    /// 経路・担当者の最初の値を入れたか
    @State private var defaultsSet = false

    init(date: String, storeName: String, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.storeName = storeName
        self.onClose = onClose
        self.onSaved = onSaved
        _date = State(initialValue: date)
    }

    private var today: String { info?.today ?? NPHRDate.today() }
    private var party: Int { adults + children }
    private var defaultStay: Int {
        if !courseId.isEmpty, let d = entry?.courseDurations[courseId], d > 0 { return d }
        return entry?.defaultStay ?? 120
    }
    private var stay: Int { stayCustom ?? defaultStay }
    private var phoneDigits: Int { phone.filter { ("0"..."9").contains($0) }.count }
    private var step1Ready: Bool { NPHRDate.parse(date) != nil && time.count == 5 && party >= 1 }
    private var ready: Bool { step1Ready && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && phoneDigits >= 10 }
    private var pickedTables: [NRWTable] { (entry?.tables ?? []).filter { tableIds.contains($0.id) } }

    var body: some View {
        VStack(spacing: 0) {
            NPHTopBar(title: "予約登録", subtitle: storeName, backLabel: "予約", onBack: onClose) {
                Color.clear.frame(width: 40, height: 40)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if step == 1 { step1 } else { step2 }
                }
                .padding(14).padding(.bottom, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            footer
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .task(id: date) { await load() }
        .sheet(item: $countField) { f in
            NPHRCountSheet(label: f == .adults ? "大人" : "子ども", initial: f == .adults ? adults : children, allowZero: f == .children) { n in
                if f == .adults { adults = n } else { children = n }
                countField = nil
            }
            .presentationDetents([.height(440)])
            .environment(\.colorScheme, .light)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let (e, i) = try await NPHRApi.entry(date: date)
            entry = e
            info = i
            now = Date()
            loadError = nil
            if !defaultsSet {
                defaultsSet = true
                sourceCode = i.sources.contains { $0.value == "phone" } ? "phone" : (i.sources.first?.value ?? "phone")
                // 担当者の最初の値＝いまハンディを使っている人（Web と同じ）
                if let c = i.clerk, e.clerks.contains(where: { $0.id == c.id }) { clerkId = c.id }
            }
        } catch {
            // 日を変えて読み直したとき（前の読み込みは止まる）は何も出さない
            if Task.isCancelled { return }
            loadError = (error as? NativeAPIError)?.message ?? "読み込めませんでした"
        }
    }

    // MARK: ① 日時・人数・テーブル

    private var step1: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("日時・人数を入れて、テーブルを選んでください").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
            if let e = loadError {
                Text(e).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.dangerBg))
            }
            card {
                HStack(alignment: .top, spacing: 10) {
                    field("来店日", required: true) {
                        DatePicker("来店日", selection: dateBinding, displayedComponents: .date)
                            .labelsHidden()
                            .datePickerStyle(.compact)
                            .environment(\.timeZone, NPHRDate.jst)
                            .environment(\.locale, Locale(identifier: "ja_JP"))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    field("時間", required: true) {
                        HStack(spacing: 4) {
                            menuPicker(hourBinding, options: (0..<24).map { String(format: "%02d", $0) }, suffix: "時")
                            menuPicker(minuteBinding, options: minuteOptions, suffix: "分")
                        }
                    }
                }
                HStack(spacing: 10) {
                    countControl("大人", value: adults, min: 0, field: .adults) { adults = $0 }
                    countControl("子ども", value: children, min: 0, field: .children) { children = $0 }
                }
            }
            card {
                if let e = entry, e.date == date, !e.tables.isEmpty {
                    NPHRTablePicker(entry: e, date: date, time: time, stay: stay, party: party, today: today, now: now, selected: tableIds) { ids, t in
                        tableIds = ids
                        time = t
                    }
                } else if loading || entry == nil || entry?.date != date {
                    HStack(spacing: 8) { ProgressView(); Text("空いているテーブルを確かめています…").font(.system(size: 13)).foregroundColor(NT.ink3) }
                } else {
                    Text("テーブルが登録されていません（テーブル未定で登録できます）").font(.system(size: 13)).foregroundColor(NT.ink3)
                }
            }
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { NPHRDate.parse(date) ?? Date() }, set: { d in
            let s = NPHRDate.string(d)
            if s != date { date = s; tableIds = [] }
        })
    }

    private var hourBinding: Binding<String> {
        Binding(get: { String(time.prefix(2)) }, set: { h in setTime("\(h):\(time.suffix(2))") })
    }

    private var minuteBinding: Binding<String> {
        Binding(get: { String(time.suffix(2)) }, set: { m in setTime("\(time.prefix(2)):\(m)") })
    }

    /// 分は 5 分ごと（いまの値が 5 分ごとでなければそれも入れる。Web の minuteOptions と同じ）
    private var minuteOptions: [String] {
        var list = stride(from: 0, to: 60, by: 5).map { String(format: "%02d", $0) }
        let cur = String(time.suffix(2))
        if !list.contains(cur) { list.append(cur); list.sort() }
        return list
    }

    private func setTime(_ t: String) {
        guard t != time else { return }
        time = t
        tableIds = []
    }

    private func menuPicker(_ selection: Binding<String>, options: [String], suffix: String) -> some View {
        Menu {
            Picker(suffix, selection: selection) {
                ForEach(options, id: \.self) { o in Text("\(o)\(suffix)").tag(o) }
            }
        } label: {
            HStack(spacing: 2) {
                Text("\(selection.wrappedValue)\(suffix)").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundColor(NT.purple)
            }
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    /// 人数（− 数字 ＋。数字を押すとテンキー。Web の PartyCountField と同じ）
    private func countControl(_ label: String, value: Int, min: Int, field f: CountField, set: @escaping (Int) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
            HStack(spacing: 5) {
                stepButton("minus", disabled: value <= min) { set(Swift.max(min, value - 1)) }
                Button { countField = f } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text("\(value)").font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                        Text("名").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                    .frame(maxWidth: .infinity).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.lilacLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(label)をテンキーで入れる（いま \(value)名）")
                stepButton("plus", disabled: value >= 999) { set(Swift.min(999, value + 1)) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func stepButton(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                .frame(width: 40, height: 44)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    // MARK: ② お名前・電話番号・コース・キーワード・確保時間・ステータス・ご要望・経路・担当者

    private var step2: some View {
        VStack(alignment: .leading, spacing: 16) {
            card {
                field("お名前", required: true) { input("山田 太郎", text: $name) }
                field("電話番号", required: true) {
                    VStack(alignment: .leading, spacing: 4) {
                        input("09012345678", text: $phone).keyboardType(.phonePad)
                        if !phone.isEmpty && phoneDigits < 10 {
                            Text("電話番号は10桁以上で入れてください").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.danger)
                        }
                    }
                }
                if let courses = info?.courses, !courses.isEmpty {
                    field("コース") {
                        optionMenu(selection: $courseId, options: [NPHROption(value: "", label: "なし（席のみ）")] + courses)
                    }
                }
            }
            if let keywords = entry?.keywords, !keywords.isEmpty {
                card {
                    HStack(spacing: 4) {
                        Image(systemName: "tag").font(.system(size: 12, weight: .bold))
                        Text("キーワード").font(.system(size: 12, weight: .heavy))
                        Text("（複数選択可）").font(.system(size: 10.5))
                    }
                    .foregroundColor(NT.ink2)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        ForEach(keywords, id: \.self) { k in
                            let on = tags.contains(k)
                            Button { if on { tags.removeAll { $0 == k } } else { tags.append(k) } } label: {
                                Text(k).font(.system(size: 12.5, weight: .heavy)).foregroundColor(on ? .white : NT.ink)
                                    .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
                                    .padding(.horizontal, 4).frame(maxWidth: .infinity).frame(minHeight: 44)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NT.purple : Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Color.clear : NT.line, lineWidth: 1))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            }
            card { stayControl }
            card { statusPicker }
            card {
                field("ご要望・メモ") {
                    VStack(alignment: .trailing, spacing: 3) {
                        ZStack(alignment: .topLeading) {
                            if note.isEmpty {
                                Text("アレルギー・記念日など").font(.system(size: 16)).foregroundColor(NT.ink3).padding(.horizontal, 14).padding(.vertical, 12)
                            }
                            TextEditor(text: Binding(get: { note }, set: { note = String($0.prefix(1000)) }))
                                .font(.system(size: 16)).foregroundColor(NT.ink)
                                .scrollContentBackground(.hidden)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .frame(minHeight: 88)
                        }
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                        Text("残り \(1000 - note.count) 文字").font(.system(size: 10.5)).foregroundColor(NT.ink3)
                    }
                }
                if let sources = info?.sources, !sources.isEmpty {
                    field("予約経路") { optionMenu(selection: $sourceCode, options: sources) }
                }
                if let clerks = entry?.clerks, !clerks.isEmpty {
                    field("担当者") {
                        optionMenu(selection: $clerkId, options: [NPHROption(value: "", label: "選ばない")] + clerks.map { NPHROption(value: $0.id, label: $0.name) })
                    }
                }
            }
        }
    }

    /// 確保時間（−30・−5・＋5・＋30。15 分〜12 時間。Web の StayControl と同じ）
    private var stayControl: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 12, weight: .bold))
                    Text("確保時間").font(.system(size: 12, weight: .heavy))
                }
                .foregroundColor(NT.ink2)
                Spacer()
                if stay != defaultStay {
                    Button { stayCustom = nil } label: {
                        Text("元に戻す（\(NRWMath.stayLabel(defaultStay))）").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.purple)
                    }
                    .buttonStyle(.plain)
                }
            }
            Text(NRWMath.stayLabel(stay)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().frame(maxWidth: .infinity)
            HStack(spacing: 6) {
                ForEach([-30, -5, 5, 30], id: \.self) { d in
                    let disabled = (d < 0 && stay <= 15) || (d > 0 && stay >= 720)
                    Button {
                        let next = Swift.min(720, Swift.max(15, stay + d))
                        stayCustom = next == defaultStay ? nil : next
                    } label: {
                        Text(d > 0 ? "+\(d)分" : "\(d)分").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                            .frame(maxWidth: .infinity).frame(height: 42)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(disabled)
                    .opacity(disabled ? 0.4 : 1)
                }
            }
        }
    }

    /// 予約ステータス（来店待ち・仮予約・要連絡。Web の StatusPicker と同じ）
    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("予約ステータス").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
            HStack(spacing: 6) {
                ForEach(NRWStatus.allCases, id: \.self) { s in
                    let on = status == s
                    let tone = statusTone(s)
                    Button { status = s } label: {
                        VStack(spacing: 1) {
                            Text(s.label).font(.system(size: 14, weight: .heavy))
                            Text(s.hint).font(.system(size: 9.5, weight: .semibold)).opacity(0.8).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .foregroundColor(on ? tone.fg : NT.ink3)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? tone.bg : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? tone.border : NT.line, lineWidth: on ? 2 : 1))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }

    private func statusTone(_ s: NRWStatus) -> (fg: Color, bg: Color, border: Color) {
        switch s {
        case .confirmed: return (NT.purpleDeep, NT.lilac, NT.purple)
        case .pending: return (NT.warn, Color(hex: 0xFBF1D9), NT.warn)
        case .needsContact: return (Color.white, NT.danger, NT.danger)
        }
    }

    private func optionMenu(selection: Binding<String>, options: [NPHROption]) -> some View {
        Menu {
            Picker("", selection: selection) {
                ForEach(options) { o in Text(o.label).tag(o.value) }
            }
        } label: {
            HStack {
                Text(options.first { $0.value == selection.wrappedValue }?.label ?? options.first?.label ?? "").font(.system(size: 16, weight: .semibold))
                    .foregroundColor(NT.ink).lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
            }
            .padding(.horizontal, 14).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    private func input(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(.system(size: 16)).foregroundColor(NT.ink)
            .autocorrectionDisabled()
            .padding(.horizontal, 14).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func field<Content: View>(_ label: String, required: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label).font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
                if required { Text("*").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.danger) }
            }
            inner
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 14) { inner }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    // MARK: 下：いま入れた内容と、次へ・登録（Web と同じ）

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                summary(step1Ready, "\(NPHRDate.dayLabel(date)) \(time)　\(party)名（\(NRWMath.stayLabel(stay))）")
                summary(!pickedTables.isEmpty, pickedTables.isEmpty ? "テーブル未定" : pickedTables.map(\.name).joined(separator: " + "))
                if step == 2 {
                    HStack(spacing: 10) {
                        summary(!name.trimmingCharacters(in: .whitespaces).isEmpty, name.trimmingCharacters(in: .whitespaces).isEmpty ? "お名前" : name)
                        summary(phoneDigits >= 10, phone.isEmpty ? "電話番号" : phone)
                    }
                }
            }
            if let problem {
                Text(problem).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
            }
            HStack(spacing: 8) {
                Button {
                    if step == 2 { step = 1; problem = nil } else { onClose() }
                } label: {
                    HStack(spacing: 4) { Image(systemName: "chevron.left"); Text(step == 2 ? "前に戻る" : "やめる") }
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                Button {
                    if step == 1 { if step1Ready { step = 2 } } else { Task { await submit() } }
                } label: {
                    HStack(spacing: 6) {
                        if saving { ProgressView().tint(.white) }
                        Text(step == 1 ? "詳細を入力する" : "この内容で登録する").lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .font(.system(size: 15, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill((step == 1 ? step1Ready : ready && !saving) ? NT.purple : NT.ink3))
                }
                .buttonStyle(PressableStyle())
                .disabled(step == 1 ? !step1Ready : !ready || saving)
                .layoutPriority(1)
            }
        }
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 10)
        .background(Color.white.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private func summary(_ on: Bool, _ text: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(on ? NT.purple : NT.line).frame(width: 8, height: 8)
            Text(text).font(.system(size: 13, weight: .heavy)).foregroundColor(on ? NT.ink : NT.ink3).monospacedDigit().lineLimit(1)
        }
    }

    private func submit() async {
        guard ready, !saving else { return }
        saving = true
        defer { saving = false }
        problem = nil
        var input: [String: Any] = [
            "date": date,
            "time": time,
            "adults": adults,
            "children": children,
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "phone": phone.trimmingCharacters(in: .whitespacesAndNewlines),
            "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
            "sourceCode": sourceCode,
            "tableIds": tableIds,
            "stayMinutes": stay,
            "status": status.rawValue,
            "tags": tags,
        ]
        if !courseId.isEmpty { input["courseId"] = courseId }
        if !clerkId.isEmpty { input["clerkId"] = clerkId }
        let r = await NSPApi.postJSON(["type": "handyRsvCreate", "input": input])
        if r.ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onSaved(date)
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            problem = r.error ?? "予約を追加できませんでした"
        }
    }
}

/// 人数をテンキーで入れる（Web の PartyPad と同じ。最初に打った数字は前の値と入れ替わる）
struct NPHRCountSheet: View {
    let label: String
    let initial: Int
    var allowZero = true
    let onDone: (Int) -> Void
    @State private var text = ""

    var body: some View {
        let value = Int(text) ?? initial
        VStack(spacing: 14) {
            Text(label).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).padding(.top, 18)
            Text("\(text.isEmpty ? String(initial) : text)名").font(.system(size: 40, weight: .heavy)).foregroundColor(text.isEmpty ? NT.ink3 : NT.ink).monospacedDigit()
            NPHKeypad(text: $text, maxLength: 3)
            Button { onDone(Swift.min(999, Swift.max(allowZero ? 0 : 1, value))) } label: {
                Text("決定").font(.system(size: 17, weight: .heavy)).foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
            .padding(.horizontal, 18)
        }
        .padding(.bottom, 12)
        .background(Color.white.ignoresSafeArea())
    }
}

// MARK: - 画面の切り替え（予約 ↔ 予約登録）

/// iPhone ハンディの予約（Web の /handy/reservations・/handy/reservations/new の代わり）
struct NativePhoneReservationsScreen: View {
    @EnvironmentObject var state: AppState
    let route: AppState.PhoneReservationsRoute
    @StateObject private var model: NativePhoneReservationsModel
    @State private var newOpen: Bool

    init(route: AppState.PhoneReservationsRoute) {
        self.route = route
        let tab = NativePhoneReservationsModel.Tab(rawValue: route.tab ?? "") ?? .list
        _model = StateObject(wrappedValue: NativePhoneReservationsModel(date: route.date, tab: tab))
        _newOpen = State(initialValue: route.new)
    }

    var body: some View {
        ZStack {
            NativePhoneReservationsView(model: model,
                                        onBack: { state.closePhoneReservations() },
                                        onOpenTable: { id in state.openPhoneHandyFromReservations(tableId: id) },
                                        onAdd: { newOpen = true })
            if newOpen {
                NPHRNewReservationView(date: model.shownDate, storeName: model.payload?.store.name ?? "", onClose: { newOpen = false }, onSaved: { d in
                    newOpen = false
                    model.select(.list)
                    model.go(d)
                    model.toast = "予約を追加しました"
                })
                .transition(.move(edge: .trailing))
                .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.18), value: newOpen)
    }
}

// MARK: - 見本（シミュレーターで形を確かめる用。-tenpoNativePreview phoneReservations）

extension NativePhoneReservationsModel {
    static func sample() -> NativePhoneReservationsModel {
        let m = NativePhoneReservationsModel(date: nil, tab: .list)
        m.isSample = true
        let today = NPHRDate.today()
        func row(_ id: String, _ time: String, _ end: String, _ name: String, _ party: Int, _ table: String, status: String, label: String,
                 course: String? = nil, source: String = "電話", request: String? = nil, memo: String? = nil, tags: [String] = [],
                 tableId: String? = nil, bill: Double? = nil, paidAt: String? = nil, phone: String? = "09012345678", walkIn: Bool = false) -> NPHRRow {
            NPHRRow(id: id, time: time, endTime: end, stayMinutes: 120, stayLabel: "2時間", name: name, phone: phone, partySize: party,
                   tableLabel: table, tableIds: [], sourceLabel: source, tags: tags, courseName: course, status: status, statusLabel: label,
                   upcoming: ["pending", "confirmed", "waiting", "arrived", "seated", "billing"].contains(status),
                   open: ["pending", "confirmed", "waiting"].contains(status), request: request, memo: memo, tableId: tableId,
                   code: "TEL-\(id.suffix(6))", nameKana: nil, adults: party, children: 0, email: nil, allergy: request == nil ? nil : "えび",
                   seatType: nil, purpose: nil, clerkName: "佐藤", cancelReason: status == "cancelled" ? "お客様キャンセル（連絡あり）" : nil,
                   receivedAt: "2026/10/20 21:30", walkIn: walkIn, billTotal: bill, billOrderNos: bill == nil ? [] : [101], paidAt: paidAt)
        }
        let rows = [
            row("00000000-0000-4000-8000-000000000101", "17:00", "19:00", "鈴木 一郎", 2, "T-3", status: "completed", label: "退店", bill: 8640, paidAt: "18:52", phone: nil, walkIn: true),
            row("00000000-0000-4000-8000-000000000102", "18:00", "20:00", "山田 太郎", 4, "T-1", status: "seated", label: "着席", course: "おまかせコース", source: "ホットペッパー",
                request: "誕生日のプレートをお願いします", tags: ["誕生日"], tableId: "00000000-0000-4000-8000-000000000001"),
            row("00000000-0000-4000-8000-000000000103", "19:00", "21:00", "佐々木 花子", 6, "席未定", status: "pending", label: "仮予約", memo: "折り返し連絡", tags: ["要連絡", "個室希望"]),
            row("00000000-0000-4000-8000-000000000104", "19:30", "21:30", "中村 優子", 3, "T-5+T-6", status: "confirmed", label: "予約確定", source: "TABLE ONE"),
            row("00000000-0000-4000-8000-000000000105", "20:00", "22:00", "高橋 健", 2, "C-1", status: "cancelled", label: "キャンセル"),
        ]
        let now = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600))
        let inbox = NPHRInbox(
            tasks: [
                NLInboxTask(key: "p:1", kind: "pending", reservationId: "00000000-0000-4000-8000-000000000103", importId: nil, title: "佐々木 花子 様",
                            detail: "\(NPHRDate.dayLabel(today)) 19:00〜 6名", note: "電話", at: now, date: today),
                NLInboxTask(key: "n:2", kind: "new", reservationId: "00000000-0000-4000-8000-000000000104", importId: nil, title: "中村 優子 様",
                            detail: "\(NPHRDate.dayLabel(today)) 19:30〜 3名", note: "TABLE ONE", at: now, date: today),
            ],
            notices: [
                NLInboxNotice(key: "n:2", kind: "new", title: "新しい予約　中村 優子 様", detail: "\(NPHRDate.dayLabel(today)) 19:30〜 3名", note: "TABLE ONE",
                              at: now, reservationId: nil, date: today),
                NLInboxNotice(key: "x:5", kind: "cancel", title: "お客様キャンセル　高橋 健 様", detail: "\(NPHRDate.dayLabel(today)) 20:00〜 2名",
                              note: "お客様キャンセル（連絡あり）", at: now, reservationId: nil, date: today),
            ],
            canAcknowledge: true)
        m.payload = NPHRPayload(ok: true, store: NHDNamed(id: "s", name: "TENPO ONE 新宿店"), clerk: NHDNamed(id: "k", name: "佐藤"),
                               today: today, date: today, tab: "list", title: "今日の予約", dayLabel: NPHRDate.dayLabel(today),
                               emptyText: "今日の予約はありません。", prevDate: NPHRDate.shift(today, -1), nextDate: NPHRDate.shift(today, 1),
                               canWrite: true, canCancel: true, staff: [NHDNamed(id: "a", name: "佐藤"), NHDNamed(id: "b", name: "Sankar"), NHDNamed(id: "c", name: "田中")],
                               reservations: rows, inbox: inbox)
        return m
    }
}

struct NativePhoneReservationsPreview: View {
    @StateObject private var model = NativePhoneReservationsModel.sample()

    var body: some View {
        NativePhoneReservationsView(model: model, onBack: {}, onOpenTable: { _ in }, onAdd: {})
    }
}
