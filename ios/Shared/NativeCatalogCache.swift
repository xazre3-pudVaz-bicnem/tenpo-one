import Foundation

/// 店のメニューまわり（カテゴリ・商品・選択肢・担当者・会計の選択肢）を iPad に保存して、次にオーダー画面を開くときは
/// 保存したものを先に出す（Airレジのように押した瞬間に出る。2026-10-21 Ronnie「メニュー・印刷は超速く」）。
/// サーバーの `?part=catalog` を裏で読み、version が変わっていたら入れ替える。
struct APICatalog: Codable {
    let store: APIStore
    let categories: [APICategory]
    let items: [APIItem]
    let optionGroups: [String: [APIOptionGroup]]?
    let clerks: [APIClerk]
    let clerkRequired: Bool
    let visitSources: [APISource]
    let methodBrands: [String: [APIBrand]]
    let pointBrands: [APIBrand]
    let discountPresets: [APIDiscountPreset]
    let steraPaymentTypes: [APISteraType]
    let canCheckout: Bool
    let canDiscount: Bool
    let version: String
}

/// 伝票を開く・読み直すときの軽い部分（`?part=live`）
struct APILive: Decodable {
    let order: APIOrder
    let registerOpen: Bool
    let steraTerminals: [APISteraTerminal]
    let storeId: String
}

/// 注文確定の返事に付いてくる、iPad から LAN で直接出す厨房伝票
struct APIPrintJob: Decodable {
    let id: String
    let printerId: String
    let printerName: String
    let host: String
    let port: Int
    let data: String
}

@MainActor
final class NativeCatalogCache {
    static let shared = NativeCatalogCache()

    private(set) var current: APICatalog?
    private var loadedFromDisk = false
    private var refreshing = false
    /// 裏で読み直したとき（画面が開いていれば入れ替える）
    var onUpdate: (@MainActor (APICatalog) -> Void)?

    private var fileURL: URL {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("tenpo-catalog.json")
    }

    /// 保存してあるもの（最初の1回だけディスクから読む）
    func load() -> APICatalog? {
        if !loadedFromDisk {
            loadedFromDisk = true
            if let data = try? Data(contentsOf: fileURL), let c = try? JSONDecoder().decode(APICatalog.self, from: data) {
                current = c
            }
        }
        return current
    }

    func save(_ c: APICatalog) {
        current = c
        loadedFromDisk = true
        if let data = try? JSONEncoder().encode(c) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }

    /// サーバーから読み直す（裏で）。変わっていたら保存して onUpdate
    func refresh(storeId: String? = nil) {
        guard !refreshing else { return }
        refreshing = true
        Task {
            defer { refreshing = false }
            guard let c = try? await NativeAPI.shared.loadCatalog(storeId: storeId ?? current?.store.id) else { return }
            if c.version != current?.version || c.store.id != current?.store.id {
                save(c)
                onUpdate?(c)
            }
        }
    }
}
