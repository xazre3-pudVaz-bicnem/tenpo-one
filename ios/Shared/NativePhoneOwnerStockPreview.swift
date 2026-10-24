import SwiftUI

// iPhone の店長・オーナー：在庫・品切れ・仕入先・発注・原価管理の見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）
//   -tenpoNativePreview phoneOwnerInventory | phoneOwnerInventoryItem | phoneOwnerInventoryCount | phoneOwnerInventoryReorder
//                       phoneOwnerStock | phoneOwnerVendors | phoneOwnerVendor | phoneOwnerPurchases | phoneOwnerPurchase | phoneOwnerPurchaseNew
//                       phoneOwnerCosting | phoneOwnerCostingItem
// 名前・店舗・仕入先はすべて作りもの（実在の人・お店・会社ではありません）。

private enum NPZSample {
    static func id(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }
    static func iso(minutesAgo: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date().addingTimeInterval(-minutesAgo * 60))
    }
    static func day(_ offset: Int) -> String { NOS.addDays(NOS.today, offset) }
    static let store: [String: Any] = ["id": id(900), "name": "TENPO ONE 新宿店"]
    static let otherStores: [[String: Any]] = [["id": id(901), "name": "TENPO ONE 渋谷店"], ["id": id(902), "name": "TENPO ONE 池袋店"]]
    static func nz(_ v: Any?) -> Any { v ?? NSNull() }
}

// MARK: - 在庫

extension NPZInventoryModel {
    private static func sampleItem(_ n: Int, _ name: String, _ kind: String, _ category: String?, _ unit: String, _ qty: Double,
                                   reorder: Double?, min: Double?, optimal: Double?, avg: Double?, last: Double?,
                                   pu: String? = nil, factor: Double = 1, warning: String? = nil, priceUp: Bool = false) -> [String: Any] {
        [
            "id": NPZSample.id(n), "name": name, "itemKind": kind, "category": NPZSample.nz(category), "unit": unit, "currentQuantity": qty,
            "reorderPoint": NPZSample.nz(reorder), "minQuantity": NPZSample.nz(min), "optimalQuantity": NPZSample.nz(optimal),
            "avgCost": NPZSample.nz(avg), "lastPurchaseCost": NPZSample.nz(last), "purchaseUnit": NPZSample.nz(pu), "purchaseToStockFactor": factor,
            "warning": NPZSample.nz(warning), "priceUp": priceUp, "stockValue": (qty * (avg ?? 0)).rounded(),
        ]
    }

