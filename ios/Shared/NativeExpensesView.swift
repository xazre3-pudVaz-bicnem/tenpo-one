import SwiftUI

// 仕入・経費（ネイティブ）。Web の /app/expenses（レジの iPad：上にお知らせ&アラート）と同じ（2026-10-24）
//   お知らせ&アラート／レシートを撮って保存／科目別の当月合計／経費を登録／仕入の請求書を登録／期間・勘定科目・承認状態／一覧（承認・差戻し）／経費CSV

struct NENotices: Codable {
    struct Ann: Codable, Identifiable { let id: String; let title: String; let createdAt: String; let important: Bool; let unread: Bool }
    struct Alert: Codable, Identifiable { let id: String; let kindLabel: String; let title: String; let href: String; let createdAt: String }
    struct Auto: Codable, Identifiable { let id: String; let message: String; let linkLabel: String?; let href: String; let at: String? }
    struct Todo: Codable, Identifiable { var id: String { key }; let key: String; let label: String; let count: Int; let valueLabel: String?; let href: String }
    let announcements: [Ann]
    let unreadCount: Int
    let alerts: [Alert]
    let alertCount: Int
    let autoNotices: [Auto]
    let todos: [Todo]
}
struct NERow: Codable, Identifiable {
    let id: String
    let businessDate: String
    let storeName: String
    let accountName: String
    let amount: Int
    let taxAmount: Int
    let paidVia: String
    let vendorName: String?
    let status: String
    let statusLabel: String
    let journaled: Bool
    let approverLabel: String?
}
struct NEKey: Codable, Hashable { let key: String; let label: String }
struct NETotal: Codable, Hashable { let name: String; let total: Int }
struct NEPayload: Codable {
    let store: NFNamed
    let from: String
    let to: String
    let account: String
    let status: String
    let notices: NENotices
    let accounts: [NFNamed]
    let vendors: [NFNamed]
    let monthTotals: [NETotal]
    let billCount: Int
    let billTotal: Int
    let paidVia: [NEKey]
    let rows: [NERow]
    let canWrite: Bool
    let canApprove: Bool
    let canScan: Bool
    let canExport: Bool
}

