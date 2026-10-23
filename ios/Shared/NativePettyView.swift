import SwiftUI

// 入出金の「小口現金」「締め履歴」タブ（ネイティブ）。Web の /app/cash?tab=petty / tab=closings と同じ（2026-10-24）
//   小口現金：開始残高・理論残高・立替残高 ／ 入出金を登録・実残高を数える ／ 期間・承認状態 ／ 一覧（承認・差戻し）／ 実査履歴
//   締め履歴：期間 ／ 一覧（行を開くと 純売上・支払方法別・小口・理論現金／実現金・レジ別内訳）／ 承認・締め後修正・店舗日次締めの再オープン

// MARK: - 共通（タブ・期間・小物）

/// Web の SegmentedTabs（レジ入出金・小口現金・締め履歴）
struct NCCashTabs: View {
    let active: String
    let onTab: (String) -> Void
    var body: some View {
        HStack(spacing: 0) {
            ForEach([("register", "レジ入出金", "Register"), ("petty", "小口現金", "Petty cash"), ("closings", "締め履歴", "Closings")], id: \.0) { key, ja, en in
                Button { if key != active { onTab(key) } } label: {
                    HStack(spacing: 4) {
                        Text(ja).font(.system(size: 14, weight: .bold))
                        Text(en).font(.system(size: 10, weight: .semibold)).opacity(0.75)
                    }
                    .foregroundColor(key == active ? .white : NFColor.ink2)
                    .padding(.horizontal, 14).frame(height: 36)
                    .background(RoundedRectangle(cornerRadius: 9).fill(key == active ? NFColor.iris : Color.clear))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(3).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
    }
}

enum NPDate {
    static let f: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo"); f.locale = Locale(identifier: "en_US_POSIX"); return f }()
    static func date(_ s: String) -> Date { f.date(from: s) ?? Date() }
    static func str(_ d: Date) -> String { f.string(from: d) }
    static func slash(_ s: String) -> String { s.replacingOccurrences(of: "-", with: "/") }
    static func signed(_ v: Int) -> String { (v > 0 ? "+" : "") + NT.yen(v) }
}

private let npSuccess = Color(hex: 0x1E8F62)
private let npWarn = Color(hex: 0xC27C0E)

/// 期間（Web の PeriodFilter）
struct NPPeriod: View {
    @Binding var from: String
    @Binding var to: String
    var body: some View {
        HStack(spacing: 8) {
            Text("期間").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            DatePicker("", selection: Binding(get: { NPDate.date(from) }, set: { from = NPDate.str($0) }), displayedComponents: .date).labelsHidden()
            Text("〜").foregroundColor(NFColor.ink3)
            DatePicker("", selection: Binding(get: { NPDate.date(to) }, set: { to = NPDate.str($0) }), displayedComponents: .date).labelsHidden()
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }
}

struct NPBadge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.system(size: 11.5, weight: .bold)).foregroundColor(color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(0.12)))
    }
}

private func npCard<C: View>(@ViewBuilder _ c: () -> C) -> some View {
    c().background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
}

private func npStat(_ label: String, _ value: String, tone: Color = NFColor.navy, sub: String? = nil, @ViewBuilder extra: () -> some View = { EmptyView() }) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
        Text(value).font(.system(size: 24, weight: .heavy)).monospacedDigit().foregroundColor(tone)
        if let sub { Text(sub).font(.system(size: 11)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true) }
        extra()
    }
    .frame(maxWidth: .infinity, alignment: .leading).padding(14)
    .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
}

private func npBanner(_ t: String) -> some View {
    Text(t).font(.system(size: 13)).foregroundColor(NFColor.royal).fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.wisteria.opacity(0.5), lineWidth: 1))
}

private func npButton(_ t: String, icon: String? = nil, filled: Bool = true, tint: Color = NFColor.iris, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        HStack(spacing: 6) { if let icon { Image(systemName: icon) }; Text(t) }
            .font(.system(size: 14, weight: .bold)).foregroundColor(filled ? .white : tint)
            .padding(.horizontal, 14).frame(height: 40)
            .background(RoundedRectangle(cornerRadius: 10).fill(filled ? tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(filled ? Color.clear : tint.opacity(0.5), lineWidth: 1.2))
    }
    .buttonStyle(PressableStyle())
}

/// 理由の入力（Web の ConfirmDialog requireReason）
struct NPReasonPrompt: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let confirm: String
    let run: (String) async -> Void
}

