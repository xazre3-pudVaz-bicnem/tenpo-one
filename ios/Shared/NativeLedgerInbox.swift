import SwiftUI

// 店舗台帳の右上「＋ 予約登録」の横のメッセージの箱（2026-10-24 19:56 Ronnie「予約が入ったら来るメッセージの箱」）。
// 中身は Web の予約の画面の「受付管理｜メッセージ」と同じ（lib/reservation-inbox-server.ts。GET part=ledgerInbox）。
//   受付管理：仮予約・要連絡・新しいネット予約・変更／キャンセル・グルメサイト要確認（済ませると消える）
//   メッセージ：新しい予約・キャンセル・変更のお知らせ（14 日分。読んだところは端末ごと）

struct NLInboxTask: Codable, Identifiable, Hashable {
    let key: String
    let kind: String
    let reservationId: String?
    let importId: String?
    let title: String
    let detail: String
    let note: String?
    let at: String
    let date: String?
    var id: String { key }
}

struct NLInboxNotice: Codable, Identifiable, Hashable {
    let key: String
    let kind: String
    let title: String
    let detail: String
    let note: String?
    let at: String
    let reservationId: String?
    let date: String?
    var id: String { key }
}

struct NLInboxPayload: Codable {
    let storeId: String
    let canWrite: Bool
    let canAcknowledge: Bool
    let tasks: [NLInboxTask]
    let notices: [NLInboxNotice]
}

@MainActor
final class NLInboxModel: ObservableObject {
    @Published var payload: NLInboxPayload?
    @Published var error: String?
    @Published var busyKey: String?
    /// 最後にメッセージを見た時刻（端末ごと）
    @Published var seen: Date?
    /// いま開いているメッセージで「新着」を付ける境目
    @Published var prevSeen: Date?
    private var timer: Timer?

    private func seenKey(_ storeId: String) -> String { "tenpo.inbox.seen.\(storeId)" }

    func start() {
        guard timer == nil else { return }
        Task { await load() }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.load() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func load() async {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "ledgerInbox")]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!), kickPrint: false)
            let p = try JSONDecoder().decode(NLInboxPayload.self, from: data)
            payload = p
            if let s = UserDefaults.standard.object(forKey: seenKey(p.storeId)) as? Date { seen = s }
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "受付管理を読めませんでした"
        }
    }

    static func date(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    /// まだ一度も開いていない端末は「この 24 時間」を未読に
    private var seenLine: Date { seen ?? Date().addingTimeInterval(-24 * 3600) }

    var unreadNotices: Int {
        (payload?.notices ?? []).filter { (Self.date($0.at) ?? .distantPast) > seenLine }.count
    }

    /// 箱の数字＝やること＋まだ読んでいないお知らせ
    var badge: Int { (payload?.tasks.count ?? 0) + unreadNotices }

    func openMessages() {
        prevSeen = seenLine
        let now = Date()
        seen = now
        if let id = payload?.storeId { UserDefaults.standard.set(now, forKey: seenKey(id)) }
    }

    func isNew(_ n: NLInboxNotice) -> Bool {
        guard let line = prevSeen else { return false }
        return (Self.date(n.at) ?? .distantPast) > line
    }
}

struct NLInboxSheet: View {
    @ObservedObject var inbox: NLInboxModel
    @ObservedObject var model: NativeLedgerModel
    let onClose: () -> Void

