import SwiftUI
import UniformTypeIdentifiers

// 会計 › 銀行口座（Web の /app/accounting/banks・/app/accounting/banks/[id]・components/accounting/bank-*.tsx と同じ）。
//   一覧：口座を追加・標準科目の導入・口座のカード（押すと明細）
//   明細：編集・削除・残高・売掛金/買掛金の参考残高・CSV取込（この iPad のファイルを選ぶ→列の対応付け→確認→取込）・手入力で追加・
//        取引ごとの対応科目（消込ショートカット）・一括適用・下書き作成／作成して確定・作成済みの仕訳へ

// MARK: - データ（GET view=banks ／ view=bank&id=）

struct NAccBankRow: Decodable, Identifiable, Hashable {
    let id: String
    let bankName: String
    let branchName: String?
    let accountType: String
    let accountTypeLabel: String
    let accountLast4: String?
    let holderName: String?
    let storeName: String?
    let accountCode: String?
    let accountName: String?
}

struct NAccBanksPayload: Decodable {
    let accountsInstalled: Bool
    let accountOptions: [NAccAccountRef]
    let formStores: [NAccStore]
    let banks: [NAccBankRow]
}

struct NAccBank: Decodable, Hashable {
    let id: String
    let bankName: String
    let branchName: String?
    let accountType: String
    let accountTypeLabel: String
    let accountLast4: String?
    let holderName: String?
    let storeId: String?
    let storeName: String?
    let accountId: String?
    let accountCode: String?
    let accountName: String?
}

struct NAccBankTx: Decodable, Identifiable, Hashable {
    let id: String
    let date: String
    let description: String
    let deposit: Int
    let withdrawal: Int
    let runningBalance: Int
    let journalEntryId: String?
}

struct NAccSubAccount: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let subType: String?
}

struct NAccBankPayload: Decodable {
    let bank: NAccBank
    let balance: Int
    let receivableTotal: Int
    let payableTotal: Int
    let txs: [NAccBankTx]
    let accountOptions: [NAccSubAccount]
    let editAccountOptions: [NAccAccountRef]
    let formStores: [NAccStore]
    let maxImportRows: Int
}

enum NAccBankText {
    /// 「本店 ・ 普通 ・ 下4桁 1234」
    static func line(branch: String?, typeLabel: String, last4: String?, holder: String? = nil) -> String {
        var s = ""
        if let b = branch, !b.isEmpty { s += "\(b) ・ " }
        s += typeLabel
        if let l = last4, !l.isEmpty { s += " ・ 下4桁 \(l)" }
        if let h = holder, !h.isEmpty { s += " ・ \(h)" }
        return s
    }
}

// MARK: - 一覧／明細

struct NAccBanksPage: View {
    let initial: [String: String]
    let nav: NAccNav

    var body: some View {
        if let id = initial["id"], !id.isEmpty {
            NAccBankDetail(bankId: id, nav: nav)
        } else {
            NAccBankList(nav: nav)
        }
    }
}

/// 勘定科目が未導入のときの案内（自動仕訳・銀行口座）
struct NAccInstallBanner: View {
    let busy: Bool
    let action: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NT.warn)
            Text("この企業には勘定科目がまだ導入されていません。標準の勘定科目テンプレート（現金・売上高・仕入高・給与手当 等）を導入すると自動仕訳が利用できます。")
                .font(.system(size: 13)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            NAccButton(text: "標準科目を導入する", kind: .primary, busy: busy, action: action)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.warn.opacity(0.09)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.warn.opacity(0.25), lineWidth: 1))
    }
}

struct NAccBankList: View {
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccBanksPayload>()
    @State private var adding = false
    @State private var started = false

