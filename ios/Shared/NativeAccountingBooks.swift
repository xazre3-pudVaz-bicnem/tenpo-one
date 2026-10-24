import SwiftUI

// 会計 › 帳簿（Web の /app/accounting/ledger）・財務レポート（/app/accounting/statements）。中身は lib/accounting-pages-server.ts と同じ。
//   帳簿：仕訳帳・総勘定元帳・現金出納帳・預金出納帳・売掛帳・買掛帳（期間・店舗・科目）・CSV出力・元取引へ
//   財務レポート：残高のタイル・試算表（期首残高つき。行を押すと総勘定元帳へ）・損益計算書（期間比較・月別推移）・貸借対照表・試算表CSV

// MARK: - 帳簿のデータ（GET view=ledger）

struct NAccTab: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct NAccEmptyInfo: Decodable, Hashable {
    let title: String
    let description: String
}

struct NAccBookJournalLine: Decodable, Hashable {
    let accountCode: String
    let accountName: String
    let side: String
    let amount: Int
    let taxLabel: String
    let memo: String?
}

struct NAccBookJournalEntry: Decodable, Identifiable, Hashable {
    let id: String
    let entryNo: Int
    let entryDate: String
    let description: String
    let debitTotal: Int
    let lines: [NAccBookJournalLine]
}

struct NAccLedgerRow: Decodable, Identifiable, Hashable {
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

struct NAccLedgerBook: Decodable, Hashable {
    let accountId: String
    let accountCode: String
    let accountName: String
    let opening: Int
    let rows: [NAccLedgerRow]
}

struct NAccLedgerFilters: Decodable, Hashable {
    let tab: String
    let from: String
    let to: String
    let storeId: String
    let accountId: String?
}

struct NAccLedgerPayload: Decodable {
    let stores: [NAccStore]
    let isHq: Bool
    let filters: NAccLedgerFilters
    let tabs: [NAccTab]
    let candidateAccounts: [NAccAccountRef]
    let empty: NAccEmptyInfo?
    let journal: [NAccBookJournalEntry]?
    let ledger: NAccLedgerBook?
    let exportPath: String
}

// MARK: - 帳簿

struct NAccLedgerPage: View {
    let initial: [String: String]
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccLedgerPayload>()
    @State private var applied: [String: String] = [:]
    @State private var from = ""
    @State private var to = ""
    @State private var store = ""
    @State private var account = ""
    @State private var expanded: Set<String> = []
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "ledger"
        await loader.load(full)
        if let f = loader.data?.filters {
            from = f.from; to = f.to; store = f.storeId; account = f.accountId ?? ""
        }
    }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NAccHeader(title: "帳簿", subtitle: "仕訳帳・総勘定元帳・現金出納帳などの補助簿を確認します") {
                            NAccButton(text: "CSV出力", icon: "square.and.arrow.down") {
                                NAccExport.csv(p.exportPath, name: "帳簿_\(p.filters.tab)_\(p.filters.from)_\(p.filters.to).csv") { loader.error = $0 }
                            }
                        }
                        tabs(p)
                        filters(p)
                        content(p)
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