    static func sample(tab: String = "items") -> NPZInventoryModel {
        let m = NPZInventoryModel()
        m.tab = tab
        let items: [[String: Any]] = [
            sampleItem(1, "鶏もも肉", "ingredient", "肉", "g", 1800, reorder: 3000, min: 1500, optimal: 8000, avg: 1.2, last: 1.35, pu: "kg", factor: 1000, warning: "warning", priceUp: true),
            sampleItem(2, "生ビール樽（10L）", "product", "ドリンク", "本", 1, reorder: 2, min: 1, optimal: 6, avg: 7800, last: 7800, warning: "danger"),
            sampleItem(3, "玉ねぎ", "ingredient", "野菜", "個", 42, reorder: 20, min: 10, optimal: 60, avg: 38, last: 40),
            sampleItem(4, "サラダ油", "ingredient", "調味料", "ml", 5200, reorder: 3000, min: 1000, optimal: 9000, avg: 0.42, last: 0.42, pu: "L", factor: 1000),
            sampleItem(5, "おしぼり", "supply", "備品", "枚", 120, reorder: 200, min: 100, optimal: 600, avg: 6, last: 6, warning: "warning"),
            sampleItem(6, "本日の鮮魚（刺身用）", "ingredient", "魚", "g", 2400, reorder: nil, min: nil, optimal: 3000, avg: 4.5, last: 4.9),
            sampleItem(7, "レモン", "ingredient", "果物", "個", 35, reorder: 15, min: 8, optimal: 50, avg: 52, last: 50),
        ]
        let base: [String: Any] = ["store": NPZSample.store, "canWrite": true, "canTransfer": true, "otherStores": NPZSample.otherStores,
                                   "units": ["個", "g", "kg", "ml", "L", "本", "枚", "袋", "箱"]]
        func payload(_ t: String, _ extra: [String: Any]) -> NPZInvPayload? {
            var d = base
            d["tab"] = t
            for (k, v) in extra { d[k] = v }
            return NOS.decode(NPZInvPayload.self, d)
        }
        m.payloads["items"] = payload("items", [
            "items": items,
            "stats": ["totalStockValue": 41_380, "reorderCount": 3, "dangerCount": 1, "priceUpCount": 1] as [String: Any],
            "reorderList": [NPZSample.id(2), NPZSample.id(5), NPZSample.id(1)],
        ])
        m.payloads["counts"] = payload("counts", [
            "counts": [
                ["id": NPZSample.id(301), "countDate": NPZSample.day(0), "status": "draft"],
                ["id": NPZSample.id(302), "countDate": NPZSample.day(-30), "status": "completed"],
                ["id": NPZSample.id(303), "countDate": NPZSample.day(-61), "status": "completed"],
            ] as [[String: Any]],
        ])
        m.payloads["transfers"] = payload("transfers", [
            "transfers": [
                ["id": NPZSample.id(401), "transferNo": 18, "fromStoreId": NPZSample.id(900), "fromStoreName": "TENPO ONE 新宿店", "toStoreId": NPZSample.id(901),
                 "toStoreName": "TENPO ONE 渋谷店", "status": "requested", "note": "週末の団体予約の分", "requestedByName": "山田 太郎", "shippedByName": NSNull(),
                 "receivedByName": NSNull(), "createdAt": NPZSample.iso(minutesAgo: 90),
                 "items": [["id": "l1", "name": "鶏もも肉", "quantity": 2000, "unit": "g"], ["id": "l2", "name": "レモン", "quantity": 10, "unit": "個"]] as [[String: Any]]],
                ["id": NPZSample.id(402), "transferNo": 17, "fromStoreId": NPZSample.id(902), "fromStoreName": "TENPO ONE 池袋店", "toStoreId": NPZSample.id(900),
                 "toStoreName": "TENPO ONE 新宿店", "status": "shipped", "note": NSNull(), "requestedByName": "佐藤 花子", "shippedByName": "鈴木 一郎",
                 "receivedByName": NSNull(), "createdAt": NPZSample.iso(minutesAgo: 60 * 26),
                 "items": [["id": "l3", "name": "生ビール樽（10L）", "quantity": 2, "unit": "本"]] as [[String: Any]]],
            ] as [[String: Any]],
        ])
        m.payloads["reorder"] = payload("reorder", [
            "reorder": [
                ["id": NPZSample.id(2), "name": "生ビール樽（10L）", "unit": "本", "currentQuantity": 1, "avgDailySales": 0.8, "incomingQuantity": 0, "needed": true, "suggestedQuantity": 5,
                 "basis": "適正在庫6本 − 現在庫1本（入荷待ち0本）"],
                ["id": NPZSample.id(5), "name": "おしぼり", "unit": "枚", "currentQuantity": 120, "avgDailySales": 35, "incomingQuantity": 0, "needed": true, "suggestedQuantity": 480,
                 "basis": "適正在庫600枚 − 現在庫120枚"],
                ["id": NPZSample.id(1), "name": "鶏もも肉", "unit": "g", "currentQuantity": 1800, "avgDailySales": 900, "incomingQuantity": 2000, "needed": true, "suggestedQuantity": 4200,
                 "basis": "適正在庫8000g − 現在庫1800g − 入荷待ち2000g"],
                ["id": NPZSample.id(3), "name": "玉ねぎ", "unit": "個", "currentQuantity": 42, "avgDailySales": 6, "incomingQuantity": 0, "needed": false, "suggestedQuantity": 0,
                 "basis": "発注点を上回っています"],
            ] as [[String: Any]],
        ])
        let weekdays: [[String: Any]] = [("日", 1300.0), ("月", 650.0), ("火", 700.0), ("水", 720.0), ("木", 860.0), ("金", 1500.0), ("土", 1650.0)].map { ["weekday": $0.0, "avg": $0.1] as [String: Any] }
        m.forecastItem = NPZSample.id(1)
        m.payloads["forecast"] = payload("forecast", [
            "forecast": [
                "itemOptions": items.map { ["id": $0["id"] ?? "", "name": $0["name"] ?? ""] as [String: Any] },
                "result": ["tomorrow": 1500, "thisWeekRemaining": 3150, "nextWeek": 7380, "lowConfidence": false] as [String: Any],
                "weekdayChart": weekdays, "unit": "g", "selectedName": "鶏もも肉",
                "top": [
                    ["id": NPZSample.id(1), "name": "鶏もも肉", "unit": "g", "tomorrow": 1500],
                    ["id": NPZSample.id(3), "name": "玉ねぎ", "unit": "個", "tomorrow": 8],
                    ["id": NPZSample.id(7), "name": "レモン", "unit": "個", "tomorrow": 12],
                ] as [[String: Any]],
            ] as [String: Any],
        ])
        let first = NPZSample.id(1)
        let hist: [[String: Any]] = [
            ["id": "h1", "movementType": "sale", "quantity": -640, "reason": NSNull(), "occurredAt": NPZSample.iso(minutesAgo: 50), "toStoreName": NSNull()],
            ["id": "h2", "movementType": "in", "quantity": 2000, "reason": "発注書 #41 の入荷", "occurredAt": NPZSample.iso(minutesAgo: 60 * 20), "toStoreName": NSNull()],
            ["id": "h3", "movementType": "waste", "quantity": -300, "reason": "期限切れ", "occurredAt": NPZSample.iso(minutesAgo: 60 * 30), "toStoreName": NSNull()],
            ["id": "h4", "movementType": "transfer_out", "quantity": -1000, "reason": "応援", "occurredAt": NPZSample.iso(minutesAgo: 60 * 52), "toStoreName": "TENPO ONE 渋谷店"],
        ]
        m.histories[first] = hist.compactMap { NOS.decode(NPZInvHistRow.self, $0) }
        m.purchases[first] = NOS.decode(NPZInvPurchases.self, [
            "unit": "g", "currentAvgCost": 1.2, "previousUnitCost": 1.35, "priorUnitCost": 1.18, "changeRatePct": 14.4, "isSignificantIncrease": true,
            "rows": [
                ["id": "p1", "businessDate": NPZSample.day(-1), "vendorName": "TENPO ONE 精肉（見本）", "unitCost": 1.35, "quantity": 2000],
                ["id": "p2", "businessDate": NPZSample.day(-8), "vendorName": "TENPO ONE 精肉（見本）", "unitCost": 1.18, "quantity": 3000],
                ["id": "p3", "businessDate": NPZSample.day(-15), "vendorName": NSNull(), "unitCost": 1.2, "quantity": 1000],
            ] as [[String: Any]],
        ] as [String: Any])
        return m
    }
}

