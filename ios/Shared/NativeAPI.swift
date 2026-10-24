import Foundation
import WebKit

// サーバー（/api/app/v1/pos。Web の lib/native-pos.ts）とのやりとり。
// ログインは Web と同じ Cookie（WKWebView の Cookie をそのまま使い、返ってきた Cookie も WKWebView に戻す）。
// 他のサイトから呼べないよう、必ず x-tenpo-app: 1 を付ける。

struct APICategory: Codable { let id: String; let name: String; let sub: String? }
/// 上のタブ（ページ）。Web のレジと同じページ・並び。categoryIds＝左の列に出すカテゴリ
struct APIPage: Codable { let key: String; let name: String; let sub: String?; let categoryIds: [String] }

struct APIItem: Codable {
    let id: String
    let categoryId: String?
    let name: String
    let kana: String?
    let english: String?
    let price: Int
    let soldOut: Bool
    let recommended: Bool
    let bestRank: Int?
    let hasOptions: Bool
    let openPrice: Bool
}

struct APILine: Codable {
    let id: String
    let menuItemId: String?
    let name: String
    let quantity: Int
    let unitPrice: Int
    let lineTotal: Int
    let sent: Bool
    /// 選んだ選択肢の名前（古いサーバーは無い）
    let options: [String]?
    /// 選んだ選択肢の英語名（iPad は英語を主に出す。古いサーバーは無い）
    let optionsEn: [String]?
}

struct APIOptionItem: Codable { let id: String; let name: String; let english: String?; let price: Int }
struct APIOptionGroup: Codable {
    let id: String
    let name: String
    let english: String?
    let isRequired: Bool
    let minSelect: Int
    let maxSelect: Int
    let items: [APIOptionItem]
}

struct APIOrder: Codable {
    let id: String
    let orderNo: Int
    let orderType: String
    let tableName: String?
    let guestCount: Int
    let clerkId: String?
    let customerName: String?
    let seatFrom: String?
    let seatTo: String?
    let visitSourceId: String?
    let subtotal: Int
    let taxTotal: Int
    let serviceCharge: Int
    let discountTotal: Int
    let discountReason: String?
    let total: Int
    let lines: [APILine]
}

struct APIBrand: Codable { let id: String; let name: String }
struct APIClerk: Codable { let id: String; let name: String }
struct APISource: Codable { let id: String; let label: String }
struct APIDiscountPreset: Codable { let id: String; let name: String; let kind: String; let value: Int }
struct APISteraTerminal: Codable { let id: String; let name: String; let online: Bool }
struct APISteraType: Codable { let code: String; let method: String; let label: String; let en: String? }
struct APIStore: Codable { let id: String; let name: String }

struct APIPayload: Codable {
    let store: APIStore
    let order: APIOrder
    /// 店のメニューまわりのハッシュ（iPad の保存と比べる。テイクアウトは無い）
    let catalogVersion: String?
    let categories: [APICategory]
    /// 上のタブ（古いサーバーは無い → タブを出さずにカテゴリを全部左に）
    let pages: [APIPage]?
    let items: [APIItem]
    /// 商品ごとの選択肢グループ（古いサーバーは無い → 選択肢の商品は今までの画面で）
    let optionGroups: [String: [APIOptionGroup]]?
    let clerks: [APIClerk]
    let clerkRequired: Bool
    let visitSources: [APISource]
    let methodBrands: [String: [APIBrand]]
    let pointBrands: [APIBrand]
    let discountPresets: [APIDiscountPreset]
    let steraTerminals: [APISteraTerminal]
    let steraPaymentTypes: [APISteraType]
    let registerOpen: Bool
    let canCheckout: Bool
    let canDiscount: Bool
    /// 上のタブを編集できるか（店長以上。古いサーバーは無い）
    let canEditPages: Bool?
}

/// 操作の返事（order があれば画面をサーバーの値にそろえる）
struct APICheckoutReceipt: Decodable {
    let data: String
    let deviceId: String
    let maker: String
    let via: String
}

struct APIResult: Decodable {
    let receipt: APICheckoutReceipt?
    let warning: String?
    let ok: Bool
    let error: String?
    let order: APIOrder?
    let printWarning: String?
    /// 注文確定のあと、iPad から LAN で直接出す厨房伝票（claimed 済み。出したら printDone）
    let prints: [APIPrintJob]?
    let newOrderId: String?
    let alreadyPaid: Bool?
    let registerClosed: Bool?
    let useWeb: Bool?
    // stera
    let requestId: String?
    let status: String?
    let finalized: Bool?
    let method: String?
    let brand: String?
    // ドロア
    let opened: Bool?
}

