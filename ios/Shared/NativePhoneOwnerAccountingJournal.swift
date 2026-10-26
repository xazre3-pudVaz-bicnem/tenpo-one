import SwiftUI

// iPhone の店長・オーナー：会計 › 仕訳（Web の /app/accounting・journal-panel・journal-entry-dialog）と月次締め（period-close-panel）。
//   仕訳：絞り込み（期間・状態・区分・店舗）・元取引で絞り込み（?source_type=&source_id=。全期間）・CSV出力・ページ送り・
//        詳細（明細・元取引へ・編集・確定（確認）・削除（確認）・修正仕訳（確認）・取消（理由））
//   月次締め：対象月（前後）・締める（確認）・締め解除（理由）・直近12ヶ月・締め／解除の履歴。会計の書込ができる人だけ
// サーバーは iPad と同じ GET part=accounting&view=journal|periods ／ POST accJournal*・accPeriod*（返事の形は変えない）。

// MARK: - 仕訳の中身（GET view=journal）

struct NPACJournalLine: Decodable, Hashable {
    let accountId: String
    let accountCode: String
    let accountName: String
    let side: String
    let amount: Int
    let taxTreatment: String
    let taxLabel: String
    let memo: String?
}

struct NPACJournalEntry: Decodable, Identifiable, Hashable {
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
    let lines: [NPACJournalLine]
}

struct NPACJournalAccount: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let defaultTaxTreatment: String
}

struct NPACJournalFilters: Decodable, Hashable {
    let from: String
    let to: String
    let status: String
    let sourceType: String
    let sourceId: String
    let storeId: String
    let page: Int
}

struct NPACJournalPayload: Decodable {
    let stores: [NPACStore]
    let isHq: Bool
    let canWrite: Bool
    let today: String
    let filters: NPACJournalFilters
    let statusOptions: [NPACOption]
    let sourceTypeOptions: [NPACOption]
    let taxOptions: [NPACOption]
    let accounts: [NPACJournalAccount]
    let entries: [NPACJournalEntry]
    let count: Int
    let pageSize: Int
    let totalPages: Int
    let rangeFrom: Int
    let exportPath: String
}

// MARK: - 月次締めの中身（GET view=periods）

struct NPACPeriodRow: Decodable, Identifiable, Hashable {
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

struct NPACPeriodHistory: Decodable, Identifiable, Hashable {
    let id: String
    let isClose: Bool
    let label: String
    let createdAtLabel: String
    let actorName: String?
    let reason: String?
}

struct NPACPeriodsPayload: Decodable {
    let canReopen: Bool
    let month: String
    let monthLabel: String
    let status: String
    let statusLabel: String
    let draftCount: Int
    let justReopened: Bool
    let draftFilter: NPACRange
    let overview: [NPACPeriodRow]
    let history: [NPACPeriodHistory]
}


// MARK: - 仕訳の一覧

struct NPACEditorTarget: Identifiable {
    let id: String
    let entry: NPACJournalEntry?
}

struct NPACJournalPage: View {
    let initial: [String: String]
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACJournalPayload>()
    @State private var applied: [String: String] = [:]
    @State private var openId: String?
    @State private var editing: NPACEditorTarget?
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "journal"
        await loader.load(full)
    }

    private func reload() async { await load(applied) }

    /// 今の絞り込みの一部を変えて読み直す（ページは 1 に戻す）
    private func refilter(_ change: [String: String]) {
        guard let f = loader.data?.filters else { return }
        var q = ["from": f.from, "to": f.to, "status": f.status, "source_type": f.sourceType, "source_id": f.sourceId, "store": f.storeId]
        for (k, v) in change { q[k] = v }
        q["page"] = "1"
        let query = q
        Task { await load(query) }
    }

    private func go(page: Int) {
        var q = applied
        q["page"] = String(page)
        let query = q
        Task { await load(query) }
    }

