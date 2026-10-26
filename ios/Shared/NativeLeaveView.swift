import SwiftUI

// 有給休暇のネイティブ。Web の /app/leave と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   自分の有給 … 残日数・付与合計（有効分）・取得合計・失効分／有給を申請・取下げ（承認待ちのとき）／付与履歴／取得履歴
//   管理       … 付与を登録・承認待ちの有給申請（承認・却下は店長以上）・失効間近（60日以内）・スタッフ別 残日数・有給付与ルール（org.settings）
// サーバーは lib/native-modules/leave.ts（読み込みは Web と同じ lib/leave-server.ts、操作は Web と同じ Server Action）。
// 有給は iPad に残さない（レジの iPad は何人も使う）：読んだらすぐ保存を消す・前の中身を先に出さない（NATApi.get）。
// 画面の枠・タブ・札・お知らせは勤怠と同じ（NativeAttendanceView.swift の NATPage・NATTabBar・NATBadge …）。

// MARK: - 中身（サーバーの返事）

struct NLVSummary: Decodable, Hashable {
    let remaining: Double
    let activeGranted: Double
    let taken: Double
    let expired: Double
}

struct NLVRequest: Decodable, Hashable, Identifiable {
    let id: String
    let leaveDate: String
    let dateLabel: String
    let fractionLabel: String
    let reason: String
    let status: String
    let statusLabel: String
    let rejectNote: String?
    let canWithdraw: Bool
}

struct NLVGrant: Decodable, Hashable, Identifiable {
    let id: String
    let grantedLabel: String
    let daysLabel: String
    let expiresLabel: String
    let reasonLabel: String
    let expired: Bool
}

struct NLVTaken: Decodable, Hashable, Identifiable {
    let id: String
    let dateLabel: String
    let fractionLabel: String
    let note: String
}

struct NLVPending: Decodable, Hashable, Identifiable {
    let id: String
    let staffName: String
    let dateLabel: String
    let fractionLabel: String
    let reason: String
}

struct NLVExpiring: Decodable, Hashable, Identifiable {
    let id: String
    let staffName: String
    let daysLabel: String
    let expiresLabel: String
}

struct NLVBalance: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let granted: Double
    let taken: Double
    let expired: Double
    let remaining: Double
}

struct NLVGrantDefaults: Decodable, Hashable {
    let days: Double
    let grantedOn: String
    let expiresOn: String
}

struct NLVPolicy: Decodable, Hashable {
    let expiryYears: Double
    let memo: String
}

struct NLVPayload: Decodable {
    let ok: Bool
    let tab: String
    let displayName: String?
    let isApprover: Bool
    let canReview: Bool
    let canSetPolicy: Bool
    let today: String
    // 自分の有給
    let summary: NLVSummary?
    let requests: [NLVRequest]?
    let grants: [NLVGrant]?
    let taken: [NLVTaken]?
    // 管理
    let staffOptions: [NATOption]?
    let defaultExpiryYears: Double?
    let grantDefaults: NLVGrantDefaults?
    let pending: [NLVPending]?
    let expiringSoon: [NLVExpiring]?
    let balances: [NLVBalance]?
    let policy: NLVPolicy?
}

enum NLVDate {
    /// 'YYYY-MM-DD' に年を足す（Web の grant-dialog の addYears と同じ。2/29 の 1 年後は 3/1）
    static func addYears(_ s: String, _ years: Int) -> String {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return s }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0) ?? TimeZone.current
        var dc = DateComponents()
        dc.year = parts[0] + years
        dc.month = parts[1]
        dc.day = parts[2]
        guard let d = cal.date(from: dc) else { return s }
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

// MARK: - 入口（Web の道 → 画面）

struct NativeLeaveView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void

    var body: some View {
        NLVScreen(tab: route.query("tab"), onHome: onHome)
            .id(route)
    }
}

@MainActor
final class NLVModel: ObservableObject {
    @Published var payload: NLVPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    @Published var busy = false
    @Published var tab: String

    init(tab: String?) {
        self.tab = tab ?? "mine"
    }

    var loading: Bool { payload != nil && payload?.tab != tab }