struct NPReasonSheet: View {
    let prompt: NPReasonPrompt
    let onDone: () -> Void
    @State private var reason = ""
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(prompt.title).font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
            Text(prompt.message).font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
            Text("理由").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            TextField("理由を入力", text: $reason, axis: .vertical).lineLimit(3...6)
                .padding(12).background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            HStack {
                Spacer()
                npButton("キャンセル", filled: false, tint: NFColor.ink2) { onDone() }
                npButton(busy ? "処理中…" : prompt.confirm, tint: NFColor.danger) {
                    guard !reason.trimmingCharacters(in: .whitespaces).isEmpty, !busy else { return }
                    busy = true
                    Task { await prompt.run(reason); busy = false; onDone() }
                }
                .opacity(reason.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
            }
        }
        .padding(24).frame(maxWidth: 560)
    }
}

/// 金額をテンキーで入れる箱
struct NPAmountPad: View {
    let label: String
    @Binding var value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            Text(value.isEmpty ? "0円" : "\(NT.yen(Int(value) ?? 0))").font(.system(size: 28, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy)
                .frame(maxWidth: .infinity, alignment: .trailing).padding(.horizontal, 14).frame(height: 56)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.iris, lineWidth: 1.5))
            NCKeypad { k in
                switch k {
                case "C": value = ""
                case "⌫": value = String(value.dropLast())
                default: if value.count < 8 { value = value == "0" ? k : value + k }; if Int(value) == 0 { value = "" }
                }
            }
        }
    }
}

// MARK: - 小口現金

struct NPPettyRow: Codable, Identifiable {
    let id: String; let businessDate: String; let storeName: String?; let kind: String; let kindLabel: String
    let amount: Int; let purpose: String?; let accountName: String?; let approvalStatus: String; let approvalLabel: String; let requiredRole: String?
}
struct NPCountRow: Codable, Identifiable { let id: String; let countDate: String; let expectedAmount: Int; let countedAmount: Int; let difference: Int; let status: String; let statusLabel: String }
struct NPAdvance: Codable, Identifiable { let id: String; let purpose: String?; let amount: Int; let businessDate: String }
struct NPPettyPayload: Codable {
    let store: NFNamed
    let from: String; let to: String; let status: String
    let canApprove: Bool; let canWrite: Bool; let multiStore: Bool
    let openingBalance: Int; let theoreticalBalance: Int; let advanceBalance: Int
    let accounts: [NFNamed]; let advances: [NPAdvance]; let rows: [NPPettyRow]; let counts: [NPCountRow]
}