struct NativeAPIError: LocalizedError {
    let message: String
    let useWeb: Bool
    var errorDescription: String? { message }
}

@MainActor
final class NativeAPI {
    static let shared = NativeAPI()

    private let session: URLSession
    private let path = "/api/app/v1/pos"

    private init() {
        let config = URLSessionConfiguration.default
        // Cookie は自分で WKWebView と同じものを付け、返ってきたものを WKWebView に戻す（二重に持たない）
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 20
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    private var cookieStore: WKHTTPCookieStore { WKWebsiteDataStore.default().httpCookieStore }

    func cookies() async -> [HTTPCookie] {
        await withCheckedContinuation { cont in
            cookieStore.getAllCookies { all in
                cont.resume(returning: all.filter { c in AppConfig.ownHosts.contains { $0.hasSuffix(c.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) } })
            }
        }
    }

    private func saveCookies(from response: HTTPURLResponse, url: URL) async {
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { acc, kv in
            if let k = kv.key as? String, let v = kv.value as? String { acc[k] = v }
        }
        let fresh = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        for c in fresh {
            await withCheckedContinuation { cont in cookieStore.setCookie(c) { cont.resume() } }
        }
    }

    /// Cookie・x-tenpo-app を付けて送る（フロアなど別のファイルの拡張からも使う）。
    /// kickPrint: 操作（POST）のあとに印刷係を起こすか（印刷係自身の通信は false）
    func send(_ request: URLRequest, kickPrint: Bool = true) async throws -> Data {
        var req = request
        req.setValue("1", forHTTPHeaderField: "x-tenpo-app")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let jar = await cookies()
        if let header = HTTPCookie.requestHeaderFields(with: jar)["Cookie"] {
            req.setValue(header, forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await session.data(for: req)
        if let http = response as? HTTPURLResponse, let url = req.url {
            await saveCookies(from: http, url: url)
            if http.statusCode >= 400 {
                let r = try? JSONDecoder().decode(APIResult.self, from: data)
                throw NativeAPIError(message: r?.error ?? "通信できませんでした（\(http.statusCode)）", useWeb: r?.useWeb ?? false)
            }
        }
        // 操作（POST）のあとは、印刷係にすぐ見に行かせる（ネイティブ ON＝アプリ自身の NativePrintAgent、OFF＝裏の Web の DirectPrintAgent）。
        // 1 秒ごとの見回りや Realtime を待たずにレシート・伝票・ドロアが出る（2026-10-24 Ronnie「プリンターは超速く」）
        if kickPrint, req.httpMethod == "POST" {
            await MainActor.run {
                NativePrintAgent.shared.kick()
                WebViewController.current?.kickPrint()
            }
        }
        return data
    }

    /// 画面を開くときの全部
    func load(orderId: String) async throws -> APIPayload {
        var comps = URLComponents(url: AppConfig.url(path), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "order", value: orderId)]
        let data = try await send(URLRequest(url: comps.url!))
        return try JSONDecoder().decode(APIPayload.self, from: data)
    }

    /// 伝票・レジの開局・stera（軽い。メニューは iPad の保存から）
    func loadLive(orderId: String) async throws -> APILive {
        var comps = URLComponents(url: AppConfig.url(path), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "order", value: orderId), URLQueryItem(name: "part", value: "live")]
        let data = try await send(URLRequest(url: comps.url!))
        return try JSONDecoder().decode(APILive.self, from: data)
    }

    /// 店のメニューまわり（iPad に保存する）
    func loadCatalog(storeId: String?) async throws -> APICatalog {
        var comps = URLComponents(url: AppConfig.url(path), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "part", value: "catalog")]
        if let storeId { items.append(URLQueryItem(name: "store", value: storeId)) }
        comps.queryItems = items
        let data = try await send(URLRequest(url: comps.url!))
        struct Wrap: Decodable { let catalog: APICatalog }
        return try JSONDecoder().decode(Wrap.self, from: data).catalog
    }

    /// 操作（type と中身）
    func act(_ body: [String: Any], throwOnFail: Bool = true) async throws -> APIResult {
        var req = URLRequest(url: AppConfig.url(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await send(req)
        let result = try JSONDecoder().decode(APIResult.self, from: data)
        if throwOnFail && !result.ok { throw NativeAPIError(message: result.error ?? "うまくいきませんでした", useWeb: result.useWeb ?? false) }
        return result
    }
}
