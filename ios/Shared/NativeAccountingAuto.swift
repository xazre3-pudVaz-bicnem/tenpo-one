import SwiftUI

// 会計 › 自動仕訳（Web の /app/accounting/auto・components/accounting/auto-source-card.tsx・auto-mapping-section.tsx）・
// 固定資産（/app/accounting/assets・components/accounting/fixed-assets-panel.tsx）。
//   自動仕訳：標準科目の導入・期間（売上・返金だけ）・区分ごとに「候補を生成」→選ぶ→下書き作成／作成して確定・費目→勘定科目
//   固定資産：登録・編集・除却/売却・使用中に戻す・削除（減価償却の自動計算は Web と同じく未対応）

// MARK: - 自動仕訳のデータ（GET view=auto ／ view=autoCandidates）

struct NAccSource: Decodable, Identifiable, Hashable {
    let sourceType: String
    let title: String
    let hint: String
    let negative: Bool
    let pendingCount: Int
    let pendingTotal: Int
    var id: String { sourceType }
}

struct NAccMappingRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let accountId: String?
}

struct NAccAutoPayload: Decodable {
    let filters: NAccRange
    let accountsInstalled: Bool
    let sources: [NAccSource]
    let totalsNote: String
    let mappingRows: [NAccMappingRow]
    let mappingAccountOptions: [NAccAccountRef]
}

struct NAccCandidateLine: Decodable, Identifiable, Hashable {
    let id: Int
    let side: String
    let accountName: String
    let amount: Int
}

struct NAccCandidate: Decodable, Identifiable, Hashable {
    let key: String
    let sourceId: String
    let date: String
    let description: String
    let storeName: String?
    let lines: [NAccCandidateLine]
    let debit: Int
    let balanced: Bool
    let alreadyPosted: Bool
    let warning: String?
    var id: String { key }
}

struct NAccCandidatesPayload: Decodable {
    let candidates: [NAccCandidate]
}

// MARK: - 自動仕訳

struct NAccAutoPage: View {
    let initial: [String: String]
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccAutoPayload>()
    @State private var applied: [String: String] = [:]
    @State private var from = ""
    @State private var to = ""
    @State private var mapping: [String: String] = [:]
    @State private var savingMapping: String?
    @State private var cardsToken = UUID()
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "auto"
        await loader.load(full)
        if let p = loader.data {
            from = p.filters.from
            to = p.filters.to
            mapping = Dictionary(p.mappingRows.map { ($0.id, $0.accountId ?? "") }, uniquingKeysWith: { a, _ in a })
        }
    }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NAccHeader(title: "自動仕訳", subtitle: "売上・仕入・経費・小口現金・給与から仕訳候補を自動生成し、確認してから確定します。再入力ゼロが目標です。") { EmptyView() }
                        if !p.accountsInstalled {
                            NAccInstallBanner(busy: loader.busy) {
                                Task { if await loader.act(["type": "accInstallAccounts"], done: "標準の勘定科目を導入しました") { await load(applied) } }
                            }
                        }
                        NAccFilterBar {
                            NAccField(label: "開始日") { NAccDate(value: $from) }
                            NAccField(label: "終了日") { NAccDate(value: $to) }
                            NAccButton(text: "期間を変更（売上・返金のみ対象）", busy: loader.loading) {
                                let q = ["from": from, "to": to]
                                Task {
                                    await load(q)
                                    cardsToken = UUID()
                                }
                            }
                            Text("仕入・経費・小口現金・給与は状態（承認済み・未仕訳）のみで対象を判定します")
                                .font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: 360, alignment: .leading)
                        }
                        NAccNotice(text: "返金の仕訳は「返金が発生した営業日」で計上します（元の売上の日ではありません）。そのため、元売上の月が月次締め済みでも、返金日が未締めの当月であれば当月の仕訳として作成され、締め済み月の帳簿を書き換えることはありません。")
                        VStack(spacing: 14) {
                            ForEach(p.sources) { s in
                                NAccAutoSourceCard(source: s, range: p.filters, loader: loader) { Task { await load(applied) } }
                            }
                        }
                        .id(cardsToken)
                        mappingCard(p)
                        Text(p.totalsNote).font(.system(size: 12)).foregroundColor(NT.ink3)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    }
                    .padding(16).padding(.bottom, 24)
                }
            } else {
                NAccLoading(error: loader.error) { Task { await load(applied) } }
            }
        }
        .modifier(NPToastError(error: $loader.error, toast: $loader.toast, hasPayload: loader.data != nil))
        .task {
            if !started {
                started = true
                await load(initial)
            }
        }
    }

    // MARK: 費目 → 勘定科目

    private func mappingCard(_ p: NAccAutoPayload) -> some View {
        NAccCard(
            title: "費目 → 勘定科目マッピング",
            note: p.mappingRows.isEmpty ? nil : "未マッピングの費目は自動仕訳の際に雑費（599）で仮計上され、候補プレビューに警告が表示されます。"
        ) {
            if p.mappingRows.isEmpty {
                Text("費目（expense_accounts）が登録されていません。経費ページで費目を登録してからマッピングしてください。")
                    .font(.system(size: 13)).foregroundColor(NT.ink3).padding(16)
            } else {
                VStack(spacing: 0) {
                    NAccTableHead(cells: [("費目", nil, false), ("対応する勘定科目", 280, false), ("状態", 90, false)])
                    ForEach(p.mappingRows) { r in
                        let value = mapping[r.id] ?? ""
                        HStack(spacing: 10) {
                            NAccCell(text: r.name, bold: true)
                            Picker("", selection: Binding(get: { mapping[r.id] ?? "" }, set: { v in save(r.id, v) })) {
                                Text("未設定（雑費で計上）").tag("")
                                ForEach(p.mappingAccountOptions) { a in Text("\(a.code) \(a.name)").tag(a.id) }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                            .tint(NT.ink)
                            .disabled(savingMapping == r.id)
                            .frame(width: 280, alignment: .leading)
                            NPBadge(text: value.isEmpty ? "未設定" : "設定済み", color: value.isEmpty ? NT.warn : NFColor.success)
                                .frame(width: 90, alignment: .leading)
                        }
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                    }
                }
            }
        }
    }

    private func save(_ expenseAccountId: String, _ accountId: String) {
        mapping[expenseAccountId] = accountId
        savingMapping = expenseAccountId
        Task {
            await loader.act(["type": "accExpenseMapping", "expenseAccountId": expenseAccountId, "accountId": accountId], done: "保存しました")
            savingMapping = nil
        }
    }
}