@MainActor
final class NativePettyModel: ObservableObject {
    @Published var payload: NPPettyPayload?
    @Published var from = NPDate.str(Date().addingTimeInterval(-30 * 86400))
    @Published var to = NPDate.str(Date())
    @Published var status = ""
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "petty"), URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to), URLQueryItem(name: "status", value: status)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NPPettyPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    @discardableResult
    func act(_ body: [String: Any], ok: String) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return false }
            toast = ok
            await refresh()
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativePettyView: View {
    @ObservedObject var model: NativePettyModel
    let onHome: () -> Void
    let onTab: (String) -> Void

    @State private var showAdd = false
    @State private var showCount = false
    @State private var showOpening = false
    @State private var prompt: NPReasonPrompt?

    private var p: NPPettyPayload? { model.payload }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "入出金", subtitle: "Cash in / out", onHome: onHome)
            HStack { NCCashTabs(active: "petty", onTab: onTab); Spacer() }.padding(.horizontal, 16).padding(.top, 12)
            if let p {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        npBanner("POSの現金売上はレジ台帳（レジ入出金タブ）で管理されます。小口現金は釣銭・経費用の別台帳です。同じ現金を両方に入力しないでください。")
                        HStack(alignment: .top, spacing: 12) {
                            npStat("開始残高", NT.yen(p.openingBalance)) {
                                if p.canApprove { Button("開始残高を編集") { showOpening = true }.font(.system(size: 13, weight: .bold)).padding(.top, 2) }
                            }
                            npStat("理論残高", NT.yen(p.theoreticalBalance), tone: NFColor.royal, sub: p.multiStore ? "基準店舗のみ" : nil)
                            npStat("立替残高（未精算）", NT.yen(p.advanceBalance), tone: p.advanceBalance > 0 ? npWarn : NFColor.navy, sub: "承認済み立替 − 精算の概算（個別の消込は未対応）")
                        }
                        HStack(spacing: 10) {
                            if p.canWrite {
                                npButton("入出金を登録", icon: "plus") { showAdd = true }
                                npButton("実残高を数える", icon: "banknote", filled: false) { showCount = true }
                            }
                            Spacer()
                        }
                        filters
                        if p.rows.isEmpty {
                            empty("小口現金の記録はありません", "期間や絞込条件を変更するか、入出金を登録してください。")
                        } else {
                            npCard { VStack(spacing: 0) { pettyHeader(p); ForEach(p.rows) { r in pettyRow(r, p) } } }
                        }
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("実査履歴").font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
                            Text("Counts").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                        }
                        if p.counts.isEmpty {
                            empty("実査の記録はありません", "「実残高を数える」から実査を記録してください。")
                        } else {
                            npCard { VStack(spacing: 0) { countHeader; ForEach(p.counts) { c in countRow(c, p) } } }
                        }
                    }
                    .padding(16)
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
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task { await model.refresh() }
        .onChange(of: model.from) { _ in Task { await model.refresh() } }
        .onChange(of: model.to) { _ in Task { await model.refresh() } }
        .onChange(of: model.status) { _ in Task { await model.refresh() } }
        .sheet(isPresented: $showAdd) { if let p { NPPettyAddSheet(payload: p, model: model) { showAdd = false } } }
        .sheet(isPresented: $showCount) { if let p { NPPettyCountSheet(expected: p.theoreticalBalance, model: model) { showCount = false } } }
        .sheet(isPresented: $showOpening) { if let p { NPOpeningSheet(current: p.openingBalance, model: model) { showOpening = false } } }
        .sheet(item: $prompt) { pr in NPReasonSheet(prompt: pr) { prompt = nil }.presentationDetents([.medium]) }
    }

    private var filters: some View {
        HStack(spacing: 14) {
            NPPeriod(from: $model.from, to: $model.to)
            Text("承認状態").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            Picker("", selection: $model.status) {
                Text("すべて").tag(""); Text("承認待ち").tag("pending"); Text("承認済み").tag("approved"); Text("差戻し").tag("rejected")
            }
            .pickerStyle(.segmented).frame(maxWidth: 380)
            Spacer()
        }
    }

    private func empty(_ t: String, _ d: String) -> some View {
        npCard {
            VStack(spacing: 6) {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                Text(d).font(.system(size: 13)).foregroundColor(NFColor.ink3)
            }.frame(maxWidth: .infinity).padding(28)
        }
    }

    private func th(_ t: String, _ w: CGFloat? = nil, trailing: Bool = false) -> some View {
        Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            .frame(width: w, alignment: trailing ? .trailing : .leading).frame(maxWidth: w == nil ? .infinity : nil, alignment: trailing ? .trailing : .leading)
    }

    private func pettyHeader(_ p: NPPettyPayload) -> some View {
        HStack(spacing: 10) {
            th("営業日", 92); if p.multiStore { th("店舗", 110) }; th("区分", 130); th("金額", 96, trailing: true); th("用途"); th("勘定科目", 110); th("承認状態", 86); th("操作", 170)
        }
        .padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
    }

    private func pettyRow(_ r: NPPettyRow, _ p: NPPettyPayload) -> some View {
        HStack(spacing: 10) {
            Text(NPDate.slash(r.businessDate)).frame(width: 92, alignment: .leading)
            if p.multiStore { Text(r.storeName ?? "—").lineLimit(1).frame(width: 110, alignment: .leading) }
            HStack(spacing: 4) {
                Text(r.kindLabel)
                if r.kind == "petty_advance" { NPBadge(text: "現金移動なし", color: NFColor.ink3) }
            }.frame(width: 130, alignment: .leading)
            Text(NT.yen(r.amount)).monospacedDigit().fontWeight(.bold).frame(width: 96, alignment: .trailing)
            Text(r.purpose ?? "—").lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            Text(r.accountName ?? "—").lineLimit(1).frame(width: 110, alignment: .leading)
            NPBadge(text: r.approvalLabel, color: r.approvalStatus == "approved" ? npSuccess : r.approvalStatus == "rejected" ? NFColor.danger : npWarn).frame(width: 86, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                if p.canApprove && r.approvalStatus == "pending" {
                    HStack(spacing: 6) {
                        smallBtn("承認", tint: npSuccess, filled: true) { Task { await model.act(["type": "pettyApprove", "id": r.id], ok: "承認しました") } }
                        smallBtn("差戻し", tint: NFColor.danger, filled: false) {
                            prompt = NPReasonPrompt(title: "小口現金の差戻し", message: "差戻し理由を入力してください。", confirm: "差戻す") { reason in
                                await model.act(["type": "pettyReject", "id": r.id, "reason": reason], ok: "差戻しました")
                            }
                        }
                    }
                    if let role = r.requiredRole { Text("要承認: \(role)").font(.system(size: 11)).foregroundColor(NFColor.ink3) }
                }
            }.frame(width: 170, alignment: .leading)
        }
        .font(.system(size: 14)).foregroundColor(NFColor.ink)
        .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 52)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private var countHeader: some View {
        HStack(spacing: 10) { th("実査日", 110); th("理論残高", trailing: true); th("実残高", trailing: true); th("差異", trailing: true); th("状態", 150); th("操作", 100) }
            .padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
    }

    private func countRow(_ c: NPCountRow, _ p: NPPettyPayload) -> some View {
        HStack(spacing: 10) {
            Text(NPDate.slash(c.countDate)).frame(width: 110, alignment: .leading)
            Text(NT.yen(c.expectedAmount)).frame(maxWidth: .infinity, alignment: .trailing)
            Text(NT.yen(c.countedAmount)).frame(maxWidth: .infinity, alignment: .trailing)
            Text(NPDate.signed(c.difference)).fontWeight(.bold).foregroundColor(c.difference != 0 ? NFColor.danger : NFColor.ink).frame(maxWidth: .infinity, alignment: .trailing)
            NPBadge(text: c.statusLabel, color: c.status == "approved" ? npSuccess : npWarn).frame(width: 150, alignment: .leading)
            Group {
                if p.canApprove && c.status == "recorded" {
                    smallBtn("承認する", tint: npSuccess, filled: true) { Task { await model.act(["type": "pettyCountApprove", "id": c.id], ok: "承認しました") } }
                } else { Color.clear }
            }.frame(width: 100, alignment: .leading)
        }
        .font(.system(size: 14)).monospacedDigit().foregroundColor(NFColor.ink)
        .padding(.horizontal, 14).frame(minHeight: 50)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func smallBtn(_ t: String, tint: Color, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(filled ? .white : tint)
                .padding(.horizontal, 12).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(filled ? tint : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(filled ? 0 : 0.5), lineWidth: 1))
        }
        .buttonStyle(PressableStyle()).disabled(model.busy)
    }
}

