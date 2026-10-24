import SwiftUI

// iPhone の店長・オーナー：有給休暇（/app/leave）のネイティブ（2026-10-25 Ronnie「iPhone も native に」）。
//   承認・管理（attendance.approve）… 承認待ちの有給申請（承認・却下は店長以上）・付与を登録・失効間近（60日以内）・
//                                     スタッフ別 残日数・有給付与ルール（org.settings）
//   自分の有給 … 残日数・付与（有効分）・取得・失効／有給を申請・取下げ（承認待ちのとき）／申請・付与・取得の履歴
// サーバーは iPad と同じ GET part=leave（tab=admin|mine）と POST leave…（lib/native-modules/leave.ts）。
// iPad の中身の形（NLVPayload …）・入力のシート（申請・付与）・付与ルールのカード・NATApi をそのまま使う（iPad は変えない）。
// 店長・オーナーの画面なので、はじめは「承認・管理」（権限が無ければサーバーが「自分の有給」を返す）。

// MARK: - 中身の持ち主

@MainActor
final class NPLVModel: ObservableObject {
    @Published var tab: String
    @Published var admin: NLVPayload?
    @Published var mine: NLVPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    @Published var busy = false
    @Published var loading = false

    init(tab: String?) {
        self.tab = tab == "mine" ? "mine" : "admin"
    }

    var current: NLVPayload? { tab == "admin" ? admin : mine }
    var base: NLVPayload? { admin ?? mine }
    var isApprover: Bool { base?.isApprover ?? false }
    var pendingCount: Int { admin?.pending?.count ?? 0 }

    func select(_ t: String) {
        tab = t
        Task { await load(t) }
    }

    func load() async { await load(tab) }

    func load(_ t: String) async {
        // 見本（-tenpoNativePreview phoneLeave）は読み込まない
        if NativePreview.current != nil { return }
        loading = true
        do {
            let p = try await NATApi.get(NLVPayload.self, part: "leave", ["tab": t])
            if p.tab == "admin" { admin = p } else { mine = p }
            // 管理の権限が無い人にはサーバーが「自分の有給」を返す
            if t == tab { tab = p.tab }
            error = nil
        } catch {
            let has = t == "admin" ? admin != nil : mine != nil
            if !has && t == tab { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
        loading = false
    }

    func act(_ body: [String: Any]) async {
        if NativePreview.current != nil { toast = NATToast(text: "見本のため保存しません", tone: .warn); return }
        busy = true
        let r = await NATApi.post(body)
        busy = false
        toast = NATToast.from(r)
        if r.ok { await load(tab) }
    }

    /// できたら nil（お知らせ・読み直し）、だめならことば（シートに出す）
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

// MARK: - 入口（Web の道 → 画面）

struct NativePhoneLeaveScreen: View {
    let onBack: () -> Void
    @StateObject private var model: NPLVModel

    init(route: NativeModuleRoute, onBack: @escaping () -> Void) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: NPLVModel(tab: route.query("tab")))
    }

    var body: some View {
        NativePhoneLeaveView(model: model, onBack: onBack)
    }
}

// MARK: - 画面

struct NativePhoneLeaveView: View {
    @ObservedObject var model: NPLVModel
    let onBack: () -> Void
    @State private var sheet: NLVSheet?
    @State private var approving: NLVPending?
    @State private var withdrawing: NLVRequest?
    @State private var prompt: NPReasonPrompt?