/// 区分ごとのカード（候補を生成 → 選ぶ → 下書き作成／作成して確定）
struct NAccAutoSourceCard: View {
    let source: NAccSource
    let range: NAccRange
    @ObservedObject var loader: NAccLoader<NAccAutoPayload>
    let onCreated: () -> Void

    @State private var expanded = false
    @State private var candidates: [NAccCandidate]?
    @State private var selected: Set<String> = []
    @State private var generating = false
    @State private var creating = false

    private var creatable: [NAccCandidate] { (candidates ?? []).filter { !$0.alreadyPosted && $0.balanced } }

    private func generate() async {
        expanded = true
        generating = true
        defer { generating = false }
        do {
            let r = try await NAccAPI.get(["view": "autoCandidates", "source": source.sourceType, "from": range.from, "to": range.to], as: NAccCandidatesPayload.self)
            candidates = r.candidates
            selected = Set(r.candidates.filter { !$0.alreadyPosted && $0.balanced }.map(\.sourceId))
        } catch {
            loader.error = NativeModuleAPI.message(error)
        }
    }

    private func create(post: Bool) async {
        let keys = selected.sorted()
        guard !keys.isEmpty else { loader.error = "作成する仕訳を選択してください"; return }
        creating = true
        defer { creating = false }
        do {
            let r = try await NAccAPI.post(["type": "accAutoCreate", "source": source.sourceType, "keys": keys, "post": post], as: NAccCreateResponse.self)
            if r.result.failed.isEmpty { loader.toast = r.result.message } else { loader.error = r.result.message }
            await generate()
            onCreated()
        } catch {
            loader.error = NativeModuleAPI.message(error)
        }
    }

