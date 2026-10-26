import SwiftUI

// iPhone の店長・オーナー：入出金の「小口現金」「締め履歴」タブ（Web の /app/cash?tab=petty ／ tab=closings。2026-10-25）
// サーバーは iPad と同じ（返事の形は変えない）：
//   小口現金  GET ?part=petty&from&to&status ／ POST pettyAdd・pettyApprove・pettyReject・pettyOpening・pettyCount・pettyCountApprove
//   締め履歴  GET ?part=closings&from&to ／ POST closingApprove・closingReopen・closingReopenStoreDay
// 用途の文の組み立て（立替・精算）は iPad・Web の PettyCashAddDialog と同じ。

/// GET ?part=petty の中身（使うところだけ）
struct NOMPetty: Decodable {
    struct Advance: Decodable, Hashable, Identifiable {
        let id: String
        let purpose: String?
        let amount: Double
        let businessDate: String
    }
    struct Row: Decodable, Hashable, Identifiable {
        let id: String
        let businessDate: String
        let storeName: String?
        let kind: String
        let kindLabel: String
        let amount: Double
        let purpose: String?
        let accountName: String?
        let approvalStatus: String
        let approvalLabel: String
        let requiredRole: String?
    }
    struct Count: Decodable, Hashable, Identifiable {
        let id: String
        let countDate: String
        let expectedAmount: Double
        let countedAmount: Double
        let difference: Double
        let status: String
        let statusLabel: String
    }
    let store: NOMNamed
    let from: String
    let to: String
    let status: String
    let canApprove: Bool
    let canWrite: Bool
    let multiStore: Bool
    let openingBalance: Double
    let theoreticalBalance: Double
    let advanceBalance: Double
    let accounts: [NOMNamed]
    let advances: [Advance]
    let rows: [Row]
    let counts: [Count]
}

/// GET ?part=closings の中身（使うところだけ）
struct NOMClosings: Decodable {
    struct Line: Decodable, Hashable {
        let registerName: String
        let openingFloat: Double
        let cashSales: Double
        let cashRefunds: Double
        let cashIn: Double
        let cashOut: Double
        let expectedCash: Double
        let countedCash: Double
        let difference: Double
        let closedByName: String?
    }
    struct Row: Decodable, Hashable, Identifiable {
        let id: String
        let storeId: String
        let businessDate: String
        let storeName: String?
        let salesTotal: Double
        let ordersCount: Double
        let guestsCount: Double
        let discountTotal: Double
        let refundTotal: Double
        let netSales: Double
        let cashDifference: Double
        let status: String
        let statusLabel: String
        let paymentBreakdown: [String: Double]
        let refundBreakdown: [String: Double]
        let pettyInTotal: Double
        let pettyOutTotal: Double
        let expectedCash: Double?
        let countedCash: Double?
        let note: String?
        let registerBreakdown: [Line]
    }
    let store: NOMNamed
    let from: String
    let to: String
    let showStore: Bool
    let canApprove: Bool
    let canReopenStoreDay: Bool
    let methodLabels: [String: String]
    let rows: [Row]
}

@MainActor
final class NOMPettyModel: ObservableObject {
    @Published var payload: NOMPetty?
    @Published var from = NOS.addDays(NOS.today, -30)
    @Published var to = NOS.today
    @Published var status = ""
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false

    static let statuses: [(key: String, label: String)] = [("", "すべて"), ("pending", "承認待ち"), ("approved", "承認済み"), ("rejected", "差戻し")]

    private var query: [String: String] { ["from": from, "to": to, "status": status] }

    func refresh() async {
        if NativePreview.current != nil { return }
        let q = query
        if payload == nil || payload?.from != from || payload?.to != to || payload?.status != status,
           let saved = NativeModuleAPI.cached(NOMPetty.self, part: "petty", query: q) { payload = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOMPetty.self, part: "petty", query: q)
            guard q == query else { return }
            payload = p
            error = nil
        } catch {
            guard q == query else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    func setPeriod(_ f: String, _ t: String) {
        from = f
        to = t
        Task { await refresh() }
    }

    func setStatus(_ s: String) {
        status = s
        Task { await refresh() }
    }

    /// 操作（iPad と同じ POST）。nil＝うまくいった、文字＝エラー
    func act(_ body: [String: Any], ok: String) async -> String? {
        busy = true
        defer { busy = false }
        let r = await NOM.post(body)
        guard r.ok else { return r.error ?? "うまくいきませんでした" }
        toast = ok
        await refresh()
        return nil
    }
}

@MainActor
final class NOMClosingsModel: ObservableObject {
    @Published var payload: NOMClosings?
    @Published var from = NOS.addDays(NOS.today, -30)
    @Published var to = NOS.today
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    /// 開いている締め（詳細を出す）
    @Published var expanded: Set<String> = []