@MainActor
final class NativeExpensesModel: ObservableObject {
    @Published var payload: NEPayload?
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    var from = ""
    var to = ""
    var account = ""
    var status = ""

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var q = [URLQueryItem(name: "part", value: "expenses")]
            for (k, v) in [("from", from), ("to", to), ("account", account), ("status", status)] where !v.isEmpty { q.append(URLQueryItem(name: k, value: v)) }
            comps.queryItems = q
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NEPayload.self, from: data)
            payload = p
            from = p.from; to = p.to
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func act(_ body: [String: Any]) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return false }
            await refresh()
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativeExpensesView: View {
    @ObservedObject var model: NativeExpensesModel
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var expenseOpen = false
    @State private var billOpen = false
    @State private var rejectFor: NERow?
    @State private var rejectReason = ""
    @State private var fromDate = Date()
    @State private var toDate = Date()

    private var p: NEPayload? { model.payload }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "仕入・経費", subtitle: "Bills & payables", onHome: onHome)
            if let p {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        noticesCard(p.notices)
                        if p.canScan {
                            Button { onWeb("/app/scan") } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "camera").font(.system(size: 22))
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) { Text("レシートを撮って保存").font(.system(size: 15, weight: .bold)); Text("Snap receipt").font(.system(size: 10)) }
                                        Text("仕入・経費のレシート・請求書を書類ボックスへ。その場で撮っても、あとから写真・PDFを選んで添付してもかまいません").font(.system(size: 11)).foregroundColor(NFColor.ink3).multilineTextAlignment(.leading)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .foregroundColor(NFColor.royal).padding(14)
                                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.irisSoft))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [6])).foregroundColor(NFColor.iris))
                            }.buttonStyle(.plain)
                        }
                        if !p.monthTotals.isEmpty {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                                ForEach(p.monthTotals, id: \.self) { t in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(t.name)（当月）").font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1)
                                        Text(NT.yen(t.total)).font(.system(size: 19, weight: .heavy)).monospacedDigit()
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                                }
                            }
                        }
                        HStack(spacing: 10) {
                            if p.canWrite { primary("経費を登録", icon: "plus") { expenseOpen = true } }
                            if p.canScan { secondary("仕入の請求書を登録", en: "Vendor bill", icon: "doc.text") { billOpen = true } }
                            if p.canScan { Text("今月の仕入の請求書 \(p.billCount)件・\(NT.yen(p.billTotal))").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                            Spacer()
                            if p.canExport { secondary("経費CSV", en: nil, icon: "arrow.down.doc") { Task { await exportCsv(p) } } }
                        }
                        filters(p)
                        if p.rows.isEmpty {
                            VStack(spacing: 4) {
                                Text("経費の記録はありません").font(.system(size: 16, weight: .bold))
                                Text("期間や絞込条件を変更するか、経費を登録してください。").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 40)
                            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
                        } else {
                            table(p)
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
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e).multilineTextAlignment(.leading); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft)).frame(maxWidth: 720)
                }.buttonStyle(.plain).padding(.top, 74)
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
        .sheet(isPresented: $expenseOpen) { if let p { NEExpenseSheet(model: model, payload: p) { expenseOpen = false } } }
        .sheet(isPresented: $billOpen) { if let p { NEBillSheet(model: model, vendors: p.vendors) { billOpen = false } } }
        .alert("経費の差戻し", isPresented: Binding(get: { rejectFor != nil }, set: { if !$0 { rejectFor = nil } })) {
            TextField("差戻し理由", text: $rejectReason)
            Button("差戻す", role: .destructive) {
                if let r = rejectFor { Task { if await model.act(["type": "expenseReject", "id": r.id, "reason": rejectReason]) { model.toast = "差戻しました" } } }
                rejectReason = ""
            }
            Button("キャンセル", role: .cancel) { rejectReason = "" }
        }
        .task { await model.refresh() }
    }

    // MARK: お知らせ&アラート（Web の HomeNotices）

    @ViewBuilder private func noticesCard(_ n: NENotices) -> some View {
        if !(n.announcements.isEmpty && n.alerts.isEmpty && n.autoNotices.isEmpty && n.todos.isEmpty) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("お知らせ&アラート").font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.navy)
                    if n.unreadCount + n.alertCount > 0 {
                        Text("\(n.unreadCount + n.alertCount)").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.danger))
                    }
                    Spacer()
                    Button("すべて見る ›") { onWeb("/app/notifications") }.font(.system(size: 12, weight: .bold))
                }
                ForEach(n.autoNotices) { a in
                    noticeLine(icon: "exclamationmark.circle.fill", color: NFColor.danger, a.message, sub: a.at, link: a.linkLabel ?? "確認") { onWeb(a.href) }
                }
                ForEach(n.alerts) { a in
                    noticeLine(icon: "bell.fill", color: Color(hex: 0xC27C0E), "[\(a.kindLabel)] \(a.title)", sub: NFTime.hm(iso: a.createdAt), link: nil) { onWeb(a.href) }
                }
                ForEach(n.announcements) { a in
                    noticeLine(icon: a.important ? "megaphone.fill" : "megaphone", color: a.important ? NFColor.danger : NFColor.royal, a.title, sub: a.unread ? "未読" : nil, link: nil) { onWeb("/app/announcements") }
                }
                if !n.todos.isEmpty {
                    NCFlow(spacing: 6) {
                        ForEach(n.todos) { t in
                            Button { onWeb(t.href) } label: {
                                HStack(spacing: 6) {
                                    Text(t.label).font(.system(size: 12.5, weight: .bold))
                                    Text(t.valueLabel ?? "\(t.count)").font(.system(size: 12, weight: .heavy)).foregroundColor(.white)
                                        .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.royal))
                                }
                                .foregroundColor(NFColor.royal).padding(.horizontal, 10).frame(height: 32)
                                .background(Capsule().fill(NFColor.irisSoft))
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private func noticeLine(icon: String, color: Color, _ text: String, sub: String?, link: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).foregroundColor(color)
                Text(text).font(.system(size: 13.5)).foregroundColor(NFColor.ink).lineLimit(2).multilineTextAlignment(.leading)
                if let sub { Text(sub).font(.system(size: 11)).foregroundColor(NFColor.ink3) }
                Spacer()
                if let link { Text("\(link) ›").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.iris) }
            }
        }.buttonStyle(.plain)
    }

    // MARK: 期間・勘定科目・承認状態

    private func filters(_ p: NEPayload) -> some View {
        HStack(alignment: .bottom, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) { Text("開始日").font(.system(size: 12)).foregroundColor(NFColor.ink3); DatePicker("", selection: $fromDate, displayedComponents: .date).labelsHidden() }
            VStack(alignment: .leading, spacing: 4) { Text("終了日").font(.system(size: 12)).foregroundColor(NFColor.ink3); DatePicker("", selection: $toDate, displayedComponents: .date).labelsHidden() }
            VStack(alignment: .leading, spacing: 4) {
                Text("勘定科目").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                Picker("勘定科目", selection: Binding(get: { model.account }, set: { model.account = $0 })) {
                    Text("すべて").tag("")
                    ForEach(p.accounts) { a in Text(a.name).tag(a.id) }
                }.pickerStyle(.menu)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("承認状態").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                Picker("承認状態", selection: Binding(get: { model.status }, set: { model.status = $0 })) {
                    Text("すべて").tag(""); Text("承認待ち").tag("pending"); Text("承認済み").tag("approved"); Text("差戻し").tag("rejected")
                }.pickerStyle(.menu)
            }
            Button("この条件で表示") {
                let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                model.from = f.string(from: fromDate); model.to = f.string(from: toDate)
                Task { await model.refresh() }
            }.buttonStyle(.borderedProminent).tint(NFColor.iris)
            Spacer()
        }
        .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .onAppear {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
            fromDate = f.date(from: p.from) ?? Date(); toDate = f.date(from: p.to) ?? Date()
        }
    }

    private func table(_ p: NEPayload) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                cell("営業日", 90); cell("科目", 110); cell("金額", 90, trailing: true); cell("税額", 70, trailing: true); cell("支払元", 80)
                Text("支払先").frame(maxWidth: .infinity, alignment: .leading); cell("承認状態", 80); cell("仕訳", 50); cell("操作", 150)
            }
            .font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink3)
            .padding(.horizontal, 12).frame(height: 36).background(NFColor.lilacSoft)
            ForEach(p.rows) { r in
                HStack(spacing: 8) {
                    cell(r.businessDate.replacingOccurrences(of: "-", with: "/"), 90)
                    cell(r.accountName, 110)
                    cell(NT.yen(r.amount), 90, trailing: true).fontWeight(.bold)
                    cell(NT.yen(r.taxAmount), 70, trailing: true)
                    cell(r.paidVia, 80)
                    Text(r.vendorName ?? "—").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    Text(r.statusLabel).font(.system(size: 11.5, weight: .bold))
                        .foregroundColor(r.status == "approved" ? NFColor.success : r.status == "rejected" ? NFColor.danger : Color(hex: 0xC27C0E))
                        .frame(width: 80, alignment: .leading)
                    Text(r.journaled ? "済" : "未仕訳").font(.system(size: 11)).foregroundColor(r.journaled ? NFColor.success : NFColor.ink3).frame(width: 50, alignment: .leading)
                    HStack(spacing: 6) {
                        if p.canApprove && r.status == "pending" {
                            Button("承認") { Task { if await model.act(["type": "expenseApprove", "id": r.id]) { model.toast = "承認しました" } } }
                                .buttonStyle(.borderedProminent).tint(NFColor.success).controlSize(.small)
                            Button("差戻し") { rejectFor = r }.buttonStyle(.bordered).tint(NFColor.danger).controlSize(.small)
                        }
                    }
                    .frame(width: 150, alignment: .leading)
                }
                .font(.system(size: 13)).monospacedDigit()
                .padding(.horizontal, 12).frame(minHeight: 46)
                .overlay(alignment: .bottom) {
                    VStack(spacing: 0) {
                        if let a = r.approverLabel, p.canApprove, r.status == "pending" { Text("要承認: \(a)").font(.system(size: 10)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity, alignment: .trailing) }
                        Rectangle().fill(NFColor.line).frame(height: 1)
                    }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func cell(_ t: String, _ w: CGFloat, trailing: Bool = false) -> some View {
        Text(t).lineLimit(1).frame(width: w, alignment: trailing ? .trailing : .leading)
    }

    private func primary(_ t: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: icon); Text(t) }
                .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 16).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 11).fill(NFColor.iris))
        }.buttonStyle(PressableStyle())
    }
    private func secondary(_ t: String, en: String?, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: icon); Text(t); if let en { Text(en).font(.system(size: 10)).opacity(0.7) } }
                .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                .padding(.horizontal, 14).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 11).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle())
    }

    private func exportCsv(_ p: NEPayload) async {
        do {
            let data = try await NativeAPI.shared.download("/app/expenses/export?from=\(p.from)&to=\(p.to)")
            if let url = NLShare.tempFile("経費_\(p.from)_\(p.to).csv", data: data) { NLShare.present(url: url) }
        } catch { model.error = (error as? NativeAPIError)?.message ?? "CSV を取り出せませんでした" }
    }
}

