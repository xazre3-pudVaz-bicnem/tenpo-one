import SwiftUI

// iPhone の店長・オーナー：会計 › 帳簿（Web の /app/accounting/ledger）・財務レポート（/app/accounting/statements）。
//   帳簿：仕訳帳・総勘定元帳・現金出納帳・預金出納帳・売掛帳・買掛帳（期間・店舗・科目）・CSV出力（共有シート）・元取引へ
//   財務レポート：残高のタイル・損益計算書・貸借対照表・試算表（行を押すと総勘定元帳。長押しで期首残高の明細）・期間比較・月別推移・試算表CSV
// サーバーは iPad と同じ GET part=accounting&view=ledger|statements（返事の形は変えない）。

// MARK: - 帳簿の中身（GET view=ledger）

struct NPACTab: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct NPACEmptyInfo: Decodable, Hashable {
    let title: String
    let description: String
}

struct NPACBookLine: Decodable, Hashable {
    let accountCode: String
    let accountName: String
    let side: String
    let amount: Int
    let taxLabel: String
    let memo: String?
}

struct NPACBookEntry: Decodable, Identifiable, Hashable {
    let id: String
    let entryNo: Int
    let entryDate: String
    let description: String
    let debitTotal: Int
    let lines: [NPACBookLine]
}

struct NPACLedgerRow: Decodable, Identifiable, Hashable {
    let id: String
    let date: String
    let description: String
    let counter: String
    let debit: Int
    let credit: Int
    let balance: Int
    let storeName: String?
    let originHref: String?
    let originLabel: String?
}

struct NPACLedgerBook: Decodable, Hashable {
    let accountId: String
    let accountCode: String
    let accountName: String
    let opening: Int
    let rows: [NPACLedgerRow]
}

struct NPACLedgerFilters: Decodable, Hashable {
    let tab: String
    let from: String
    let to: String
    let storeId: String
    let accountId: String?
}

struct NPACLedgerPayload: Decodable {
    let stores: [NPACStore]
    let isHq: Bool
    let filters: NPACLedgerFilters
    let tabs: [NPACTab]
    let candidateAccounts: [NPACAccountRef]
    let empty: NPACEmptyInfo?
    let journal: [NPACBookEntry]?
    let ledger: NPACLedgerBook?
    let exportPath: String
}

// MARK: - 帳簿

