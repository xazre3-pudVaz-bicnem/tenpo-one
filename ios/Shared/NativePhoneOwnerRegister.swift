import SwiftUI

// iPhone の店長・オーナー：レジオープン（開局）／レジクローズ（Web の /app/cash/open・/app/cash/close。2026-10-25 Ronnie「iPhone も native に」）
// サーバーは iPad と同じ（返事の形は変えない）：GET ?part=cash ／ POST cashOpen・cashClose
//   開局：釣銭準備金を金種ごとに数える・前回のレジクローズで残した金額との過不足・違う理由・担当者 → 開局する
//   クローズ：理論在高・金種ごとの実査・差額・翌準備金／預入金・差額の理由・担当者 → クローズする（未会計・差額があると締めない。Web と同じ）
//   本日の売上・支払方法別・入出金と現金残り・出金レシート・締めたレジ
// 印刷は iPhone からはしない（精算レシートの再印刷・精算情報の紙は iPad のレジから。印刷は別のチーム）。
// クローズしたときのレジ精算レシートはサーバーがお店のプリンターへ送る（Web・iPad と同じ。iPhone は何もしない）。

/// GET ?part=cash の中身（使うところだけ）
struct NOMRegister: Decodable {
    struct Session: Decodable, Hashable, Identifiable {
        let id: String
        let registerName: String
        let businessDate: String
        let openedAt: String
        let openedByName: String?
        let openingFloat: Double
        let cashSales: Double
        let cashRefunds: Double
        let cashIn: Double
        let cashOut: Double
        let theoreticalCash: Double
    }
    struct Closed: Decodable, Hashable, Identifiable {
        let id: String
        let registerName: String
        let openedByName: String?
        let closedByName: String?
        let openedAt: String
        let closedAt: String?
        let openingFloat: Double
        let expectedCash: Double?
        let countedCash: Double?
        let difference: Double?
    }
    struct Method: Decodable, Hashable {
        let method: String
        let label: String
        let en: String?
        let count: Double
        let amount: Double
    }
    struct Move: Decodable, Hashable, Identifiable {
        let id: String
        let kind: String
        let time: String
        let main: String
        let sub: String?
        let amount: Double
    }
    struct Clerk: Decodable, Hashable, Identifiable {
        let id: String
        let name: String
        let role: String?
    }
    struct Sales: Decodable, Hashable {
        let grossSales: Double
        let refunds: Double
        let netSales: Double
        let transactionCount: Double
        let guests: Double
        let avgSpend: Double
    }
    struct CashFlow: Decodable, Hashable {
        let opening: Double
        let sales: Double
        let cashIn: Double
        let cashOut: Double
        let refunds: Double
        let remaining: Double
        let depositCount: Double
        let withdrawalCount: Double
    }
    struct Receipts: Decodable, Hashable {
        let total: Double
        let ok: Double
        let ng: Double
        let ngTotal: Double
    }
    let store: NOMNamed
    let businessDate: String
    let continuing: Bool
    let expectedOpening: Double?
    let expectedFrom: String?
    let openRegister: NOMNamed?
    let openSessions: [Session]
    let closedSessions: [Closed]
    let storeDayClosed: Bool
    let nextFloatSetting: Double?
    let openCount: Double
    let openTotal: Double
    let sales: Sales
    let byMethod: [Method]
    let paymentsCount: Double
    let paymentsTotal: Double
    let cashFlow: CashFlow
    let registerMoves: [Move]
    let registerMovesMore: Double
    let receipts: Receipts
    let clerks: [Clerk]
    let canOperate: Bool
    let canScan: Bool
    let isRegisterDevice: Bool?
}

/// 開局・クローズがすんだ（その結果を見せる）
struct NOMRegisterDone: Equatable {
    let opened: Bool
    let registerName: String
    let amount: Int
    let difference: Int
    let printWarning: String?
}

@MainActor
final class NOMRegisterModel: ObservableObject {
    @Published var payload: NOMRegister?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    /// 金種 → 枚数（入れていない金種は無い）
    @Published var counts: [Int: Int] = [:]
    /// テンキーの入れ先の金種（nil＝テンキーを閉じる）
    @Published var focus: Int?
    @Published var reason = ""
    @Published var clerk: NOMRegister.Clerk?
    @Published var done: NOMRegisterDone?
    /// "open"（/app/cash/open）／ "close"（/app/cash/close）
    let mode: String
    /// /app/cash/close で開局中のレジが無いとき、ここで開局に切り替えた
    @Published var forceOpen = false

