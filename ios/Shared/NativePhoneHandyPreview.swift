import SwiftUI

// iPhone ハンディの卓・注文の見本（シミュレーターで形を確かめる用。-tenpoNativePreview phoneTable|phoneOrder|phoneConfirm）

extension NativePhoneTableModel {
    static func sample() -> NativePhoneTableModel {
        let m = NativePhoneTableModel(tableId: "00000000-0000-4000-8000-000000000001")
        let now = Date().timeIntervalSince1970 * 1000
        let items = [
            NPHItem(id: "a", name: "生ビール（中）", quantity: 3, unitPrice: 600, lineTotal: 1800, optionLabel: nil, sentAt: now - 60_000 * 42, orderedAt: now - 60_000 * 42),
            NPHItem(id: "b", name: "本日の刺身盛り合わせ", quantity: 1, unitPrice: 1680, lineTotal: 1680, optionLabel: "3点盛り", sentAt: now - 60_000 * 30, orderedAt: now - 60_000 * 30),
            NPHItem(id: "c", name: "鶏の唐揚げ", quantity: 2, unitPrice: 680, lineTotal: 1360, optionLabel: "レモン別添え", sentAt: now - 60_000 * 2, orderedAt: now - 60_000 * 2),
            NPHItem(id: "d", name: "ハイボール", quantity: 2, unitPrice: 500, lineTotal: 1000, optionLabel: nil, sentAt: now - 60_000, orderedAt: now - 60_000),
        ]
        let slip = NPHSlip(id: "00000000-0000-4000-8000-0000000000aa", orderNo: 101, guestCount: 4, openedAt: now - 60_000 * 48,
                           subtotal: 5840, discountTotal: 0, total: 6424, endsAt: now + 60_000 * 25, items: items)
        m.payload = NPHTablePayload(ok: true, hostTableId: nil, table: NPHTableInfo(id: m.tableId, name: "T-1", capacityMax: 4, status: "seated"),
                                    clerk: NHDNamed(id: "k", name: "佐藤"), slips: [slip],
                                    calls: [NPHCall(id: "call1", kind: "staff", note: "お水ください", createdAt: now - 60_000 * 3)],
                                    serverNow: now, cancelWindowMs: 300_000, extendOptions: [30, 60, 90, 120])
        return m
    }
}

extension NativePhoneOrderModel {
    static func sample() -> NativePhoneOrderModel {
        let m = NativePhoneOrderModel(orderId: "00000000-0000-4000-8000-0000000000aa")
        func item(_ id: String, _ name: String, _ price: Double, options: Bool = false, soldOut: Bool = false) -> NPHMenuItem {
            NPHMenuItem(id: id, categoryId: nil, name: name, nameEn: nil, price: price, itemType: "food", isSoldOut: soldOut, offHours: false, hasOptions: options, revealedBy: nil)
        }
        let rec = NPHCategory(id: "c1", name: "おすすめ", nameEn: nil, tabId: "alacarte", items: [
            item("i1", "本日の刺身盛り合わせ", 1680, options: true), item("i2", "自家製ポテトサラダ", 480), item("i3", "和牛の炙り", 1280),
            item("i4", "だし巻き玉子", 580), item("i5", "鶏の唐揚げ", 680), item("i6", "枝豆", 380), item("i7", "冷やしトマト", 420, soldOut: true),
            item("i8", "〆の焼きおにぎり", 380),
        ])
        let yaki = NPHCategory(id: "c2", name: "焼き鳥", nameEn: nil, tabId: "alacarte", items: [item("y1", "もも", 180), item("y2", "ねぎま", 180), item("y3", "つくね", 220)])
        let age = NPHCategory(id: "c3", name: "揚げ物", nameEn: nil, tabId: "alacarte", items: [item("a1", "ポテトフライ", 450)])
        let salad = NPHCategory(id: "c4", name: "サラダ", nameEn: nil, tabId: "alacarte", items: [item("s1", "シーザーサラダ", 680)])
        let drink = NPHCategory(id: "d1", name: "ビール", nameEn: nil, tabId: "alacarte", items: [item("b1", "生ビール（中）", 600), item("b2", "瓶ビール", 650)])
        let course = NPHCategory(id: "k1", name: "コース", nameEn: nil, tabId: "plan", items: [item("k1i", "おまかせコース", 5000, options: true)])
        let p = NPHMenuPayload(ok: true, order: NPHOrderInfo(id: m.orderId, orderNo: 101, tableId: nil, tableName: "T-1", guestCount: 4, total: 6424),
                               clerk: NHDNamed(id: "k", name: "佐藤"),
                               pages: [NPHPage(key: "d1", name: "DRINK", label: "ドリンク", categories: [drink], hasPlanContent: false),
                                       NPHPage(key: "c1", name: "FOOD", label: "フード", categories: [rec, yaki, age, salad], hasPlanContent: false),
                                       NPHPage(key: "k1", name: "COURSE", label: "コース", categories: [course], hasPlanContent: true)],
                               initialPageKey: "c1",
                               optionGroupsByItem: [
                                "i1": [NPHOptionGroup(id: "g1", name: "盛り", isRequired: true, minSelect: 1, maxSelect: 1,
                                                      items: [NPHOptionItem(id: "o1", name: "3点盛り", nameEn: nil, price: 0), NPHOptionItem(id: "o2", name: "5点盛り", nameEn: nil, price: 600)])],
                                "k1i": [NPHOptionGroup(id: "g2", name: "メイン選択", isRequired: true, minSelect: 1, maxSelect: 1,
                                                       items: [NPHOptionItem(id: "m1", name: "和牛ステーキ", nameEn: nil, price: 0), NPHOptionItem(id: "m2", name: "鯛の塩釜", nameEn: nil, price: 500)])],
                               ])
        m.payload = p
        m.pageKey = "c1"
        if let i1 = rec.items.first { m.add(i1, options: ["o1"]) }
        m.add(rec.items[4]); m.add(rec.items[4]); m.add(rec.items[5])
        return m
    }
}