    private func load() async { await loader.load(["view": "banks"]) }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NAccHeader(title: "銀行口座", subtitle: "銀行口座を登録し、CSV取込または手入力で取引を記帳します。銀行API連携は行いません（手入力・CSV取込で完結。将来のAPI接続はオプション）。") {
                            NAccButton(text: "口座を追加", icon: "plus", kind: .primary) { adding = true }
                        }
                        if !p.accountsInstalled {
                            NAccInstallBanner(busy: loader.busy) {
                                Task { if await loader.act(["type": "accInstallAccounts"], done: "標準の勘定科目を導入しました") { await load() } }
                            }
                        }
                        if p.banks.isEmpty {
                            NAccCard {
                                NAccEmptyView(title: "銀行口座が登録されていません", message: "「口座を追加」から銀行口座を登録すると、取引の記帳・仕訳作成ができるようになります。")
                            }
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], spacing: 12) {
                                ForEach(p.banks) { b in card(b) }
                            }
                        }
                    }
                    .padding(16).padding(.bottom, 24)
                }
            } else {
                NAccLoading(error: loader.error) { Task { await load() } }
            }
        }
        .modifier(NPToastError(error: $loader.error, toast: $loader.toast, hasPayload: loader.data != nil))
        .task {
            if !started {
                started = true
                await load()
            }
        }
        .sheet(isPresented: $adding) {
            if let p = loader.data {
                NAccBankForm(bank: nil, stores: p.formStores, accountOptions: p.accountOptions, onClose: { adding = false }, onSaved: { msg in
                    adding = false
                    loader.toast = msg
                    Task { await load() }
                })
            }
        }
    }

    private func card(_ b: NAccBankRow) -> some View {
        Button { nav.open(.banks, ["id": b.id]) } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "building.columns").foregroundColor(NT.purple)
                    Text(b.bankName).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                }
                Text(NAccBankText.line(branch: b.branchName, typeLabel: b.accountTypeLabel, last4: b.accountLast4)).font(.system(size: 13)).foregroundColor(NT.ink2)
                if let h = b.holderName, !h.isEmpty { Text("名義: \(h)").font(.system(size: 12)).foregroundColor(NT.ink3) }
                HStack(spacing: 6) {
                    if let s = b.storeName { NPBadge(text: s, color: NT.ink3) }
                    if let code = b.accountCode {
                        NPBadge(text: "\(code) \(b.accountName ?? "")", color: NT.purple)
                    } else {
                        NPBadge(text: "対応科目未設定", color: NT.warn)
                    }
                }
                Spacer(minLength: 0)
                HStack { Spacer(); Text("取引を見る ›").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purple) }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - 口座の明細

struct NAccBankDetail: View {
    let bankId: String
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccBankPayload>()
    @State private var selected: Set<String> = []
    @State private var accountByTx: [String: String] = [:]
    @State private var bulk = ""
    @State private var editing = false
    @State private var adding = false
    @State private var deleting = false
    @State private var started = false

    private static let depositCode = "130"     // 売掛金（回収）
    private static let withdrawalCode = "599"  // 雑費

