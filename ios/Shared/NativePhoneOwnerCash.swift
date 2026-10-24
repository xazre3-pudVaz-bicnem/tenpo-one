import SwiftUI

// iPhone の店長・オーナー：入出金（Web の /app/cash。タブ ?tab=register|petty|closings）。2026-10-25 Ronnie「iPhone も native に」
// サーバーは iPad と同じ（返事の形は変えない）：
//   レジ入出金  GET ?part=cashio ／ POST cashEntry（入金・出金。買い物は用途の文を iPad・Web と同じに組み立てる）
//   小口現金    GET ?part=petty&from&to&status ／ POST pettyAdd・pettyApprove・pettyReject・pettyOpening・pettyCount・pettyCountApprove
//   締め履歴    GET ?part=closings&from&to ／ POST closingApprove・closingReopen・closingReopenStoreDay
// レシートの写真は iPhone のスキャンの画面へ（/app/scan?tx=<出金>）。レジクローズ・開局は /app/cash/close・/app/cash/open（どちらもネイティブ）。
// 現金台帳 CSV は Web（パソコン）の管理画面のまま。小口現金・締め履歴は NativePhoneOwnerPetty.swift

/// GET ?part=cashio の中身（使うところだけ）
struct NOMCashIo: Decodable {
    struct Session: Decodable, Hashable, Identifiable {
        let id: String
        let registerName: String
    }
    struct Row: Decodable, Hashable, Identifiable {
        let id: String
        let kind: String
        /// in ／ out ／ adjust
        let direction: String
        let time: String
        let main: String
        let sub: String?
        let amount: Double
        let pending: Bool
        /// ok ／ missing ／ advanceOpen ／ advanceDone ／ none
        let receipt: String
        let createdByName: String?
    }
    struct Advance: Decodable, Hashable, Identifiable {
        let id: String
        let createdByName: String?
        let time: String
        let amount: Double
        let main: String
        let sub: String?
    }
    let store: NOMNamed
    let businessDate: String
    let sessions: [Session]
    let theoretical: Double
    let shops: [NOMNamed]
    let clerks: [NOMNamed]
    let rows: [Row]
    let openAdvances: [Advance]
    let canOperate: Bool
    let canScan: Bool
    let canPetty: Bool
    let canExport: Bool?
}

/// 入出金の理由（iPad・Web の CashEntryForm と同じ）
enum NOMCashReason {
    static let shopping = "買い物（経費）"
    static func list(_ kind: String) -> [String] {
        kind == "deposit" ? ["釣銭補充", "両替", "仮払いのお釣り戻し", "その他"] : [shopping, "両替", "銀行へ預入", "その他"]
    }
}

@MainActor
final class NOMCashIoModel: ObservableObject {
    @Published var payload: NOMCashIo?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false