extension NativePhoneSetupModel {
    static func sample() -> NativePhoneSetupModel {
        let m = NativePhoneSetupModel(tableId: "00000000-0000-4000-8000-000000000002")
        m.payload = NPHSetupPayload(ok: true, hostTableId: nil, table: NPHTableInfo(id: m.tableId, name: "T-3", capacityMax: 4, status: nil),
                                    clerk: NHDNamed(id: "k", name: "佐藤"),
                                    planItems: [NPHPlanItem(id: "p1", name: "飲み放題 120分", price: 1800, durationMinutes: 120, kind: "drink"),
                                                NPHPlanItem(id: "p2", name: "プレミアム飲み放題", price: 2500, durationMinutes: 120, kind: "drink"),
                                                NPHPlanItem(id: "p3", name: "おまかせコース", price: 5000, durationMinutes: 150, kind: "course")],
                                    plans: [NPHPlanMode(id: "normal", name: "アラカルト"), NPHPlanMode(id: "drink", name: "飲み放題"),
                                            NPHPlanMode(id: "buffet", name: "食べ放題"), NPHPlanMode(id: "food", name: "食べ飲み放題"), NPHPlanMode(id: "course", name: "コース")],
                                    sources: ["フリー", "電話", "食べログ", "ホットペッパー", "ぐるなび", "Google"])
        m.male = 2; m.female = 1
        m.toggleMode("drink")
        if let p = m.payload?.planItems?.first { m.togglePlanItem(p) }
        return m
    }
}