// MARK: - 経費を登録（Web の ExpenseFormDialog）

struct NEExpenseSheet: View {
    @ObservedObject var model: NativeExpensesModel
    let payload: NEPayload
    let onClose: () -> Void

    @State private var accountId = ""
    @State private var amount = ""
    @State private var tax = "0"
    @State private var paidVia = "petty_cash"
    @State private var vendorId = ""
    @State private var vendorName = ""
    @State private var memo = ""
    @State private var date = Date()
    @State private var target = "amount"
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                if payload.accounts.isEmpty {
                    Section(footer: Text(payload.canApprove ? "" : "科目の作成には店長以上の権限が必要です。管理者に依頼してください。")) {
                        Text("勘定科目がまだ登録されていません。経費を登録する前に科目を作成してください。")
                        if payload.canApprove {
                            Button(model.busy ? "作成中…" : "初期科目を作成（食材費・消耗品費・水道光熱費・修繕費・雑費）") {
                                Task { if await model.act(["type": "expenseSeed"]) { model.toast = "初期科目を作成しました" } }
                            }
                        }
                    }
                } else {
                    Section("勘定科目") {
                        Picker("勘定科目", selection: $accountId) { ForEach(payload.accounts) { a in Text(a.name).tag(a.id) } }
                    }
                    Section("金額・税額") {
                        amountRow("金額", amount, key: "amount")
                        amountRow("税額", tax, key: "tax")
                        NCKeypad { k in press(k) }
                    }
                    Section("支払元") {
                        Picker("支払元", selection: $paidVia) { ForEach(payload.paidVia, id: \.self) { Text($0.label).tag($0.key) } }
                    }
                    Section("仕入先・支払先名") {
                        Picker("仕入先", selection: $vendorId) {
                            Text(payload.vendors.isEmpty ? "仕入先が未登録（手入力）" : "その他（手入力）").tag("")
                            ForEach(payload.vendors) { v in Text(v.name).tag(v.id) }
                        }
                        .onChange(of: vendorId) { id in if let v = payload.vendors.first(where: { $0.id == id }) { vendorName = v.name } }
                        TextField("例：〇〇商店（仕入先を選ぶと自動で入ります）", text: $vendorName)
                    }
                    Section("メモ") { TextField("任意", text: $memo) }
                    Section("営業日") { DatePicker("営業日", selection: $date, displayedComponents: .date) }
                    if let problem { Section { Text(problem).foregroundColor(NFColor.danger) } }
                    Section {
                        Button { Task { await submit() } } label: { Text(model.busy ? "登録中…" : "登録する").fontWeight(.heavy).frame(maxWidth: .infinity) }.disabled(model.busy)
                    }
                }
            }
            .navigationTitle("経費を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
            .onAppear { if accountId.isEmpty { accountId = payload.accounts.first?.id ?? "" } }
        }
    }

    private func amountRow(_ label: String, _ v: String, key: String) -> some View {
        Button { target = key } label: {
            HStack {
                Text(label).foregroundColor(NFColor.ink)
                Spacer()
                Text((Int(v) ?? 0).formatted()).font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(target == key ? NFColor.royal : NFColor.ink)
                Text("円").foregroundColor(NFColor.ink3)
            }
            .padding(.vertical, 4)
            .overlay(alignment: .leading) { if target == key { Rectangle().fill(NFColor.iris).frame(width: 3).offset(x: -12) } }
        }.buttonStyle(.plain)
    }

    private func press(_ k: String) {
        var v = target == "tax" ? tax : amount
        switch k {
        case "C": v = ""
        case "⌫": v = String(v.dropLast())
        case "00": if !v.isEmpty && v != "0" && v.count <= 7 { v += "00" }
        default: if v.count < 9 { v = (v == "0" ? "" : v) + k }
        }
        if target == "tax" { tax = v } else { amount = v }
    }

    private func submit() async {
        guard !accountId.isEmpty else { problem = "勘定科目を選択してください"; return }
        guard let a = Int(amount), a > 0 else { problem = "金額は1円以上の整数で入力してください"; return }
        let t = Int(tax.isEmpty ? "0" : tax) ?? -1
        guard t >= 0 else { problem = "税額は0以上の整数で入力してください"; return }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        if await model.act(["type": "expenseAdd", "expenseAccountId": accountId, "amount": a, "taxAmount": t, "paidVia": paidVia, "vendorName": vendorName, "memo": memo, "businessDate": f.string(from: date)]) {
            model.toast = "経費を登録しました（承認待ち）"
            onClose()
        } else { problem = model.error; model.error = nil }
    }
}

