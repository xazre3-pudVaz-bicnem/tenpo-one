import SwiftUI

// iPhone のネイティブのハンディ：卓の画面・注文の画面のデータと動き（2026-10-25 01:38 Ronnie「iPhone も native に。
// デザインは iPad のネイティブと同じ」）。中身・操作は Web のハンディ（/handy/[tableId]・/handy/[tableId]/order）と同じ。
//   GET  /api/app/v1/pos?part=handyTable&tableId=  … 卓の伝票・明細・呼び出し
//   GET  /api/app/v1/pos?part=handyMenu&orderId=   … 注文の画面のメニュー（Web と同じ loadHandyMenu）
//   POST handyOpenOrder / handySubmit / handyGuests / handyExtend / handyCancelItem / handyPrintBill / handyCallDone
// サーバー：lib/native-modules/handy-order.ts（Web と同じ Server Action を呼ぶ）

// MARK: - 卓の画面のデータ

struct NPHItem: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: Int
    let unitPrice: Double
    let lineTotal: Double
    let optionLabel: String?
    let sentAt: Double?
    let orderedAt: Double
}

struct NPHSlip: Codable, Identifiable, Hashable {
    let id: String
    let orderNo: Int
    let guestCount: Int
    let openedAt: Double
    let subtotal: Double
    let discountTotal: Double
    let total: Double
    let endsAt: Double?
    let items: [NPHItem]
}

struct NPHCall: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let note: String?
    let createdAt: Double
}

struct NPHTableInfo: Codable, Hashable {
    let id: String
    let name: String
    let capacityMax: Int?
    let status: String?
}

struct NPHTablePayload: Codable {
    let ok: Bool
    /// まとめた卓で伝票がほかの卓にあるとき、その卓
    let hostTableId: String?
    let table: NPHTableInfo?
    let clerk: NHDNamed?
    let slips: [NPHSlip]?
    let calls: [NPHCall]?
    let serverNow: Double?
    let cancelWindowMs: Double?
    let extendOptions: [Int]?
}

// MARK: - 注文の画面のデータ（Web の HandyPageTab と同じ形）

struct NPHMenuItem: Codable, Identifiable, Hashable {
    let id: String
    let categoryId: String?
    let name: String
    let nameEn: String?
    let price: Double
    let itemType: String
    let isSoldOut: Bool
    let offHours: Bool?
    let hasOptions: Bool
    let revealedBy: [String]?
}

struct NPHCategory: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let nameEn: String?
    /// alacarte / plan / service（¥0 の単品だけ金額を打つ）
    let tabId: String
    let items: [NPHMenuItem]
}

struct NPHPage: Codable, Identifiable, Hashable {
    let key: String
    let name: String?
    let label: String
    let categories: [NPHCategory]
    let hasPlanContent: Bool?
    var id: String { key }
}

struct NPHOptionItem: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let nameEn: String?
    let price: Double
}

struct NPHOptionGroup: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let isRequired: Bool
    let minSelect: Int
    let maxSelect: Int
    let items: [NPHOptionItem]
}

struct NPHOrderInfo: Codable, Hashable {
    let id: String
    let orderNo: Int
    let tableId: String?
    let tableName: String
    let guestCount: Int
    let total: Double
}

struct NPHMenuPayload: Codable {
    let ok: Bool
    let order: NPHOrderInfo
    let clerk: NHDNamed?
    let pages: [NPHPage]
    let initialPageKey: String?
    let optionGroupsByItem: [String: [NPHOptionGroup]]
}

/// カートの 1 行（Web の HandyCartLine と同じ）
struct NPHCartLine: Identifiable, Equatable {
    let key: String
    let menuItemId: String
    let name: String
    var unitPrice: Int
    var quantity: Int
    let optionItemIds: [String]
    let optionLabel: String
    let openPrice: Int?
    var memo: String?
    let custom: Custom?
    var id: String { key }

    struct Custom: Equatable { let categoryId: String?; let price: Int; let memo: String? }

    /// 同じ商品・同じ選択肢・同じ金額はまとめる（Web の cartLineKey と同じ）
    static func key(_ menuItemId: String, _ optionItemIds: [String], _ openPrice: Int?) -> String {
        let k = ([menuItemId] + optionItemIds.sorted()).joined(separator: "|")
        return openPrice.map { "\(k)|¥\($0)" } ?? k
    }

    var body: [String: Any] {
        var b: [String: Any] = ["menuItemId": menuItemId, "optionItemIds": optionItemIds, "quantity": quantity, "name": name]
        if let custom {
            var c: [String: Any] = ["price": custom.price, "categoryId": custom.categoryId ?? NSNull()]
            if let m = custom.memo { c["memo"] = m }
            b["custom"] = c
        }
        if let openPrice { b["openPrice"] = openPrice }
        if let memo, !memo.isEmpty { b["memo"] = memo }
        return b
    }
}

