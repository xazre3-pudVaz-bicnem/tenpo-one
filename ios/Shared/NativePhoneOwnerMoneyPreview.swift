import SwiftUI

// iPhone の店長・オーナー：入出金・小口現金・締め履歴・レジオープン／クローズ・仕入経費・スキャンの見本
// （シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）。
// 起動の引数 -tenpoNativePreview ownerCash | ownerPetty | ownerClosings | ownerCashOpen | ownerCashClose | ownerExpenses | ownerScan
// 名前・店舗はすべて作りもの（実在の人・お店ではありません）。

private enum NOMSample {
    static let store = "TENPO ONE 新宿店"

    static func id(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }

    static func iso(minutesAgo: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date().addingTimeInterval(-minutesAgo * 60))
    }

    static func day(_ offset: Int) -> String { NOS.addDays(NOS.today, offset) }

    static var storeObj: [String: Any] { ["id": id(900), "name": store] }

    static let clerks: [[String: Any]] = [
        ["id": id(21), "name": "山田 太郎", "role": "店長"],
        ["id": id(22), "name": "佐藤 花子", "role": "スタッフ"],
        ["id": id(23), "name": "鈴木 一郎", "role": "スタッフ"],
    ]
}

extension NOMCashIoModel {
    static func sample() -> NOMCashIoModel {
        let m = NOMCashIoModel()
        func row(_ n: Int, kind: String, dir: String, minutesAgo: Double, main: String, sub: String, amount: Double,
                 pending: Bool = false, receipt: String, by: String) -> [String: Any] {
            ["id": NOMSample.id(n), "kind": kind, "direction": dir, "time": NOMSample.iso(minutesAgo: minutesAgo), "main": main, "sub": sub,
             "amount": amount, "pending": pending, "receipt": receipt, "createdByName": by]
        }
        let obj: [String: Any] = [
            "store": NOMSample.storeObj,
            "businessDate": NOS.today,
            "sessions": [["id": NOMSample.id(1), "registerName": "レジ1"]],
            "theoretical": 228_720,
            "shops": [["id": NOMSample.id(11), "name": "青果 みどり屋"], ["id": NOMSample.id(12), "name": "業務スーパー"], ["id": NOMSample.id(13), "name": "酒の山田商店"]],
            "clerks": NOMSample.clerks,
            "rows": [
                row(31, kind: "withdrawal", dir: "out", minutesAgo: 35, main: "買い物：青果 みどり屋 野菜・薬味", sub: "担当 佐藤 花子｜持出¥5,000 お釣り¥1,320", amount: 3_680, receipt: "missing", by: "佐藤 花子"),
                row(32, kind: "withdrawal", dir: "out", minutesAgo: 95, main: "仮払い：業務スーパー", sub: "製氷用の氷・洗剤", amount: 10_000, receipt: "advanceOpen", by: "鈴木 一郎"),
                row(33, kind: "deposit", dir: "in", minutesAgo: 180, main: "両替", sub: "千円札 → 小銭", amount: 10_000, receipt: "none", by: "山田 太郎"),
                row(34, kind: "withdrawal", dir: "out", minutesAgo: 240, main: "買い物：酒の山田商店 レモン", sub: "担当 山田 太郎｜持出¥2,000 ちょうど", amount: 2_000, pending: true, receipt: "ok", by: "山田 太郎"),
                row(35, kind: "deposit", dir: "in", minutesAgo: 420, main: "釣銭補充", sub: "", amount: 20_000, receipt: "none", by: "山田 太郎"),
            ] as [[String: Any]],
            "openAdvances": [["id": NOMSample.id(32), "createdByName": "鈴木 一郎", "time": NOMSample.iso(minutesAgo: 95), "amount": 10_000, "main": "仮払い：業務スーパー", "sub": "製氷用の氷・洗剤"]] as [[String: Any]],
            "canOperate": true, "canScan": true, "canPetty": true, "canExport": true,
        ]
        m.payload = NOS.decode(NOMCashIo.self, obj)
        return m
    }
}