/// エラーの帯・下のトースト（入出金の画面と同じ）
struct NPToastError: ViewModifier {
    @Binding var error: String?
    @Binding var toast: String?
    let hasPayload: Bool
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let e = error, hasPayload {
                    Button { error = nil } label: {
                        HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e).multilineTextAlignment(.leading); Spacer(); Image(systemName: "xmark") }
                            .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                            .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft)).frame(maxWidth: 720)
                    }
                    .buttonStyle(.plain).padding(.top, 74)
                }
            }
            .overlay(alignment: .bottom) {
                if let t = toast {
                    Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 18).padding(.vertical, 12)
                        .background(Capsule().fill(NFColor.navy.opacity(0.92))).padding(.bottom, 24)
                        .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if toast == t { toast = nil } }
                }
            }
    }
}

/// 小口現金の入出金を登録（Web の PettyCashAddDialog と同じ。用途の文の組み立ても同じ）
struct NPPettyAddSheet: View {
    let payload: NPPettyPayload
    @ObservedObject var model: NativePettyModel
    let onDone: () -> Void

    @State private var kind = "petty_out"
    @State private var amount = ""
    @State private var purpose = ""
    @State private var staffName = ""
    @State private var advanceRef = ""
    @State private var accountId = ""
    @State private var localError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("小口現金の入出金を登録").font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                Button { onDone() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 36, height: 36) }
            }
            .padding(20)
            ScrollView {
                HStack(alignment: .top, spacing: 20) {
                    VStack(alignment: .leading, spacing: 12) {
                        label("区分")
                        Picker("", selection: $kind) {
                            Text("小口出金").tag("petty_out"); Text("小口入金").tag("petty_in"); Text("立替（スタッフの立替）").tag("petty_advance"); Text("精算（立替の払い戻し）").tag("petty_settlement")
                        }
                        .pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).frame(height: 44).background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                        if kind == "petty_advance" {
                            npBanner("立替はスタッフが個人で立て替えた支出の記録です。この登録では店舗の現金は動きません（残高計算には含まれません）。後日「精算」で払い戻す際に現金が減ります。")
                            label("立替者名"); field("例：山田", $staffName)
                        }
                        if kind == "petty_settlement" {
                            npBanner("精算はスタッフへの立替払い戻しです。この登録で小口現金が減ります。")
                            if !payload.advances.isEmpty {
                                label("対象の立替（任意）")
                                Picker("", selection: $advanceRef) {
                                    Text("選択しない").tag("")
                                    ForEach(payload.advances) { a in Text("\(NPDate.slash(a.businessDate)) \(a.purpose ?? "立替") \(NT.yen(a.amount))").tag(a.id) }
                                }
                                .pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 8).frame(height: 44).background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                            }
                        }
                        label(kind == "petty_advance" ? "内容（任意）" : "用途・メモ"); field("", $purpose)
                        label("勘定科目（任意）")
                        Picker("", selection: $accountId) {
                            Text("未選択").tag("")
                            ForEach(payload.accounts) { a in Text(a.name).tag(a.id) }
                        }
                        .pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).frame(height: 44).background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                        if let localError { Text(localError).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                    }
                    .frame(maxWidth: .infinity)
                    NPAmountPad(label: "金額", value: $amount).frame(width: 300)
                }
                .padding(.horizontal, 20)
            }
            HStack {
                Spacer()
                npButton("キャンセル", filled: false, tint: NFColor.ink2) { onDone() }
                npButton(model.busy ? "登録中…" : "登録する") { Task { await submit() } }.disabled(model.busy)
            }
            .padding(20)
        }
        .frame(minWidth: 720, minHeight: 600)
    }

    private func label(_ t: String) -> some View { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2) }
    private func field(_ ph: String, _ b: Binding<String>) -> some View {
        TextField(ph, text: b).font(.system(size: 16)).padding(.horizontal, 12).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
    }

    private func submit() async {
        let value = Int(amount) ?? 0
        let pur = purpose.trimmingCharacters(in: .whitespaces)
        let staff = staffName.trimmingCharacters(in: .whitespaces)
        if value <= 0 { localError = "金額は1円以上の整数で入力してください"; return }
        if kind == "petty_advance" && staff.isEmpty { localError = "立替者名を入力してください"; return }
        if pur.isEmpty && kind != "petty_advance" { localError = "用途・メモを入力してください"; return }
        var final = pur
        if kind == "petty_advance" {
            final = "[立替:\(staff)]\(pur.isEmpty ? "" : " \(pur)")"
        } else if kind == "petty_settlement", let a = payload.advances.first(where: { $0.id == advanceRef }) {
            final = "[精算対象: \(a.purpose ?? "立替")（\(NPDate.slash(a.businessDate))・\(NT.yen(a.amount))）] \(final)"
        }
        localError = nil
        let body: [String: Any] = ["type": "pettyAdd", "kind": kind, "amount": value, "purpose": final, "expenseAccountId": accountId.isEmpty ? NSNull() : accountId]
        if await model.act(body, ok: "登録しました（承認待ち）") { onDone() }
    }
}

