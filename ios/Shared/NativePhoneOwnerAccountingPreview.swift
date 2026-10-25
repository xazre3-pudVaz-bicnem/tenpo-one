import SwiftUI

// iPhone の店長・オーナー：会計・請求書・照合・月次清算の見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）。
//   -tenpoNativePreview phoneOwnerAccounting（会計：仕訳。上の切り替えで帳簿・財務レポート・銀行口座・自動仕訳・固定資産・月次締めも見本で開く）
//                       phoneOwnerInvoices（請求書・書類）| phoneOwnerReconciliation（照合）| phoneOwnerSettlement（月次清算・1店舗）
// 名前・店舗・銀行・取引先はすべて作りもの（実在の人・お店・会社ではない）。中身はサーバーと同じ形の辞書から作る（NOS.decode）。
// 各画面の読み込みは見本のとき NPACSamples.object(part, query) を読む（通信しない）。

struct NativePhoneOwnerAccountingPreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "phoneOwnerInvoices":
            NPIVRootView(route: route("/app/invoices"), onBack: {}, onLeave: { _ in })
        case "phoneOwnerReconciliation":
            NPRXRootView(route: route("/app/reconciliation"), onBack: {}, onLeave: { _ in })
        case "phoneOwnerSettlement":
            NPSMRootView(route: route("/app/settlement"), onBack: {}, onLeave: { _ in })
        default:
            NPACRootView(route: route("/app/accounting"), onBack: {}, onLeave: { _ in })
        }
    }

    private func route(_ path: String) -> NativeModuleRoute {
        NativeModuleRoute(key: "preview", url: AppConfig.url(path))
    }
}

/// 見本の中身（サーバーの返事と同じ形の辞書）
enum NPACSamples {
    static let shinjuku = "TENPO ONE 新宿店"
    static let shibuya = "TENPO ONE 渋谷店"

    static func id(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }
    static func day(_ offset: Int) -> String { NOS.addDays(NOS.today, offset) }
    static func opt(_ value: String, _ label: String) -> [String: Any] { ["value": value, "label": label] }

    static var stores: [[String: Any]] { [["id": id(1), "name": shinjuku], ["id": id(2), "name": shibuya]] }

    /// part・query → 見本（無ければ nil）
    static func object(_ part: String, _ query: [String: String]) -> Any? {
        switch part {
        case "accounting":
            switch query["view"] ?? "journal" {
            case "journal": return journal(query)
            case "periods": return periods(query)
            case "ledger": return ledger(query)
            case "statements": return statements(query)
            case "banks": return banks()
            case "bank": return bank()
            case "auto": return auto(query)
            case "autoCandidates": return candidates(query["source"] ?? "pos_sales")
            case "assets": return assets()
            default: return nil
            }
        case "invoices":
            if let inv = query["invoice"] { return ["ok": true, "view": "detail", "detail": invoiceDetail(inv)] }
            return invoices(query)
        case "reconciliation": return reconciliation(query)
        case "settlement": return settlement(query)
        default: return nil
        }
    }

    // MARK: 勘定科目

    static let accountList: [(Int, String, String, String)] = [
        (101, "100", "現金", "out_of_scope"),
        (102, "110", "普通預金", "out_of_scope"),
        (103, "130", "売掛金", "out_of_scope"),
        (104, "300", "買掛金", "out_of_scope"),
        (105, "310", "未払金", "out_of_scope"),
        (106, "400", "売上高", "taxable_standard"),
        (107, "500", "仕入高", "taxable_reduced"),
        (108, "520", "給与手当", "out_of_scope"),
        (109, "540", "地代家賃", "taxable_standard"),
        (110, "550", "水道光熱費", "taxable_standard"),
        (111, "560", "消耗品費", "taxable_standard"),
        (112, "599", "雑費", "taxable_standard"),
    ]

    static var accounts: [[String: Any]] {
        accountList.map { ["id": id($0.0), "code": $0.1, "name": $0.2, "defaultTaxTreatment": $0.3] }
    }

    static var accountRefs: [[String: Any]] {
        accountList.map { ["id": id($0.0), "code": $0.1, "name": $0.2] }
    }

    static func line(_ acc: Int, _ side: String, _ amount: Int, memo: String? = nil) -> [String: Any] {
        let a = accountList.first { $0.0 == acc } ?? accountList[0]
        let tax: [String: String] = ["out_of_scope": "対象外", "taxable_standard": "課税（標準）", "taxable_reduced": "課税（軽減）"]
        var d: [String: Any] = ["accountId": id(a.0), "accountCode": a.1, "accountName": a.2, "side": side, "amount": amount,
                                "taxTreatment": a.3, "taxLabel": tax[a.3] ?? "対象外"]
        if let memo { d["memo"] = memo }
        return d
    }