    init(mode: String = "close") {
        self.mode = mode
    }

    var entered: Bool { NOM.denoms.contains { counts[$0] != nil } }
    var total: Int { NOM.denoms.reduce(0) { $0 + $1 * (counts[$1] ?? 0) } }
    var session: NOMRegister.Session? { payload?.openSessions.first }

    var denomJSON: [String: Int] {
        var out: [String: Int] = [:]
        for d in NOM.denoms { if let n = counts[d] { out[String(d)] = n } }
        return out
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        if payload == nil, let saved = NativeModuleAPI.cached(NOMRegister.self, part: "cash") { payload = saved }
        loading = true
        defer { loading = false }
        do {
            payload = try await NativeModuleAPI.get(NOMRegister.self, part: "cash")
            error = nil
        } catch {
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// テンキー（iPad と同じ：C＝消す、⌫＝1 けた消す、4 けたまで）
    func press(_ k: String) {
        guard let f = focus else { return }
        switch k {
        case "C": counts[f] = nil
        case "⌫":
            let s = String(counts[f].map(String.init)?.dropLast() ?? "")
            counts[f] = s.isEmpty ? nil : Int(s)
        default:
            let s = (counts[f].map { $0 == 0 ? "" : String($0) } ?? "") + k
            if s.count <= 4 { counts[f] = Int(s) }
        }
    }

    /// 次の金種へ（入れていなければ 0 枚にする。iPad と同じ）
    func next() {
        guard let f = focus, let i = NOM.denoms.firstIndex(of: f) else { focus = NOM.denoms.first; return }
        if counts[f] == nil { counts[f] = 0 }
        focus = i + 1 < NOM.denoms.count ? NOM.denoms[i + 1] : nil
    }

    func resetCount() {
        counts = [:]
        reason = ""
        focus = nil
    }

    /// 開局（iPad と同じ POST cashOpen）。nil＝できた、文字＝エラー
    func open(_ reg: NOMNamed, needsReason: Bool) async -> String? {
        busy = true
        defer { busy = false }
        let body: [String: Any] = ["type": "cashOpen", "registerId": reg.id, "denominations": denomJSON,
                                   "reason": needsReason ? reason : NSNull(), "clerkName": clerk?.name ?? NSNull()]
        let amount = total
        let r = await NOM.post(body)
        guard r.ok else { return r.error ?? "開局できませんでした" }
        let float = (r.json?["openingFloat"] as? Int) ?? (r.json?["openingFloat"] as? Double).map { Int($0) } ?? amount
        done = NOMRegisterDone(opened: true, registerName: reg.name.isEmpty ? "レジ" : reg.name, amount: float, difference: 0, printWarning: nil)
        resetCount()
        await refresh()
        return nil
    }

    /// クローズ（iPad と同じ POST cashClose）。nil＝できた、文字＝エラー。
    /// レジ端末のログアウト（signOutAfter）は iPhone ではしない（店長・オーナーのアカウントのため）
    func close(_ s: NOMRegister.Session) async -> String? {
        busy = true
        defer { busy = false }
        let body: [String: Any] = ["type": "cashClose", "sessionId": s.id, "denominations": denomJSON,
                                   "reason": reason.isEmpty ? NSNull() : reason, "clerkName": clerk?.name ?? NSNull()]
        let amount = total
        let r = await NOM.post(body)
        guard r.ok else { return r.error ?? "クローズできませんでした" }
        let warning = r.json?["printWarning"] as? String
        done = NOMRegisterDone(opened: false, registerName: s.registerName, amount: amount, difference: amount - Int(s.theoreticalCash.rounded()), printWarning: warning)
        resetCount()
        await refresh()
        return nil
    }
}

// MARK: - 画面

struct NativePhoneOwnerRegisterView: View {
    @ObservedObject var model: NOMRegisterModel
    let onBack: () -> Void
    let onOpen: (String) -> Void

    @State private var clerkPick = false
    @State private var problems: [String] = []
    @State private var problemOpen = false
    @State private var summaryOpen = false
    /// クローズの最後の確認（iPhone はお店の外から押せるので、必ず聞く）
    @State private var confirmCloseSession: NOMRegister.Session?

    private var p: NOMRegister? { model.payload }
    /// 開局の画面か（開局中のレジが無い。/app/cash/close で開いたときは「開局中のレジはありません」を先に出す）
    private var isOpenMode: Bool { model.session == nil && (model.mode != "close" || model.forceOpen) }

    private var title: String {
        if let d = model.done { return d.opened ? "レジオープン" : "レジクローズ" }
        if model.session != nil { return "レジクローズ" }
        return isOpenMode ? "レジオープン" : "レジクローズ"
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: title, subtitle: p?.store.name ?? (isOpenMode ? "Open register" : "Close register"), onBack: onBack, trailing: {
                NOMRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        if let d = model.done {
                            doneView(d, p)
                        } else {
                            main(p)
                        }
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            if model.focus != nil && model.payload != nil && model.done == nil {
                keypadPanel.transition(.move(edge: .bottom))
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .animation(.easeOut(duration: 0.2), value: model.focus)
        .task { await model.refresh() }
        .sheet(isPresented: $clerkPick) {
            NOMPickSheet(title: isOpenMode ? "レジ開局の担当者" : "レジクローズの担当者",
                         items: (p?.clerks ?? []).map { (id: $0.id, name: $0.name, sub: $0.role ?? "") },
                         selected: model.clerk?.id,
                         onPick: { id in
                             model.clerk = p?.clerks.first { $0.id == id }
                             clerkPick = false
                         },
                         onClose: { clerkPick = false })
                .presentationDetents([.medium, .large])
                .environment(\.colorScheme, .light)
        }
        .alert(isOpenMode ? "レジ開局できません" : "レジクローズできません", isPresented: $problemOpen) {
            if model.clerk == nil && !(p?.clerks.isEmpty ?? true) { Button("担当者を選ぶ") { clerkPick = true } }
            Button("OK", role: .cancel) {}
        } message: {
            Text(problems.joined(separator: "\n\n"))
        }
        .confirmationDialog("このレジをクローズしますか？", isPresented: Binding(get: { confirmCloseSession != nil }, set: { if !$0 { confirmCloseSession = nil } }), titleVisibility: .visible) {
            Button("クローズする", role: .destructive) {
                guard let s = confirmCloseSession else { return }
                confirmCloseSession = nil
                Task {
                    if let e = await model.close(s) {
                        problems = [e]
                        problemOpen = true
                    }
                }
            }
            Button("やめる", role: .cancel) { confirmCloseSession = nil }
        } message: {
            Text("クローズすると、このレジでは会計できなくなり、レジ精算レシートがお店のプリンターへ送られます。")
        }
    }

    // MARK: 中身

    private func main(_ p: NOMRegister) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    if isOpenMode {
                        openSection(p)
                    } else if let s = model.session {
                        closeSection(p, s)
                    } else {
                        emptySection(p)
                    }
                    ForEach(p.closedSessions) { c in closedCard(c, p) }
                    if !isOpenMode { storeDayLink }
                    // テンキーの下に隠れないように
                    Color.clear.frame(height: model.focus != nil ? 330 : 24)
                }
                .padding(.horizontal, 12).padding(.top, 10)
            }
            .refreshable { await model.refresh() }
            .onChange(of: model.focus) { f in
                guard let f else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("denom-\(f)", anchor: .center) }
            }
        }
    }

    // MARK: 開局（Web の RegisterOpenCard）

    @ViewBuilder private func openSection(_ p: NOMRegister) -> some View {
        if p.openRegister == nil {
            NOMEmpty(icon: "lock.slash", title: "レジがまだ登録されていません", sub: "Web の管理画面の 設定 › デバイス管理 でレジ（レシートプリンター）を登録すると、ここで開局できます。")
        } else if !p.canOperate {
            NOMEmpty(icon: "person.badge.key", title: "レジを開局する権限がありません", sub: "レジ担当（register.operate）の権限が必要です。店長に開局してもらってください。")
        } else if let reg = p.openRegister {
            let expected = p.expectedOpening.map { Int($0.rounded()) }
            let diff = expected.map { model.total - $0 }
            let needsReason = model.entered && expected != nil && (diff ?? 0) != 0
            NOMNote(text: "釣銭準備金（レジに入っている現金）を金種ごとに数えて枚数を入れます。合計がそのまま釣銭準備金になります。")
            counterCard(title: "釣銭準備金を数える", en: "Opening cash")
            if let e = expected {
                VStack(spacing: 8) {
                    kv("前回のレジクローズで残した金額\(p.expectedFrom.map { "（\(NOS.md($0))）" } ?? "")", NT.yen(e))
                    HStack {
                        Text("過不足").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
                        Spacer()
                        Text(!model.entered || diff == nil ? "—" : diff == 0 ? "±¥0（合っています）" : NOM.signed(Double(diff ?? 0)))
                            .font(.system(size: 17, weight: .heavy)).monospacedDigit()
                            .foregroundColor(!model.entered ? NT.ink3 : diff == 0 ? NT.ok : NT.danger)
                    }
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            }
            if needsReason { reasonField("違う理由（必須）", placeholder: "例：昨日の締めのあと両替した／本部に持って行った") }
            clerkLine(open: true, p)
            NOMButton(title: model.busy ? "開局中…" : "開局する（\(NT.yen(model.total))）", icon: "lock.open", height: 58,
                      enabled: !model.busy && model.entered && !(needsReason && model.reason.trimmingCharacters(in: .whitespaces).isEmpty)) {
                Task { await doOpen(p, reg, needsReason: needsReason) }
            }
        }
    }

    private func doOpen(_ p: NOMRegister, _ reg: NOMNamed, needsReason: Bool) async {
        var list: [String] = []
        if !model.entered { list.append("釣銭準備金を金種ごとに数えて枚数を入力してください（0円のときは1円に0と入れてください）") }
        if needsReason && model.reason.trimmingCharacters(in: .whitespaces).isEmpty { list.append("前回のレジクローズで残した金額と違います。違う理由を入れてください") }
        if model.clerk == nil && !p.clerks.isEmpty { list.append("レジ開局の担当者を選んでください") }
        if !list.isEmpty { problems = list; problemOpen = true; return }
        model.focus = nil
        if let e = await model.open(reg, needsReason: needsReason) {
            problems = [e]
            problemOpen = true
        }
    }

    // MARK: クローズ（Web の RegisterCountCard）

    @ViewBuilder private func closeSection(_ p: NOMRegister, _ s: NOMRegister.Session) -> some View {
        let theoretical = Int(s.theoreticalCash.rounded())
        let diff: Int? = model.entered ? model.total - theoretical : nil
        let needsReason = diff != nil && diff != 0
        Group {
            if s.businessDate != p.businessDate {
                NOMNote(text: "このレジは \(NOM.slash(s.businessDate)) の営業日から開いたままです。先にこのレジを締めてください（締めるまで、このレジは新しく開局できません）。", tint: NT.warn)
            }
            if p.openSessions.count > 1 {
                NOMNote(text: "開局中のレジが \(p.openSessions.count) 台あります。1 台ずつクローズします（いまは「\(s.registerName)」）。")
            }
        }
        // 理論在高
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("理論在高").font(.system(size: 12.5, weight: .bold)).foregroundColor(.white.opacity(0.85))
                Spacer()
                Text(s.registerName).font(.system(size: 11.5, weight: .bold)).foregroundColor(.white.opacity(0.8)).lineLimit(1)
            }
            Text(NOS.yen(s.theoreticalCash)).font(.system(size: 32, weight: .heavy)).foregroundColor(.white).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
            Text("釣銭準備金 ＋ 現金売上 ＋ 入金 − 出金 − 現金返金").font(.system(size: 11)).foregroundColor(.white.opacity(0.8))
            Text("\(NOS.yen(s.openingFloat)) ＋ \(NOS.yen(s.cashSales)) ＋ \(NOS.yen(s.cashIn)) − \(NOS.yen(s.cashOut))\(s.cashRefunds > 0 ? " − \(NOS.yen(s.cashRefunds))" : "")")
                .font(.system(size: 11)).foregroundColor(.white.opacity(0.8)).monospacedDigit().lineLimit(2).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
        counterCard(title: "実査額（数えた現金）", en: "Cash count")
        differenceCard(p, s, diff: diff)
        if needsReason { reasonField("差額の理由（必須）", placeholder: "例：釣銭の渡し間違い／レシートのない出金") }
        blockers(p, diff: diff)
        clerkLine(open: false, p)
        if p.canOperate {
            NOMButton(title: model.busy ? "クローズ中…" : "レジをクローズする", icon: "lock", tint: needsReason ? NT.danger : NT.purple, height: 58, enabled: !model.busy) {
                Task { await doClose(p, s) }
            }
            Text("クローズすると、本日の売上・支払方法別・現金精算・入出金をまとめたレジ精算レシートがお店のレシートプリンターへ送られます。再印刷はレジ（iPad）の画面から。")
                .font(.system(size: 11)).foregroundColor(NT.ink3).multilineTextAlignment(.center).frame(maxWidth: .infinity)
        } else {
            Text("レジ操作の権限がありません").font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity)
        }
        summary(p)
    }

    private func differenceCard(_ p: NOMRegister, _ s: NOMRegister.Session, diff: Int?) -> some View {
        let target = Int((p.nextFloatSetting ?? s.openingFloat).rounded())
        let nextFloat = min(model.total, target)
        let deposit = model.total - nextFloat
        let shortage = max(0, target - model.total)
        return VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("差額").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(diff.map { NOM.signed(Double($0)) } ?? "—")
                    .font(.system(size: 26, weight: .heavy)).monospacedDigit()
                    .foregroundColor(diff == nil ? NT.ink3 : diff == 0 ? NT.ok : NT.danger)
            }
            Rectangle().fill(NT.line).frame(height: 1)
            kv("翌準備金（明日レジに残す）", model.entered ? NT.yen(nextFloat) : "—")
            kv("預入金（銀行・預り金へ）", model.entered ? NT.yen(deposit) : "—", color: model.entered && deposit > 0 ? NT.purpleDeep : NT.ink)
            if model.entered && shortage > 0 { kv("準備金不足（マイナス）", "−\(NT.yen(shortage))", color: NT.danger) }
            Text("目標 \(NT.yen(target))（\(p.nextFloatSetting != nil && p.nextFloatSetting != s.openingFloat ? "店舗設定" : "今日の釣銭準備金と同じ")）")
                .font(.system(size: 11)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    /// クローズできない理由（Web と同じ：未会計・未入力・差額・担当者）
    @ViewBuilder private func blockers(_ p: NOMRegister, diff: Int?) -> some View {
        let unpaid = p.openCount > 0
        let noClerk = model.clerk == nil && !p.clerks.isEmpty
        if unpaid || !model.entered || (diff ?? 0) != 0 || noClerk {
            VStack(alignment: .leading, spacing: 8) {
                if unpaid {
                    blockerLine("未会計の伝票が\(NOS.int(p.openCount))件（\(NOS.yen(p.openTotal))）あります。すべて会計するか取消してください", link: "未会計を見る") {
                        onOpen("/app/orders?status=open")
                    }
                }
                if !model.entered { blockerLine("金種ごとの枚数を入れてください", link: nil) {} }
                if let d = diff, d != 0 {
                    blockerLine("実査額が理論在高と \(NT.yen(abs(d))) \(d > 0 ? "多い" : "少ない")です。数え直すか、差額を入出金に記録して合わせてください", link: "入出金へ") {
                        onOpen("/app/cash")
                    }
                }
                if noClerk { blockerLine("レジクローズの担当者を選んでください", link: "担当者を選ぶ") { clerkPick = true } }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.dangerBg))
        }
    }

    private func blockerLine(_ text: String, link: String?, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.circle.fill").font(.system(size: 13, weight: .bold))
                Text(text).font(.system(size: 13, weight: .bold)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundColor(NT.danger)
            if let link {
                Button(action: action) {
                    Text("\(link) ›").font(.system(size: 12.5, weight: .heavy)).foregroundColor(NT.purpleDeep)
                }
                .buttonStyle(.plain)
                .padding(.leading, 19)
            }
        }
    }

    private func doClose(_ p: NOMRegister, _ s: NOMRegister.Session) async {
        var list: [String] = []
        let diff = model.entered ? model.total - Int(s.theoreticalCash.rounded()) : nil
        if p.openCount > 0 { list.append("未会計の伝票が\(NOS.int(p.openCount))件あります。すべて会計するか取消してからクローズしてください。") }
        if !model.entered {
            list.append("金種ごとの枚数を入れてください（0円のときは1円に0と入れてください）。")
        } else if let d = diff, d != 0 {
            list.append("数えた現金が理論在高より \(NT.yen(abs(d))) \(d > 0 ? "多い" : "少ない")です。数え直すか、差額を入出金に記録して合わせてください。")
        }
        if model.clerk == nil && !p.clerks.isEmpty { list.append("レジクローズの担当者を選んでください。") }
        if !list.isEmpty { problems = list; problemOpen = true; return }
        model.focus = nil
        confirmCloseSession = s
    }

    private func emptySection(_ p: NOMRegister) -> some View {
        VStack(spacing: 10) {
            NOMEmpty(icon: "lock.open", title: "開局中のレジはありません",
                     sub: p.closedSessions.isEmpty ? "開局すると、現金実査とクローズができます。" : "レジ精算ずみです。レジ精算がすむと営業日完了になります。")
            if p.canOperate && p.openRegister != nil {
                NOMButton(title: "レジを開局する", icon: "lock.open", filled: false) { model.forceOpen = true }
            }
        }
    }

    // MARK: 金種を数える

    private func counterCard(title: String, en: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                NOMTitle(ja: title, en: en)
                Spacer()
                if model.entered {
                    Button { model.resetCount() } label: {
                        Text("クリア").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            ForEach(NOM.denoms, id: \.self) { d in
                denomRow(d).id("denom-\(d)")
            }
            HStack(alignment: .firstTextBaseline) {
                Text("合計").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(NT.yen(model.total)).font(.system(size: 26, weight: .heavy)).foregroundColor(model.entered ? NT.purpleDeep : NT.ink3).monospacedDigit()
            }
            .padding(.horizontal, 14).frame(height: 56)
            .background(NT.lilac)
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func denomRow(_ d: Int) -> some View {
        let on = model.focus == d
        let n = model.counts[d]
        return Button { model.focus = d } label: {
            HStack(spacing: 10) {
                Text(NOM.denomLabel(d)).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).frame(width: 84, alignment: .leading)
                HStack(spacing: 2) {
                    Text(n.map(String.init) ?? "0").font(.system(size: 19, weight: .heavy)).monospacedDigit()
                        .foregroundColor(n == nil ? NT.ink3 : NT.ink)
                    Text("枚").font(.system(size: 11)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 10).frame(width: 96, height: 38, alignment: .trailing)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? Color.white : NT.page))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? NT.purple : Color.clear, lineWidth: 2))
                Spacer(minLength: 4)
                Text((n ?? 0) == 0 ? "—" : NT.yen(d * (n ?? 0))).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 14).frame(height: 50)
            .background(on ? NT.lilac.opacity(0.6) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    /// 下に出すテンキー（金種の枚数）
    private var keypadPanel: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"]
        return VStack(spacing: 8) {
            HStack {
                Text(model.focus.map { "\(NOM.denomLabel($0)) の枚数" } ?? "").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Button { model.focus = nil } label: {
                    Text("閉じる").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink2)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Capsule().fill(NT.page))
                }
                .buttonStyle(PressableStyle())
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(keys, id: \.self) { k in
                    Button { model.press(k) } label: {
                        Group {
                            if k == "⌫" { Image(systemName: "delete.left").font(.system(size: 19, weight: .bold)) } else { Text(k).font(.system(size: 21, weight: .bold)) }
                        }
                        .foregroundColor(k == "C" ? NT.danger : NT.ink)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            Button { model.next() } label: {
                Text(model.focus == NOM.denoms.last ? "完了" : "次へ / Next").font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 10)
        .background(
            Color.white
                .shadow(color: Color.black.opacity(0.12), radius: 10, y: -2)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: 本日の売上・支払方法別・入出金・現金残り

    @ViewBuilder private func summary(_ p: NOMRegister) -> some View {
        Button { withAnimation(.easeOut(duration: 0.2)) { summaryOpen.toggle() } } label: {
            HStack {
                NOMTitle(ja: p.continuing ? "\(NOS.md(p.businessDate)) の営業日の売上" : "本日の売上・入出金", en: "Today")
                Spacer()
                Text(NOS.yen(p.sales.grossSales)).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                Image(systemName: summaryOpen ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
        .buttonStyle(.plain)
        if summaryOpen {
            salesCard(p)
            methodCard(p)
            cashFlowCard(p)
        }
        receiptNote(p)
    }

    private func salesCard(_ p: NOMRegister) -> some View {
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return NPOCard(title: "売上（会計済）", trailing: p.openCount > 0 ? "未会計 \(NOS.int(p.openCount))卓 \(NOS.yen(p.openTotal))" : "未会計はありません") {
            LazyVGrid(columns: cols, spacing: 8) {
                NOMStat(label: "売上合計（税込）", value: NOS.yen(p.sales.grossSales), sub: p.sales.refunds > 0 ? "返金 −\(NOS.yen(p.sales.refunds)) ／ 純売上 \(NOS.yen(p.sales.netSales))" : "")
                NOMStat(label: "会計件数", value: "\(NOS.int(p.sales.transactionCount))件")
                NOMStat(label: "客数", value: "\(NOS.int(p.sales.guests))名")
                NOMStat(label: "客単価", value: NOS.yen(p.sales.avgSpend))
            }
        }
    }

    private func methodCard(_ p: NOMRegister) -> some View {
        NPOCard(title: "支払方法別", trailing: "\(NOS.int(p.paymentsCount))件") {
            if p.byMethod.isEmpty {
                Text("まだ支払いはありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(p.byMethod, id: \.method) { m in
                HStack {
                    Text(m.label).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink)
                    Spacer()
                    Text("\(NOS.int(m.count))件").font(.system(size: 12)).foregroundColor(NT.ink3)
                    Text(NOS.yen(m.amount)).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().frame(minWidth: 90, alignment: .trailing)
                }
            }
            Rectangle().fill(NT.line).frame(height: 1)
            HStack {
                Text("合計").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(NOS.yen(p.paymentsTotal)).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
        }
    }

    private func cashFlowCard(_ p: NOMRegister) -> some View {
        let c = p.cashFlow
        return NPOCard(title: "入出金・現金残り") {
            kv("レジオープン金額", NOS.yen(c.opening))
            kv("現金売上", "＋\(NOS.yen(c.sales))")
            kv("入金（\(NOS.int(c.depositCount))件）", "＋\(NOS.yen(c.cashIn))")
            kv("出金（\(NOS.int(c.withdrawalCount))件）", "−\(NOS.yen(c.cashOut))")
            if c.refunds > 0 { kv("現金返金", "−\(NOS.yen(c.refunds))") }
            Rectangle().fill(NT.line).frame(height: 1)
            HStack {
                Text("現金残り").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(NOS.yen(c.remaining)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
            if !p.registerMoves.isEmpty {
                ForEach(p.registerMoves) { m in
                    HStack(spacing: 8) {
                        Text(NOM.hm(m.time)).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit()
                        VStack(alignment: .leading, spacing: 1) {
                            Text(m.main).font(.system(size: 13)).foregroundColor(NT.ink).lineLimit(1)
                            if let s = m.sub, !s.isEmpty { Text(s).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                        }
                        Spacer()
                        Text("\(m.kind == "deposit" ? "＋" : "−")\(NOS.yen(m.amount))").font(.system(size: 13, weight: .bold)).monospacedDigit()
                            .foregroundColor(m.kind == "deposit" ? NT.ok : NT.ink)
                    }
                }
                if p.registerMovesMore > 0 {
                    Button { onOpen("/app/cash") } label: {
                        Text("ほか \(NOS.int(p.registerMovesMore))件（入出金の画面で見る ›）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purpleDeep)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func receiptNote(_ p: NOMRegister) -> some View {
        if p.receipts.ng > 0 {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("レシートのない出金・未精算の仮払いが \(NOS.int(p.receipts.ng))件（\(NOS.yen(p.receipts.ngTotal))）あります。現金差額の原因になります")
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                if p.canScan {
                    NOMSmallButton(title: "レシートを撮る（スキャン）", filled: true) { onOpen("/app/scan") }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.dangerBg))
        } else if p.receipts.total > 0 {
            Label("本日の出金 \(NOS.int(p.receipts.ok))件すべてにレシートがあります", systemImage: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ok)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.ok.opacity(0.1)))
        }
    }

    // MARK: 締めたレジ（再印刷は iPad のレジから）

    private func closedCard(_ c: NOMRegister.Closed, _ p: NOMRegister) -> some View {
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.registerName).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                    Text(closedLine(c)).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    NOSBadge(text: "レジ締め済み", color: NT.ink2)
                    NOSBadge(text: p.storeDayClosed ? "店舗日次締め済み" : "店舗日次締めが未実施", color: p.storeDayClosed ? NT.ok : NT.warn)
                }
            }
            LazyVGrid(columns: cols, spacing: 8) {
                NOMStat(label: "釣銭準備金", value: NOS.yen(c.openingFloat))
                NOMStat(label: "理論現金", value: c.expectedCash.map { NOS.yen($0) } ?? "—")
                NOMStat(label: "実現金", value: c.countedCash.map { NOS.yen($0) } ?? "—")
                NOMStat(label: "差異", value: c.difference.map { NOM.signed($0) } ?? "—", tone: (c.difference ?? 0) != 0 ? NT.danger : NT.ink)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    /// 開局 17:02・山田 太郎｜締め 23:10・佐藤 花子
    private func closedLine(_ c: NOMRegister.Closed) -> String {
        var s = "開局 \(NOM.hm(c.openedAt))"
        if let by = c.openedByName, !by.isEmpty { s += "・\(by)" }
        if let at = c.closedAt { s += "｜締め \(NOM.hm(at))" }
        if let by = c.closedByName, !by.isEmpty { s += "・\(by)" }
        return s
    }

    // MARK: できた

    private func doneView(_ d: NOMRegisterDone, _ p: NOMRegister) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 54, weight: .bold)).foregroundColor(NT.ok)
                    Text(d.opened ? "\(d.registerName)を開局しました" : "\(d.registerName)をクローズしました").font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink)
                        .multilineTextAlignment(.center)
                    Text(d.opened ? "釣銭準備金 \(NT.yen(d.amount))" : "実査額 \(NT.yen(d.amount))（差額 \(NOM.signed(Double(d.difference)))）")
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                    if !d.opened {
                        Text(d.printWarning ?? "レジ精算レシートをお店のレシートプリンターへ送りました。")
                            .font(.system(size: 12.5, weight: d.printWarning == nil ? .regular : .bold))
                            .foregroundColor(d.printWarning == nil ? NT.ink3 : NT.warn)
                            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, 26).padding(.horizontal, 16)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
                if d.opened {
                    NOMButton(title: "入出金へ", icon: "yensign.circle") { onOpen("/app/cash") }
                } else {
                    NOMButton(title: "締め履歴を見る", icon: "list.bullet.rectangle") { onOpen("/app/cash?tab=closings") }
                    if model.session != nil {
                        NOMButton(title: "ほかのレジもクローズする", icon: "lock", filled: false) { model.done = nil }
                    }
                }
                NOMButton(title: "ホームへ戻る", icon: "house", filled: false, action: onBack)
                if !d.opened { storeDayLink }
            }
            .padding(.horizontal, 12).padding(.top, 16).padding(.bottom, 40)
        }
    }

    /// 店舗日次締め・売上の内訳もネイティブで（NativePhoneOwnerStoreDay.swift。レジ精算のプレビュー・再印刷は iPad のレジから）
    private var storeDayLink: some View {
        NOMStoreDayLink(onOpen: onOpen)
    }

    // MARK: 部品

    private func kv(_ label: String, _ value: String, color: Color = NT.ink) -> some View {
        HStack {
            Text(label).font(.system(size: 13.5, weight: .semibold)).foregroundColor(color == NT.danger ? NT.danger : NT.ink2).lineLimit(2)
            Spacer(minLength: 6)
            Text(value).font(.system(size: 15, weight: .heavy)).foregroundColor(color).monospacedDigit()
        }
    }

    private func reasonField(_ label: String, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
            TextField(placeholder, text: $model.reason, axis: .vertical)
                .lineLimit(2...4)
                .font(.system(size: 16))
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.danger.opacity(0.4), lineWidth: 1))
        }
    }

    @ViewBuilder private func clerkLine(open: Bool, _ p: NOMRegister) -> some View {
        if !p.clerks.isEmpty {
            Button { clerkPick = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 22)).foregroundColor(model.clerk == nil ? NT.ink3 : NT.purple)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(open ? "レジ開局の担当者" : "レジクローズの担当者").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3)
                        Text(model.clerk?.name ?? "担当者を選んでください").font(.system(size: 15.5, weight: .heavy)).foregroundColor(model.clerk == nil ? NT.danger : NT.ink)
                    }
                    Spacer()
                    Text(model.clerk == nil ? "選ぶ" : "変更").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep)
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 14).frame(height: 60)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            }
            .buttonStyle(PressableStyle(scale: 0.985))
        }
    }
}

// MARK: - key "cashClose" の画面（/app/cash/open・/app/cash/close。NativePhoneOwnerScreen から）

struct NativePhoneOwnerRegisterScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NOMRegisterModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NOMRegisterModel(mode: route.url.path.hasSuffix("/open") ? "open" : "close"))
    }

    var body: some View {
        NativePhoneOwnerRegisterView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "cashClose", useWeb: model.useWeb, state: state))
    }
}