extension NPZCountModel {
    static func sample() -> NPZCountModel {
        let m = NPZCountModel(id: NPZSample.id(301))
        let rows: [(String, String, Double, Double?)] = [
            ("おしぼり", "枚", 120, 118), ("サラダ油", "ml", 5200, 5000), ("レモン", "個", 35, 35), ("本日の鮮魚（刺身用）", "g", 2400, nil),
            ("生ビール樽（10L）", "本", 1, 1), ("玉ねぎ", "個", 42, nil), ("鶏もも肉", "g", 1800, 1650),
        ]
        var items: [[String: Any]] = []
        for (i, r) in rows.enumerated() {
            items.append(["id": NPZSample.id(500 + i), "name": r.0, "unit": r.1, "expectedQuantity": r.2, "countedQuantity": i < 3 ? NPZSample.nz(r.3) : (NSNull() as Any)])
        }
        let obj: [String: Any] = ["id": NPZSample.id(301), "countDate": NPZSample.day(0), "status": "draft", "storeName": "TENPO ONE 新宿店", "canWrite": true, "items": items]
        if let d = NOS.decode(NPZInvCountDetail.self, obj) {
            m.apply(d, keepInput: false)
            // 保存していない入力（2 品）
            m.set(NPZSample.id(504), 1)
            m.set(NPZSample.id(506), 1650)
        }
        return m
    }
}