    // MARK: 仕訳

    static func entry(_ n: Int, no: Int, day d: Int, desc: String, status: String, source: String, sourceLabel: String,
                      store: Int?, lines: [[String: Any]], origin: (String, String)? = nil, voidReason: String? = nil) -> [String: Any] {
        let statusLabel = ["draft": "下書き", "posted": "確定", "voided": "取消"][status] ?? status
        let debit = lines.filter { ($0["side"] as? String) == "debit" }.reduce(0) { $0 + (($1["amount"] as? Int) ?? 0) }
        var e: [String: Any] = ["id": id(n), "entryNo": no, "entryDate": day(d), "description": desc, "status": status, "statusLabel": statusLabel,
                                "sourceType": source, "sourceLabel": sourceLabel, "debitTotal": debit, "lines": lines]
        if let store {
            e["storeId"] = id(store)
            e["storeName"] = store == 1 ? shinjuku : shibuya
        }
        if let origin {
            e["originHref"] = origin.0
            e["originLabel"] = origin.1
            e["sourceId"] = id(n + 500)
        }
        if let voidReason { e["voidReason"] = voidReason }
        return e
    }

    static func journal(_ q: [String: String]) -> [String: Any] {
        let today = NOS.today
        let from = (q["from"] ?? "").isEmpty ? NOS.monthFirst(today) : (q["from"] ?? "")
        let to = (q["to"] ?? "").isEmpty ? today : (q["to"] ?? "")
        let status = q["status"] ?? ""
        let all: [[String: Any]] = [
            entry(201, no: 128, day: 0, desc: "本日の売上（\(shinjuku)）", status: "draft", source: "pos_sales", sourceLabel: "売上", store: 1,
                  lines: [line(101, "debit", 186_400), line(103, "debit", 92_300), line(106, "credit", 278_700)], origin: ("/app/orders", "売上を見る")),
            entry(202, no: 127, day: -1, desc: "みどり青果 10月分 請求書", status: "posted", source: "purchase", sourceLabel: "仕入", store: 1,
                  lines: [line(107, "debit", 54_000, memo: "野菜・果物"), line(104, "credit", 54_000)], origin: ("/app/invoices", "請求書を見る")),
            entry(203, no: 126, day: -2, desc: "10月分 家賃", status: "posted", source: "manual", sourceLabel: "手動", store: 2,
                  lines: [line(109, "debit", 330_000), line(102, "credit", 330_000)]),
            entry(204, no: 125, day: -3, desc: "厨房用洗剤・ゴミ袋", status: "posted", source: "petty_cash", sourceLabel: "小口現金", store: 1,
                  lines: [line(111, "debit", 3_680), line(101, "credit", 3_680)], origin: ("/app/cash?tab=petty", "小口現金を見る")),
            entry(205, no: 124, day: -5, desc: "電気料金（重複入力）", status: "voided", source: "manual", sourceLabel: "手動", store: 2,
                  lines: [line(110, "debit", 48_200), line(102, "credit", 48_200)], voidReason: "二重に入力したため"),
        ]
        let entries = status.isEmpty ? all : all.filter { ($0["status"] as? String) == status }
        return [
            "ok": true, "view": "journal", "stores": stores, "isHq": true, "canWrite": true, "canReopen": true, "today": today,
            "filters": ["from": from, "to": to, "status": status, "sourceType": q["source_type"] ?? "", "sourceId": q["source_id"] ?? "", "storeId": q["store"] ?? "", "page": 1],
            "statusOptions": [opt("draft", "下書き"), opt("posted", "確定"), opt("voided", "取消")],
            "sourceTypeOptions": [opt("manual", "手動"), opt("pos_sales", "売上"), opt("pos_refund", "返金"), opt("purchase", "仕入"), opt("expense", "経費"),
                                  opt("petty_cash", "小口現金"), opt("payroll", "給与"), opt("bank", "銀行"), opt("correction", "修正")],
            "taxOptions": [opt("taxable_standard", "課税（標準）"), opt("taxable_reduced", "課税（軽減）"), opt("non_taxable", "非課税"), opt("tax_exempt", "免税"), opt("out_of_scope", "対象外")],
            "accounts": accounts,
            "entries": entries, "count": entries.count, "pageSize": 50, "totalPages": 1, "rangeFrom": 0,
            "exportPath": "/app/accounting/export?from=\(from)&to=\(to)",
        ]
    }

    // MARK: 月次締め