    private var query: [String: String] { ["from": from, "to": to] }

    func refresh() async {
        if NativePreview.current != nil { return }
        let q = query
        if payload == nil || payload?.from != from || payload?.to != to,
           let saved = NativeModuleAPI.cached(NOMClosings.self, part: "closings", query: q) { payload = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOMClosings.self, part: "closings", query: q)
            guard q == query else { return }
            payload = p
            error = nil
        } catch {
            guard q == query else { return }
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    func setPeriod(_ f: String, _ t: String) {
        from = f
        to = t
        Task { await refresh() }
    }

    func act(_ body: [String: Any], ok: String) async -> String? {
        busy = true
        defer { busy = false }
        let r = await NOM.post(body)
        guard r.ok else { return r.error ?? "うまくいきませんでした" }
        toast = ok
        await refresh()
        return nil
    }
}

// MARK: - 小口現金タブ

struct NOMPettyTab: View {
    @ObservedObject var model: NOMPettyModel
    let onOpen: (String) -> Void

    @State private var rangeOpen = false
    @State private var addOpen = false
    @State private var countOpen = false
    @State private var openingOpen = false
    @State private var prompt: NOMReasonPrompt?

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
        .sheet(isPresented: $rangeOpen) {
            NOMRangeSheet(from: model.from, to: model.to, onClose: { rangeOpen = false }) { f, t in
                rangeOpen = false
                model.setPeriod(f, t)
            }
            .presentationDetents([.medium])
            .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $addOpen) {
            if let p = model.payload {
                NOMPettyAddSheet(model: model, payload: p, onClose: { addOpen = false })
                    .presentationDetents([.large])
                    .environment(\.colorScheme, .light)
            }
        }
        .sheet(isPresented: $countOpen) {
            if let p = model.payload {
                NOMPettyCountSheet(model: model, expected: p.theoreticalBalance, onClose: { countOpen = false })
                    .presentationDetents([.large])
                    .environment(\.colorScheme, .light)
            }
        }
        .sheet(isPresented: $openingOpen) {
            if let p = model.payload {
                NOMPettyOpeningSheet(model: model, current: p.openingBalance, onClose: { openingOpen = false })
                    .presentationDetents([.large])
                    .environment(\.colorScheme, .light)
            }
        }
        .sheet(item: $prompt) { pr in
            NOMReasonSheet(prompt: pr, onDone: { prompt = nil })
                .presentationDetents([.medium, .large])
                .environment(\.colorScheme, .light)
        }
    }

