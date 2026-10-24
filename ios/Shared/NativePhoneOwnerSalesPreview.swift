import SwiftUI

// iPhone の店長・オーナー：レポート・伝票明細・予算の見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）。
// 起動の引数 -tenpoNativePreview ownerReports | ownerOrders | ownerSlip | ownerBudgets | ownerBudgetDaily
// 名前はすべて作りもの（実在の人・お店ではありません）。

private let nosSampleStore = "TENPO ONE 新宿店"

private func nosIso(minutesAgo: Double) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f.string(from: Date().addingTimeInterval(-minutesAgo * 60))
}

private func nosSampleId(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }

extension NPOReportsModel {
    /// 先月 1 か月の見本（日別の棒が 30 本前後並ぶ）
    static func sample() -> NPOReportsModel {
        let m = NPOReportsModel()
        let first = NOS.shiftMonth(String(NOS.today.prefix(7)), -1) + "-01"
        m.mode = .month
        m.anchor = first
        let days = NOS.monthDays(first)
        var daily: [[String: Any]] = []
        var total = 0.0
        for (i, d) in days.enumerated() {
            let w = NOS.weekday(d)
            let base: Double = w == 5 || w == 6 ? 420_000 : w == 0 ? 350_000 : 255_000
            let net = base + Double((i * 37) % 9) * 11_000
            total += net
            daily.append(["date": d, "gross": net, "refund": 0, "net": net])
        }
        let products: [(String, Double, Double, Double?)] = [
            ("生ビール（中）", 1840, 1_104_000, 331_000), ("鶏の唐揚げ", 612, 416_160, 124_800), ("本日の刺身盛り合わせ", 214, 359_520, 143_800),
            ("ハイボール", 702, 351_000, 70_200), ("和牛の炙り", 238, 304_640, 136_900), ("おまかせコース", 52, 260_000, 98_800),
            ("だし巻き玉子", 388, 225_040, 45_000), ("レモンサワー", 451, 225_500, 45_100), ("焼き鳥 盛り合わせ", 190, 209_000, 73_100),
            ("シーザーサラダ", 270, 183_600, 45_900), ("自家製ポテトサラダ", 352, 168_960, 33_700), ("〆の焼きおにぎり", 301, 114_380, nil),
        ]
        func hourSales(_ h: Int) -> Double {
            if h < 11 { return 0 }
            if h < 14 { return Double(60_000 + h * 9_000) }
            if h < 17 { return 30_000 }
            if h < 23 { return Double(180_000 + (h % 3) * 40_000) }
            return 20_000
        }
        var hours: [[String: Any]] = []
        for h in 0..<24 { hours.append(["hour": "\(h)時", "sales": hourSales(h) * Double(days.count) / 10]) }
        let pays: [[String: Any]] = [["label": "クレジット", "amount": total * 0.46], ["label": "現金", "amount": total * 0.31],
                                     ["label": "QRコード決済", "amount": total * 0.15], ["label": "電子マネー", "amount": total * 0.08]]
        let cats: [[String: Any]] = [["category": "ドリンク", "sales": total * 0.36], ["category": "おすすめ", "sales": total * 0.22],
                                     ["category": "焼き鳥", "sales": total * 0.13], ["category": "揚げ物", "sales": total * 0.11],
                                     ["category": "コース", "sales": total * 0.09], ["category": "サラダ", "sales": total * 0.05]]
        var productRows: [[String: Any]] = []
        for p in products {
            var r: [String: Any] = ["key": p.0, "name": p.0, "quantity": p.1, "revenue": p.2]
            r["cost"] = p.3.map { $0 as Any } ?? NSNull()
            productRows.append(r)
        }
        let staff: [[String: Any]] = [["name": "山田 太郎", "count": 182, "sales": total * 0.31, "avgSpend": 4420],
                                      ["name": "佐藤 花子", "count": 160, "sales": total * 0.27, "avgSpend": 4310],
                                      ["name": "鈴木 一郎", "count": 131, "sales": total * 0.22, "avgSpend": 4080]]
        let obj: [String: Any] = [
            "from": first, "to": days.last ?? first, "scopeLabel": nosSampleStore, "storeOverrideId": NSNull(), "compareLabel": "前月比",
            "salesTotal": total, "prevSalesTotal": total * 0.93, "grossProfit": total * 0.68, "prevGrossProfit": total * 0.64,
            "storeProfit": total * 0.17, "prevStoreProfit": total * 0.15,
            "avgSpend": 4280, "prevAvgSpend": 4120, "guestCount": (total / 4280).rounded(), "prevGuestCount": (total * 0.93 / 4120).rounded(),
            "transactionCount": (total / 11_800).rounded(), "discountTotal": 38_400,
            "costRatePct": 31.8, "prevCostRatePct": 32.6, "laborRatePct": 27.4, "prevLaborRatePct": 26.9, "flRatePct": 59.2,
            "reservationCount": 212, "walkInCount": 486, "cancelRatePct": 4.2, "includeTakeoutGuests": true,
            "dailyRows": daily, "hourlyChartData": hours,
            "paymentChartData": pays, "categoryChartData": cats, "productRows": productRows, "staffRows": staff,
            "storeComparison": [Any](),
        ]
        m.payload = NOS.decode(NOSReport.self, obj)
        return m
    }
}

