import SwiftUI

// iPhone の店長・オーナー：会計 › 自動仕訳（Web の /app/accounting/auto・auto-source-card・auto-mapping-section）・
// 固定資産（/app/accounting/assets・fixed-assets-panel）。
//   自動仕訳：標準科目の導入・期間（売上・返金だけ）・区分ごとに「候補を生成」→選ぶ→下書き作成／作成して確定（確認）・費目→勘定科目
//   固定資産：登録・編集・除却/売却・使用中に戻す（確認）・削除（確認）。減価償却の自動計算は Web と同じく未対応
// サーバーは iPad と同じ GET part=accounting&view=auto|autoCandidates|assets ／ POST accAutoCreate・accExpenseMapping・accAsset*。

// MARK: - 自動仕訳の中身（GET view=auto ／ view=autoCandidates）

struct NPACSource: Decodable, Identifiable, Hashable {
    let sourceType: String
    let title: String
    let hint: String
    let negative: Bool
    let pendingCount: Int
    let pendingTotal: Int
    var id: String { sourceType }
}

struct NPACMappingRow: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let accountId: String?
}

struct NPACAutoPayload: Decodable {
    let filters: NPACRange
    let accountsInstalled: Bool
    let sources: [NPACSource]
    let totalsNote: String
    let mappingRows: [NPACMappingRow]
    let mappingAccountOptions: [NPACAccountRef]
}

struct NPACCandidateLine: Decodable, Identifiable, Hashable {
    let id: Int
    let side: String
    let accountName: String
    let amount: Int
}

struct NPACCandidate: Decodable, Identifiable, Hashable {
    let key: String
    let sourceId: String
    let date: String
    let description: String
    let storeName: String?
    let lines: [NPACCandidateLine]
    let debit: Int
    let balanced: Bool
    let alreadyPosted: Bool
    let warning: String?
    var id: String { key }
}

struct NPACCandidatesPayload: Decodable {
    let candidates: [NPACCandidate]
}

// MARK: - 自動仕訳