    static func periods(_ q: [String: String]) -> [String: Any] {
        let this = String(NOS.today.prefix(7))
        let month = q["month"].flatMap { NOS.isMonth($0) ? $0 : nil } ?? this
        let overview: [[String: Any]] = (0..<12).map { i in
            let m = NOS.shiftMonth(this, -i)
            let closed = i >= 1
            var r: [String: Any] = ["month": m, "label": NOS.ymLabel(m), "status": closed ? "closed" : "open", "statusLabel": closed ? "締め済み" : "未締め",
                                    "draftCount": i == 0 ? 1 : 0]
            if closed {
                r["closedAtLabel"] = "\(NOS.ymLabel(NOS.shiftMonth(m, 1)))5日 18:30"
                r["closedByName"] = "山田 太郎"
            }
            return r
        }
        let selected = overview.first { ($0["month"] as? String) == month } ?? overview[0]
        let closed = (selected["status"] as? String) == "closed"
        return [
            "ok": true, "canReopen": true, "month": month, "monthLabel": NOS.ymLabel(month),
            "status": closed ? "closed" : "open", "statusLabel": closed ? "締め済み" : "未締め",
            "draftCount": closed ? 0 : 1, "justReopened": false,
            "draftFilter": ["from": month + "-01", "to": NOS.monthLast(month + "-01")],
            "overview": overview,
            "history": closed ? [["id": id(301), "isClose": true, "label": "締め", "createdAtLabel": "\(NOS.ymLabel(NOS.shiftMonth(month, 1)))5日 18:30", "actorName": "山田 太郎"]] as [[String: Any]] : [],
        ]
    }

    // MARK: 帳簿

    static func ledger(_ q: [String: String]) -> [String: Any] {
        let tab = (q["tab"] ?? "").isEmpty ? "journal" : (q["tab"] ?? "journal")
        let today = NOS.today
        let from = (q["from"] ?? "").isEmpty ? NOS.monthFirst(today) : (q["from"] ?? "")
        let to = (q["to"] ?? "").isEmpty ? today : (q["to"] ?? "")
        let tabs: [[String: Any]] = [["key": "journal", "label": "仕訳帳"], ["key": "general", "label": "総勘定元帳"], ["key": "cash", "label": "現金出納帳"],
                                     ["key": "bank", "label": "預金出納帳"], ["key": "receivable", "label": "売掛帳"], ["key": "payable", "label": "買掛帳"]]
        var d: [String: Any] = [
            "ok": true, "stores": stores, "isHq": true, "tabs": tabs, "candidateAccounts": accountRefs,
            "exportPath": "/app/accounting/ledger/export?tab=\(tab)",
        ]
        if tab == "journal" {
            d["filters"] = ["tab": tab, "from": from, "to": to, "storeId": q["store"] ?? ""]
            let entries = (journal([:])["entries"] as? [[String: Any]]) ?? []
            d["journal"] = entries.filter { ($0["status"] as? String) == "posted" }.map { e -> [String: Any] in
                ["id": e["id"] ?? "", "entryNo": e["entryNo"] ?? 0, "entryDate": e["entryDate"] ?? "", "description": e["description"] ?? "",
                 "debitTotal": e["debitTotal"] ?? 0, "lines": e["lines"] ?? []]
            }
        } else {
            let accountId = q["account"] ?? id(101)
            d["filters"] = ["tab": tab, "from": from, "to": to, "storeId": q["store"] ?? "", "accountId": accountId]
            let rows: [[String: Any]] = [
                ["id": "r1", "date": day(-6), "description": "釣銭補充", "counter": "普通預金", "debit": 20_000, "credit": 0, "balance": 70_000, "storeName": shinjuku],
                ["id": "r2", "date": day(-3), "description": "厨房用洗剤・ゴミ袋", "counter": "消耗品費", "debit": 0, "credit": 3_680, "balance": 66_320, "storeName": shinjuku,
                 "originHref": "/app/cash?tab=petty", "originLabel": "小口現金を見る"],
                ["id": "r3", "date": day(0), "description": "本日の売上", "counter": "売上高", "debit": 186_400, "credit": 0, "balance": 252_720, "storeName": shinjuku],
            ]
            d["ledger"] = ["accountId": accountId, "accountCode": "100", "accountName": "現金", "opening": 50_000, "rows": rows]
        }
        return d
    }

    // MARK: 財務レポート

    static func pl(_ n: Int, _ code: String, _ name: String, _ v: Int) -> [String: Any] { ["id": id(n), "code": code, "name": name, "balance": v] }