    func refresh() async {
        if NativePreview.current != nil { return }
        if payload == nil, let saved = NativeModuleAPI.cached(NOMCashIo.self, part: "cashio") { payload = saved }
        loading = true
        defer { loading = false }
        do {
            payload = try await NativeModuleAPI.get(NOMCashIo.self, part: "cashio")
            error = nil
        } catch {
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 入金・出金を登録（iPad と同じ POST cashEntry）。nil＝登録できた、文字＝エラー
    func submit(_ body: [String: Any]) async -> String? {
        busy = true
        defer { busy = false }
        let r = await NOM.post(body)
        guard r.ok else { return r.error ?? "登録に失敗しました" }
        await refresh()
        return nil
    }
}

// MARK: - 入出金の画面（3 つのタブ）

struct NativePhoneOwnerCashView: View {
    @ObservedObject var io: NOMCashIoModel
    @ObservedObject var petty: NOMPettyModel
    @ObservedObject var closings: NOMClosingsModel
    let onBack: () -> Void
    /// 別の画面へ（ネイティブがあればネイティブ。/app/scan?tx= ・/app/cash/close など）
    let onOpen: (String) -> Void
    @State private var tab: String

    static let tabs: [(key: String, label: String)] = [("register", "レジ入出金"), ("petty", "小口現金"), ("closings", "締め履歴")]

    init(io: NOMCashIoModel, petty: NOMPettyModel, closings: NOMClosingsModel, tab: String, onBack: @escaping () -> Void, onOpen: @escaping (String) -> Void) {
        self.io = io
        self.petty = petty
        self.closings = closings
        self.onBack = onBack
        self.onOpen = onOpen
        _tab = State(initialValue: ["register", "petty", "closings"].contains(tab) ? tab : "register")
    }

    private var storeName: String { io.payload?.store.name ?? petty.payload?.store.name ?? closings.payload?.store.name ?? "Cash in / out" }
    private var loading: Bool { tab == "petty" ? petty.loading : tab == "closings" ? closings.loading : io.loading }

    var body: some View {
        NPOFrame(title: "入出金", subtitle: storeName, onBack: onBack, trailing: {
            NOMRefreshButton(loading: loading) {
                Task {
                    switch tab {
                    case "petty": await petty.refresh()
                    case "closings": await closings.refresh()
                    default: await io.refresh()
                    }
                }
            }
        }, content: {
            VStack(spacing: 0) {
                NOSSegment(items: Self.tabs, selection: tab) { tab = $0 }
                    .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 2)
                switch tab {
                case "petty": NOMPettyTab(model: petty, onOpen: onOpen)
                case "closings": NOMClosingsTab(model: closings)
                default: NOMRegisterTab(model: io, onOpen: onOpen, onPetty: { tab = "petty" })
                }
            }
        })
    }
}

// MARK: - レジ入出金タブ

struct NOMRegisterTab: View {
    @ObservedObject var model: NOMCashIoModel
    let onOpen: (String) -> Void
    let onPetty: () -> Void
    @State private var entryKind: NOMEntryKind?

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                if model.payload != nil { NOSErrorBar(error: $model.error) }
                if let p = model.payload {
                    content(p)
                } else {
                    NOSStateView(error: model.error) { Task { await model.refresh() } }
                }
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .sheet(item: $entryKind) { k in
            if let p = model.payload {
                NOMCashEntrySheet(model: model, payload: p, initialKind: k.kind, onClose: { entryKind = nil })
                    .presentationDetents([.large])
                    .environment(\.colorScheme, .light)
            }
        }
    }

