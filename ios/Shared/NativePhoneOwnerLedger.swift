import SwiftUI

// iPhone の店長・オーナー：店舗台帳（Web の /app/reservations の代わり。2026-10-25 Ronnie「iPhone も native に」）。
// iPad の店舗台帳（NativeLedgerView）は使わない。iPhone の幅に合わせた 1 列の画面：
//   上のタブ：予約一覧 ｜ 受付管理 ｜ メッセージ
//   予約一覧：日付（‹ 前の日・日付を押すとカレンダー・次の日 ›・今日）・その日の集計・状態のチップ（すべて／来店前／来店中／退店／仮予約）・予約のカード
//             押すと詳細（NativePhoneOwnerLedgerDetail.swift）：予約確定・来店・テーブル変更・日時変更・コース・経路・担当・メモ・キャンセル
//   受付管理：仮予約・要連絡・新しいネット予約・変更／キャンセル・グルメサイト要確認（確定する・連絡済み・確認済み・対応済み）
//   メッセージ：新しい予約・変更・キャンセルのお知らせ（14 日分。読んだところは端末ごと）
//   ＋予約登録：2 ステップ（日時・人数・予約可能なテーブル → お名前・電話番号・コース・キーワード・確保時間・ステータス・ご要望・経路・担当者）
// サーバーは iPad の店舗台帳と同じ（返す形は変えない。iPad がそのまま使っている）:
//   GET  ?part=ledger&date=（&open=）… その日の予約（NLPayload）
//   GET  ?part=ledgerInbox          … 受付管理・メッセージ（iPad の NLInboxModel をそのまま使う）
//   GET  ?part=ledgerMonth&month=   … 日付選択のカレンダー（NLMonthPayload）
//   GET  ?part=ledgerEntry&date=    … 予約可能なテーブル（NRWEntry）
//   POST ledgerStatus / ledgerCancel / ledgerNoShow / ledgerTables / ledgerMove / ledgerMemo / ledgerClerk / ledgerSource / ledgerCourse / ledgerInboxAct / ledgerCreate
// ハンディの予約（part=handyReservations）は担当者の Cookie が要るので使わない。
// 見た目の部品はハンディの予約と同じもの（NPHRRowCard・NPHRStatusBadge・NPHRTablePicker・NPHRDate）。

// MARK: - データと動き

@MainActor
final class NPOLedgerModel: ObservableObject {
    enum Tab: String, CaseIterable {
        case list, inbox, messages
        var label: String { self == .list ? "予約一覧" : self == .inbox ? "受付管理" : "メッセージ" }
    }

    /// 一覧の絞り込み（状態ごと。上の集計と同じ数え方）
    enum Filter: String, CaseIterable {
        case all, before, inStore, done, pending
        var label: String {
            switch self {
            case .all: return "すべて"
            case .before: return "来店前"
            case .inStore: return "来店中"
            case .done: return "退店"
            case .pending: return "仮予約"
            }
        }
        func match(_ status: String) -> Bool {
            switch self {
            case .all: return true
            case .before: return status == "pending" || status == "confirmed" || status == "waiting"
            case .inStore: return status == "arrived" || status == "seated" || status == "billing"
            case .done: return status == "completed"
            case .pending: return status == "pending"
            }
        }
    }

    /// 見ている日（nil＝今日）
    @Published var date: String?
    @Published var tab: Tab = .list
    @Published var filter: Filter = .all
    @Published var payload: NLPayload?
    @Published var error: String?
    @Published var busy: String?
    @Published var toast: String?
    /// 開いている予約（詳細のシート）
    @Published var opened: NLReservation?
    /// サーバーが「Web で見せて」と返した（機能がオフなど）。画面を閉じて裏の Web を見せる
    @Published var useWeb = false
    /// 見本（シミュレーターの確認用）。通信しない
    var isSample = false
    /// 見本のときの予約可能なテーブル
    var sampleEntry: NRWEntry?
    private var refresher: Timer?