    static func statements(_ q: [String: String]) -> [String: Any] {
        let today = NOS.today
        let from = (q["from"] ?? "").isEmpty ? NOS.monthFirst(today) : (q["from"] ?? "")
        let to = (q["to"] ?? "").isEmpty ? today : (q["to"] ?? "")
        let this = String(today.prefix(7))
        func trow(_ n: Int, _ code: String, _ name: String, _ o: Int, _ dr: Int, _ cr: Int, _ c: Int) -> [String: Any] {
            ["id": id(n), "code": code, "name": name, "opening": o, "debit": dr, "credit": cr, "closing": c]
        }
        let trial: [[String: Any]] = [
            ["category": "asset", "label": "資産", "rows": [trow(101, "100", "現金", 50_000, 206_400, 3_680, 252_720), trow(102, "110", "普通預金", 2_400_000, 0, 330_000, 2_070_000)],
             "subtotal": ["opening": 2_450_000, "debit": 206_400, "credit": 333_680, "closing": 2_322_720]],
            ["category": "liability", "label": "負債", "rows": [trow(104, "300", "買掛金", 120_000, 0, 54_000, 174_000)],
             "subtotal": ["opening": 120_000, "debit": 0, "credit": 54_000, "closing": 174_000]],
            ["category": "revenue", "label": "収益", "rows": [trow(106, "400", "売上高", 0, 0, 186_400, 186_400)],
             "subtotal": ["opening": 0, "debit": 0, "credit": 186_400, "closing": 186_400]],
            ["category": "expense", "label": "費用", "rows": [trow(107, "500", "仕入高", 0, 54_000, 0, 54_000), trow(109, "540", "地代家賃", 0, 330_000, 0, 330_000),
                                                             trow(111, "560", "消耗品費", 0, 3_680, 0, 3_680)],
             "subtotal": ["opening": 0, "debit": 387_680, "credit": 0, "closing": 387_680]],
        ]
        let stage: [(String, Bool, Int, Int, Int)] = [("売上高", false, 2_840_000, 2_710_000, 2_560_000), ("売上原価", false, 896_000, 860_000, 842_000),
                                                      ("売上総利益", true, 1_944_000, 1_850_000, 1_718_000), ("人件費", false, 812_000, 798_000, 760_000),
                                                      ("経費", false, 604_000, 588_000, 571_000), ("営業利益", true, 528_000, 464_000, 387_000)]
        let months = (0..<3).reversed().map { NOS.shiftMonth(this, -$0) }
        return [
            "ok": true, "stores": stores, "isHq": true, "filters": ["from": from, "to": to, "storeId": q["store"] ?? ""],
            "kpi": ["cashBank": 2_322_720, "receivable": 92_300, "payable": 174_000, "netIncome": 528_000],
            "trialBalanced": true, "debitGrandTotal": 594_080, "creditGrandTotal": 594_080, "trial": trial,
            "pl": ["revenueTotal": 2_840_000, "revenues": [pl(106, "400", "売上高", 2_840_000)],
                   "cogsTotal": 896_000, "cogs": [pl(107, "500", "仕入高", 896_000)], "grossProfit": 1_944_000,
                   "laborTotal": 812_000, "labor": [pl(108, "520", "給与手当", 812_000)],
                   "opexTotal": 604_000, "opex": [pl(109, "540", "地代家賃", 330_000), pl(110, "550", "水道光熱費", 156_000), pl(111, "560", "消耗品費", 118_000)],
                   "operatingIncome": 528_000],
            "compare": ["prevMonth": NOS.shiftMonth(this, -1), "lastYear": NOS.shiftMonth(this, -12),
                        "rows": stage.map { ["label": $0.0, "emphasize": $0.1, "current": $0.2, "prev": $0.3, "lastYear": $0.4] }],
            "monthly": ["months": months, "rows": stage.map { s -> [String: Any] in ["label": s.0, "emphasize": s.1, "values": [s.4, s.3, s.2]] }],
            "monthsOverLimit": false,
            "bs": ["balanced": true, "assetTotal": 2_415_020, "liabilityTotal": 174_000, "equityTotal": 1_713_020, "netIncome": 528_000,
                   "liabilityEquityTotal": 2_415_020, "diff": 0,
                   "assets": [pl(101, "100", "現金", 252_720), pl(102, "110", "普通預金", 2_070_000), pl(103, "130", "売掛金", 92_300)],
                   "liabilities": [pl(104, "300", "買掛金", 174_000)],
                   "equity": [pl(120, "350", "資本金", 1_000_000), pl(121, "360", "繰越利益剰余金", 713_020)]],
            "openingTo": NOS.addDays(from, -1),
            "exportPath": "/app/accounting/statements/export?from=\(from)&to=\(to)",
        ]
    }

    // MARK: 銀行口座