    var body: some View {
        ZStack {
            NPACFrame(nav: nav, trailing: {
                if loader.data?.canWrite == true {
                    NPOCBarButton(icon: "plus", label: "作成") { editing = NPACEditorTarget(id: "new", entry: nil) }
                }
            }) {
                NPACPageShell(error: $loader.error, toast: $loader.toast, hasData: loader.data != nil, useWeb: loader.useWeb, onWeb: nav.web, retry: { Task { await reload() } }) {
                    if let p = loader.data { list(p) }
                }
            }
            if let id = openId, let p = loader.data, let e = p.entries.first(where: { $0.id == id }) {
                NPACJournalDetail(entry: e, canWrite: p.canWrite, loader: loader, nav: nav,
                                  onBack: { openId = nil },
                                  onEdit: { editing = NPACEditorTarget(id: e.id, entry: e) },
                                  onChanged: { await reload() })
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.22), value: openId)
        .task {
            if !started {
                started = true
                await load(initial)
            }
        }
        .sheet(item: $editing) { t in
            if let p = loader.data {
                NPACEntryEditor(payload: p, entry: t.entry, onClose: { editing = nil }, onSaved: { msg in
                    editing = nil
                    loader.toast = msg
                    Task { await reload() }
                })
            }
        }
    }

    private func list(_ p: NPACJournalPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                filters(p)
                if !p.filters.sourceId.isEmpty { sourceBanner(p) }
                HStack(spacing: 8) {
                    Text(p.count > 0 ? "\(p.count)件（新しい順）" : "").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                    Spacer()
                    NPACPill(title: "CSV出力", icon: "square.and.arrow.up") {
                        NPACShare.csv(p.exportPath, name: "仕訳_\(p.filters.from)_\(p.filters.to).csv") { loader.error = $0 }
                    }
                }
                .padding(.horizontal, 4)
                if p.entries.isEmpty {
                    NPOCEmpty(icon: "book", title: "該当する仕訳がありません", note: p.canWrite ? "条件を変えるか、右上の「＋ 作成」から仕訳を登録してください" : "条件を変えてください")
                } else {
                    ForEach(p.entries) { e in
                        Button { openId = e.id } label: { row(e) }
                            .buttonStyle(PressableStyle(scale: 0.985))
                    }
                }
                if p.totalPages > 1 {
                    NPACPager(page: p.filters.page, totalPages: p.totalPages,
                              caption: "\(p.count)件中 \(p.rangeFrom + 1)〜\(min(p.count, p.rangeFrom + p.pageSize))件") { go(page: $0) }
                }
                if p.canWrite {
                    Button { nav.open(.periods, [:]) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "lock").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                            Text("月次締め（締める・締め解除・履歴）").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                        }
                        .padding(.horizontal, 14).frame(height: 48)
                        .background(npocCard(14))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await reload() }
    }

    @ViewBuilder private func filters(_ p: NPACJournalPayload) -> some View {
        NPACPeriodBar(from: p.filters.from, to: p.filters.to, showAll: true) { a, b in refilter(["from": a, "to": b]) }
        NPACChipScroll(items: [("", "すべて")] + p.statusOptions.map { ($0.value, $0.label) }, selection: p.filters.status) { refilter(["status": $0]) }
        NPACMenuRow {
            NPOCMenuChip(label: "区分", options: [("", "すべて")] + p.sourceTypeOptions.map { ($0.value, $0.label) }, selection: p.filters.sourceType) { refilter(["source_type": $0]) }
            if p.isHq {
                NPOCMenuChip(label: "店舗", options: [("", "全店舗")] + p.stores.map { ($0.id, $0.name) }, selection: p.filters.storeId) { refilter(["store": $0]) }
            }
        }
    }

    private func sourceBanner(_ p: NPACJournalPayload) -> some View {
        let label = p.sourceTypeOptions.first { $0.value == p.filters.sourceType }?.label ?? "すべて"
        return HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease.circle.fill").foregroundColor(NT.purple)
            Text("元取引の仕訳だけを表示中（区分: \(p.filters.sourceType.isEmpty ? "すべて" : label)）")
                .font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button("解除") {
                let today = NOS.today
                let q = ["from": NOS.monthFirst(today), "to": today, "status": p.filters.status, "store": p.filters.storeId]
                Task { await load(q) }
            }
            .font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }

    private func row(_ e: NPACJournalEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("#\(e.entryNo)").font(.system(size: 12.5, weight: .bold, design: .monospaced)).foregroundColor(NT.ink3)
                Text(NPACText.date(e.entryDate)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                Spacer(minLength: 4)
                NOSBadge(text: e.statusLabel, color: NPACText.statusColor(e.status))
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(e.description).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 6)
                Text(NT.yen(e.debitTotal)).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            Text("借方 \(NPACText.summary(e.lines, "debit"))　貸方 \(NPACText.summary(e.lines, "credit"))")
                .font(.system(size: 12)).foregroundColor(NT.ink2).lineLimit(1)
            HStack(spacing: 6) {
                NOSBadge(text: e.sourceType == "manual" ? "手動" : "自動仕訳・\(e.sourceLabel)", color: e.sourceType == "manual" ? NT.ink3 : NT.purple)
                Text(e.storeName ?? "全社").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
        }
        .padding(12)
        .background(npocCard(14))
    }
}