// MARK: - 品切れ・残り数

extension NPZStockModel {
    static func sample() -> NPZStockModel {
        let m = NPZStockModel()
        let food = NPZSample.id(601)
        let drink = NPZSample.id(602)
        let course = NPZSample.id(603)
        let obj: [String: Any] = [
            "store": NPZSample.store,
            "groups": [
                ["key": "food", "name": "フード", "categories": [["id": food, "name": "おすすめ"], ["id": course, "name": "コース"]]],
                ["key": "drink", "name": "ドリンク", "categories": [["id": drink, "name": "ビール・サワー"]]],
            ] as [[String: Any]],
            "items": [
                ["id": NPZSample.id(611), "name": "本日の刺身盛り合わせ", "categoryId": food, "limit": 12, "sold": 7],
                ["id": NPZSample.id(612), "name": "和牛の炙り", "categoryId": food, "limit": 8, "sold": 8],
                ["id": NPZSample.id(613), "name": "鶏の唐揚げ", "categoryId": food, "limit": NSNull(), "sold": 14],
                ["id": NPZSample.id(614), "name": "季節の天ぷら", "categoryId": food, "limit": 10, "sold": 2],
                ["id": NPZSample.id(615), "name": "だし巻き玉子", "categoryId": food, "limit": NSNull(), "sold": 0],
                ["id": NPZSample.id(616), "name": "おまかせコース", "categoryId": course, "limit": 6, "sold": 2],
                ["id": NPZSample.id(617), "name": "生ビール（中）", "categoryId": drink, "limit": NSNull(), "sold": 31],
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NPZStockPayload.self, obj)
        m.category = food
        // 登録前の変更（1 品）
        if let i = m.payload?.items.first(where: { $0.id == NPZSample.id(614) }) { m.set(i, NPZStockDraft(on: true, remaining: 6)) }
        return m
    }
}

// MARK: - 仕入先・発注

extension NPZVendorsModel {
    static func sample(open: Bool = false) -> NPZVendorsModel {
        let m = NPZVendorsModel()
        func v(_ n: Int, _ name: String, _ kana: String?, _ contact: String?, _ phone: String?, _ email: String?, status: String, invoice: Double, purchase: Double, po: Int) -> [String: Any] {
            ["id": NPZSample.id(n), "name": name, "nameKana": NPZSample.nz(kana), "contactName": NPZSample.nz(contact), "phone": NPZSample.nz(phone), "email": NPZSample.nz(email),
             "address": "東京都新宿区（見本）", "closingDay": 31, "paymentDay": 25, "bankInfo": "見本銀行 新宿支店 普通 0000000", "note": "毎週月・木に配送（見本）",
             "status": status, "monthlyInvoiceTotal": invoice, "monthlyPurchaseTotal": purchase, "activePoCount": po]
        }
        let obj: [String: Any] = [
            "canManage": true,
            "rows": [
                v(701, "TENPO ONE 精肉（見本）", "テンポワン セイニク", "山田 太郎", "03-0000-0001", "meat@example.com", status: "active", invoice: 184_200, purchase: 162_800, po: 2),
                v(702, "TENPO ONE 青果（見本）", "テンポワン セイカ", "佐藤 花子", "03-0000-0002", nil, status: "active", invoice: 96_500, purchase: 88_000, po: 1),
                v(703, "TENPO ONE 酒販（見本）", "テンポワン シュハン", "鈴木 一郎", "03-0000-0003", "drink@example.com", status: "active", invoice: 240_000, purchase: 231_000, po: 0),
                v(704, "TENPO ONE 備品（見本）", nil, nil, nil, nil, status: "inactive", invoice: 0, purchase: 0, po: 0),
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NPZVendorsPayload.self, obj)
        let first = NPZSample.id(701)
        let orders: [[String: Any]] = [
            ["id": NPZSample.id(801), "poNo": 42, "status": "ordered", "total": 26_400, "expectedAt": NPZSample.day(1)],
            ["id": NPZSample.id(802), "poNo": 41, "status": "received", "total": 31_900, "expectedAt": NPZSample.day(-6)],
            ["id": NPZSample.id(803), "poNo": 38, "status": "received", "total": 28_600, "expectedAt": NPZSample.day(-13)],
        ]
        m.orders[first] = orders.compactMap { NOS.decode(NPZVendorOrder.self, $0) }
        if open { m.open = m.payload?.rows.first }
        return m
    }
}

private func npzSamplePo() -> [String: Any] {
    [
        "id": NPZSample.id(801), "poNo": 42, "status": "ordered", "storeId": NPZSample.id(900), "vendorName": "TENPO ONE 精肉（見本）", "storeName": "TENPO ONE 新宿店",
        "storeAddress": "東京都新宿区（見本）", "storePhone": "03-0000-0000", "total": 26_400, "taxTotal": 1_955, "subtotal": 24_445,
        "expectedAt": NPZSample.day(1), "orderedAt": NPZSample.iso(minutesAgo: 60 * 5), "createdAt": NPZSample.iso(minutesAgo: 60 * 6), "note": "午前中に納品（見本）",
        "requiredApprovalRoleLabel": NSNull(),
        "items": [
            ["id": "pi1", "name": "鶏もも肉", "quantity": 5, "unit": "kg", "unitCost": 1_350, "taxRate": 8, "receivedQuantity": 2, "stockUnit": "g", "factor": 1000],
            ["id": "pi2", "name": "豚バラ肉", "quantity": 3, "unit": "kg", "unitCost": 1_580, "taxRate": 8, "receivedQuantity": 0, "stockUnit": "g", "factor": 1000],
            ["id": "pi3", "name": "牛すじ", "quantity": 2, "unit": "kg", "unitCost": 1_200, "taxRate": 8, "receivedQuantity": 2, "stockUnit": "kg", "factor": 1],
        ] as [[String: Any]],
    ]
}

extension NPZPurchasesModel {
    static func sample(open: Bool = false) -> NPZPurchasesModel {
        let m = NPZPurchasesModel()
        func r(_ n: Int, _ no: Int, _ status: String, _ total: Double, _ vendor: String, expected: Int?, by: String) -> [String: Any] {
            ["id": NPZSample.id(n), "poNo": no, "status": status, "total": total, "expectedAt": expected.map { NPZSample.day($0) as Any } ?? NSNull(),
             "vendorName": vendor, "storeName": "TENPO ONE 新宿店", "requesterName": by, "createdAt": NPZSample.iso(minutesAgo: Double(no) * 60)]
        }
        let obj: [String: Any] = [
            "canManage": true, "canCsv": true, "storeId": NPZSample.id(900),
            "vendors": [["id": NPZSample.id(701), "name": "TENPO ONE 精肉（見本）"], ["id": NPZSample.id(702), "name": "TENPO ONE 青果（見本）"]] as [[String: Any]],
            "rows": [
                r(804, 44, "draft", 12_960, "TENPO ONE 青果（見本）", expected: 3, by: "佐藤 花子"),
                r(805, 43, "requested", 58_300, "TENPO ONE 酒販（見本）", expected: 2, by: "鈴木 一郎"),
                r(801, 42, "ordered", 26_400, "TENPO ONE 精肉（見本）", expected: 1, by: "山田 太郎"),
                r(806, 40, "partially_received", 18_700, "TENPO ONE 青果（見本）", expected: -1, by: "佐藤 花子"),
                r(802, 41, "received", 31_900, "TENPO ONE 精肉（見本）", expected: -6, by: "山田 太郎"),
                r(807, 39, "cancelled", 4_400, "TENPO ONE 備品（見本）", expected: nil, by: "山田 太郎"),
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NPZPurchasesPayload.self, obj)
        if open {
            let id = NPZSample.id(801)
            m.details[id] = NOS.decode(NPZPoPayload.self, ["po": npzSamplePo(), "canManage": true] as [String: Any])
            m.openId = id
        }
        return m
    }

    static func sampleNew() -> NPZPoNewPayload? {
        NOS.decode(NPZPoNewPayload.self, [
            "store": NPZSample.store,
            "vendors": [["id": NPZSample.id(701), "name": "TENPO ONE 精肉（見本）"], ["id": NPZSample.id(702), "name": "TENPO ONE 青果（見本）"]] as [[String: Any]],
            "items": [
                ["id": NPZSample.id(1), "name": "鶏もも肉", "unit": "g", "avgCost": 1.2, "purchaseUnit": "kg"],
                ["id": NPZSample.id(2), "name": "生ビール樽（10L）", "unit": "本", "avgCost": 7800, "purchaseUnit": NSNull()],
                ["id": NPZSample.id(5), "name": "おしぼり", "unit": "枚", "avgCost": 6, "purchaseUnit": NSNull()],
            ] as [[String: Any]],
        ] as [String: Any])
    }
}

// MARK: - 原価管理

extension NPZCostingModel {
    static func sample(open: Bool = false) -> NPZCostingModel {
        let m = NPZCostingModel()
        func row(_ n: Int, _ name: String, _ cat: String, _ price: Double, recipe: Double?, manual: Double? = nil, count: Int, missing: Int = 0) -> [String: Any] {
            let display = recipe ?? manual
            let rate = display.flatMap { NPZCoMath.costRate($0, price) }
            return ["id": NPZSample.id(n), "name": name, "categoryName": cat, "itemType": "food", "itemTypeLabel": "フード", "price": price,
                    "manualCost": NPZSample.nz(manual), "recipeCost": NPZSample.nz(recipe), "ingredientCount": count, "missingCostCount": missing,
                    "displayCost": NPZSample.nz(display), "costRate": NPZSample.nz(rate), "grossProfitYen": NPZSample.nz(display.map { price - $0 }),
                    "grossProfitRate": NPZSample.nz(display.flatMap { NPZCoMath.costRate(price - $0, price) })]
        }
        let obj: [String: Any] = [
            "store": NPZSample.store, "canExport": true,
            "summary": ["avgCostRate": 31.6, "recipeSetCount": 5, "warningCount": 2, "total": 7] as [String: Any],
            "categories": [["id": NPZSample.id(601), "name": "おすすめ"], ["id": NPZSample.id(604), "name": "揚げ物"]] as [[String: Any]],
            "rows": [
                row(901, "和牛の炙り", "おすすめ", 1_280, recipe: 560, count: 3),
                row(902, "本日の刺身盛り合わせ", "おすすめ", 1_680, recipe: 610, count: 4, missing: 1),
                row(903, "鶏の唐揚げ", "揚げ物", 680, recipe: 192, count: 4),
                row(904, "だし巻き玉子", "おすすめ", 580, recipe: 118, count: 3),
                row(905, "季節の天ぷら", "揚げ物", 980, recipe: 330, count: 5),
                row(906, "自家製ポテトサラダ", "おすすめ", 480, recipe: nil, manual: 120, count: 0),
                row(907, "〆の焼きおにぎり", "おすすめ", 380, recipe: nil, count: 0),
            ] as [[String: Any]],
        ]
        m.items = NOS.decode(NPZCoItemsPayload.self, obj)
        if open { m.openId = NPZSample.id(903) }
        return m
    }
}

extension NPZCoItemModel {
    static func sample() -> NPZCoItemModel {
        let m = NPZCoItemModel(menuItemId: NPZSample.id(903))
        let lines: [[String: Any]] = [
            ["id": "r1", "inventoryItemId": NPZSample.id(1), "ingredientName": "鶏もも肉", "unit": "g", "quantity": 120, "avgCost": 1.2, "lineCost": 144, "note": "1人前"],
            ["id": "r2", "inventoryItemId": NPZSample.id(4), "ingredientName": "サラダ油", "unit": "ml", "quantity": 40, "avgCost": 0.42, "lineCost": 17, "note": NSNull()],
            ["id": "r3", "inventoryItemId": NPZSample.id(7), "ingredientName": "レモン", "unit": "個", "quantity": 0.25, "avgCost": 52, "lineCost": 13, "note": "くし切り"],
            ["id": "r4", "inventoryItemId": NPZSample.id(8), "ingredientName": "下味（醤油・生姜）", "unit": "g", "quantity": 15, "avgCost": 1.2, "lineCost": 18, "note": NSNull()],
        ]
        let obj: [String: Any] = [
            "item": ["id": NPZSample.id(903), "name": "鶏の唐揚げ", "itemType": "food", "itemTypeLabel": "フード", "price": 680, "manualCost": 200] as [String: Any],
            "recipeCost": 192, "displayCost": 192, "costRate": 28.2, "grossProfit": 488, "grossProfitRate": 71.8, "missingCostCount": 0,
            "lines": lines,
            "ingredientOptions": [
                ["id": NPZSample.id(1), "name": "鶏もも肉", "unit": "g", "avgCost": 1.2],
                ["id": NPZSample.id(3), "name": "玉ねぎ", "unit": "個", "avgCost": 38],
                ["id": NPZSample.id(4), "name": "サラダ油", "unit": "ml", "avgCost": 0.42],
                ["id": NPZSample.id(7), "name": "レモン", "unit": "個", "avgCost": 52],
                ["id": NPZSample.id(8), "name": "下味（醤油・生姜）", "unit": "g", "avgCost": 1.2],
            ] as [[String: Any]],
        ]
        m.payload = NOS.decode(NPZCoItemPayload.self, obj)
        return m
    }
}

// MARK: - 見本の画面

struct NPZStockPreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "inventoryItem": NPZInvItemPreview()
        case "inventoryCount": NPZCountView(countId: NPZSample.id(301), storeName: "TENPO ONE 新宿店", sample: NPZCountModel.sample(), onClose: { _ in })
        case "inventoryReorder": NPZInventoryPreview(tab: "reorder")
        case "stock": NPZStockScreenPreview()
        case "vendors": NPZVendorsPreview(open: false)
        case "vendor": NPZVendorsPreview(open: true)
        case "purchases": NPZPurchasesPreview(open: false)
        case "purchase": NPZPurchasesPreview(open: true)
        case "purchaseNew":
            NPZPoNewSheet(start: NPZPoNewRef(items: [(NPZSample.id(1), 5), (NPZSample.id(5), 480)]), onClose: {}, onCreated: { _ in }, sample: NPZPurchasesModel.sampleNew())
        case "costing": NPZCostingPreview(open: false)
        case "costingItem": NPZCostingPreview(open: true)
        default: NPZInventoryPreview(tab: "items")
        }
    }
}