    private func tabs(_ p: NAccLedgerPayload) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(p.tabs) { t in
                    // Web のタブと同じく、タブを変えると期間・科目は最初に戻る
                    Button { Task { await load(["tab": t.key]) } } label: {
                        VStack(spacing: 6) {
                            Text(t.label).font(.system(size: 14.5, weight: .bold)).foregroundColor(p.filters.tab == t.key ? NT.purpleDeep : NT.ink2)
                            Rectangle().fill(p.filters.tab == t.key ? NT.purple : Color.clear).frame(height: 2.5)
                        }
                        .padding(.horizontal, 12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private func filters(_ p: NAccLedgerPayload) -> some View {
        NAccFilterBar {
            NAccField(label: "開始日") { NAccDate(value: $from) }
            NAccField(label: "終了日") { NAccDate(value: $to) }
            if p.isHq {
                NAccField(label: "店舗") {
                    NAccMenu(options: [NAccOption(value: "", label: "全店舗")] + p.stores.map { NAccOption(value: $0.id, label: $0.name) }, selection: $store)
                }
            }
            if p.filters.tab != "journal" && !p.candidateAccounts.isEmpty {
                NAccField(label: "科目") {
                    NAccMenu(options: p.candidateAccounts.map { NAccOption(value: $0.id, label: "\($0.code) \($0.name)") }, selection: $account)
                }
            }
            NAccButton(text: "絞り込む", icon: "line.3.horizontal.decrease", kind: .primary, busy: loader.loading) {
                var q = ["tab": p.filters.tab, "from": from, "to": to, "store": store]
                if p.filters.tab != "journal" { q["account"] = account }
                let query = q
                Task { await load(query) }
            }
        }
    }

    @ViewBuilder private func content(_ p: NAccLedgerPayload) -> some View {
        if let journal = p.journal {
            NAccCard {
                if journal.isEmpty {
                    NAccEmptyView(title: "該当する仕訳がありません", message: "期間や店舗の条件を変更してください")
                } else {
                    VStack(spacing: 0) {
                        ForEach(journal) { e in journalRow(e) }
                    }
                }
            }
        } else if let book = p.ledger {
            ledgerTable(book)
        } else if let empty = p.empty {
            NAccCard { NAccEmptyView(title: empty.title, message: empty.description) }
        }
    }

    private func journalRow(_ e: NAccBookJournalEntry) -> some View {
        let open = expanded.contains(e.id)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                if open { expanded.remove(e.id) } else { expanded.insert(e.id) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).frame(width: 14)
                    Text("#\(e.entryNo)").font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundColor(NT.ink3)
                    Text(NAccText.date(e.entryDate)).font(.system(size: 12.5)).monospacedDigit().foregroundColor(NT.ink2)
                    Text(e.description).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(NT.yen(e.debitTotal)).font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NT.ink2)
                }
                .padding(.horizontal, 14).padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
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
                .padding(.leading, 28)
                .background(NT.page)
            }
            Rectangle().fill(NT.line).frame(height: 1)
        }
    }

    private func ledgerTable(_ book: NAccLedgerBook) -> some View {
        NAccCard(title: "\(book.accountCode) \(book.accountName)") {
            VStack(spacing: 0) {
                NAccTableHead(cells: [
                    ("日付", 92, false), ("摘要", nil, false), ("相手科目", 130, false), ("入金・借方", 110, true),
                    ("出金・貸方", 110, true), ("残高", 120, true), ("店舗", 100, false), ("元取引", 130, false),
                ])
                HStack(spacing: 10) {
                    NAccCell(text: "繰越残高", bold: true, color: NT.ink2)
                    NAccCell(text: NT.yen(book.opening), width: 120, trailing: true, bold: true)
                    Color.clear.frame(width: 100 + 130 + 10, height: 1)
                }
                .padding(.horizontal, 14).frame(minHeight: 38)
                .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                if book.rows.isEmpty {
                    Text("期間内の明細はありません").font(.system(size: 13)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).padding(.vertical, 18)
                } else {
                    ForEach(book.rows) { r in
                        HStack(spacing: 10) {
                            NAccCell(text: NAccText.date(r.date), width: 92, color: NT.ink2, size: 12.5)
                            NAccCell(text: r.description)
                            NAccCell(text: r.counter, width: 130, color: NT.ink2, size: 13)
                            NAccCell(text: r.debit > 0 ? NT.yen(r.debit) : "", width: 110, trailing: true)
                            NAccCell(text: r.credit > 0 ? NT.yen(r.credit) : "", width: 110, trailing: true)
                            NAccCell(text: NT.yen(r.balance), width: 120, trailing: true, bold: true)
                            NAccCell(text: r.storeName ?? "全社", width: 100, color: NT.ink3, size: 12.5)
                            Group {
                                if let href = r.originHref {
                                    Button { nav.follow(href) } label: {
                                        Text(r.originLabel ?? "元取引を見る").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purple).lineLimit(1)
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    Text("—").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                                }
                            }
                            .frame(width: 130, alignment: .leading)
                        }
                        .padding(.horizontal, 14).frame(minHeight: 38)
                        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                    }
                }
            }
        }
    }
}