    init(date: String? = nil) {
        self.date = date
        payload = NativeAPI.cached(NLPayload.self, NativeModuleAPI.url("ledger", Self.query(date)))
    }

    static func query(_ date: String?) -> [String: String] {
        guard let date else { return [:] }
        return ["date": date]
    }

    var today: String { payload?.today ?? NPHRDate.today() }
    /// 日付のバーに出す日（押した直後から新しい日を出す）
    var shownDate: String { date ?? today }
    /// いまの payload が見ている日のものか（違えば読み込み中）
    var isCurrent: Bool { payload?.date == shownDate }
    var canWrite: Bool { payload?.canWrite ?? false }
    var reservations: [NLReservation] { payload?.reservations ?? [] }
    var shown: [NLReservation] { reservations.filter { filter.match($0.status) } }

    func count(_ f: Filter) -> Int { reservations.filter { f.match($0.status) }.count }
    func label(_ status: String) -> String { payload?.statusLabels[status] ?? status }

    func start() {
        guard !isSample else { return }
        refresher?.invalidate()
        // ネット予約・ほかの端末の変更も入る。30 秒ごとに読み直す（iPad の店舗台帳と同じ）
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
            let p = try await NativeModuleAPI.get(NLPayload.self, part: "ledger", query: Self.query(asked))
            // 読んでいる間に日を変えたら、古い返事は使わない
            guard asked == date else { return }
            payload = p
            error = nil
        } catch {
            guard asked == date else { return }
            let e = error as? NativeAPIError
            if e?.useWeb == true && payload == nil { useWeb = true }
            self.error = e?.message ?? "通信できませんでした"
        }
    }

    /// ほかの日へ（今日は nil）
    func go(_ d: String) {
        guard !isSample else { return }
        let next: String? = d == today ? nil : d
        guard next != date else { Task { await refresh() }; return }
        date = next
        if let cached = NativeAPI.cached(NLPayload.self, NativeModuleAPI.url("ledger", Self.query(next))) { payload = cached }
        Task { await refresh() }
    }

    /// その予約の日の台帳を読んで、詳細を開く（Web の ?open=）
    func open(reservationId id: String) async {
        if let hit = reservations.first(where: { $0.id == id }) { opened = hit; return }
        guard !isSample else { return }
        do {
            let p = try await NativeModuleAPI.get(NLPayload.self, part: "ledger", query: ["open": id])
            date = p.date == p.today ? nil : p.date
            payload = p
            error = nil
            opened = p.reservations.first(where: { $0.id == id })
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "予約を開けませんでした"
        }
    }

    /// 操作（POST）。うまくいったら知らせを出して読み直す。うまくいかなければそのことば
    func perform(_ body: [String: Any], key: String, done: String) async -> String? {
        guard busy == nil else { return "ほかの操作の途中です" }
        if isSample { toast = done; return nil }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { return r.error ?? "変更できませんでした" }
        toast = done
        await refresh()
        return nil
    }

    /// その日の卓・予約（予約可能なテーブル）。exclude はテーブル変更のときのその予約（自分を「予約あり」に数えない）
    func entry(date: String, exclude: String? = nil) async throws -> NRWEntry {
        if isSample, let e = sampleEntry { return e }
        var data = try await NativeAPI.shared.send(URLRequest(url: NativeModuleAPI.url("ledgerEntry", ["date": date])))
        if let exclude, var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let booked = obj["booked"] as? [[String: Any]] {
            obj["booked"] = booked.filter { ($0["id"] as? String) != exclude }
            if let d = try? JSONSerialization.data(withJSONObject: obj) { data = d }
        }
        return try JSONDecoder().decode(NRWEntry.self, from: data)
    }

    /// 予約のカード（ハンディの予約と同じ NPHRRowCard）に渡す形
    func row(_ r: NLReservation) -> NPHRRow {
        let s = nlJstMinutes(r.startAt, dayStart: r.reservedDate)
        let e = nlJstMinutes(r.endAt, dayStart: r.reservedDate)
        let stay = max(15, e - s)
        return NPHRRow(
            id: r.id, time: nlHm(s), endTime: nlHm(e), stayMinutes: stay, stayLabel: NRWMath.stayLabel(stay),
            name: stripSama(r.guestName), phone: r.guestPhone.nilIfEmpty, partySize: r.partySize,
            tableLabel: r.tableNames.isEmpty ? "席未定" : r.tableNames.joined(separator: "+"), tableIds: r.tableIds,
            sourceLabel: NPOLedgerText.source(r), tags: r.tags ?? [], courseName: r.courseName,
            status: r.status, statusLabel: label(r.status),
            upcoming: NPOLedgerText.upcoming.contains(r.status), open: NPOLedgerText.open.contains(r.status),
            request: r.requestNote?.nilIfEmpty, memo: r.memo?.nilIfEmpty, tableId: nil, code: r.code,
            nameKana: r.guestNameKana?.nilIfEmpty, adults: r.adults, children: r.children, email: r.guestEmail?.nilIfEmpty,
            allergy: r.allergyNote?.nilIfEmpty, seatType: r.seatType?.nilIfEmpty, purpose: r.purpose?.nilIfEmpty,
            clerkName: r.staffName, cancelReason: nil, receivedAt: nil, walkIn: r.createdVia == "walk_in",
            billTotal: nil, billOrderNos: [], paidAt: nil)
    }
}