    var body: some View {
        NAccCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(source.title).font(.system(size: 16.5, weight: .heavy)).foregroundColor(NT.ink)
                            if source.negative { NPBadge(text: "マイナス計上", color: NT.warn) }
                        }
                        Text(source.hint).font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("対象").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                        Text("\(source.pendingCount)件 ・ \(NT.yen(source.pendingTotal))").font(.system(size: 14, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                    }
                    NAccButton(text: "候補を生成", icon: "arrow.triangle.2.circlepath", busy: generating) { Task { await generate() } }
                    Button { expanded.toggle() } label: {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2).frame(width: 34, height: 34)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(expanded ? "閉じる" : "開く")
                }
                .padding(16)
                if expanded {
                    Rectangle().fill(NT.line).frame(height: 1)
                    content.padding(16)
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if generating && candidates == nil {
            HStack { Spacer(); ProgressView("候補を集計しています…"); Spacer() }.padding(.vertical, 20)
        } else if let list = candidates {
            if list.isEmpty {
                NAccEmptyView(title: "対象データはありません", message: "この区分で仕訳が必要な未処理データはありませんでした。")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(spacing: 0) {
                        HStack(spacing: 10) {
                            Button {
                                if !creatable.isEmpty && selected.count == creatable.count { selected = [] } else { selected = Set(creatable.map(\.sourceId)) }
                            } label: {
                                Image(systemName: !creatable.isEmpty && selected.count == creatable.count ? "checkmark.square.fill" : "square").font(.system(size: 17)).foregroundColor(NT.purple)
                            }
                            .buttonStyle(.plain)
                            .frame(width: 28)
                            NAccCell(text: "日付", width: 92, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "摘要", bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "店舗", width: 110, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "仕訳明細", width: 230, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "金額", width: 100, trailing: true, bold: true, color: NT.ink3, size: 12)
                            NAccCell(text: "状態", width: 120, bold: true, color: NT.ink3, size: 12)
                        }
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(NT.page.opacity(0.7))
                        ForEach(list) { c in candidateRow(c) }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    NAccNotice(text: "自動仕訳はプレビューで確認してから確定してください。確定後の修正は修正仕訳で行います。", color: NT.purple, icon: "info.circle")
                    HStack(spacing: 10) {
                        Text("\(selected.count)件を選択中").font(.system(size: 13.5)).foregroundColor(NT.ink2)
                        Spacer()
                        NAccButton(text: "下書き作成", busy: creating, disabled: selected.isEmpty) { Task { await create(post: false) } }
                        NAccButton(text: "作成して確定", kind: .primary, busy: creating, disabled: selected.isEmpty) { Task { await create(post: true) } }
                    }
                }
            }
        } else {
            Text("「候補を生成」を押すと、選択中の期間・対象データから仕訳候補を計算します。").font(.system(size: 13)).foregroundColor(NT.ink3)
        }
    }