    func load() async {
        do {
            let p = try await NATApi.get(NLVPayload.self, part: "leave", ["tab": tab])
            payload = p
            tab = p.tab
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
    }

    func open(tab t: String) async {
        tab = t
        await load()
    }

    func act(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        let r = await NATApi.post(body)
        toast = NATToast.from(r)
        if r.ok { await load() }
    }

    /// できたら nil（お知らせ・読み直し）、だめならことば（入力画面に出す）
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

enum NLVSheet: Identifiable {
    case request
    case grant

    var id: String {
        switch self {
        case .request: return "request"
        case .grant: return "grant"
        }
    }
}

struct NLVScreen: View {
    let onHome: () -> Void
    @StateObject private var model: NLVModel
    @State private var sheet: NLVSheet?
    @State private var approving: NLVPending?
    @State private var prompt: NPReasonPrompt?

    init(tab: String?, onHome: @escaping () -> Void) {
        self.onHome = onHome
        _model = StateObject(wrappedValue: NLVModel(tab: tab))
    }

    var body: some View {
        NATPage(title: "有給休暇", userName: model.payload?.displayName ?? "", onHome: onHome, loaded: model.payload != nil,
                error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload { content(p) }
        }
        .task { await model.load() }
        .sheet(item: $sheet) { s in sheetView(s) }
        .sheet(item: $prompt) { pr in NPReasonSheet(prompt: pr) { prompt = nil }.presentationDetents([.medium]) }
        .alert("有給申請を承認", isPresented: Binding(get: { approving != nil }, set: { if !$0 { approving = nil } }), presenting: approving) { r in
            Button("キャンセル", role: .cancel) {}
            Button("承認する") { Task { await model.act(["type": "leaveApprove", "requestId": r.id]) } }
        } message: { _ in
            Text("承認すると勤怠記録に有給取得として反映されます。よろしいですか。")
        }
    }

    private func tabs(_ p: NLVPayload) -> [NATTabItem] {
        var items = [NATTabItem(key: "mine", label: "自分の有給")]
        if p.isApprover { items.append(NATTabItem(key: "admin", label: "管理")) }
        return items
    }

    @ViewBuilder private func content(_ p: NLVPayload) -> some View {
        Text("有給休暇の残日数・付与履歴・取得履歴を管理します").font(.system(size: 14, weight: .medium)).foregroundColor(NT.ink3)
        NATTabBar(items: tabs(p), selected: model.tab) { t in
            Task { await model.open(tab: t) }
        }
        if model.loading {
            HStack { Spacer(); ProgressView("読み込み中…").tint(NT.purple); Spacer() }.padding(.vertical, 40)
        } else if p.tab == "admin" {
            NLVAdminSection(p: p, model: model, openGrant: { sheet = .grant }, approve: { approving = $0 }, reject: { r in
                prompt = NPReasonPrompt(title: "有給申請を却下", message: "この申請を却下します。理由を入力してください。", confirm: "却下する") { reason in
                    await model.act(["type": "leaveReject", "requestId": r.id, "reason": reason])
                }
            })
        } else {
            NLVMineSection(p: p, model: model, openRequest: { sheet = .request })
        }
    }

    @ViewBuilder private func sheetView(_ s: NLVSheet) -> some View {
        let p = model.payload
        switch s {
        case .request:
            NLVRequestSheet(today: p?.today ?? NATTime.dayFmt.string(from: Date()), submit: { await model.submit($0) }, onClose: { sheet = nil })
        case .grant:
            NLVGrantSheet(
                staff: p?.staffOptions ?? [],
                years: Int(p?.defaultExpiryYears ?? 2),
                defaults: p?.grantDefaults,
                today: p?.today ?? NATTime.dayFmt.string(from: Date()),
                submit: { await model.submit($0) },
                onClose: { sheet = nil }
            )
        }
    }
}

// MARK: - 共通：表の行

/// 表の 1 行（幅を決めて並べる。最後の列は残りの幅）
struct NLVTableRow: View {
    let cells: [(String, CGFloat?, Bool)]
    var header = false

    var body: some View {
        HStack(spacing: 12) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                if let w = c.1 {
                    cellText(c.0, right: c.2).frame(width: w, alignment: c.2 ? .trailing : .leading)
                } else {
                    cellText(c.0, right: c.2).frame(maxWidth: .infinity, alignment: c.2 ? .trailing : .leading)
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, header ? 8 : 11)
    }

    private func cellText(_ s: String, right: Bool) -> some View {
        Text(s)
            .font(.system(size: header ? 12 : 15, weight: header ? Font.Weight.semibold : Font.Weight.regular))
            .foregroundColor(header ? NT.ink3 : NT.ink)
            .monospacedDigit()
            .lineLimit(2)
    }
}

struct NLVDivider: View {
    var body: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 18) }
}

