import Foundation
import SwiftUI

// ネイティブのレジ（オーダー・会計）で使うデータ。
// 金額の計算（税・割引・端数）・在庫・厨房伝票・会計はサーバー（Web と同じ処理）が正。
// アプリはタップの速さを受け持つ：商品のタップはまず手元のカート（未送信）に入れ、「注文確定」でまとめて送る（Web のレジと同じ）。

struct NPCategory: Identifiable, Hashable {
    let id: String
    let name: String
    let sub: String?
}

struct NPMenuItem: Identifiable, Hashable {
    let id: String
    let categoryId: String?
    let name: String
    let kana: String?
    let english: String?
    let price: Int            // 税込の表示価格
    let soldOut: Bool
    let hasOptions: Bool
    var recommended: Bool = false
    var bestRank: Int? = nil
    /// ¥0 の商品（金額をレジで打つ）
    var openPrice: Bool = false
}

struct NPOrderLine: Identifiable, Hashable {
    let id: String
    let menuItemId: String?
    let name: String
    var quantity: Int
    let unitPrice: Int        // 税込
    var sent: Bool            // 厨房へ送信済み（サーバーの明細）
    /// 手元のカート（まだ伝票に入れていない。注文確定で送る）
    var local: Bool = false

    var lineTotal: Int { unitPrice * quantity }
}

struct NPOrder: Hashable {
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
    var clerkId: String? = nil
    /// サーバーの合計（ライブのとき）
    var serverSubtotal: Int? = nil
    var serverTax: Int? = nil
    var serverTotal: Int? = nil
}