    private func content(_ p: NOMPetty) -> some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                balances(p)
                if p.canWrite {
                    HStack(spacing: 8) {
                        NOMButton(title: "入出金を登録", icon: "plus") { addOpen = true }
                        NOMButton(title: "実残高を数える", icon: "banknote", filled: false) { countOpen = true }
                    }
                }
                NOMNote(text: "POS の現金売上はレジ台帳（レジ入出金タブ）で管理されます。小口現金は釣銭・経費用の別台帳です。同じ現金を両方に入力しないでください。")
                NOMPeriodCard(from: model.from, to: model.to, onPick: { rangeOpen = true }, onSet: { f, t in model.setPeriod(f, t) })
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(NOMPettyModel.statuses, id: \.0) { s in
                            NOMChip(title: s.label, on: model.status == s.key) { model.setStatus(s.key) }
                        }
                    }
                    .padding(.vertical, 1)
                }
                if p.rows.isEmpty {
                    NOMEmpty(icon: "tray", title: "小口現金の記録はありません", sub: "期間や絞り込みを変えるか、入出金を登録してください。")
                } else {
                    ForEach(p.rows) { r in pettyRow(r, p) }
                }
                HStack {
                    NOMTitle(ja: "実査履歴", en: "Counts")
                    Spacer()
                }
                .padding(.top, 6)
                if p.counts.isEmpty {
                    NOMEmpty(icon: "banknote", title: "実査の記録はありません", sub: "「実残高を数える」から記録できます。")
                } else {
                    ForEach(p.counts) { c in countRow(c, p) }
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    private func balances(_ p: NOMPetty) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("理論残高").font(.system(size: 12.5, weight: .bold)).foregroundColor(.white.opacity(0.85))
                Text(NOS.yen(p.theoreticalBalance)).font(.system(size: 30, weight: NT.strong)).foregroundColor(.white).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                if p.multiStore { Text("基準店舗のみ").font(.system(size: 11)).foregroundColor(.white.opacity(0.8)) }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    NOMStat(label: "開始残高", value: NOS.yen(p.openingBalance))
                    if p.canApprove {
                        Button { openingOpen = true } label: {
                            Text("開始残高を編集").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purpleDeep)
                        }
                        .buttonStyle(.plain)
                        .padding(.leading, 4)
                    }
                }
                NOMStat(label: "立替残高（未精算）", value: NOS.yen(p.advanceBalance), tone: p.advanceBalance > 0 ? NT.warn : NT.ink, sub: "承認済み立替 − 精算の概算")
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func pettyRow(_ r: NOMPetty.Row, _ p: NOMPetty) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(NOS.mdw(r.businessDate)).font(.system(size: 13, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                NOSBadge(text: r.kindLabel, color: NT.ink2)
                if r.kind == "petty_advance" { NOSBadge(text: "現金移動なし", color: NT.ink3) }
                Spacer(minLength: 4)
                Text(NOS.yen(r.amount)).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            Text(r.purpose ?? "—").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(3)
            HStack(spacing: 6) {
                NOSBadge(text: r.approvalLabel, color: NOM.approvalColor(r.approvalStatus))
                if let a = r.accountName, !a.isEmpty { Text(a).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1) }
                if p.multiStore, let s = r.storeName { Text(s).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1) }
                Spacer(minLength: 0)
            }
            if p.canApprove && r.approvalStatus == "pending" {
                HStack(spacing: 8) {
                    NOMSmallButton(title: "承認", filled: true, tint: NT.ok) {
                        Task { if let e = await model.act(["type": "pettyApprove", "id": r.id], ok: "承認しました") { model.error = e } }
                    }
                    NOMSmallButton(title: "差戻し", tint: NT.danger) {
                        prompt = NOMReasonPrompt(title: "小口現金の差戻し", message: "差戻し理由を入力してください。", confirm: "差戻す") { reason in
                            await model.act(["type": "pettyReject", "id": r.id, "reason": reason], ok: "差戻しました")
                        }
                    }
                    Spacer(minLength: 0)
                    if let role = r.requiredRole { Text("要承認: \(role)").font(.system(size: 11)).foregroundColor(NT.ink3) }
                }
                .disabled(model.busy)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }

    private func countRow(_ c: NOMPetty.Count, _ p: NOMPetty) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(NOS.mdw(c.countDate)).font(.system(size: 13, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                NOSBadge(text: c.statusLabel, color: c.status == "approved" ? NT.ok : NT.warn)
                Spacer(minLength: 4)
                Text(NOM.signed(c.difference)).font(.system(size: 16, weight: NT.strong)).foregroundColor(c.difference != 0 ? NT.danger : NT.ok).monospacedDigit()
            }
            HStack(spacing: 8) {
                NOMStat(label: "理論残高", value: NOS.yen(c.expectedAmount))
                NOMStat(label: "実残高", value: NOS.yen(c.countedAmount))
            }
            if p.canApprove && c.status == "recorded" {
                NOMSmallButton(title: "承認する", filled: true, tint: NT.ok) {
                    Task { if let e = await model.act(["type": "pettyCountApprove", "id": c.id], ok: "承認しました") { model.error = e } }
                }
                .disabled(model.busy)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }
}

// MARK: - 小口現金の入出金を登録（Web の PettyCashAddDialog と同じ。用途の文の組み立ても同じ）