/// 実残高を数える（Web の PettyCashCountDialog）
struct NPPettyCountSheet: View {
    let expected: Int
    @ObservedObject var model: NativePettyModel
    let onDone: () -> Void
    @State private var countDate = NPDate.str(Date())
    @State private var counted = ""
    @State private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("実残高を数える").font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                Button { onDone() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 36, height: 36) }
            }
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("実査日").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                    DatePicker("", selection: Binding(get: { NPDate.date(countDate) }, set: { countDate = NPDate.str($0) }), displayedComponents: .date).labelsHidden()
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("理論残高").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        Text(NT.yen(expected)).font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy)
                    }
                    if !counted.isEmpty {
                        let d = (Int(counted) ?? 0) - expected
                        Text("差異: \(NPDate.signed(d))").font(.system(size: 15, weight: .bold)).foregroundColor(d != 0 ? NFColor.danger : npSuccess)
                    }
                    Text("メモ（任意）").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                    TextField("差異の原因など", text: $note, axis: .vertical).lineLimit(2...4)
                        .padding(12).background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                NPAmountPad(label: "実残高", value: $counted).frame(width: 300)
            }
            HStack {
                Spacer()
                npButton("キャンセル", filled: false, tint: NFColor.ink2) { onDone() }
                npButton(model.busy ? "記録中…" : "記録する") {
                    Task {
                        let body: [String: Any] = ["type": "pettyCount", "countDate": countDate, "expectedAmount": expected, "countedAmount": Int(counted) ?? 0, "note": note]
                        if await model.act(body, ok: "実査を記録しました") { onDone() }
                    }
                }
                .disabled(model.busy || counted.isEmpty)
            }
        }
        .padding(20).frame(minWidth: 680)
    }
}

