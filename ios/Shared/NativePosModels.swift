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

/// 上のタブ（ページ）。押すとそのページのカテゴリが左の列に出る（Web のレジと同じ）
struct NPPage: Identifiable, Hashable {
    let id: String
    let name: String
    let sub: String?
    let categoryIds: [String]
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
    let unitPrice: Int        // 税込（選択肢の追加料金こみ）
    var sent: Bool            // 厨房へ送信済み（サーバーの明細）
    /// 手元のカート（まだ伝票に入れていない。注文確定で送る）
    var local: Bool = false
    /// 選んだ選択肢（名前は明細の下に出す。id は注文確定で送る）
    var optionNames: [String] = []
    /// 選択肢の英語名（iPad は英語を主に出す）
    var optionNamesEn: [String] = []
    /// 商品の英語名（iPad は英語を主に出し、日本語は下に小さく。Web のレジと同じ）
    var english: String? = nil
    var optionItemIds: [String] = []
    /// ¥0 の商品にレジで打った金額（カートだけ）
    var openPrice: Int? = nil
    /// 「その他（金額入力）」の行（カートだけ。menuItemId は無い）
    var custom: NPCustom? = nil

    var lineTotal: Int { unitPrice * quantity }
    var displayName: String { english ?? name }
    var japaneseSub: String? { english != nil && english != name ? name : nil }
    /// 選択肢（英語。無ければ日本語）
    var optionLabel: String? {
        let list = optionNamesEn.isEmpty ? optionNames : optionNamesEn
        return list.isEmpty ? nil : list.joined(separator: ", ")
    }
    /// 同じ品・同じ選択・同じ金額ならカートで1行にまとめる
    var cartKey: String {
        if custom != nil { return id }  // 「その他」は1行ずつ（内容が違う）
        return [menuItemId ?? "", optionItemIds.sorted().joined(separator: ","), openPrice.map(String.init) ?? ""].joined(separator: "|")
    }
}

/// 「その他（金額入力）」の行の中身（Web のレジの Other ボタン。サーバーは addCustomPriceItem）
struct NPCustom: Hashable {
    let categoryId: String?
    let price: Int
    let memo: String?
}

/// 「その他」を入れる先（そのカテゴリの最後のボタン。テイクアウトは一覧の最後）
struct NPCustomTarget: Identifiable, Equatable {
    let categoryId: String?
    let label: String
    var id: String { categoryId ?? "none" }
}

/// 商品の選択肢グループ（Web のレジの選択ダイアログと同じ：必須・最小/最大・追加料金）
struct NPOptionGroup: Identifiable, Hashable {
    struct Option: Identifiable, Hashable {
        let id: String
        let name: String
        var english: String? = nil
        let price: Int
        var title: String { english ?? name }
    }
    let id: String
    let name: String
    var english: String? = nil
    let isRequired: Bool
    let minSelect: Int
    let maxSelect: Int
    let items: [Option]

    /// 最低いくつ選ぶか（必須なら1つ以上）
    var minimum: Int { isRequired ? max(1, minSelect) : minSelect }
    var title: String { english ?? name }
    /// 何個選ぶか（Web の選択ダイアログと同じ言い方）
    var rule: String {
        if maxSelect == 1 { return minimum >= 1 ? "1つ選ぶ" : "1つまで" }
        return minimum == maxSelect ? "\(maxSelect)つ選ぶ" : "\(minimum)〜\(maxSelect)つ選ぶ"
    }
}

/// 選択肢・金額を選ぶ途中の商品
struct NPPendingItem: Identifiable, Equatable {
    var id: String { item.id }
    let item: NPMenuItem
    let groups: [NPOptionGroup]
    /// 選択肢を選び終えたあと（金額入力の商品は次にテンキー）
    var chosen: [String] = []
    var chosenNames: [String] = []
    var chosenNamesEn: [String] = []
    var extra: Int = 0
    var askingPrice: Bool
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
    /// 卓の無い伝票（テイクアウト・デリバリー・事前注文）。オーダー画面から会計へ行けるのはこれだけ（Web と同じ）
    var takeoutLike = false
}

