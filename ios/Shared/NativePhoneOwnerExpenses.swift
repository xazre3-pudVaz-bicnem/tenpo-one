import SwiftUI

// iPhone の店長・オーナー：仕入・経費（Web の /app/expenses。2026-10-25 Ronnie「iPhone も native に」）
// サーバーは iPad と同じ（返事の形は変えない）：GET ?part=expenses&from&to&account&status ／
//   POST expenseAdd（経費を登録）・expenseBill（仕入の請求書）・expenseApprove・expenseReject・expenseSeed（初期科目）
// お知らせ&アラート／レシートを撮って保存（→ スキャンの画面）／科目別の当月合計／期間・勘定科目・承認状態／一覧（承認・差戻し）
// 経費 CSV はアプリの中で取り出して共有（NPOCsvButton。Web の画面には行かない）。

/// GET ?part=expenses の中身（使うところだけ）
struct NOMExpenses: Decodable {
    struct Notices: Decodable {
        struct Ann: Decodable, Hashable, Identifiable {
            let id: String
            let title: String
            let createdAt: String?
            let important: Bool
            let unread: Bool
        }
        struct Alert: Decodable, Hashable, Identifiable {
            let id: String
            let kindLabel: String
            let title: String
            let href: String
            let createdAt: String?
        }
        struct Auto: Decodable, Hashable, Identifiable {
            let id: String
            let message: String
            let linkLabel: String?
            let href: String
            let at: String?
        }
        struct Todo: Decodable, Hashable {
            let key: String
            let label: String
            let count: Double
            let valueLabel: String?
            let href: String
        }
        let announcements: [Ann]
        let unreadCount: Double
        let alerts: [Alert]
        let alertCount: Double
        let autoNotices: [Auto]
        let todos: [Todo]
    }
    struct Row: Decodable, Hashable, Identifiable {
        let id: String
        let businessDate: String
        let storeName: String?
        let accountName: String
        let amount: Double
        let taxAmount: Double
        let paidVia: String
        let vendorName: String?
        let status: String
        let statusLabel: String
        let journaled: Bool
        let approverLabel: String?
    }
    struct Key: Decodable, Hashable {
        let key: String
        let label: String
    }
    struct Total: Decodable, Hashable {
        let name: String
        let total: Double
    }
    let store: NOMNamed
    let from: String
    let to: String
    let account: String
    let status: String
    let notices: Notices
    let accounts: [NOMNamed]
    let vendors: [NOMNamed]
    let monthTotals: [Total]
    let billCount: Double
    let billTotal: Double
    let paidVia: [Key]
    let rows: [Row]
    let canWrite: Bool
    let canApprove: Bool
    let canScan: Bool
    let canExport: Bool?
}

@MainActor
final class NOMExpensesModel: ObservableObject {
    @Published var payload: NOMExpenses?
    @Published var from = ""
    @Published var to = ""
    @Published var account = ""
    @Published var status = ""
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false

    static let statuses: [(key: String, label: String)] = [("", "すべて"), ("pending", "承認待ち"), ("approved", "承認済み"), ("rejected", "差戻し")]

    /// Web の道の ?from= ?to= ?status= ?account= から始める
    init(route: NativeModuleRoute? = nil) {
        guard let route else { return }
        if let v = route.query("from"), NOS.isDay(v) { from = v }
        if let v = route.query("to"), NOS.isDay(v) { to = v }
        if let v = route.query("status"), ["pending", "approved", "rejected"].contains(v) { status = v }
        if let v = route.query("account"), NOS.isUuid(v) { account = v }
    }

    private var query: [String: String] {
        var q: [String: String] = [:]
        for (k, v) in [("from", from), ("to", to), ("account", account), ("status", status)] where !v.isEmpty { q[k] = v }
        return q
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        let q = query
        if payload == nil, let saved = NativeModuleAPI.cached(NOMExpenses.self, part: "expenses", query: q) { payload = saved }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NOMExpenses.self, part: "expenses", query: q)
            guard q == query else { return }
            payload = p
            if from.isEmpty { from = p.from }
            if to.isEmpty { to = p.to }
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