    static func banks() -> [String: Any] {
        [
            "ok": true, "accountsInstalled": true, "accountOptions": [["id": id(102), "code": "110", "name": "普通預金"]], "formStores": stores,
            "banks": [
                ["id": id(401), "bankName": "テンポ信用金庫", "branchName": "本店", "accountType": "ordinary", "accountTypeLabel": "普通", "accountLast4": "1234",
                 "holderName": "カ）テンポワン", "accountCode": "110", "accountName": "普通預金"],
                ["id": id(402), "bankName": "ワン銀行", "branchName": "渋谷支店", "accountType": "checking", "accountTypeLabel": "当座", "accountLast4": "5678",
                 "storeName": shibuya],
            ] as [[String: Any]],
        ]
    }

    static func bank() -> [String: Any] {
        let txs: [[String: Any]] = [
            ["id": id(411), "date": day(-1), "description": "カード売上 入金", "deposit": 92_300, "withdrawal": 0, "runningBalance": 2_162_300],
            ["id": id(412), "date": day(-2), "description": "みどり青果 振込", "deposit": 0, "withdrawal": 54_000, "runningBalance": 2_070_000],
            ["id": id(413), "date": day(-4), "description": "家賃 振込", "deposit": 0, "withdrawal": 330_000, "runningBalance": 2_124_000, "journalEntryId": id(203)],
        ]
        var opts = accountRefs
        if let i = opts.firstIndex(where: { ($0["code"] as? String) == "130" }) { opts[i]["subType"] = "receivable" }
        if let i = opts.firstIndex(where: { ($0["code"] as? String) == "300" }) { opts[i]["subType"] = "payable" }
        return [
            "ok": true,
            "bank": ["id": id(401), "bankName": "テンポ信用金庫", "branchName": "本店", "accountType": "ordinary", "accountTypeLabel": "普通", "accountLast4": "1234",
                     "holderName": "カ）テンポワン", "accountId": id(102), "accountCode": "110", "accountName": "普通預金"],
            "balance": 2_162_300, "receivableTotal": 92_300, "payableTotal": 174_000, "txs": txs,
            "accountOptions": opts, "editAccountOptions": [["id": id(102), "code": "110", "name": "普通預金"]], "formStores": stores, "maxImportRows": 2000,
        ]
    }

    // MARK: 自動仕訳

    static func auto(_ q: [String: String]) -> [String: Any] {
        let today = NOS.today
        let from = (q["from"] ?? "").isEmpty ? NOS.addDays(today, -6) : (q["from"] ?? "")
        let to = (q["to"] ?? "").isEmpty ? today : (q["to"] ?? "")
        func src(_ t: String, _ title: String, _ hint: String, _ neg: Bool, _ c: Int, _ total: Int) -> [String: Any] {
            ["sourceType": t, "title": title, "hint": hint, "negative": neg, "pendingCount": c, "pendingTotal": total]
        }
        return [
            "ok": true, "filters": ["from": from, "to": to], "accountsInstalled": true,
            "sources": [
                src("pos_sales", "POS売上", "営業日・店舗ごとに売上を集計します（期間で対象を選びます）", false, 6, 1_642_800),
                src("pos_refund", "返金", "返金が発生した営業日で計上します", true, 1, 3_200),
                src("purchase", "仕入（請求書）", "承認済み・未仕訳の仕入請求書", false, 2, 98_400),
                src("expense", "経費", "承認済み・未仕訳の経費", false, 3, 21_560),
                src("petty_cash", "小口現金", "承認済み・未仕訳の小口現金", false, 0, 0),
                src("payroll", "給与", "承認済み・未仕訳の給与計算", false, 1, 812_000),
            ],
            "totalsNote": "合計参考: 売上 ¥1,642,800 ・ 返金 ¥3,200 ・ 仕入 ¥98,400 ・ 経費 ¥21,560 ・ 小口現金 ¥0 ・ 給与 ¥812,000",
            "mappingRows": [["id": id(601), "name": "消耗品", "accountId": id(111)], ["id": id(602), "name": "交通費"], ["id": id(603), "name": "水道光熱", "accountId": id(110)]] as [[String: Any]],
            "mappingAccountOptions": accountRefs,
        ]
    }

    static func candidates(_ source: String) -> [String: Any] {
        func cand(_ n: Int, _ d: Int, _ desc: String, _ amount: Int, posted: Bool = false, warning: String? = nil) -> [String: Any] {
            var c: [String: Any] = ["key": id(n), "sourceId": id(n), "date": day(d), "description": desc, "storeName": shinjuku,
                                    "lines": [["id": 0, "side": "debit", "accountName": "現金", "amount": amount], ["id": 1, "side": "credit", "accountName": "売上高", "amount": amount]],
                                    "debit": amount, "balanced": true, "alreadyPosted": posted]
            if let warning { c["warning"] = warning }
            return c
        }
        return ["ok": true, "source": source, "candidates": [
            cand(701, -1, "売上 \(NOS.md(day(-1)))", 268_400),
            cand(702, -2, "売上 \(NOS.md(day(-2)))", 241_900),
            cand(703, -3, "売上 \(NOS.md(day(-3)))", 198_700, posted: true),
            cand(704, -4, "売上 \(NOS.md(day(-4)))", 255_300, warning: "未マッピングの決済方法があります（雑費で仮計上）"),
        ] as [[String: Any]]]
    }