/// オーダー画面の状態
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

    // ライブ（サーバーにつながっている）とき
    let orderId: String?
    @Published var loading = false
    @Published var busy = false
    /// 画面の上に出すお知らせ（エラー・注意）
    @Published var notice: String?
    /// Web の画面で入れてもらう商品（選択肢・金額入力）
    @Published var webOnlyItem: NPMenuItem?
    @Published var clerks: [APIClerk] = []
    @Published var clerkRequired = false
    @Published var methodBrands: [String: [NPBrand]] = [:]
    @Published var pointBrands: [NPBrand] = NPBrands.sitePoints
    @Published var discountPresets: [NPDiscountPreset] = NPDiscountPreset.defaults
    @Published var steraTerminals: [APISteraTerminal] = []
    @Published var steraTypes: [APISteraType] = []
    @Published var canCheckout = true
    @Published var canDiscount = true

    var isLive: Bool { orderId != nil }

    init(storeName: String, categories: [NPCategory], items: [NPMenuItem], order: NPOrder, registerOpen: Bool) {
        self.storeName = storeName
        self.categories = categories
        self.items = items
        self.order = order
        self.registerOpen = registerOpen
        self.selectedCategory = categories.first?.id ?? ""
        self.orderId = nil
    }

    /// サーバーの伝票を開く
    init(orderId: String) {
        self.orderId = orderId
        self.storeName = ""
        self.categories = []
        self.items = []
        self.order = NPOrder(id: orderId, orderNo: 0, tableName: "", guestCount: 0, customerName: nil, seatFrom: nil, seatTo: nil, clerkName: nil, lines: [])
        self.registerOpen = true
        self.selectedCategory = ""
        self.loading = true
    }

    // MARK: 表示

    var visibleItems: [NPMenuItem] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            return items.filter { item in
                [item.name, item.kana ?? "", item.english ?? ""].contains { $0.lowercased().contains(q) }
            }
        }
        switch selectedCategory {
        case "__favorites__": return items.filter { $0.recommended }
        case "__bestsellers__": return items.filter { $0.bestRank != nil }.sorted { ($0.bestRank ?? 0) < ($1.bestRank ?? 0) }
        case "__takeout__": return items
        default: return items.filter { $0.categoryId == selectedCategory }
        }
    }

    var cartLines: [NPOrderLine] { order.lines.filter { $0.local } }
    var cartTotal: Int { cartLines.reduce(0) { $0 + $1.lineTotal } }

    /// 品目の合計（税込）
    var itemsTotal: Int { order.lines.reduce(0) { $0 + $1.lineTotal } }
    /// お支払い金額（税込）。ライブはサーバーの合計＋まだ送っていないカート
    var total: Int {
        if let t = order.serverTotal { return t + cartTotal }
        return max(0, itemsTotal + order.serviceCharge - order.discountTotal)
    }
    var tax: Int {
        if let t = order.serverTax { return t + cartTotal * 10 / 110 }
        return total * 10 / 110
    }
    var subtotal: Int {
        if let s = order.serverSubtotal { return s + cartTotal - cartTotal * 10 / 110 }
        return itemsTotal - itemsTotal * 10 / 110
    }
    var unsentCount: Int { order.lines.filter { !$0.sent }.reduce(0) { $0 + $1.quantity } }
    var itemCount: Int { order.lines.reduce(0) { $0 + $1.quantity } }
    var clerkName: String? { clerks.first { $0.id == order.clerkId }?.name ?? order.clerkName }
    var clerkMissing: Bool { clerkRequired && order.clerkId == nil }

    func qtyInOrder(_ item: NPMenuItem) -> Int {
        order.lines.filter { $0.menuItemId == item.id }.reduce(0) { $0 + $1.quantity }
    }

    // MARK: タップ（手元のカート）

    func add(_ item: NPMenuItem) {
        guard !item.soldOut else { return }
        if isLive && (item.hasOptions || item.openPrice) {
            // 選択肢・金額入力のある商品は、最初の版では Web の画面で入れる
            webOnlyItem = item
            return
        }
        if let i = order.lines.firstIndex(where: { $0.menuItemId == item.id && $0.local }) {
            order.lines[i].quantity += 1
            lastAddedLineId = order.lines[i].id
        } else {
            let line = NPOrderLine(id: "cart-" + UUID().uuidString, menuItemId: item.id, name: item.name, quantity: 1, unitPrice: item.price, sent: false, local: true)
            order.lines.append(line)
            lastAddedLineId = line.id
        }
    }

    /// 数量の +/-。カートの品は手元で、送った品は（最初の版では）変えない
    func canChange(_ line: NPOrderLine) -> Bool { !isLive || line.local }

    func change(_ line: NPOrderLine, by delta: Int) {
        guard canChange(line), let i = order.lines.firstIndex(where: { $0.id == line.id }) else { return }
        let q = order.lines[i].quantity + delta
        if q <= 0 {
            order.lines.remove(at: i)
        } else {
            order.lines[i].quantity = q
        }
    }

    // MARK: サーバー

    func load() async {
        guard let orderId else { return }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeAPI.shared.load(orderId: orderId)
            apply(payload: p)
        } catch let e as NativeAPIError {
            notice = e.message
            if e.useWeb { openInWeb() }
        } catch {
            notice = "読み込めませんでした。通信を確かめてください"
        }
    }

    private func apply(payload p: APIPayload) {
        storeName = p.store.name
        categories = p.categories.map { NPCategory(id: $0.id, name: $0.name, sub: $0.sub) }
        items = p.items.map {
            NPMenuItem(id: $0.id, categoryId: $0.categoryId, name: $0.name, kana: $0.kana, english: $0.english, price: $0.price,
                       soldOut: $0.soldOut, hasOptions: $0.hasOptions, recommended: $0.recommended, bestRank: $0.bestRank, openPrice: $0.openPrice)
        }
        if selectedCategory.isEmpty || !categories.contains(where: { $0.id == selectedCategory }) {
            // おすすめ・売れ筋より、最初の普通のカテゴリを先に開く（Web のレジと同じ）
            selectedCategory = categories.first(where: { !$0.id.hasPrefix("__") })?.id ?? categories.first?.id ?? ""
        }
        clerks = p.clerks
        clerkRequired = p.clerkRequired
        visitSources = p.visitSources.map { NPVisitSource(id: $0.id, label: $0.label) }
        methodBrands = p.methodBrands.mapValues { $0.map { NPBrand(id: $0.id, name: $0.name) } }
        pointBrands = p.pointBrands.map { NPBrand(id: $0.id, name: $0.name) }
        discountPresets = p.discountPresets.map {
            NPDiscountPreset(id: $0.id, name: $0.name, kind: $0.kind == "percent" ? .percent : $0.kind == "amount" ? .amount : .manual, value: $0.value)
        }
        steraTerminals = p.steraTerminals
        steraTypes = p.steraPaymentTypes
        registerOpen = p.registerOpen
        canCheckout = p.canCheckout
        canDiscount = p.canDiscount
        apply(order: p.order)
    }

    private func apply(order o: APIOrder) {
        let cart = cartLines
        order = NPOrder(
            id: o.id, orderNo: o.orderNo, tableName: o.tableName ?? "", guestCount: o.guestCount,
            customerName: o.customerName, seatFrom: o.seatFrom, seatTo: o.seatTo, clerkName: nil,
            lines: o.lines.map { NPOrderLine(id: $0.id, menuItemId: $0.menuItemId, name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, sent: $0.sent) } + cart,
            visitSourceId: o.visitSourceId, serviceCharge: o.serviceCharge, discountTotal: o.discountTotal,
            discountReason: o.discountReason, clerkId: o.clerkId,
            serverSubtotal: o.subtotal, serverTax: o.taxTotal, serverTotal: o.total
        )
    }

    /// 1つの操作をサーバーへ（失敗したらお知らせに出す）
    @discardableResult
    func act(_ body: [String: Any]) async -> APIResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.act(body)
            if let o = r.order { apply(order: o) }
            return r
        } catch {
            notice = error.localizedDescription
            return nil
        }
    }

    /// 注文確定：カートの品を伝票に入れて、まとめて厨房へ（Web のレジと同じ）
    @discardableResult
    func sendToKitchen() async -> Bool {
        guard isLive, let orderId else {
            for i in order.lines.indices { order.lines[i].sent = true; order.lines[i].local = false }
            return true
        }
        // 同じ品はまとめる
        var merged: [(String, Int)] = []
        for l in cartLines {
            guard let mid = l.menuItemId else { continue }
            if let i = merged.firstIndex(where: { $0.0 == mid }) { merged[i].1 += l.quantity } else { merged.append((mid, l.quantity)) }
        }
        let lines = merged.map { ["menuItemId": $0.0, "quantity": $0.1, "optionItemIds": [String]()] as [String: Any] }
        // 送ったカートは手元から消す（サーバーの明細に入る）。失敗したら戻す
        let backup = order.lines
        order.lines.removeAll { $0.local }
        guard let r = await act(["type": "send", "orderId": orderId, "lines": lines]) else {
            order.lines = backup
            return false
        }
        if let w = r.printWarning, !w.isEmpty { notice = w }
        return true
    }

    func setClerk(_ id: String?) async {
        guard let orderId else { order.clerkId = id; return }
        await act(["type": "clerk", "orderId": orderId, "clerkId": id.map { $0 as Any } ?? NSNull()])
    }

    func setVisitSource(_ id: String?) async {
        guard let orderId else { order.visitSourceId = id; return }
        let before = order.visitSourceId
        order.visitSourceId = id
        if await act(["type": "visitSource", "orderId": orderId, "sourceId": id.map { $0 as Any } ?? NSNull()]) == nil {
            order.visitSourceId = before
        }
    }

    func setDiscount(amount: Int, reason: String) async {
        guard let orderId else {
            order.discountTotal = amount
            order.discountReason = amount > 0 ? reason : nil
            return
        }
        await act(["type": "discount", "orderId": orderId, "amount": amount, "reason": reason])
    }

    /// 会計を確定する。成功したら true
    func checkout(payments: [NPPaymentRow], cashDue: Int, memo: String) async -> Bool {
        guard let orderId else { return true }
        let body: [[String: Any]] = payments.map { p in
            var d: [String: Any] = ["method": p.method.rawValue]
            if p.method == .cash {
                d["amount"] = min(p.tendered, cashDue)
                d["tendered"] = p.tendered
            } else {
                d["amount"] = p.amount
            }
            if let b = p.brand { d["provider"] = b.id }
            return d
        }
        guard let r = await act(["type": "checkout", "orderId": orderId, "payments": body, "memo": memo]) else { return false }
        if r.alreadyPaid == true { notice = "この伝票は既に会計済みです" }
        // ドロア（店の設定で開くか決める）
        let methods = Array(Set(payments.map { $0.method.rawValue }))
        _ = try? await NativeAPI.shared.act(["type": "drawer", "orderId": orderId, "methods": methods], throwOnFail: false)
        return true
    }

    /// Web の画面でこの伝票を開く（ネイティブを閉じる）
    func openInWeb(path: String? = nil) {
        guard let orderId else { return }
        AppState.shared.closeNativePos(openWebPath: path ?? "/app/pos?order=\(orderId)")
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
                NPOrderLine(id: "l3", menuItemId: "i5", name: "唐揚げ", quantity: 1, unitPrice: 580, sent: false, local: true),
            ],
            visitSourceId: "tabelog"
        )
        let model = NativeOrderModel(storeName: "MEAT CROWN 新横浜", categories: cats, items: items, order: order, registerOpen: true)
        model.selectedCategory = "c1"
        return model
    }
}