    enum Tab { case tasks, messages }
    @State private var tab: Tab = .tasks

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    tabButton("予約受付管理", count: inbox.payload?.tasks.count ?? 0, on: tab == .tasks) { tab = .tasks }
                    tabButton("メッセージ", count: inbox.unreadNotices, on: tab == .messages) { tab = .messages; inbox.openMessages() }
                    Spacer()
                    Button { Task { await inbox.load() } } label: { Image(systemName: "arrow.clockwise").font(.system(size: 15, weight: .bold)) }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                Rectangle().fill(NLColor.line).frame(height: 1)
                ScrollView {
                    VStack(spacing: 10) {
                        if let e = inbox.error, inbox.payload == nil {
                            Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NLColor.red).padding(.top, 30)
                        } else if inbox.payload == nil {
                            ProgressView("読み込み中…").padding(.top, 40)
                        } else if tab == .tasks {
                            let tasks = inbox.payload?.tasks ?? []
                            if tasks.isEmpty { empty("やることはありません", icon: "checkmark.circle") }
                            ForEach(tasks) { t in taskRow(t) }
                        } else {
                            let notices = inbox.payload?.notices ?? []
                            if notices.isEmpty { empty("お知らせはありません（14 日分）", icon: "tray") }
                            ForEach(notices) { n in noticeRow(n) }
                        }
                    }
                    .padding(16)
                }
                .background(NLColor.page)
            }
            .navigationTitle("予約のお知らせ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
        }
        .task { await inbox.load() }
    }

    private func tabButton(_ title: String, count: Int, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 15, weight: .heavy))
                if count > 0 {
                    Text("\(count)").font(.system(size: 12, weight: .heavy)).monospacedDigit().foregroundColor(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NLColor.red))
                }
            }
            .foregroundColor(on ? NLColor.navy : NLColor.muted)
            .padding(.horizontal, 16).frame(height: 40)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NLColor.yellow : NLColor.page))
        }
        .buttonStyle(PressableStyle())
    }

    private func empty(_ text: String, icon: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 34)).foregroundColor(NLColor.gray)
            Text(text).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.muted)
        }
        .padding(.top, 50)
    }

    private func taskIcon(_ kind: String) -> (String, Color) {
        switch kind {
        case "pending": return ("hourglass", NLColor.yellow)
        case "contact": return ("phone.arrow.up.right", NLColor.red)
        case "new": return ("calendar.badge.plus", NLColor.green)
        case "change": return ("calendar.badge.exclamationmark", NLColor.red)
        default: return ("envelope.badge", NLColor.blue)
        }
    }

    private func noticeIcon(_ kind: String) -> (String, Color) {
        switch kind {
        case "new": return ("calendar.badge.plus", NLColor.green)
        case "cancel": return ("calendar.badge.minus", NLColor.red)
        case "change": return ("pencil.circle", NLColor.blue)
        default: return ("door.left.hand.open", NLColor.gray)
        }
    }

    private func actionOf(_ t: NLInboxTask) -> (label: String, act: String, id: String)? {
        if t.kind == "pending", let id = t.reservationId { return ("確定する", "confirm", id) }
        if t.kind == "contact", let id = t.reservationId { return ("連絡済み", "contacted", id) }
        if let id = t.importId { return ("対応済み", "resolveImport", id) }
        if (t.kind == "new" || t.kind == "change"), let id = t.reservationId, inbox.payload?.canAcknowledge ?? false { return ("確認済み", "ack", id) }
        return nil
    }

    private func taskRow(_ t: NLInboxTask) -> some View {
        let (icon, color) = taskIcon(t.kind)
        return HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundColor(color == NLColor.yellow ? NLColor.navy : .white)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color))
            Button { open(t.date) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.title).font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink).lineLimit(1)
                    Text(t.detail).font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundColor(NLColor.ink).lineLimit(1)
                    if let n = t.note, !n.isEmpty { Text(n).font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(2) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let a = actionOf(t), inbox.payload?.canWrite ?? false {
                Button { Task { await run(t, a.act, a.id) } } label: {
                    Group {
                        if inbox.busyKey == t.key { ProgressView() }
                        else { Text(a.label).font(.system(size: 14, weight: .heavy)) }
                    }
                    .foregroundColor(NLColor.navy)
                    .padding(.horizontal, 14).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.yellow))
                }
                .buttonStyle(PressableStyle())
                .disabled(inbox.busyKey != nil)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NLColor.line, lineWidth: 1))
    }

    private func noticeRow(_ n: NLInboxNotice) -> some View {
        let (icon, color) = noticeIcon(n.kind)
        return Button { open(n.date) } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(n.title).font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink).lineLimit(1)
                        if inbox.isNew(n) {
                            Text("新着").font(.system(size: 10, weight: .heavy)).foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(NLColor.red))
                        }
                    }
                    Text(n.detail).font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundColor(NLColor.ink).lineLimit(1)
                    if let note = n.note, !note.isEmpty { Text(note).font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(2) }
                }
                Spacer()
                Text(stamp(n.at)).font(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundColor(NLColor.muted)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(inbox.isNew(n) ? NLColor.yellowSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NLColor.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func stamp(_ iso: String) -> String {
        guard let d = NLInboxModel.date(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "M/d HH:mm"
        return f.string(from: d)
    }

    /// その予約の日の台帳へ
    private func open(_ date: String?) {
        guard let date else { return }
        model.date = date
        Task { await model.refresh(silent: false) }
        onClose()
    }

    private func run(_ t: NLInboxTask, _ act: String, _ id: String) async {
        inbox.busyKey = t.key
        defer { inbox.busyKey = nil }
        if await model.act(["type": "ledgerInboxAct", "act": act, "id": id]) != nil {
            await inbox.load()
            await model.refresh(silent: true)
        }
    }
}
