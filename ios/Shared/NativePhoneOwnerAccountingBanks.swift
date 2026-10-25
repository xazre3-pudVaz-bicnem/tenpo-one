import SwiftUI
import UniformTypeIdentifiers

// iPhone の店長・オーナー：会計 › 銀行口座（Web の /app/accounting/banks・/banks/<id>・components/accounting/bank-*.tsx と同じ）。
//   一覧：口座を追加・標準科目の導入・口座のカード（押すと明細）
//   明細：編集・削除（確認）・残高・売掛金/買掛金の参考残高・CSV取込（ファイルを選ぶ→列の対応付け→確認→取込）・手入力で追加・
//        取引ごとの対応科目（消込ショートカット・探して選ぶ）・一括適用・下書き作成／作成して確定（確認）・作成済みの仕訳へ
// サーバーは iPad と同じ GET part=accounting&view=banks|bank ／ POST accBank*（返事の形は変えない）。

// MARK: - 中身（GET view=banks ／ view=bank&id=）

struct NPACBankRow: Decodable, Identifiable, Hashable {
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

struct NPACBanksPayload: Decodable {
    let accountsInstalled: Bool
    let accountOptions: [NPACAccountRef]
    let formStores: [NPACStore]
    let banks: [NPACBankRow]
}

struct NPACBank: Decodable, Hashable {
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

struct NPACBankTx: Decodable, Identifiable, Hashable {
    let id: String
    let date: String
    let description: String
    let deposit: Int
    let withdrawal: Int
    let runningBalance: Int
    let journalEntryId: String?
}

struct NPACSubAccount: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let subType: String?
}

struct NPACBankPayload: Decodable {
    let bank: NPACBank
    let balance: Int
    let receivableTotal: Int
    let payableTotal: Int
    let txs: [NPACBankTx]
    let accountOptions: [NPACSubAccount]
    let editAccountOptions: [NPACAccountRef]
    let formStores: [NPACStore]
    let maxImportRows: Int
}

enum NPACBankText {
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

// MARK: - 一覧

struct NPACBanksPage: View {
    let initial: [String: String]
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACBanksPayload>()
    @State private var openId: String?
    @State private var adding = false
    @State private var started = false

    init(initial: [String: String], nav: NPACNav) {
        self.initial = initial
        self.nav = nav
        _openId = State(initialValue: initial["id"].flatMap { NOS.isUuid($0) ? $0 : nil })
    }

    private func load() async { await loader.load(["view": "banks"]) }

    var body: some View {
        ZStack {
            NPACFrame(nav: nav, trailing: {
                NPOCBarButton(icon: "plus", label: "口座") { adding = true }
            }) {
                NPACPageShell(error: $loader.error, toast: $loader.toast, hasData: loader.data != nil, useWeb: loader.useWeb, onWeb: nav.web, retry: { Task { await load() } }) {
                    if let p = loader.data { list(p) }
                }
            }
            if let id = openId {
                NPACBankDetail(bankId: id, nav: nav, onBack: { openId = nil }, onChanged: { Task { await load() } })
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.22), value: openId)
        .task {
            if !started {
                started = true
                await load()
            }
        }
        .sheet(isPresented: $adding) {
            if let p = loader.data {
                NPACBankForm(bank: nil, stores: p.formStores, accountOptions: p.accountOptions, onClose: { adding = false }, onSaved: { msg in
                    adding = false
                    loader.toast = msg
                    Task { await load() }
                })
            }
        }
    }