/// 店舗台帳の言い方（Web の components/reservations/constants.ts と同じ）
enum NPOLedgerText {
    static let upcoming: Set<String> = ["pending", "confirmed", "waiting", "arrived", "seated", "billing"]
    /// 来店前（キャンセル・テーブル変更ができる）
    static let open: Set<String> = ["pending", "confirmed", "waiting"]
    static let via: [String: String] = ["web": "Web予約", "phone": "電話", "walk_in": "ウォークイン", "manual": "手動登録", "gourmet_mail": "グルメサイト（自動取込）"]

    static func source(_ r: NLReservation) -> String { r.sourceName ?? via[r.createdVia] ?? r.createdVia }

    /// 経路を直せる予約（Web の canChangeReservationSource と同じ：電話・手動登録・ウォークイン）
    static func canChangeSource(_ r: NLReservation) -> Bool { r.createdVia == "phone" || r.createdVia == "manual" || r.createdVia == "walk_in" }

    private static let hmFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = NPHRDate.jst
        f.dateFormat = "HH:mm"
        return f
    }()

    /// 日本時間の「19:15」
    static func hm(_ d: Date) -> String { hmFormatter.string(from: d) }

    /// ISO の日時 → 日本時間の「19:15」
    static func hm(iso: String?) -> String? {
        guard let iso, let d = NRWMath.iso(iso) else { return nil }
        return hm(d)
    }

    /// 分 → 「17:00」「24:00」「25:30」（閉店が翌日にまたがるときも 24 を足したまま）
    static func clock(_ min: Int) -> String { String(format: "%02d:%02d", min / 60, min % 60) }
}

// MARK: - 画面（タブ・一覧・受付管理・メッセージ）

struct NPOLedgerView: View {
    @ObservedObject var model: NPOLedgerModel
    @ObservedObject var inbox: NLInboxModel
    let onBack: () -> Void
    /// 開いてすぐカレンダーを出す（Web の /app/reservations/calendar から来たとき）
    let startCalendar: Bool
    @State private var calendarOpen = false
    @State private var calendarShownOnce = false
    @State private var newOpen = false