// MARK: - 財務レポートのデータ（GET view=statements）

struct NAccKpi: Decodable, Hashable {
    let cashBank: Int
    let receivable: Int
    let payable: Int
    let netIncome: Int
}

struct NAccTrialRow: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let opening: Int
    let debit: Int
    let credit: Int
    let closing: Int
}

struct NAccTrialTotals: Decodable, Hashable {
    let opening: Int
    let debit: Int
    let credit: Int
    let closing: Int
}

struct NAccTrialGroup: Decodable, Identifiable, Hashable {
    let category: String
    let label: String
    let rows: [NAccTrialRow]
    let subtotal: NAccTrialTotals
    var id: String { category }
}

struct NAccPlRow: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let balance: Int
}

struct NAccPl: Decodable, Hashable {
    let revenueTotal: Int
    let revenues: [NAccPlRow]
    let cogsTotal: Int
    let cogs: [NAccPlRow]
    let grossProfit: Int
    let laborTotal: Int
    let labor: [NAccPlRow]
    let opexTotal: Int
    let opex: [NAccPlRow]
    let operatingIncome: Int
}

struct NAccCompareRow: Decodable, Identifiable, Hashable {
    let label: String
    let emphasize: Bool
    let current: Int
    let prev: Int
    let lastYear: Int
    var id: String { label }
}

struct NAccCompare: Decodable, Hashable {
    let prevMonth: String
    let lastYear: String
    let rows: [NAccCompareRow]
}

struct NAccMonthlyRow: Decodable, Identifiable, Hashable {
    let label: String
    let emphasize: Bool
    let values: [Int]
    var id: String { label }
}

struct NAccMonthly: Decodable, Hashable {
    let months: [String]
    let rows: [NAccMonthlyRow]
}

struct NAccBs: Decodable, Hashable {
    let balanced: Bool
    let assetTotal: Int
    let liabilityTotal: Int
    let equityTotal: Int
    let netIncome: Int
    let liabilityEquityTotal: Int
    let diff: Int
    let assets: [NAccPlRow]
    let liabilities: [NAccPlRow]
    let equity: [NAccPlRow]
}

struct NAccStatementsFilters: Decodable, Hashable {
    let from: String
    let to: String
    let storeId: String
}

struct NAccStatementsPayload: Decodable {
    let stores: [NAccStore]
    let isHq: Bool
    let filters: NAccStatementsFilters
    let storeName: String?
    let kpi: NAccKpi
    let trialBalanced: Bool
    let debitGrandTotal: Int
    let creditGrandTotal: Int
    let trial: [NAccTrialGroup]
    let pl: NAccPl
    let compare: NAccCompare
    let monthly: NAccMonthly?
    let monthsOverLimit: Bool
    let bs: NAccBs
    let openingTo: String
    let exportPath: String
}

// MARK: - 財務レポート

struct NAccStatementsPage: View {
    let initial: [String: String]
    let nav: NAccNav

    @StateObject private var loader = NAccLoader<NAccStatementsPayload>()
    @State private var applied: [String: String] = [:]
    @State private var from = ""
    @State private var to = ""
    @State private var store = ""
    @State private var started = false

    private func load(_ q: [String: String]) async {
        applied = q
        var full = q
        full["view"] = "statements"
        await loader.load(full)
        if let f = loader.data?.filters {
            from = f.from; to = f.to; store = f.storeId
        }
    }