struct NPACAutoPage: View {
    let initial: [String: String]
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACAutoPayload>()
    @State private var applied: [String: String] = [:]
    @State private var mapping: [String: String] = [:]
    @State private var savingMapping: String?
    @State private var mappingPick: NPACTxRef?
    @State private var cardsToken = UUID()
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "auto"
        await loader.load(full)
        if let p = loader.data {
            mapping = Dictionary(p.mappingRows.map { ($0.id, $0.accountId ?? "") }, uniquingKeysWith: { a, _ in a })
        }
    }

    var body: some View {
        NPACFrame(nav: nav, trailing: { EmptyView() }) {
            NPACPageShell(error: $loader.error, toast: $loader.toast, hasData: loader.data != nil, useWeb: loader.useWeb, onWeb: nav.web, retry: { Task { await load(applied) } }) {
                if let p = loader.data { content(p) }
            }
        }
        .task {
            if !started {
                started = true
                await load(initial)
            }
        }
        .sheet(item: $mappingPick) { ref in
            if let p = loader.data, let row = p.mappingRows.first(where: { $0.id == ref.id }) {
                NPACPickSheet(title: "「\(row.name)」の勘定科目",
                              items: p.mappingAccountOptions.map { NPACPickItem(id: $0.id, name: "\($0.code) \($0.name)", sub: "") },
                              selected: mapping[row.id] ?? "",
                              noneLabel: "未設定（雑費で計上）",
                              onPick: { id in
                                  mappingPick = nil
                                  save(row.id, id)
                              },
                              onClose: { mappingPick = nil })
            }
        }
    }

    private func content(_ p: NPACAutoPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("売上・仕入・経費・小口現金・給与から仕訳候補を自動生成し、確かめてから確定します。")
                    .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
                if !p.accountsInstalled {
                    NPACInstallBanner(busy: loader.busy) {
                        Task { if await loader.act(["type": "accInstallAccounts"], done: "標準の勘定科目を導入しました") { await load(applied) } }
                    }
                }
                NPACPeriodBar(from: p.filters.from, to: p.filters.to) { a, b in
                    Task {
                        await load(["from": a, "to": b])
                        cardsToken = UUID()
                    }
                }
                Text("期間は売上・返金だけに効きます。仕入・経費・小口現金・給与は状態（承認済み・未仕訳）で対象を決めます。")
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
                NOMNote(text: "返金の仕訳は「返金が発生した営業日」で計上します（元の売上の日ではありません）。元売上の月が締め済みでも、返金日が未締めの月なら、その月の仕訳になります。", tint: NT.warn)
                VStack(spacing: 10) {
                    ForEach(p.sources) { s in
                        NPACAutoSourceCard(source: s, range: p.filters, loader: loader) { Task { await load(applied) } }
                    }
                }
                .id(cardsToken)
                mappingCard(p)
                Text(p.totalsNote).font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(npocCard(12))
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await load(applied) }
    }

    // MARK: 費目 → 勘定科目

    private func mappingCard(_ p: NPACAutoPayload) -> some View {
        NPOCard(title: "費目 → 勘定科目") {
            if p.mappingRows.isEmpty {
                Text("費目（expense_accounts）が登録されていません。経費ページで費目を登録してからマッピングしてください。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("未マッピングの費目は自動仕訳の際に雑費（599）で仮計上され、候補に警告が出ます。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(p.mappingRows) { r in
                    let value = mapping[r.id] ?? ""
                    let account = p.mappingAccountOptions.first { $0.id == value }
                    Button { mappingPick = NPACTxRef(id: r.id) } label: {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                                Text(account.map { "\($0.code) \($0.name)" } ?? "未設定（雑費で計上）").font(.system(size: 12.5)).foregroundColor(account == nil ? NT.ink3 : NT.ink2)
                            }
                            Spacer(minLength: 6)
                            if savingMapping == r.id {
                                ProgressView().tint(NT.purple)
                            } else {
                                NOSBadge(text: value.isEmpty ? "未設定" : "設定済み", color: value.isEmpty ? NT.warn : NT.ok)
                            }
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                        }
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(savingMapping == r.id)
                    if r.id != p.mappingRows.last?.id { NPACDivider() }
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
struct NPACAutoSourceCard: View {
    let source: NPACSource
    let range: NPACRange
    @ObservedObject var loader: NPACLoader<NPACAutoPayload>
    let onCreated: () -> Void

    @State private var expanded = false
    @State private var candidates: [NPACCandidate]?
    @State private var selected: Set<String> = []
    @State private var generating = false
    @State private var creating = false
    @State private var confirmPost = false

    private var creatable: [NPACCandidate] { (candidates ?? []).filter { !$0.alreadyPosted && $0.balanced } }

    private func generate() async {
        expanded = true
        generating = true
        defer { generating = false }
        let query = ["view": "autoCandidates", "source": source.sourceType, "from": range.from, "to": range.to]
        if NativePreview.current != nil {
            let r = NPACSamples.object("accounting", query).flatMap { NOS.decode(NPACCandidatesPayload.self, $0) }
            candidates = r?.candidates ?? []
            selected = Set((r?.candidates ?? []).filter { !$0.alreadyPosted && $0.balanced }.map(\.sourceId))
            return
        }
        do {
            let r = try await NPACApi.get(NPACCandidatesPayload.self, query)
            candidates = r.candidates
            selected = Set(r.candidates.filter { !$0.alreadyPosted && $0.balanced }.map(\.sourceId))
        } catch {
            loader.error = NativeModuleAPI.message(error)
        }
    }

    private func create(post: Bool) async {
        let keys = selected.sorted()
        guard !keys.isEmpty else { loader.error = "作成する仕訳を選択してください"; return }
        if NativePreview.current != nil { loader.toast = "作成 \(keys.count)件"; return }
        creating = true
        defer { creating = false }
        do {
            let r = try await NPACApi.post(["type": "accAutoCreate", "source": source.sourceType, "keys": keys, "post": post], as: NPACCreateResponse.self)
            if r.result.failed.isEmpty { loader.toast = r.result.message } else { loader.error = r.result.message }
            await generate()
            onCreated()
        } catch {
            loader.error = NativeModuleAPI.message(error)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(source.title).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
                        if source.negative { NOSBadge(text: "マイナス計上", color: NT.warn) }
                    }
                    Text(source.hint).font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("対象").font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3)
                    Text("\(source.pendingCount)件").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    Text(NT.yen(source.pendingTotal)).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                }
            }
            HStack(spacing: 8) {
                NPACPill(title: generating ? "集計中…" : "候補を生成", icon: "arrow.triangle.2.circlepath", enabled: !generating) { Task { await generate() } }
                Spacer()
                if candidates != nil {
                    Button { expanded.toggle() } label: {
                        Label(expanded ? "閉じる" : "開く", systemImage: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                    }
                    .buttonStyle(.plain)
                }
            }
            if expanded {
                NPACDivider()
                candidatesView
            }
        }
        .padding(14)
        .background(npocCard())
        .confirmationDialog("選んだ\(selected.count)件の仕訳を作成して確定しますか？", isPresented: $confirmPost, titleVisibility: .visible) {
            Button("作成して確定する") { Task { await create(post: true) } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("確定後の修正は修正仕訳で行います。先に確かめたいときは「下書き作成」を押してください。")
        }
    }

    @ViewBuilder private var candidatesView: some View {
        if generating && candidates == nil {
            HStack { Spacer(); ProgressView("候補を集計しています…"); Spacer() }.padding(.vertical, 16)
        } else if let list = candidates {
            if list.isEmpty {
                Text("この区分で仕訳が必要な未処理データはありませんでした。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
            } else {
                Button {
                    if !creatable.isEmpty && selected.count == creatable.count { selected = [] } else { selected = Set(creatable.map(\.sourceId)) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: !creatable.isEmpty && selected.count == creatable.count ? "checkmark.square.fill" : "square")
                            .font(.system(size: 19, weight: .semibold)).foregroundColor(NT.purple)
                        Text("作成できる\(creatable.count)件をすべて選ぶ").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                    }
                }
                .buttonStyle(.plain)
                ForEach(list) { c in candidateRow(c) }
                NOMNote(text: "自動仕訳はここで確かめてから確定してください。確定後の修正は修正仕訳で行います。")
                Text("\(selected.count)件を選択中").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                HStack(spacing: 8) {
                    NPOCWideButton(text: "下書き作成", kind: .secondary, busy: creating, disabled: selected.isEmpty, height: 44) { Task { await create(post: false) } }
                    NPOCWideButton(text: "作成して確定", kind: .primary, busy: creating, disabled: selected.isEmpty, height: 44) { confirmPost = true }
                }
            }
        } else {
            Text("「候補を生成」を押すと、選んだ期間・対象データから仕訳候補を計算します。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
        }
    }

    private func candidateRow(_ c: NPACCandidate) -> some View {
        let enabled = !c.alreadyPosted && c.balanced
        let on = selected.contains(c.sourceId)
        return HStack(alignment: .top, spacing: 4) {
            NPACCheck(on: on, enabled: enabled) {
                if on { selected.remove(c.sourceId) } else { selected.insert(c.sourceId) }
            }
            .padding(.leading, -6)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(c.date == "—" ? "—" : NPACText.date(c.date)).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                    Text(c.storeName ?? "全社").font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(NT.yen(c.debit)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                }
                Text(c.description).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                ForEach(c.lines) { l in
                    HStack(spacing: 4) {
                        Text("\(l.side == "debit" ? "借方" : "貸方") \(l.accountName)").foregroundColor(l.side == "debit" ? NT.purpleDeep : NT.ink2).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(NT.yen(l.amount)).fontWeight(.semibold).monospacedDigit().foregroundColor(NT.ink)
                    }
                    .font(.system(size: 11.5))
                }
                HStack(spacing: 4) {
                    if c.alreadyPosted { NOSBadge(text: "作成済み", color: NT.ink3) }
                    if !c.balanced { NOSBadge(text: "貸借不一致", color: NT.danger) }
                }
                if let w = c.warning { Text(w).font(.system(size: 11)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true) }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NT.lilac : NT.page))
    }
}

// MARK: - 固定資産の中身（GET view=assets）

struct NPACAsset: Decodable, Identifiable, Hashable {
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

struct NPACAssetsPayload: Decodable {
    let stores: [NPACStore]
    let today: String
    let methods: [NPACOption]
    let rows: [NPACAsset]
}

struct NPACAssetTarget: Identifiable {
    let id: String
    let asset: NPACAsset?
}

/// 確かめてから行う操作（使用中に戻す・削除）
struct NPACAssetAction: Identifiable {
    let id = UUID()
    let kind: String
    let asset: NPACAsset
}

// MARK: - 固定資産

struct NPACAssetsPage: View {
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACAssetsPayload>()
    @State private var editing: NPACAssetTarget?
    @State private var disposing: NPACAsset?
    @State private var action: NPACAssetAction?
    @State private var started = false

    private func load() async { await loader.load(["view": "assets"]) }

    var body: some View {
        NPACFrame(nav: nav, trailing: {
            if loader.data != nil {
                NPOCBarButton(icon: "plus", label: "登録") { editing = NPACAssetTarget(id: "new", asset: nil) }
            }
        }) {
            NPACPageShell(error: $loader.error, toast: $loader.toast, hasData: loader.data != nil, useWeb: loader.useWeb, onWeb: nav.web, retry: { Task { await load() } }) {
                if let p = loader.data { list(p) }
            }
        }
        .task {
            if !started {
                started = true
                await load()
            }
        }
        .sheet(item: $editing) { t in
            if let p = loader.data {
                NPACAssetEditor(payload: p, asset: t.asset, onClose: { editing = nil }, onSaved: { msg in
                    editing = nil
                    loader.toast = msg
                    Task { await load() }
                })
            }
        }
        .sheet(item: $disposing) { a in
            NPACDisposeSheet(asset: a, today: loader.data?.today ?? NOS.today, onClose: { disposing = nil }, onSaved: { msg in
                disposing = nil
                loader.toast = msg
                Task { await load() }
            })
        }
        .confirmationDialog(actionTitle, isPresented: Binding(get: { action != nil }, set: { if !$0 { action = nil } }), titleVisibility: .visible, presenting: action) { a in
            if a.kind == "delete" {
                Button("削除する", role: .destructive) {
                    Task { if await loader.act(["type": "accAssetDelete", "id": a.asset.id], done: "固定資産を削除しました") { await load() } }
                }
            } else {
                Button("使用中に戻す") {
                    Task { if await loader.act(["type": "accAssetStatus", "id": a.asset.id, "status": "in_use", "disposedOn": ""], done: "使用中に戻しました") { await load() } }
                }
            }
            Button("やめる", role: .cancel) {}
        } message: { a in
            Text(a.kind == "delete" ? "「\(a.asset.name)」を削除します。" : "「\(a.asset.name)」の除却・売却を取り消して、使用中に戻します。")
        }
    }

    private var actionTitle: String {
        guard let a = action else { return "" }
        return a.kind == "delete" ? "固定資産を削除しますか？" : "使用中に戻しますか？"
    }

    private func list(_ p: NPACAssetsPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text("取得した資産の台帳を管理します（減価償却の自動計算は未対応）。").font(.system(size: 12)).foregroundColor(NT.ink3).padding(.horizontal, 4)
                if p.rows.isEmpty {
                    NPOCEmpty(icon: "shippingbox", title: "固定資産が登録されていません", note: "右上の「＋ 登録」から取得した資産を登録してください")
                } else {
                    ForEach(p.rows) { r in card(r) }
                }
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await load() }
    }

    private func card(_ r: NPACAsset) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(r.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(2)
                Spacer(minLength: 6)
                NOSBadge(text: r.statusLabel, color: NPACText.statusColor(r.status))
            }
            NPZInfoRow(label: "取得価額", value: NT.yen(r.acquisitionCost))
            NPZInfoRow(label: "取得日", value: NPACText.date(r.acquiredOn))
            NPZInfoRow(label: "耐用年数・償却方法", value: "\(r.usefulLifeYears.map { "\($0)年" } ?? "—")・\(r.methodLabel)")
            NPZInfoRow(label: "店舗", value: r.storeName ?? "全社")
            if let d = r.disposedOn { NPZInfoRow(label: r.status == "sold" ? "売却日" : "除却日", value: NPACText.date(d)) }
            if let n = r.note, !n.isEmpty { Text(n).font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: 6) {
                NPACPill(title: "編集", icon: "pencil") { editing = NPACAssetTarget(id: r.id, asset: r) }
                if r.status == "in_use" {
                    NPACPill(title: "除却・売却", tint: NT.warn) { disposing = r }
                } else if r.status != "deleted" {
                    NPACPill(title: "使用中に戻す", tint: NT.ok, enabled: !loader.busy) { action = NPACAssetAction(kind: "restore", asset: r) }
                }
                Spacer(minLength: 0)
                NPACPill(title: "削除", tint: NT.danger) { action = NPACAssetAction(kind: "delete", asset: r) }
            }
        }
        .padding(14)
        .background(npocCard())
    }
}