    private func candidateRow(_ c: NAccCandidate) -> some View {
        let enabled = !c.alreadyPosted && c.balanced
        return HStack(alignment: .top, spacing: 10) {
            Button {
                if selected.contains(c.sourceId) { selected.remove(c.sourceId) } else { selected.insert(c.sourceId) }
            } label: {
                Image(systemName: selected.contains(c.sourceId) ? "checkmark.square.fill" : "square").font(.system(size: 17)).foregroundColor(enabled ? NT.purple : NT.ink3)
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .frame(width: 28)
            NAccCell(text: c.date == "—" ? "—" : NAccText.date(c.date), width: 92, color: NT.ink2, size: 12.5)
            NAccCell(text: c.description)
            NAccCell(text: c.storeName ?? "全社", width: 110, color: NT.ink2, size: 12.5)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(c.lines) { l in
                    HStack(spacing: 4) {
                        Text("\(l.side == "debit" ? "借方" : "貸方") \(l.accountName)").foregroundColor(l.side == "debit" ? NT.purpleDeep : NT.ink2).lineLimit(1)
                        Text(NT.yen(l.amount)).fontWeight(.semibold).monospacedDigit().foregroundColor(NT.ink)
                    }
                    .font(.system(size: 11.5))
                }
            }
            .frame(width: 230, alignment: .leading)
            NAccCell(text: NT.yen(c.debit), width: 100, trailing: true, bold: true)
            VStack(alignment: .leading, spacing: 3) {
                if c.alreadyPosted { NPBadge(text: "作成済み", color: NT.ink3) }
                if !c.balanced { NPBadge(text: "貸借不一致", color: NFColor.danger) }
                if let w = c.warning { Text(w).font(.system(size: 11)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true) }
            }
            .frame(width: 120, alignment: .leading)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

// MARK: - 固定資産のデータ（GET view=assets）

struct NAccAsset: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let acquiredOn: String
    let acquisitionCost: Int
    let usefulLifeYears: Int?
    let depreciationMethod: String
    let methodLabel: String
    let storeId: String?
    let storeName: String?
    let status: String
    let statusLabel: String
    let disposedOn: String?
    let note: String?
}

struct NAccAssetsPayload: Decodable {
    let stores: [NAccStore]
    let today: String
    let methods: [NAccOption]
    let rows: [NAccAsset]
}

struct NAccAssetTarget: Identifiable {
    let id: String
    let asset: NAccAsset?
}

// MARK: - 固定資産

struct NAccAssetsPage: View {
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccAssetsPayload>()
    @State private var editing: NAccAssetTarget?
    @State private var disposing: NAccAsset?
    @State private var deleting: NAccAsset?
    @State private var started = false

    private func load() async { await loader.load(["view": "assets"]) }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NAccHeader(title: "固定資産", subtitle: "取得した資産の台帳を管理します（減価償却の自動計算は未対応）") {
                            NAccButton(text: "固定資産を登録", icon: "plus", kind: .primary) { editing = NAccAssetTarget(id: "new", asset: nil) }
                        }
                        NAccCard {
                            if p.rows.isEmpty {
                                NAccEmptyView(title: "固定資産が登録されていません", message: "「固定資産を登録」から取得した資産を登録してください")
                            } else {
                                VStack(spacing: 0) {
                                    NAccTableHead(cells: [
                                        ("名称", nil, false), ("取得日", 92, false), ("取得価額", 110, true), ("耐用年数", 70, false),
                                        ("償却方法", 90, false), ("店舗", 110, false), ("状態", 130, false), ("操作", 210, false),
                                    ])
                                    ForEach(p.rows) { r in row(r) }
                                }
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
        .sheet(item: $editing) { t in
            if let p = loader.data {
                NAccAssetEditor(payload: p, asset: t.asset, onClose: { editing = nil }, onSaved: { msg in
                    editing = nil
                    loader.toast = msg
                    Task { await load() }
                })
            }
        }
        .sheet(item: $disposing) { a in
            NAccDisposeSheet(asset: a, today: loader.data?.today ?? NPDate.str(Date()), onClose: { disposing = nil }, onSaved: { msg in
                disposing = nil
                loader.toast = msg
                Task { await load() }
            })
        }
        .alert("固定資産を削除", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { a in
            Button("削除する", role: .destructive) {
                Task { if await loader.act(["type": "accAssetDelete", "id": a.id], done: "固定資産を削除しました") { await load() } }
            }
            Button("やめる", role: .cancel) {}
        } message: { a in
            Text("「\(a.name)」を削除します。")
        }
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "in_use": return NFColor.success
        case "sold": return NT.purple
        case "deleted": return NFColor.danger
        default: return NT.ink3
        }
    }

    private func row(_ r: NAccAsset) -> some View {
        HStack(spacing: 10) {
            NAccCell(text: r.name, bold: true)
            NAccCell(text: NAccText.date(r.acquiredOn), width: 92, color: NT.ink2, size: 12.5)
            NAccCell(text: NT.yen(r.acquisitionCost), width: 110, trailing: true)
            NAccCell(text: r.usefulLifeYears.map { "\($0)年" } ?? "—", width: 70)
            NAccCell(text: r.methodLabel, width: 90, color: NT.ink2, size: 13)
            NAccCell(text: r.storeName ?? "全社", width: 110, color: NT.ink2, size: 13)
            HStack(spacing: 4) {
                NPBadge(text: r.statusLabel, color: statusColor(r.status))
                if let d = r.disposedOn { Text(NAccText.date(d)).font(.system(size: 11)).foregroundColor(NT.ink3) }
            }
            .frame(width: 130, alignment: .leading)
            HStack(spacing: 6) {
                NAccSmallButton(text: "編集", tint: NT.ink2) { editing = NAccAssetTarget(id: r.id, asset: r) }
                if r.status == "in_use" {
                    NAccSmallButton(text: "除却・売却", tint: NT.warn) { disposing = r }
                } else if r.status != "deleted" {
                    NAccSmallButton(text: "使用中に戻す", tint: NFColor.success, disabled: loader.busy) {
                        Task {
                            if await loader.act(["type": "accAssetStatus", "id": r.id, "status": "in_use", "disposedOn": ""], done: "使用中に戻しました") { await load() }
                        }
                    }
                }
                NAccSmallButton(text: "削除", tint: NFColor.danger) { deleting = r }
            }
            .frame(width: 210, alignment: .leading)
        }
        .padding(.horizontal, 14).frame(minHeight: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

/// 固定資産の登録・編集（Web の FixedAssetsPanel のダイアログ）
struct NAccAssetEditor: View {
    let payload: NAccAssetsPayload
    let asset: NAccAsset?
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var name: String
    @State private var acquiredOn: Date
    @State private var cost: String
    @State private var life: String
    @State private var method: String
    @State private var storeId: String
    @State private var note: String
    @State private var saving = false
    @State private var problem: String?

    init(payload: NAccAssetsPayload, asset: NAccAsset?, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.payload = payload
        self.asset = asset
        self.onClose = onClose
        self.onSaved = onSaved
        _name = State(initialValue: asset?.name ?? "")
        _acquiredOn = State(initialValue: NPDate.date(asset?.acquiredOn ?? payload.today))
        _cost = State(initialValue: String(asset?.acquisitionCost ?? 0))
        _life = State(initialValue: asset?.usefulLifeYears.map { String($0) } ?? "")
        _method = State(initialValue: asset?.depreciationMethod ?? "straight_line")
        _storeId = State(initialValue: asset?.storeId ?? "")
        _note = State(initialValue: asset?.note ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("名称（例：厨房機器一式）", text: $name)
                    DatePicker("取得日", selection: $acquiredOn, displayedComponents: .date).environment(\.locale, Locale(identifier: "ja_JP"))
                    HStack {
                        Text("取得価額")
                        Spacer()
                        TextField("0", text: $cost).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 160)
                    }
                    HStack {
                        Text("耐用年数（任意）")
                        Spacer()
                        TextField("例：8", text: $life).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 120)
                    }
                    Picker("償却方法", selection: $method) {
                        ForEach(payload.methods) { m in Text(m.label).tag(m.value) }
                    }
                    Picker("店舗（任意）", selection: $storeId) {
                        Text("全社（店舗指定なし）").tag("")
                        ForEach(payload.stores) { s in Text(s.name).tag(s.id) }
                    }
                }
                Section("メモ") {
                    TextField("メモ", text: $note, axis: .vertical).lineLimit(2...5)
                }
                Section {
                    Text("減価償却の自動計算は償却ルールの専門家確認後に対応予定です（ルールversion方式で設計済み）。現時点では台帳としての登録・管理のみ行えます。")
                        .font(.system(size: 12)).foregroundColor(NT.ink3)
                    if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
            }
            .navigationTitle(asset == nil ? "固定資産を登録" : "固定資産を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "保存する") { Task { await save() } }.disabled(saving)
                }
            }
        }
    }

    private func save() async {
        problem = nil
        guard !NAccText.trimmed(name).isEmpty else { problem = "名称を入力してください"; return }
        saving = true
        defer { saving = false }
        var body: [String: Any] = [
            "type": "accAssetSave",
            "id": asset?.id ?? "",
            "name": NAccText.trimmed(name),
            "acquiredOn": NPDate.str(acquiredOn),
            "depreciationMethod": method,
            "storeId": storeId,
            "note": note,
        ]
        // 取得価額：空なら 0（Web の number 入力と同じ）、読めなければサーバーが「取得価額を正しく入力してください」
        let costText = NAccText.trimmed(cost)
        if costText.isEmpty {
            body["acquisitionCost"] = 0
        } else if let n = Int(costText) {
            body["acquisitionCost"] = n
        } else if let d = Double(costText) {
            body["acquisitionCost"] = d
        } else {
            body["acquisitionCost"] = NSNull()
        }
        if let years = Int(NAccText.trimmed(life)) {
            body["usefulLifeYears"] = years
        } else {
            body["usefulLifeYears"] = NSNull()
        }
        do {
            try await NativeModuleAPI.post(body)
            onSaved(asset == nil ? "固定資産を登録しました" : "固定資産を更新しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

/// 除却・売却の登録
struct NAccDisposeSheet: View {
    let asset: NAccAsset
    let today: String
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var status = "disposed"
    @State private var date: Date
    @State private var saving = false
    @State private var problem: String?

    init(asset: NAccAsset, today: String, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.asset = asset
        self.today = today
        self.onClose = onClose
        self.onSaved = onSaved
        _date = State(initialValue: NPDate.date(today))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("「\(asset.name)」の状態を変更します。").font(.system(size: 14)).foregroundColor(NT.ink2)
                    Picker("区分", selection: $status) {
                        Text("除却").tag("disposed")
                        Text("売却").tag("sold")
                    }
                    .pickerStyle(.segmented)
                    DatePicker(status == "sold" ? "売却日" : "除却日", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
            }
            .navigationTitle("除却・売却の登録")
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
        saving = true
        defer { saving = false }
        let sold = status == "sold"
        do {
            try await NativeModuleAPI.post(["type": "accAssetStatus", "id": asset.id, "status": status, "disposedOn": NPDate.str(date)])
            onSaved(sold ? "売却を登録しました" : "除却を登録しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}