// MARK: - 仕訳の詳細（明細・元取引・編集・確定・削除・修正仕訳・取消）

struct NPACJournalDetail: View {
    let entry: NPACJournalEntry
    let canWrite: Bool
    @ObservedObject var loader: NPACLoader<NPACJournalPayload>
    let nav: NPACNav
    let onBack: () -> Void
    let onEdit: () -> Void
    let onChanged: () async -> Void

    /// post（確定）・delete（削除）・correct（修正仕訳）
    @State private var confirm: String?
    @State private var voidPrompt: NOMReasonPrompt?

    var body: some View {
        NPOCDetailFrame(title: "仕訳 #\(entry.entryNo)", subtitle: NPACText.date(entry.entryDate), backLabel: "仕訳", onBack: onBack, trailing: { EmptyView() }) {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    NOSErrorBar(error: $loader.error)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            header
                            linesCard
                            if let href = entry.originHref {
                                Button { nav.follow(href) } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "arrow.up.right.square").font(.system(size: 14, weight: .bold))
                                        Text(entry.originLabel ?? "元取引を見る").font(.system(size: 14, weight: .bold))
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                                    }
                                    .foregroundColor(NT.purpleDeep)
                                    .padding(.horizontal, 14).frame(height: 48)
                                    .background(npocCard(14))
                                }
                                .buttonStyle(PressableStyle())
                            }
                            if canWrite { actions }
                        }
                        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 60)
                    }
                }
                NPHToast(text: $loader.toast)
            }
        }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if confirm == "post" {
                Button("確定する") { run(["type": "accJournalPost", "id": entry.id], done: "仕訳を確定しました") }
            } else if confirm == "delete" {
                Button("削除する", role: .destructive) { run(["type": "accJournalDelete", "id": entry.id], done: "仕訳を削除しました", close: true) }
            } else if confirm == "correct" {
                Button("修正仕訳を作る") { run(["type": "accJournalCorrect", "id": entry.id], done: "修正仕訳（下書き）を作成しました。一覧から編集・確定してください") }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text(confirmMessage)
        }
        .sheet(item: $voidPrompt) { pr in
            NOMReasonSheet(prompt: pr, onDone: { voidPrompt = nil })
                .environment(\.colorScheme, .light)
        }
    }

    private var confirmTitle: String {
        switch confirm ?? "" {
        case "post": return "この仕訳を確定しますか？"
        case "delete": return "この仕訳（下書き）を削除しますか？"
        case "correct": return "修正仕訳を作りますか？"
        default: return ""
        }
    }

    private var confirmMessage: String {
        switch confirm ?? "" {
        case "post": return "「\(entry.description)」\(NT.yen(entry.debitTotal))。確定後は編集・削除できません（直すときは修正仕訳・取消）。"
        case "delete": return "「\(entry.description)」を削除します。この操作は取り消せません。"
        case "correct": return "この仕訳を打ち消す修正仕訳（下書き）を作ります。"
        default: return ""
        }
    }

    private func run(_ body: [String: Any], done: String, close: Bool = false) {
        Task {
            if await loader.act(body, done: done) {
                await onChanged()
                if close { onBack() }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(entry.description).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                NOSBadge(text: entry.statusLabel, color: NPACText.statusColor(entry.status))
            }
            HStack(alignment: .firstTextBaseline) {
                Text("金額（借方合計）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Text(NT.yen(entry.debitTotal)).font(.system(size: 28, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
            NPZInfoRow(label: "日付", value: NPACText.date(entry.entryDate))
            NPZInfoRow(label: "店舗", value: entry.storeName ?? "全社")
            NPZInfoRow(label: "区分", value: entry.sourceType == "manual" ? "手動" : "自動仕訳・\(entry.sourceLabel)")
            if entry.status == "voided", let r = entry.voidReason, !r.isEmpty {
                Text("取消理由：\(r)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.danger)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
            }
        }
        .padding(14)
        .background(npocCard())
    }

    private var linesCard: some View {
        let debit = entry.lines.filter { $0.side == "debit" }.reduce(0) { $0 + $1.amount }
        let credit = entry.lines.filter { $0.side == "credit" }.reduce(0) { $0 + $1.amount }
        return NPOCard(title: "明細", trailing: "\(entry.lines.count)行") {
            if entry.lines.isEmpty {
                Text("明細がありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                ForEach(Array(entry.lines.enumerated()), id: \.offset) { item in
                    lineRow(item.element)
                    NPACDivider()
                }
                NPACMoneyRow(label: "借方合計", value: debit, bold: true)
                NPACMoneyRow(label: "貸方合計", value: credit, bold: true, tone: debit == credit ? NT.ink : NT.danger)
            }
        }
    }

    private func lineRow(_ l: NPACJournalLine) -> some View {
        let isDebit = l.side == "debit"
        return HStack(alignment: .top, spacing: 10) {
            Text(isDebit ? "借方" : "貸方").font(.system(size: 11.5, weight: NT.strong))
                .foregroundColor(isDebit ? NT.purpleDeep : NT.ink2)
                .frame(width: 40, height: 24)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(isDebit ? NT.lilac : NT.page))
            VStack(alignment: .leading, spacing: 3) {
                Text("\(l.accountCode) \(l.accountName)").font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                Text(l.taxLabel).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                if let m = l.memo, !m.isEmpty { Text(m).font(.system(size: 12)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 6)
            Text(NT.yen(l.amount)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var actions: some View {
        VStack(spacing: 8) {
            if entry.status == "draft" {
                NPOCWideButton(text: "確定する", icon: "checkmark.seal", kind: .success, busy: loader.busy) { confirm = "post" }
                NPOCWideButton(text: "編集する", icon: "pencil", kind: .secondary, disabled: loader.busy, action: onEdit)
                NPOCWideButton(text: "削除する", icon: "trash", kind: .secondary, disabled: loader.busy) { confirm = "delete" }
            } else if entry.status == "posted" {
                NPOCWideButton(text: "修正仕訳を作る", icon: "arrow.uturn.backward", kind: .secondary, busy: loader.busy) { confirm = "correct" }
                NPOCWideButton(text: "取消する（理由）", icon: "xmark.circle", kind: .danger, disabled: loader.busy) {
                    let id = entry.id
                    voidPrompt = NOMReasonPrompt(
                        title: "仕訳を取消",
                        message: "「\(entry.description)」を取消します。取消履歴は保持され、必要に応じて修正仕訳を作成できます。",
                        confirm: "取消する",
                        run: { reason in
                            if await loader.act(["type": "accJournalVoid", "id": id, "reason": reason], done: "仕訳を取消しました") {
                                await onChanged()
                                return nil
                            }
                            return await loader.takeError("取消できませんでした")
                        }
                    )
                }
            }
        }
    }
}

// MARK: - 月次締め（締める・締め解除・直近12ヶ月・履歴）

struct NPACPeriodsPage: View {
    let initial: [String: String]
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACPeriodsPayload>()
    @State private var confirmClose = false
    @State private var reopenPrompt: NOMReasonPrompt?
    @State private var started = false

    private func load(_ m: String?) async {
        var q = ["view": "periods"]
        if let m, !m.isEmpty { q["month"] = m }
        await loader.load(q)
    }

    var body: some View {
        NPACFrame(nav: nav, trailing: { EmptyView() }) {
            NPACPageShell(error: $loader.error, toast: $loader.toast, hasData: loader.data != nil, useWeb: loader.useWeb, onWeb: nav.web, retry: { Task { await load(initial["month"]) } }) {
                if let p = loader.data { content(p) }
            }
        }
        .task {
            if !started {
                started = true
                await load(initial["month"])
            }
        }
        .confirmationDialog(loader.data.map { "\($0.monthLabel)を締めますか？" } ?? "締めますか？", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("この月を締める", role: .destructive) {
                guard let m = loader.data?.month else { return }
                Task {
                    await loader.act(["type": "accPeriodClose", "month": m], done: "\(NPACText.monthLabel(m))を締めました")
                    await load(m)
                }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("締めた後は、この月の仕訳の作成・修正・確定ができなくなります。直すには org_owner / hq_admin による締め解除（理由が必要）がいります。")
        }
        .sheet(item: $reopenPrompt) { pr in
            NOMReasonSheet(prompt: pr, onDone: { reopenPrompt = nil })
                .environment(\.colorScheme, .light)
        }
    }

    private func content(_ p: NPACPeriodsPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                NOSStepper(title: p.monthLabel, caption: p.statusLabel,
                           onPrev: { Task { await load(NOS.shiftMonth(p.month, -1)) } },
                           onNext: { Task { await load(NOS.shiftMonth(p.month, 1)) } })
                statusCard(p)
                NOMNote(text: "締め前の月は仕訳の作成・修正・確定ができます。締め後は通常ユーザーによる計上・修正ができなくなり、修正するには org_owner / hq_admin による締め解除（理由必須・操作履歴に記録）が必要です。")
                overview(p)
                history(p)
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await load(p.month) }
    }

    private func statusCard(_ p: NPACPeriodsPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: p.status == "closed" ? "lock.fill" : "lock.open").font(.system(size: 18, weight: .bold))
                    .foregroundColor(p.status == "closed" ? NT.ok : NT.ink3)
                Text(p.monthLabel).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer()
                NOSBadge(text: p.statusLabel, color: NPACText.statusColor(p.status))
            }
            if p.justReopened {
                VStack(alignment: .leading, spacing: 8) {
                    Text("この月は締め解除されています。仕訳を修正したうえで、再度この月を締めてください。")
                        .font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true)
                    NPACPill(title: "下書きの仕訳を確認", icon: "doc.text", tint: NT.warn) { openDrafts(p) }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.warn.opacity(0.1)))
            }
            if p.status != "closed" {
                if p.draftCount > 0 {
                    HStack(spacing: 8) {
                        Text("下書きの仕訳が\(p.draftCount)件残っています（締めるには確定が必要です）")
                            .font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        NPACPill(title: "見る", tint: NT.warn) { openDrafts(p) }
                    }
                }
                NPOCWideButton(text: "この月を締める", icon: "lock", kind: .primary, busy: loader.busy, disabled: p.draftCount > 0) { confirmClose = true }
            } else {
                Text("締め済みの月です。修正には締め解除が必要です。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                if p.canReopen {
                    NPOCWideButton(text: "締め解除（理由）", icon: "lock.open", kind: .secondary, disabled: loader.busy) {
                        let m = p.month
                        reopenPrompt = NOMReasonPrompt(
                            title: "締め解除",
                            message: "\(p.monthLabel)の締めを解除します。解除の理由は操作履歴に記録されます。解除後は仕訳を修正したうえで、再度締め処理を行ってください。",
                            confirm: "締め解除する",
                            run: { reason in
                                if await loader.act(["type": "accPeriodReopen", "month": m, "reason": reason], done: "\(NPACText.monthLabel(m))の締めを解除しました") {
                                    await load(m)
                                    return nil
                                }
                                return await loader.takeError("締め解除できませんでした")
                            }
                        )
                    }
                } else {
                    Text("締め解除は org_owner / hq_admin のみ実行できます。").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
            }
        }
        .padding(14)
        .background(npocCard())
    }

    private func openDrafts(_ p: NPACPeriodsPayload) {
        nav.open(.journal, ["from": p.draftFilter.from, "to": p.draftFilter.to, "status": "draft"])
    }

    private func overview(_ p: NPACPeriodsPayload) -> some View {
        NPOCard(title: "直近12ヶ月の状況", trailing: "押すとその月") {
            ForEach(p.overview) { r in
                Button { Task { await load(r.month) } } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(r.label).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                            NOSBadge(text: r.statusLabel, color: NPACText.statusColor(r.status))
                            Spacer(minLength: 4)
                            if r.draftCount > 0 { Text("下書き \(r.draftCount)").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.warn) }
                            if r.month == p.month { Image(systemName: "checkmark").font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.purple) }
                        }
                        if r.closedAtLabel != nil {
                            Text("締め：\(NPACText.actor(r.closedAtLabel, r.closedByName))").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
                        }
                        if r.reopenedAtLabel != nil {
                            Text("解除：\(NPACText.actor(r.reopenedAtLabel, r.reopenedByName))").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
                        }
                    }
                    .padding(.vertical, 7).padding(.horizontal, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(r.month == p.month ? NT.lilac : Color.clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func history(_ p: NPACPeriodsPayload) -> some View {
        NPOCard(title: "\(p.monthLabel)の締め・解除の履歴") {
            if p.history.isEmpty {
                Text("履歴はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                ForEach(p.history) { h in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            NOSBadge(text: h.label, color: h.isClose ? NT.ok : NT.warn)
                            Text(h.createdAtLabel).font(.system(size: 12)).foregroundColor(NT.ink3)
                            if let a = h.actorName { Text(a).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2) }
                        }
                        if let r = h.reason, !r.isEmpty {
                            Text("理由：\(r)").font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, 4)
                    if h.id != p.history.last?.id { NPACDivider() }
                }
            }
        }
    }
}