struct NOMPettyAddSheet: View {
    @ObservedObject var model: NOMPettyModel
    let payload: NOMPetty
    let onClose: () -> Void

    @State private var kind = "petty_out"
    @State private var amount = ""
    @State private var purpose = ""
    @State private var staffName = ""
    @State private var advanceRef = ""
    @State private var accountId = ""
    @State private var problem: String?

    private static let kinds: [(String, String)] = [("petty_out", "小口出金"), ("petty_in", "小口入金"), ("petty_advance", "立替"), ("petty_settlement", "精算")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("区分").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        WrapLayout(spacing: 6) {
                            ForEach(Self.kinds, id: \.0) { k in
                                NOMChip(title: k.1, on: kind == k.0) { kind = k.0 }
                            }
                        }
                    }
                    if kind == "petty_advance" {
                        NOMNote(text: "立替はスタッフが個人で立て替えた支出の記録です。この登録では店舗の現金は動きません（残高計算には含まれません）。後日「精算」で払い戻す際に現金が減ります。")
                        field("立替者名（必須）", "例：山田", $staffName)
                    }
                    if kind == "petty_settlement" {
                        NOMNote(text: "精算はスタッフへの立替払い戻しです。この登録で小口現金が減ります。")
                        if !payload.advances.isEmpty { advancePicker }
                    }
                    field(kind == "petty_advance" ? "内容（任意）" : "用途・メモ（必須）", kind == "petty_out" ? "例：洗剤・ゴミ袋" : "", $purpose)
                    accountPicker
                    NOMAmountBox(label: "金額", value: amount, active: true) {}
                    NOMKeypad(text: $amount, maxLength: 8)
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    }
                    NOMButton(title: model.busy ? "登録中…" : "登録する", height: 56, enabled: !model.busy) { Task { await submit() } }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NT.page.ignoresSafeArea())
            .navigationTitle("小口現金の入出金を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }

    private func field(_ label: String, _ placeholder: String, _ b: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            TextField(placeholder, text: b)
                .font(.system(size: 16))
                .padding(.horizontal, 12).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    private var advancePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("対象の立替（任意）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            Menu {
                Button { advanceRef = "" } label: { if advanceRef.isEmpty { Label("選択しない", systemImage: "checkmark") } else { Text("選択しない") } }
                ForEach(payload.advances) { a in
                    let name = advanceName(a)
                    Button { advanceRef = a.id } label: { if advanceRef == a.id { Label(name, systemImage: "checkmark") } else { Text(name) } }
                }
            } label: {
                pickerLabel(payload.advances.first(where: { $0.id == advanceRef }).map { advanceName($0) } ?? "選択しない")
            }
        }
    }

    private func advanceName(_ a: NOMPetty.Advance) -> String {
        "\(NOM.slash(a.businessDate)) \(a.purpose ?? "立替") \(NOS.yen(a.amount))"
    }

    private var accountPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("勘定科目（任意）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            Menu {
                Button { accountId = "" } label: { if accountId.isEmpty { Label("未選択", systemImage: "checkmark") } else { Text("未選択") } }
                ForEach(payload.accounts) { a in
                    Button { accountId = a.id } label: { if accountId == a.id { Label(a.name, systemImage: "checkmark") } else { Text(a.name) } }
                }
            } label: {
                pickerLabel(payload.accounts.first { $0.id == accountId }?.name ?? "未選択")
            }
        }
    }

    private func pickerLabel(_ text: String) -> some View {
        HStack {
            Text(text).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 12).frame(height: 46)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func submit() async {
        let value = Int(amount) ?? 0
        let pur = purpose.trimmingCharacters(in: .whitespaces)
        let staff = staffName.trimmingCharacters(in: .whitespaces)
        if value <= 0 { problem = "金額は1円以上の整数で入力してください"; return }
        if kind == "petty_advance" && staff.isEmpty { problem = "立替者名を入力してください"; return }
        if pur.isEmpty && kind != "petty_advance" { problem = "用途・メモを入力してください"; return }
        var final = pur
        if kind == "petty_advance" {
            final = "[立替:\(staff)]\(pur.isEmpty ? "" : " \(pur)")"
        } else if kind == "petty_settlement", let a = payload.advances.first(where: { $0.id == advanceRef }) {
            final = "[精算対象: \(a.purpose ?? "立替")（\(NOM.slash(a.businessDate))・\(NT.yen(Int(a.amount.rounded())))）] \(final)"
        }
        problem = nil
        let body: [String: Any] = ["type": "pettyAdd", "kind": kind, "amount": value, "purpose": final, "expenseAccountId": accountId.isEmpty ? NSNull() : accountId]
        if let e = await model.act(body, ok: "登録しました（承認待ち）") { problem = e; return }
        onClose()
    }
}