    private func content(_ p: NOMCashIo) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                theoreticalCard(p)
                actions(p)
                if p.canScan {
                    NOMSnapCard(sub: "出金のレシート・請求書を書類ボックスへ。撮ってすぐ保存できます") { onOpen("/app/scan") }
                }
                ForEach(p.openAdvances) { a in advanceCard(a, p) }
                historyCard(p)
                NOMWebLink(title: "Web の画面で開く", sub: p.canExport == true ? "現金台帳 CSV の取り出し・開店チェックリストは Web の画面で" : "開店チェックリストは Web の画面で") {
                    onOpen("/app/cash?web=1")
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    /// 現在の現金在高（理論値）
    private func theoreticalCard(_ p: NOMCashIo) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("現在の現金在高（理論値）").font(.system(size: 12.5, weight: .bold)).foregroundColor(.white.opacity(0.85))
                Spacer()
                Text("営業日 \(NOS.md(p.businessDate))").font(.system(size: 11, weight: .bold)).foregroundColor(.white.opacity(0.75))
            }
            Text(p.sessions.isEmpty ? "—" : NOS.yen(p.theoretical)).font(.system(size: 32, weight: .heavy)).foregroundColor(.white).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(p.sessions.isEmpty ? "開局中のレジがありません" : "釣銭準備金＋現金売上＋入金−出金−現金返金（開局中 \(p.sessions.count)台）")
                .font(.system(size: 11)).foregroundColor(.white.opacity(0.8))
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
    }

    @ViewBuilder private func actions(_ p: NOMCashIo) -> some View {
        if p.sessions.isEmpty {
            VStack(spacing: 8) {
                NOMNote(text: "開局中のレジがありません。レジを開局すると、入金・出金を登録できます。")
                if p.canOperate {
                    NOMButton(title: "レジオープン（開局）へ", icon: "lock.open") { onOpen("/app/cash/open") }
                }
            }
        } else {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    kindButton("入金", en: "Cash in", icon: "arrow.down.circle.fill", tint: NT.ok) { entryKind = NOMEntryKind(kind: "deposit") }
                    kindButton("出金", en: "Cash out", icon: "arrow.up.circle.fill", tint: NT.warn) { entryKind = NOMEntryKind(kind: "withdrawal") }
                }
                if p.canOperate {
                    NOMButton(title: "レジクローズへ", icon: "lock", filled: false) { onOpen("/app/cash/close") }
                }
            }
        }
    }

    private func kindButton(_ ja: String, en: String, icon: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 26, weight: .bold)).foregroundColor(tint)
                Text(ja).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink)
                Text(en).font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3)
            }
            .frame(maxWidth: .infinity).frame(height: 104)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
        .buttonStyle(PressableStyle())
    }

    /// 仮払い（買い物に持ち出し中・精算待ち）
    private func advanceCard(_ a: NOMCashIo.Advance, _ p: NOMCashIo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                NOSBadge(text: "仮払い・精算待ち", color: NT.warn)
                Spacer()
                Text(NOS.yen(a.amount)).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
            }
            Text([a.main, a.sub ?? ""].filter { !$0.isEmpty }.joined(separator: " ・ ")).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(3)
            Text("\(a.createdByName ?? "") ・ \(NOM.hm(a.time)) に持ち出し").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            HStack(spacing: 8) {
                if p.canScan { NOMSmallButton(title: "レシートを撮る", filled: true) { onOpen("/app/scan?tx=\(a.id)") } }
                if p.canPetty { NOMSmallButton(title: "精算する（小口現金）") { onPetty() } }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0xFFF7E6)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundColor(NT.warn.opacity(0.6)))
    }

    // MARK: 本日の入出金履歴

    private func historyCard(_ p: NOMCashIo) -> some View {
        NPOCard(title: "本日の入出金履歴", trailing: p.rows.isEmpty ? "" : "\(p.rows.count)件") {
            if p.rows.isEmpty {
                Text("本日の入出金はまだありません").font(.system(size: 13)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).padding(.vertical, 18)
            }
            ForEach(Array(p.rows.enumerated()), id: \.element.id) { i, r in
                if i > 0 { Rectangle().fill(NT.line).frame(height: 1) }
                row(r, p)
            }
        }
    }

    private func row(_ r: NOMCashIo.Row, _ p: NOMCashIo) -> some View {
        let (label, color) = direction(r.direction)
        return HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(NOM.hm(r.time)).font(.system(size: 12.5, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                    NOSBadge(text: label, color: color)
                    if r.pending { NOSBadge(text: "承認待ち", color: NT.warn) }
                }
                Text(r.main).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
                if let s = r.sub, !s.isEmpty {
                    Text(s).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(2)
                }
                if let by = r.createdByName, !by.isEmpty {
                    Label(by, systemImage: "person").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).labelStyle(NOSCompactLabel())
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 6) {
                Text("\(r.direction == "in" ? "+" : r.direction == "out" ? "−" : "")\(NOS.yen(r.amount))")
                    .font(.system(size: 16, weight: .heavy)).foregroundColor(r.direction == "in" ? NT.ok : NT.ink).monospacedDigit()
                receipt(r, p)
            }
        }
        .padding(.vertical, 4)
    }

    private func direction(_ d: String) -> (String, Color) {
        switch d {
        case "in": return ("入金", NT.ok)
        case "out": return ("出金", NT.warn)
        default: return ("調整", NT.ink2)
        }
    }

    @ViewBuilder private func receipt(_ r: NOMCashIo.Row, _ p: NOMCashIo) -> some View {
        switch r.receipt {
        case "ok":
            Label("写真あり", systemImage: "checkmark.circle.fill").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ok).labelStyle(NOSCompactLabel())
        case "advanceDone":
            Text("精算済").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ok)
        case "advanceOpen":
            if p.canPetty { NOMSmallButton(title: "精算へ") { onPetty() } } else { Text("精算待ち").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.warn) }
        case "missing":
            if p.canScan {
                NOMSmallButton(title: "レシートを撮る", filled: true) { onOpen("/app/scan?tx=\(r.id)") }
            } else {
                Text("レシート未添付").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink2)
            }
        default:
            EmptyView()
        }
    }
}

/// 入出金の登録シートを開く印（入金／出金）
struct NOMEntryKind: Identifiable {
    let id = UUID()
    let kind: String
}

// MARK: - 入金・出金を登録（Web の CashEntryForm・iPad の入出金と同じ。用途の文の組み立ても同じ）

