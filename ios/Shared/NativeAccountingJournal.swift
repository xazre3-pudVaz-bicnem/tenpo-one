import SwiftUI

// 会計 › 仕訳（Web の /app/accounting・components/accounting/journal-panel.tsx・journal-entry-dialog.tsx・period-close-panel.tsx と同じ）。
//   絞り込み（期間・状態・区分・店舗）・CSV出力・仕訳を作成（下書き）・編集・確定・削除・修正仕訳・取消（理由）・元取引へ・ページ送り
//   下：月次締め（直近12ヶ月・締める・締め解除（理由）・履歴）。会計の書込ができる人だけ

// MARK: - データ（GET view=journal）

struct NAccJournalLine: Decodable, Hashable {
    let accountId: String
    let accountCode: String
    let accountName: String
    let side: String
    let amount: Int
    let taxTreatment: String
    let taxLabel: String
    let memo: String?
}

struct NAccJournalEntry: Decodable, Identifiable, Hashable {
    let id: String
    let entryNo: Int
    let entryDate: String
    let description: String
    let status: String
    let statusLabel: String
    let sourceType: String
    let sourceLabel: String
    let sourceId: String?
    let storeId: String?
    let storeName: String?
    let voidReason: String?
    let debitTotal: Int
    let originHref: String?
    let originLabel: String?
    let lines: [NAccJournalLine]
}

struct NAccJournalAccount: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let defaultTaxTreatment: String
}

struct NAccJournalFilters: Decodable, Hashable {
    let from: String
    let to: String
    let status: String
    let sourceType: String
    let sourceId: String
    let storeId: String
    let page: Int
}

struct NAccJournalPayload: Decodable {
    let stores: [NAccStore]
    let isHq: Bool
    let canWrite: Bool
    let today: String
    let filters: NAccJournalFilters
    let statusOptions: [NAccOption]
    let sourceTypeOptions: [NAccOption]
    let taxOptions: [NAccOption]
    let accounts: [NAccJournalAccount]
    let entries: [NAccJournalEntry]
    let count: Int
    let pageSize: Int
    let totalPages: Int
    let rangeFrom: Int
    let exportPath: String
}

struct NAccEditorTarget: Identifiable {
    let id: String
    let entry: NAccJournalEntry?
}

// MARK: - 仕訳の一覧