    // MARK: 固定資産

    static func assets() -> [String: Any] {
        [
            "ok": true, "stores": stores, "today": NOS.today,
            "methods": [opt("straight_line", "定額法"), opt("declining_balance", "定率法")],
            "rows": [
                ["id": id(801), "name": "厨房機器一式（コンベクションオーブン）", "acquiredOn": "2025-04-01", "acquisitionCost": 1_280_000, "usefulLifeYears": 8,
                 "depreciationMethod": "straight_line", "methodLabel": "定額法", "storeId": id(1), "storeName": shinjuku, "status": "in_use", "statusLabel": "使用中"],
                ["id": id(802), "name": "製氷機", "acquiredOn": "2019-07-15", "acquisitionCost": 420_000, "usefulLifeYears": 6,
                 "depreciationMethod": "straight_line", "methodLabel": "定額法", "storeId": id(2), "storeName": shibuya, "status": "disposed", "statusLabel": "除却",
                 "disposedOn": day(-40), "note": "故障のため入れ替え"],
            ] as [[String: Any]],
        ]
    }

    // MARK: 請求書・書類

    static func invoices(_ q: [String: String]) -> [String: Any] {
        let tab = q["tab"] ?? "invoices"
        func row(_ n: Int, _ status: String, _ label: String, _ vendor: String, _ expense: String, _ due: Int, _ amount: Int, overdue: Bool = false, journaled: Bool = false) -> [String: Any] {
            var r: [String: Any] = ["id": id(n), "status": status, "statusLabel": label, "overdue": overdue, "vendorName": vendor, "expenseLabel": expense,
                                    "dueLabel": day(due).replacingOccurrences(of: "-", with: "/"), "amount": amount, "storeLabel": shinjuku, "journaled": journaled]
            if journaled { r["journalHref"] = "/app/accounting?source_type=purchase&source_id=\(id(n))" }
            return r
        }
        return [
            "ok": true, "view": "list", "tab": tab, "canWrite": true, "canApprove": true, "canExport": true, "currentStoreId": id(1),
            "formStores": stores, "triageStores": stores,
            "vendors": [["id": id(901), "name": "みどり青果"], ["id": id(902), "name": "山田酒店"], ["id": id(903), "name": "さくら精肉"]],
            "accounts": [["id": id(911), "name": "仕入"], ["id": id(912), "name": "消耗品"], ["id": id(913), "name": "水道光熱"]],
            "filters": ["status": q["status"] ?? "", "vendor": q["vendor"] ?? "", "expense": q["expense"] ?? "", "ym": q["ym"] ?? "",
                        "overdue": q["overdue"] == "1", "docType": q["docType"] ?? "", "store": q["store"] ?? id(1)],
            "summary": ["unpaidTotal": 318_600, "scheduledThisMonthTotal": 152_000, "overdueCount": 1, "overdueTotal": 48_600],
            "invoices": [
                row(921, "pending_approval", "承認待ち", "みどり青果", "仕入", 5, 54_000),
                row(922, "review", "確認待ち", "山田酒店", "仕入", 12, 98_000),
                row(923, "open", "未処理", "さくら精肉", "仕入", -3, 48_600, overdue: true),
                row(924, "paid", "支払済み", "みどり青果", "仕入", -20, 61_200, journaled: true),
            ] as [[String: Any]],
            "inbox": [["id": id(931), "fileName": "scan_20261024_1.pdf", "mimeType": "application/pdf", "sub": "10/24 18:02・412KB"],
                      ["id": id(932), "fileName": "photo_receipt.jpg", "mimeType": "image/jpeg", "sub": "10/25 09:15・880KB"]] as [[String: Any]],
            "documents": [["id": id(941), "docTypeLabel": "領収書", "fileName": "receipt_1023.jpg", "dateLabel": day(-2).replacingOccurrences(of: "-", with: "/"),
                           "vendorLabel": "山田酒店", "storeLabel": shinjuku, "amount": 3_240, "ocrStatus": "done", "ocrLabel": "読み取り済み"],
                          ["id": id(942), "docTypeLabel": "納品書", "fileName": "delivery_1020.pdf", "dateLabel": day(-5).replacingOccurrences(of: "-", with: "/"),
                           "vendorLabel": "みどり青果", "storeLabel": shinjuku, "ocrStatus": "none", "ocrLabel": "未実行"]] as [[String: Any]],
            "statusOptions": [opt("open", "未処理"), opt("review", "確認待ち"), opt("pending_approval", "承認待ち"), opt("approved", "承認済み"),
                              opt("scheduled", "支払予定"), opt("paid", "支払済み"), opt("rejected", "差戻し")],
            "paymentMethodOptions": [opt("bank_transfer", "銀行振込"), opt("cash", "現金"), opt("card", "カード"), opt("auto_debit", "口座振替")],
            "docTypeOptions": [opt("invoice", "請求書"), opt("receipt", "領収書"), opt("delivery_note", "納品書"), opt("quote", "見積書"), opt("other", "その他")],
            "csvPath": "/app/invoices/export", "csvName": "invoices_\(NOS.today).csv", "inlineMax": 3_000_000, "maxFileSize": 20_000_000,
        ]
    }

