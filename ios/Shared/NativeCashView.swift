import SwiftUI

// レジ開局・レジクローズ（ネイティブ）。2026-10-24 Ronnie「レジの画面は全部ネイティブに。機能と言葉は Web の iPad と同じ」
//   Web の /app/cash/open（RegisterOpenCard）と /app/cash/close のレジの iPad（RegisterCountCard・本日の売上・支払方法別・入出金・現金残り・締めたレジの再印刷）と同じ
//   読み込み GET ?part=cash、操作 POST cashOpen / cashClose / cashReprint / cashSettlement / cashSignOut

struct NCSession: Codable, Identifiable {
    let id: String
    let registerName: String
    let businessDate: String
    let openedAt: String
    let openedByName: String
    let openingFloat: Int
    let cashSales: Int
    let cashRefunds: Int
    let cashIn: Int
    let cashOut: Int
    let theoreticalCash: Int
}

struct NCClosed: Codable, Identifiable {
    let id: String
    let registerName: String
    let openedByName: String
    let closedByName: String
    let openedAt: String
    let closedAt: String?
    let openingFloat: Int
    let expectedCash: Int?
    let countedCash: Int?
    let difference: Int?
}

struct NCMethod: Codable, Identifiable { var id: String { method }; let method: String; let label: String; let en: String; let count: Int; let amount: Int }
struct NCMove: Codable, Identifiable { let id: String; let kind: String; let time: String; let main: String; let sub: String?; let amount: Int }
struct NCClerk: Codable, Identifiable, Hashable { let id: String; let name: String; let role: String }
/// レジの履歴（lib/register-history.ts の RegisterHistoryRow）。古いサーバーは送らない（nil）
struct NCHistory: Codable, Identifiable {
    let id: String
    let registerName: String
    let businessDate: String
    let status: String
    let openedAt: String
    let closedAt: String?
    let openedByName: String
    let closedByName: String
    let difference: Int?
    var isOpen: Bool { status == "open" }
}

struct NCPayload: Codable {
    struct Sales: Codable { let grossSales: Int; let refunds: Int; let netSales: Int; let transactionCount: Int; let guests: Int; let avgSpend: Int }
    struct CashFlow: Codable { let opening: Int; let sales: Int; let cashIn: Int; let cashOut: Int; let refunds: Int; let remaining: Int; let depositCount: Int; let withdrawalCount: Int }
    struct Receipts: Codable { let total: Int; let ok: Int; let ng: Int; let ngTotal: Int }
    struct Reg: Codable { let id: String; let name: String }
    let store: NFNamed
    let businessDate: String
    let continuing: Bool
    let expectedOpening: Int?
    let expectedFrom: String?
    let openRegister: Reg?
    let openSessions: [NCSession]
    let closedSessions: [NCClosed]
    let storeDayClosed: Bool
    let nextFloatSetting: Int?
    let openCount: Int
    let openTotal: Int
    let sales: Sales
    let byMethod: [NCMethod]
    let paymentsCount: Int
    let paymentsTotal: Int
    let cashFlow: CashFlow
    let registerMoves: [NCMove]
    let registerMovesMore: Int
    let receipts: Receipts
    let clerks: [NCClerk]
    let canOperate: Bool
    let canScan: Bool
    let isRegisterDevice: Bool
    /// レジの履歴（14 日分＋開いたままのもの）。前の営業日に締められなかったレジ・精算レシートの出し直し（2026-10-26 Ronnie「履歴 ma gayera hijo ko レジ決算・決算レポート」）
    let history: [NCHistory]?
    /// 時計の営業日（これより前の日の開いたままのレジ＝締め忘れ）
    let clock: String?
}

struct NCActionResult: Decodable {
    let ok: Bool
    let error: String?
    let openingFloat: Int?
    let printWarning: String?
    let signOutAfter: Bool?
}

/// 金種（レジのトレイの順。Web の CASH_DENOMINATIONS と同じ）
let NC_DENOMS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000]
func ncDenomLabel(_ d: Int) -> String {
    switch d {
    case 1000: return "千円札"
    case 5000: return "五千円札"
    case 10000: return "一万円札"
    default: return "\(d)円"
    }
}
private func ncMd(_ date: String?) -> String {
    guard let d = date else { return "" }
    let p = d.split(separator: "-").compactMap { Int($0) }
    return p.count == 3 ? "\(p[1])/\(p[2])" : d
}
private func ncTime(_ iso: String) -> String {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let d else { return "" }
    let o = DateFormatter(); o.timeZone = TimeZone(identifier: "Asia/Tokyo"); o.dateFormat = "HH:mm"
    return o.string(from: d)
}