extension NPOOrdersModel {
    static func sample(openFirst: Bool = false) -> NPOOrdersModel {
        let m = NPOOrdersModel()
        let today = NOS.today
        func row(_ n: Int, no: Int, place: String, status: String, total: Double, guests: Int, opened: Double, closed: Double?, clerk: String,
                 cash: Double = 0, credit: Double = 0, emoney: Double = 0, refund: Double = 0, ryo: Bool = false) -> [String: Any] {
            ["id": nosSampleId(n), "orderNo": no, "place": place, "status": status, "voided": false, "partiallyRefunded": refund > 0 && status == "paid",
             "total": total, "refundTotal": refund, "discountTotal": 0, "guestCount": guests,
             "openedAt": nosIso(minutesAgo: opened), "closedAt": closed.map { nosIso(minutesAgo: $0) as Any } ?? NSNull(), "clerk": clerk,
             "pay": ["cash": cash, "credit": credit, "emoney": emoney, "points": 0.0, "other": 0.0] as [String: Double], "ryoshushoIssued": ryo]
        }
        let rows: [[String: Any]] = [
            row(1, no: 128, place: "T-4", status: "open", total: 18_700, guests: 5, opened: 95, closed: nil, clerk: "山田 太郎"),
            row(2, no: 127, place: "R-1", status: "paid", total: 32_800, guests: 8, opened: 150, closed: 12, clerk: "佐藤 花子", credit: 32_800, ryo: true),
            row(3, no: 126, place: "T-1", status: "paid", total: 6_424, guests: 4, opened: 120, closed: 30, clerk: "山田 太郎", cash: 6_424),
            row(4, no: 125, place: "C-2", status: "paid", total: 2_340, guests: 1, opened: 90, closed: 41, clerk: "鈴木 一郎", emoney: 2_340),
            row(5, no: 124, place: "T-6", status: "paid", total: 7_260, guests: 3, opened: 200, closed: 75, clerk: "佐藤 花子", cash: 3_000, credit: 4_260, refund: 680),
            row(6, no: 123, place: "テイクアウト", status: "paid", total: 1_980, guests: 0, opened: 210, closed: 205, clerk: "鈴木 一郎", cash: 1_980),
            row(7, no: 122, place: "T-2", status: "refunded", total: 4_800, guests: 2, opened: 260, closed: 180, clerk: "山田 太郎", credit: 4_800, refund: 4_800),
        ]
        let presets: [[String: Any]] = [
            ["label": "今日", "from": today, "to": today], ["label": "昨日", "from": NOS.addDays(today, -1), "to": NOS.addDays(today, -1)],
            ["label": "今週", "from": NOS.monday(today), "to": today], ["label": "今月", "from": NOS.monthFirst(today), "to": today],
            ["label": "過去7日", "from": NOS.addDays(today, -6), "to": today], ["label": "過去30日", "from": NOS.addDays(today, -29), "to": today],
        ]
        let obj: [String: Any] = [
            "store": ["id": nosSampleId(900), "name": nosSampleStore] as [String: String], "today": today, "from": today, "to": today,
            "status": "", "method": "", "q": "", "page": 1, "totalPages": 1, "presets": presets,
            "methods": [["key": "cash", "label": "現金"], ["key": "credit", "label": "クレジット"], ["key": "qr", "label": "QRコード決済"], ["key": "emoney", "label": "電子マネー"]] as [[String: String]],
            "sales": ["settledSales": 55_604, "settledCount": 6, "guests": 18, "perGuest": 3_089, "unsettledCount": 1, "unsettledTotal": 18_700] as [String: Int],
            "orders": rows,
        ]
        if let p = NOS.decode(NOSSlips.self, obj) {
            m.payload = p
            m.rows = p.orders
            m.from = p.from
            m.to = p.to
        }
        if openFirst, let r = m.rows.first(where: { $0.orderNo == 126 }) {
            let detail: [String: Any] = [
                "id": r.id, "orderNo": r.orderNo, "place": r.place, "status": "paid", "guestCount": 4,
                "subtotal": 5_840, "taxTotal": 584, "serviceCharge": 0, "discountTotal": 0, "discountReason": NSNull(), "total": 6_424,
                "openedAt": r.openedAt, "closedAt": r.closedAt ?? NSNull(), "customerName": "山田 様",
                "items": [
                    ["id": "i1", "name": "生ビール（中）", "unitPrice": 600, "quantity": 3, "lineTotal": 1_800, "status": "active", "cancelReason": NSNull()],
                    ["id": "i2", "name": "本日の刺身盛り合わせ", "unitPrice": 1_680, "quantity": 1, "lineTotal": 1_680, "status": "active", "cancelReason": NSNull()],
                    ["id": "i3", "name": "鶏の唐揚げ", "unitPrice": 680, "quantity": 2, "lineTotal": 1_360, "status": "active", "cancelReason": NSNull()],
                    ["id": "i4", "name": "ハイボール", "unitPrice": 500, "quantity": 2, "lineTotal": 1_000, "status": "active", "cancelReason": NSNull()],
                    ["id": "i5", "name": "枝豆", "unitPrice": 380, "quantity": 1, "lineTotal": 380, "status": "cancelled", "cancelReason": "注文まちがい"],
                ] as [[String: Any]],
                "payments": [["id": "p1", "method": "cash", "label": "現金", "amount": 6_424, "tendered": 10_000, "change": 3_576, "paidAt": r.closedAt ?? nosIso(minutesAgo: 30), "status": "completed"]] as [[String: Any]],
                "refunds": [Any](), "totalPaid": 6_424, "totalRefunded": 0, "refundable": 6_424, "hasVoid": false, "ryoshushoIssued": false, "openDerived": NSNull(),
            ]
            m.open = NOSOpenSlip(id: r.id, row: r)
            m.detail = NOS.decode(NOSSlipDetail.self, detail)
        }
        return m
    }
}