    static func invoiceDetail(_ invoiceId: String) -> [String: Any] {
        [
            "id": invoiceId, "status": "pending_approval", "statusLabel": "承認待ち", "vendorName": "みどり青果", "storeLabel": shinjuku,
            "invoiceNo": "MG-2026-1024", "issueDate": day(-3), "dueDate": day(5),
            "issueLabel": day(-3).replacingOccurrences(of: "-", with: "/"), "dueLabel": day(5).replacingOccurrences(of: "-", with: "/"), "paidLabel": "—",
            "amount": 54_000, "taxAmount": 4_000, "registrationNumber": "T1234567890123", "paymentMethod": "bank_transfer", "paymentMethodLabel": "銀行振込",
            "expenseAccountId": id(911), "expenseLabel": "仕入", "note": "10月分（野菜・果物）",
            "documentId": id(951), "attachment": ["documentId": id(951), "fileName": "midori_1024.pdf", "mimeType": "application/pdf", "ocrStatus": "done", "ocrLabel": "読み取り済み"],
            "comments": [["id": id(961), "body": "金額は納品書と一致しています。", "author": "佐藤 花子", "createdLabel": "10/24 18:20"]],
            "requiredApprovalRoleLabel": "店長",
            "canEdit": true, "canComment": true,
            "actions": [["action": "approve", "label": "承認する", "done": "承認しました"], ["action": "reject", "label": "差戻す", "done": "差戻しました"]],
            "noPermission": false,
        ]
    }

    // MARK: 照合

    static func reconciliation(_ q: [String: String]) -> [String: Any] {
        let today = NOS.today
        let from = (q["from"] ?? "").isEmpty ? NOS.addDays(today, -6) : (q["from"] ?? "")
        let to = (q["to"] ?? "").isEmpty ? today : (q["to"] ?? "")
        return [
            "ok": true, "from": from, "to": to, "storeId": q["store"] ?? "", "stores": stores,
            "description": "全社（全店舗）｜\(from.replacingOccurrences(of: "-", with: "/"))〜\(to.replacingOccurrences(of: "-", with: "/"))",
            "noStores": false,
            "overall": ["status": "mismatch", "label": "不一致", "message": "不一致があります。内容を確認してください"],
            "sales": ["status": "mismatch", "label": "不一致", "unconfirmedDays": 2, "rows": [
                ["key": "pos", "label": "(a) POS純売上", "amount": 1_642_800, "diff": "—", "mismatch": false, "note": "会計成立注文（paid+refunded）total合計 − 返金", "href": "/app/orders"],
                ["key": "payments", "label": "(b) 決済合計", "amount": 1_642_800, "diff": "±¥0", "mismatch": false, "note": "payments（completed）合計 − 返金", "href": "/app/cash?tab=today"],
                ["key": "journal", "label": "(c) 仕訳売上", "amount": 1_132_600, "diff": "−¥510,200", "mismatch": true, "note": "確定済み仕訳（pos_sales/pos_refund）の売上高（400/401）net", "href": "/app/accounting/auto"],
            ] as [[String: Any]]],
            "cash": ["status": "mismatch", "label": "不一致", "hasRows": true, "expectedTotal": 1_024_500, "countedTotal": 1_023_500, "differenceTotal": -1_000,
                     "differenceLabel": "−¥1,000",
                     "diffDays": [["id": id(971), "dateLabel": day(-2).replacingOccurrences(of: "-", with: "/"), "storeName": shinjuku, "expected": 182_400, "counted": 181_400,
                                   "differenceLabel": "−¥1,000", "href": "/app/cash?tab=closings"]] as [[String: Any]]],
            "inventory": ["status": "ok", "label": "一致", "hasCounts": true, "diffCount": 2, "diffAmountTotal": 0, "diffAmountLabel": "¥0",
                          "rows": [["id": id(981), "name": "生ビール樽 10L", "qtyLabel": "-1本", "short": true, "unitCost": 8_400, "amountLabel": "+¥8,400", "mismatch": true],
                                   ["id": id(982), "name": "鶏もも肉", "qtyLabel": "+0.5kg", "short": false, "amountLabel": "単価未設定", "mismatch": false]] as [[String: Any]]],
        ]
    }