// MARK: - 仕入の請求書を登録（Web の VendorBillDialog）

struct NEBillSheet: View {
    @ObservedObject var model: NativeExpensesModel
    let vendors: [NFNamed]
    let onClose: () -> Void

    @State private var vendorId = ""
    @State private var vendorName = ""
    @State private var amount = ""
    @State private var date = Date()
    @State private var memo = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text("仕入先からの請求書・納品書の金額を入れます。管理画面の「月次清算」で仕入先ごと・日ごとに集計されます。").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                Section("仕入先") {
                    Picker("仕入先", selection: $vendorId) {
                        Text(vendors.isEmpty ? "仕入先が未登録（手入力）" : "その他（手入力）").tag("")
                        ForEach(vendors) { v in Text(v.name).tag(v.id) }
                    }
                    .onChange(of: vendorId) { id in vendorName = vendors.first { $0.id == id }?.name ?? vendorName }
                    TextField("例：Komaki（仕入先を選ぶと自動で入ります）", text: $vendorName)
                }
                Section("金額（税込）") {
                    HStack { Spacer(); Text((Int(amount) ?? 0).formatted()).font(.system(size: 26, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.royal); Text("円") }
                    NCKeypad { k in
                        switch k {
                        case "C": amount = ""
                        case "⌫": amount = String(amount.dropLast())
                        case "00": if !amount.isEmpty && amount.count <= 7 { amount += "00" }
                        default: if amount.count < 9 { amount += k }
                        }
                    }
                }
                Section("日付") { DatePicker("日付", selection: $date, displayedComponents: .date) }
                Section("メモ") { TextField("任意", text: $memo) }
                if let problem { Section { Text(problem).foregroundColor(NFColor.danger) } }
                Section {
                    Button { Task { await submit() } } label: { Text(model.busy ? "登録中…" : "登録する").fontWeight(.heavy).frame(maxWidth: .infinity) }.disabled(model.busy)
                }
            }
            .navigationTitle("仕入の請求書を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }

    private func submit() async {
        let name = vendorName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { problem = "仕入先を選ぶか、名前を入れてください"; return }
        guard let a = Int(amount), a > 0 else { problem = "金額は1円以上の整数で入力してください"; return }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        var body: [String: Any] = ["type": "expenseBill", "vendorName": name, "amount": a, "date": f.string(from: date), "memo": memo]
        body["vendorId"] = vendorId.isEmpty || vendors.first(where: { $0.id == vendorId })?.name != name ? NSNull() : vendorId
        if await model.act(body) {
            model.toast = "仕入の請求書を登録しました（\(name)）"
            onClose()
        } else { problem = model.error; model.error = nil }
    }
}