/// 数のカード（Web の StatCard）
struct NLVStat: View {
    let label: String
    let value: String
    var color: Color = NT.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 30, weight: NT.strong)).monospacedDigit().foregroundColor(color).lineLimit(1).minimumScaleFactor(0.6)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

// MARK: - 自分の有給（Web の MineTab）

struct NLVMineSection: View {
    let p: NLVPayload
    @ObservedObject var model: NLVModel
    let openRequest: () -> Void

    private var s: NLVSummary { p.summary ?? NLVSummary(remaining: 0, activeGranted: 0, taken: 0, expired: 0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            stats
            requestCard
            grantCard
            takenCard
        }
    }

    private var stats: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
            NLVStat(label: "残日数", value: "\(NATTime.num(s.remaining))日", color: s.remaining < 0 ? NT.danger : NT.purple)
            NLVStat(label: "付与合計（有効分）", value: "\(NATTime.num(s.activeGranted))日")
            NLVStat(label: "取得合計", value: "\(NATTime.num(s.taken))日")
            NLVStat(label: "失効分", value: "\(NATTime.num(s.expired))日", color: s.expired > 0 ? NT.warn : NT.ink)
        }
    }

    private var requestCard: some View {
        let rows = p.requests ?? []
        return NSPCard(title: "有給申請") {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Spacer()
                    NSPButton(text: "有給を申請", icon: "calendar.badge.plus", primary: true, disabled: model.busy) { openRequest() }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                if rows.isEmpty {
                    NATEmpty(title: "申請履歴はありません")
                } else {
                    NLVTableRow(cells: [("取得日", 120, false), ("区分", 60, false), ("理由", nil, false), ("状態", 100, false), ("操作", 100, true)], header: true)
                    ForEach(rows) { r in
                        NLVDivider()
                        requestRow(r)
                    }
                }
            }
        }
    }

    private func requestRow(_ r: NLVRequest) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(r.dateLabel).font(.system(size: 15)).monospacedDigit().foregroundColor(NT.ink).frame(width: 120, alignment: .leading)
            Text(r.fractionLabel).font(.system(size: 15)).foregroundColor(NT.ink).frame(width: 60, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.reason.isEmpty ? "—" : r.reason).font(.system(size: 15)).foregroundColor(NT.ink2).lineLimit(2)
                if let note = r.rejectNote {
                    Text("却下理由: \(note)").font(.system(size: 12)).foregroundColor(NT.danger).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            NATBadge(text: r.statusLabel, color: Self.statusColor(r.status)).frame(width: 100, alignment: .leading)
            HStack {
                Spacer(minLength: 0)
                if r.canWithdraw {
                    NATSmallButton(text: "取下げ", icon: "xmark", disabled: model.busy) {
                        Task { await model.act(["type": "leaveWithdraw", "requestId": r.id]) }
                    }
                }
            }
            .frame(width: 100)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
    }

    static func statusColor(_ s: String) -> Color {
        switch s {
        case "pending": return NT.warn
        case "approved": return NT.ok
        case "rejected": return NT.danger
        default: return NT.ink3
        }
    }

    private var grantCard: some View {
        let rows = p.grants ?? []
        return NSPCard(title: "付与履歴") {
            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    NATEmpty(title: "付与履歴はありません")
                } else {
                    NLVTableRow(cells: [("付与日", 130, false), ("日数", 70, true), ("失効日", 130, false), ("理由", nil, false), ("状態", 90, false)], header: true)
                    ForEach(rows) { g in
                        NLVDivider()
                        HStack(spacing: 12) {
                            Text(g.grantedLabel).monospacedDigit().frame(width: 130, alignment: .leading)
                            Text(g.daysLabel).monospacedDigit().frame(width: 70, alignment: .trailing)
                            Text(g.expiresLabel).monospacedDigit().frame(width: 130, alignment: .leading)
                            Text(g.reasonLabel).frame(maxWidth: .infinity, alignment: .leading)
                            NATBadge(text: g.expired ? "失効済み" : "有効", color: g.expired ? NT.ink3 : NT.ok).frame(width: 90, alignment: .leading)
                        }
                        .font(.system(size: 15)).foregroundColor(NT.ink)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                    }
                }
            }
        }
    }

    private var takenCard: some View {
        let rows = p.taken ?? []
        return NSPCard(title: "取得履歴") {
            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    NATEmpty(title: "取得履歴はありません")
                } else {
                    NLVTableRow(cells: [("取得日", 130, false), ("区分", 70, false), ("備考", nil, false)], header: true)
                    ForEach(rows) { e in
                        NLVDivider()
                        NLVTableRow(cells: [(e.dateLabel, 130, false), (e.fractionLabel, 70, false), (e.note.isEmpty ? "—" : e.note, nil, false)])
                    }
                }
            }
        }
    }
}