    private func list(_ p: NPACBanksPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text("銀行口座を登録し、CSV取込または手入力で取引を記帳します。銀行API連携は行いません（手入力・CSV取込で完結）。")
                    .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
                if !p.accountsInstalled {
                    NPACInstallBanner(busy: loader.busy) {
                        Task { if await loader.act(["type": "accInstallAccounts"], done: "標準の勘定科目を導入しました") { await load() } }
                    }
                }
                if p.banks.isEmpty {
                    NPOCEmpty(icon: "building.columns", title: "銀行口座が登録されていません", note: "右上の「＋ 口座」から登録すると、取引の記帳・仕訳作成ができるようになります。")
                } else {
                    ForEach(p.banks) { b in
                        Button { openId = b.id } label: { card(b) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await load() }
    }

    private func card(_ b: NPACBankRow) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Image(systemName: "building.columns").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                Text(b.bankName).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            Text(NPACBankText.line(branch: b.branchName, typeLabel: b.accountTypeLabel, last4: b.accountLast4)).font(.system(size: 12.5)).foregroundColor(NT.ink2)
            if let h = b.holderName, !h.isEmpty { Text("名義：\(h)").font(.system(size: 12)).foregroundColor(NT.ink3) }
            HStack(spacing: 6) {
                if let s = b.storeName { NOSBadge(text: s, color: NT.ink3) }
                if let code = b.accountCode {
                    NOSBadge(text: "\(code) \(b.accountName ?? "")", color: NT.purple)
                } else {
                    NOSBadge(text: "対応科目未設定", color: NT.warn)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard(14))
    }
}

// MARK: - 口座の明細

struct NPACTxRef: Identifiable {
    let id: String
}

struct NPACBankDetail: View {
    let bankId: String
    let nav: NPACNav
    let onBack: () -> Void
    let onChanged: () -> Void

    @StateObject private var loader = NPACLoader<NPACBankPayload>()
    @State private var selected: Set<String> = []
    @State private var accountByTx: [String: String] = [:]
    @State private var editing = false
    @State private var adding = false
    @State private var deleting = false
    @State private var confirmPost = false
    @State private var pickingTx: NPACTxRef?
    @State private var bulkPicking = false
    @State private var started = false

    private static let depositCode = "130"     // 売掛金（回収）
    private static let withdrawalCode = "599"  // 雑費

    private func load() async {
        await loader.load(["view": "bank", "id": bankId])
        guard let p = loader.data else { return }
        // 未作成の取引に既定の対応科目（入金=売掛金の回収 130・出金=雑費 599。Web と同じ）
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
        NPOCDetailFrame(title: loader.data?.bank.bankName ?? "銀行口座", subtitle: "取引・仕訳", backLabel: "銀行口座", onBack: onBack, trailing: {
            if loader.data != nil {
                Menu {
                    Button { editing = true } label: { Label("口座を編集", systemImage: "pencil") }
                    Button(role: .destructive) { deleting = true } label: { Label("口座を削除", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 19, weight: .bold)).foregroundColor(.white).frame(width: 44, height: 44)
                }
            }
        }) {
            NPACPageShell(error: $loader.error, toast: $loader.toast, hasData: loader.data != nil, useWeb: loader.useWeb, onWeb: nav.web, retry: { Task { await load() } }) {
                if let p = loader.data { content(p) }
            }
        }
        .task {
            if !started {
                started = true
                await load()
            }
        }
        .sheet(isPresented: $editing) {
            if let p = loader.data {
                NPACBankForm(bank: p.bank, stores: p.formStores, accountOptions: p.editAccountOptions, onClose: { editing = false }, onSaved: { msg in
                    editing = false
                    loader.toast = msg
                    onChanged()
                    Task { await load() }
                })
            }
        }
        .sheet(isPresented: $adding) {
            NPACBankTxSheet(bankId: bankId, onClose: { adding = false }, onSaved: { msg in
                adding = false
                loader.toast = msg
                Task { await load() }
            })
        }
        .sheet(item: $pickingTx) { ref in
            if let p = loader.data, let t = p.txs.first(where: { $0.id == ref.id }) {
                NPACPickSheet(title: t.deposit > 0 ? "対応科目（入金）" : "対応科目（出金）", items: pickItems(for: t.deposit, p), selected: accountByTx[t.id], onPick: { id in
                    accountByTx[t.id] = id
                    pickingTx = nil
                }, onClose: { pickingTx = nil })
            }
        }
        .sheet(isPresented: $bulkPicking) {
            if let p = loader.data {
                NPACPickSheet(title: "選んだ\(selected.count)件に一括適用", items: p.accountOptions.map { NPACPickItem(id: $0.id, name: "\($0.code) \($0.name)", sub: "") }, selected: nil, onPick: { id in
                    var next = accountByTx
                    for s in selected { next[s] = id }
                    accountByTx = next
                    bulkPicking = false
                }, onClose: { bulkPicking = false })
            }
        }
        .confirmationDialog("この銀行口座を削除しますか？", isPresented: $deleting, titleVisibility: .visible) {
            Button("削除する", role: .destructive) {
                Task {
                    if await loader.act(["type": "accBankDelete", "id": bankId], done: "銀行口座を削除しました") {
                        onChanged()
                        onBack()
                    }
                }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("取り込み済みの取引・仕訳は残ります。")
        }
        .confirmationDialog("選んだ\(selected.count)件の仕訳を作成して確定しますか？", isPresented: $confirmPost, titleVisibility: .visible) {
            Button("作成して確定する") { create(post: true) }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("確定した仕訳は編集・削除できません（直すときは修正仕訳・取消）。下書きにしたいときは「下書き作成」を押してください。")
        }
    }

    // MARK: 中身

    private func content(_ p: NPACBankPayload) -> some View {
        let pending = p.txs.filter { $0.journalEntryId == nil }
        return VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    head(p)
                    NPACTiles {
                        NOMStat(label: "売掛金残高（参考・全社）", value: NT.yen(p.receivableTotal), sub: "入金を「売掛金の回収」で消込むと減ります")
                        NOMStat(label: "買掛金残高（参考・全社）", value: NT.yen(p.payableTotal), sub: "出金を「買掛金の支払」で消込むと減ります")
                    }
                    NPACCsvImport(bankId: p.bank.id, maxRows: p.maxImportRows) { msg in
                        loader.toast = msg
                        Task { await load() }
                    }
                    NPOCWideButton(text: "取引を手入力で追加", icon: "plus", kind: .secondary, height: 46) { adding = true }
                    transactions(p, pending: pending)
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 40)
            }
            .refreshable { await load() }
            if !pending.isEmpty { actionBar }
        }
    }

