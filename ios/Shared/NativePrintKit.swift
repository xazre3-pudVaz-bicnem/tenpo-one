import Foundation
import JavaScriptCore
import UIKit
import Combine

/// オフラインの印字キット（2026-10-24 Ronnie「net nachale pani print haru sabai kam、net chalepaxi afai sync」）。
/// サーバーと同じ印字の関数を1つにまとめた /print-kit.js（lib/print-kit.ts）と、店の道具箱（GET part=offlineKit：
/// プリンターの LAN アドレス・レシートの文言・厨房伝票の設定・商品の持ち場と税）を、ネットのあるときに iPad に保存しておき、
/// ネットが無いときは JavaScriptCore で呼んで、伝票・レシートのバイト列（と厨房伝票の TicketDesign）を作る。
/// デザインはサーバーと同じ（二重に作らない）。描くのは NativeTicketRaster、送るのは NativeOfflinePrint。
final class NativePrintKit {
    static let shared = NativePrintKit()

    /// 保存の名前（Application Support/tenpo-cache）
    private static let scriptFile = "print-kit-js"
    private static let scriptVersionKey = "tenpo.printKit.version"
    private static let kitKey = "offline-kit"
    /// 読み直す間隔（ネットがあるとき）
    private static let refreshEvery: TimeInterval = 10 * 60

    /// JavaScriptCore はこの列の上だけで触る
    private let queue = DispatchQueue(label: "tenpo.print-kit")
    private var context: JSContext?
    private var loadedScriptVersion: String?
    private var loadedKitVersion: String?
    private var lastRefresh = Date.distantPast
    private var refreshing = false
    private var observers: [NSObjectProtocol] = []
    private var netSink: AnyCancellable?

    private init() {}

    // MARK: - 取ってくる（ネットのあるとき）