// MARK: - 管理（Web の AdminTab）

struct NLVAdminSection: View {
    let p: NLVPayload
    @ObservedObject var model: NLVModel
    let openGrant: () -> Void
    let approve: (NLVPending) -> Void
    let reject: (NLVPending) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Spacer()
                NSPButton(text: "付与を登録", icon: "calendar.badge.plus", primary: true, disabled: model.busy) { openGrant() }
            }
            if !(p.pending ?? []).isEmpty { pendingCard }
            if !(p.expiringSoon ?? []).isEmpty { expiringCard }
            balanceCard
            if p.canSetPolicy, let policy = p.policy {
                NLVPolicyCard(initial: policy, submit: { await model.submit($0) })
            }
        }
    }

    private var pendingCard: some View {
        let rows = p.pending ?? []
        return NSPCard(title: "承認待ちの有給申請") {
            VStack(alignment: .leading, spacing: 0) {
                if !p.canReview {
                    Text("この申請の承認・却下は店長以上のロールのみ行えます。閲覧のみ可能です。")
                        .font(.system(size: 12.5)).foregroundColor(NT.ink3)
                        .padding(.horizontal, 18).padding(.top, 12)
                }
                NLVTableRow(cells: [("スタッフ", 150, false), ("取得日", 120, false), ("区分", 60, false), ("理由", nil, false), ("操作", 190, true)], header: true)
                ForEach(rows) { r in
                    NLVDivider()
                    HStack(spacing: 12) {
                        Text(r.staffName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1).frame(width: 150, alignment: .leading)
                        Text(r.dateLabel).font(.system(size: 15)).monospacedDigit().foregroundColor(NT.ink).frame(width: 120, alignment: .leading)
                        Text(r.fractionLabel).font(.system(size: 15)).foregroundColor(NT.ink).frame(width: 60, alignment: .leading)
                        Text(r.reason.isEmpty ? "—" : r.reason).font(.system(size: 15)).foregroundColor(NT.ink2).lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 8) {
                            Spacer(minLength: 0)
                            if p.canReview {
                                NATSmallButton(text: "承認", icon: "checkmark", tint: NT.ok, filled: true, disabled: model.busy) { approve(r) }
                                NATSmallButton(text: "却下", icon: "xmark", tint: NT.danger, filled: true, disabled: model.busy) { reject(r) }
                            }
                        }
                        .frame(width: 190)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                }
            }
        }
    }

    private var expiringCard: some View {
        let rows = p.expiringSoon ?? []
        return NSPCard(title: "失効間近（60日以内）") {
            VStack(alignment: .leading, spacing: 0) {
                NLVTableRow(cells: [("スタッフ", nil, false), ("日数", 80, true), ("失効日", 140, false)], header: true)
                ForEach(rows) { g in
                    NLVDivider()
                    HStack(spacing: 12) {
                        Text(g.staffName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).frame(maxWidth: .infinity, alignment: .leading)
                        Text(g.daysLabel).font(.system(size: 15)).monospacedDigit().foregroundColor(NT.ink).frame(width: 80, alignment: .trailing)
                        NATBadge(text: g.expiresLabel, color: NT.warn).frame(width: 140, alignment: .leading)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                }
            }
        }
    }

    private var balanceCard: some View {
        let rows = p.balances ?? []
        return NSPCard(title: "スタッフ別 残日数") {
            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    NATEmpty(title: "対象スタッフがいません")
                } else {
                    NLVTableRow(cells: [("スタッフ", nil, false), ("付与（有効分）", 120, true), ("取得", 80, true), ("失効", 80, true), ("残日数", 90, true)], header: true)
                    ForEach(rows) { b in
                        NLVDivider()
                        HStack(spacing: 12) {
                            Text(b.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(NATTime.num(b.granted))日").monospacedDigit().frame(width: 120, alignment: .trailing)
                            Text("\(NATTime.num(b.taken))日").monospacedDigit().frame(width: 80, alignment: .trailing)
                            Text("\(NATTime.num(b.expired))日").monospacedDigit().frame(width: 80, alignment: .trailing)
                            Text("\(NATTime.num(b.remaining))日").font(.system(size: 15, weight: NT.strong)).monospacedDigit()
                                .foregroundColor(b.remaining < 0 ? NT.danger : NT.ink).frame(width: 90, alignment: .trailing)
                        }
                        .font(.system(size: 15)).foregroundColor(NT.ink)
                        .padding(.horizontal, 18).padding(.vertical, 10)
                    }
                }
            }
        }
    }
}