    private func head(_ p: NPACBankPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(NPACBankText.line(branch: p.bank.branchName, typeLabel: p.bank.accountTypeLabel, last4: p.bank.accountLast4, holder: p.bank.holderName))
                .font(.system(size: 13)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            WrapLayout(spacing: 6) {
                if let s = p.bank.storeName { NOSBadge(text: s, color: NT.ink3) }
                if let code = p.bank.accountCode {
                    NOSBadge(text: "\(code) \(p.bank.accountName ?? "")", color: NT.purple)
                } else {
                    NOSBadge(text: "対応する勘定科目が未設定（右上の … → 編集）", color: NT.warn)
                }
            }
            HStack(alignment: .firstTextBaseline) {
                Text("現在残高（記帳ベース）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Text(NT.yen(p.txs.isEmpty ? 0 : p.balance)).font(.system(size: 26, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
            Text("銀行API連携は行いません（手入力・CSV取込で完結。将来のAPI接続はオプション）。").font(.system(size: 11)).foregroundColor(NT.ink3)
        }
        .padding(14)
        .background(npocCard())
    }

    // MARK: 取引

    /// 入金は売掛金・出金は買掛金を先頭に（Web の消込ショートカット）
    private func pickItems(for deposit: Int, _ p: NPACBankPayload) -> [NPACPickItem] {
        let label = deposit > 0 ? "売掛金の回収" : "買掛金の支払"
        let shortcuts = p.accountOptions.filter { $0.subType == (deposit > 0 ? "receivable" : "payable") }
        let ids = Set(shortcuts.map(\.id))
        let head = shortcuts.map { NPACPickItem(id: $0.id, name: "\(label)（\($0.code) \($0.name)）", sub: "消込ショートカット") }
        let rest = p.accountOptions.filter { !ids.contains($0.id) }.map { NPACPickItem(id: $0.id, name: "\($0.code) \($0.name)", sub: "") }
        return head + rest
    }

    @ViewBuilder private func transactions(_ p: NPACBankPayload, pending: [NPACBankTx]) -> some View {
        if p.txs.isEmpty {
            NPOCEmpty(icon: "list.bullet", title: "取引がありません", note: "CSV取込または手入力で取引を登録してください。")
        } else {
            NPOCSectionTitle(title: "取引（\(p.txs.count)件・未作成 \(pending.count)件）", note: "未作成の取引を選び、対応する勘定科目を決めてから仕訳を作ります。")
            if !pending.isEmpty && p.accountOptions.contains(where: { $0.subType == "receivable" || $0.subType == "payable" }) {
                NOMNote(text: "消込：入金の対応科目に「売掛金の回収」を選ぶと売掛金が減り、出金で「買掛金の支払」を選ぶと買掛金が減ります（対応科目の先頭の候補）。")
            }
            if !pending.isEmpty {
                HStack(spacing: 8) {
                    Button {
                        if selected.count == pending.count { selected = [] } else { selected = Set(pending.map(\.id)) }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: selected.count == pending.count ? "checkmark.square.fill" : "square").font(.system(size: 19, weight: .semibold)).foregroundColor(NT.purple)
                            Text("未作成をすべて選ぶ").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 4)
                    if !p.accountOptions.isEmpty {
                        NPACPill(title: "一括で科目", icon: "square.stack", enabled: !selected.isEmpty) { bulkPicking = true }
                    }
                }
                .padding(.horizontal, 4)
            }
            ForEach(p.txs) { t in txCard(t, p) }
        }
    }

    private func txCard(_ t: NPACBankTx, _ p: NPACBankPayload) -> some View {
        let isPending = t.journalEntryId == nil
        let on = selected.contains(t.id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 4) {
                if isPending {
                    NPACCheck(on: on) {
                        if on { selected.remove(t.id) } else { selected.insert(t.id) }
                    }
                    .padding(.leading, -6)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(NPACText.date(t.date)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                        Spacer(minLength: 4)
                        if isPending {
                            NOSBadge(text: "未作成", color: NT.ink3)
                        } else {
                            Button {
                                nav.open(.journal, ["source_type": "bank", "source_id": t.id, "from": t.date, "to": t.date])
                            } label: {
                                HStack(spacing: 3) {
                                    NOSBadge(text: "作成済み", color: NT.ok)
                                    Image(systemName: "arrow.up.right.square").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Text(t.description).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        if t.deposit > 0 { Text("入金 \(NT.yen(t.deposit))").foregroundColor(NT.ok) }
                        if t.withdrawal > 0 { Text("出金 \(NT.yen(t.withdrawal))").foregroundColor(NT.danger) }
                        Spacer(minLength: 4)
                        Text("残高 \(NT.yen(t.runningBalance))").foregroundColor(NT.ink2)
                    }
                    .font(.system(size: 13, weight: .bold)).monospacedDigit()
                }
            }
            if isPending {
                if p.accountOptions.isEmpty {
                    Text("勘定科目が未導入です").font(.system(size: 12)).foregroundColor(NT.ink3)
                } else {
                    accountButton(t, p)
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? NT.lilac : Color.white))
    }

    private func accountButton(_ t: NPACBankTx, _ p: NPACBankPayload) -> some View {
        let current = accountByTx[t.id] ?? ""
        let a = p.accountOptions.first { $0.id == current }
        let shortcut = a.map { $0.subType == (t.deposit > 0 ? "receivable" : "payable") } ?? false
        return Button { pickingTx = NPACTxRef(id: t.id) } label: {
            HStack(spacing: 6) {
                Text("対応科目").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3)
                Text(a.map { "\($0.code) \($0.name)" } ?? "選択してください").font(.system(size: 14, weight: .semibold))
                    .foregroundColor(a == nil ? NT.ink3 : NT.ink).lineLimit(1)
                if shortcut { NOSBadge(text: t.deposit > 0 ? "消込（売掛金の回収）" : "消込（買掛金の支払）", color: NT.purple) }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 12).frame(minHeight: 42)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
        }
        .buttonStyle(.plain)
    }

    private var actionBar: some View {
        VStack(spacing: 8) {
            Text(selected.isEmpty ? "仕訳にする取引を選んでください" : "\(selected.count)件を選択中").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
            HStack(spacing: 8) {
                NPOCWideButton(text: "下書き作成", kind: .secondary, busy: loader.busy, disabled: selected.isEmpty, height: 46) { create(post: false) }
                NPOCWideButton(text: "作成して確定", kind: .primary, busy: loader.busy, disabled: selected.isEmpty, height: 46) { confirmPost = true }
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 10)
        .background(Color.white.shadow(color: Color.black.opacity(0.06), radius: 6, y: -2))
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
            if let r = await loader.actResult(["type": "accBankJournal", "bankAccountId": bankId, "items": items, "post": post], as: NPACCreateResponse.self) {
                if r.result.failed.isEmpty { loader.toast = r.result.message } else { loader.error = r.result.message }
                selected = []
                await load()
            }
        }
    }
}

// MARK: - CSV取込（Web の BankCsvImport と同じ手順。ファイルはこの iPhone で選び、中身をサーバーで読む）

struct NPACCsvMapping: Decodable, Hashable {
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

struct NPACCsvRow: Decodable, Identifiable, Hashable {
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

struct NPACCsvPreview: Decodable {
    let headers: [String]
    let mapping: NPACCsvMapping
    let complete: Bool
    let rowCount: Int
    let rows: [NPACCsvRow]
}

struct NPACCsvSummary: Decodable, Hashable {
    let newInserted: Int
    let suspiciousInserted: Int
    let exactDuplicateSkipped: Int
}

struct NPACCsvImportResponse: Decodable {
    let summary: NPACCsvSummary
}

enum NPACCsvStep { case upload, mapping, preview, result }

struct NPACCsvImport: View {
    let bankId: String
    let maxRows: Int
    let onImported: (String) -> Void

    @State private var step = NPACCsvStep.upload
    @State private var picking = false
    @State private var csv = ""
    @State private var fileName = ""
    @State private var headers: [String] = []
    @State private var rowCount = 0
    @State private var mapping = NPACCsvMapping()
    @State private var rows: [NPACCsvRow] = []
    @State private var skipped: Set<Int> = []
    @State private var summary: NPACCsvSummary?
    @State private var suspiciousTotal = 0
    @State private var busy = false
    @State private var problem: String?
    @State private var confirmImport = false

    private var newRows: [NPACCsvRow] { rows.filter { $0.error == nil && !$0.exactDuplicate && !$0.suspiciousDuplicate } }
    private var suspiciousRows: [NPACCsvRow] { rows.filter { $0.error == nil && $0.suspiciousDuplicate } }
    private var importable: [NPACCsvRow] { newRows + suspiciousRows.filter { !skipped.contains($0.rowNumber) } }

    private func reset() {
        step = .upload; csv = ""; fileName = ""; headers = []; rowCount = 0; mapping = NPACCsvMapping()
        rows = []; skipped = []; summary = nil; problem = nil
    }

    var body: some View {
        NPOCard(title: "CSV取込", trailing: step == .upload ? "" : fileName) {
            switch step {
            case .upload: upload
            case .mapping: mappingStep
            case .preview: previewStep
            case .result: resultStep
            }
            if let problem { NPACProblem(text: problem) }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText, .text, .data], allowsMultipleSelection: false) { res in
            if case .success(let urls) = res, let url = urls.first { Task { await pick(url) } }
        }
        .confirmationDialog("\(importable.count)件を取り込みますか？", isPresented: $confirmImport, titleVisibility: .visible) {
            Button("取り込む") { Task { await runImport() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「\(fileName)」の取引を、この口座の明細に入れます（完全重複は自動でスキップ）。")
        }
    }

    private var upload: some View {
        VStack(spacing: 10) {
            Image(systemName: "square.and.arrow.down.on.square").font(.system(size: 26)).foregroundColor(NT.ink3)
            Text("銀行明細のCSVファイルを選んでください（UTF-8・Shift_JIS。最大 \(maxRows) 行）").font(.system(size: 12.5)).foregroundColor(NT.ink2)
                .multilineTextAlignment(.center)
            NPOCWideButton(text: busy ? "読み込み中…" : "ファイルを選ぶ", icon: "doc.badge.plus", kind: .primary, busy: busy, height: 44) {
                if NativePreview.current != nil { problem = "見本では取り込めません"; return }
                picking = true
            }
        }
        .frame(maxWidth: .infinity)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }

    private func columnPicker(_ label: String, required: Bool, value: Int?, set: @escaping (Int?) -> Void) -> some View {
        let options: [(String, String)] = [("-1", "（使用しない）")] + headers.enumerated().map { (String($0.offset), $0.element) }
        return HStack(spacing: 10) {
            HStack(spacing: 2) {
                Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                if required { Text("*").font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger) }
            }
            .frame(width: 56, alignment: .leading)
            NPACSelect(options: options, selection: String(value ?? -1)) { v in
                let n = Int(v) ?? -1
                set(n < 0 ? nil : n)
            }
        }
    }

    private var mappingStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(fileName)（\(rowCount)行）の列を対応付けてください。日付・摘要は必須、入金・出金は少なくとも一方が必要です。")
                .font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            columnPicker("日付", required: true, value: mapping.date) { mapping.date = $0 }
            columnPicker("摘要", required: true, value: mapping.description) { mapping.description = $0 }
            columnPicker("入金", required: false, value: mapping.deposit) { mapping.deposit = $0 }
            columnPicker("出金", required: false, value: mapping.withdrawal) { mapping.withdrawal = $0 }
            HStack(spacing: 8) {
                NPOCWideButton(text: "やり直す", kind: .secondary, height: 44) { reset() }
                NPOCWideButton(text: "確認へ進む", icon: "arrow.right", kind: .primary, busy: busy, disabled: !mapping.complete, height: 44) {
                    Task { await preview(with: mapping) }
                }
            }
        }
    }

    private var previewStep: some View {
        let errors = rows.filter { $0.error != nil }.count
        let exact = rows.filter { $0.exactDuplicate }.count
        return VStack(alignment: .leading, spacing: 10) {
            WrapLayout(spacing: 6) {
                NOSBadge(text: "新規 \(newRows.count)件", color: NT.ok)
                NOSBadge(text: "要確認 \(suspiciousRows.count)件", color: NT.warn)
                NOSBadge(text: "完全重複（自動スキップ） \(exact)件", color: NT.ink3)
                NOSBadge(text: "エラー \(errors)件", color: NT.danger)
            }
            if !suspiciousRows.isEmpty {
                NOMNote(text: "同じ日付・同じ金額で摘要が異なる既存の取引があります。二重記帳の可能性があるため、行ごとに「取り込む／スキップ」を確かめてください（既定は取り込む）。", tint: NT.warn)
            }
            ForEach(rows) { r in csvRow(r) }
            HStack(spacing: 8) {
                NPOCWideButton(text: "戻る", kind: .secondary, disabled: busy, height: 44) { step = .mapping }
                NPOCWideButton(text: "\(importable.count)件を取込む", icon: "square.and.arrow.down", kind: .primary, busy: busy, disabled: importable.isEmpty, height: 44) {
                    confirmImport = true
                }
            }
        }
    }

    private func csvRow(_ r: NPACCsvRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("\(r.rowNumber)").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(NT.ink3)
                Text(r.date.map { NPACText.date($0) } ?? "—").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                Spacer(minLength: 4)
                if r.error != nil {
                    NOSBadge(text: "エラー", color: NT.danger)
                } else if r.exactDuplicate {
                    NOSBadge(text: "完全重複", color: NT.ink3)
                } else if r.suspiciousDuplicate {
                    NOSBadge(text: "要確認", color: NT.warn)
                } else {
                    NOSBadge(text: "OK", color: NT.ok)
                }
            }
            Text(r.description ?? "—").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2)
            if r.error == nil {
                HStack(spacing: 10) {
                    if r.deposit > 0 { Text("入金 \(NT.yen(r.deposit))").foregroundColor(NT.ok) }
                    if r.withdrawal > 0 { Text("出金 \(NT.yen(r.withdrawal))").foregroundColor(NT.danger) }
                    Spacer(minLength: 4)
                    if r.suspiciousDuplicate {
                        let on = !skipped.contains(r.rowNumber)
                        NPACPill(title: on ? "取り込む" : "スキップ", tint: on ? NT.purpleDeep : NT.danger) {
                            if on { skipped.insert(r.rowNumber) } else { skipped.remove(r.rowNumber) }
                        }
                    } else if r.exactDuplicate {
                        Text("自動スキップ").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                    }
                }
                .font(.system(size: 12.5, weight: .bold)).monospacedDigit()
            }
            if let e = r.error {
                Text(e).font(.system(size: 11.5)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
            }
            if r.suspiciousDuplicate && !r.suspiciousDescriptions.isEmpty {
                Text("類似取引：\(r.suspiciousDescriptions.joined(separator: "、"))").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(2)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
    }

    private var resultStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let s = summary {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundColor(NT.ok)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("取込が完了しました").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                        Text("新規 \(s.newInserted)件 ・ 完全重複スキップ \(s.exactDuplicateSkipped)件 ・ 要確認 \(suspiciousTotal)件のうち取込 \(s.suspiciousInserted)件")
                            .font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.ok.opacity(0.1)))
            }
            NPOCWideButton(text: "続けて取り込む", icon: "arrow.counterclockwise", kind: .secondary, height: 44) { reset() }
        }
    }