/// 実残高を数える（Web の PettyCashCountDialog）
struct NOMPettyCountSheet: View {
    @ObservedObject var model: NOMPettyModel
    let expected: Double
    let onClose: () -> Void
    @State private var countDate = Date()
    @State private var counted = ""
    @State private var note = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    DatePicker("実査日", selection: $countDate, displayedComponents: .date)
                        .font(.system(size: 15, weight: .bold))
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                        .padding(.horizontal, 12).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    HStack(spacing: 8) {
                        NOMStat(label: "理論残高", value: NOS.yen(expected))
                        let d = (Double(counted) ?? 0) - expected
                        NOMStat(label: "差異", value: counted.isEmpty ? "—" : NOM.signed(d), tone: counted.isEmpty ? NT.ink3 : (Int(d.rounded()) != 0 ? NT.danger : NT.ok))
                    }
                    NOMAmountBox(label: "実残高（数えた現金）", value: counted, active: true) {}
                    NOMKeypad(text: $counted, maxLength: 8)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("メモ（任意）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        TextField("差異の原因など", text: $note, axis: .vertical)
                            .lineLimit(2...4)
                            .font(.system(size: 16))
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    }
                    NOMButton(title: model.busy ? "記録中…" : "記録する", height: 56, enabled: !model.busy && !counted.isEmpty) {
                        Task {
                            let body: [String: Any] = ["type": "pettyCount", "countDate": NOS.str(countDate), "expectedAmount": Int(expected.rounded()), "countedAmount": Int(counted) ?? 0, "note": note]
                            if let e = await model.act(body, ok: "実査を記録しました") { problem = e } else { onClose() }
                        }
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NT.page.ignoresSafeArea())
            .navigationTitle("実残高を数える")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }
}

/// 小口現金の開始残高を編集（Web の PettyOpeningBalanceDialog）
struct NOMPettyOpeningSheet: View {
    @ObservedObject var model: NOMPettyModel
    let current: Double
    let onClose: () -> Void
    @State private var amount = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    NOMNote(text: "理論残高の起点になります。変更は監査ログに記録されます。")
                    NOMAmountBox(label: "開始残高", value: amount, active: true) {}
                    NOMKeypad(text: $amount, maxLength: 8)
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    }
                    NOMButton(title: model.busy ? "保存中…" : "保存する", height: 56, enabled: !model.busy) {
                        Task {
                            if let e = await model.act(["type": "pettyOpening", "amount": Int(amount) ?? 0], ok: "開始残高を更新しました") { problem = e } else { onClose() }
                        }
                    }
                }
                .padding(16)
            }
            .background(NT.page.ignoresSafeArea())
            .navigationTitle("開始残高を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
        .onAppear { if amount.isEmpty && current > 0 { amount = String(Int(current.rounded())) } }
    }
}

// MARK: - 締め履歴タブ