/// オーダー画面の状態
@MainActor
final class NativeOrderModel: ObservableObject {
    @Published var storeName: String
    @Published var categories: [NPCategory]
    /// 上のタブ（ページ）。空ならタブを出さず、カテゴリを全部左に出す（テイクアウト・古いサーバー）
    @Published var pages: [NPPage] = []
    /// 上のタブを編集できるか（店長以上。Web のレジの「編集 Edit tabs」）
    @Published var canEditPages = false
    /// この伝票の店（タブの編集・メニューの読み直しに使う）
    private(set) var storeId: String?
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
    var orderId: String?
    @Published var splitParentOrderId: String?
    @Published var loading = false
    @Published var busy = false
    /// 画面の上に出すお知らせ（エラー・注意）
    @Published var notice: String?
    /// 短い知らせ（印刷しますなど。少ししたら消える）
    @Published var toast: String?
    /// Web の画面で入れてもらう商品（古いサーバーで選択肢が分からないとき）
    @Published var webOnlyItem: NPMenuItem?
    /// 商品ごとの選択肢グループ
    @Published var optionGroups: [String: [NPOptionGroup]] = [:]
    /// 選択肢・金額を選んでいる途中の商品（画面に選ぶパネルを出す）
    @Published var pending: NPPendingItem?
    @Published var clerks: [APIClerk] = []
    @Published var clerkRequired = false
    /// 取消（1品・伝票）を承認できる担当者（店長以上）。空なら承認なしで取消できる店（Web の clerkGate と同じ）
    @Published var approvers: [APIClerk] = []
    @Published var methodBrands: [String: [NPBrand]] = [:]
    @Published var pointBrands: [NPBrand] = NPBrands.sitePoints
    @Published var discountPresets: [NPDiscountPreset] = NPDiscountPreset.defaults
    @Published var steraTerminals: [APISteraTerminal] = []
    @Published var steraTypes: [APISteraType] = []
    @Published var canCheckout = true
    @Published var canDiscount = true
    /// 読み込んだらすぐ会計の画面を出す（卓のポップアップの「レジ会計」）
    @Published var openCheckoutOnLoad = false
    /// 直前の会計のレシート（Bluetooth・USB のレシートプリンター用。再発行はこれをもう一度送る）
    var lastReceipt: APICheckoutReceipt?

    /// レシートを再発行する。Bluetooth・USB のレシートがあればそれをもう一度送る（ネイティブだけで完結）。
    /// 無ければ（CloudPRNT・LAN のとき）サーバーに再印刷を頼む。どちらもできなければ false
    func reprintReceipt() async -> Bool {
        if let receipt = lastReceipt, let bytes = Data(base64Encoded: receipt.data), !bytes.isEmpty,
           ["star", "epson", "sii", "escpos"].contains(receipt.maker), ["bluetooth", "usb"].contains(receipt.via) {
            return await withCheckedContinuation { cont in
                WebViewController.printBluetooth(deviceId: receipt.deviceId, maker: receipt.maker, via: receipt.via, data: bytes) { ok, _ in
                    cont.resume(returning: ok)
                }
            }
        }
        guard let orderId else { return false }
        if let r = try? await NativeAPI.shared.floorAct(["type": "floorReceipt", "orderId": orderId]) { return r.ok }
        return false
    }

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

    /// いま開いているページ（選んでいるカテゴリが入っているページ）
    var currentPage: NPPage? {
        pages.first(where: { $0.categoryIds.contains(selectedCategory) }) ?? pages.first
    }