private struct NPZInventoryPreview: View {
    @StateObject private var model: NPZInventoryModel
    init(tab: String) { _model = StateObject(wrappedValue: NPZInventoryModel.sample(tab: tab)) }
    var body: some View { NativePhoneInventoryView(model: model, onBack: {}, onOpen: { _ in }) }
}

private struct NPZInvItemPreview: View {
    @StateObject private var model = NPZInventoryModel.sample()
    var body: some View {
        if let it = model.payloads["items"]?.items?.first {
            NPZInvItemSheet(model: model, itemId: it.id, fallback: it, onClose: {}, onOpen: { _ in })
        }
    }
}

private struct NPZStockScreenPreview: View {
    @StateObject private var model = NPZStockModel.sample()
    var body: some View { NativePhoneStockView(model: model, onBack: {}, onOpen: { _ in }) }
}

private struct NPZVendorsPreview: View {
    @StateObject private var model: NPZVendorsModel
    init(open: Bool) { _model = StateObject(wrappedValue: NPZVendorsModel.sample(open: open)) }
    var body: some View { NativePhoneVendorsView(model: model, onBack: {}, onOpen: { _ in }) }
}

private struct NPZPurchasesPreview: View {
    @StateObject private var model: NPZPurchasesModel
    init(open: Bool) { _model = StateObject(wrappedValue: NPZPurchasesModel.sample(open: open)) }
    var body: some View { NativePhonePurchasesView(model: model, onBack: {}, onOpen: { _ in }) }
}

private struct NPZCostingPreview: View {
    @StateObject private var model: NPZCostingModel
    @StateObject private var item = NPZCoItemModel.sample()
    init(open: Bool) { _model = StateObject(wrappedValue: NPZCostingModel.sample(open: open)) }
    var body: some View { NativePhoneCostingView(model: model, onBack: {}, onOpen: { _ in }, sampleItem: item) }
}