    var body: some View {
        Group {
            if let p = loader.data {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NAccHeader(title: "財務レポート", subtitle: "確定済み仕訳から試算表・損益計算書・貸借対照表を自動集計します") {
                            NAccButton(text: "試算表CSV出力", icon: "square.and.arrow.down") {
                                NAccExport.csv(p.exportPath, name: "試算表_\(p.filters.from)_\(p.filters.to).csv") { loader.error = $0 }
                            }
                        }
                        filters(p)
                        if !p.bs.balanced {
                            NAccNotice(
                                text: "資産合計と負債・純資産合計が一致していません。仕訳データに異常があります。資産合計 \(NT.yen(p.bs.assetTotal)) ／ 負債・純資産合計 \(NT.yen(p.bs.liabilityEquityTotal))（差額 \(NT.yen(p.bs.diff))）",
                                color: NFColor.danger
                            )
                        }
                        HStack(spacing: 12) {
                            NAccStat(label: "現金・預金残高（期末）", value: p.kpi.cashBank)
                            NAccStat(label: "売掛金残高（期末）", value: p.kpi.receivable)
                            NAccStat(label: "買掛金・未払金残高（期末）", value: p.kpi.payable)
                            NAccStat(label: "当期純利益", value: p.kpi.netIncome, tone: p.kpi.netIncome >= 0 ? NFColor.success : NFColor.danger)
                        }
                        Button { nav.open(.auto, [:]) } label: {
                            HStack(spacing: 6) {
                                Text("仕訳データはPOS売上・仕入・経費・給与から自動生成できます。").font(.system(size: 13.5)).foregroundColor(NT.ink)
                                Text("自動仕訳ページへ ›").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.purple)
                                Spacer()
                            }
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                        }
                        .buttonStyle(.plain)
                        trial(p)
                        profitLoss(p)
                        balanceSheet(p)
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

    private func filters(_ p: NAccStatementsPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NAccFilterBar {
                NAccField(label: "開始日") { NAccDate(value: $from) }
                NAccField(label: "終了日") { NAccDate(value: $to) }
                if p.isHq {
                    NAccField(label: "店舗") {
                        NAccMenu(options: [NAccOption(value: "", label: "全社（全店舗）")] + p.stores.map { NAccOption(value: $0.id, label: $0.name) }, selection: $store)
                    }
                }
                NAccButton(text: "集計する", icon: "sum", kind: .primary, busy: loader.loading) {
                    let q = ["from": from, "to": to, "store": store]
                    Task { await load(q) }
                }
            }
            Text("残高・試算表は選択期間の確定仕訳から集計しています。期首残高は期間開始日より前の全確定仕訳の累計です。")
                .font(.system(size: 12)).foregroundColor(NT.ink3)
        }
    }

    /// 試算表の科目 → 総勘定元帳（Web の金額のリンクと同じ）
    private func openLedger(_ accountId: String, _ rangeFrom: String, _ rangeTo: String, _ p: NAccStatementsPayload) {
        var q = ["tab": "general", "account": accountId, "from": rangeFrom, "to": rangeTo]
        if !p.filters.storeId.isEmpty { q["store"] = p.filters.storeId }
        nav.open(.ledger, q)
    }

    private func trial(_ p: NAccStatementsPayload) -> some View {
        NAccCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("試算表（期首残高対応）").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    Spacer()
                    NPBadge(text: p.trialBalanced ? "期間内の借方・貸方は一致しています" : "貸借不一致 — データ異常です", color: p.trialBalanced ? NFColor.success : NFColor.danger)
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                Rectangle().fill(NT.line).frame(height: 1)
                if p.trial.isEmpty {
                    Text("この期間に確定した仕訳・期首残高がありません").font(.system(size: 13)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).padding(.vertical, 24)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("行を押すと、その科目の総勘定元帳（期間の明細）を開きます。長押しで期首残高の明細も開けます。").font(.system(size: 12)).foregroundColor(NT.ink3)
                        ForEach(p.trial) { g in trialGroup(g, p) }
                        HStack(spacing: 20) {
                            Spacer()
                            Text("期間借方総計: ").font(.system(size: 13)).foregroundColor(NT.ink3) + Text(NT.yen(p.debitGrandTotal)).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                            Text("期間貸方総計: ").font(.system(size: 13)).foregroundColor(NT.ink3) + Text(NT.yen(p.creditGrandTotal)).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                        }
                        .monospacedDigit()
                    }
                    .padding(16)
                }
            }
        }
    }

    private func trialGroup(_ g: NAccTrialGroup, _ p: NAccStatementsPayload) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(g.label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            VStack(spacing: 0) {
                NAccTableHead(cells: [("コード", 64, false), ("科目", nil, false), ("期首残高", 120, true), ("借方計", 120, true), ("貸方計", 120, true), ("期末残高", 120, true)])
                ForEach(g.rows) { r in
                    Button { openLedger(r.id, p.filters.from, p.filters.to, p) } label: {
                        HStack(spacing: 10) {
                            NAccCell(text: r.code, width: 64, color: NT.ink2, size: 12.5)
                            NAccCell(text: r.name, bold: true)
                            NAccCell(text: NT.yen(r.opening), width: 120, trailing: true)
                            NAccCell(text: NT.yen(r.debit), width: 120, trailing: true)
                            NAccCell(text: NT.yen(r.credit), width: 120, trailing: true)
                            NAccCell(text: NT.yen(r.closing), width: 120, trailing: true, bold: true)
                        }
                        .padding(.horizontal, 14).frame(minHeight: 38)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { openLedger(r.id, p.filters.from, p.filters.to, p) } label: { Label("期間の明細（総勘定元帳）", systemImage: "list.bullet") }
                        Button { openLedger(r.id, "1900-01-01", p.openingTo, p) } label: { Label("期首残高の明細", systemImage: "clock") }
                    }
                    .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                }
                HStack(spacing: 10) {
                    NAccCell(text: "\(g.label) 小計", bold: true)
                    NAccCell(text: NT.yen(g.subtotal.opening), width: 120, trailing: true, bold: true)
                    NAccCell(text: NT.yen(g.subtotal.debit), width: 120, trailing: true, bold: true)
                    NAccCell(text: NT.yen(g.subtotal.credit), width: 120, trailing: true, bold: true)
                    NAccCell(text: NT.yen(g.subtotal.closing), width: 120, trailing: true, bold: true)
                }
                .padding(.horizontal, 14).frame(minHeight: 38)
                .background(NT.page)
            }
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    // MARK: 損益計算書

    private func plHead(_ label: String, _ value: Int) -> some View {
        HStack {
            Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            Spacer()
            Text(NT.yen(value)).font(.system(size: 14, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
        }
        .padding(.horizontal, 14).frame(minHeight: 36)
        .background(NT.page)
    }

    private func plItems(_ rows: [NAccPlRow]) -> some View {
        ForEach(rows) { r in
            HStack {
                Text(r.name).font(.system(size: 13.5)).foregroundColor(NT.ink2)
                Spacer()
                Text(NT.yen(r.balance)).font(.system(size: 13.5)).monospacedDigit().foregroundColor(NT.ink)
            }
            .padding(.leading, 34).padding(.trailing, 14).frame(minHeight: 32)
            .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
        }
    }

    private func plTotal(_ label: String, _ value: Int, tone: Color = NT.ink) -> some View {
        HStack {
            Text(label).font(.system(size: 14.5, weight: .heavy)).foregroundColor(NT.ink)
            Spacer()
            Text(NT.yen(value)).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(tone)
        }
        .padding(.horizontal, 14).frame(minHeight: 40)
        .overlay(alignment: .top) { Rectangle().fill(NT.ink.opacity(0.12)).frame(height: 2) }
    }

    private func profitLoss(_ p: NAccStatementsPayload) -> some View {
        NAccCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("損益計算書（段階損益）").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    Spacer()
                    NPBadge(text: "表示範囲: \(p.storeName ?? "全社（全店舗）")", color: NT.ink3)
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                Rectangle().fill(NT.line).frame(height: 1)
                VStack(alignment: .leading, spacing: 18) {
                    VStack(spacing: 0) {
                        plHead("売上高", p.pl.revenueTotal)
                        plItems(p.pl.revenues)
                        plHead("売上原価", p.pl.cogsTotal)
                        plItems(p.pl.cogs)
                        plTotal("売上総利益", p.pl.grossProfit)
                        plHead("人件費", p.pl.laborTotal)
                        plItems(p.pl.labor)
                        plHead("経費", p.pl.opexTotal)
                        plItems(p.pl.opex)
                        plTotal("営業利益（売上総利益－人件費－経費）", p.pl.operatingIncome, tone: p.pl.operatingIncome >= 0 ? NFColor.success : NFColor.danger)
                    }
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 6) {
                        Text("期間比較（月次）").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                        Text("当期の開始日（\(p.filters.from)）が属する月を基準に、前月（\(p.compare.prevMonth)）・前年同月（\(p.compare.lastYear)）の実績を比較します。")
                            .font(.system(size: 12)).foregroundColor(NT.ink3)
                        VStack(spacing: 0) {
                            NAccTableHead(cells: [("科目", nil, false), ("当期", 130, true), ("前月", 130, true), ("前年同月", 130, true)])
                            ForEach(p.compare.rows) { r in
                                HStack(spacing: 10) {
                                    NAccCell(text: r.label, bold: r.emphasize, color: r.emphasize ? NT.ink : NT.ink2)
                                    NAccCell(text: NT.yen(r.current), width: 130, trailing: true, bold: r.emphasize)
                                    NAccCell(text: NT.yen(r.prev), width: 130, trailing: true, bold: r.emphasize)
                                    NAccCell(text: NT.yen(r.lastYear), width: 130, trailing: true, bold: r.emphasize)
                                }
                                .padding(.horizontal, 14).frame(minHeight: 34)
                                .background(r.emphasize ? NT.page : Color.clear)
                                .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                            }
                        }
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }

                    if let m = p.monthly {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("月別推移").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                            ScrollView(.horizontal, showsIndicators: true) {
                                VStack(spacing: 0) {
                                    HStack(spacing: 10) {
                                        NAccCell(text: "科目", width: 110, bold: true, color: NT.ink3, size: 12)
                                        ForEach(m.months, id: \.self) { ym in NAccCell(text: ym, width: 110, trailing: true, bold: true, color: NT.ink3, size: 12) }
                                    }
                                    .padding(.horizontal, 14).frame(height: 34)
                                    .background(NT.page.opacity(0.7))
                                    ForEach(m.rows) { r in
                                        HStack(spacing: 10) {
                                            NAccCell(text: r.label, width: 110, bold: r.emphasize, color: r.emphasize ? NT.ink : NT.ink2)
                                            ForEach(Array(r.values.enumerated()), id: \.offset) { item in
                                                NAccCell(text: NT.yen(item.element), width: 110, trailing: true, bold: r.emphasize)
                                            }
                                        }
                                        .padding(.horizontal, 14).frame(minHeight: 34)
                                        .background(r.emphasize ? NT.page : Color.clear)
                                        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                                    }
                                }
                            }
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                    if p.monthsOverLimit {
                        Text("選択期間が12ヶ月を超えるため、月別推移の表示は省略しています（期間比較は表示しています）。").font(.system(size: 12)).foregroundColor(NT.ink3)
                    }
                }
                .padding(16)
            }
        }
    }

    // MARK: 貸借対照表

    private func balanceSheet(_ p: NAccStatementsPayload) -> some View {
        NAccCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("貸借対照表").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    Spacer()
                    NPBadge(text: p.bs.balanced ? "貸借が一致しています" : "貸借が一致していません", color: p.bs.balanced ? NFColor.success : NFColor.danger)
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                Rectangle().fill(NT.line).frame(height: 1)
                VStack(alignment: .leading, spacing: 10) {
                    Text("資産・負債・純資産は期末（\(p.filters.to)時点）の累計残高です。").font(.system(size: 12)).foregroundColor(NT.ink3)
                    HStack(alignment: .top, spacing: 14) {
                        VStack(spacing: 0) {
                            plHead("資産", p.bs.assetTotal)
                            plItems(p.bs.assets)
                        }
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .frame(maxWidth: .infinity)
                        VStack(spacing: 0) {
                            plHead("負債", p.bs.liabilityTotal)
                            plItems(p.bs.liabilities)
                            plHead("純資産", p.bs.equityTotal)
                            plItems(p.bs.equity)
                            HStack {
                                Text("当期純利益").font(.system(size: 13.5)).foregroundColor(NT.ink2)
                                Spacer()
                                Text(NT.yen(p.bs.netIncome)).font(.system(size: 13.5)).monospacedDigit().foregroundColor(NT.ink)
                            }
                            .padding(.leading, 34).padding(.trailing, 14).frame(minHeight: 32)
                            plTotal("負債・純資産合計", p.bs.liabilityEquityTotal)
                        }
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
            }
        }
    }
}