struct NOMClosingsTab: View {
    @ObservedObject var model: NOMClosingsModel
    @State private var rangeOpen = false
    @State private var prompt: NOMReasonPrompt?

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
        .sheet(isPresented: $rangeOpen) {
            NOMRangeSheet(from: model.from, to: model.to, onClose: { rangeOpen = false }) { f, t in
                rangeOpen = false
                model.setPeriod(f, t)
            }
            .presentationDetents([.medium])
            .environment(\.colorScheme, .light)
        }
        .sheet(item: $prompt) { pr in
            NOMReasonSheet(prompt: pr, onDone: { prompt = nil })
                .presentationDetents([.medium, .large])
                .environment(\.colorScheme, .light)
        }
    }

    private func content(_ p: NOMClosings) -> some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                NOMPeriodCard(from: model.from, to: model.to, onPick: { rangeOpen = true }, onSet: { f, t in model.setPeriod(f, t) })
                if p.rows.isEmpty {
                    NOMEmpty(icon: "lock.doc", title: "締め履歴はありません", sub: "期間を変えるか、レジ締めを行ってください。")
                } else {
                    ForEach(p.rows) { r in closingCard(r, p) }
                }
                NOMNote(text: "締めはその時点のスナップショットです。締め後に発生した返金は、返金が発生した営業日側の集計に計上されます（過去の締めの数値は書き換えられません）。カードを押すと純売上・返金内訳・小口入出金・理論現金／実現金の詳細が見られます。")
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    private func tone(_ status: String) -> Color {
        status == "approved" ? NT.ok : status == "reopened" ? NT.warn : NT.purple
    }

    private func closingCard(_ r: NOMClosings.Row, _ p: NOMClosings) -> some View {
        let open = model.expanded.contains(r.id)
        let legacy = r.expectedCash == nil
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                if open { model.expanded.remove(r.id) } else { model.expanded.insert(r.id) }
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Text(NOS.mdw(r.businessDate)).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                        if p.showStore, let s = r.storeName { Text(s).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1) }
                        Spacer(minLength: 4)
                        NOSBadge(text: r.statusLabel, color: tone(r.status))
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("純売上").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                            Text(legacy ? "—" : NOS.yen(r.netSales)).font(.system(size: 24, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 0) {
                            Text("現金差異").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                            Text(NOM.signed(r.cashDifference)).font(.system(size: 18, weight: NT.strong)).foregroundColor(r.cashDifference != 0 ? NT.danger : NT.ok).monospacedDigit()
                        }
                    }
                    HStack(spacing: 10) {
                        Text("総売上 \(NOS.yen(r.salesTotal))")
                        Text("\(NOS.int(r.ordersCount))件")
                        Text("\(NOS.int(r.guestsCount))名")
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { detail(r, p) }
            actions(r, p)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    /// Web の ClosingSnapshot（スマホは縦に並べる）
    private func detail(_ r: NOMClosings.Row, _ p: NOMClosings) -> some View {
        let legacy = r.expectedCash == nil
        let pay = r.paymentBreakdown.filter { $0.value != 0 }.sorted { $0.key < $1.key }
        let ref = r.refundBreakdown.filter { $0.value != 0 }.sorted { $0.key < $1.key }
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return VStack(alignment: .leading, spacing: 12) {
            Rectangle().fill(NT.line).frame(height: 1)
            LazyVGrid(columns: cols, spacing: 8) {
                NOMStat(label: "総売上（gross）", value: NOS.yen(r.salesTotal))
                NOMStat(label: "値引", value: NOS.yen(r.discountTotal))
                NOMStat(label: "返金", value: NOS.yen(r.refundTotal), tone: r.refundTotal > 0 ? NT.warn : NT.ink)
                NOMStat(label: "純売上", value: legacy ? "—" : NOS.yen(r.netSales), tone: NT.purpleDeep)
            }
            breakdown("支払方法別内訳（売上）", pay.map { (p.methodLabels[$0.key] ?? $0.key, $0.value) }, empty: "データがありません", color: NT.ink)
            if legacy {
                breakdown("支払方法別内訳（返金）", [], empty: "—（旧データのため記録なし）", color: NT.danger)
            } else {
                breakdown("支払方法別内訳（返金）", ref.map { (p.methodLabels[$0.key] ?? $0.key, $0.value) }, empty: "返金はありません", color: NT.danger)
            }
            LazyVGrid(columns: cols, spacing: 8) {
                NOMStat(label: "小口入金", value: legacy ? "—" : NOS.yen(r.pettyInTotal))
                NOMStat(label: "小口出金", value: legacy ? "—" : NOS.yen(r.pettyOutTotal))
                NOMStat(label: "理論現金", value: legacy ? "—" : NOS.yen(r.expectedCash ?? 0), tone: NT.purpleDeep, sub: "開始現金＋現金売上＋入金－現金返金－小口出金")
                NOMStat(label: "実現金", value: r.countedCash.map { NOS.yen($0) } ?? "—")
            }
            if !r.registerBreakdown.isEmpty {
                Text("レジ別内訳（\(r.registerBreakdown.count)台）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                ForEach(Array(r.registerBreakdown.enumerated()), id: \.offset) { _, l in registerLine(l) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("クレジット／QRコード決済等の返金は現金残高へ影響しません。理論現金の計算に含まれるのは現金返金のみです。")
                if legacy {
                    Text("この締めは純売上・返金内訳・小口入出金・理論現金／実現金の記録が追加される前に実行されたため、該当項目は「—」表示です（0円ではありません）。")
                        .fontWeight(.bold).foregroundColor(NT.warn)
                }
            }
            .font(.system(size: 11.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading).padding(10)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            if let note = r.note, !note.isEmpty {
                Text(note).font(.system(size: 12)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10).background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.lilac))
            }
        }
    }

    private func breakdown(_ title: String, _ rows: [(String, Double)], empty: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            if rows.isEmpty {
                Text(empty).font(.system(size: 12.5)).foregroundColor(NT.ink3)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row.0).font(.system(size: 13.5)).foregroundColor(NT.ink2)
                    Spacer()
                    Text(NOS.yen(row.1)).font(.system(size: 14, weight: .bold)).foregroundColor(color).monospacedDigit()
                }
            }
        }
    }

    private func registerLine(_ l: NOMClosings.Line) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(l.registerName).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer()
                Text("差異 \(NOM.signed(l.difference))").font(.system(size: 13, weight: NT.strong)).foregroundColor(l.difference != 0 ? NT.danger : NT.ok).monospacedDigit()
            }
            Group {
                kv("開始現金", l.openingFloat)
                kv("現金売上", l.cashSales)
                if l.cashRefunds > 0 { kv("現金返金", l.cashRefunds) }
                kv("入金", l.cashIn)
                kv("出金", l.cashOut)
                kv("理論現金", l.expectedCash)
                kv("実現金", l.countedCash)
            }
            if let by = l.closedByName, !by.isEmpty {
                Text("締め担当 \(by)").font(.system(size: 11)).foregroundColor(NT.ink3)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
    }

    private func kv(_ label: String, _ v: Double) -> some View {
        HStack {
            Text(label).font(.system(size: 12.5)).foregroundColor(NT.ink2)
            Spacer()
            Text(NOS.yen(v)).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink).monospacedDigit()
        }
    }

    @ViewBuilder private func actions(_ r: NOMClosings.Row, _ p: NOMClosings) -> some View {
        let canApprove = p.canApprove && (r.status == "closed" || r.status == "reopened")
        let canReopen = p.canApprove && r.status == "approved"
        let canReopenDay = p.canReopenStoreDay && (r.status == "closed" || r.status == "approved")
        if canApprove || canReopen || canReopenDay {
            VStack(spacing: 8) {
                if canApprove {
                    NOMButton(title: "承認する", icon: "checkmark.seal", tint: NT.ok, height: 44) {
                        Task { if let e = await model.act(["type": "closingApprove", "id": r.id], ok: "承認しました") { model.error = e } }
                    }
                }
                HStack(spacing: 8) {
                    if canReopen {
                        NOMSmallButton(title: "締め後修正") {
                            prompt = NOMReasonPrompt(title: "締め後修正", message: "承認済みの締めを修正待ち（reopened）に戻します。理由は監査ログに記録されます。数値の直接編集はできません。", confirm: "修正する") { reason in
                                await model.act(["type": "closingReopen", "id": r.id, "reason": reason], ok: "締め後修正として登録しました")
                            }
                        }
                    }
                    if canReopenDay {
                        NOMSmallButton(title: "店舗日次締めを再オープン", tint: NT.danger) {
                            prompt = NOMReasonPrompt(title: "店舗日次締めを再オープン", message: "この日の店舗日次締めを再オープン（reopened）状態に戻します。レジ締めをやり直してから、再度「店舗日次締めを実行」してください。理由は監査ログに記録されます。", confirm: "再オープンする") { reason in
                                await model.act(["type": "closingReopenStoreDay", "storeId": r.storeId, "businessDate": r.businessDate, "reason": reason], ok: "店舗日次締めを再オープンしました")
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .disabled(model.busy)
        }
    }
}