/// 小口現金の開始残高を編集（Web の PettyOpeningBalanceDialog）
struct NPOpeningSheet: View {
    let current: Int
    @ObservedObject var model: NativePettyModel
    let onDone: () -> Void
    @State private var amount = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("小口現金の開始残高を編集").font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                Button { onDone() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 36, height: 36) }
            }
            Text("理論残高の起点になります。変更は監査ログに記録されます。").font(.system(size: 13)).foregroundColor(NFColor.ink3)
            NPAmountPad(label: "開始残高（円）", value: $amount)
            HStack {
                Spacer()
                npButton("キャンセル", filled: false, tint: NFColor.ink2) { onDone() }
                npButton(model.busy ? "保存中…" : "保存する") {
                    Task { if await model.act(["type": "pettyOpening", "amount": Int(amount) ?? 0], ok: "開始残高を更新しました") { onDone() } }
                }
                .disabled(model.busy)
            }
        }
        .padding(20).frame(width: 360)
        .onAppear { amount = current > 0 ? String(current) : "" }
    }
}

// MARK: - 締め履歴

struct NPRegisterLine: Codable, Hashable {
    let registerName: String; let openingFloat: Int; let cashSales: Int; let cashRefunds: Int; let cashIn: Int; let cashOut: Int
    let expectedCash: Int; let countedCash: Int; let difference: Int; let closedByName: String
}
struct NPClosingRow: Codable, Identifiable {
    let id: String; let storeId: String; let businessDate: String; let storeName: String?
    let salesTotal: Int; let ordersCount: Int; let guestsCount: Int; let discountTotal: Int; let refundTotal: Int; let netSales: Int
    let cashDifference: Int; let status: String; let statusLabel: String
    let paymentBreakdown: [String: Int]; let refundBreakdown: [String: Int]
    let pettyInTotal: Int; let pettyOutTotal: Int; let expectedCash: Int?; let countedCash: Int?; let note: String?
    let registerBreakdown: [NPRegisterLine]
}
struct NPClosingsPayload: Codable {
    let store: NFNamed
    let from: String; let to: String
    let showStore: Bool; let canApprove: Bool; let canReopenStoreDay: Bool
    let methodLabels: [String: String]
    let rows: [NPClosingRow]
}

@MainActor
final class NativeClosingsModel: ObservableObject {
    @Published var payload: NPClosingsPayload?
    @Published var from = NPDate.str(Date().addingTimeInterval(-30 * 86400))
    @Published var to = NPDate.str(Date())
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "closings"), URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NPClosingsPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func act(_ body: [String: Any], ok: String) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return }
            toast = ok
            await refresh()
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }
}

struct NativeClosingsView: View {
    @ObservedObject var model: NativeClosingsModel
    let onHome: () -> Void
    let onTab: (String) -> Void