struct NPACLedgerPage: View {
    let initial: [String: String]
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACLedgerPayload>()
    @State private var applied: [String: String] = [:]
    @State private var expanded: Set<String> = []
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "ledger"
        await loader.load(full)
    }

    /// 今の絞り込みの一部を変えて読み直す
    private func refilter(_ change: [String: String]) {
        guard let f = loader.data?.filters else { return }
        var q = ["tab": f.tab, "from": f.from, "to": f.to, "store": f.storeId]
        if f.tab != "journal", let a = f.accountId { q["account"] = a }
        for (k, v) in change { q[k] = v }
        let query = q
        Task { await load(query) }
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
    }

    private func content(_ p: NPACLedgerPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                // Web のタブと同じく、帳簿の種類を変えると期間・科目は最初に戻る
                NPACChipScroll(items: p.tabs.map { ($0.key, $0.label) }, selection: p.filters.tab) { key in Task { await load(["tab": key]) } }
                NPACPeriodBar(from: p.filters.from, to: p.filters.to) { a, b in refilter(["from": a, "to": b]) }
                NPACMenuRow {
                    if p.isHq {
                        NPOCMenuChip(label: "店舗", options: [("", "全店舗")] + p.stores.map { ($0.id, $0.name) }, selection: p.filters.storeId) { refilter(["store": $0]) }
                    }
                    if p.filters.tab != "journal" && !p.candidateAccounts.isEmpty {
                        NPOCMenuChip(label: "科目", options: p.candidateAccounts.map { ($0.id, "\($0.code) \($0.name)") }, selection: p.filters.accountId ?? "") { refilter(["account": $0]) }
                    }
                }
                HStack {
                    Spacer()
                    NPACPill(title: "CSV出力", icon: "square.and.arrow.up") {
                        NPACShare.csv(p.exportPath, name: "帳簿_\(p.filters.tab)_\(p.filters.from)_\(p.filters.to).csv") { loader.error = $0 }
                    }
                }
                entries(p)
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await load(applied) }
    }

    @ViewBuilder private func entries(_ p: NPACLedgerPayload) -> some View {
        if let journal = p.journal {
            if journal.isEmpty {
                NPOCEmpty(icon: "book", title: "該当する仕訳がありません", note: "期間や店舗の条件を変えてください")
            } else {
                ForEach(journal) { e in journalCard(e) }
            }
        } else if let book = p.ledger {
            ledgerHead(book)
            if book.rows.isEmpty {
                NPOCEmpty(icon: "list.bullet.rectangle", title: "この期間の取引はありません")
            } else {
                ForEach(book.rows) { r in ledgerRow(r) }
            }
        } else if let empty = p.empty {
            NPOCEmpty(icon: "tray", title: empty.title, note: empty.description)
        }
    }

    private func journalCard(_ e: NPACBookEntry) -> some View {
        let open = expanded.contains(e.id)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                if open { expanded.remove(e.id) } else { expanded.insert(e.id) }
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text("#\(e.entryNo)").font(.system(size: 12.5, weight: .bold, design: .monospaced)).foregroundColor(NT.ink3)
                        Text(NPACText.date(e.entryDate)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                        Spacer(minLength: 4)
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(e.description).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                        Spacer(minLength: 6)
                        Text(NT.yen(e.debitTotal)).font(.system(size: 15.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                NPACDivider()
                ForEach(Array(e.lines.enumerated()), id: \.offset) { item in
                    let l = item.element
                    HStack(alignment: .top, spacing: 8) {
                        Text(l.side == "debit" ? "借方" : "貸方").font(.system(size: 11, weight: NT.strong))
                            .foregroundColor(l.side == "debit" ? NT.purpleDeep : NT.ink2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(l.accountCode) \(l.accountName)").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink)
                            Text([l.taxLabel, l.memo ?? ""].filter { !$0.isEmpty }.joined(separator: "・")).font(.system(size: 11)).foregroundColor(NT.ink3)
                        }
                        Spacer(minLength: 6)
                        Text(NT.yen(l.amount)).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).monospacedDigit()
                    }
                }
            }
        }
        .padding(12)
        .background(npocCard(14))
    }

    private func ledgerHead(_ b: NPACLedgerBook) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(b.accountCode) \(b.accountName)").font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink)
            HStack {
                Text("期首残高（期間の前日まで）").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                Spacer()
                Text(NT.yen(b.opening)).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            if let last = b.rows.last {
                HStack {
                    Text("期末残高").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                    Spacer()
                    Text(NT.yen(last.balance)).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                }
            }
        }
        .padding(14)
        .background(npocCard())
    }

    private func ledgerRow(_ r: NPACLedgerRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(NPACText.date(r.date)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit()
                if let s = r.storeName { Text(s).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1) }
                Spacer(minLength: 4)
                Text("残高 \(NT.yen(r.balance))").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink).monospacedDigit()
            }
            Text(r.description).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            if !r.counter.isEmpty {
                Text("相手科目：\(r.counter)").font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(2)
            }
            HStack(spacing: 12) {
                if r.debit != 0 { Text("借方 \(NT.yen(r.debit))").foregroundColor(NT.purpleDeep) }
                if r.credit != 0 { Text("貸方 \(NT.yen(r.credit))").foregroundColor(NT.ink2) }
                Spacer(minLength: 4)
                if let href = r.originHref {
                    Button { nav.follow(href) } label: {
                        Label(r.originLabel ?? "元取引", systemImage: "arrow.up.right.square").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
                    }
                    .buttonStyle(.plain)
                }
            }
            .font(.system(size: 13, weight: .bold)).monospacedDigit()
        }
        .padding(12)
        .background(npocCard(14))
    }
}

// MARK: - 財務レポートの中身（GET view=statements）

struct NPACKpi: Decodable, Hashable {
    let cashBank: Int
    let receivable: Int
    let payable: Int
    let netIncome: Int
}

struct NPACTrialRow: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let opening: Int
    let debit: Int
    let credit: Int
    let closing: Int
}

struct NPACTrialTotals: Decodable, Hashable {
    let opening: Int
    let debit: Int
    let credit: Int
    let closing: Int
}

struct NPACTrialGroup: Decodable, Identifiable, Hashable {
    let category: String
    let label: String
    let rows: [NPACTrialRow]
    let subtotal: NPACTrialTotals
    var id: String { category }
}

struct NPACPlRow: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let balance: Int
}

struct NPACPl: Decodable, Hashable {
    let revenueTotal: Int
    let revenues: [NPACPlRow]
    let cogsTotal: Int
    let cogs: [NPACPlRow]
    let grossProfit: Int
    let laborTotal: Int
    let labor: [NPACPlRow]
    let opexTotal: Int
    let opex: [NPACPlRow]
    let operatingIncome: Int
}