// MARK: - 有給付与ルール（Web の LeavePolicyForm）

struct NLVPolicyCard: View {
    let submit: ([String: Any]) async -> String?
    @State private var years: String
    @State private var memo: String
    @State private var error: String?
    @State private var saving = false

    init(initial: NLVPolicy, submit: @escaping ([String: Any]) async -> String?) {
        self.submit = submit
        _years = State(initialValue: NATTime.num(initial.expiryYears))
        _memo = State(initialValue: initial.memo)
    }

    var body: some View {
        NSPCard(title: "有給付与ルール") {
            VStack(alignment: .leading, spacing: 14) {
                NATNotice(text: "法定の自動付与テーブルは専門家確認後にテンプレート提供予定です。現在は手動付与＋会社ルールメモのみ対応しています。",
                          icon: "info.circle", color: NT.warn, background: NFColor.saffronSoft)
                VStack(alignment: .leading, spacing: 6) {
                    Text("既定の失効年数").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                    NSPInput(text: $years, placeholder: "2", width: 200, keyboard: .numberPad, trailing: "年")
                    Text("「付与を登録」の失効日の既定値に使います").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("会社の有給付与ルールメモ").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                    TextField("例: 入社6ヶ月経過後に10日付与。以降は勤続年数に応じて加算（詳細は就業規則を参照）", text: $memo, axis: .vertical)
                        .lineLimit(3...8)
                        .font(.system(size: 16))
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                if let error {
                    Text(error).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger)
                }
                HStack {
                    Spacer()
                    NSPButton(text: saving ? "保存中…" : "保存する", primary: true, busy: saving) { save() }
                }
            }
            .padding(18)
        }
    }

    private func save() {
        let y = Double(years.trimmingCharacters(in: .whitespaces)) ?? 0
        if !(y > 0) {
            error = "失効年数は1以上で入力してください"
            return
        }
        error = nil
        saving = true
        let body: [String: Any] = ["type": "leavePolicy", "expiryYears": y, "memo": memo]
        Task {
            let e = await submit(body)
            saving = false
            error = e
        }
    }
}

// MARK: - 有給を申請（Web の LeaveRequestDialog）

struct NLVRequestSheet: View {
    let submit: ([String: Any]) async -> String?
    let onClose: () -> Void
    @State private var leaveDate: String
    @State private var half = false
    @State private var reason = ""
    @State private var error: String?
    @State private var saving = false