@MainActor
final class NativeCashModel: ObservableObject {
    @Published var payload: NCPayload?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func refresh(silent: Bool = false) async {
        if !silent { loading = true }
        defer { loading = false }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "cash")]
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NCPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NCPayload.self, from: data)
            error = nil
        } catch {
            if !silent || payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    func act(_ body: [String: Any]) async -> NCActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.ledgerPost(body, as: NCActionResult.self)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return nil }
            return r
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

// MARK: - 画面

struct NativeCashView: View {
    @ObservedObject var model: NativeCashModel
    /// "open" = 開局画面（朝） / "close" = レジクローズ
    let mode: String
    let onHome: () -> Void
    let onOpened: () -> Void
    let onWeb: (String) -> Void
    let onSignedOut: () -> Void

    @State private var counts: [Int: Int] = [:]
    @State private var focus: Int? = 1
    @State private var reason = ""
    @State private var clerk: NCClerk?
    @State private var clerkPick = false
    @State private var problems: [(String, String)] = []
    @State private var problemOpen = false

    private var p: NCPayload? { model.payload }
    private var entered: Bool { NC_DENOMS.contains { counts[$0] != nil } }
    private var total: Int { NC_DENOMS.reduce(0) { $0 + $1 * (counts[$1] ?? 0) } }
    private var session: NCSession? { p?.openSessions.first }
    private var isOpenMode: Bool { session == nil }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: isOpenMode ? "レジ開局" : "レジクローズ", subtitle: isOpenMode ? "Open register" : "Close register", userName: clerk?.name ?? "", onHome: onHome)
            if let p {
                GeometryReader { geo in
                    ScrollView {
                        let wide = geo.size.width >= 1000
                        let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
                        layout {
                            VStack(spacing: 14) {
                                if isOpenMode { openCard(p) } else if let s = session { closeCard(p, s) } else { emptyCard(p) }
                                if let h = p.history, !h.isEmpty { historyCard(p, h) }
                            }
                            .frame(maxWidth: wide ? geo.size.width * 0.54 : .infinity)
                            if !isOpenMode || !p.closedSessions.isEmpty {
                                VStack(spacing: 14) {
                                    if !isOpenMode {
                                        salesCard(p)
                                        methodCard(p)
                                        cashFlowCard(p)
                                        receiptNote(p)
                                    }
                                    ForEach(p.closedSessions) { c in closedCard(c, storeDayClosed: p.storeDayClosed, canOperate: p.canOperate) }
                                }
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .padding(16)
                    }
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        Button("もう一度") { Task { await model.refresh() } }
                    }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e).multilineTextAlignment(.leading); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft)).frame(maxWidth: 720)
                }
                .buttonStyle(.plain).padding(.top, 74)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NFColor.navy.opacity(0.92))).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 3_000_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .confirmationDialog(isOpenMode ? "レジ開局の担当者を選んでください" : "レジクローズの担当者を選んでください", isPresented: $clerkPick, titleVisibility: .visible) {
            ForEach(p?.clerks ?? []) { c in Button(c.name) { clerk = c } }
            Button("キャンセル", role: .cancel) {}
        }
        .alert(isOpenMode ? "レジ開局できません / Cannot open" : "レジクローズできません / Cannot close the register", isPresented: $problemOpen) {
            if clerk == nil && !(p?.clerks.isEmpty ?? true) { Button("担当者を選ぶ / Select staff") { clerkPick = true } }
            Button("OK", role: .cancel) {}
        } message: {
            Text(problems.map { "\($0.0)\n\($0.1)" }.joined(separator: "\n\n"))
        }
        .task { await model.refresh() }
    }

    // MARK: 金種の数え（右にテンキー。Web と同じく iPad のキーボードは出さない）

    private func counter(columns: Int) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                HStack {
                    Text("金種").frame(maxWidth: .infinity, alignment: .leading)
                    Text("枚数").frame(width: 90, alignment: .trailing)
                    Text("金額").frame(width: 96, alignment: .trailing)
                }
                .font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink2)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(NFColor.lilacSoft)
                ForEach(NC_DENOMS, id: \.self) { d in
                    let on = focus == d
                    Button { focus = d } label: {
                        HStack {
                            Text(ncDenomLabel(d)).font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink).frame(maxWidth: .infinity, alignment: .leading)
                            HStack(spacing: 2) {
                                Text(counts[d].map(String.init) ?? "0").font(.system(size: 18, weight: .heavy)).monospacedDigit()
                                    .foregroundColor(counts[d] == nil ? NFColor.ink3 : NFColor.ink)
                                Text("枚").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 8).frame(width: 90, height: 36, alignment: .trailing)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? NFColor.iris : NFColor.line, lineWidth: on ? 2 : 1))
                            Text((counts[d] ?? 0) == 0 ? "—" : NT.yen(d * (counts[d] ?? 0))).font(.system(size: 14)).monospacedDigit().foregroundColor(NFColor.ink2)
                                .frame(width: 96, alignment: .trailing)
                        }
                        .padding(.horizontal, 12).frame(height: 44)
                        .background(on ? NFColor.irisSoft.opacity(0.5) : Color.clear)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                HStack {
                    Text("合計（実査額）").font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink)
                    Spacer()
                    Text(NT.yen(total)).font(.system(size: 26, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
                }
                .padding(.horizontal, 12).frame(height: 52)
                .background(NFColor.lilacSoft)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            keypad.frame(width: 210)
        }
    }

    private var keypad: some View {
        let keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"]
        return VStack(spacing: 8) {
            Text(focus.map { "\(ncDenomLabel($0)) の枚数" } ?? "金種を選ぶ").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(keys, id: \.self) { k in
                    Button { press(k) } label: {
                        Text(k).font(.system(size: 22, weight: .bold)).foregroundColor(k == "C" ? NFColor.danger : NFColor.ink)
                            .frame(maxWidth: .infinity).frame(height: 54)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            Button {
                guard let f = focus, let i = NC_DENOMS.firstIndex(of: f) else { focus = NC_DENOMS.first; return }
                if counts[f] == nil { counts[f] = 0 }
                focus = i + 1 < NC_DENOMS.count ? NC_DENOMS[i + 1] : nil
            } label: {
                Text("次へ / Next").font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
            }
            .buttonStyle(PressableStyle())
        }
    }

    private func press(_ k: String) {
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

    private var denomJSON: [String: Int] {
        var out: [String: Int] = [:]
        for d in NC_DENOMS { if let n = counts[d] { out[String(d)] = n } }
        return out
    }

    // MARK: 開局（Web の RegisterOpenCard）

    private func openCard(_ p: NCPayload) -> some View {
        let expected = p.expectedOpening
        let diff = expected.map { total - $0 }
        let needsReason = entered && (diff ?? 0) != 0 && expected != nil
        return card {
            HStack {
                cardTitle("レジ開局", en: "Open register")
                Spacer()
                Text("未開局").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2)
                    .padding(.horizontal, 10).padding(.vertical, 4).background(Capsule().fill(NFColor.lilacSoft))
            }
            if p.openRegister == nil {
                Text("レジがまだ登録されていません。設定 > デバイス管理 でレジ（レシートプリンター）を登録すると、ここで開局できます。").font(.system(size: 14)).foregroundColor(NFColor.ink2)
            } else if !p.canOperate {
                Text("レジを開局する権限がありません。レジ担当（register.operate）の権限が必要です。店長に開局してもらってください。").font(.system(size: 14)).foregroundColor(NFColor.ink2)
            } else {
                Text("釣銭準備金（レジに入っている現金）を金種ごとに数えて枚数を入れる。合計がそのまま釣銭準備金。").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                counter(columns: 1)
                if let e = expected {
                    VStack(spacing: 4) {
                        HStack {
                            Text("前回のレジクローズで残した金額\(p.expectedFrom.map { "（\(ncMd($0))）" } ?? "")").foregroundColor(NFColor.ink2)
                            Spacer()
                            Text(NT.yen(e)).font(.system(size: 15, weight: .bold)).monospacedDigit()
                        }
                        HStack {
                            Text("過不足").foregroundColor(NFColor.ink2)
                            Spacer()
                            Text(!entered || diff == nil ? "—" : diff == 0 ? "±¥0（合っています）" : "\(diff! > 0 ? "+" : "−")\(NT.yen(abs(diff!)))")
                                .font(.system(size: 15, weight: .heavy)).monospacedDigit()
                                .foregroundColor(!entered ? NFColor.ink3 : diff == 0 ? NFColor.success : NFColor.danger)
                        }
                    }
                    .font(.system(size: 13))
                    .padding(12).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft.opacity(0.6)))
                }
                if needsReason { reasonField("違う理由（必須）", placeholder: "例：昨日の締めのあと両替した／本部に持って行った") }
                clerkLine(open: true)
                bigAction(model.busy ? "開局中…" : "開局する / Open（\(NT.yen(total))）", fill: NFColor.iris, enabled: !model.busy && entered && !(needsReason && reason.trimmingCharacters(in: .whitespaces).isEmpty)) {
                    Task { await doOpen(p, needsReason: needsReason) }
                }
            }
        }
    }

    private func doOpen(_ p: NCPayload, needsReason: Bool) async {
        guard let reg = p.openRegister else { return }
        if !entered { model.error = "釣銭準備金を金種ごとに数えて枚数を入力してください（0円のときは1円に0と入れてください）"; return }
        if needsReason && reason.trimmingCharacters(in: .whitespaces).isEmpty { model.error = "前回のレジクローズで残した金額と違います。違う理由を入れてください"; return }
        if clerk == nil && !p.clerks.isEmpty { model.error = "レジ開局の担当者を選んでください"; clerkPick = true; return }
        let body: [String: Any] = ["type": "cashOpen", "registerId": reg.id, "denominations": denomJSON, "reason": needsReason ? reason : NSNull(), "clerkName": clerk?.name ?? NSNull()]
        if let r = await model.act(body) {
            model.toast = "\(reg.name.isEmpty ? "レジ" : reg.name)を開局しました（釣銭準備金 \(NT.yen(r.openingFloat ?? total))）"
            counts = [:]; reason = ""
            onOpened()
        }
    }

    // MARK: クローズ（Web の RegisterCountCard）

    private func closeCard(_ p: NCPayload, _ s: NCSession) -> some View {
        let diff = entered ? total - s.theoreticalCash : nil
        let needsReason = diff != nil && diff != 0
        let target = p.nextFloatSetting ?? s.openingFloat
        let nextFloat = min(total, target)
        let deposit = total - nextFloat
        let shortage = max(0, target - total)
        let blocked = p.openCount > 0 || !entered || diff != 0 || (clerk == nil && !p.clerks.isEmpty)
        return card {
            HStack {
                cardTitle("現金実査\(p.openSessions.count > 1 ? " — \(s.registerName)" : "")", en: "Cash count")
                Spacer()
                if p.canOperate {
                    Button { Task { await doClose(p, s) } } label: {
                        VStack(spacing: 0) {
                            Text(model.busy ? "クローズ中…" : "レジクローズする").font(.system(size: 14, weight: .heavy))
                            Text("Close register").font(.system(size: 9, weight: .bold)).opacity(0.8)
                        }
                        .foregroundColor(.white).padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(needsReason ? NFColor.danger : NFColor.iris))
                        .opacity(blocked ? 0.6 : 1)
                    }
                    .buttonStyle(PressableStyle()).disabled(model.busy)
                }
            }
            if s.businessDate != p.businessDate {
                Text("このレジは \(s.businessDate) の営業日から開いたままです。先にこのレジを締めてください（締めるまで、このレジは新しく開局できません）。")
                    .font(.system(size: 13)).foregroundColor(Color(hex: 0x92400E))
                    .padding(10).background(RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0xFFFBEB)))
            }
            row("レジオープン金額", en: "Opening cash") {
                HStack(spacing: 6) { Image(systemName: "lock.fill").font(.system(size: 11)).foregroundColor(NFColor.ink3); Text(NT.yen(s.openingFloat)).font(.system(size: 16, weight: .heavy)).monospacedDigit() }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("理論在高").font(.system(size: 14, weight: .medium))
                    Spacer()
                    Text(NT.yen(s.theoreticalCash)).font(.system(size: 18, weight: .heavy)).monospacedDigit()
                }
                Text("釣銭準備金 ＋ 現金売上 ＋ 入金 − 出金 − 現金返金").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                Text("\(NT.yen(s.openingFloat)) ＋ \(NT.yen(s.cashSales)) ＋ \(NT.yen(s.cashIn)) − \(NT.yen(s.cashOut))\(s.cashRefunds > 0 ? " − \(NT.yen(s.cashRefunds))" : "")")
                    .font(.system(size: 11)).monospacedDigit().foregroundColor(NFColor.ink3)
            }
            Text("実査額（数えた現金）").font(.system(size: 14, weight: .medium))
            counter(columns: 2)
            row("差額", en: "") {
                Text(diff == nil ? "—" : "\(diff! > 0 ? "+" : diff! < 0 ? "−" : "±")\(NT.yen(abs(diff!)))")
                    .font(.system(size: 18, weight: .heavy)).monospacedDigit()
                    .foregroundColor(diff == nil ? NFColor.ink : diff == 0 ? NFColor.success : NFColor.danger)
            }
            VStack(spacing: 4) {
                kv("翌準備金", sub: "明日レジに残す", entered ? NT.yen(nextFloat) : "—", color: NFColor.ink)
                kv("預入金", sub: "銀行・預り金へ", entered ? NT.yen(deposit) : "—", color: entered && deposit > 0 ? NFColor.royal : NFColor.ink)
                if entered && shortage > 0 { kv("準備金不足（マイナス）", sub: "", "−\(NT.yen(shortage))", color: NFColor.danger) }
                Text("目標 \(NT.yen(target))（\(p.nextFloatSetting != nil && p.nextFloatSetting != s.openingFloat ? "店舗設定" : "今日の釣銭準備金と同じ")）")
                    .font(.system(size: 11)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity, alignment: .leading)
            }
            if needsReason { reasonField("差額の理由（必須）", placeholder: "例：釣銭の渡し間違い／レシートのない出金") }
            if blocked {
                VStack(alignment: .leading, spacing: 6) {
                    if p.openCount > 0 {
                        HStack { Text("未会計の伝票が\(p.openCount)件あります。すべて会計するか取消してください"); Button("未会計を見る") { onWeb("/app/orders?status=open") }.underline() }
                    }
                    if !entered { Text("金種ごとの枚数を入れてください") }
                    if entered, let d = diff, d != 0 {
                        HStack { Text("実査額が理論在高と \(NT.yen(abs(d))) \(d > 0 ? "多い" : "少ない")です。数え直すか、差額を入出金に記録して合わせてください"); Button("入出金へ") { onWeb("/app/cash") }.underline() }
                    }
                    if clerk == nil && !p.clerks.isEmpty {
                        HStack { Text("レジクローズの担当者を選んでください"); Button("担当者を選ぶ") { clerkPick = true }.underline() }
                    }
                }
                .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft))
            }
            clerkLine(open: false)
            if p.canOperate {
                bigAction(model.busy ? "クローズ中…" : "レジをクローズする", en: "Close register", fill: needsReason ? NFColor.danger : NFColor.iris, enabled: !model.busy, dim: blocked) {
                    Task { await doClose(p, s) }
                }
                Text("クローズすると、本日の売上・支払方法別・現金精算・入出金をまとめたレジ精算レシートがレシートプリンターから印刷されます")
                    .font(.system(size: 11)).foregroundColor(NFColor.ink3).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            } else {
                Text("レジ操作の権限がありません").font(.system(size: 12)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity)
            }
        }
    }

    private func doClose(_ p: NCPayload, _ s: NCSession) async {
        var list: [(String, String)] = []
        let diff = entered ? total - s.theoreticalCash : nil
        if p.openCount > 0 {
            list.append(("未会計の伝票が\(p.openCount)件あります。すべて会計するか取消してからクローズしてください。",
                         "There \(p.openCount == 1 ? "is 1 unpaid slip" : "are \(p.openCount) unpaid slips"). Please check out or cancel them before closing."))
        }
        if !entered {
            list.append(("金種ごとの枚数を入れてください（0円のときは1円に0と入れてください）。", "Please enter the number of coins and bills for each denomination (enter 0 for ¥1 if there is no cash)."))
        } else if let d = diff, d != 0 {
            list.append(("数えた現金が理論在高より \(NT.yen(abs(d))) \(d > 0 ? "多い" : "少ない")です。数え直すか、差額を入出金に記録して合わせてください。",
                         "The counted cash is \(NT.yen(abs(d))) \(d > 0 ? "more" : "less") than the expected cash. Please count again, or record the difference in Cash in / out."))
        }
        if clerk == nil && !p.clerks.isEmpty {
            list.append(("レジクローズの担当者を選んでください。", "Please select the staff member who is closing the register."))
        }
        if !list.isEmpty { problems = list; problemOpen = true; return }
        let body: [String: Any] = ["type": "cashClose", "sessionId": s.id, "denominations": denomJSON, "reason": reason.isEmpty ? NSNull() : reason, "clerkName": clerk?.name ?? NSNull()]
        guard let r = await model.act(body) else {
            problems = [(model.error ?? "クローズに失敗しました", "The register could not be closed. Please check the message above and try again.")]
            model.error = nil
            problemOpen = true
            return
        }
        model.toast = r.printWarning.map { "\(s.registerName)をクローズしました。\($0)" } ?? "\(s.registerName)をクローズしました。レジ精算レシートを印刷しています"
        counts = [:]; reason = ""
        if r.signOutAfter == true {
            _ = await model.act(["type": "cashSignOut"])
            onSignedOut()
        } else {
            await model.refresh(silent: true)
        }
    }

    private func emptyCard(_ p: NCPayload) -> some View {
        card {
            cardTitle("現金実査", en: "Cash count")
            Text(p.closedSessions.isEmpty ? "開局中のレジはありません。開局すると現金実査とクローズができます。" : "開局中のレジはありません（レジ精算ずみ）。レジ精算がすむと営業日完了になります。")
                .font(.system(size: 14)).foregroundColor(NFColor.ink2)
        }
    }

    // MARK: 右：本日の売上・支払方法別・入出金・現金残り

    private func salesCard(_ p: NCPayload) -> some View {
        card {
            HStack {
                cardTitle(p.continuing ? "\(ncMd(p.businessDate)) の営業日の売上（会計済）" : "本日の売上（会計済）", en: "")
                Spacer()
                if p.openCount > 0 {
                    Button { onWeb("/app/orders?status=open") } label: {
                        Text("未会計 \(p.openCount)卓 \(NT.yen(p.openTotal))（クローズ前に会計してください）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }.buttonStyle(.plain)
                } else {
                    Text("未会計はありません").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2), spacing: 8) {
                tile("売上合計（税込）", NT.yen(p.sales.grossSales), sub: p.sales.refunds > 0 ? "返金 −\(NT.yen(p.sales.refunds)) ／ 純売上 \(NT.yen(p.sales.netSales))" : nil)
                tile("会計件数", "\(p.sales.transactionCount)件", sub: nil)
                tile("客数", "\(p.sales.guests)名", sub: nil)
                tile("客単価", NT.yen(p.sales.avgSpend), sub: nil)
                ForEach(p.byMethod) { m in tile("\(m.label) / \(m.en)", NT.yen(m.amount), sub: "\(m.count)件") }
            }
        }
    }

    private func methodCard(_ p: NCPayload) -> some View {
        card {
            cardTitle("支払方法別", en: "By method")
            VStack(spacing: 0) {
                ForEach(p.byMethod) { m in
                    HStack {
                        Text(m.label).font(.system(size: 14)); Text(m.en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
                        Spacer()
                        Text("\(m.count)件").font(.system(size: 12)).foregroundColor(NFColor.ink3).frame(width: 50, alignment: .trailing)
                        Text(NT.yen(m.amount)).font(.system(size: 14, weight: .bold)).monospacedDigit().frame(width: 110, alignment: .trailing)
                    }
                    .padding(.vertical, 8)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                HStack {
                    Text("合計").font(.system(size: 14, weight: .bold))
                    Spacer()
                    Text("\(p.paymentsCount)件").font(.system(size: 12)).foregroundColor(NFColor.ink3).frame(width: 50, alignment: .trailing)
                    Text(NT.yen(p.paymentsTotal)).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(Color(hex: 0xC27C0E)).frame(width: 110, alignment: .trailing)
                }
                .padding(.vertical, 8).padding(.horizontal, 8)
                .background(NFColor.lilacSoft)
            }
        }
    }

    private func cashFlowCard(_ p: NCPayload) -> some View {
        let c = p.cashFlow
        return card {
            cardTitle("入出金・現金残り", en: "Cash in / out")
            VStack(spacing: 0) {
                flowRow("レジオープン金額", en: "Opening cash", NT.yen(c.opening), sub: nil)
                flowRow("現金売上", en: "Cash sales", "＋\(NT.yen(c.sales))", sub: nil)
                flowRow("入金", en: "Cash in", "＋\(NT.yen(c.cashIn))", sub: "\(c.depositCount)件")
                flowRow("出金", en: "Cash out", "−\(NT.yen(c.cashOut))", sub: "\(c.withdrawalCount)件")
                if c.refunds > 0 { flowRow("現金返金", en: "Cash refunds", "−\(NT.yen(c.refunds))", sub: nil) }
                HStack {
                    Text("現金残り").font(.system(size: 14, weight: .bold)); Text("Cash in drawer").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                    Spacer()
                    Text(NT.yen(c.remaining)).font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.royal)
                }
                .padding(.vertical, 8).padding(.horizontal, 8).background(NFColor.lilacSoft)
            }
            if !p.registerMoves.isEmpty {
                VStack(spacing: 0) {
                    ForEach(p.registerMoves) { m in
                        HStack(spacing: 8) {
                            Text(ncTime(m.time)).font(.system(size: 11, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink3).frame(width: 40, alignment: .leading)
                            Text(m.main).font(.system(size: 13)).lineLimit(1)
                            if let s = m.sub { Text(s).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1) }
                            Spacer()
                            Text("\(m.kind == "deposit" ? "＋" : "−")\(NT.yen(m.amount))").font(.system(size: 13, weight: .bold)).monospacedDigit()
                                .foregroundColor(m.kind == "deposit" ? NFColor.success : NFColor.ink)
                        }
                        .padding(.vertical, 6)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if p.registerMovesMore > 0 {
                        Text("ほか \(p.registerMovesMore)件（入出金の画面で見られます）").font(.system(size: 11)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                    }
                }
            }
        }
    }

    @ViewBuilder private func receiptNote(_ p: NCPayload) -> some View {
        if p.receipts.ng > 0 {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text("レシートのない出金・未精算の仮払いが \(p.receipts.ng)件（\(NT.yen(p.receipts.ngTotal))）あります。現金差額の原因になります")
                Spacer(minLength: 4)
                if p.canScan { Button("ScanSnap で取り込む ›") { onWeb("/app/scan#scan-bulk") }.foregroundColor(NFColor.royal) }
            }
            .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
            .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft))
        } else if p.receipts.total > 0 {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                Text("本日の出金 \(p.receipts.ok)件すべてにレシートがあります")
                Spacer()
            }
            .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.success)
            .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.success.opacity(0.1)))
        }
    }

    // MARK: 締めたレジ（Web の RegisterClosedCard：精算情報を印刷・精算レシートを再印刷）

    private func closedCard(_ c: NCClosed, storeDayClosed: Bool, canOperate: Bool) -> some View {
        card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(c.registerName).font(.system(size: 16, weight: .heavy))
                    Text("開局 \(ncTime(c.openedAt))｜担当 \(c.openedByName)\(c.closedAt.map { "｜締め \(ncTime($0))｜締め担当 \(c.closedByName)" } ?? "")")
                        .font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    badge("レジ締め済み", color: NFColor.ink2)
                    badge(storeDayClosed ? "店舗日次締め済み" : "店舗日次締めが未実施", color: storeDayClosed ? NFColor.success : Color(hex: 0xC27C0E))
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                tile("釣銭準備金", NT.yen(c.openingFloat), sub: nil)
                tile("理論現金", c.expectedCash.map { NT.yen($0) } ?? "—", sub: nil)
                tile("実現金", c.countedCash.map { NT.yen($0) } ?? "—", sub: nil)
                tile("差異", c.difference.map { "\($0 > 0 ? "+" : "")\(NT.yen($0))" } ?? "—", sub: nil, danger: (c.difference ?? 0) != 0)
            }
            if canOperate {
                HStack(spacing: 10) {
                    Spacer()
                    smallButton("精算情報を印刷 / Cash count") {
                        Task { if await model.act(["type": "cashSettlement", "sessionId": c.id]) != nil { model.toast = "精算情報を印刷しています" } }
                    }
                    smallButton("精算レシートを再印刷 / Reprint") {
                        Task { if await model.act(["type": "cashReprint", "sessionId": c.id]) != nil { model.toast = "レジ精算レシートを印刷しています" } }
                    }
                }
            }
        }
    }

    // MARK: 履歴（前の営業日のレジ精算・精算レシートの出し直し）

    /// レジの履歴（Web の 入出金 › 締め履歴 の「レジごとの履歴」と同じ）。開いたままのレジは上の「レジクローズ」で締める・途中集計を出す。
    /// 締めたレジは日を選んで精算レシート・精算情報を出し直す（2026-10-26 Ronnie「Shunka ko hijo native ma close garna namilera aa rezi khulena」）
    private func historyCard(_ p: NCPayload, _ rows: [NCHistory]) -> some View {
        let clock = p.clock ?? p.businessDate
        let late = rows.filter { $0.isOpen && $0.businessDate < clock }
        return card {
            cardTitle("レジの履歴", en: "History")
            if !late.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    VStack(alignment: .leading, spacing: 3) {
                        Text(late.map { "\(ncMd($0.businessDate)) \($0.registerName)" }.joined(separator: "・") + " がまだレジ精算されていません")
                            .font(.system(size: 14, weight: .heavy))
                        Text("このレジを締めるまで、同じレジは新しく開局できません。上の「レジクローズ」で現金を数えて締めてください（締めると精算レシートが出ます）。")
                            .font(.system(size: 12))
                    }
                }
                .foregroundColor(NFColor.danger)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft))
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                    if i > 0 { Divider() }
                    historyRow(r, clock: clock, canOperate: p.canOperate)
                }
            }
        }
    }

    private func historyRow(_ r: NCHistory, clock: String, canOperate: Bool) -> some View {
        let lateOpen = r.isOpen && r.businessDate < clock
        let status = r.isOpen ? (lateOpen ? "未精算（前の営業日）" : "営業中") : (r.status == "approved" ? "承認済み" : "レジ精算済み")
        let color = r.isOpen ? (lateOpen ? NFColor.danger : Color(hex: 0xC27C0E)) : NFColor.ink2
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(ncMd(r.businessDate)).font(.system(size: 15, weight: .heavy)).monospacedDigit()
                Text(r.registerName).font(.system(size: 15, weight: .bold))
                badge(status, color: color)
                Spacer(minLength: 0)
            }
            Text("開局 \(ncTime(r.openedAt))｜担当 \(r.openedByName)\(r.closedAt.map { "｜締め \(ncTime($0))｜締め担当 \(r.closedByName)" } ?? "")\(r.isOpen ? "" : r.difference.map { "｜差異 \($0 > 0 ? "+" : "")\(NT.yen($0))" } ?? "")")
                .font(.system(size: 11)).foregroundColor(NFColor.ink3)
            if canOperate {
                HStack(spacing: 10) {
                    Spacer()
                    if !r.isOpen {
                        smallButton("精算情報 / Cash count") {
                            Task { if await model.act(["type": "cashSettlement", "sessionId": r.id]) != nil { model.toast = "精算情報を印刷しています" } }
                        }
                    }
                    smallButton(r.isOpen ? "途中集計を印刷 / Interim" : "精算レシートを印刷 / Reprint") {
                        Task { if await model.act(["type": "cashReprint", "sessionId": r.id]) != nil { model.toast = r.isOpen ? "途中集計の精算レシートを印刷しています" : "レジ精算レシートを印刷しています" } }
                    }
                }
            }
        }
        .padding(.vertical, 10)
    }

    // MARK: 部品

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func cardTitle(_ ja: String, en: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(ja).font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
            if !en.isEmpty { Text(en).font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3) }
        }
    }

    private func row<R: View>(_ ja: String, en: String, @ViewBuilder right: () -> R) -> some View {
        HStack {
            Text(ja).font(.system(size: 14, weight: .medium))
            if !en.isEmpty { Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3) }
            Spacer()
            right()
        }
        .padding(.vertical, 4)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1).offset(y: 6) }
    }

    private func kv(_ ja: String, sub: String, _ v: String, color: Color) -> some View {
        HStack {
            Text(ja).foregroundColor(color == NFColor.danger ? NFColor.danger : NFColor.ink2).font(.system(size: 14, weight: color == NFColor.danger ? .bold : .regular))
            if !sub.isEmpty { Text(sub).font(.system(size: 11)).foregroundColor(NFColor.ink3) }
            Spacer()
            Text(v).font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(color)
        }
    }

    private func flowRow(_ ja: String, en: String, _ v: String, sub: String?) -> some View {
        HStack {
            Text(ja).font(.system(size: 14)); Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            Spacer()
            if let sub { Text(sub).font(.system(size: 12)).foregroundColor(NFColor.ink3) }
            Text(v).font(.system(size: 14, weight: .bold)).monospacedDigit().frame(width: 110, alignment: .trailing)
        }
        .padding(.vertical, 7).padding(.horizontal, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func tile(_ label: String, _ value: String, sub: String?, danger: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(danger ? NFColor.danger : NFColor.ink).lineLimit(1).minimumScaleFactor(0.7)
            if let sub { Text(sub).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
    }

    private func badge(_ t: String, color: Color) -> some View {
        Text(t).font(.system(size: 11, weight: .bold)).foregroundColor(color)
            .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(color.opacity(0.12)))
    }

    private func reasonField(_ label: String, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
            TextField(placeholder, text: $reason, axis: .vertical).lineLimit(2...4)
                .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }

    @ViewBuilder private func clerkLine(open: Bool) -> some View {
        if !(p?.clerks.isEmpty ?? true) {
            HStack(spacing: 6) {
                if let c = clerk {
                    Text(open ? "レジ開局担当者" : "レジクローズ担当者").foregroundColor(NFColor.ink3)
                    Text(c.name).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.navy)
                    Button("変更") { clerkPick = true }.font(.system(size: 12))
                } else {
                    Text(open ? "レジ開局の担当者を選んでください" : "レジクローズの担当者を選んでください").foregroundColor(NFColor.ink3)
                    Button("担当者を選ぶ") { clerkPick = true }.font(.system(size: 13, weight: .bold))
                }
            }
            .font(.system(size: 12))
            .frame(maxWidth: .infinity)
        }
    }

    private func bigAction(_ ja: String, en: String? = nil, fill: Color, enabled: Bool, dim: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Text(ja).font(.system(size: 18, weight: .heavy))
                if let en { Text(en).font(.system(size: 11, weight: .bold)).opacity(0.8) }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity).frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(fill))
            .opacity(!enabled ? 0.4 : dim ? 0.6 : 1)
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .disabled(!enabled)
    }

    private func smallButton(_ t: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: "printer"); Text(t) }
                .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
                .padding(.horizontal, 12).frame(height: 38)
                .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.irisSoft))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy)
    }
}