    @State private var expanded: Set<String> = []
    @State private var prompt: NPReasonPrompt?
    private var p: NPClosingsPayload? { model.payload }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "入出金", subtitle: "Cash in / out", onHome: onHome)
            HStack { NCCashTabs(active: "closings", onTab: onTab); Spacer() }.padding(.horizontal, 16).padding(.top, 12)
            if let p {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack { NPPeriod(from: $model.from, to: $model.to); Spacer() }
                        npBanner("締めはその時点のスナップショットです。締め後に発生した返金は、返金が発生した営業日側の集計に計上されます（過去の締めの数値は書き換えられません）。行を開くと純売上・返金内訳・小口入出金・理論現金／実現金の詳細を確認できます。")
                        if p.rows.isEmpty {
                            npCard {
                                VStack(spacing: 6) {
                                    Text("締め履歴はありません").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                                    Text("期間を変更するか、レジ締めを行ってください。").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                                }.frame(maxWidth: .infinity).padding(28)
                            }
                        } else {
                            npCard {
                                VStack(spacing: 0) {
                                    header(p)
                                    ForEach(p.rows) { r in
                                        row(r, p)
                                        if expanded.contains(r.id) { detail(r, p) }
                                    }
                                }
                            }
                        }
                    }
                    .padding(16)
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
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task { await model.refresh() }
        .onChange(of: model.from) { _ in Task { await model.refresh() } }
        .onChange(of: model.to) { _ in Task { await model.refresh() } }
        .sheet(item: $prompt) { pr in NPReasonSheet(prompt: pr) { prompt = nil }.presentationDetents([.medium]) }
    }

    private func th(_ t: String, _ w: CGFloat? = nil, trailing: Bool = false) -> some View {
        Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            .frame(width: w, alignment: trailing ? .trailing : .leading).frame(maxWidth: w == nil ? .infinity : nil, alignment: trailing ? .trailing : .leading)
    }

    private func header(_ p: NPClosingsPayload) -> some View {
        HStack(spacing: 10) {
            th("", 18); th("営業日", 96); if p.showStore { th("店舗", 110) }
            th("総売上", trailing: true); th("純売上", trailing: true); th("件数", 60, trailing: true); th("客数", 60, trailing: true); th("現金差異", trailing: true); th("状態", 170); th("操作", 220)
        }
        .padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
    }

    private func row(_ r: NPClosingRow, _ p: NPClosingsPayload) -> some View {
        let legacy = r.expectedCash == nil
        let tone: Color = r.status == "approved" ? npSuccess : r.status == "reopened" ? npWarn : NFColor.royal
        return HStack(spacing: 10) {
            Image(systemName: expanded.contains(r.id) ? "chevron.down" : "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 18)
            Text(NPDate.slash(r.businessDate)).fontWeight(.bold).foregroundColor(NFColor.navy).frame(width: 96, alignment: .leading)
            if p.showStore { Text(r.storeName ?? "—").lineLimit(1).frame(width: 110, alignment: .leading) }
            Text(NT.yen(r.salesTotal)).frame(maxWidth: .infinity, alignment: .trailing)
            Text(legacy ? "—" : NT.yen(r.netSales)).fontWeight(.bold).frame(maxWidth: .infinity, alignment: .trailing)
            Text("\(r.ordersCount)件").frame(width: 60, alignment: .trailing)
            Text("\(r.guestsCount)名").frame(width: 60, alignment: .trailing)
            Text(NPDate.signed(r.cashDifference)).fontWeight(.bold).foregroundColor(r.cashDifference != 0 ? NFColor.danger : NFColor.ink).frame(maxWidth: .infinity, alignment: .trailing)
            NPBadge(text: r.statusLabel, color: tone).frame(width: 170, alignment: .leading)
            HStack(spacing: 6) {
                if p.canApprove && (r.status == "closed" || r.status == "reopened") {
                    small("承認する", tint: npSuccess, filled: true) { Task { await model.act(["type": "closingApprove", "id": r.id], ok: "承認しました") } }
                }
                if p.canApprove && r.status == "approved" {
                    small("締め後修正", tint: NFColor.royal, filled: false) {
                        prompt = NPReasonPrompt(title: "締め後修正", message: "承認済みの締めを修正待ち（reopened）に戻します。理由は監査ログに記録されます。数値の直接編集はできません。", confirm: "修正する") { reason in
                            await model.act(["type": "closingReopen", "id": r.id, "reason": reason], ok: "締め後修正として登録しました")
                        }
                    }
                }
                if p.canReopenStoreDay && (r.status == "closed" || r.status == "approved") {
                    small("店舗日次締めを再オープン", tint: NFColor.danger, filled: false) {
                        prompt = NPReasonPrompt(title: "店舗日次締めを再オープン", message: "この日の店舗日次締め（daily_closings）を再オープン（reopened）状態に戻します。レジ締めをやり直してから、再度「店舗日次締めを実行」してください。理由は監査ログに記録されます（reopen_store_day）。", confirm: "再オープンする") { reason in
                            await model.act(["type": "closingReopenStoreDay", "storeId": r.storeId, "businessDate": r.businessDate, "reason": reason], ok: "店舗日次締めを再オープンしました")
                        }
                    }
                }
            }
            .frame(width: 220, alignment: .leading)
        }
        .font(.system(size: 14)).monospacedDigit().foregroundColor(NFColor.ink)
        .padding(.horizontal, 14).frame(minHeight: 54)
        .contentShape(Rectangle())
        .onTapGesture { if expanded.contains(r.id) { expanded.remove(r.id) } else { expanded.insert(r.id) } }
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    /// Web の ClosingSnapshot
    private func detail(_ r: NPClosingRow, _ p: NPClosingsPayload) -> some View {
        let legacy = r.expectedCash == nil
        let pay = r.paymentBreakdown.filter { $0.value != 0 }.sorted { $0.key < $1.key }
        let ref = r.refundBreakdown.filter { $0.value != 0 }.sorted { $0.key < $1.key }
        let lines = r.registerBreakdown
        func sum(_ k: KeyPath<NPRegisterLine, Int>) -> Int { lines.reduce(0) { $0 + $1[keyPath: k] } }
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                npStat("総売上（gross）", NT.yen(r.salesTotal))
                npStat("値引", NT.yen(r.discountTotal))
                npStat("返金", NT.yen(r.refundTotal), tone: r.refundTotal > 0 ? npWarn : NFColor.navy)
                npStat("純売上", legacy ? "—" : NT.yen(r.netSales), tone: NFColor.royal)
            }
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("支払方法別内訳（売上）").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                    if pay.isEmpty { Text("データがありません").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                    ForEach(pay, id: \.key) { k, v in HStack { Text(p.methodLabels[k] ?? k).foregroundColor(NFColor.ink2); Spacer(); Text(NT.yen(v)).fontWeight(.bold).foregroundColor(NFColor.navy) }.font(.system(size: 14)) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 6) {
                    Text("支払方法別内訳（返金）").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                    if legacy { Text("—（旧データのため記録なし）").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                    else if ref.isEmpty { Text("返金はありません").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                    else { ForEach(ref, id: \.key) { k, v in HStack { Text(p.methodLabels[k] ?? k).foregroundColor(NFColor.ink2); Spacer(); Text(NT.yen(v)).fontWeight(.bold).foregroundColor(NFColor.danger) }.font(.system(size: 14)) } }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .top, spacing: 10) {
                npStat("小口入金", legacy ? "—" : NT.yen(r.pettyInTotal))
                npStat("小口出金", legacy ? "—" : NT.yen(r.pettyOutTotal))
                npStat("理論現金", legacy ? "—" : NT.yen(r.expectedCash ?? 0), tone: NFColor.royal, sub: "開始現金＋現金売上＋入金－現金返金－小口出金")
                npStat("実現金", r.countedCash.map { NT.yen($0) } ?? "—")
            }
            if !lines.isEmpty {
                Text("レジ別内訳（\(lines.count)台）").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                VStack(spacing: 0) {
                    regLine(["レジ", "開始現金", "現金売上", "現金返金", "入金", "出金", "理論現金", "実現金", "差異", "締め担当"], head: true, diff: 0)
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                        regLine([l.registerName, NT.yen(l.openingFloat), NT.yen(l.cashSales), NT.yen(l.cashRefunds), NT.yen(l.cashIn), NT.yen(l.cashOut), NT.yen(l.expectedCash), NT.yen(l.countedCash), NPDate.signed(l.difference), l.closedByName], head: false, diff: l.difference)
                    }
                    regLine(["店舗合計", NT.yen(sum(\.openingFloat)), NT.yen(sum(\.cashSales)), NT.yen(sum(\.cashRefunds)), NT.yen(sum(\.cashIn)), NT.yen(sum(\.cashOut)), NT.yen(sum(\.expectedCash)), NT.yen(sum(\.countedCash)), NPDate.signed(sum(\.difference)), ""], head: false, diff: sum(\.difference), total: true)
                }
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("クレジット／QRコード決済等の返金は現金残高へ影響しません。理論現金の計算に含まれるのは現金返金のみです。")
                Text("この数値は締め実行時点のスナップショットです。締め後に発生した返金は、返金が発生した営業日側の集計に計上されます（この日の数値は遡って変わりません）。")
                if legacy {
                    Text("この締めは純売上・返金内訳・小口入出金・理論現金／実現金の記録が追加される前に実行されたため、該当項目は「—」表示です（0円ではありません）。").fontWeight(.bold).foregroundColor(npWarn)
                }
            }
            .font(.system(size: 12)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft))
            if let note = r.note {
                Text(note).font(.system(size: 12)).foregroundColor(NFColor.ink2).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            }
        }
        .padding(16)
        .background(Color(hex: 0xF7F7FA))
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func regLine(_ cols: [String], head: Bool, diff: Int, total: Bool = false) -> some View {
        HStack(spacing: 6) {
            ForEach(Array(cols.enumerated()), id: \.offset) { i, c in
                Text(c).lineLimit(1).minimumScaleFactor(0.8)
                    .font(.system(size: head ? 11.5 : 13, weight: head || total || i == 0 ? .bold : .regular))
                    .foregroundColor(head ? NFColor.ink3 : i == 8 && diff != 0 ? NFColor.danger : NFColor.navy)
                    .frame(maxWidth: .infinity, alignment: i == 0 || i == 9 ? .leading : .trailing)
            }
        }
        .monospacedDigit()
        .padding(.horizontal, 12).frame(height: 36)
        .background(head ? NFColor.lilacSoft : total ? Color(hex: 0xF3F3F7) : Color.clear)
        .overlay(alignment: .top) { if !head { Rectangle().fill(NFColor.line).frame(height: 1) } }
    }

    private func small(_ t: String, tint: Color, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 12.5, weight: .bold)).foregroundColor(filled ? .white : tint).lineLimit(1)
                .padding(.horizontal, 10).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(filled ? tint : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(filled ? 0 : 0.5), lineWidth: 1))
        }
        .buttonStyle(PressableStyle()).disabled(model.busy)
    }
}
