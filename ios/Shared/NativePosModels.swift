import Foundation
import SwiftUI

// ネイティブのレジ（オーダー・会計）で使うデータ。
// サーバーの JSON（/api/app/v1/…）をそのまま読めるように Codable にしておく。
// 金額の計算（税・割引・端数）はサーバーが正。アプリは表示とタップの速さを受け持つ。

struct NPCategory: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let sub: String?
}

struct NPMenuItem: Identifiable, Codable, Hashable {
    let id: String
    let categoryId: String
    let name: String
    let kana: String?
    let english: String?
    let price: Int            // 税込の表示価格
    let soldOut: Bool
    let hasOptions: Bool
}

struct NPOrderLine: Identifiable, Codable, Hashable {
    let id: String
    let menuItemId: String?
    let name: String
    var quantity: Int
    let unitPrice: Int        // 税込
    var sent: Bool            // 厨房へ送信済み

    var lineTotal: Int { unitPrice * quantity }
}

struct NPOrder: Codable, Hashable {
    let id: String
    let orderNo: Int
    let tableName: String
    var guestCount: Int
    let customerName: String?
    let seatFrom: String?
    let seatTo: String?
    let clerkName: String?
    var lines: [NPOrderLine]
    /// 来店経路（Walk in・食べログ・ホットペッパー…。NPVisitSource.id）
    var visitSourceId: String? = nil
    var serviceCharge: Int = 0
    var discountTotal: Int = 0
    var discountReason: String? = nil
}

/// オーダー画面の状態（タップはすぐ画面に出す。サーバーへの保存は後ろで）
@MainActor
final class NativeOrderModel: ObservableObject {
    @Published var storeName: String
    @Published var categories: [NPCategory]
    @Published var items: [NPMenuItem]
    @Published var order: NPOrder
    @Published var selectedCategory: String
    @Published var search = ""
    @Published var registerOpen: Bool
    /// この店で使う来店経路（設定 > レジ > 来店経路。既定は12個）
    @Published var visitSources: [NPVisitSource] = NPVisitSource.defaults
    /// 最後に足した行（行を光らせる）
    @Published var lastAddedLineId: String?

    init(storeName: String, categories: [NPCategory], items: [NPMenuItem], order: NPOrder, registerOpen: Bool) {
        self.storeName = storeName
        self.categories = categories
        self.items = items
        self.order = order
        self.registerOpen = registerOpen
        self.selectedCategory = categories.first?.id ?? ""
    }

    var visibleItems: [NPMenuItem] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return items.filter { $0.categoryId == selectedCategory } }
        return items.filter { item in
            [item.name, item.kana ?? "", item.english ?? ""].contains { $0.lowercased().contains(q) }
        }
    }

    /// 品目の合計（税込）
    var itemsTotal: Int { order.lines.reduce(0) { $0 + $1.lineTotal } }
    /// お支払い金額（税込）＝ 品目 ＋ サービス料 − 値引き（表示用。正しい値はサーバーから）
    var total: Int { max(0, itemsTotal + order.serviceCharge - order.discountTotal) }
    /// 内税 10% として消費税を出す
    var tax: Int { total * 10 / 110 }
    var subtotal: Int { itemsTotal - itemsTotal * 10 / 110 }
    var unsentCount: Int { order.lines.filter { !$0.sent }.reduce(0) { $0 + $1.quantity } }
    var itemCount: Int { order.lines.reduce(0) { $0 + $1.quantity } }

    func qtyInOrder(_ item: NPMenuItem) -> Int {
        order.lines.filter { $0.menuItemId == item.id }.reduce(0) { $0 + $1.quantity }
    }

    func add(_ item: NPMenuItem) {
        guard !item.soldOut else { return }
        // まだ送っていない同じ品は数量を増やす
        if let i = order.lines.firstIndex(where: { $0.menuItemId == item.id && !$0.sent }) {
            order.lines[i].quantity += 1
            lastAddedLineId = order.lines[i].id
        } else {
            let line = NPOrderLine(id: UUID().uuidString, menuItemId: item.id, name: item.name, quantity: 1, unitPrice: item.price, sent: false)
            order.lines.append(line)
            lastAddedLineId = line.id
        }
    }

    func change(_ line: NPOrderLine, by delta: Int) {
        guard let i = order.lines.firstIndex(where: { $0.id == line.id }) else { return }
        let q = order.lines[i].quantity + delta
        if q <= 0 {
            order.lines.remove(at: i)
        } else {
            order.lines[i].quantity = q
        }
    }

    func sendToKitchen() {
        for i in order.lines.indices { order.lines[i].sent = true }
    }
}