struct NPACCompareRow: Decodable, Identifiable, Hashable {
    let label: String
    let emphasize: Bool
    let current: Int
    let prev: Int
    let lastYear: Int
    var id: String { label }
}

struct NPACCompare: Decodable, Hashable {
    let prevMonth: String
    let lastYear: String
    let rows: [NPACCompareRow]
}

struct NPACMonthlyRow: Decodable, Identifiable, Hashable {
    let label: String
    let emphasize: Bool
    let values: [Int]
    var id: String { label }
}

struct NPACMonthly: Decodable, Hashable {
    let months: [String]
    let rows: [NPACMonthlyRow]
}

struct NPACBs: Decodable, Hashable {
    let balanced: Bool
    let assetTotal: Int
    let liabilityTotal: Int
    let equityTotal: Int
    let netIncome: Int
    let liabilityEquityTotal: Int
    let diff: Int
    let assets: [NPACPlRow]
    let liabilities: [NPACPlRow]
    let equity: [NPACPlRow]
}

struct NPACStatementsFilters: Decodable, Hashable {
    let from: String
    let to: String
    let storeId: String
}

struct NPACStatementsPayload: Decodable {
    let stores: [NPACStore]
    let isHq: Bool
    let filters: NPACStatementsFilters
    let storeName: String?
    let kpi: NPACKpi
    let trialBalanced: Bool
    let debitGrandTotal: Int
    let creditGrandTotal: Int
    let trial: [NPACTrialGroup]
    let pl: NPACPl
    let compare: NPACCompare
    let monthly: NPACMonthly?
    let monthsOverLimit: Bool
    let bs: NPACBs
    let openingTo: String
    let exportPath: String
}

// MARK: - 財務レポート

struct NPACStatementsPage: View {
    let initial: [String: String]
    let nav: NPACNav