extension NPOBudgetsModel {
    static func sample() -> NPOBudgetsModel {
        let m = NPOBudgetsModel()
        let today = NOS.today
        let month = String(today.prefix(7))
        let days = NOS.monthDays(month)
        let elapsed = max(1, Int(today.suffix(2)) ?? 1)
        func row(_ id: String?, _ name: String, editable: Bool, budget: Double, sales: Double, cost: Double, labor: Double, profit: Double, guests: Double) -> [String: Any] {
            let forecast = sales / Double(elapsed) * Double(days.count)
            return ["storeId": id.map { $0 as Any } ?? NSNull(), "storeName": name, "editable": editable,
                    "budget": ["salesBudget": budget, "costRateTarget": 32, "laborRateTarget": 28, "profitTarget": budget * 0.15,
                               "guestsTarget": (budget / 4200).rounded(), "avgSpendTarget": 4200, "note": NSNull()] as [String: Any],
                    "actual": ["sales": sales, "guests": guests, "avgSpend": (sales / max(1, guests)).rounded(), "cost": sales * cost / 100, "costRate": cost,
                               "labor": sales * labor / 100, "laborRate": labor, "expense": sales * 0.12, "profit": profit] as [String: Double],
                    "achievementPct": sales / budget * 100, "forecast": forecast, "forecastPct": forecast / budget * 100]
        }
        let sales = 9_800_000.0 * Double(elapsed) / Double(days.count)
        let obj: [String: Any] = [
            "month": month, "monthFirst": month + "-01", "monthLast": days.last ?? today, "elapsedDays": elapsed, "daysInMonth": days.count,
            "canEdit": true, "includeTakeoutGuests": true,
            "rows": [row(nosSampleId(900), nosSampleStore, editable: true, budget: 9_500_000, sales: sales, cost: 31.4, labor: 27.9, profit: sales * 0.17, guests: (sales / 4280).rounded())] as [[String: Any]],
            "target": ["storeId": nosSampleId(900), "storeName": nosSampleStore, "editable": true, "amount": 9_500_000, "sales": sales, "achievementPct": sales / 9_500_000 * 100] as [String: Any],
            "monthLabel": "今月", "forecastFrom": today,
            "booking": ["course": ["count": 14, "guests": 62, "amount": 372_000] as [String: Int], "seatOnly": ["count": 38, "guests": 104, "amount": 445_120] as [String: Int], "total": 817_120] as [String: Any],
            "singleUnit": ["unit": 4280, "basis": "seat_only", "samples": 212] as [String: Any], "landing": sales + 817_120, "seatOnlyUnitDays": 28,
        ]
        m.month = month
        m.payload = NOS.decode(NOSBudgets.self, obj)
        return m
    }
}