    /// レジの iPad で動き出す（印刷係と同じとき）。起動・画面が前に来た・ネットが戻ったときに読み直す
    @MainActor func start() {
        guard observers.isEmpty else { return }
        observers = [
            NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.refreshSoon(force: false)
            },
        ]
        netSink = NativeNet.shared.$cameBackAt.dropFirst().sink { [weak self] at in
            if at != nil { self?.refreshSoon(force: true) }
        }
        refreshSoon(force: true)
    }

    @MainActor func stop() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        netSink = nil
    }

    private func refreshSoon(force: Bool) {
        Task { @MainActor in await self.refresh(force: force) }
    }

    /// キットと道具箱を新しくする（変わっていなければ何もしない）。失敗しても保存してあるものはそのまま
    @MainActor func refresh(force: Bool = false) async {
        guard NativeNet.shared.online, !refreshing else { return }
        if !force && Date().timeIntervalSince(lastRefresh) < Self.refreshEvery { return }
        refreshing = true
        defer { refreshing = false }
        lastRefresh = Date()
        await refreshScript()
        await refreshKit()
    }

    @MainActor private func refreshScript() async {
        do {
            let metaData = try await NativeAPI.shared.send(URLRequest(url: AppConfig.url("/print-kit.json")), kickPrint: false)
            struct Meta: Decodable { let version: String }
            let meta = try JSONDecoder().decode(Meta.self, from: metaData)
            let have = UserDefaults.standard.string(forKey: Self.scriptVersionKey)
            if have == meta.version, NativeDiskCache.load(Self.scriptFile) != nil { return }
            var req = URLRequest(url: AppConfig.url("/print-kit.js?v=\(meta.version)"))
            req.cachePolicy = .reloadIgnoringLocalCacheData
            let js = try await NativeAPI.shared.send(req, kickPrint: false)
            guard js.count > 1000, String(data: js.prefix(64), encoding: .utf8)?.contains("tenpo print-kit") == true else { return }
            NativeDiskCache.save(js, key: Self.scriptFile)
            UserDefaults.standard.set(meta.version, forKey: Self.scriptVersionKey)
            queue.async { self.context = nil; self.loadedScriptVersion = nil; self.loadedKitVersion = nil }
        } catch {
            NSLog("[print-kit] script refresh failed: \(error.localizedDescription)")
        }
    }

    @MainActor private func refreshKit() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var items = [URLQueryItem(name: "part", value: "offlineKit")]
            if let have = kitVersion { items.append(URLQueryItem(name: "have", value: have)) }
            comps.queryItems = items
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!), kickPrint: false)
            guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any], obj["ok"] as? Bool == true else { return }
            if obj["same"] as? Bool == true { return }
            guard let kit = obj["kit"], let kitData = try? JSONSerialization.data(withJSONObject: kit) else { return }
            NativeDiskCache.save(kitData, key: Self.kitKey)
            queue.async { self.loadedKitVersion = nil }
        } catch {
            NSLog("[print-kit] kit refresh failed: \(error.localizedDescription)")
        }
    }

    // MARK: - 保存してあるもの

    /// 保存してある道具箱の version（無ければ nil）
    var kitVersion: String? {
        guard let data = NativeDiskCache.load(Self.kitKey),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["version"] as? String
    }

    /// 保存してある道具箱（画面の表示用。プリンターの一覧など）
    var kit: OfflineKit? { NativeDiskCache.load(OfflineKit.self, key: Self.kitKey) }

    /// キットが使える（スクリプトと道具箱の両方が保存してある）
    var ready: Bool { NativeDiskCache.load(Self.scriptFile) != nil && NativeDiskCache.load(Self.kitKey) != nil }

    // MARK: - 呼ぶ

    struct KitError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// キットの関数を呼ぶ（引数・返り値は JSON 文字列）。JavaScriptCore の列の上で動く
    func call(_ fn: String, _ json: String) async throws -> String {
        try await withCheckedThrowingContinuation { cont in
            queue.async {
                do {
                    let ctx = try self.ensureContext()
                    guard let kit = ctx.objectForKeyedSubscript("TenpoPrintKit"), !kit.isUndefined,
                          let f = kit.objectForKeyedSubscript(fn), !f.isUndefined else {
                        throw KitError(message: "印字キットに \(fn) がありません（新しいキットを読み込んでください）")
                    }
                    ctx.exception = nil
                    let r = f.call(withArguments: [json])
                    if let ex = ctx.exception {
                        ctx.exception = nil
                        throw KitError(message: "印字キットのエラー：\(ex.toString() ?? "?")")
                    }
                    cont.resume(returning: r?.toString() ?? "")
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    /// JSON にして呼んで、JSON を読む
    func call<In: Encodable, Out: Decodable>(_ fn: String, _ input: In, as: Out.Type) async throws -> Out {
        let data = try JSONEncoder().encode(input)
        let out = try await call(fn, String(decoding: data, as: UTF8.self))
        return try JSONDecoder().decode(Out.self, from: Data(out.utf8))
    }

    /// queue の上で：スクリプトを読み込み、道具箱を入れる（変わったときだけ）
    private func ensureContext() throws -> JSContext {
        let scriptVersion = UserDefaults.standard.string(forKey: Self.scriptVersionKey) ?? "?"
        if context == nil || loadedScriptVersion != scriptVersion {
            guard let js = NativeDiskCache.load(Self.scriptFile), let code = String(data: js, encoding: .utf8) else {
                throw KitError(message: "印字キットがまだ保存されていません（一度ネットにつないでください）")
            }
            guard let ctx = JSContext() else { throw KitError(message: "印字キットを動かせません") }
            ctx.exceptionHandler = { c, ex in c?.exception = ex }
            ctx.evaluateScript(code)
            if let ex = ctx.exception {
                throw KitError(message: "印字キットを読み込めません：\(ex.toString() ?? "?")")
            }
            context = ctx
            loadedScriptVersion = scriptVersion
            loadedKitVersion = nil
        }
        guard let ctx = context else { throw KitError(message: "印字キットを動かせません") }
        if loadedKitVersion == nil {
            guard let kitData = NativeDiskCache.load(Self.kitKey) else {
                throw KitError(message: "お店のプリンターの情報がまだ保存されていません（一度ネットにつないでください）")
            }
            let setKit = ctx.objectForKeyedSubscript("TenpoPrintKit").objectForKeyedSubscript("setKit")
            let v = setKit?.call(withArguments: [String(decoding: kitData, as: UTF8.self)])
            if let ex = ctx.exception {
                ctx.exception = nil
                throw KitError(message: "お店の情報を読み込めません：\(ex.toString() ?? "?")")
            }
            loadedKitVersion = v?.toString()
        }
        return ctx
    }
}

/// 道具箱（lib/native-offline-kit.ts の NativeOfflineKit）のうち、画面で使うところ
struct OfflineKit: Decodable {
    struct Printer: Decodable, Identifiable {
        struct Lan: Decodable { let host: String; let port: Int }
        let id: String
        let name: String
        let usage: String
        let maker: String
        let paperWidth: Int
        let stations: [String]
        let lan: Lan?
    }
    struct Store: Decodable { let name: String }
    let version: String
    let storeId: String
    let store: Store
    let printers: [Printer]
}