    /// 左の列に出すカテゴリ（いま開いているページの中身だけ。ページが無ければ全部）
    var pageCategories: [NPCategory] {
        guard let page = currentPage else { return categories }
        let byId = Dictionary(categories.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return page.categoryIds.compactMap { byId[$0] }
    }

    /// 「その他（金額入力）」を打っている先（パネルを出す）
    @Published var customTarget: NPCustomTarget?

    /// 商品の最後に出す「Other その他・金額入力」（Web と同じ：カテゴリを開いているときだけ。おすすめ・売れ筋・検索には出さない）
    var customTile: NPCustomTarget? {
        guard search.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        switch selectedCategory {
        case "__takeout__": return NPCustomTarget(categoryId: nil, label: "テイクアウト")
        case "__favorites__", "__bestsellers__", "": return nil
        default:
            guard let c = categories.first(where: { $0.id == selectedCategory }) else { return NPCustomTarget(categoryId: nil, label: "その他") }
            return NPCustomTarget(categoryId: c.id, label: c.sub ?? c.name)
        }
    }

    /// 「その他」をカートへ（内容は空白をまとめて40文字まで。無ければ「その他」。Web の normalizeCustomMemo と同じ）
    func addCustom(price: Int, memo: String) {
        guard let t = customTarget else { return }
        customTarget = nil
        let text = String(memo.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(40))
        let line = NPOrderLine(
            id: "cart-" + UUID().uuidString, menuItemId: nil, name: text.isEmpty ? "その他" : text, quantity: 1,
            unitPrice: price, sent: false, local: true,
            optionNames: [t.label], optionNamesEn: [t.label], english: text.isEmpty ? "Other" : nil,
            custom: NPCustom(categoryId: t.categoryId, price: price, memo: text.isEmpty ? nil : text)
        )
        order.lines.append(line)
        lastAddedLineId = line.id
    }

    /// タブを保存したあと：メニュー（ページ）を読み直して画面を入れ替える
    func reloadCatalog() {
        NativeCatalogCache.shared.onUpdate = { [weak self] c in self?.apply(catalog: c) }
        NativeCatalogCache.shared.refresh(storeId: storeId)
    }

    /// 上のタブを押したら、そのページの最初のカテゴリを開く
    func openPage(_ page: NPPage) {
        search = ""
        if let first = page.categoryIds.first(where: { id in categories.contains(where: { $0.id == id }) }) {
            selectedCategory = first
        }
    }

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

    /// 商品の英語名（明細を英語で出すため）
    func englishOf(_ menuItemId: String?) -> String? {
        guard let id = menuItemId else { return nil }
        return items.first { $0.id == id }?.english
    }

    func qtyInOrder(_ item: NPMenuItem) -> Int {
        order.lines.filter { $0.menuItemId == item.id }.reduce(0) { $0 + $1.quantity }
    }

    // MARK: タップ（手元のカート）

    func add(_ item: NPMenuItem) {
        guard !item.soldOut else { return }
        let groups = optionGroups[item.id] ?? []
        if item.hasOptions && groups.isEmpty && isLive {
            // 選択肢の中身が来ていない（古いサーバー）：今までの画面で入れる
            webOnlyItem = item
            return
        }
        if !groups.isEmpty || item.openPrice {
            // 選択肢を選ぶ → （¥0 の商品は）金額を打つ → カートへ
            pending = NPPendingItem(item: item, groups: groups, askingPrice: groups.isEmpty)
            return
        }
        addToCart(item, optionIds: [], optionNames: [], optionNamesEn: [], extra: 0, openPrice: nil)
    }

    /// 選択肢を選び終えた
    func chooseOptions(_ ids: [String], names: [String], namesEn: [String], extra: Int) {
        guard var p = pending else { return }
        if p.item.openPrice {
            p.chosen = ids
            p.chosenNames = names
            p.chosenNamesEn = namesEn
            p.extra = extra
            p.askingPrice = true
            pending = p
            return
        }
        pending = nil
        addToCart(p.item, optionIds: ids, optionNames: names, optionNamesEn: namesEn, extra: extra, openPrice: nil)
    }

    /// 金額を打ち終えた（¥0 の商品）
    func choosePrice(_ yen: Int) {
        guard let p = pending else { return }
        pending = nil
        addToCart(p.item, optionIds: p.chosen, optionNames: p.chosenNames, optionNamesEn: p.chosenNamesEn, extra: p.extra, openPrice: yen)
    }

    private func addToCart(_ item: NPMenuItem, optionIds: [String], optionNames: [String], optionNamesEn: [String], extra: Int, openPrice: Int?) {
        let line = NPOrderLine(
            id: "cart-" + UUID().uuidString, menuItemId: item.id, name: item.name, quantity: 1,
            unitPrice: (openPrice ?? item.price) + extra, sent: false, local: true,
            optionNames: optionNames, optionNamesEn: optionNamesEn, english: item.english, optionItemIds: optionIds, openPrice: openPrice
        )
        if let i = order.lines.firstIndex(where: { $0.local && $0.cartKey == line.cartKey }) {
            order.lines[i].quantity += 1
            lastAddedLineId = order.lines[i].id
        } else {
            order.lines.append(line)
            lastAddedLineId = line.id
        }
    }

    /// 数量の +/-。カートの品は手元で変える。送った品もサーバーで変える（Web のレジの −／＋ と同じ。2026-10-24）
    func canChange(_ line: NPOrderLine) -> Bool { !isLive || line.local || !busy }

    func change(_ line: NPOrderLine, by delta: Int) {
        guard canChange(line), let i = order.lines.firstIndex(where: { $0.id == line.id }) else { return }
        let q = order.lines[i].quantity + delta
        if !isLive || line.local {
            if q <= 0 {
                order.lines.remove(at: i)
            } else {
                order.lines[i].quantity = q
            }
            return
        }
        // 送った品：1 より下にはしない（0 にするのは「取消」。Web の updateQty と同じ）。先に画面を変えて、失敗したら戻す
        guard q >= 1, let orderId, delta == 1 || delta == -1 else { return }
        let backup = order.lines
        order.lines[i].quantity = q
        Task {
            if await act(["type": "qty", "orderId": orderId, "lineId": line.id, "delta": delta]) == nil {
                order.lines = backup
            }
        }
    }

    /// 1品の取消。カートの品は手元から消すだけ。送った品はサーバーで取消（レジは店長以上の承認＝approver。Web の cancelItem と同じ）
    @discardableResult
    func cancelLine(_ line: NPOrderLine, approver: String?) async -> Bool {
        if !isLive || line.local {
            order.lines.removeAll { $0.id == line.id }
            return true
        }
        guard let orderId else { return false }
        var body: [String: Any] = ["type": "cancelLine", "orderId": orderId, "lineId": line.id, "reason": ""]
        body["approvedByClerkId"] = approver.map { $0 as Any } ?? NSNull()
        guard await act(body) != nil else { return false }
        toast = "「\(line.displayName)」を取消しました"
        return true
    }

    /// 別々会計の「分ける」：1つの品を何人かで分ける（「品名（1/n）」に。Web の divideOrderItem と同じ）
    @discardableResult
    func divide(_ line: NPOrderLine, parts: Int) async -> Bool {
        guard let orderId, !line.local, line.unitPrice > 0, (2...10).contains(parts) else { return false }
        guard await act(["type": "divide", "orderId": orderId, "lineId": line.id, "parts": parts]) != nil else { return false }
        toast = "\(parts)人で分けました。1人分ずつ「›」で移してください"
        return true
    }

    // MARK: サーバー

    /**
     * 開くときの読み込み（2026-10-21 Ronnie「メニューは超速く」）：
     *   1. iPad に保存してあるメニュー（NativeCatalogCache）があれば、まずそれで画面を出す（待たない）
     *   2. 伝票だけ軽く読む（?part=live）
     *   3. 裏でメニューを読み直して、変わっていたら入れ替える
     * 保存が無いとき・テイクアウトのときは今まで通り全部読む
     */
    func load() async {
        guard let orderId else { return }
        if let cached = NativeCatalogCache.shared.load() {
            apply(catalog: cached)
            loading = false
            do {
                let live = try await NativeAPI.shared.loadLive(orderId: orderId)
                if live.storeId != cached.store.id || live.order.orderType.contains("takeout") || live.order.orderType == "delivery" {
                    // 別の店・テイクアウト：全部読み直す
                    await loadAll(orderId: orderId)
                    return
                }
                apply(live: live)
                NativeCatalogCache.shared.onUpdate = { [weak self] c in self?.apply(catalog: c) }
                NativeCatalogCache.shared.refresh(storeId: live.storeId)
            } catch let e as NativeAPIError {
                notice = e.message
                if e.useWeb { openInWeb() }
            } catch {
                notice = "読み込めませんでした。回線を確認してください"
            }
            return
        }
        await loadAll(orderId: orderId)
    }

    private func loadAll(orderId: String) async {
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeAPI.shared.load(orderId: orderId)
            apply(payload: p)
            // 次から速く開けるように保存（テイクアウトのメニューは保存しない）
            if let v = p.catalogVersion {
                NativeCatalogCache.shared.save(APICatalog(
                    store: p.store, categories: p.categories, pages: p.pages, items: p.items, optionGroups: p.optionGroups, clerks: p.clerks,
                    clerkRequired: p.clerkRequired, visitSources: p.visitSources, methodBrands: p.methodBrands, pointBrands: p.pointBrands,
                    discountPresets: p.discountPresets, steraPaymentTypes: p.steraPaymentTypes, canCheckout: p.canCheckout,
                    canDiscount: p.canDiscount, canEditPages: p.canEditPages, version: v))
            }
        } catch let e as NativeAPIError {
            notice = e.message
            if e.useWeb { openInWeb() }
        } catch {
            notice = "読み込めませんでした。回線を確認してください"
        }
    }