// MARK: - 共通

enum NPHApi {
    static func url(part: String, _ items: [String: String]) -> URL? {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: part)] + items.map { URLQueryItem(name: $0.key, value: $0.value) }
        return comps.url
    }

    static func get<T: Decodable>(_ type: T.Type, part: String, _ items: [String: String]) async throws -> T {
        guard let url = url(part: part, items) else { throw NativeAPIError(message: "通信できませんでした", useWeb: false) }
        let data = try await NativeAPI.shared.send(URLRequest(url: url))
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - 卓の画面

@MainActor
final class NativePhoneTableModel: ObservableObject {
    let tableId: String
    @Published var payload: NPHTablePayload?
    @Published var error: String?
    @Published var busy: String?
    @Published var toast: String?
    @Published var now = Date()
    /// まとめた卓の別の卓へ（親が開き直す）
    @Published var redirectTableId: String?
    private var offset: TimeInterval = 0
    private var clock: Timer?
    private var refresher: Timer?

    init(tableId: String) {
        self.tableId = tableId
        payload = NativeAPI.cached(NPHTablePayload.self, NPHApi.url(part: "handyTable", ["tableId": tableId]))
    }

    func start() {
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.now = Date().addingTimeInterval(self.offset)
            }
        }
        refresher?.invalidate()
        refresher = Timer.scheduledTimer(withTimeInterval: 12, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { await refresh() }
    }

    func stop() {
        clock?.invalidate(); clock = nil
        refresher?.invalidate(); refresher = nil
    }

    func refresh() async {
        // 見本（シミュレーターで形を確かめる・App Store の写真）では読みに行かない
        if NativePreview.current != nil { return }
        do {
            let p = try await NPHApi.get(NPHTablePayload.self, part: "handyTable", ["tableId": tableId])
            if let host = p.hostTableId { redirectTableId = host; return }
            if let s = p.serverNow { offset = s / 1000 - Date().timeIntervalSince1970; now = Date().addingTimeInterval(offset) }
            payload = p
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    @discardableResult
    func act(_ body: [String: Any], key: String, done: String? = nil) async -> [String: Any]? {
        guard busy == nil else { return nil }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { toast = r.error ?? "うまくいきませんでした"; return nil }
        if let done { toast = done }
        await refresh()
        return r.json ?? [:]
    }

    /// 注文の画面へ（伝票が無ければ作る）。返事の伝票 id
    func openOrder() async -> String? {
        guard let r = await act(["type": "handyOpenOrder", "tableId": tableId], key: "open") else { return nil }
        return r["orderId"] as? String
    }

    /// 送ってから 5 分以内の品か（ハンディで 1 つ取り消せる）
    func canCancel(_ item: NPHItem) -> Bool {
        let window = (payload?.cancelWindowMs ?? 300_000) / 1000
        let age = now.timeIntervalSince1970 - item.orderedAt / 1000
        return item.sentAt != nil && age >= -15 && age <= window + 15
    }

    func cancelLeft(_ item: NPHItem) -> Int {
        let window = (payload?.cancelWindowMs ?? 300_000) / 1000
        return max(0, Int(ceil(item.orderedAt / 1000 + window - now.timeIntervalSince1970)))
    }
}

// MARK: - 注文の画面

@MainActor
final class NativePhoneOrderModel: ObservableObject {
    let orderId: String
    @Published var payload: NPHMenuPayload?
    @Published var error: String?
    @Published var pageKey: String?
    @Published var catByPage: [String: String] = [:]
    @Published var cart: [NPHCartLine] = []
    @Published var sending = false
    @Published var message: String?
    private var customSeq = 0

    init(orderId: String) {
        self.orderId = orderId
        if let p = NativeAPI.cached(NPHMenuPayload.self, NPHApi.url(part: "handyMenu", ["orderId": orderId])) {
            payload = p
            pageKey = p.initialPageKey ?? p.pages.first?.key
        }
    }

    func load() async {
        // 見本（シミュレーターで形を確かめる・App Store の写真）では読みに行かない
        if NativePreview.current != nil { return }
        do {
            let p = try await NPHApi.get(NPHMenuPayload.self, part: "handyMenu", ["orderId": orderId])
            payload = p
            if pageKey == nil || !p.pages.contains(where: { $0.key == pageKey }) { pageKey = p.initialPageKey ?? p.pages.first?.key }
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    /// カートに入れたプランの中身も出したページ（Web の visibleHandyPages と同じ）
    var pages: [NPHPage] {
        guard let all = payload?.pages else { return [] }
        let inCart = Set(cart.map(\.menuItemId))
        let shown: (NPHMenuItem) -> Bool = { i in i.revealedBy == nil || i.revealedBy!.contains { inCart.contains($0) } }
        guard all.contains(where: { $0.categories.contains { $0.items.contains { $0.revealedBy != nil } } }) else { return all }
        return all.compactMap { p in
            let cats = p.categories.compactMap { c -> NPHCategory? in
                let items = c.items.filter(shown)
                return items.isEmpty ? nil : NPHCategory(id: c.id, name: c.name, nameEn: c.nameEn, tabId: c.tabId, items: items)
            }
            return cats.isEmpty ? nil : NPHPage(key: p.key, name: p.name, label: p.label, categories: cats, hasPlanContent: p.hasPlanContent)
        }
    }

    var page: NPHPage? { let ps = pages; return ps.first { $0.key == pageKey } ?? ps.first }
    var category: NPHCategory? {
        guard let p = page else { return nil }
        return p.categories.first { $0.id == catByPage[p.key] } ?? p.categories.first
    }

    func qty(item: String) -> Int { cart.filter { $0.menuItemId == item }.reduce(0) { $0 + $1.quantity } }
    func qty(category c: NPHCategory) -> Int { c.items.reduce(0) { $0 + qty(item: $1.id) } }
    var count: Int { cart.reduce(0) { $0 + $1.quantity } }
    var total: Int { cart.reduce(0) { $0 + $1.unitPrice * $1.quantity } }

    func groups(_ item: NPHMenuItem) -> [NPHOptionGroup] { payload?.optionGroupsByItem[item.id] ?? [] }

    /// 金額を打つ商品か（¥0 の単品。コース・飲み放題・サービスの ¥0 は打たない。Web と同じ）
    func isOpenPrice(_ item: NPHMenuItem, in c: NPHCategory) -> Bool { c.tabId == "alacarte" && item.price == 0 }

    func add(_ item: NPHMenuItem, options: [String] = [], openPrice: Int? = nil) {
        let opts = groups(item).flatMap(\.items).filter { options.contains($0.id) }
        let extra = Int(opts.reduce(0) { $0 + $1.price })
        let label = opts.map(\.name).joined(separator: "・")
        let key = NPHCartLine.key(item.id, options, openPrice)
        if let i = cart.firstIndex(where: { $0.key == key }) {
            cart[i].quantity = min(20, cart[i].quantity + 1)
        } else {
            cart.append(NPHCartLine(key: key, menuItemId: item.id, name: item.name, unitPrice: (openPrice ?? Int(item.price)) + extra,
                                    quantity: 1, optionItemIds: options, optionLabel: label, openPrice: openPrice, memo: nil, custom: nil))
        }
    }

    /// 「その他（金額入力）」。1 回ごとに別の行
    func addCustom(categoryId: String?, label: String, price: Int, memo: String) {
        customSeq += 1
        let text = memo.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = "custom:\(categoryId ?? "none"):\(customSeq)"
        cart.append(NPHCartLine(key: id, menuItemId: id, name: text.isEmpty ? "その他" : text, unitPrice: price, quantity: 1,
                                optionItemIds: [], optionLabel: label, openPrice: nil, memo: nil,
                                custom: .init(categoryId: categoryId, price: price, memo: text.isEmpty ? nil : text)))
    }

    func change(_ key: String, by d: Int) {
        guard let i = cart.firstIndex(where: { $0.key == key }) else { return }
        let n = cart[i].quantity + d
        if n <= 0 { cart.remove(at: i) } else { cart[i].quantity = min(20, n) }
    }

    func setMemo(_ key: String, _ memo: String) {
        guard let i = cart.firstIndex(where: { $0.key == key }) else { return }
        let t = memo.trimmingCharacters(in: .whitespacesAndNewlines)
        cart[i].memo = t.isEmpty ? nil : String(t.prefix(100))
    }

    /// 送る。全部送れたら送った点数、途中で止まったら nil（残りはカートに残してことばを出す）
    func submit() async -> Int? {
        guard !sending, !cart.isEmpty else { return nil }
        sending = true
        defer { sending = false }
        let r = await NSPApi.postJSON(["type": "handySubmit", "orderId": orderId, "lines": cart.map(\.body)])
        guard r.ok, let json = r.json else { message = r.error ?? "送信できませんでした"; return nil }
        let sent = json["sentQuantity"] as? Int ?? 0
        if let m = json["message"] as? String, !m.isEmpty {
            // 送れた分は伝票に入っている。残りだけカートに戻す
            let remaining = (json["remaining"] as? [[String: Any]]) ?? []
            let keys = Set(remaining.compactMap { r -> String? in
                guard let id = r["menuItemId"] as? String else { return nil }
                return NPHCartLine.key(id, (r["optionItemIds"] as? [String]) ?? [], r["openPrice"] as? Int)
            })
            if !remaining.isEmpty { cart = cart.filter { keys.contains($0.key) || ($0.custom != nil && keys.contains(NPHCartLine.key($0.menuItemId, [], nil))) } }
            else { cart = [] }
            message = m
            return remaining.isEmpty ? sent : nil
        }
        cart = []
        return sent
    }
}