extension NativeHandyModel {
    static func sample() -> NativeHandyModel {
        let m = NativeHandyModel()
        let now = Date().timeIntervalSince1970 * 1000
        let f1 = "f1", f2 = "f2"
        func t(_ i: Int, _ name: String, floor: String, status: String?, orders: Int = 0, min: Double = 0, guests: Int = 0, total: Int = 0, cap: Int = 4) -> NHDTable {
            NHDTable(id: "00000000-0000-4000-8000-0000000001\(String(format: "%02d", i))", name: name, floorId: floor, capacityMax: cap, currentStatus: status,
                     orderCount: orders, openedAtMs: orders > 0 ? now - min * 60_000 : nil, guestCount: guests, total: total, groupTableIds: nil, orderTableId: nil)
        }
        let tables = [
            t(1, "T-1", floor: f1, status: "seated", orders: 1, min: 48, guests: 4, total: 6424),
            t(2, "T-2", floor: f1, status: nil),
            t(3, "T-3", floor: f1, status: "seated", orders: 1, min: 12, guests: 2, total: 1980, cap: 2),
            t(4, "T-4", floor: f1, status: "billing", orders: 1, min: 95, guests: 5, total: 18700, cap: 6),
            t(5, "T-5", floor: f1, status: "reserved"),
            t(6, "T-6", floor: f1, status: "seated", orders: 1, min: 33, guests: 3, total: 7260),
            t(7, "C-1", floor: f1, status: nil, cap: 1),
            t(8, "C-2", floor: f1, status: "seated", orders: 1, min: 21, guests: 1, total: 2340, cap: 1),
            t(9, "C-3", floor: f1, status: "cleaning", cap: 1),
            t(10, "R-1", floor: f2, status: "seated", orders: 1, min: 64, guests: 8, total: 32800, cap: 10),
            t(11, "R-2", floor: f2, status: nil, cap: 6),
            t(12, "R-3", floor: f2, status: "reserved", cap: 6),
        ]
        m.payload = NHDPayload(store: NHDNamed(id: "s", name: "TENPO ONE 新宿店"), stores: [NHDNamed(id: "s", name: "TENPO ONE 新宿店")], currentStoreId: "s",
                               isHq: false, serverNow: now, today: "2026/10/25（日）", accountName: "新宿店 ハンディ", clerk: NHDNamed(id: "k", name: "佐藤"),
                               clerks: [NHDNamed(id: "k", name: "佐藤")], canOrder: true, canLock: true, bookingUrl: nil, tables: tables,
                               calls: [NHDCall(id: "c1", tableId: tables[0].id, tableName: "T-1", kind: "staff", createdAtMs: now - 180_000, note: "お水ください"),
                                       NHDCall(id: "c2", tableId: tables[3].id, tableName: "T-4", kind: "checkout", createdAtMs: now - 60_000, note: nil)],
                               floors: [NHDNamed(id: f1, name: "1F"), NHDNamed(id: f2, name: "2F")], defaultFloorId: nil)
        // iPad と同じ卓の箱の中身（part=handyFloor の見本）
        func order(_ min: Double, guests: Int, total: Int, stay: Double = 120, last: Double? = nil, plans: [String]? = nil, name: String? = nil,
                   visit: Int? = nil, source: String = "フリー", course: (String, Int)? = nil) -> [String: Any] {
            var o: [String: Any] = ["id": UUID().uuidString, "openedAtMs": now - min * 60_000, "guestCount": guests, "total": total,
                                    "sourceLabel": source, "endAtMs": now - min * 60_000 + stay * 60_000, "slips": [Any]()]
            if let last { o["lastOrderAtMs"] = now - last * 60_000 }
            if let plans { o["plans"] = plans }
            if let name { o["customerName"] = name }
            if let visit { o["visitCount"] = visit }
            if let c = course { o["course"] = ["label": c.0, "minutes": c.1] }
            return o
        }
        func ft(_ t: NHDTable, status: String, order o: [String: Any]? = nil, calls: [[String: Any]] = [], upcoming: [[String: Any]] = []) -> [String: Any] {
            var d: [String: Any] = ["id": t.id, "floor_id": t.floorId ?? NSNull(), "name": t.name, "capacity_min": 1, "capacity_max": t.capacityMax,
                                    "is_private_room": t.name.hasPrefix("R"), "is_counter": t.name.hasPrefix("C"), "current_status": status,
                                    "shape": "rect", "upcoming": upcoming, "groupTableIds": [String](), "groupTableNames": [String](), "calls": calls]
            if let o { d["order"] = o }
            return d
        }
        let iso = ISO8601DateFormatter()
        let rows: [[String: Any]] = [
            ft(tables[0], status: "seated", order: order(48, guests: 4, total: 6424, last: 6, plans: ["drink"], name: "山田 太郎", visit: 3, source: "食べログ"),
               calls: [["id": "c1", "kind": "staff", "createdAt": iso.string(from: Date(timeIntervalSince1970: (now - 180_000) / 1000)), "note": "お水ください"]]),
            ft(tables[1], status: "available"),
            ft(tables[2], status: "seated", order: order(12, guests: 2, total: 0, plans: ["normal"])),
            ft(tables[3], status: "billing", order: order(95, guests: 5, total: 18700, last: 38, plans: ["course"], name: "佐藤 花子", visit: 2, source: "ホットペッパー", course: ("おまかせコース", 120)),
               calls: [["id": "c2", "kind": "checkout", "createdAt": iso.string(from: Date(timeIntervalSince1970: (now - 60_000) / 1000)), "note": NSNull()]]),
            ft(tables[4], status: "reserved", upcoming: [["id": "u1", "startMs": now + 25 * 60_000, "time": "19:00", "name": "鈴木 一郎 様", "partySize": 4, "sourceLabel": "電話"]]),
            ft(tables[5], status: "seated", order: order(100, guests: 3, total: 7260, last: 12, plans: ["drink"], source: "Google")),
            ft(tables[6], status: "available"),
            ft(tables[7], status: "seated", order: order(21, guests: 1, total: 2340, last: 4)),
            ft(tables[8], status: "cleaning"),
            ft(tables[9], status: "seated", order: order(64, guests: 8, total: 32800, stay: 150, last: 9, plans: ["food"], name: "高橋 健", visit: 1, source: "TABLE ONE")),
            ft(tables[10], status: "available"),
            ft(tables[11], status: "reserved", upcoming: [["id": "u2", "startMs": now + 50 * 60_000, "time": "19:30", "name": "田中 美咲 様", "partySize": 6, "sourceLabel": "食べログ"]]),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: rows), let list = try? JSONDecoder().decode([NFTable].self, from: data) {
            m.floorTables = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        }
        return m
    }
}

struct NativePhoneHandyPreview: View {
    let kind: String
    @StateObject private var table = NativePhoneTableModel.sample()
    @StateObject private var order = NativePhoneOrderModel.sample()
    @StateObject private var setup = NativePhoneSetupModel.sample()
    @StateObject private var home = NativeHandyModel.sample()

    var body: some View {
        switch kind {
        case "phoneTable":
            NativePhoneTableView(model: table, onBack: {}, onOrder: { _ in }, onSetup: {})
        case "phoneHome":
            NativeHandyHomeView(model: home)
        case "phoneHomeOwner":
            NativeHandyHomeView(model: home, onHome: {})
        case "phoneSetup":
            NativePhoneSetupView(model: setup, onBack: {}, onStarted: { _ in })
        case "phoneConfirm":
            NPHConfirmSheet(model: order, onSent: { _ in }).environment(\.colorScheme, .light).background(Color.white)
        default:
            NativePhoneOrderView(model: order, onBack: { _ in })
        }
    }
}