    // MARK: 操作

    private func pick(_ url: URL) async {
        problem = nil
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { problem = "ファイルの読み込みに失敗しました"; return }
        // Web は UTF-8 だけ。Excel の Shift_JIS も読めるようにする（iPhone で文字にしてから送る。iPad と同じ）
        guard var text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .shiftJIS) else {
            problem = "文字コードが読めません。Excel 等で保存する際は「CSV UTF-8」形式で保存し直してください。"
            return
        }
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        csv = text
        fileName = url.lastPathComponent
        await preview(with: nil)
    }

    private func preview(with m: NPACCsvMapping?) async {
        problem = nil
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["type": "accBankCsvPreview", "bankAccountId": bankId, "csv": csv]
        if let m { body["mapping"] = m.json }
        do {
            let r = try await NPACApi.post(body, as: NPACCsvPreview.self)
            headers = r.headers
            mapping = r.mapping
            rowCount = r.rowCount
            rows = r.rows
            skipped = []
            step = (m == nil || !r.complete) ? .mapping : .preview
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }

    private func runImport() async {
        let payload: [[String: Any]] = newRows.map { row($0, category: "new") } + suspiciousRows.filter { !skipped.contains($0.rowNumber) }.map { row($0, category: "suspicious") }
        guard !payload.isEmpty else { return }
        problem = nil
        busy = true
        defer { busy = false }
        do {
            let r = try await NPACApi.post(["type": "accBankCsvImport", "bankAccountId": bankId, "rows": payload], as: NPACCsvImportResponse.self)
            suspiciousTotal = suspiciousRows.count
            summary = r.summary
            step = .result
            onImported("取込が完了しました（新規 \(r.summary.newInserted)件）")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }

    private func row(_ r: NPACCsvRow, category: String) -> [String: Any] {
        ["date": r.date ?? "", "description": r.description ?? "", "deposit": r.deposit, "withdrawal": r.withdrawal, "category": category]
    }
}