    func setAccount(_ a: String) {
        account = a
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

struct NativePhoneOwnerExpensesView: View {
    @ObservedObject var model: NOMExpensesModel
    let onBack: () -> Void
    let onOpen: (String) -> Void

    @State private var rangeOpen = false
    @State private var expenseOpen = false
    @State private var billOpen = false
    @State private var prompt: NOMReasonPrompt?

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "仕入・経費", subtitle: model.payload?.store.name ?? "Bills & payables", onBack: onBack, trailing: {
                NOMRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        content(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .sheet(isPresented: $rangeOpen) {
            NOMRangeSheet(from: model.payload?.from ?? model.from, to: model.payload?.to ?? model.to, onClose: { rangeOpen = false }) { f, t in
                rangeOpen = false
                model.setPeriod(f, t)
            }
            .presentationDetents([.medium])
            .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $expenseOpen) {
            if let p = model.payload {
                NOMExpenseSheet(model: model, payload: p, onClose: { expenseOpen = false })
                    .presentationDetents([.large])
                    .environment(\.colorScheme, .light)
            }
        }
        .sheet(isPresented: $billOpen) {
            if let p = model.payload {
                NOMBillSheet(model: model, vendors: p.vendors, onClose: { billOpen = false })
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

    private func content(_ p: NOMExpenses) -> some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                noticesCard(p.notices)
                if p.canScan {
                    NOMSnapCard(sub: "仕入・経費のレシート・請求書を書類ボックスへ。撮ってすぐ保存できます") { onOpen("/app/scan") }
                }
                if p.canWrite || p.canScan {
                    HStack(spacing: 8) {
                        if p.canWrite { NOMButton(title: "経費を登録", icon: "plus") { expenseOpen = true } }
                        if p.canScan { NOMButton(title: "仕入の請求書", icon: "doc.text", filled: false) { billOpen = true } }
                    }
                }
                monthCard(p)
                NOMPeriodCard(from: p.from, to: p.to, onPick: { rangeOpen = true }, onSet: { f, t in model.setPeriod(f, t) })
                filters(p)
                if p.rows.isEmpty {
                    NOMEmpty(icon: "tray", title: "経費の記録はありません", sub: "期間や絞り込みを変えるか、経費を登録してください。")
                } else {
                    HStack {
                        Text("\(p.rows.count)件・合計 \(NOS.yen(p.rows.reduce(0) { $0 + $1.amount }))").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit()
                        Spacer()
                    }
                    .padding(.horizontal, 4)
                    ForEach(p.rows) { r in row(r, p) }
                }
                if p.canExport == true {
                    // CSV もアプリの中で取り出して共有（NativePhoneOwnerCsv.swift。Web の画面には行かない）
                    NPOCsvButton(title: "経費 CSV", path: "/app/expenses/export", query: ["from": p.from, "to": p.to], fileName: "expenses.csv",
                                 onError: { model.error = $0 })
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .refreshable { await model.refresh() }
    }

    // MARK: お知らせ&アラート（Web の HomeNotices）

    @ViewBuilder private func noticesCard(_ n: NOMExpenses.Notices) -> some View {
        if !(n.announcements.isEmpty && n.alerts.isEmpty && n.autoNotices.isEmpty && n.todos.isEmpty) {
            let badge = Int(n.unreadCount + n.alertCount)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    NOMTitle(ja: "お知らせ&アラート", en: "Notices")
                    if badge > 0 {
                        Text("\(badge)").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NT.danger))
                    }
                    Spacer()
                    Button { onOpen("/app/notifications") } label: {
                        Text("すべて見る ›").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purpleDeep)
                    }
                    .buttonStyle(.plain)
                }
                ForEach(n.autoNotices.prefix(3)) { a in
                    noticeLine(icon: "exclamationmark.circle.fill", color: NT.danger, a.message, sub: NOM.mdhm(a.at), link: a.linkLabel ?? "確認") { onOpen(a.href) }
                }
                ForEach(n.alerts.prefix(3)) { a in
                    noticeLine(icon: "bell.fill", color: NT.warn, "[\(a.kindLabel)] \(a.title)", sub: NOM.mdhm(a.createdAt), link: nil) { onOpen(a.href) }
                }
                ForEach(n.announcements.prefix(3)) { a in
                    noticeLine(icon: a.important ? "megaphone.fill" : "megaphone", color: a.important ? NT.danger : NT.purple, a.title, sub: a.unread ? "未読" : "", link: nil) { onOpen("/app/announcements") }
                }
                if !n.todos.isEmpty {
                    WrapLayout(spacing: 6) {
                        ForEach(n.todos, id: \.key) { t in
                            Button { onOpen(t.href) } label: {
                                HStack(spacing: 6) {
                                    Text(t.label).font(.system(size: 12.5, weight: .bold))
                                    Text(t.valueLabel ?? NOS.int(t.count)).font(.system(size: 12, weight: .heavy)).foregroundColor(.white)
                                        .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NT.purple))
                                }
                                .foregroundColor(NT.purpleDeep).padding(.horizontal, 10).frame(height: 34)
                                .background(Capsule().fill(NT.lilac))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        }
    }

    private func noticeLine(icon: String, color: Color, _ text: String, sub: String, link: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .bold)).foregroundColor(color).padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(text).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                    if !sub.isEmpty { Text(sub).font(.system(size: 11)).foregroundColor(NT.ink3) }
                }
                Spacer(minLength: 4)
                if let link { Text("\(link) ›").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: 科目別の当月合計・仕入の請求書

    @ViewBuilder private func monthCard(_ p: NOMExpenses) -> some View {
        if !p.monthTotals.isEmpty || p.canScan {
            let maxV = max(1, p.monthTotals.map(\.total).max() ?? 1)
            NPOCard(title: "今月の経費（科目別）", trailing: NOS.yen(p.monthTotals.reduce(0) { $0 + $1.total })) {
                if p.monthTotals.isEmpty {
                    Text("今月の経費はまだありません").font(.system(size: 13)).foregroundColor(NT.ink3)
                }
                ForEach(p.monthTotals.sorted { $0.total > $1.total }, id: \.self) { t in
                    NOSMeterRow(label: t.name, value: NOS.yen(t.total), ratio: t.total / maxV)
                }
                if p.canScan {
                    Rectangle().fill(NT.line).frame(height: 1)
                    HStack {
                        Label("今月の仕入の請求書", systemImage: "doc.text").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
                        Spacer()
                        Text("\(NOS.int(p.billCount))件・\(NOS.yen(p.billTotal))").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    }
                }
            }
        }
    }

    // MARK: 勘定科目・承認状態

    private func filters(_ p: NOMExpenses) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(NOMExpensesModel.statuses, id: \.0) { s in
                        NOMChip(title: s.label, on: p.status == s.key) { model.setStatus(s.key) }
                    }
                }
                .padding(.vertical, 1)
            }
            Menu {
                Button { model.setAccount("") } label: { if p.account.isEmpty { Label("すべての勘定科目", systemImage: "checkmark") } else { Text("すべての勘定科目") } }
                ForEach(p.accounts) { a in
                    Button { model.setAccount(a.id) } label: { if p.account == a.id { Label(a.name, systemImage: "checkmark") } else { Text(a.name) } }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "folder").font(.system(size: 13, weight: .bold))
                    Text(accountLabel(p)).font(.system(size: 13.5, weight: .bold)).lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                }
                .foregroundColor(p.account.isEmpty ? NT.ink2 : .white)
                .padding(.horizontal, 12).frame(height: 42)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.account.isEmpty ? Color.white : NT.purple))
            }
        }
    }

    private func accountLabel(_ p: NOMExpenses) -> String {
        if p.account.isEmpty { return "勘定科目：すべて" }
        let name = p.accounts.first(where: { $0.id == p.account })?.name ?? "—"
        return "勘定科目：\(name)"
    }

    // MARK: 一覧の行

    private func row(_ r: NOMExpenses.Row, _ p: NOMExpenses) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(NOS.mdw(r.businessDate)).font(.system(size: 13, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                NOSBadge(text: r.accountName, color: NT.ink2)
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(NOS.yen(r.amount)).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                    if r.taxAmount > 0 { Text("うち税 \(NOS.yen(r.taxAmount))").font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit() }
                }
            }
            Text(r.vendorName.flatMap { $0.isEmpty ? nil : $0 } ?? "支払先なし").font(.system(size: 14, weight: .bold)).foregroundColor(r.vendorName?.isEmpty == false ? NT.ink : NT.ink3).lineLimit(2)
            HStack(spacing: 6) {
                NOSBadge(text: r.statusLabel, color: NOM.approvalColor(r.status))
                Text(r.paidVia).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                Text(r.journaled ? "仕訳済" : "未仕訳").font(.system(size: 11.5, weight: .semibold)).foregroundColor(r.journaled ? NT.ok : NT.ink3)
                Spacer(minLength: 0)
            }
            if p.canApprove && r.status == "pending" {
                HStack(spacing: 8) {
                    NOMSmallButton(title: "承認", filled: true, tint: NT.ok) {
                        Task { if let e = await model.act(["type": "expenseApprove", "id": r.id], ok: "承認しました") { model.error = e } }
                    }
                    NOMSmallButton(title: "差戻し", tint: NT.danger) {
                        prompt = NOMReasonPrompt(title: "経費の差戻し", message: "差戻し理由を入力してください。", confirm: "差戻す", placeholder: "差戻し理由") { reason in
                            await model.act(["type": "expenseReject", "id": r.id, "reason": reason], ok: "差戻しました")
                        }
                    }
                    Spacer(minLength: 0)
                    if let a = r.approverLabel { Text("要承認: \(a)").font(.system(size: 11)).foregroundColor(NT.ink3) }
                }
                .disabled(model.busy)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }
}