struct NOMCashEntrySheet: View {
    @ObservedObject var model: NOMCashIoModel
    let payload: NOMCashIo
    let onClose: () -> Void

    @State private var kind: String
    @State private var sessionId = ""
    @State private var reason: String
    @State private var memo = ""
    @State private var amount = ""
    @State private var clerk = ""
    @State private var shop = ""
    @State private var items = ""
    @State private var change = ""
    /// テンキーの入れ先（amount ／ change）
    @State private var target = "amount"
    @State private var problem: String?
    @State private var clerkPick = false

    init(model: NOMCashIoModel, payload: NOMCashIo, initialKind: String, onClose: @escaping () -> Void) {
        self.model = model
        self.payload = payload
        self.onClose = onClose
        let k = initialKind == "withdrawal" ? "withdrawal" : "deposit"
        _kind = State(initialValue: k)
        _reason = State(initialValue: NOMCashReason.list(k)[0])
    }

    private var shopping: Bool { kind == "withdrawal" && reason == NOMCashReason.shopping }
    private var taken: Int { Int(amount) ?? 0 }
    private var changeN: Int { Int(change) ?? 0 }
    private var spent: Int { taken - changeN }
    private var activeSession: String { payload.sessions.contains { $0.id == sessionId } ? sessionId : (payload.sessions.first?.id ?? "") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    NOSSegment(items: [("deposit", "入金 In"), ("withdrawal", "出金 Out")], selection: kind) { k in
                        kind = k
                        reason = NOMCashReason.list(k)[0]
                        target = "amount"
                    }
                    if payload.sessions.count > 1 { registerPicker }
                    reasonChips
                    if shopping { shoppingFields }
                    amountFields
                    NOMKeypad(text: target == "change" ? $change : $amount, maxLength: 8)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("メモ").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        TextField(shopping ? "例：レシートは事務所へ" : (reason == "その他" ? "内容を入力（必須）" : "例：千円札 → 小銭"), text: $memo)
                            .font(.system(size: 16))
                            .padding(.horizontal, 12).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
                    }
                    NOMButton(title: model.busy ? "登録中…" : "\(kind == "deposit" ? "入金" : "出金")を登録する", height: 56, enabled: !model.busy && !payload.sessions.isEmpty) {
                        Task { await submit() }
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NT.page.ignoresSafeArea())
            .navigationTitle(kind == "deposit" ? "入金を登録" : "出金を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
        .sheet(isPresented: $clerkPick) {
            NOMPickSheet(title: "払った人", items: payload.clerks.map { (id: $0.name, name: $0.name, sub: "") }, selected: clerk.isEmpty ? nil : clerk,
                         onPick: { v in clerk = v ?? ""; clerkPick = false }, onClose: { clerkPick = false })
                .presentationDetents([.medium, .large])
                .environment(\.colorScheme, .light)
        }
    }