    private func apply(catalog c: APICatalog) {
        storeId = c.store.id
        canEditPages = c.canEditPages ?? false
        applyCatalog(storeName: c.store.name, categories: c.categories, pages: c.pages, items: c.items, optionGroups: c.optionGroups, clerks: c.clerks,
                     clerkRequired: c.clerkRequired, visitSources: c.visitSources, methodBrands: c.methodBrands, pointBrands: c.pointBrands,
                     discountPresets: c.discountPresets, steraTypes: c.steraPaymentTypes, canCheckout: c.canCheckout, canDiscount: c.canDiscount)
    }

    /// サーバーから伝票を読めたか（読めていないのに「品なし」と思って消さないように）
    private(set) var orderLoaded = false

    private func apply(live l: APILive) {
        orderLoaded = true
        steraTerminals = l.steraTerminals
        registerOpen = l.registerOpen
        approvers = l.approvers ?? []
        apply(order: l.order)
    }

    private func apply(payload p: APIPayload) {
        orderLoaded = true
        storeId = p.store.id
        canEditPages = p.canEditPages ?? false
        applyCatalog(storeName: p.store.name, categories: p.categories, pages: p.pages, items: p.items, optionGroups: p.optionGroups, clerks: p.clerks,
                     clerkRequired: p.clerkRequired, visitSources: p.visitSources, methodBrands: p.methodBrands, pointBrands: p.pointBrands,
                     discountPresets: p.discountPresets, steraTypes: p.steraPaymentTypes, canCheckout: p.canCheckout, canDiscount: p.canDiscount)
        steraTerminals = p.steraTerminals
        registerOpen = p.registerOpen
        approvers = p.approvers ?? []
        apply(order: p.order)
    }