    init(today: String, submit: @escaping ([String: Any]) async -> String?, onClose: @escaping () -> Void) {
        self.submit = submit
        self.onClose = onClose
        _leaveDate = State(initialValue: today)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("取得日", selection: NATTime.dayBinding($leaveDate), displayedComponents: .date)
                        .environment(\.timeZone, NATTime.tz)
                    Picker("区分", selection: $half) {
                        Text("全休（1.0日）").tag(false)
                        Text("半休（0.5日）").tag(true)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("時間単位の有給は今後対応予定です")
                }
                Section("理由") {
                    TextField("例: 私用のため", text: $reason, axis: .vertical).lineLimit(3...6)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("有給休暇を申請")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "送信中…" : "申請する") { send() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func send() {
        if leaveDate.isEmpty {
            error = "申請日を入力してください"
            return
        }
        if reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "理由を入力してください"
            return
        }
        error = nil
        saving = true
        let fraction: Double = half ? 0.5 : 1
        let body: [String: Any] = [
            "type": "leaveRequest",
            "leaveDate": leaveDate,
            "fraction": fraction,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        Task {
            let e = await submit(body)
            saving = false
            if let e { error = e } else { onClose() }
        }
    }
}

// MARK: - 付与を登録（Web の LeaveGrantDialog）

struct NLVGrantSheet: View {
    let staff: [NATOption]
    let years: Int
    let submit: ([String: Any]) async -> String?
    let onClose: () -> Void
    @State private var profileId = ""
    @State private var days: String
    @State private var grantedOn: String
    @State private var expiresOn: String
    @State private var adjustment = false
    @State private var note = ""
    @State private var error: String?
    @State private var saving = false

    init(staff: [NATOption], years: Int, defaults: NLVGrantDefaults?, today: String,
         submit: @escaping ([String: Any]) async -> String?, onClose: @escaping () -> Void) {
        self.staff = staff
        self.years = years
        self.submit = submit
        self.onClose = onClose
        let granted = defaults?.grantedOn ?? today
        _days = State(initialValue: NATTime.num(defaults?.days ?? 10))
        _grantedOn = State(initialValue: granted)
        _expiresOn = State(initialValue: defaults?.expiresOn ?? NLVDate.addYears(granted, years))
    }

    /// 付与日を変えたら失効日も「付与日＋既定の年数」に（Web と同じ。失効日はあとから直せる）
    private var grantedBinding: Binding<String> {
        Binding(get: { grantedOn }, set: { v in
            grantedOn = v
            expiresOn = NLVDate.addYears(v, years)
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("対象スタッフ", selection: $profileId) {
                        Text("選択してください").tag("")
                        ForEach(staff) { s in Text(s.name).tag(s.id) }
                    }
                    HStack {
                        Text("付与日数")
                        Spacer()
                        TextField("10", text: $days).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 120)
                        Text("日").foregroundColor(NT.ink3)
                    }
                    Picker("理由", selection: $adjustment) {
                        Text("年次付与").tag(false)
                        Text("調整").tag(true)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    DatePicker("付与日", selection: NATTime.dayBinding(grantedBinding), displayedComponents: .date)
                        .environment(\.timeZone, NATTime.tz)
                    DatePicker("失効日", selection: NATTime.dayBinding($expiresOn), displayedComponents: .date)
                        .environment(\.timeZone, NATTime.tz)
                } footer: {
                    Text("既定値: 付与日+\(years)年（編集可）")
                }
                Section("備考") {
                    TextField("任意", text: $note, axis: .vertical).lineLimit(2...5)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("有給休暇の付与を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "登録中…" : "登録する") { send() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func send() {
        let daysNum = Double(days.trimmingCharacters(in: .whitespaces)) ?? 0
        if profileId.isEmpty {
            error = "対象スタッフを選択してください"
            return
        }
        if !(daysNum > 0) {
            error = "付与日数は0より大きい値で入力してください"
            return
        }
        error = nil
        saving = true
        let body: [String: Any] = [
            "type": "leaveGrant",
            "profileId": profileId,
            "days": daysNum,
            "grantedOn": grantedOn,
            "expiresOn": expiresOn,
            "reason": adjustment ? "adjustment" : "annual",
            "note": note,
        ]
        Task {
            let e = await submit(body)
            saving = false
            if let e { error = e } else { onClose() }
        }
    }
}