// MARK: - 見本（シミュレーターで画面を確かめる用。本番のデータではない）

extension NativeOrderModel {
    static func sample() -> NativeOrderModel {
        let cats = [
            NPCategory(id: "c0", name: "おすすめ", sub: "Picks"),
            NPCategory(id: "c1", name: "フード", sub: "Food"),
            NPCategory(id: "c2", name: "ドリンク", sub: "Drink"),
            NPCategory(id: "c3", name: "コース", sub: "Course"),
            NPCategory(id: "c4", name: "デザート", sub: "Dessert"),
        ]
        func m(_ id: String, _ c: String, _ n: String, _ p: Int, kana: String? = nil, en: String? = nil, soldOut: Bool = false, options: Bool = false) -> NPMenuItem {
            NPMenuItem(id: id, categoryId: c, name: n, kana: kana, english: en, price: p, soldOut: soldOut, hasOptions: options)
        }
        let items = [
            m("i1", "c0", "本日の刺身盛り合わせ", 1580, en: "Sashimi"),
            m("i2", "c0", "黒毛和牛ステーキ", 2980, en: "Wagyu steak", options: true),
            m("i3", "c0", "自家製ポテトサラダ", 480),
            m("i4", "c1", "枝豆", 390, kana: "エダマメ", en: "Edamame"),
            m("i5", "c1", "唐揚げ", 580, kana: "カラアゲ", en: "Karaage"),
            m("i6", "c1", "だし巻き玉子", 520),
            m("i7", "c1", "シーザーサラダ", 690),
            m("i8", "c1", "焼き鳥 盛り合わせ（5本）", 980, options: true),
            m("i9", "c1", "たこわさ", 420, soldOut: true),
            m("i10", "c1", "ガーリックライス", 650),
            m("i11", "c2", "生ビール", 590, kana: "ナマビール", en: "Draft beer"),
            m("i12", "c2", "ハイボール", 490, en: "Highball"),
            m("i13", "c2", "レモンサワー", 490),
            m("i14", "c2", "ウーロン茶", 350),
            m("i15", "c2", "日本酒（一合）", 780, options: true),
            m("i16", "c3", "飲み放題 2時間", 2200),
            m("i17", "c3", "宴会コース 5,000円", 5000),
            m("i18", "c4", "抹茶アイス", 380),
        ]
        let order = NPOrder(
            id: "o1", orderNo: 5998, tableName: "T3", guestCount: 2, customerName: nil,
            seatFrom: "18:30", seatTo: "20:30", clerkName: "Bimal",
            lines: [
                NPOrderLine(id: "l1", menuItemId: "i11", name: "生ビール", quantity: 2, unitPrice: 590, sent: true),
                NPOrderLine(id: "l2", menuItemId: "i4", name: "枝豆", quantity: 1, unitPrice: 390, sent: true),
                NPOrderLine(id: "l3", menuItemId: "i5", name: "唐揚げ", quantity: 1, unitPrice: 580, sent: false),
            ],
            visitSourceId: "tabelog"
        )
        let model = NativeOrderModel(storeName: "MEAT CROWN 新横浜", categories: cats, items: items, order: order, registerOpen: true)
        model.selectedCategory = "c1"
        return model
    }
}
