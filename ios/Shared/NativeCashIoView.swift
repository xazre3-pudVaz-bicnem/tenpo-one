import SwiftUI

// 入出金（ネイティブ）。Web の /app/cash のレジ入出金タブ（components/cash/cash-entry-form.tsx・本日の入出金履歴）と同じ（2026-10-24）
//   入金／出金・レジ・理由・（買い物：払った人・買い物先・買った物・持ち出した金額・お釣り・ちょうど）・金額・メモ・登録する
//   右：現在の現金在高（理論値）・本日の入出金履歴

struct NCIoRow: Codable, Identifiable {
    let id: String
    let kind: String
    let direction: String
    let time: String
    let main: String
    let sub: String
    let amount: Int
    let pending: Bool
    let receipt: String
    let createdByName: String
}
struct NCIoAdvance: Codable, Identifiable { let id: String; let createdByName: String; let time: String; let amount: Int; let main: String; let sub: String? }
struct NCIoPayload: Codable {
    let store: NFNamed
    let businessDate: String
    let sessions: [NFNamed]
    let theoretical: Int
    let shops: [NFNamed]
    let clerks: [NFNamed]
    let rows: [NCIoRow]
    let openAdvances: [NCIoAdvance]
    let canOperate: Bool
    let canScan: Bool
    let canPetty: Bool
    let canExport: Bool

    enum CodingKeys: String, CodingKey { case store, businessDate, sessions, theoretical, shops, clerks, rows, openAdvances, canOperate, canScan, canPetty, canExport }
    struct Session: Codable { let id: String; let registerName: String }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        store = try c.decode(NFNamed.self, forKey: .store)
        businessDate = try c.decode(String.self, forKey: .businessDate)
        sessions = try c.decode([Session].self, forKey: .sessions).map { NFNamed(id: $0.id, name: $0.registerName) }
        theoretical = try c.decode(Int.self, forKey: .theoretical)
        shops = try c.decode([NFNamed].self, forKey: .shops)
        clerks = try c.decode([NFNamed].self, forKey: .clerks)
        rows = try c.decode([NCIoRow].self, forKey: .rows)
        openAdvances = try c.decode([NCIoAdvance].self, forKey: .openAdvances)
        canOperate = try c.decode(Bool.self, forKey: .canOperate)
        canScan = try c.decode(Bool.self, forKey: .canScan)
        canPetty = try c.decode(Bool.self, forKey: .canPetty)
        canExport = try c.decode(Bool.self, forKey: .canExport)
    }
}

private let NC_SHOPPING = "買い物（経費）"
private let NC_REASONS: [String: [String]] = [
    "deposit": ["釣銭補充", "両替", "仮払いのお釣り戻し", "その他"],
    "withdrawal": [NC_SHOPPING, "両替", "銀行へ預入", "その他"],
]

@MainActor
final class NativeCashIoModel: ObservableObject {
    @Published var payload: NCIoPayload?
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func refresh(silent: Bool = false) async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "cashio")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NCIoPayload.self, from: data)
            error = nil
        } catch {
            if !silent || payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    func submit(_ body: [String: Any]) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.ledgerPost(body, as: NCActionResult.self)
            if !r.ok { error = r.error ?? "登録に失敗しました"; return false }
            await refresh(silent: true)
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "登録に失敗しました"
            return false
        }
    }
}

struct NativeCashIoView: View {
    @ObservedObject var model: NativeCashIoModel
    let onHome: () -> Void
    let onWeb: (String) -> Void
    let onClose: () -> Void
    /// 小口現金・締め履歴のタブ（ネイティブ）
    var onTab: (String) -> Void = { _ in }

    @State private var kind = "deposit"
    @State private var sessionId = ""
    @State private var reason = "釣銭補充"
    @State private var memo = ""
    @State private var amount = ""
    @State private var clerk = ""
    @State private var shop = ""
    @State private var items = ""
    @State private var change = ""
    /// テンキーの入れ先
    @State private var target = "amount"