// MARK: - 経費を登録（Web の ExpenseFormDialog・iPad と同じ）

struct NOMExpenseSheet: View {
    @ObservedObject var model: NOMExpensesModel
    let payload: NOMExpenses
    let onClose: () -> Void

    @State private var accountId = ""
    @State private var amount = ""
    @State private var tax = ""
    @State private var paidVia = "petty_cash"
    @State private var vendorId = ""
    @State private var vendorName = ""
    @State private var memo = ""
    @State private var date = Date()
    /// テンキーの入れ先（amount ／ tax）
    @State private var target = "amount"
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if payload.accounts.isEmpty {
                        noAccounts
                    } else {
                        amountSection
                        detailSection
                        if let problem {
                            Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                        }
                        NOMButton(title: model.busy ? "登録中…" : "登録する", height: 56, enabled: !model.busy) { Task { await submit() } }
                        Text("登録すると承認待ちになります。").font(.system(size: 11)).foregroundColor(NT.ink3).frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NT.page.ignoresSafeArea())
            .navigationTitle("経費を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
            .onAppear {
                if accountId.isEmpty { accountId = payload.accounts.first?.id ?? "" }
                if !payload.paidVia.contains(where: { $0.key == paidVia }), let first = payload.paidVia.first { paidVia = first.key }
            }
        }
    }

    /// 勘定科目・金額・税額・テンキー
    private var amountSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            picker("勘定科目", payload.accounts.first(where: { $0.id == accountId })?.name ?? "選んでください") {
                ForEach(payload.accounts) { a in
                    Button { accountId = a.id } label: { if accountId == a.id { Label(a.name, systemImage: "checkmark") } else { Text(a.name) } }
                }
            }
            VStack(spacing: 8) {
                NOMAmountBox(label: "金額", value: amount, active: target == "amount") { target = "amount" }
                NOMAmountBox(label: "うち税額", value: tax, active: target == "tax", big: false) { target = "tax" }
            }
            NOMKeypad(text: target == "tax" ? $tax : $amount, maxLength: 9)
        }
    }

    private var vendorLabel: String {
        if vendorId.isEmpty { return payload.vendors.isEmpty ? "仕入先が未登録（手入力）" : "その他（手入力）" }
        return payload.vendors.first(where: { $0.id == vendorId })?.name ?? "—"
    }

    /// 支払元・仕入先・メモ・営業日
    private var detailSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("支払元").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                WrapLayout(spacing: 6) {
                    ForEach(payload.paidVia, id: \.key) { k in
                        NOMChip(title: k.label, on: paidVia == k.key) { paidVia = k.key }
                    }
                }
            }
            picker("仕入先", vendorLabel) {
                Button { vendorId = "" } label: { Text("その他（手入力）") }
                ForEach(payload.vendors) { v in
                    Button { vendorId = v.id; vendorName = v.name } label: { if vendorId == v.id { Label(v.name, systemImage: "checkmark") } else { Text(v.name) } }
                }
            }
            field("仕入先・支払先名", "例：〇〇商店（仕入先を選ぶと自動で入ります）", $vendorName)
            field("メモ", "任意", $memo)
            DatePicker("営業日", selection: $date, displayedComponents: .date)
                .font(.system(size: 15, weight: .bold))
                .environment(\.locale, Locale(identifier: "ja_JP"))
                .padding(.horizontal, 12).frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        }
    }

    @ViewBuilder private var noAccounts: some View {
        NOMNote(text: "勘定科目がまだ登録されていません。経費を登録する前に科目を作成してください。")
        if payload.canApprove {
            NOMButton(title: model.busy ? "作成中…" : "初期科目を作成", icon: "folder.badge.plus", enabled: !model.busy) {
                Task {
                    if let e = await model.act(["type": "expenseSeed"], ok: "初期科目を作成しました") { problem = e } else { onClose() }
                }
            }
            Text("食材費・消耗品費・水道光熱費・修繕費・雑費 を作ります。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
        } else {
            Text("科目の作成には店長以上の権限が必要です。管理者に依頼してください。").font(.system(size: 12)).foregroundColor(NT.ink3)
        }
        if let problem {
            Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
        }
    }

    private func picker<Items: View>(_ label: String, _ current: String, @ViewBuilder items: () -> Items) -> some View {
        let menuItems = items()
        return VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            Menu {
                menuItems
            } label: {
                HStack {
                    Text(current).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink).lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 12).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
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

    private func submit() async {
        guard !accountId.isEmpty else { problem = "勘定科目を選択してください"; return }
        guard let a = Int(amount), a > 0 else { problem = "金額は1円以上の整数で入力してください"; return }
        let t = Int(tax.isEmpty ? "0" : tax) ?? -1
        guard t >= 0 else { problem = "税額は0以上の整数で入力してください"; return }
        problem = nil
        let body: [String: Any] = ["type": "expenseAdd", "expenseAccountId": accountId, "amount": a, "taxAmount": t, "paidVia": paidVia,
                                   "vendorName": vendorName, "memo": memo, "businessDate": NOS.str(date)]
        if let e = await model.act(body, ok: "経費を登録しました（承認待ち）") { problem = e; return }
        onClose()
    }
}

// MARK: - 仕入の請求書を登録（Web の VendorBillDialog・iPad と同じ）

struct NOMBillSheet: View {
    @ObservedObject var model: NOMExpensesModel
    let vendors: [NOMNamed]
    let onClose: () -> Void

    @State private var vendorId = ""
    @State private var vendorName = ""
    @State private var amount = ""
    @State private var date = Date()
    @State private var memo = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    NOMNote(text: "仕入先からの請求書・納品書の金額を入れます。管理画面の「月次清算」で仕入先ごと・日ごとに集計されます。")
                    VStack(alignment: .leading, spacing: 6) {
                        Text("仕入先").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        if !vendors.isEmpty {
                            WrapLayout(spacing: 6) {
                                ForEach(vendors) { v in
                                    NOMChip(title: v.name, on: vendorId == v.id) {
                                        if vendorId == v.id { vendorId = "" } else { vendorId = v.id; vendorName = v.name }
                                    }
                                }
                            }
                        }
                        TextField(vendors.isEmpty ? "仕入先の名前（仕入先が未登録）" : "その他の仕入先は名前を入力", text: $vendorName)
                            .font(.system(size: 16))
                            .padding(.horizontal, 12).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    NOMAmountBox(label: "金額（税込）", value: amount, active: true) {}
                    NOMKeypad(text: $amount, maxLength: 9)
                    DatePicker("日付", selection: $date, displayedComponents: .date)
                        .font(.system(size: 15, weight: .bold))
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                        .padding(.horizontal, 12).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    VStack(alignment: .leading, spacing: 6) {
                        Text("メモ").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        TextField("任意", text: $memo)
                            .font(.system(size: 16))
                            .padding(.horizontal, 12).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    }
                    NOMButton(title: model.busy ? "登録中…" : "登録する", height: 56, enabled: !model.busy) { Task { await submit() } }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NT.page.ignoresSafeArea())
            .navigationTitle("仕入の請求書を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }

    private func submit() async {
        let name = vendorName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { problem = "仕入先を選ぶか、名前を入れてください"; return }
        guard let a = Int(amount), a > 0 else { problem = "金額は1円以上の整数で入力してください"; return }
        problem = nil
        var body: [String: Any] = ["type": "expenseBill", "vendorName": name, "amount": a, "date": NOS.str(date), "memo": memo]
        // 選んだ仕入先の名前のままなら仕入先の ID も送る（名前を書き換えたら手入力として送る。iPad と同じ）
        body["vendorId"] = vendorId.isEmpty || vendors.first(where: { $0.id == vendorId })?.name != name ? NSNull() : vendorId
        if let e = await model.act(body, ok: "仕入の請求書を登録しました（\(name)）") { problem = e; return }
        onClose()
    }
}

// MARK: - key "expenses" の画面（NativePhoneOwnerScreen から）

struct NativePhoneOwnerExpensesScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NOMExpensesModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NOMExpensesModel(route: route))
    }

    var body: some View {
        NativePhoneOwnerExpensesView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "expenses", useWeb: model.useWeb, state: state))
    }
}