    @StateObject private var loader = NPACLoader<NPACStatementsPayload>()
    @State private var applied: [String: String] = [:]
    @State private var tab = "pl"
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "statements"
        await loader.load(full)
    }

    private func refilter(_ change: [String: String]) {
        guard let f = loader.data?.filters else { return }
        var q = ["from": f.from, "to": f.to, "store": f.storeId]
        for (k, v) in change { q[k] = v }
        let query = q
        Task { await load(query) }
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
    }

    private func content(_ p: NPACStatementsPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                NPACPeriodBar(from: p.filters.from, to: p.filters.to) { a, b in refilter(["from": a, "to": b]) }
                HStack(spacing: 8) {
                    if p.isHq {
                        NPOCMenuChip(label: "表示", options: [("", "全社（全店舗）")] + p.stores.map { ($0.id, $0.name) }, selection: p.filters.storeId) { refilter(["store": $0]) }
                    } else {
                        Text(p.storeName ?? "全社（全店舗）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                    }
                    Spacer()
                    NPACPill(title: "試算表CSV", icon: "square.and.arrow.up") {
                        NPACShare.csv(p.exportPath, name: "試算表_\(p.filters.from)_\(p.filters.to).csv") { loader.error = $0 }
                    }
                }
                if !p.bs.balanced {
                    NOMNote(text: "資産合計と負債・純資産合計が一致していません。仕訳データに異常があります。資産合計 \(NT.yen(p.bs.assetTotal)) ／ 負債・純資産合計 \(NT.yen(p.bs.liabilityEquityTotal))（差額 \(NT.yen(p.bs.diff))）", tint: NT.danger)
                }
                NPACTiles {
                    NOMStat(label: "現金・預金残高（期末）", value: NT.yen(p.kpi.cashBank))
                    NOMStat(label: "売掛金残高（期末）", value: NT.yen(p.kpi.receivable))
                    NOMStat(label: "買掛金・未払金（期末）", value: NT.yen(p.kpi.payable))
                    NOMStat(label: "当期純利益", value: NT.yen(p.kpi.netIncome), tone: p.kpi.netIncome >= 0 ? NT.ok : NT.danger)
                }
                .padding(12)
                .background(npocCard())
                Button { nav.open(.auto, [:]) } label: {
                    HStack(spacing: 6) {
                        Text("仕訳データはPOS売上・仕入・経費・給与から自動生成できます。").font(.system(size: 12.5)).foregroundColor(NT.ink)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Text("自動仕訳へ ›").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                Button { nav.leave("/app/settlement") } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "yensign.circle").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                        Text("月次清算（店ごとの売上・仕入・固定費・給料・赤字黒字）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .padding(12)
                    .background(npocCard(12))
                }
                .buttonStyle(PressableStyle())
                NOSSegment(items: [(key: "pl", label: "損益"), (key: "bs", label: "貸借"), (key: "trial", label: "試算表"), (key: "compare", label: "比較")], selection: tab) { tab = $0 }
                switch tab {
                case "bs": balanceSheet(p)
                case "trial": trial(p)
                case "compare": compare(p)
                default: profitLoss(p)
                }
                Text("残高・試算表は選択期間の確定仕訳から集計しています。期首残高は期間開始日より前の全確定仕訳の累計です。")
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 60)
        }
        .refreshable { await load(applied) }
    }

    // MARK: 損益計算書

    private func items(_ rows: [NPACPlRow]) -> some View {
        ForEach(rows) { r in NPACMoneyRow(label: r.name, value: r.balance, indent: 14) }
    }

    private func profitLoss(_ p: NPACStatementsPayload) -> some View {
        let pl = p.pl
        return NPOCard(title: "損益計算書（段階損益）", trailing: p.storeName ?? "全社") {
            Group {
                NPACMoneyRow(label: "売上高", value: pl.revenueTotal, bold: true)
                items(pl.revenues)
                NPACMoneyRow(label: "売上原価", value: pl.cogsTotal, bold: true)
                items(pl.cogs)
                NPACDivider()
                NPACMoneyRow(label: "売上総利益", value: pl.grossProfit, bold: true, tone: NT.purpleDeep)
            }
            Group {
                NPACMoneyRow(label: "人件費", value: pl.laborTotal, bold: true)
                items(pl.labor)
                NPACMoneyRow(label: "経費", value: pl.opexTotal, bold: true)
                items(pl.opex)
                NPACDivider()
                NPACMoneyRow(label: "営業利益（売上総利益－人件費－経費）", value: pl.operatingIncome, bold: true, tone: pl.operatingIncome >= 0 ? NT.ok : NT.danger)
            }
        }
    }

    // MARK: 貸借対照表

    private func balanceSheet(_ p: NPACStatementsPayload) -> some View {
        let bs = p.bs
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                NOSBadge(text: bs.balanced ? "貸借が一致しています" : "貸借が一致していません", color: bs.balanced ? NT.ok : NT.danger)
                Text("期末（\(NPACText.date(p.filters.to))時点）の累計残高").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            }
            NPOCard(title: "資産", trailing: NT.yen(bs.assetTotal)) {
                if bs.assets.isEmpty { Text("—").foregroundColor(NT.ink3) }
                items(bs.assets)
            }
            NPOCard(title: "負債・純資産", trailing: NT.yen(bs.liabilityEquityTotal)) {
                NPACMoneyRow(label: "負債", value: bs.liabilityTotal, bold: true)
                items(bs.liabilities)
                NPACMoneyRow(label: "純資産", value: bs.equityTotal, bold: true)
                items(bs.equity)
                NPACMoneyRow(label: "当期純利益", value: bs.netIncome, indent: 14)
                NPACDivider()
                NPACMoneyRow(label: "負債・純資産合計", value: bs.liabilityEquityTotal, bold: true)
            }
        }
    }

    // MARK: 試算表

    /// 試算表の科目 → 総勘定元帳（Web の金額のリンクと同じ）
    private func openLedger(_ accountId: String, _ from: String, _ to: String, _ p: NPACStatementsPayload) {
        var q = ["tab": "general", "account": accountId, "from": from, "to": to]
        if !p.filters.storeId.isEmpty { q["store"] = p.filters.storeId }
        nav.open(.ledger, q)
    }

    @ViewBuilder private func trial(_ p: NPACStatementsPayload) -> some View {
        HStack(spacing: 6) {
            NOSBadge(text: p.trialBalanced ? "期間内の借方・貸方は一致しています" : "貸借不一致 — データ異常です", color: p.trialBalanced ? NT.ok : NT.danger)
            Spacer(minLength: 0)
        }
        if p.trial.isEmpty {
            NPOCEmpty(icon: "tablecells", title: "この期間に確定した仕訳・期首残高がありません")
        } else {
            Text("行を押すと、その科目の総勘定元帳（期間の明細）を開きます。長押しで期首残高の明細も開けます。")
                .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
            ForEach(p.trial) { g in trialGroup(g, p) }
            VStack(spacing: 2) {
                NPACMoneyRow(label: "期間借方総計", value: p.debitGrandTotal, bold: true)
                NPACMoneyRow(label: "期間貸方総計", value: p.creditGrandTotal, bold: true, tone: p.trialBalanced ? NT.ink : NT.danger)
            }
            .padding(12)
            .background(npocCard(14))
        }
    }

    private func trialGroup(_ g: NPACTrialGroup, _ p: NPACStatementsPayload) -> some View {
        NPOCard(title: g.label, trailing: "期末 \(NT.yen(g.subtotal.closing))") {
            ForEach(g.rows) { r in
                Button { openLedger(r.id, p.filters.from, p.filters.to, p) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(r.code).font(.system(size: 11.5, weight: .semibold, design: .monospaced)).foregroundColor(NT.ink3)
                            Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(NT.yen(r.closing)).font(.system(size: 14.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                        }
                        HStack(spacing: 10) {
                            Text("期首 \(NT.yen(r.opening))")
                            Text("借 \(NT.yen(r.debit))")
                            Text("貸 \(NT.yen(r.credit))")
                        }
                        .font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button { openLedger(r.id, p.filters.from, p.filters.to, p) } label: { Label("期間の明細（総勘定元帳）", systemImage: "list.bullet") }
                    Button { openLedger(r.id, "1900-01-01", p.openingTo, p) } label: { Label("期首残高の明細", systemImage: "clock") }
                }
                NPACDivider()
            }
            HStack(spacing: 10) {
                Text("小計").font(.system(size: 12.5, weight: NT.strong)).foregroundColor(NT.ink2)
                Spacer(minLength: 4)
                Text("期首 \(NT.yen(g.subtotal.opening))・借 \(NT.yen(g.subtotal.debit))・貸 \(NT.yen(g.subtotal.credit))")
                    .font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            }
        }
    }

    // MARK: 期間比較・月別推移

    @ViewBuilder private func compare(_ p: NPACStatementsPayload) -> some View {
        NPOCard(title: "期間比較（月次）") {
            Text("当期の開始日（\(NPACText.date(p.filters.from))）が属する月を基準に、前月（\(p.compare.prevMonth)）・前年同月（\(p.compare.lastYear)）の実績を比較します。")
                .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Text("").frame(maxWidth: .infinity, alignment: .leading)
                Text("当期").frame(width: 88, alignment: .trailing)
                Text("前月").frame(width: 80, alignment: .trailing)
                Text("前年同月").frame(width: 80, alignment: .trailing)
            }
            .font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            ForEach(p.compare.rows) { r in
                HStack(spacing: 6) {
                    Text(r.label).font(.system(size: 12.5, weight: r.emphasize ? NT.strong : .regular)).foregroundColor(r.emphasize ? NT.ink : NT.ink2)
                        .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                    Text(NT.yen(r.current)).fontWeight(r.emphasize ? NT.strong : .semibold).frame(width: 88, alignment: .trailing)
                    Text(NT.yen(r.prev)).frame(width: 80, alignment: .trailing).foregroundColor(NT.ink2)
                    Text(NT.yen(r.lastYear)).frame(width: 80, alignment: .trailing).foregroundColor(NT.ink2)
                }
                .font(.system(size: 12)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                .padding(.vertical, 4)
                .background(r.emphasize ? NT.page : Color.clear)
            }
        }
        if let m = p.monthly {
            NPOCard(title: "月別推移", trailing: "横にスクロール") {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 8) {
                            Text("科目").frame(width: 92, alignment: .leading)
                            ForEach(m.months, id: \.self) { ym in Text(ym).frame(width: 92, alignment: .trailing) }
                        }
                        .font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                        .padding(.vertical, 6)
                        ForEach(m.rows) { r in
                            HStack(spacing: 8) {
                                Text(r.label).font(.system(size: 12, weight: r.emphasize ? NT.strong : .regular)).foregroundColor(r.emphasize ? NT.ink : NT.ink2)
                                    .lineLimit(2).frame(width: 92, alignment: .leading)
                                ForEach(Array(r.values.enumerated()), id: \.offset) { item in
                                    Text(NT.yen(item.element)).font(.system(size: 12, weight: r.emphasize ? NT.strong : .regular)).monospacedDigit()
                                        .lineLimit(1).minimumScaleFactor(0.7).frame(width: 92, alignment: .trailing)
                                }
                            }
                            .padding(.vertical, 5)
                            .background(r.emphasize ? NT.page : Color.clear)
                        }
                    }
                }
            }
        }
        if p.monthsOverLimit {
            Text("選択期間が12ヶ月を超えるため、月別推移の表示は省略しています（期間比較は表示しています）。")
                .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
    }
}