    private func load() async {
        await loader.load(["view": "bank", "id": bankId])
        guard let p = loader.data else { return }
        // 未作成の取引に既定の対応科目（入金=売掛金の回収 130・出金=雑費 599）
        let byCode = Dictionary(p.accountOptions.map { ($0.code, $0.id) }, uniquingKeysWith: { a, _ in a })
        var next = accountByTx
        for t in p.txs where t.journalEntryId == nil && next[t.id] == nil {
            next[t.id] = byCode[t.deposit > 0 ? Self.depositCode : Self.withdrawalCode] ?? p.accountOptions.first?.id ?? ""
        }
        accountByTx = next
        let pending = Set(p.txs.filter { $0.journalEntryId == nil }.map(\.id))
        selected = selected.intersection(pending)
    }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Button { nav.open(.banks, [:]) } label: {
                            Label("銀行口座一覧へ戻る", systemImage: "chevron.left").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink2)
                        }
                        .buttonStyle(.plain)
                        NAccHeader(title: p.bank.bankName, subtitle: NAccBankText.line(branch: p.bank.branchName, typeLabel: p.bank.accountTypeLabel, last4: p.bank.accountLast4, holder: p.bank.holderName)) {
                            NAccButton(text: "編集", icon: "pencil") { editing = true }
                            NAccButton(text: "削除", icon: "trash", kind: .danger) { deleting = true }
                        }
                        badges(p)
                        NAccNotice(text: "銀行API連携は行いません（手入力・CSV取込で完結。将来のAPI接続はオプション）。", color: NT.ink3, icon: "info.circle")
                        HStack(spacing: 12) {
                            NAccStat(label: "売掛金残高（参考・全社合計）", value: p.receivableTotal, note: "入金取引を「売掛金の回収」として消込むと減少します")
                            NAccStat(label: "買掛金残高（参考・全社合計）", value: p.payableTotal, note: "出金取引を「買掛金の支払」として消込むと減少します")
                        }
                        NAccCsvImport(bankId: p.bank.id, maxRows: p.maxImportRows) { msg in
                            loader.toast = msg
                            Task { await load() }
                        }
                        HStack {
                            Spacer()
                            NAccButton(text: "手入力で追加", icon: "plus") { adding = true }
                        }
                        transactions(p)
                    }
                    .padding(16).padding(.bottom, 24)
                }
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Button { nav.open(.banks, [:]) } label: { Label("銀行口座一覧へ戻る", systemImage: "chevron.left") }.buttonStyle(.plain)
                        Spacer()
                    }
                    .padding(16)
                    NAccLoading(error: loader.error) { Task { await load() } }
                }
            }
        }
        .modifier(NPToastError(error: $loader.error, toast: $loader.toast, hasPayload: loader.data != nil))
        .task {
            if !started {
                started = true
                await load()
            }
        }
        .sheet(isPresented: $editing) {
            if let p = loader.data {
                NAccBankForm(bank: p.bank, stores: p.formStores, accountOptions: p.editAccountOptions, onClose: { editing = false }, onSaved: { msg in
                    editing = false
                    loader.toast = msg
                    Task { await load() }
                })
            }
        }
        .sheet(isPresented: $adding) {
            NAccBankTxSheet(bankId: bankId, onClose: { adding = false }, onSaved: { msg in
                adding = false
                loader.toast = msg
                Task { await load() }
            })
        }
        .alert("銀行口座を削除", isPresented: $deleting) {
            Button("削除する", role: .destructive) {
                Task { if await loader.act(["type": "accBankDelete", "id": bankId]) { nav.open(.banks, [:]) } }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("この銀行口座を削除します。取り込み済みの取引・仕訳は残ります。よろしいですか？")
        }
    }

    private func badges(_ p: NAccBankPayload) -> some View {
        HStack(spacing: 6) {
            if let s = p.bank.storeName { NPBadge(text: s, color: NT.ink3) }
            if let code = p.bank.accountCode {
                NPBadge(text: "\(code) \(p.bank.accountName ?? "")", color: NT.purple)
            } else {
                NPBadge(text: "対応する勘定科目が未設定です（編集から設定してください）", color: NT.warn)
            }
            NPBadge(text: "現在残高（記帳ベース） \(NT.yen(p.txs.isEmpty ? 0 : p.balance))", color: NFColor.success)
        }
    }

    // MARK: 取引の一覧

    private func reconciliation(for deposit: Int, _ p: NAccBankPayload) -> (shortcuts: [NAccSubAccount], rest: [NAccSubAccount], label: String) {
        let shortcuts = p.accountOptions.filter { $0.subType == (deposit > 0 ? "receivable" : "payable") }
        let ids = Set(shortcuts.map(\.id))
        return (shortcuts, p.accountOptions.filter { !ids.contains($0.id) }, deposit > 0 ? "売掛金の回収" : "買掛金の支払")
    }

    @ViewBuilder private func transactions(_ p: NAccBankPayload) -> some View {
        let pending = p.txs.filter { $0.journalEntryId == nil }
        if p.txs.isEmpty {
            NAccCard { NAccEmptyView(title: "取引がありません", message: "CSV取込または手入力で取引を登録してください。") }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                let hasShortcuts = p.accountOptions.contains { $0.subType == "receivable" || $0.subType == "payable" }
                if !pending.isEmpty && hasShortcuts {
                    NAccNotice(
                        text: "消込: 入金取引の対応科目に「売掛金の回収」を選ぶと売掛金が減り、出金取引で「買掛金の支払」を選ぶと買掛金が減ります（各行の対応科目の先頭候補）。",
                        color: NT.purple,
                        icon: "arrow.left.arrow.right"
                    )
                }
                if !pending.isEmpty && !p.accountOptions.isEmpty {
                    HStack(spacing: 10) {
                        Text("選択行に一括適用:").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
                        NAccMenu(options: [NAccOption(value: "", label: "勘定科目を選択")] + p.accountOptions.map { NAccOption(value: $0.id, label: "\($0.code) \($0.name)") }, selection: $bulk)
                        NAccButton(text: "適用", disabled: bulk.isEmpty || selected.isEmpty) {
                            var next = accountByTx
                            for id in selected { next[id] = bulk }
                            accountByTx = next
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                NAccCard {
                    VStack(spacing: 0) {
                        HStack(spacing: 10) {
                            Button {
                                if !pending.isEmpty && selected.count == pending.count { selected = [] } else { selected = Set(pending.map(\.id)) }
                            } label: {
                                Image(systemName: !pending.isEmpty && selected.count == pending.count ? "checkmark.square.fill" : "square")
                                    .font(.system(size: 17)).foregroundColor(NT.purple)
                            }
                            .buttonStyle(.plain)
                            .frame(width: 28)
                            .disabled(pending.isEmpty)
                            NAccCell(text: "日付", width: 92, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "摘要", bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "入金", width: 100, trailing: true, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "出金", width: 100, trailing: true, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "残高", width: 110, trailing: true, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "仕訳", width: 84, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "対応科目", width: 250, bold: true, color: NT.ink3, size: 12)
                        }
                        .padding(.horizontal, 14).frame(height: 36)
                        .background(NT.page.opacity(0.7))
                        ForEach(p.txs) { t in txRow(t, p) }
                    }
                }
                if !pending.isEmpty {
                    HStack(spacing: 10) {
                        Text("\(selected.count)件を選択中").font(.system(size: 13.5)).foregroundColor(NT.ink2)
                        Spacer()
                        NAccButton(text: "下書き作成", busy: loader.busy, disabled: selected.isEmpty) { create(post: false) }
                        NAccButton(text: "作成して確定", kind: .primary, busy: loader.busy, disabled: selected.isEmpty) { create(post: true) }
                    }
                }
            }
        }
    }

    private func txRow(_ t: NAccBankTx, _ p: NAccBankPayload) -> some View {
        let isPending = t.journalEntryId == nil
        return HStack(spacing: 10) {
            Group {
                if isPending {
                    Button {
                        if selected.contains(t.id) { selected.remove(t.id) } else { selected.insert(t.id) }
                    } label: {
                        Image(systemName: selected.contains(t.id) ? "checkmark.square.fill" : "square").font(.system(size: 17)).foregroundColor(NT.purple)
                    }
                    .buttonStyle(.plain)
                } else {
                    Color.clear
                }
            }
            .frame(width: 28, height: 24)
            NAccCell(text: NAccText.date(t.date), width: 92, color: NT.ink2, size: 12.5)
            NAccCell(text: t.description)
            NAccCell(text: t.deposit > 0 ? NT.yen(t.deposit) : "—", width: 100, trailing: true)
            NAccCell(text: t.withdrawal > 0 ? NT.yen(t.withdrawal) : "—", width: 100, trailing: true)
            NAccCell(text: NT.yen(t.runningBalance), width: 110, trailing: true, bold: true)
            Group {
                if isPending {
                    NPBadge(text: "未作成", color: NT.ink3)
                } else {
                    Button {
                        nav.open(.journal, ["source_type": "bank", "source_id": t.id, "from": t.date, "to": t.date])
                    } label: {
                        HStack(spacing: 3) {
                            NPBadge(text: "作成済み", color: NFColor.success)
                            Image(systemName: "arrow.up.right.square").font(.system(size: 11)).foregroundColor(NT.purple)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(width: 84, alignment: .leading)
            Group {
                if isPending {
                    if p.accountOptions.isEmpty {
                        Text("勘定科目未導入").font(.system(size: 12)).foregroundColor(NT.ink3)
                    } else {
                        accountPicker(t, p)
                    }
                } else {
                    Color.clear
                }
            }
            .frame(width: 250, alignment: .leading)
        }
        .padding(.horizontal, 14).frame(minHeight: 46)
        .background(selected.contains(t.id) ? NT.lilac.opacity(0.5) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private func accountPicker(_ t: NAccBankTx, _ p: NAccBankPayload) -> some View {
        let r = reconciliation(for: t.deposit, p)
        let current = accountByTx[t.id] ?? ""
        let isReconciliation = r.shortcuts.contains { $0.id == current }
        return VStack(alignment: .leading, spacing: 2) {
            Picker("", selection: Binding(get: { accountByTx[t.id] ?? "" }, set: { v in accountByTx[t.id] = v })) {
                Text("選択してください").tag("")
                if !r.shortcuts.isEmpty {
                    Section("消込ショートカット（\(r.label)）") {
                        ForEach(r.shortcuts) { a in Text("\(r.label)（\(a.code) \(a.name)）").tag(a.id) }
                    }
                }
                Section("その他の勘定科目") {
                    ForEach(r.rest) { a in Text("\(a.code) \(a.name)").tag(a.id) }
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(NT.ink)
            if isReconciliation { NPBadge(text: "消込（\(r.label)）", color: NT.purple) }
        }
    }

    private func create(post: Bool) {
        let items: [[String: Any]] = selected.sorted().compactMap { (id: String) -> [String: Any]? in
            guard let a = accountByTx[id], !a.isEmpty else { return nil }
            return ["transactionId": id, "accountId": a]
        }
        guard !items.isEmpty else {
            loader.error = "勘定科目を選択した取引をチェックしてください"
            return
        }
        Task {
            if let r = await loader.actResult(["type": "accBankJournal", "bankAccountId": bankId, "items": items, "post": post], as: NAccCreateResponse.self) {
                if r.result.failed.isEmpty { loader.toast = r.result.message } else { loader.error = r.result.message }
                selected = []
                await load()
            }
        }
    }
}

// MARK: - 口座の登録・編集（Web の BankAccountForm）

struct NAccBankForm: View {
    let bank: NAccBank?
    let stores: [NAccStore]
    let accountOptions: [NAccAccountRef]
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var storeId: String
    @State private var bankName: String
    @State private var branchName: String
    @State private var accountType: String
    @State private var last4: String
    @State private var holder: String
    @State private var accountId: String
    @State private var saving = false
    @State private var problem: String?

    init(bank: NAccBank?, stores: [NAccStore], accountOptions: [NAccAccountRef], onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.bank = bank
        self.stores = stores
        self.accountOptions = accountOptions
        self.onClose = onClose
        self.onSaved = onSaved
        _storeId = State(initialValue: bank?.storeId ?? "")
        _bankName = State(initialValue: bank?.bankName ?? "")
        _branchName = State(initialValue: bank?.branchName ?? "")
        _accountType = State(initialValue: bank?.accountType ?? "ordinary")
        _last4 = State(initialValue: bank?.accountLast4 ?? "")
        _holder = State(initialValue: bank?.holderName ?? "")
        _accountId = State(initialValue: bank == nil ? (accountOptions.first?.id ?? "") : (bank?.accountId ?? ""))
    }

    var body: some View {
        NavigationStack {
            Form {
                if !stores.isEmpty {
                    Section("店舗（任意・全社共通なら未選択）") {
                        Picker("店舗", selection: $storeId) {
                            Text("全社共通").tag("")
                            ForEach(stores) { s in Text(s.name).tag(s.id) }
                        }
                    }
                }
                Section("口座") {
                    TextField("銀行名（例：〇〇銀行）", text: $bankName)
                    TextField("支店名（例：本店）", text: $branchName)
                    Picker("種別", selection: $accountType) {
                        Text("普通").tag("ordinary")
                        Text("当座").tag("checking")
                        Text("貯蓄").tag("savings")
                    }
                    TextField("口座番号（末尾4桁のみ）", text: Binding(get: { last4 }, set: { v in last4 = String(v.filter { $0.isASCII && $0.isNumber }.prefix(4)) }))
                        .keyboardType(.numberPad)
                    TextField("名義（例：カ）テンポワン）", text: $holder)
                }
                Section("対応する勘定科目") {
                    if accountOptions.isEmpty {
                        Text("普通預金等（sub_type=bank）の勘定科目が見つかりません。自動仕訳ページから標準科目（普通預金 110）を導入するか、勘定科目を登録してください。")
                            .font(.system(size: 13)).foregroundColor(NT.warn)
                    } else {
                        Picker("勘定科目", selection: $accountId) {
                            Text("選択してください").tag("")
                            ForEach(accountOptions) { a in Text("\(a.code) \(a.name)").tag(a.id) }
                        }
                    }
                }
                if let problem {
                    Section { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
            }
            .navigationTitle(bank == nil ? "銀行口座を登録" : "銀行口座を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "保存する") { Task { await save() } }
                        .disabled(saving || NAccText.trimmed(bankName).isEmpty)
                }
            }
        }
    }

    private func save() async {
        problem = nil
        saving = true
        defer { saving = false }
        let body: [String: Any] = [
            "type": "accBankSave",
            "id": bank?.id ?? "",
            "storeId": storeId,
            "bankName": bankName,
            "branchName": branchName,
            "accountType": accountType,
            "accountLast4": last4,
            "holderName": holder,
            "accountId": accountId,
        ]
        do {
            try await NativeModuleAPI.post(body)
            onSaved(bank == nil ? "銀行口座を登録しました" : "更新しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 取引を手入力（Web の BankManualTxForm）

struct NAccBankTxSheet: View {
    let bankId: String
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var date = Date()
    @State private var desc = ""
    @State private var direction = "deposit"
    @State private var amount = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("日付", selection: $date, displayedComponents: .date).environment(\.locale, Locale(identifier: "ja_JP"))
                    TextField("摘要（例：家賃振込）", text: $desc)
                    Picker("区分", selection: $direction) {
                        Text("入金").tag("deposit")
                        Text("出金").tag("withdrawal")
                    }
                    .pickerStyle(.segmented)
                    TextField("金額（例：10000）", text: $amount).keyboardType(.numberPad)
                }
                if let problem {
                    Section { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
            }
            .navigationTitle("取引を手入力")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "登録中…" : "登録する") { Task { await save() } }.disabled(saving)
                }
            }
        }
    }

    private func save() async {
        problem = nil
        guard let value = Int(NAccText.trimmed(amount)), value > 0 else { problem = "金額は1円以上の整数で入力してください"; return }
        guard !NAccText.trimmed(desc).isEmpty else { problem = "摘要を入力してください"; return }
        saving = true
        defer { saving = false }
        do {
            try await NativeModuleAPI.post([
                "type": "accBankTxAdd",
                "bankAccountId": bankId,
                "date": NPDate.str(date),
                "description": NAccText.trimmed(desc),
                "deposit": direction == "deposit" ? value : 0,
                "withdrawal": direction == "withdrawal" ? value : 0,
            ])
            onSaved("取引を登録しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - CSV取込（Web の BankCsvImport と同じ手順。ファイルはこの iPad で選び、中身をサーバーで読む）

struct NAccCsvMapping: Decodable, Hashable {
    var date: Int?
    var description: Int?
    var deposit: Int?
    var withdrawal: Int?

    var complete: Bool { date != nil && description != nil && (deposit != nil || withdrawal != nil) }

    var json: [String: Any] {
        func v(_ x: Int?) -> Any {
            if let x { return x }
            return NSNull()
        }
        return ["date": v(date), "description": v(description), "deposit": v(deposit), "withdrawal": v(withdrawal)]
    }
}

struct NAccCsvRow: Decodable, Identifiable, Hashable {
    let rowNumber: Int
    let date: String?
    let description: String?
    let deposit: Int
    let withdrawal: Int
    let error: String?
    let exactDuplicate: Bool
    let suspiciousDuplicate: Bool
    let suspiciousDescriptions: [String]
    var id: Int { rowNumber }
}

struct NAccCsvPreview: Decodable {
    let headers: [String]
    let mapping: NAccCsvMapping
    let complete: Bool
    let rowCount: Int
    let rows: [NAccCsvRow]
}

struct NAccCsvSummary: Decodable, Hashable {
    let newInserted: Int
    let suspiciousInserted: Int
    let exactDuplicateSkipped: Int
}

struct NAccCsvImportResponse: Decodable {
    let summary: NAccCsvSummary
}

enum NAccCsvStep { case upload, mapping, preview, result }

struct NAccCsvImport: View {
    let bankId: String
    let maxRows: Int
    let onImported: (String) -> Void

    @State private var step = NAccCsvStep.upload
    @State private var picking = false
    @State private var csv = ""
    @State private var fileName = ""
    @State private var headers: [String] = []
    @State private var rowCount = 0
    @State private var mapping = NAccCsvMapping()
    @State private var rows: [NAccCsvRow] = []
    @State private var skipped: Set<Int> = []
    @State private var summary: NAccCsvSummary?
    @State private var suspiciousTotal = 0
    @State private var busy = false
    @State private var problem: String?

    private var newRows: [NAccCsvRow] { rows.filter { $0.error == nil && !$0.exactDuplicate && !$0.suspiciousDuplicate } }
    private var suspiciousRows: [NAccCsvRow] { rows.filter { $0.error == nil && $0.suspiciousDuplicate } }
    private var importable: [NAccCsvRow] { newRows + suspiciousRows.filter { !skipped.contains($0.rowNumber) } }

    private func reset() {
        step = .upload; csv = ""; fileName = ""; headers = []; rowCount = 0; mapping = NAccCsvMapping()
        rows = []; skipped = []; summary = nil; problem = nil
    }

    var body: some View {
        NAccCard(title: "CSV取込") {
            VStack(alignment: .leading, spacing: 12) {
                switch step {
                case .upload: upload
                case .mapping: mappingStep
                case .preview: previewStep
                case .result: resultStep
                }
                if let problem {
                    NAccNotice(text: problem, color: NFColor.danger)
                }
            }
            .padding(16)
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText, .text, .data], allowsMultipleSelection: false) { res in
            if case .success(let urls) = res, let url = urls.first { Task { await pick(url) } }
        }
    }

    private var upload: some View {
        VStack(spacing: 10) {
            Image(systemName: "square.and.arrow.down.on.square").font(.system(size: 28)).foregroundColor(NT.ink3)
            Text("銀行明細のCSVファイルを選択してください（UTF-8。最大 \(maxRows) 行）").font(.system(size: 13.5)).foregroundColor(NT.ink2)
            NAccButton(text: "ファイルを選択", icon: "doc.badge.plus", kind: .primary, busy: busy) { picking = true }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }

    private func columnPicker(_ label: String, required: Bool, value: Int?, set: @escaping (Int?) -> Void) -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 3) {
                Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                if required { Text("*").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger) }
            }
            .frame(width: 90, alignment: .leading)
            Picker("", selection: Binding(get: { value ?? -1 }, set: { v in set(v < 0 ? nil : v) })) {
                Text("（使用しない）").tag(-1)
                ForEach(Array(headers.enumerated()), id: \.offset) { item in
                    Text(item.element).tag(item.offset)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(NT.ink)
            Spacer()
        }
    }

    private var mappingStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(fileName)（\(rowCount)行）の列を対応付けてください。日付・摘要は必須、入金・出金は少なくとも一方が必要です。")
                .font(.system(size: 13)).foregroundColor(NT.ink2)
            columnPicker("日付", required: true, value: mapping.date) { mapping.date = $0 }
            columnPicker("摘要", required: true, value: mapping.description) { mapping.description = $0 }
            columnPicker("入金", required: false, value: mapping.deposit) { mapping.deposit = $0 }
            columnPicker("出金", required: false, value: mapping.withdrawal) { mapping.withdrawal = $0 }
            HStack {
                NAccButton(text: "やり直す", icon: "arrow.uturn.left") { reset() }
                Spacer()
                NAccButton(text: "確認へ進む", icon: "arrow.right", kind: .primary, busy: busy, disabled: !mapping.complete) {
                    Task { await preview(with: mapping) }
                }
            }
        }
    }

    private var previewStep: some View {
        let errors = rows.filter { $0.error != nil }.count
        let exact = rows.filter { $0.exactDuplicate }.count
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                NPBadge(text: "新規 \(newRows.count)件", color: NFColor.success)
                NPBadge(text: "要確認（疑わしい重複） \(suspiciousRows.count)件", color: NT.warn)
                NPBadge(text: "完全重複（自動スキップ） \(exact)件", color: NT.ink3)
                NPBadge(text: "エラー \(errors)件", color: NFColor.danger)
            }
            if !suspiciousRows.isEmpty {
                NAccNotice(text: "同じ日付・同じ金額で摘要が異なる既存の取引があります。二重記帳の可能性があるため、行ごとに「取り込む/スキップ」を確認してください（既定は取り込む）。")
            }
            VStack(spacing: 0) {
                NAccTableHead(cells: [("行", 44, false), ("日付", 92, false), ("摘要", nil, false), ("入金", 100, true), ("出金", 100, true), ("状態", 200, false), ("取込", 100, false)])
                ForEach(rows) { r in csvRow(r) }
            }
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                NAccButton(text: "戻る", icon: "chevron.left", disabled: busy) { step = .mapping }
                Spacer()
                NAccButton(text: "\(importable.count)件を取込む", icon: "square.and.arrow.down", kind: .primary, busy: busy, disabled: importable.isEmpty) {
                    Task { await runImport() }
                }
            }
        }
    }

    private func csvRow(_ r: NAccCsvRow) -> some View {
        HStack(spacing: 10) {
            NAccCell(text: "\(r.rowNumber)", width: 44, color: NT.ink3, size: 12.5)
            NAccCell(text: r.date.map { NPDate.slash($0) } ?? "—", width: 92, color: NT.ink2, size: 12.5)
            NAccCell(text: r.description ?? "—")
            NAccCell(text: r.error == nil && r.deposit > 0 ? NT.yen(r.deposit) : "—", width: 100, trailing: true)
            NAccCell(text: r.error == nil && r.withdrawal > 0 ? NT.yen(r.withdrawal) : "—", width: 100, trailing: true)
            Group {
                if let e = r.error {
                    HStack(spacing: 4) {
                        NPBadge(text: "エラー", color: NFColor.danger)
                        Text(e).font(.system(size: 11.5)).foregroundColor(NFColor.danger).lineLimit(2)
                    }
                } else if r.exactDuplicate {
                    NPBadge(text: "完全重複", color: NT.ink3)
                } else if r.suspiciousDuplicate {
                    VStack(alignment: .leading, spacing: 2) {
                        NPBadge(text: "要確認", color: NT.warn)
                        Text("類似取引: \(r.suspiciousDescriptions.joined(separator: "、"))").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(2)
                    }
                } else {
                    NPBadge(text: "OK", color: NFColor.success)
                }
            }
            .frame(width: 200, alignment: .leading)
            Group {
                if r.error == nil && r.suspiciousDuplicate {
                    let on = !skipped.contains(r.rowNumber)
                    NAccSmallButton(text: on ? "取り込む" : "スキップ", tint: on ? NT.ink2 : NFColor.danger) {
                        if on { skipped.insert(r.rowNumber) } else { skipped.remove(r.rowNumber) }
                    }
                } else if r.error == nil && !r.exactDuplicate {
                    Text("取込対象").font(.system(size: 12)).foregroundColor(NT.ink3)
                } else if r.error == nil && r.exactDuplicate {
                    Text("自動スキップ").font(.system(size: 12)).foregroundColor(NT.ink3)
                } else {
                    Text("—").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
            }
            .frame(width: 100, alignment: .leading)
        }
        .padding(.horizontal, 14).frame(minHeight: 40)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private var resultStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let s = summary {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundColor(NFColor.success)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("取込が完了しました").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                        Text("新規 \(s.newInserted)件 ・ 完全重複スキップ \(s.exactDuplicateSkipped)件 ・ 要確認 \(suspiciousTotal)件のうち取込 \(s.suspiciousInserted)件")
                            .font(.system(size: 13)).foregroundColor(NT.ink2)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.successSoft))
            }
            NAccButton(text: "続けて取り込む", icon: "arrow.counterclockwise") { reset() }
        }
    }

    // MARK: 操作

    private func pick(_ url: URL) async {
        problem = nil
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { problem = "ファイルの読み込みに失敗しました"; return }
        // Web は UTF-8 だけ。Excel の Shift_JIS も読めるようにする（iPad で文字にしてから送る）
        guard var text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .shiftJIS) else {
            problem = "文字コードが読めません。Excel 等で保存する際は「CSV UTF-8」形式で保存し直してください。"
            return
        }
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        csv = text
        fileName = url.lastPathComponent
        await preview(with: nil)
    }

    private func preview(with m: NAccCsvMapping?) async {
        problem = nil
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["type": "accBankCsvPreview", "bankAccountId": bankId, "csv": csv]
        if let m { body["mapping"] = m.json }
        do {
            let r = try await NAccAPI.post(body, as: NAccCsvPreview.self)
            headers = r.headers
            mapping = r.mapping
            rowCount = r.rowCount
            rows = r.rows
            skipped = []
            if m == nil || !r.complete {
                step = .mapping
            } else {
                step = .preview
            }
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }

    private func runImport() async {
        let payload: [[String: Any]] = newRows.map { r in row(r, category: "new") } + suspiciousRows.filter { !skipped.contains($0.rowNumber) }.map { r in row(r, category: "suspicious") }
        guard !payload.isEmpty else { return }
        problem = nil
        busy = true
        defer { busy = false }
        do {
            let r = try await NAccAPI.post(["type": "accBankCsvImport", "bankAccountId": bankId, "rows": payload], as: NAccCsvImportResponse.self)
            suspiciousTotal = suspiciousRows.count
            summary = r.summary
            step = .result
            onImported("取込が完了しました（新規 \(r.summary.newInserted)件）")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }

    private func row(_ r: NAccCsvRow, category: String) -> [String: Any] {
        ["date": r.date ?? "", "description": r.description ?? "", "deposit": r.deposit, "withdrawal": r.withdrawal, "category": category]
    }
}