extension NPOBudgetDailyModel {
    static func sample() -> NPOBudgetDailyModel {
        let m = NPOBudgetDailyModel()
        let month = String(NOS.today.prefix(7))
        var values: [String: Double] = [:]
        for d in NOS.monthDays(month) {
            let w = NOS.weekday(d)
            values[d] = w == 5 || w == 6 ? 420_000 : w == 0 ? 350_000 : 260_000
        }
        let obj: [String: Any] = ["store": ["id": nosSampleId(900), "name": nosSampleStore] as [String: String], "month": month, "values": values, "canEdit": true, "target": 9_500_000]
        m.month = month
        if let p = NOS.decode(NOSBudgetDaily.self, obj) {
            m.payload = p
            var ints: [String: Int] = [:]
            for (k, v) in p.values { ints[k] = Int(v) }
            m.saved = ints
            m.values = ints
            // 1 日だけ直した（未保存）見本
            if let d = NOS.monthDays(month).dropFirst(2).first { m.values[d] = 300_000 }
        }
        return m
    }
}

/// -tenpoNativePreview owner… のときの画面
struct NativePhoneOwnerSalesPreview: View {
    let kind: String
    @StateObject private var reports = NPOReportsModel.sample()
    @StateObject private var orders = NPOOrdersModel.sample()
    @StateObject private var slip = NPOOrdersModel.sample(openFirst: true)
    @StateObject private var budgets = NPOBudgetsModel.sample()
    @StateObject private var daily = NPOBudgetDailyModel.sample()

    var body: some View {
        switch kind {
        case "ownerOrders":
            NativePhoneOwnerOrdersView(model: orders, onBack: {}, onWeb: { _ in })
        case "ownerSlip":
            NativePhoneOwnerOrdersView(model: slip, onBack: {}, onWeb: { _ in })
        case "ownerBudgets":
            NativePhoneOwnerBudgetsView(model: budgets, onBack: {}, onWeb: { _ in })
        case "ownerBudgetDaily":
            NativePhoneOwnerBudgetDailyView(model: daily, onBack: {}, onWeb: { _ in })
        default:
            NativePhoneOwnerReportsView(model: reports, onBack: {}, onWeb: { _ in })
        }
    }
}