    private func applyCatalog(storeName name: String, categories cats: [APICategory], pages pg: [APIPage]?, items list: [APIItem], optionGroups groups: [String: [APIOptionGroup]]?,
                              clerks cl: [APIClerk], clerkRequired req: Bool, visitSources vs: [APISource], methodBrands mb: [String: [APIBrand]],
                              pointBrands pb: [APIBrand], discountPresets dp: [APIDiscountPreset], steraTypes st: [APISteraType],
                              canCheckout cc: Bool, canDiscount cd: Bool) {
        storeName = name
        categories = cats.map { NPCategory(id: $0.id, name: $0.name, sub: $0.sub) }
        pages = (pg ?? []).map { NPPage(id: $0.key, name: $0.name, sub: $0.sub, categoryIds: $0.categoryIds) }
        items = list.map {
            NPMenuItem(id: $0.id, categoryId: $0.categoryId, name: $0.name, kana: $0.kana, english: $0.english, price: $0.price,
                       soldOut: $0.soldOut, hasOptions: $0.hasOptions, recommended: $0.recommended, bestRank: $0.bestRank, openPrice: $0.openPrice)
        }
        if selectedCategory.isEmpty || !categories.contains(where: { $0.id == selectedCategory }) {
            // いちばん左のタブの最初のカテゴリ（Web のレジと同じ。店が並べた1番、決めていなければ おすすめ）
            let firstOfPage = pages.first?.categoryIds.first(where: { id in categories.contains(where: { $0.id == id }) })
            selectedCategory = firstOfPage ?? categories.first(where: { !$0.id.hasPrefix("__") })?.id ?? categories.first?.id ?? ""
        }
        optionGroups = (groups ?? [:]).mapValues { list in
            list.map { g in
                NPOptionGroup(id: g.id, name: g.name, english: g.english, isRequired: g.isRequired, minSelect: g.minSelect, maxSelect: g.maxSelect,
                              items: g.items.map { NPOptionGroup.Option(id: $0.id, name: $0.name, english: $0.english, price: $0.price) })
            }
        }
        clerks = cl
        clerkRequired = req
        visitSources = vs.map { NPVisitSource(id: $0.id, label: $0.label) }
        methodBrands = mb.mapValues { $0.map { NPBrand(id: $0.id, name: $0.name) } }
        pointBrands = pb.map { NPBrand(id: $0.id, name: $0.name) }
        discountPresets = dp.map {
            NPDiscountPreset(id: $0.id, name: $0.name, kind: $0.kind == "percent" ? .percent : $0.kind == "amount" ? .amount : .manual, value: $0.value)
        }
        steraTypes = st
        canCheckout = cc
        canDiscount = cd
    }