    init(model: NPOLedgerModel, inbox: NLInboxModel, onBack: @escaping () -> Void, startCalendar: Bool = false) {
        self.model = model
        self.inbox = inbox
        self.onBack = onBack
        self.startCalendar = startCalendar
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "店舗台帳", subtitle: model.payload?.store.name ?? "", onBack: onBack) {
                topButtons
            } content: {
                VStack(spacing: 0) {
                    tabBar
                    if let e = model.error, model.payload != nil {
                        Text(e).font(.system(size: 12, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity).padding(.horizontal, 12).padding(.vertical, 6).background(NT.dangerBg)
                    }
                    content
                }
            }
            if newOpen {
                NPOLedgerNewReservation(model: model, date: model.shownDate, onClose: { newOpen = false }, onSaved: { d in
                    newOpen = false
                    model.tab = .list
                    model.filter = .all
                    model.go(d)
                })
                .transition(.move(edge: .trailing))
                .zIndex(1)
            }
            NPHToast(text: $model.toast).zIndex(2)
        }
        .environment(\.colorScheme, .light)
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.18), value: newOpen)
        .onAppear {
            model.start()
            if !model.isSample { inbox.start() }
            if startCalendar && !calendarShownOnce {
                calendarShownOnce = true
                calendarOpen = true
            }
        }
        .onDisappear {
            model.stop()
            inbox.stop()
        }
        .sheet(item: $model.opened) { r in
            NPOLedgerDetail(model: model, reservation: r, onClose: { model.opened = nil })
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $calendarOpen) {
            NPOLedgerCalendarSheet(selected: model.shownDate, today: model.today, onClose: { calendarOpen = false }) { d in
                calendarOpen = false
                model.tab = .list
                model.go(d)
            }
            .presentationDetents([.large])
            .environment(\.colorScheme, .light)
        }
    }

    // MARK: 上のバーの右（更新・＋予約登録）

    private var topButtons: some View {
        HStack(spacing: 0) {
            Button {
                Task {
                    await model.refresh()
                    if !model.isSample { await inbox.load() }
                }
            } label: {
                Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 38, height: 40)
            }
            .accessibilityLabel("更新")
            if model.canWrite {
                Button { newOpen = true } label: {
                    VStack(spacing: 1) {
                        Image(systemName: "plus").font(.system(size: 17, weight: NT.strong))
                        Text("予約登録").font(.system(size: 9.5, weight: NT.strong)).lineLimit(1)
                    }
                    .foregroundColor(.white).frame(width: 52, height: 44)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("予約を登録")
            }
        }
    }

    // MARK: 上のタブ（予約一覧 ｜ 受付管理 ｜ メッセージ）

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(NPOLedgerModel.Tab.allCases, id: \.self) { t in
                let on = model.tab == t
                let count = badgeCount(t, on: on)
                Button { select(t) } label: {
                    VStack(spacing: 0) {
                        HStack(spacing: 5) {
                            Text(t.label).font(.system(size: 14, weight: NT.strong)).foregroundColor(on ? NT.ink : NT.ink3).lineLimit(1)
                            if count > 0 {
                                Text(count > 99 ? "99+" : "\(count)").font(.system(size: 11, weight: NT.strong)).foregroundColor(.white)
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
    private func badgeCount(_ t: NPOLedgerModel.Tab, on: Bool) -> Int {
        switch t {
        case .list: return 0
        case .inbox: return inbox.payload?.tasks.count ?? 0
        case .messages: return on ? 0 : inbox.unreadNotices
        }
    }

    private func select(_ t: NPOLedgerModel.Tab) {
        if t == .messages {
            inbox.openMessages()
        } else if model.tab == .messages {
            inbox.prevSeen = nil
        }
        model.tab = t
    }

    @ViewBuilder private var content: some View {
        if let p = model.payload {
            switch model.tab {
            case .list: listTab(p)
            case .inbox: NPOLedgerTasks(model: model, inbox: inbox)
            case .messages: NPOLedgerNotices(model: model, inbox: inbox)
            }
        } else if let e = model.error {
            VStack(spacing: 14) {
                Spacer()
                Image(systemName: "exclamationmark.circle").font(.system(size: 30, weight: .semibold)).foregroundColor(NT.ink3)
                Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center).padding(.horizontal, 28)
                Button { Task { await model.refresh() } } label: {
                    Text("もう一度読む").font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
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

    private func listTab(_ p: NLPayload) -> some View {
        ScrollView {
            VStack(spacing: 10) {
                dateBar
                if !model.isCurrent {
                    ProgressView().tint(NT.purple).padding(.top, 40)
                } else {
                    summaryCard(p)
                    filterChips
                    let shown = model.shown
                    if p.reservations.isEmpty {
                        emptyText(p.isClosedDay ? "定休日です。予約はありません。" : "\(NPHRDate.title(p.date, today: p.today))はありません。")
                    } else if shown.isEmpty {
                        emptyText("「\(model.filter.label)」の予約はありません。")
                    }
                    ForEach(shown) { r in
                        Button { model.opened = r } label: { NPHRRowCard(row: model.row(r)) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                    if !shown.isEmpty {
                        Text(p.canWrite ? "予約を押すと、予約確定・来店・テーブル変更・キャンセルができます。" : "予約を押すと、詳しい内容を見られます。")
                            .font(.system(size: 11)).foregroundColor(NT.ink3).multilineTextAlignment(.center).padding(.top, 4)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .refreshable {
            await model.refresh()
            if !model.isSample { await inbox.load() }
        }
    }

    private func emptyText(_ t: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar").font(.system(size: 28, weight: .semibold)).foregroundColor(NT.ink3)
            Text(t).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 36).padding(.horizontal, 16)
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
                        Text("今日").font(.system(size: 13, weight: NT.strong)).foregroundColor(NT.purple)
                            .padding(.horizontal, 11).frame(height: 32)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                    }
                    .buttonStyle(PressableStyle())
                    .padding(.leading, 4)
                }
                Button { calendarOpen = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                        Text(NPHRDate.dayLabel(d)).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
                        if isToday { Text("今日").font(.system(size: 10.5, weight: NT.strong)).foregroundColor(NT.purple) }
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
            Image(systemName: icon).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink2)
                .frame(width: 44, height: 42)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }

    /// その日の集計（Web の店舗台帳の上のタイルと同じ数え方。lib/ledger-summary.ts）
    private func summaryCard(_ p: NLPayload) -> some View {
        let s = p.summary
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(NPHRDate.title(p.date, today: p.today)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer(minLength: 4)
                Text(p.isClosedDay ? "定休日" : "営業 \(NPOLedgerText.clock(p.openMin))〜\(NPOLedgerText.clock(p.closeMin))")
                    .font(.system(size: 11.5, weight: .semibold)).foregroundColor(p.isClosedDay ? NT.danger : NT.ink3).monospacedDigit()
            }
            HStack(spacing: 6) {
                tile("予約", "\(s.count)組", sub: "\(s.guests)名", tint: NT.lilac, fg: NT.purpleDeep)
                tile("来店前", "\(s.waitingCount)", sub: "組", tint: NT.page, fg: NT.ink)
                tile("来店中", "\(s.inCount)", sub: "組", tint: Color(hex: 0xE5F4EC), fg: NT.ok)
                tile("退店", "\(s.outCount)", sub: "組", tint: NT.page, fg: NT.ink2)
            }
            HStack(spacing: 12) {
                mini("キャンセル", s.cancelled, danger: false)
                mini("当日予約", s.sameDayCount, danger: false)
                mini("席未定", s.unseated, danger: s.unseated > 0)
                mini("仮予約", s.unconfirmed, danger: s.unconfirmed > 0)
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func tile(_ label: String, _ value: String, sub: String, tint: Color, fg: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10.5, weight: NT.strong)).foregroundColor(NT.ink3).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.system(size: 18, weight: NT.strong)).foregroundColor(fg).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                Text(sub).font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 9).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(tint))
    }

    private func mini(_ label: String, _ n: Int, danger: Bool) -> some View {
        HStack(spacing: 3) {
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
            Text("\(n)").font(.system(size: 12, weight: NT.strong)).foregroundColor(danger ? NT.danger : NT.ink).monospacedDigit()
        }
        .lineLimit(1)
    }

    /// 状態のチップ（すべて・来店前・来店中・退店・仮予約。数はいま出している日のもの）
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(NPOLedgerModel.Filter.allCases, id: \.self) { f in
                    let on = model.filter == f
                    let n = model.count(f)
                    Button { model.filter = f } label: {
                        HStack(spacing: 4) {
                            Text(f.label).font(.system(size: 13, weight: NT.strong))
                            Text("\(n)").font(.system(size: 12, weight: NT.strong)).monospacedDigit().opacity(0.8)
                        }
                        .foregroundColor(on ? .white : NT.ink2)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(Capsule().fill(on ? NT.purple : Color.white))
                        .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, 2).padding(.vertical, 1)
        }
    }
}

// MARK: - 受付管理（Web の InboxTaskList と同じ。中身は iPad の NLInboxModel）

struct NPOLedgerTasks: View {
    @ObservedObject var model: NPOLedgerModel
    @ObservedObject var inbox: NLInboxModel

    private static let groups: [(kind: String, label: String, hint: String, icon: String)] = [
        ("pending", "仮予約", "確定するとお店の予約になります", "hourglass"),
        ("contact", "要連絡", "お客様に連絡したら「連絡済み」", "phone.arrow.up.right"),
        ("new", "新しいネット予約", "ネット・グルメサイトから入った予約。見たら「確認済み」", "calendar.badge.plus"),
        ("change", "変更・キャンセル", "お客様・グルメサイトからの変更とキャンセル", "calendar.badge.exclamationmark"),
        ("gourmet", "グルメサイト 要確認", "メールを読み取れませんでした。内容を見て台帳に入れてください", "envelope.badge"),
    ]

    /// 押すボタン（Web の primaryAction・iPad の受付管理と同じ）
    private func action(_ t: NLInboxTask) -> (label: String, act: String, id: String, done: String)? {
        if t.kind == "pending", let id = t.reservationId { return ("確定する", "confirm", id, "予約を確定しました") }
        if t.kind == "contact", let id = t.reservationId { return ("連絡済み", "contacted", id, "連絡済みにしました") }
        if let id = t.importId { return ("対応済み", "resolveImport", id, "対応済みにしました") }
        if t.kind == "new" || t.kind == "change", let id = t.reservationId, inbox.payload?.canAcknowledge ?? false {
            return ("確認済み", "ack", id, "確認済みにしました")
        }
        return nil
    }

    var body: some View {
        let tasks = inbox.payload?.tasks ?? []
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if inbox.payload == nil {
                    if let e = inbox.error {
                        Text(e).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger).frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        ProgressView().tint(NT.purple).frame(maxWidth: .infinity).padding(.top, 40)
                    }
                } else if tasks.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle").font(.system(size: 32, weight: .semibold)).foregroundColor(NT.ok)
                        Text("やることはありません").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
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
                                Text(g.label).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1).fixedSize()
                                Text("\(items.count)件").font(.system(size: 11, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
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
                if let p = inbox.payload, !p.canAcknowledge {
                    Text("「新しいネット予約」と「お客様のキャンセル」の確認は、データベースの更新（00100）のあとに出ます。")
                        .font(.system(size: 10.5)).foregroundColor(NT.ink3)
                }
            }
            .padding(12).padding(.bottom, 40)
        }
        .refreshable { if !model.isSample { await inbox.load() } }
    }

    private func row(_ t: NLInboxTask) -> some View {
        let a = action(t)
        let canWrite = inbox.payload?.canWrite ?? false
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(t.title).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
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
                if canWrite, let a {
                    Button { Task { await run(t, a.act, a.id, a.done) } } label: {
                        HStack(spacing: 4) {
                            if model.busy == t.key {
                                ProgressView().tint(.white).scaleEffect(0.75)
                            } else {
                                Image(systemName: "checkmark").font(.system(size: 12, weight: NT.strong))
                            }
                            Text(a.label).font(.system(size: 13, weight: NT.strong)).lineLimit(1)
                        }
                        .foregroundColor(.white).padding(.horizontal, 12).frame(minWidth: 92).frame(height: 36)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.busy != nil)
                }
                if let d = t.date {
                    Button {
                        model.tab = .list
                        model.go(d)
                    } label: {
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

    private func run(_ t: NLInboxTask, _ act: String, _ id: String, _ done: String) async {
        if let e = await model.perform(["type": "ledgerInboxAct", "act": act, "id": id], key: t.key, done: done) {
            model.toast = e
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if !model.isSample { await inbox.load() }
    }
}

// MARK: - メッセージ（Web の InboxNoticeList と同じ）

struct NPOLedgerNotices: View {
    @ObservedObject var model: NPOLedgerModel
    @ObservedObject var inbox: NLInboxModel

    private func look(_ kind: String) -> (icon: String, label: String, fg: Color, bg: Color) {
        switch kind {
        case "new": return ("calendar.badge.plus", "新規", Color(hex: 0x2F6B3F), Color(hex: 0xE8F3EC))
        case "change": return ("pencil.circle", "変更", Color(hex: 0x2B4FA8), Color(hex: 0xE8EEFB))
        case "cancel": return ("calendar.badge.minus", "キャンセル", Color(hex: 0xB42318), Color(hex: 0xFBEAEA))
        default: return ("door.left.hand.open", "退店", Color(hex: 0x6B625A), Color(hex: 0xEFEBE7))
        }
    }

    var body: some View {
        let notices = inbox.payload?.notices ?? []
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: "bell").font(.system(size: 11, weight: .bold)).foregroundColor(NT.purple)
                    Text("お客様の新しい予約・変更・キャンセルのお知らせ（14日分）").font(.system(size: 11)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 4)
                if inbox.payload == nil {
                    ProgressView().tint(NT.purple).frame(maxWidth: .infinity).padding(.top, 40)
                } else if notices.isEmpty {
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
        .refreshable { if !model.isSample { await inbox.load() } }
    }

    private func row(_ n: NLInboxNotice) -> some View {
        let l = look(n.kind)
        let fresh = inbox.isNew(n)
        return Button {
            guard let d = n.date else { return }
            inbox.prevSeen = nil
            model.tab = .list
            model.go(d)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: l.icon).font(.system(size: 14, weight: .bold)).foregroundColor(l.fg)
                    .frame(width: 32, height: 32).background(Circle().fill(l.bg))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(n.title).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                        if fresh {
                            Text("新着").font(.system(size: 10, weight: NT.strong)).foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NT.purple))
                        }
                    }
                    if !n.detail.isEmpty {
                        Text(n.detail).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1)
                    }
                    HStack(spacing: 6) {
                        Text(l.label).font(.system(size: 10.5, weight: NT.strong)).foregroundColor(l.fg)
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

// MARK: - 日付選択（月のカレンダー。iPad の月間カレンダーと同じ part=ledgerMonth：日ごとの予約人数・休業日・仮予約）

struct NPOLedgerCalendarSheet: View {
    let selected: String
    let today: String
    let onClose: () -> Void
    let onPick: (String) -> Void
    @State private var month = ""
    @State private var payloads: [String: NLMonthPayload] = [:]
    @State private var problem: String? = nil

    init(selected: String, today: String, onClose: @escaping () -> Void, onPick: @escaping (String) -> Void) {
        self.selected = selected
        self.today = today
        self.onClose = onClose
        self.onPick = onPick
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 40)
                }
                .accessibilityLabel("閉じる")
                Spacer()
                Text("日付選択").font(.system(size: 17, weight: NT.strong)).foregroundColor(.white)
                Spacer()
                Color.clear.frame(width: 40, height: 40)
            }
            .padding(.horizontal, 8).frame(height: 54)
            .background(NT.topBar)
            HStack(spacing: 10) {
                monthButton("chevron.left") { month = shift(month, -1) }
                Spacer()
                VStack(spacing: 1) {
                    Text(monthLabel).font(.system(size: 19, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    if let p = payloads[month] {
                        Text("\(p.monthCount)組 \(p.monthGuests)名").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                    }
                }
                Spacer()
                monthButton("chevron.right") { month = shift(month, 1) }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            HStack(spacing: 14) {
                Spacer()
                HStack(spacing: 5) { RoundedRectangle(cornerRadius: 3).fill(Color(hex: 0xE4E7EE)).frame(width: 18, height: 13); Text("休業日") }
                HStack(spacing: 5) { Circle().fill(NT.danger).frame(width: 8, height: 8); Text("仮予約あり") }
            }
            .font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink2)
            .padding(.horizontal, 14).padding(.bottom, 6)
            HStack(spacing: 0) {
                ForEach(Array(["日", "月", "火", "水", "木", "金", "土"].enumerated()), id: \.offset) { i, w in
                    Text(w).font(.system(size: 12.5, weight: NT.strong))
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
                                ForEach(week, id: \.date) { d in
                                    if d.inMonth { cell(d) } else { Color.clear.frame(maxWidth: .infinity).frame(height: 56) }
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
                    Text("今月を出す").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink2)
                        .padding(.horizontal, 14).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(month == String(today.prefix(7)))
                Spacer()
                Button { onPick(today) } label: {
                    Text("今日へ").font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
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

    private func cell(_ d: NLMonthDay) -> some View {
        let on = d.date == selected
        let isToday = d.date == today
        let closed = d.holiday != nil
        let color: Color = on ? .white : d.dow == 0 || closed ? NT.danger : d.dow == 6 ? NT.purple : NT.ink
        let bg: Color = on ? NT.purple : closed ? Color(hex: 0xE4E7EE) : Color.clear
        return Button { onPick(d.date) } label: {
            VStack(spacing: 1) {
                Text("\(d.day)").font(.system(size: 18, weight: on || isToday ? NT.strong : .semibold)).foregroundColor(color).monospacedDigit()
                Text(d.guests > 0 ? "\(d.guests)名" : " ").font(.system(size: 10, weight: .semibold)).foregroundColor(on ? .white.opacity(0.9) : NT.ink3)
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity).frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(isToday && !on ? NT.purple.opacity(0.6) : Color.clear, lineWidth: 2))
            .overlay(alignment: .topTrailing) {
                if d.attention ?? false { Circle().fill(on ? Color.white : NT.danger).frame(width: 7, height: 7).padding(5) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityLabel("\(d.date)\(d.holiday.map { " \($0)" } ?? "")\(d.guests > 0 ? " \(d.guests)名" : "")")
    }

    private func load(_ m: String) async {
        guard !m.isEmpty, payloads[m] == nil else { return }
        // 見本（シミュレーター）は通信しない
        if NativePreview.current != nil { return }
        do {
            payloads[m] = try await NativeModuleAPI.get(NLMonthPayload.self, part: "ledgerMonth", query: ["month": m])
            problem = nil
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "カレンダーを読めませんでした"
        }
    }
}

// MARK: - 画面の入口（NativePhoneOwnerScreen の "reservations"）

/// iPhone の店長・オーナーの店舗台帳（Web の /app/reservations・/app/reservations/list・/app/reservations/calendar の代わり）。
/// Web の ?date= ?open= ?view=inbox|messages もそのまま開く
struct NPOLedgerScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPOLedgerModel
    @StateObject private var inbox = NLInboxModel()

    init(route: NativeModuleRoute) {
        self.route = route
        let raw = route.query("date") ?? ""
        let date: String? = raw.count == 10 && NPHRDate.parse(raw) != nil ? raw : nil
        _model = StateObject(wrappedValue: NPOLedgerModel(date: date))
    }

    var body: some View {
        NPOLedgerView(model: model, inbox: inbox, onBack: { state.closePhoneOwnerModule() },
                      startCalendar: route.url.path.hasSuffix("/calendar") || route.query("view") == "calendar" || route.query("view") == "month")
            .onAppear(perform: applyRoute)
            // 機能がオフ・権限が無いなど：Web の画面（案内が出る）を見せる
            .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }

    private func applyRoute() {
        switch route.query("view") {
        case "inbox": model.tab = .inbox
        case "messages":
            model.tab = .messages
            Task {
                await inbox.load()
                inbox.openMessages()
            }
        default: break
        }
        if let id = route.query("open"), id.count == 36 {
            Task { await model.open(reservationId: id) }
        }
    }
}