    private var p: NCIoPayload? { model.payload }
    private var shopping: Bool { kind == "withdrawal" && reason == NC_SHOPPING }
    private var taken: Int { Int(amount) ?? 0 }
    private var changeN: Int { Int(change) ?? 0 }
    private var spent: Int { taken - changeN }
    private var disabled: Bool { (p?.sessions.isEmpty ?? true) }
    private var activeSession: String { (p?.sessions.contains { $0.id == sessionId } ?? false) ? sessionId : (p?.sessions.first?.id ?? "") }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "入出金", subtitle: "Cash in / out", onHome: onHome)
            tabs
            if let p {
                GeometryReader { geo in
                    ScrollView {
                        let wide = geo.size.width >= 1000
                        let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
                        layout {
                            entryCard(p).frame(maxWidth: wide ? geo.size.width * 0.48 : .infinity)
                            historyCard(p).frame(maxWidth: .infinity)
                        }
                        .padding(16)
                    }
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await model.refresh() } } }
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
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .task { await model.refresh() }
    }

    // Web の SegmentedTabs（レジ入出金・小口現金・締め履歴）＋ 右上の レジクローズ・現金台帳CSV
    private var tabs: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                tabBtn("レジ入出金", en: "Register", on: true) {}
                tabBtn("小口現金", en: "Petty cash", on: false) { onTab("petty") }
                tabBtn("締め履歴", en: "Closings", on: false) { onTab("closings") }
            }
            .padding(3).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
            Spacer()
            if p?.canOperate ?? false {
                pill("lock", "レジクローズ") { onClose() }
            }
            if p?.canExport ?? false {
                pill("arrow.down.doc", "現金台帳CSV") { exportCsv() }
            }
        }
        .padding(.horizontal, 16).padding(.top, 12)
    }

    private func tabBtn(_ ja: String, en: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(ja).font(.system(size: 14, weight: .bold))
                Text(en).font(.system(size: 10, weight: .semibold)).opacity(0.75)
            }
            .foregroundColor(on ? .white : NFColor.ink2)
            .padding(.horizontal, 14).frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 9).fill(on ? NFColor.iris : Color.clear))
        }
        .buttonStyle(PressableStyle())
    }

    private func pill(_ icon: String, _ t: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: icon); Text(t) }
                .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                .padding(.horizontal, 14).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func exportCsv() {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        let to = f.string(from: Date())
        let from = f.string(from: Date().addingTimeInterval(-30 * 86400))
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/cash/export?from=\(from)&to=\(to)")
                if let url = NLShare.tempFile("現金台帳_\(from)_\(to).csv", data: data) { NLShare.present(url: url) }
            } catch { model.error = (error as? NativeAPIError)?.message ?? "CSV を取り出せませんでした" }
        }
    }

    // MARK: 登録

    private func entryCard(_ p: NCIoPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("登録").font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
                Text("Entry").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3)
            }
            if p.canScan {
                Button { onWeb("/app/scan") } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "camera").font(.system(size: 22))
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) { Text("レシートを撮って保存").font(.system(size: 15, weight: .bold)); Text("Snap receipt").font(.system(size: 10)) }
                            Text("出金のレシート・請求書を書類ボックスへ。その場で撮っても、あとから写真・PDFを選んで添付してもかまいません").font(.system(size: 11)).foregroundColor(NFColor.ink3).multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                    }
                    .foregroundColor(NFColor.royal)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.irisSoft))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [6])).foregroundColor(NFColor.iris))
                }
                .buttonStyle(.plain)
            }
            if p.canPetty {
                Button { onTab("petty") } label: {
                    HStack(spacing: 4) { Text("買い物に持ち出し（仮払い）"); Text("Advance").font(.system(size: 10)) }
                        .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(RoundedRectangle(cornerRadius: 9).stroke(NFColor.wisteria, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            ForEach(p.openAdvances) { a in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("仮払い \(a.createdByName) ・ \(NFTime.hm(iso: a.time)) 持ち出し \(NT.yen(a.amount))").font(.system(size: 13.5, weight: .bold))
                        Text("精算待ち").font(.system(size: 11, weight: .bold)).foregroundColor(Color(hex: 0xC27C0E)).padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(Color.white.opacity(0.7)))
                    }
                    Text([a.main, a.sub].compactMap { $0 }.joined(separator: " ・ ")).font(.system(size: 12.5)).foregroundColor(NFColor.ink2)
                    HStack(spacing: 6) {
                        if p.canScan { smallBtn("レシートを撮る", filled: true) { onWeb("/app/scan?tx=\(a.id)") } }
                        smallBtn("精算する", filled: false) { onTab("petty") }
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xFFF6E0)))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundColor(Color(hex: 0xC27C0E)))
            }

            // 入金／出金
            HStack(spacing: 0) {
                ForEach(["deposit", "withdrawal"], id: \.self) { k in
                    Button { kind = k; reason = NC_REASONS[k]![0] } label: {
                        HStack(spacing: 6) {
                            Text(k == "deposit" ? "入金" : "出金").font(.system(size: 16, weight: .bold))
                            Text(k == "deposit" ? "In" : "Out").font(.system(size: 11, weight: .semibold)).opacity(0.75)
                        }
                        .foregroundColor(kind == k ? .white : NFColor.ink2)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .background(kind == k ? NFColor.iris : Color.white)
                    }
                    .buttonStyle(.plain)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))

            if p.sessions.count > 1 {
                line("レジ") {
                    Picker("レジ", selection: Binding(get: { activeSession }, set: { sessionId = $0 })) {
                        ForEach(p.sessions) { s in Text(s.name).tag(s.id) }
                    }.pickerStyle(.menu)
                }
            }
            line("理由") {
                Picker("理由", selection: $reason) { ForEach(NC_REASONS[kind]!, id: \.self) { Text($0).tag($0) } }.pickerStyle(.menu).disabled(disabled)
            }
            if shopping {
                line("払った人", required: true) {
                    Picker("払った人", selection: $clerk) {
                        Text("担当者を選ぶ").tag("")
                        ForEach(p.clerks) { c in Text(c.name).tag(c.name) }
                    }.pickerStyle(.menu)
                }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("買い物先").font(.system(size: 14, weight: .medium)); Text("Shop").font(.system(size: 10)).foregroundColor(NFColor.ink3)
                        Spacer()
                        Button("＋ 買い物先を足す（仕入先）") { onWeb("/app/vendors") }.font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.royal)
                    }
                    if p.shops.isEmpty {
                        Text("仕入先に登録した店がここに並びます（企業で共通・ABC／五十音順）。").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    } else {
                        NCFlow(spacing: 6) {
                            ForEach(p.shops) { s in
                                let on = shop == s.name
                                Button { shop = on ? "" : s.name } label: {
                                    Text(s.name).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                                        .padding(.horizontal, 12).frame(height: 32)
                                        .background(Capsule().fill(on ? NFColor.iris : Color.white))
                                        .overlay(Capsule().stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
                line("買った物", required: true) {
                    TextField("例：野菜・鶏肉・洗剤", text: $items).textFieldStyle(.roundedBorder).frame(maxWidth: 280)
                }
            }
            amountField(shopping ? "持ち出した金額" : "金額", value: amount, key: "amount", big: true)
            if shopping {
                HStack(spacing: 10) {
                    amountField("お釣り", value: change, key: "change", big: false)
                    Button { change = "0"; target = "change" } label: {
                        Text("ちょうど").font(.system(size: 15, weight: .bold)).foregroundColor(change == "0" ? .white : NFColor.royal)
                            .padding(.horizontal, 16).frame(height: 48)
                            .background(RoundedRectangle(cornerRadius: 10).fill(change == "0" ? NFColor.iris : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                    }.buttonStyle(PressableStyle())
                }
                HStack {
                    Text("使った金額（レジから減る分）").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                    Spacer()
                    Text(NT.yen(taken > 0 && !change.isEmpty && spent > 0 ? spent : 0)).font(.system(size: 17, weight: .bold)).monospacedDigit()
                        .foregroundColor(taken > 0 && !change.isEmpty && spent > 0 ? NFColor.royal : NFColor.ink3)
                }
            }
            NCKeypad { k in press(k) }
            line("メモ") {
                TextField(shopping ? "例：レシートは事務所へ" : "例：千円札 → 小銭", text: $memo).textFieldStyle(.roundedBorder).frame(maxWidth: 280)
            }
            Button { Task { await submit(p) } } label: {
                Text(model.busy ? "登録中…" : "登録する").font(.system(size: 18, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 56)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.iris))
                    .opacity(model.busy || disabled ? 0.4 : 1)
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            .disabled(model.busy || disabled)
            if disabled {
                Text("開局中のレジがありません。下の「レジ」から開局すると登録できます。").font(.system(size: 12)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func line<R: View>(_ label: String, required: Bool = false, @ViewBuilder right: () -> R) -> some View {
        HStack {
            Text(label).font(.system(size: 14, weight: .medium))
            if required { Text("必須").font(.system(size: 10.5, weight: .bold)).foregroundColor(NFColor.danger) }
            Spacer()
            right()
        }
        .padding(.vertical, 4)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1).offset(y: 6) }
    }

    private func amountField(_ label: String, value: String, key: String, big: Bool) -> some View {
        Button { target = key } label: {
            HStack {
                Text(label).font(.system(size: 14, weight: .medium)).foregroundColor(NFColor.ink)
                Spacer()
                Text(value.isEmpty ? "0" : (Int(value).map { $0.formatted() } ?? value))
                    .font(.system(size: big ? 28 : 21, weight: .heavy)).monospacedDigit()
                    .foregroundColor(value.isEmpty ? NFColor.ink3 : (big ? NFColor.royal : NFColor.ink))
                Text("円").font(.system(size: 13)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 14).frame(height: big ? 60 : 48)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(target == key ? NFColor.iris : NFColor.line, lineWidth: target == key ? 2 : 1))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func press(_ k: String) {
        var v = target == "change" ? change : amount
        switch k {
        case "C": v = ""
        case "⌫": v = String(v.dropLast())
        case "00": if !v.isEmpty && v.count <= 6 { v += "00" }
        default: if v.count < 8 { v = (v == "0" ? "" : v) + k }
        }
        if target == "change" { change = v } else { amount = v }
    }

    private func submit(_ p: NCIoPayload) async {
        let value = Int(amount) ?? 0
        guard value > 0 else { model.error = shopping ? "持ち出した金額は1円以上の整数で入力してください" : "金額は1円以上の整数で入力してください"; return }
        var purpose: String
        var recorded = value
        let memoT = memo.trimmingCharacters(in: .whitespaces)
        if shopping {
            if change.isEmpty { model.error = "お釣りを入力してください（お釣りが無ければ「ちょうど」）"; return }
            if clerk.trimmingCharacters(in: .whitespaces).isEmpty { model.error = "買い物を払った担当者を選んでください"; return }
            if items.trimmingCharacters(in: .whitespaces).isEmpty { model.error = "買った物を入力してください"; return }
            if changeN >= value { model.error = "お釣りが持ち出した金額以上です。金額を確かめてください"; return }
            recorded = value - changeN
            let what = [shop.trimmingCharacters(in: .whitespaces), items.trimmingCharacters(in: .whitespaces)].filter { !$0.isEmpty }.joined(separator: " ")
            let money = changeN > 0 ? "持出\(NT.yen(value)) お釣り\(NT.yen(changeN))" : "持出\(NT.yen(value)) ちょうど"
            purpose = "買い物：\(what)｜担当 \(clerk.trimmingCharacters(in: .whitespaces))｜\(money)"
            if !memoT.isEmpty { purpose += "｜\(memoT)" }
        } else {
            if reason == "その他" && memoT.isEmpty { model.error = "「その他」のときはメモを入力してください"; return }
            purpose = memoT.isEmpty ? reason : "\(reason)：\(memoT)"
        }
        if await model.submit(["type": "cashEntry", "sessionId": activeSession, "kind": kind, "amount": recorded, "purpose": purpose]) {
            model.toast = "\(kind == "deposit" ? "入金" : "出金") \(NT.yen(recorded)) を登録しました"
            amount = ""; memo = ""; shop = ""; items = ""; change = ""; target = "amount"
        }
    }

    private func smallBtn(_ t: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 12.5, weight: .bold)).foregroundColor(filled ? .white : NFColor.royal)
                .padding(.horizontal, 12).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(filled ? NFColor.iris : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(filled ? Color.clear : NFColor.wisteria, lineWidth: 1))
        }.buttonStyle(.plain)
    }

    // MARK: 本日の入出金履歴

    private func historyCard(_ p: NCIoPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("本日の入出金履歴").font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
                Text("Today").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3)
            }
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("現在の現金在高（理論値）").font(.system(size: 14))
                    Text(p.sessions.isEmpty ? "開局中のレジがありません" : "釣銭準備金＋現金売上＋入金−出金−現金返金（開局中 \(p.sessions.count)台）").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
                Spacer()
                Text(p.sessions.isEmpty ? "—" : NT.yen(p.theoretical)).font(.system(size: 28, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.royal)
            }
            .padding(14).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
            if p.rows.isEmpty {
                Text("本日の入出金はまだありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                VStack(spacing: 0) {
                    ForEach(p.rows) { r in
                        HStack(spacing: 10) {
                            Text(NFTime.hm(iso: r.time)).font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(NFColor.royal).frame(width: 44, alignment: .leading)
                            Text(r.direction == "in" ? "入金" : r.direction == "out" ? "出金" : "調整")
                                .font(.system(size: 11.5, weight: .bold))
                                .foregroundColor(r.direction == "in" ? NFColor.success : r.direction == "out" ? Color(hex: 0xC27C0E) : NFColor.ink2)
                                .padding(.horizontal, 9).padding(.vertical, 3)
                                .background(Capsule().fill((r.direction == "in" ? NFColor.success : r.direction == "out" ? Color(hex: 0xC27C0E) : NFColor.ink2).opacity(0.12)))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.main).font(.system(size: 13.5)).lineLimit(1)
                                HStack(spacing: 4) {
                                    Text(r.sub).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1)
                                    if r.pending { Text("承認待ち").font(.system(size: 11, weight: .bold)).foregroundColor(Color(hex: 0xC27C0E)) }
                                }
                            }
                            Spacer(minLength: 4)
                            Text("\(r.direction == "in" ? "+" : r.direction == "out" ? "−" : "")\(NT.yen(r.amount))").font(.system(size: 14, weight: .bold)).monospacedDigit()
                            receiptCell(r, p).frame(width: 110, alignment: .trailing)
                            Text(r.createdByName).font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1).frame(width: 64, alignment: .leading)
                        }
                        .padding(.vertical, 10)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    @ViewBuilder private func receiptCell(_ r: NCIoRow, _ p: NCIoPayload) -> some View {
        switch r.receipt {
        case "ok": Text("✓ 写真").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.success)
        case "advanceDone": Text("精算済").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.success)
        case "advanceOpen":
            if p.canPetty { smallBtn("精算へ", filled: false) { onTab("petty") } } else { Text("精算待ち").font(.system(size: 11.5, weight: .bold)).foregroundColor(Color(hex: 0xC27C0E)) }
        case "missing":
            if p.canScan { smallBtn("添付する", filled: false) { onWeb("/app/scan?tx=\(r.id)") } } else { Text("レシート未添付").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink2) }
        default: Text("—").foregroundColor(NFColor.ink3)
        }
    }
}

/// テンキー（7 8 9 / 4 5 6 / 1 2 3 / C 0 00 ⌫）
struct NCKeypad: View {
    let onKey: (String) -> Void
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
            ForEach(["7", "8", "9", "C", "4", "5", "6", "⌫", "1", "2", "3", "00", "0"], id: \.self) { k in
                Button { onKey(k) } label: {
                    Text(k).font(.system(size: 21, weight: .bold)).foregroundColor(k == "C" ? NFColor.danger : NFColor.ink)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NFColor.lilacSoft))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

/// 折り返して並べる（チップ用）
struct NCFlow: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? 600
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxW && x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); w = max(w, x)
        }
        return CGSize(width: min(maxW, w), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX && x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