    private func apply(order o: APIOrder) {
        let cart = cartLines
        order = NPOrder(
            id: o.id, orderNo: o.orderNo, tableName: o.tableName ?? "", guestCount: o.guestCount,
            customerName: o.customerName, seatFrom: o.seatFrom, seatTo: o.seatTo, clerkName: nil,
            lines: o.lines.map {
                NPOrderLine(id: $0.id, menuItemId: $0.menuItemId, name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, sent: $0.sent,
                            optionNames: $0.options ?? [], optionNamesEn: $0.optionsEn ?? [], english: englishOf($0.menuItemId))
            } + cart,
            visitSourceId: o.visitSourceId, serviceCharge: o.serviceCharge, discountTotal: o.discountTotal,
            discountReason: o.discountReason, clerkId: o.clerkId,
            serverSubtotal: o.subtotal, serverTax: o.taxTotal, serverTotal: o.total,
            takeoutLike: ["takeout", "delivery", "pre_order"].contains(o.orderType)
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
        // 同じ品・同じ選択・同じ金額はまとめる
        var merged: [NPOrderLine] = []
        for l in cartLines where l.menuItemId != nil || l.custom != nil {
            if let i = merged.firstIndex(where: { $0.cartKey == l.cartKey }) { merged[i].quantity += l.quantity } else { merged.append(l) }
        }
        let lines: [[String: Any]] = merged.map { l in
            if let c = l.custom {
                // 「その他（金額入力）」（サーバーは Web と同じ addCustomPriceItem）
                return ["custom": ["categoryId": c.categoryId.map { $0 as Any } ?? NSNull(), "price": c.price,
                                   "memo": c.memo.map { $0 as Any } ?? NSNull()] as [String: Any],
                        "quantity": l.quantity]
            }
            return ["menuItemId": l.menuItemId ?? "", "quantity": l.quantity, "optionItemIds": l.optionItemIds,
                    "openPrice": l.openPrice.map { $0 as Any } ?? NSNull()]
        }
        // 送ったカートは手元から消す（サーバーの明細に入る）。失敗したら戻す
        let backup = order.lines
        order.lines.removeAll { $0.local }
        guard let r = await act(["type": "send", "orderId": orderId, "lines": lines]) else {
            order.lines = backup
            return false
        }
        if let w = r.printWarning, !w.isEmpty { notice = w }
        // 厨房伝票を iPad から LAN で直接出す（サーバーの返事と一緒に来る。待たない。2026-10-21「印刷は超速く」）
        if let prints = r.prints, !prints.isEmpty { NativeLanPrint.shared.send(prints) }
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

    /// Web と同じ品目単位の伝票分割。サーバーが数量・権限・合計を検証する。
    func splitForCheckout(_ quantities: [String: Int]) async -> Bool {
        guard let orderId else { return false }
        let moves = quantities.filter { $0.value > 0 }.map { ["orderItemId": $0.key, "quantity": $0.value] as [String: Any] }
        guard !moves.isEmpty,
              let result = await act(["type": "split", "orderId": orderId, "moves": moves]),
              let newId = result.newOrderId else { return false }
        splitParentOrderId = orderId
        self.orderId = newId
        return true
    }

    func resumeSplitParent() async -> Bool {
        guard let parent = splitParentOrderId else { return false }
        do {
            let live = try await NativeAPI.shared.loadLive(orderId: parent)
            guard !live.order.lines.isEmpty else { return false }
            orderId = parent
            splitParentOrderId = nil
            apply(live: live)
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
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
        // Read the paired device before checkout; no extra request or polling after payment.
        var request: [String: Any] = ["type": "checkout", "orderId": orderId, "payments": body, "memo": memo]
        if let link = await WebViewController.current?.checkoutBluetoothLink() { request["bluetoothLink"] = link }
        guard let r = await act(request) else { return false }
        // 会計が通ったら、前の失敗の知らせは消す（失敗→成功のとき、完了画面に失敗の帯が残っていた。2026-10-24）
        notice = nil
        if let warning = r.warning, !warning.isEmpty { notice = warning }
        lastReceipt = nil
        if let receipt = r.receipt {
            // 再発行（完了画面の「Reprint receipt」）用に取っておく
            lastReceipt = receipt
            if let bytes = Data(base64Encoded: receipt.data), !bytes.isEmpty,
               ["star", "epson", "sii", "escpos"].contains(receipt.maker), ["bluetooth", "usb"].contains(receipt.via) {
                // Start before the drawer request. Never automatically retry an uncertain physical print.
                WebViewController.printBluetooth(deviceId: receipt.deviceId, maker: receipt.maker, via: receipt.via, data: bytes) { [weak self] ok, _ in
                    if !ok {
                        Task { @MainActor [weak self] in self?.notice = "会計は完了しました。レシートの印刷を確認し、必要な場合だけ再発行してください。" }
                    }
                }
            } else {
                notice = "会計は完了しましたがレシートを印刷できません。再発行してください。"
            }
        }
        if r.alreadyPaid == true { notice = "この伝票はすでに会計済みです" }
        // ドロア（店の設定で開くか決める）
        let methods = Array(Set(payments.map { $0.method.rawValue }))
        _ = try? await NativeAPI.shared.act(["type": "drawer", "orderId": orderId, "methods": methods], throwOnFail: false)
        return true
    }

    /// お会計伝票をその場で印刷する（レジのプリンターへ。Web の「会計伝票」と同じ）
    /// 伝票だけ読み直す（お客様情報を変えたあと。カートの品はそのまま）
    func reloadOrder() async {
        guard let orderId, isLive else { return }
        if let live = try? await NativeAPI.shared.loadLive(orderId: orderId) { apply(live: live) }
    }

    func printBill() async {
        guard let orderId else { return }
        busy = true
        defer { busy = false }
        if let r = try? await NativeAPI.shared.floorAct(["type": "floorBill", "orderId": orderId]) {
            notice = r.ok ? nil : (r.error ?? "お会計伝票の印刷に失敗しました")
            if r.ok { toast = "お会計伝票を印刷します" }
        } else {
            notice = "お会計伝票の印刷に失敗しました"
        }
    }

    /// 品を1つも注文せずに戻ったら、伝票を消して卓を空席に戻す（Web の discardUntouchedOrderAction と同じ。
    /// 2026-10-24 Ronnie「注文していないのに卓が始まる。注文してから卓が始まるように」）。
    /// 消すのは品が1つも無い伝票だけ（カートに入れた品があれば残す。Web の「品を入れていない伝票」と同じ）
    func discardIfUntouched() async {
        guard let orderId, orderLoaded, order.lines.isEmpty else { return }
        var req = URLRequest(url: AppConfig.url("/api/pos/discard-untouched"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["orderId": orderId])
        _ = try? await NativeAPI.shared.send(req)
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
            m("i1", "c0", "本日の刺身盛り合わせ", 1580, en: "Today's sashimi platter"),
            m("i2", "c0", "黒毛和牛ステーキ", 2980, en: "Wagyu beef steak", options: true),
            m("i3", "c0", "自家製ポテトサラダ", 480, en: "Homemade potato salad"),
            m("i4", "c1", "枝豆", 390, kana: "エダマメ", en: "Edamame"),
            m("i5", "c1", "唐揚げ", 580, kana: "カラアゲ", en: "Karaage"),
            m("i6", "c1", "だし巻き玉子", 520, en: "Dashi rolled omelette"),
            m("i7", "c1", "シーザーサラダ", 690, en: "Caesar salad"),
            m("i8", "c1", "焼き鳥 盛り合わせ（5本）", 980, en: "Yakitori platter (5)", options: true),
            m("i9", "c1", "たこわさ", 420, en: "Octopus wasabi", soldOut: true),
            m("i10", "c1", "ガーリックライス", 650, en: "Garlic rice"),
            m("i11", "c2", "生ビール", 590, kana: "ナマビール", en: "Draft beer"),
            m("i12", "c2", "ハイボール", 490, en: "Highball"),
            m("i13", "c2", "レモンサワー", 490, en: "Lemon sour"),
            m("i14", "c2", "ウーロン茶", 350, en: "Oolong tea"),
            m("i15", "c2", "日本酒（一合）", 780, en: "Sake (180ml)", options: true),
            m("i16", "c3", "飲み放題 2時間", 2200, en: "All-you-can-drink 2h"),
            m("i17", "c3", "宴会コース 5,000円", 5000, en: "Party course ¥5,000"),
            NPMenuItem(id: "i19", categoryId: "c3", name: "キャンセル料", kana: nil, english: "Cancel fee", price: 0, soldOut: false, hasOptions: false, openPrice: true),
            m("i18", "c4", "抹茶アイス", 380, en: "Matcha ice cream"),
        ]
        let order = NPOrder(
            id: "o1", orderNo: 5998, tableName: "T3", guestCount: 2, customerName: nil,
            seatFrom: "18:30", seatTo: "20:30", clerkName: "Bimal",
            lines: [
                NPOrderLine(id: "l1", menuItemId: "i11", name: "生ビール", quantity: 2, unitPrice: 590, sent: true, english: "Draft beer"),
                NPOrderLine(id: "l2", menuItemId: "i4", name: "枝豆", quantity: 1, unitPrice: 390, sent: true, english: "Edamame"),
                NPOrderLine(id: "l3", menuItemId: "i5", name: "唐揚げ", quantity: 1, unitPrice: 580, sent: false, local: true, english: "Karaage"),
            ],
            visitSourceId: "tabelog"
        )
        let model = NativeOrderModel(storeName: "MEAT CROWN 新横浜", categories: cats, items: items, order: order, registerOpen: true)
        model.selectedCategory = "c1"
        func o(_ id: String, _ n: String, _ en: String, _ p: Int = 0) -> NPOptionGroup.Option { NPOptionGroup.Option(id: id, name: n, english: en, price: p) }
        model.optionGroups = [
            "i2": [
                NPOptionGroup(id: "g1", name: "焼き加減", english: "Doneness", isRequired: true, minSelect: 1, maxSelect: 1,
                              items: [o("o1", "レア", "Rare"), o("o2", "ミディアムレア", "Medium rare"), o("o3", "ミディアム", "Medium"), o("o4", "ウェルダン", "Well done")]),
                NPOptionGroup(id: "g2", name: "ソース", english: "Sauce", isRequired: true, minSelect: 1, maxSelect: 1,
                              items: [o("o5", "わさび醤油", "Wasabi soy"), o("o6", "ガーリック", "Garlic"), o("o7", "岩塩", "Rock salt")]),
                NPOptionGroup(id: "g3", name: "トッピング", english: "Toppings", isRequired: false, minSelect: 0, maxSelect: 3,
                              items: [o("o8", "フォアグラ", "Foie gras", 800), o("o9", "目玉焼き", "Fried egg", 150), o("o10", "トリュフ", "Truffle", 500), o("o11", "大盛りライス", "Large rice", 100)]),
            ],
            "i8": [NPOptionGroup(id: "g4", name: "味", english: "Flavor", isRequired: true, minSelect: 1, maxSelect: 1, items: [o("o12", "塩", "Salt"), o("o13", "タレ", "Sauce"), o("o14", "半々", "Half & half")])],
            "i15": [NPOptionGroup(id: "g5", name: "温度", english: "Temperature", isRequired: true, minSelect: 1, maxSelect: 1, items: [o("o15", "冷", "Cold"), o("o16", "常温", "Room temp"), o("o17", "燗", "Hot", 50)])],
        ]
        model.order.lines.insert(
            NPOrderLine(id: "l4", menuItemId: "i8", name: "焼き鳥 盛り合わせ（5本）", quantity: 1, unitPrice: 980, sent: true,
                        optionNames: ["タレ"], optionNamesEn: ["Sauce"], english: "Yakitori platter (5)"), at: 2)
        return model
    }
}