extension NOMPettyModel {
    static func sample() -> NOMPettyModel {
        let m = NOMPettyModel()
        func row(_ n: Int, day: Int, kind: String, label: String, amount: Double, purpose: String, account: String?, status: String) -> [String: Any] {
            let statusLabel = status == "approved" ? "承認済み" : status == "rejected" ? "差戻し" : "承認待ち"
            return ["id": NOMSample.id(n), "businessDate": NOMSample.day(day), "storeName": NOMSample.store, "kind": kind, "kindLabel": label, "amount": amount,
                    "purpose": purpose, "accountName": account.map { $0 as Any } ?? NSNull(), "approvalStatus": status, "approvalLabel": statusLabel,
                    "requiredRole": status == "pending" ? ("店長" as Any) : NSNull()]
        }
        let obj: [String: Any] = [
            "store": NOMSample.storeObj, "from": m.from, "to": m.to, "status": "",
            "canApprove": true, "canWrite": true, "multiStore": false,
            "openingBalance": 50_000, "theoreticalBalance": 38_460, "advanceBalance": 4_200,
            "accounts": [["id": NOMSample.id(51), "name": "消耗品費"], ["id": NOMSample.id(52), "name": "食材費"], ["id": NOMSample.id(53), "name": "雑費"]],
            "advances": [["id": NOMSample.id(61), "purpose": "[立替:佐藤] 花の購入", "amount": 4_200, "businessDate": NOMSample.day(-2)]] as [[String: Any]],
            "rows": [
                row(61, day: 0, kind: "petty_out", label: "小口出金", amount: 1_540, purpose: "ゴミ袋・ラップ", account: "消耗品費", status: "pending"),
                row(62, day: -2, kind: "petty_advance", label: "立替", amount: 4_200, purpose: "[立替:佐藤] 花の購入", account: "雑費", status: "approved"),
                row(63, day: -3, kind: "petty_out", label: "小口出金", amount: 5_800, purpose: "製氷機のフィルター", account: "消耗品費", status: "approved"),
                row(64, day: -6, kind: "petty_in", label: "小口入金", amount: 10_000, purpose: "本部から補充", account: nil, status: "approved"),
            ] as [[String: Any]],
            "counts": [
                ["id": NOMSample.id(71), "countDate": NOMSample.day(-1), "expectedAmount": 39_000, "countedAmount": 38_900, "difference": -100, "status": "recorded", "statusLabel": "記録済み（未承認）"],
                ["id": NOMSample.id(72), "countDate": NOMSample.day(-8), "expectedAmount": 42_300, "countedAmount": 42_300, "difference": 0, "status": "approved", "statusLabel": "承認済み"],
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NOMPetty.self, obj)
        return m
    }
}

extension NOMClosingsModel {
    static func sample() -> NOMClosingsModel {
        let m = NOMClosingsModel()
        func line(_ name: String, opening: Double, sales: Double, inA: Double, outA: Double, counted: Double, by: String) -> [String: Any] {
            let expected = opening + sales + inA - outA
            return ["registerName": name, "openingFloat": opening, "cashSales": sales, "cashRefunds": 0, "cashIn": inA, "cashOut": outA,
                    "expectedCash": expected, "countedCash": counted, "difference": counted - expected, "closedByName": by]
        }
        func row(_ n: Int, day: Int, sales: Double, orders: Double, guests: Double, refund: Double, diff: Double, status: String, label: String) -> [String: Any] {
            let cashSales: Double = (sales * 0.31).rounded()
            let credit: Double = (sales * 0.46).rounded()
            let qr: Double = (sales * 0.15).rounded()
            let emoney: Double = sales - cashSales - credit - qr
            let expected: Double = 30_000 + cashSales + 10_000 - 3_680
            let pay: [String: Double] = ["cash": cashSales, "credit": credit, "qr": qr, "emoney": emoney]
            let refunds: [String: Double] = refund > 0 ? ["credit": refund] : [:]
            let note: Any = diff != 0 ? ("差額の理由：釣銭の渡し間違い" as Any) : NSNull()
            let lines: [[String: Any]] = [line("レジ1", opening: 30_000, sales: cashSales, inA: 10_000, outA: 3_680, counted: expected + diff, by: "山田 太郎")]
            var r: [String: Any] = ["id": NOMSample.id(n), "storeId": NOMSample.id(900), "businessDate": NOMSample.day(day), "storeName": NOMSample.store]
            r["salesTotal"] = sales
            r["ordersCount"] = orders
            r["guestsCount"] = guests
            r["discountTotal"] = 2_400
            r["refundTotal"] = refund
            r["netSales"] = sales - refund
            r["cashDifference"] = diff
            r["status"] = status
            r["statusLabel"] = label
            r["paymentBreakdown"] = pay
            r["refundBreakdown"] = refunds
            r["pettyInTotal"] = 0
            r["pettyOutTotal"] = 1_540
            r["expectedCash"] = expected
            r["countedCash"] = expected + diff
            r["note"] = note
            r["registerBreakdown"] = lines
            return r
        }
        let obj: [String: Any] = [
            "store": NOMSample.storeObj, "from": m.from, "to": m.to, "showStore": false, "canApprove": true, "canReopenStoreDay": true,
            "methodLabels": ["cash": "現金", "credit": "クレジット", "qr": "QRコード決済", "emoney": "電子マネー"],
            "rows": [
                row(81, day: -1, sales: 412_800, orders: 96, guests: 241, refund: 4_800, diff: 0, status: "closed", label: "締め済み（未承認）"),
                row(82, day: -2, sales: 388_200, orders: 88, guests: 226, refund: 0, diff: -500, status: "approved", label: "承認済み"),
                row(83, day: -3, sales: 296_400, orders: 71, guests: 168, refund: 0, diff: 0, status: "approved", label: "承認済み"),
                row(84, day: -4, sales: 271_900, orders: 66, guests: 150, refund: 0, diff: 0, status: "reopened", label: "修正待ち"),
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NOMClosings.self, obj)
        m.expanded = [NOMSample.id(81)]
        return m
    }
}

extension NOMRegisterModel {
    /// open＝開局の画面（釣銭準備金を数え中）、そうでなければクローズの画面（数え終わって差額 ±¥0）
    static func sample(open: Bool) -> NOMRegisterModel {
        let m = NOMRegisterModel(mode: open ? "open" : "close")
        let session: [String: Any] = [
            "id": NOMSample.id(1), "registerName": "レジ1", "businessDate": NOS.today, "openedAt": NOMSample.iso(minutesAgo: 60 * 9), "openedByName": "山田 太郎",
            "openingFloat": 30_000, "cashSales": 182_400, "cashRefunds": 0, "cashIn": 20_000, "cashOut": 3_680, "theoreticalCash": 228_720,
        ]
        let closed: [String: Any] = [
            "id": NOMSample.id(2), "registerName": "レジ2（テラス）", "openedByName": "佐藤 花子", "closedByName": "佐藤 花子",
            "openedAt": NOMSample.iso(minutesAgo: 60 * 8), "closedAt": NOMSample.iso(minutesAgo: 30),
            "openingFloat": 20_000, "expectedCash": 64_300, "countedCash": 64_300, "difference": 0,
        ]
        let obj: [String: Any] = [
            "store": NOMSample.storeObj,
            "businessDate": NOS.today, "continuing": false,
            "expectedOpening": 30_000, "expectedFrom": NOMSample.day(-1),
            "openRegister": open ? (["id": NOMSample.id(5), "name": "レジ1"] as Any) : NSNull(),
            "openSessions": open ? [[String: Any]]() : [session],
            "closedSessions": open ? [[String: Any]]() : [closed],
            "storeDayClosed": false, "nextFloatSetting": 30_000,
            "openCount": 0, "openTotal": 0,
            "sales": ["grossSales": 588_400, "refunds": 4_800, "netSales": 583_600, "transactionCount": 131, "guests": 342, "avgSpend": 1_706],
            "byMethod": [
                ["method": "credit", "label": "クレジット", "en": "Credit", "count": 58, "amount": 270_660],
                ["method": "cash", "label": "現金", "en": "Cash", "count": 49, "amount": 182_400],
                ["method": "qr", "label": "QRコード決済", "en": "QR", "count": 17, "amount": 88_260],
                ["method": "emoney", "label": "電子マネー", "en": "E-money", "count": 7, "amount": 47_080],
            ] as [[String: Any]],
            "paymentsCount": 131, "paymentsTotal": 588_400,
            "cashFlow": ["opening": 30_000, "sales": 182_400, "cashIn": 20_000, "cashOut": 3_680, "refunds": 0, "remaining": 228_720, "depositCount": 2, "withdrawalCount": 1],
            "registerMoves": [
                ["id": NOMSample.id(31), "kind": "withdrawal", "time": NOMSample.iso(minutesAgo: 35), "main": "買い物：青果 みどり屋 野菜・薬味", "sub": "佐藤 花子", "amount": 3_680],
                ["id": NOMSample.id(33), "kind": "deposit", "time": NOMSample.iso(minutesAgo: 180), "main": "両替", "sub": "山田 太郎", "amount": 10_000],
                ["id": NOMSample.id(35), "kind": "deposit", "time": NOMSample.iso(minutesAgo: 420), "main": "釣銭補充", "sub": NSNull(), "amount": 10_000],
            ] as [[String: Any]],
            "registerMovesMore": 0,
            "receipts": ["total": 1, "ok": 0, "ng": 1, "ngTotal": 3_680],
            "clerks": NOMSample.clerks,
            "canOperate": true, "canScan": true, "isRegisterDevice": false,
        ]
        m.payload = NOS.decode(NOMRegister.self, obj)
        m.clerk = m.payload?.clerks.first
        if open {
            // 30,000 円（前回のレジクローズで残した金額と同じ）を数え中
            m.counts = [10000: 1, 5000: 1, 1000: 10, 500: 6, 100: 15, 50: 8, 10: 10]
            m.focus = 5
        } else {
            // 228,720 円（理論在高と同じ）
            m.counts = [10000: 18, 5000: 5, 1000: 20, 500: 5, 100: 10, 50: 4, 10: 2, 5: 0, 1: 0]
        }
        return m
    }
}

extension NOMExpensesModel {
    static func sample() -> NOMExpensesModel {
        let m = NOMExpensesModel()
        func row(_ n: Int, day: Int, account: String, amount: Double, tax: Double, via: String, vendor: String?, status: String, journaled: Bool) -> [String: Any] {
            let label = status == "approved" ? "承認済み" : status == "rejected" ? "差戻し" : "承認待ち"
            return ["id": NOMSample.id(n), "businessDate": NOMSample.day(day), "storeName": NOMSample.store, "accountName": account, "amount": amount, "taxAmount": tax,
                    "paidVia": via, "vendorName": vendor.map { $0 as Any } ?? NSNull(), "status": status, "statusLabel": label, "journaled": journaled,
                    "approverLabel": status == "pending" ? ("店長" as Any) : NSNull()]
        }
        let obj: [String: Any] = [
            "store": NOMSample.storeObj, "from": NOMSample.day(-30), "to": NOS.today, "account": "", "status": "",
            "notices": [
                "announcements": [["id": "a1", "title": "年末年始の営業時間について", "createdAt": NOMSample.iso(minutesAgo: 60 * 5), "important": true, "unread": true]] as [[String: Any]],
                "unreadCount": 1,
                "alerts": [["id": "al1", "kindLabel": "在庫", "title": "生ビール樽の残りが少なくなっています", "href": "/app/inventory", "createdAt": NOMSample.iso(minutesAgo: 80)]] as [[String: Any]],
                "alertCount": 1,
                "autoNotices": [Any](),
                "todos": [["key": "unscanned", "label": "未スキャンの出金", "count": 1, "valueLabel": NSNull(), "href": "/app/cash"],
                          ["key": "expensePending", "label": "経費の承認待ち", "count": 2, "valueLabel": NSNull(), "href": "/app/expenses?status=pending"]] as [[String: Any]],
            ] as [String: Any],
            "accounts": [["id": NOMSample.id(52), "name": "食材費"], ["id": NOMSample.id(51), "name": "消耗品費"], ["id": NOMSample.id(54), "name": "水道光熱費"], ["id": NOMSample.id(55), "name": "修繕費"], ["id": NOMSample.id(53), "name": "雑費"]],
            "vendors": [["id": NOMSample.id(11), "name": "青果 みどり屋"], ["id": NOMSample.id(12), "name": "業務スーパー"], ["id": NOMSample.id(13), "name": "酒の山田商店"]],
            "monthTotals": [["name": "食材費", "total": 186_400], ["name": "消耗品費", "total": 24_870], ["name": "修繕費", "total": 16_500], ["name": "雑費", "total": 3_200]] as [[String: Any]],
            "billCount": 6, "billTotal": 412_380,
            "paidVia": [["key": "petty_cash", "label": "小口現金"], ["key": "register", "label": "レジ現金"], ["key": "bank", "label": "銀行振込"], ["key": "personal", "label": "立替"]],
            "rows": [
                row(91, day: 0, account: "消耗品費", amount: 1_540, tax: 140, via: "小口現金", vendor: "業務スーパー", status: "pending", journaled: false),
                row(92, day: -1, account: "食材費", amount: 12_800, tax: 948, via: "銀行振込", vendor: "青果 みどり屋", status: "pending", journaled: false),
                row(93, day: -3, account: "修繕費", amount: 16_500, tax: 1_500, via: "銀行振込", vendor: "製氷機メンテナンス", status: "approved", journaled: true),
                row(94, day: -5, account: "雑費", amount: 3_200, tax: 290, via: "立替", vendor: nil, status: "rejected", journaled: false),
                row(95, day: -6, account: "食材費", amount: 48_600, tax: 3_600, via: "銀行振込", vendor: "酒の山田商店", status: "approved", journaled: true),
            ] as [[String: Any]],
            "canWrite": true, "canApprove": true, "canScan": true, "canExport": true,
        ]
        if let p = NOS.decode(NOMExpenses.self, obj) {
            m.payload = p
            m.from = p.from
            m.to = p.to
        }
        return m
    }
}

extension NOMScanModel {
    static func sample() -> NOMScanModel {
        let m = NOMScanModel()
        func doc(_ n: Int, minutesAgo: Double, file: String, title: String?, type: String, typeLabel: String, status: String, amount: Double?, linked: Bool) -> [String: Any] {
            ["id": NOMSample.id(n), "createdAt": NOMSample.iso(minutesAgo: minutesAgo), "fileName": file, "title": title.map { $0 as Any } ?? NSNull(),
             "docType": type, "typeLabel": typeLabel, "status": status, "amount": amount.map { $0 as Any } ?? NSNull(), "linked": linked]
        }
        let obj: [String: Any] = [
            "canUpload": true, "canLink": true, "canClose": true, "today": NOS.today, "filter": "",
            "target": NSNull(), "txMissing": false,
            "needsReceipt": [
                ["id": NOMSample.id(31), "occurredAt": NOMSample.iso(minutesAgo: 35), "main": "買い物：青果 みどり屋 野菜・薬味", "sub": "佐藤 花子", "amount": 3_680, "isAdvance": false],
                ["id": NOMSample.id(32), "occurredAt": NOMSample.iso(minutesAgo: 95), "main": "仮払い：業務スーパー", "sub": "鈴木 一郎", "amount": 10_000, "isAdvance": true],
            ] as [[String: Any]],
            "needsTotal": 13_680,
            "month": ["count": 46, "receipts": 31, "inbox": 3],
            "folders": [
                ["day": NOS.today, "docs": [
                    doc(101, minutesAgo: 12, file: "scan_1_1.jpg", title: "酒の山田商店 レシート", type: "receipt", typeLabel: "領収書", status: "inbox", amount: 2_000, linked: true),
                    doc(102, minutesAgo: 140, file: "scan_1_2.jpg", title: nil, type: "inbox", typeLabel: "未仕分け", status: "inbox", amount: nil, linked: false),
                ] as [[String: Any]]] as [String: Any],
                ["day": NOMSample.day(-1), "docs": [
                    doc(103, minutesAgo: 60 * 26, file: "scan_2_1.jpg", title: "青果 みどり屋 納品書", type: "delivery_note", typeLabel: "納品書", status: "filed", amount: 12_800, linked: false),
                    doc(104, minutesAgo: 60 * 27, file: "scan_2_2.jpg", title: "製氷機メンテナンス 請求書", type: "invoice", typeLabel: "請求書", status: "filed", amount: 16_500, linked: false),
                ] as [[String: Any]]] as [String: Any],
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NOMScan.self, obj)
        m.tasks = [
            NOMUploadTask(name: "scan_1_1.jpg", status: "success", message: "保存して出金に紐付けました", thumb: nil),
        ]
        return m
    }
}

/// -tenpoNativePreview owner…（お金・書類）のときの画面
struct NativePhoneOwnerMoneyPreview: View {
    let kind: String
    @StateObject private var io = NOMCashIoModel.sample()
    @StateObject private var petty = NOMPettyModel.sample()
    @StateObject private var closings = NOMClosingsModel.sample()
    @StateObject private var openReg = NOMRegisterModel.sample(open: true)
    @StateObject private var closeReg = NOMRegisterModel.sample(open: false)
    @StateObject private var expenses = NOMExpensesModel.sample()
    @StateObject private var scan = NOMScanModel.sample()

    var body: some View {
        switch kind {
        case "ownerPetty":
            NativePhoneOwnerCashView(io: io, petty: petty, closings: closings, tab: "petty", onBack: {}, onOpen: { _ in })
        case "ownerClosings":
            NativePhoneOwnerCashView(io: io, petty: petty, closings: closings, tab: "closings", onBack: {}, onOpen: { _ in })
        case "ownerCashOpen":
            NativePhoneOwnerRegisterView(model: openReg, onBack: {}, onOpen: { _ in })
        case "ownerCashClose":
            NativePhoneOwnerRegisterView(model: closeReg, onBack: {}, onOpen: { _ in })
        case "ownerExpenses":
            NativePhoneOwnerExpensesView(model: expenses, onBack: {}, onOpen: { _ in })
        case "ownerScan":
            NativePhoneOwnerScanView(model: scan, onBack: {}, onOpen: { _ in })
        default:
            NativePhoneOwnerCashView(io: io, petty: petty, closings: closings, tab: "register", onBack: {}, onOpen: { _ in })
        }
    }
}