    var body: some View {
        NPWPage(
            title: "有給休暇",
            onBack: onBack,
            loaded: model.current != nil,
            error: model.error,
            toast: $model.toast,
            retry: { await model.load() },
            header: { header },
            content: { content }
        )
        .task { await model.load() }
        .sheet(item: $sheet) { s in sheetView(s) }
        .sheet(item: $prompt) { pr in
            NPReasonSheet(prompt: pr) { prompt = nil }
                .presentationDetents([.medium])
                .environment(\.colorScheme, .light)
        }
        .alert("有給申請を承認", isPresented: Binding(get: { approving != nil }, set: { if !$0 { approving = nil } }), presenting: approving) { r in
            Button("キャンセル", role: .cancel) {}
            Button("承認する") { Task { await model.act(["type": "leaveApprove", "requestId": r.id]) } }
        } message: { r in
            Text("\(r.staffName) さん \(r.dateLabel)（\(r.fractionLabel)）\n承認すると勤怠記録に有給取得として反映されます。")
        }
        .alert("申請を取り下げ", isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }), presenting: withdrawing) { r in
            Button("やめる", role: .cancel) {}
            Button("取り下げる", role: .destructive) { Task { await model.act(["type": "leaveWithdraw", "requestId": r.id]) } }
        } message: { r in
            Text("\(r.dateLabel)（\(r.fractionLabel)）の有給申請を取り下げます。")
        }
    }

    @ViewBuilder private var header: some View {
        if model.isApprover {
            NPWTabBar(tabs: [NPWTab(key: "admin", label: "承認・管理", count: model.pendingCount), NPWTab(key: "mine", label: "自分の有給")],
                      selected: model.tab) { t in model.select(t) }
        }
    }

    @ViewBuilder private var content: some View {
        if let p = model.current {
            if p.tab == "admin" { adminSection(p) } else { mineSection(p) }
        }
    }

    // MARK: 承認・管理

    @ViewBuilder private func adminSection(_ p: NLVPayload) -> some View {
        let pending = p.pending ?? []
        let expiring = p.expiringSoon ?? []
        let balances = p.balances ?? []
        NPWButton(text: "付与を登録", icon: "calendar.badge.plus", kind: .primary, disabled: model.busy, wide: true) { sheet = .grant }
        NPWSectionTitle(title: "承認待ちの有給申請", count: pending.isEmpty ? "" : "\(pending.count)件")
        if pending.isEmpty {
            NPWEmpty(icon: "checkmark.seal", title: "承認待ちの申請はありません")
        } else {
            if !p.canReview {
                Text("この申請の承認・却下は店長以上のロールのみ行えます。閲覧のみ可能です。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(pending) { r in pendingCard(r, canReview: p.canReview) }
        }
        if !expiring.isEmpty {
            NPWSectionTitle(title: "失効間近（60日以内）", count: "\(expiring.count)件")
            VStack(spacing: 0) {
                ForEach(expiring) { g in
                    if g.id != expiring.first?.id { NPWDivider(inset: 14) }
                    HStack(spacing: 10) {
                        Text(g.staffName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        Spacer(minLength: 6)
                        Text(g.daysLabel).font(.system(size: 14, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                        NATBadge(text: "\(g.expiresLabel) 失効", color: NT.warn)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 11)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
        NPWSectionTitle(title: "スタッフ別 残日数", count: balances.isEmpty ? "" : "\(balances.count)名")
        if balances.isEmpty {
            NPWEmpty(icon: "person.2", title: "対象スタッフがいません")
        } else {
            VStack(spacing: 0) {
                ForEach(balances) { b in
                    if b.id != balances.first?.id { NPWDivider(inset: 14) }
                    HStack(spacing: 10) {
                        NPWAvatar(name: b.name, size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(b.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            Text("付与 \(NATTime.num(b.granted))日 ・ 取得 \(NATTime.num(b.taken))日 ・ 失効 \(NATTime.num(b.expired))日")
                                .font(.system(size: 11.5)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                        }
                        Spacer(minLength: 6)
                        VStack(alignment: .trailing, spacing: 0) {
                            Text("\(NATTime.num(b.remaining))日").font(.system(size: 19, weight: .heavy)).monospacedDigit()
                                .foregroundColor(b.remaining < 0 ? NT.danger : NT.ink)
                            Text("残り").font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.ink3)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
        if p.canSetPolicy, let policy = p.policy {
            NLVPolicyCard(initial: policy, submit: { await model.submit($0) })
        }
    }

    private func pendingCard(_ r: NLVPending, canReview: Bool) -> some View {
        NPOCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    NPWAvatar(name: r.staffName, size: 36, color: NT.warn)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.staffName).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                        Text("\(r.dateLabel)（\(r.fractionLabel)）").font(.system(size: 13.5, weight: .bold)).monospacedDigit().foregroundColor(NT.ink2)
                    }
                    Spacer(minLength: 6)
                    NATBadge(text: "承認待ち", color: NT.warn)
                }
                Text(r.reason.isEmpty ? "理由：—" : "理由：\(r.reason)").font(.system(size: 13.5)).foregroundColor(NT.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                if canReview {
                    HStack(spacing: 10) {
                        NPWButton(text: "却下", icon: "xmark", kind: .danger, disabled: model.busy, wide: true) {
                            prompt = NPReasonPrompt(title: "有給申請を却下", message: "この申請を却下します。理由を入力してください。", confirm: "却下する") { reason in
                                await model.act(["type": "leaveReject", "requestId": r.id, "reason": reason])
                            }
                        }
                        NPWButton(text: "承認", icon: "checkmark", kind: .ok, disabled: model.busy, wide: true) { approving = r }
                    }
                }
            }
        }
    }

    // MARK: 自分の有給

    @ViewBuilder private func mineSection(_ p: NLVPayload) -> some View {
        let s = p.summary ?? NLVSummary(remaining: 0, activeGranted: 0, taken: 0, expired: 0)
        let requests = p.requests ?? []
        let grants = p.grants ?? []
        let taken = p.taken ?? []
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            NPWStat(label: "残日数", value: "\(NATTime.num(s.remaining))日", color: s.remaining < 0 ? NT.danger : NT.purple)
            NPWStat(label: "付与合計（有効分）", value: "\(NATTime.num(s.activeGranted))日")
            NPWStat(label: "取得合計", value: "\(NATTime.num(s.taken))日")
            NPWStat(label: "失効分", value: "\(NATTime.num(s.expired))日", color: s.expired > 0 ? NT.warn : NT.ink)
        }
        NPWButton(text: "有給を申請", icon: "calendar.badge.plus", kind: .primary, disabled: model.busy, wide: true) { sheet = .request }
        NPWSectionTitle(title: "有給申請", count: requests.isEmpty ? "" : "\(requests.count)件")
        if requests.isEmpty {
            NPWEmpty(icon: "calendar", title: "申請履歴はありません")
        } else {
            VStack(spacing: 0) {
                ForEach(requests) { r in
                    if r.id != requests.first?.id { NPWDivider(inset: 14) }
                    requestRow(r)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
        NPWSectionTitle(title: "付与履歴", count: grants.isEmpty ? "" : "\(grants.count)件")
        if grants.isEmpty {
            NPWEmpty(icon: "gift", title: "付与履歴はありません")
        } else {
            VStack(spacing: 0) {
                ForEach(grants) { g in
                    if g.id != grants.first?.id { NPWDivider(inset: 14) }
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(g.grantedLabel) 付与").font(.system(size: 14.5, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                            Text("\(g.reasonLabel) ・ 失効 \(g.expiresLabel)").font(.system(size: 11.5)).monospacedDigit().foregroundColor(NT.ink3)
                        }
                        Spacer(minLength: 6)
                        Text(g.daysLabel).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(g.expired ? NT.ink3 : NT.ink)
                        NATBadge(text: g.expired ? "失効済み" : "有効", color: g.expired ? NT.ink3 : NT.ok)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
        NPWSectionTitle(title: "取得履歴", count: taken.isEmpty ? "" : "\(taken.count)件")
        if taken.isEmpty {
            NPWEmpty(icon: "sun.max", title: "取得履歴はありません")
        } else {
            VStack(spacing: 0) {
                ForEach(taken) { e in
                    if e.id != taken.first?.id { NPWDivider(inset: 14) }
                    HStack(spacing: 10) {
                        Text(e.dateLabel).font(.system(size: 14.5, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                        Text(e.fractionLabel).font(.system(size: 13)).foregroundColor(NT.ink2)
                        Spacer(minLength: 6)
                        Text(e.note.isEmpty ? "—" : e.note).font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 11)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
    }

    private func requestRow(_ r: NLVRequest) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(r.dateLabel).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                Text(r.fractionLabel).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                Spacer(minLength: 6)
                NATBadge(text: r.statusLabel, color: NLVMineSection.statusColor(r.status))
            }
            if !r.reason.isEmpty {
                Text(r.reason).font(.system(size: 13)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            }
            if let note = r.rejectNote {
                Text("却下理由: \(note)").font(.system(size: 12)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
            }
            if r.canWithdraw {
                HStack {
                    Spacer()
                    NPWButton(text: "取下げ", icon: "xmark", disabled: model.busy, height: 36) { withdrawing = r }
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }

    // MARK: 入力のシート（iPad と同じもの）

    @ViewBuilder private func sheetView(_ s: NLVSheet) -> some View {
        let p = model.base
        switch s {
        case .request:
            NLVRequestSheet(today: p?.today ?? NATTime.dayFmt.string(from: Date()), submit: { await model.submit($0) }, onClose: { sheet = nil })
                .environment(\.colorScheme, .light)
        case .grant:
            NLVGrantSheet(
                staff: model.admin?.staffOptions ?? [],
                years: Int(model.admin?.defaultExpiryYears ?? 2),
                defaults: model.admin?.grantDefaults,
                today: p?.today ?? NATTime.dayFmt.string(from: Date()),
                submit: { await model.submit($0) },
                onClose: { sheet = nil }
            )
            .environment(\.colorScheme, .light)
        }
    }
}