struct NAccJournalPage: View {
    let initial: [String: String]
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccJournalPayload>()
    @State private var applied: [String: String] = [:]
    @State private var from = ""
    @State private var to = ""
    @State private var status = ""
    @State private var sourceType = ""
    @State private var sourceId = ""
    @State private var store = ""
    @State private var expanded: Set<String> = []
    @State private var editing: NAccEditorTarget?
    @State private var deleting: NAccJournalEntry?
    @State private var voiding: NAccJournalEntry?
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "journal"
        await loader.load(full)
        if let f = loader.data?.filters {
            from = f.from; to = f.to; status = f.status; sourceType = f.sourceType; sourceId = f.sourceId; store = f.storeId
        }
    }

    private func reload() async { await load(applied) }

    private func filterQuery(page: Int) -> [String: String] {
        ["from": from, "to": to, "status": status, "source_type": sourceType, "source_id": sourceId, "store": store, "page": String(page)]
    }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NAccHeader(title: "仕訳", subtitle: "複式簿記の仕訳を作成・確定・取消します") {
                            NAccButton(text: "CSV出力", icon: "square.and.arrow.down") {
                                NAccExport.csv(p.exportPath, name: "仕訳_\(p.filters.from)_\(p.filters.to).csv") { loader.error = $0 }
                            }
                            if p.canWrite {
                                NAccButton(text: "仕訳を作成", icon: "plus", kind: .primary) { editing = NAccEditorTarget(id: "new", entry: nil) }
                            }
                        }
                        filters(p)
                        if !p.filters.sourceId.isEmpty { sourceBanner(p) }
                        list(p)
                        pager(p)
                        if p.canWrite { NAccPeriodPanel(nav: nav) }
                    }
                    .padding(16).padding(.bottom, 24)
                }
            } else {
                NAccLoading(error: loader.error) { Task { await reload() } }
            }
        }
        .modifier(NPToastError(error: $loader.error, toast: $loader.toast, hasPayload: loader.data != nil))
        .task {
            if !started {
                started = true
                await load(initial)
            }
        }
        .sheet(item: $editing) { t in
            if let p = loader.data {
                NAccEntryEditor(payload: p, entry: t.entry, onClose: { editing = nil }, onSaved: { msg in
                    editing = nil
                    loader.toast = msg
                    Task { await reload() }
                })
            }
        }
        .sheet(item: $voiding) { e in
            NAccReasonSheet(
                title: "仕訳を取消",
                message: "「\(e.description)」を取消します。取消履歴は保持され、必要に応じて修正仕訳を作成できます。",
                confirmLabel: "取消する",
                onCancel: { voiding = nil },
                onConfirm: { reason in
                    if await loader.act(["type": "accJournalVoid", "id": e.id, "reason": reason], done: "仕訳を取消しました") {
                        voiding = nil
                        await reload()
                    } else {
                        voiding = nil
                    }
                }
            )
        }
        .alert("仕訳を削除", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { e in
            Button("削除する", role: .destructive) {
                Task {
                    if await loader.act(["type": "accJournalDelete", "id": e.id], done: "仕訳を削除しました") { await reload() }
                }
            }
            Button("やめる", role: .cancel) {}
        } message: { e in
            Text("「\(e.description)」（下書き）を削除します。この操作は取り消せません。")
        }
    }

    // MARK: 絞り込み

    private func filters(_ p: NAccJournalPayload) -> some View {
        NAccFilterBar {
            NAccField(label: "開始日") { NAccDate(value: $from) }
            NAccField(label: "終了日") { NAccDate(value: $to) }
            NAccField(label: "状態") { NAccMenu(options: [NAccOption(value: "", label: "すべて")] + p.statusOptions, selection: $status) }
            NAccField(label: "区分") { NAccMenu(options: [NAccOption(value: "", label: "すべて")] + p.sourceTypeOptions, selection: $sourceType) }
            if p.isHq {
                NAccField(label: "店舗") {
                    NAccMenu(options: [NAccOption(value: "", label: "全店舗")] + p.stores.map { NAccOption(value: $0.id, label: $0.name) }, selection: $store)
                }
            }
            NAccButton(text: "絞り込む", icon: "line.3.horizontal.decrease", kind: .primary, busy: loader.loading) {
                Task { await load(filterQuery(page: 1)) }
            }
        }
    }

    private func sourceBanner(_ p: NAccJournalPayload) -> some View {
        let label = p.sourceTypeOptions.first { $0.value == p.filters.sourceType }?.label ?? "すべて"
        return HStack {
            Text("元取引で絞り込み中（区分: \(p.filters.sourceType.isEmpty ? "すべて" : label)）").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink)
            Spacer()
            Button("絞り込みを解除") {
                Task { await load(["from": p.filters.from, "to": p.filters.to, "status": p.filters.status, "store": p.filters.storeId]) }
            }
            .font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.purple)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }

    // MARK: 一覧

    private func list(_ p: NAccJournalPayload) -> some View {
        NAccCard {
            if p.entries.isEmpty {
                NAccEmptyView(title: "該当する仕訳がありません", message: "条件を変更するか、「仕訳を作成」から新しい仕訳を登録してください")
            } else {
                VStack(spacing: 0) {
                    ForEach(p.entries) { e in row(e, canWrite: p.canWrite) }
                }
            }
        }
    }

    /// 「現金」「現金 ほか2件」
    private func summary(_ lines: [NAccJournalLine], _ side: String) -> String {
        let s = lines.filter { $0.side == side }
        guard let first = s.first else { return "—" }
        return s.count > 1 ? "\(first.accountName) ほか\(s.count - 1)件" : first.accountName
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "posted": return NFColor.success
        case "voided": return NFColor.danger
        default: return NT.ink3
        }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    private func row(_ e: NAccJournalEntry, canWrite: Bool) -> some View {
        let open = expanded.contains(e.id)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Button { toggle(e.id) } label: {
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: open ? "chevron.down" : "chevron.right")
                            .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).frame(width: 16)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 8) {
                                Text("#\(e.entryNo)").font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundColor(NT.ink3)
                                Text(NAccText.date(e.entryDate)).font(.system(size: 12.5)).monospacedDigit().foregroundColor(NT.ink2)
                                Text(e.description).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            }
                            HStack(spacing: 8) {
                                Text("借方 \(summary(e.lines, "debit"))　貸方 \(summary(e.lines, "credit"))")
                                    .font(.system(size: 12.5)).foregroundColor(NT.ink2).lineLimit(1)
                                Text(e.storeName ?? "全社").font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                                NPBadge(text: e.sourceType == "manual" ? "手動" : "自動仕訳・\(e.sourceLabel)", color: e.sourceType == "manual" ? NT.ink3 : NT.purple)
                                NPBadge(text: e.statusLabel, color: statusColor(e.status))
                            }
                        }
                        Spacer(minLength: 8)
                        Text(NT.yen(e.debitTotal)).font(.system(size: 16, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if canWrite { actions(e) }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            if open { detail(e) }
            Rectangle().fill(NT.line).frame(height: 1)
        }
    }

    @ViewBuilder private func actions(_ e: NAccJournalEntry) -> some View {
        HStack(spacing: 6) {
            if e.status == "draft" {
                NAccSmallButton(text: "編集", tint: NT.ink2) { editing = NAccEditorTarget(id: e.id, entry: e) }
                NAccSmallButton(text: "確定", tint: NFColor.success, disabled: loader.busy) {
                    Task { if await loader.act(["type": "accJournalPost", "id": e.id], done: "仕訳を確定しました") { await reload() } }
                }
                NAccSmallButton(text: "削除", tint: NFColor.danger) { deleting = e }
            } else if e.status == "posted" {
                NAccSmallButton(text: "修正仕訳", tint: NT.purple, disabled: loader.busy) {
                    Task {
                        if await loader.act(["type": "accJournalCorrect", "id": e.id], done: "修正仕訳（下書き）を作成しました。一覧から編集・確定してください") { await reload() }
                    }
                }
                NAccSmallButton(text: "取消", tint: NFColor.danger) { voiding = e }
            }
        }
    }

    private func detail(_ e: NAccJournalEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if e.status == "voided", let r = e.voidReason, !r.isEmpty {
                Text("取消理由: \(r)").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NFColor.danger)
            }
            if e.lines.isEmpty {
                Text("明細がありません").font(.system(size: 12.5)).foregroundColor(NT.ink3)
            } else {
                VStack(spacing: 0) {
                    NAccTableHead(cells: [("勘定科目", nil, false), ("借方", 110, true), ("貸方", 110, true), ("税区分", 100, false), ("メモ", 180, false)])
                    ForEach(Array(e.lines.enumerated()), id: \.offset) { item in
                        let l = item.element
                        HStack(spacing: 10) {
                            NAccCell(text: "\(l.accountCode) \(l.accountName)", size: 13)
                            NAccCell(text: l.side == "debit" ? NT.yen(l.amount) : "", width: 110, trailing: true, size: 13)
                            NAccCell(text: l.side == "credit" ? NT.yen(l.amount) : "", width: 110, trailing: true, size: 13)
                            NAccCell(text: l.taxLabel, width: 100, color: NT.ink2, size: 12.5)
                            NAccCell(text: l.memo ?? "", width: 180, color: NT.ink3, size: 12.5)
                        }
                        .padding(.horizontal, 14).frame(minHeight: 32)
                        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            if let href = e.originHref {
                Button { nav.follow(href) } label: {
                    Label(e.originLabel ?? "元取引を見る", systemImage: "arrow.up.right.square").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 42).padding(.trailing, 14).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NT.page)
    }

    @ViewBuilder private func pager(_ p: NAccJournalPayload) -> some View {
        if p.totalPages > 1 {
            HStack(spacing: 10) {
                Text("\(p.count)件中 \(p.rangeFrom + 1)〜\(min(p.count, p.rangeFrom + p.pageSize))件").font(.system(size: 13)).foregroundColor(NT.ink2)
                Spacer()
                if p.filters.page > 1 {
                    NAccButton(text: "前へ", icon: "chevron.left") {
                        let q = applied.merging(["page": String(p.filters.page - 1)]) { _, new in new }
                        Task { await load(q) }
                    }
                }
                if p.filters.page < p.totalPages {
                    NAccButton(text: "次へ", icon: "chevron.right") {
                        let q = applied.merging(["page": String(p.filters.page + 1)]) { _, new in new }
                        Task { await load(q) }
                    }
                }
            }
        }
    }
}

// MARK: - 仕訳を作成・編集（下書き。借方合計＝貸方合計のときだけ保存できる）

struct NAccLineDraft: Identifiable, Hashable {
    var id = UUID()
    var accountId = ""
    var side = "debit"
    var amount = ""
    var tax = "out_of_scope"
    var memo = ""
}

struct NAccEntryEditor: View {
    let payload: NAccJournalPayload
    let entry: NAccJournalEntry?
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var date: Date
    @State private var desc: String
    @State private var storeId: String
    @State private var lines: [NAccLineDraft]
    @State private var saving = false
    @State private var problem: String?

    init(payload: NAccJournalPayload, entry: NAccJournalEntry?, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.payload = payload
        self.entry = entry
        self.onClose = onClose
        self.onSaved = onSaved
        _date = State(initialValue: NPDate.date(entry?.entryDate ?? payload.today))
        _desc = State(initialValue: entry?.description ?? "")
        _storeId = State(initialValue: entry?.storeId ?? "")
        let start: [NAccLineDraft]
        if let e = entry, !e.lines.isEmpty {
            start = e.lines.map { l in
                NAccLineDraft(accountId: l.accountId, side: l.side, amount: String(l.amount), tax: l.taxTreatment, memo: l.memo ?? "")
            }
        } else {
            start = [NAccLineDraft(side: "debit"), NAccLineDraft(side: "credit")]
        }
        _lines = State(initialValue: start)
    }

    private var withAccount: [NAccLineDraft] { lines.filter { !$0.accountId.isEmpty } }
    private var debit: Int { withAccount.filter { $0.side == "debit" }.reduce(0) { $0 + NAccText.amount($1.amount) } }
    private var credit: Int { withAccount.filter { $0.side == "credit" }.reduce(0) { $0 + NAccText.amount($1.amount) } }
    /// Web の validateJournalBalance と同じ（科目のある行は全部 1 円以上・借方＝貸方＞0）
    private var balanced: Bool { debit == credit && debit > 0 && withAccount.allSatisfy { NAccText.amount($0.amount) > 0 } }
    private var validCount: Int { lines.filter { !$0.accountId.isEmpty && NAccText.amount($0.amount) > 0 }.count }
    private var canSave: Bool { balanced && validCount >= 2 && !NAccText.trimmed(desc).isEmpty }

    private func binding(_ id: UUID) -> Binding<NAccLineDraft> {
        Binding(
            get: { lines.first { $0.id == id } ?? NAccLineDraft() },
            set: { v in if let i = lines.firstIndex(where: { $0.id == id }) { lines[i] = v } }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本") {
                    DatePicker("日付", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    Picker("店舗（任意）", selection: $storeId) {
                        Text("全社（店舗指定なし）").tag("")
                        ForEach(payload.stores) { s in Text(s.name).tag(s.id) }
                    }
                    TextField("摘要（例: 4月分家賃支払い）", text: $desc)
                }
                Section {
                    ForEach(lines) { l in lineRow(l.id) }
                    Button { lines.append(NAccLineDraft()) } label: { Label("行を追加", systemImage: "plus") }
                } header: {
                    Text("明細")
                }
                Section("合計") {
                    HStack { Text("借方合計"); Spacer(); Text(NT.yen(debit)).monospacedDigit() }
                    HStack { Text("貸方合計"); Spacer(); Text(NT.yen(credit)).monospacedDigit() }
                    HStack {
                        Text("差額").fontWeight(.bold)
                        Spacer()
                        Text(NT.yen(abs(debit - credit))).font(.system(size: 18, weight: NT.strong)).monospacedDigit()
                            .foregroundColor(balanced ? NFColor.success : NFColor.danger)
                    }
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
                    } else if !canSave {
                        Text("明細を2行以上入力し、借方合計と貸方合計を一致させると保存できます。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    }
                }
            }
            .navigationTitle(entry == nil ? "仕訳を作成（下書き）" : "仕訳を編集（下書き）")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "下書き保存") { Task { await save() } }.disabled(saving || !canSave)
                }
            }
        }
    }

    private func lineRow(_ id: UUID) -> some View {
        let b = binding(id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Picker("勘定科目", selection: Binding(get: { b.wrappedValue.accountId }, set: { newId in
                    var v = b.wrappedValue
                    v.accountId = newId
                    v.tax = payload.accounts.first { $0.id == newId }?.defaultTaxTreatment ?? "out_of_scope"
                    b.wrappedValue = v
                })) {
                    Text("選択してください").tag("")
                    ForEach(payload.accounts) { a in Text("\(a.code) \(a.name)").tag(a.id) }
                }
                Button(role: .destructive) {
                    lines.removeAll { $0.id == id }
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .disabled(lines.count <= 2)
            }
            HStack(spacing: 10) {
                Picker("借方/貸方", selection: b.side) {
                    Text("借方").tag("debit")
                    Text("貸方").tag("credit")
                }
                .pickerStyle(.segmented)
                .frame(width: 150)
                TextField("金額", text: b.amount).keyboardType(.numberPad).frame(width: 120)
                    .textFieldStyle(.roundedBorder)
                Picker("税区分", selection: b.tax) {
                    ForEach(payload.taxOptions) { o in Text(o.label).tag(o.value) }
                }
                .labelsHidden()
                TextField("メモ", text: b.memo).textFieldStyle(.roundedBorder)
            }
        }
        .padding(.vertical, 4)
    }

    private func save() async {
        problem = nil
        if NAccText.trimmed(desc).isEmpty { problem = "摘要を入力してください"; return }
        guard canSave else { problem = "借方合計と貸方合計を一致させてください（差額0で保存できます）"; return }
        saving = true
        defer { saving = false }
        let body: [String: Any] = [
            "type": "accJournalSave",
            "id": entry?.id ?? "",
            "entryDate": NPDate.str(date),
            "description": NAccText.trimmed(desc),
            "storeId": storeId,
            "lines": lines
                .filter { !$0.accountId.isEmpty && NAccText.amount($0.amount) > 0 }
                .map { l -> [String: Any] in
                    ["accountId": l.accountId, "side": l.side, "amount": NAccText.amount(l.amount), "taxTreatment": l.tax, "memo": NAccText.trimmed(l.memo)]
                },
        ]
        do {
            try await NativeModuleAPI.post(body)
            onSaved(entry == nil ? "仕訳を下書き保存しました" : "仕訳（下書き）を更新しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 月次締め（直近12ヶ月の状況・締める・締め解除・履歴）

struct NAccPeriodRow: Decodable, Identifiable, Hashable {
    let month: String
    let label: String
    let status: String
    let statusLabel: String
    let draftCount: Int
    let closedAtLabel: String?
    let closedByName: String?
    let reopenedAtLabel: String?
    let reopenedByName: String?
    var id: String { month }
}

struct NAccPeriodHistory: Decodable, Identifiable, Hashable {
    let id: String
    let isClose: Bool
    let label: String
    let createdAtLabel: String
    let actorName: String?
    let reason: String?
}

struct NAccPeriodsPayload: Decodable {
    let canReopen: Bool
    let month: String
    let monthLabel: String
    let status: String
    let statusLabel: String
    let draftCount: Int
    let justReopened: Bool
    let draftFilter: NAccRange
    let overview: [NAccPeriodRow]
    let history: [NAccPeriodHistory]
}

struct NAccPeriodPanel: View {
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccPeriodsPayload>()
    @State private var month = ""
    @State private var reopening = false
    @State private var started = false

    private func load(_ m: String?) async {
        var q = ["view": "periods"]
        if let m, !m.isEmpty { q["month"] = m }
        await loader.load(q)
        if let p = loader.data { month = p.month }
    }

    var body: some View {
        NAccCard(title: "月次締め") {
            VStack(alignment: .leading, spacing: 14) {
                NAccNotice(
                    text: "締め前の月は仕訳の作成・修正・確定ができます。締め後は通常ユーザーによる計上・修正ができなくなり、修正するには org_owner / hq_admin による締め解除（理由必須・操作履歴に記録）が必要です。",
                    color: NT.ink2,
                    icon: "info.circle"
                )
                if let e = loader.error {
                    Button { loader.error = nil } label: {
                        HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e).multilineTextAlignment(.leading); Spacer(); Image(systemName: "xmark") }
                            .font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.danger)
                            .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft))
                    }
                    .buttonStyle(.plain)
                }
                if let t = loader.toast {
                    Text(t).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.success)
                        .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if loader.toast == t { loader.toast = nil } }
                }
                if let p = loader.data {
                    overview(p)
                    selected(p)
                    history(p)
                } else if loader.error == nil {
                    ProgressView("読み込み中…")
                } else {
                    Button("もう一度") { Task { await load(month) } }
                }
            }
            .padding(16)
        }
        .task {
            if !started {
                started = true
                await load(nil)
            }
        }
        .sheet(isPresented: $reopening) {
            NAccReasonSheet(
                title: "締め解除",
                message: "\(NAccText.monthLabel(month))の締めを解除します。解除の理由は操作履歴に記録されます。解除後は仕訳を修正したうえで、再度締め処理を行ってください。",
                confirmLabel: "締め解除する",
                onCancel: { reopening = false },
                onConfirm: { reason in
                    let m = month
                    await loader.act(["type": "accPeriodReopen", "month": m, "reason": reason], done: "\(m)の締めを解除しました")
                    reopening = false
                    await load(m)
                }
            )
        }
    }

    private func overview(_ p: NAccPeriodsPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("直近12ヶ月の状況").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            VStack(spacing: 0) {
                NAccTableHead(cells: [("月", 110, false), ("状態", 90, false), ("締め日時 / 実行者", nil, false), ("解除日時 / 実行者", nil, false), ("下書き", 60, true), ("", 70, false)])
                ForEach(p.overview) { r in
                    HStack(spacing: 10) {
                        NAccCell(text: r.label, width: 110, bold: true)
                        NPBadge(text: r.statusLabel, color: r.status == "closed" ? NFColor.success : NT.ink3).frame(width: 90, alignment: .leading)
                        NAccCell(text: actor(r.closedAtLabel, r.closedByName), color: NT.ink2, size: 12.5)
                        NAccCell(text: actor(r.reopenedAtLabel, r.reopenedByName), color: NT.ink2, size: 12.5)
                        NAccCell(text: r.draftCount > 0 ? "\(r.draftCount)" : "—", width: 60, trailing: true)
                        NAccSmallButton(text: "選択", tint: r.month == p.month ? NT.purple : NT.ink2) { Task { await load(r.month) } }
                            .frame(width: 70, alignment: .leading)
                    }
                    .padding(.horizontal, 14).frame(minHeight: 40)
                    .background(r.month == p.month ? NT.lilac.opacity(0.6) : Color.clear)
                    .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func actor(_ at: String?, _ name: String?) -> String {
        guard let at else { return "—" }
        if let name, !name.isEmpty { return "\(at)（\(name)）" }
        return at
    }

    private func selected(_ p: NAccPeriodsPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text("対象月").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                Button { Task { await load(NAccText.shiftMonth(p.month, -1)) } } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(.bordered)
                Text(p.monthLabel).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).frame(minWidth: 100)
                Button { Task { await load(NAccText.shiftMonth(p.month, 1)) } } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.bordered)
                NPBadge(text: p.statusLabel, color: p.status == "closed" ? NFColor.success : NT.ink3)
                Spacer()
                Button { Task { await load(p.month) } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.bordered)
                    .disabled(loader.busy || loader.loading)
                    .accessibilityLabel("読み直す")
            }
            if p.justReopened {
                HStack(spacing: 10) {
                    Text("この月は締め解除されています。仕訳を修正したうえで、再度この月を締めてください。").font(.system(size: 13)).foregroundColor(NT.warn)
                    Spacer()
                    NAccSmallButton(text: "下書き仕訳を確認する", tint: NT.warn) { openDrafts(p) }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.warn.opacity(0.09)))
            }
            if p.status != "closed" {
                if p.draftCount > 0 {
                    HStack(spacing: 10) {
                        Text("下書き仕訳が\(p.draftCount)件残っています（締めるには確定が必要です）").font(.system(size: 12.5)).foregroundColor(NT.warn)
                        NAccSmallButton(text: "下書き一覧を見る", tint: NT.warn) { openDrafts(p) }
                    }
                }
                NAccButton(text: loader.busy ? "処理中…" : "この月を締める", icon: "lock", kind: .primary, busy: loader.busy, disabled: p.draftCount > 0) {
                    let m = p.month
                    Task {
                        await loader.act(["type": "accPeriodClose", "month": m], done: "\(m)を締めました")
                        await load(m)
                    }
                }
            } else {
                Text("締め済みの月です。修正には締め解除が必要です。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                if p.canReopen {
                    NAccButton(text: "締め解除", icon: "lock.open") { reopening = true }
                } else {
                    Text("締め解除は org_owner / hq_admin のみ実行できます。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                }
            }
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func openDrafts(_ p: NAccPeriodsPayload) {
        nav.open(.journal, ["from": p.draftFilter.from, "to": p.draftFilter.to, "status": "draft"])
    }

    private func history(_ p: NAccPeriodsPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("\(p.monthLabel)の締め・解除履歴", systemImage: "clock.arrow.circlepath").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            if p.history.isEmpty {
                Text("履歴はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                ForEach(p.history) { h in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            NPBadge(text: h.label, color: h.isClose ? NFColor.success : NT.warn)
                            Text(h.createdAtLabel).font(.system(size: 12)).foregroundColor(NT.ink3)
                            if let a = h.actorName { Text(a).font(.system(size: 12)).foregroundColor(NT.ink3) }
                        }
                        if let r = h.reason, !r.isEmpty { Text("理由: \(r)").font(.system(size: 12.5)).foregroundColor(NT.ink2) }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
        }
    }
}