    // MARK: 月次清算（1店舗）

    static func settlement(_ q: [String: String]) -> [String: Any] {
        let this = String(NOS.today.prefix(7))
        let month = q["month"].flatMap { NOS.isMonth($0) ? $0 : nil } ?? this
        let label = NOS.ymLabel(month)
        let vendors = ["みどり青果", "山田酒店", "さくら精肉"]
        let days = Array(NOS.monthDays(month).prefix(month == this ? max(1, Int(NOS.today.suffix(2)) ?? 1) : 31))
        let rows: [[String: Any]] = days.enumerated().map { i, d in
            let sales = i % 7 == 1 ? 0 : 180_000 + (i * 3_700) % 60_000
            let v: [Int] = [i % 3 == 0 ? 54_000 : 0, i % 5 == 0 ? 98_000 : 0, i % 4 == 2 ? 36_000 : 0]
            let exp = i % 2 == 0 ? 2_400 : 0
            return ["date": d, "label": "\(NOS.md(d))", "sales": sales, "byVendor": v, "expenses": exp, "outgo": v.reduce(0, +) + exp]
        }
        let totalSales = rows.reduce(0) { $0 + (($1["sales"] as? Int) ?? 0) }
        let byVendor = (0..<3).map { j in rows.reduce(0) { $0 + ((($1["byVendor"] as? [Int]) ?? [0, 0, 0])[j]) } }
        let totalExp = rows.reduce(0) { $0 + (($1["expenses"] as? Int) ?? 0) }
        let outgo = byVendor.reduce(0, +) + totalExp
        func share(_ v: Int) -> Double { totalSales == 0 ? 0 : (Double(v) / Double(totalSales) * 10_000).rounded() / 100 }
        let profit = totalSales - outgo - 480_000 - 812_000
        return [
            "ok": true, "kind": "store", "month": month, "prevMonth": NOS.shiftMonth(month, -1), "nextMonth": NOS.shiftMonth(month, 1),
            "isCurrentMonth": month == this, "monthLabel": label, "description": "\(shinjuku)・\(label)",
            "storeId": id(1), "storeName": shinjuku, "canEdit": true,
            "cards": [
                ["label": "今週の損益", "value": 182_400, "sub": "今週・固定費・給料は日割り", "plain": false,
                 "detail": "売上 ¥1,420,000 − 仕入 ¥420,000 − 経費 ¥12,000 − 固定費 ¥112,000 − 給料 ¥190,000"],
                ["label": "\(label)の損益", "value": profit, "sub": "固定費・給料は月の金額", "plain": false],
                ["label": "売上", "value": totalSales, "sub": "\(label)（返金を引いた金額）", "plain": true],
                ["label": "仕入・経費", "value": outgo, "sub": "売上の \(Int(share(outgo)))%", "plain": true],
            ] as [[String: Any]],
            "table": ["vendors": vendors, "rows": rows,
                      "totals": ["sales": totalSales, "byVendor": byVendor, "expenses": totalExp, "outgo": outgo],
                      "vendorShare": byVendor.map { share($0) }, "expensesShare": share(totalExp), "outgoShare": share(outgo)],
            "costs": ["rent": 330_000, "electric": 98_000, "water": 24_000, "salary": 812_000, "other": [["name": "ガス", "amount": 28_000]]],
            "costKinds": [["key": "rent", "label": "家賃"], ["key": "electric", "label": "電気"], ["key": "water", "label": "水道"], ["key": "salary", "label": "給料"]],
            "maxOther": 20,
            "scanned": [["documentId": id(991), "category": "electric", "label": "電気", "amount": 101_200, "dateLabel": "10/20"]] as [[String: Any]],
            "invoices": [
                ["id": id(921), "dateLabel": "10/22", "vendor": "みどり青果", "invoiceNo": "MG-2026-1024", "amount": 54_000, "dueLabel": "10/31", "status": "pending_approval", "statusLabel": "承認待ち"],
                ["id": id(924), "dateLabel": "10/05", "vendor": "山田酒店", "amount": 98_000, "dueLabel": "10/25", "status": "paid", "statusLabel": "支払済み"],
            ] as [[String: Any]],
        ]
    }
}