    private var registerPicker: some View {
        HStack {
            Text("レジ").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink2)
            Spacer()
            Menu {
                ForEach(payload.sessions) { s in
                    Button { sessionId = s.id } label: {
                        if activeSession == s.id { Label(s.registerName, systemImage: "checkmark") } else { Text(s.registerName) }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Text(payload.sessions.first { $0.id == activeSession }?.registerName ?? "レジ").font(.system(size: 14, weight: .bold))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .bold))
                }
                .foregroundColor(NT.purpleDeep).padding(.horizontal, 12).frame(height: 38)
                .background(Capsule().fill(NT.lilac))
            }
        }
    }

    private var reasonChips: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("理由").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            WrapLayout(spacing: 6) {
                ForEach(NOMCashReason.list(kind), id: \.self) { r in
                    NOMChip(title: r, on: reason == r) {
                        reason = r
                        if r != NOMCashReason.shopping { target = "amount" }
                    }
                }
            }
        }
    }

    private var shoppingFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text("払った人").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                    Text("必須").font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.danger)
                }
                Button { clerkPick = true } label: {
                    HStack {
                        Image(systemName: "person.crop.circle").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink3)
                        Text(clerk.isEmpty ? "担当者を選ぶ" : clerk).font(.system(size: 15, weight: .bold)).foregroundColor(clerk.isEmpty ? NT.ink3 : NT.ink)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .padding(.horizontal, 12).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("買い物先").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                if payload.shops.isEmpty {
                    Text("仕入先に登録した店がここに並びます（企業で共通・ABC／五十音順）。仕入先の登録は Web の管理画面で。")
                        .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                } else {
                    WrapLayout(spacing: 6) {
                        ForEach(payload.shops) { s in
                            NOMChip(title: s.name, on: shop == s.name) { shop = shop == s.name ? "" : s.name }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text("買った物").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                    Text("必須").font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.danger)
                }
                TextField("例：野菜・鶏肉・洗剤", text: $items)
                    .font(.system(size: 16))
                    .padding(.horizontal, 12).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
        }
    }

    private var amountFields: some View {
        VStack(spacing: 8) {
            NOMAmountBox(label: shopping ? "持ち出した金額" : "金額", value: amount, active: target == "amount") { target = "amount" }
            if shopping {
                HStack(spacing: 8) {
                    NOMAmountBox(label: "お釣り", value: change, active: target == "change", big: false) { target = "change" }
                    Button { change = "0"; target = "change" } label: {
                        Text("ちょうど").font(.system(size: 15, weight: .heavy)).foregroundColor(change == "0" ? .white : NT.purpleDeep)
                            .padding(.horizontal, 16).frame(height: 52)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(change == "0" ? NT.purple : NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
                HStack {
                    Text("使った金額（レジから減る分）").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
                    Spacer()
                    let ok = taken > 0 && !change.isEmpty && spent > 0
                    Text(NT.yen(ok ? spent : 0)).font(.system(size: 18, weight: .heavy)).monospacedDigit().foregroundColor(ok ? NT.purpleDeep : NT.ink3)
                }
                .padding(.horizontal, 4)
            }
        }
    }

    private func submit() async {
        let value = Int(amount) ?? 0
        guard value > 0 else { problem = shopping ? "持ち出した金額は1円以上の整数で入力してください" : "金額は1円以上の整数で入力してください"; return }
        let memoT = memo.trimmingCharacters(in: .whitespaces)
        var purpose: String
        var recorded = value
        if shopping {
            if change.isEmpty { problem = "お釣りを入力してください（お釣りが無ければ「ちょうど」）"; return }
            if clerk.trimmingCharacters(in: .whitespaces).isEmpty { problem = "買い物を払った担当者を選んでください"; return }
            if items.trimmingCharacters(in: .whitespaces).isEmpty { problem = "買った物を入力してください"; return }
            if changeN >= value { problem = "お釣りが持ち出した金額以上です。金額を確かめてください"; return }
            recorded = value - changeN
            let what = [shop.trimmingCharacters(in: .whitespaces), items.trimmingCharacters(in: .whitespaces)].filter { !$0.isEmpty }.joined(separator: " ")
            let money = changeN > 0 ? "持出\(NT.yen(value)) お釣り\(NT.yen(changeN))" : "持出\(NT.yen(value)) ちょうど"
            purpose = "買い物：\(what)｜担当 \(clerk.trimmingCharacters(in: .whitespaces))｜\(money)"
            if !memoT.isEmpty { purpose += "｜\(memoT)" }
        } else {
            if reason == "その他" && memoT.isEmpty { problem = "「その他」のときはメモを入力してください"; return }
            purpose = memoT.isEmpty ? reason : "\(reason)：\(memoT)"
        }
        guard !activeSession.isEmpty else { problem = "開局中のレジがありません"; return }
        problem = nil
        let label = kind == "deposit" ? "入金" : "出金"
        if let err = await model.submit(["type": "cashEntry", "sessionId": activeSession, "kind": kind, "amount": recorded, "purpose": purpose]) {
            problem = err
            return
        }
        model.toast = "\(label) \(NT.yen(recorded)) を登録しました"
        onClose()
    }
}

// MARK: - key "cash" の画面（NativePhoneOwnerScreen から）

struct NativePhoneOwnerCashScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var io = NOMCashIoModel()
    @StateObject private var petty = NOMPettyModel()
    @StateObject private var closings = NOMClosingsModel()

    init(route: NativeModuleRoute) {
        self.route = route
    }

    var body: some View {
        NativePhoneOwnerCashView(io: io, petty: petty, closings: closings, tab: route.query("tab") ?? "register",
                                 onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "cash", useWeb: io.useWeb || petty.useWeb || closings.useWeb, state: state))
    }
}
