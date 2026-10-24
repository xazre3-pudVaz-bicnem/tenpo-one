import Foundation

// この iPad の印刷の設定（2026-10-24 Ronnie「iOS プリンター＋設定」）。
// Web の localStorage 'tenpo-direct-print'（lib/direct-print.ts の DirectPrintConfig）と同じ形で UserDefaults に持つ。
//   printerIds … Wi-Fi で直接印刷する EPSON（printer_configs.id）
//   bluetooth  … iPad と Bluetooth・USB でつないだレシートプリンター（printerId ↔ 見つけた機械）
//   lan        … この iPad から LAN（TCP 9100）で送るプリンター（printer_configs.id）
// Web と両方向に同期する：Web が書いたら（ブリッジの printConfig）取り込み、ネイティブが書いたら localStorage にも書く。
// どちらが新しいかは updatedAt（ネイティブが書いたときだけ付く。Web の writeDirectPrintConfig は落とす）で見る。

struct NPBluetoothLink: Codable, Equatable, Identifiable {
    var printerId: String
    var deviceId: String
    var deviceName: String
    /// star / epson / sii / escpos
    var maker: String
    /// bluetooth / usb / agent（agent は Safari だけ。アプリでは使わない）
    var via: String
    var id: String { printerId }

    static let makers: Set<String> = ["star", "epson", "sii", "escpos"]
    var isAppLink: Bool { via == "bluetooth" || via == "usb" }
    /// プリンターとして使ってよい機械か（Bluetooth LE はプリンターらしい名前かプリンターのサービスを出したものだけ。2026-10-24 Ronnie）
    var isPrinter: Bool { BluetoothPrinters.isPrinterDevice(maker: maker, via: via, deviceId: deviceId, name: deviceName) }
}

struct NPDirectPrintConfig: Equatable {
    var printerIds: [String] = []
    var bluetooth: [NPBluetoothLink] = []
    var lan: [String] = []
    /// ネイティブが書いた時刻（ms）。Web が書いたものには無い
    var updatedAt: Double? = nil

    var isEmpty: Bool { printerIds.isEmpty && bluetooth.isEmpty && lan.isEmpty }
    /// この iPad で印刷係が要るか（Bluetooth・LAN・Wi-Fi のどれかを使っている）
    var usesDevicePrinting: Bool { !printerIds.isEmpty || bluetooth.contains { $0.isAppLink && $0.isPrinter } || !lan.isEmpty }
    /// アプリが送る機械（プリンターでないもの＝テレビなどにつないだ古い設定は使わない）
    var appLinks: [NPBluetoothLink] { bluetooth.filter { $0.isAppLink && $0.isPrinter } }

    /// 中身が同じか（updatedAt は見ない）
    func sameContent(as other: NPDirectPrintConfig) -> Bool {
        printerIds == other.printerIds && bluetooth == other.bluetooth && lan == other.lan
    }

    /// localStorage の文字列を読む（lib/direct-print.ts の parseDirectPrintConfig と同じ甘さ：壊れていたら空）
    static func parse(_ raw: String?) -> NPDirectPrintConfig {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return NPDirectPrintConfig() }
        let idList: (Any?, Int) -> [String] = { v, max in
            var seen = Set<String>()
            return ((v as? [Any]) ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty && seen.insert($0).inserted }.prefix(max).map { $0 }
        }
        var links: [NPBluetoothLink] = []
        var seenPrinters = Set<String>()
        for item in (obj["bluetooth"] as? [Any]) ?? [] {
            guard let d = item as? [String: Any], let printerId = d["printerId"] as? String, let deviceId = d["deviceId"] as? String,
                  !deviceId.isEmpty, let maker = d["maker"] as? String, NPBluetoothLink.makers.contains(maker),
                  seenPrinters.insert(printerId).inserted else { continue }
            let via = (d["via"] as? String) == "usb" ? "usb" : (d["via"] as? String) == "agent" ? "agent" : "bluetooth"
            links.append(NPBluetoothLink(printerId: printerId, deviceId: deviceId, deviceName: (d["deviceName"] as? String) ?? "", maker: maker, via: via))
            if links.count >= 4 { break }
        }
        return NPDirectPrintConfig(
            printerIds: idList(obj["printerIds"], 8),
            bluetooth: links,
            lan: idList(obj["lan"], 8),
            updatedAt: (obj["updatedAt"] as? NSNumber)?.doubleValue
        )
    }

    /// localStorage に書く文字列（Web の parseDirectPrintConfig が読める形）
    func json() -> String {
        var obj: [String: Any] = [
            "printerIds": printerIds,
            "bluetooth": bluetooth.map { ["printerId": $0.printerId, "deviceId": $0.deviceId, "deviceName": $0.deviceName, "maker": $0.maker, "via": $0.via] },
            "lan": lan,
        ]
        if let updatedAt { obj["updatedAt"] = updatedAt }
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]), let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }
}

@MainActor
final class NativePrintConfig: ObservableObject {
    static let shared = NativePrintConfig()
    static let changed = Notification.Name("tenpo.directPrint.changed")

    private let key = "tenpo.directPrint"
    @Published private(set) var config: NPDirectPrintConfig

    private init() {
        config = NPDirectPrintConfig.parse(UserDefaults.standard.string(forKey: key))
    }

    /// ネイティブの画面から変える（保存して Web の localStorage にも書く）
    func update(_ change: (inout NPDirectPrintConfig) -> Void) {
        var next = config
        change(&next)
        next.updatedAt = Date().timeIntervalSince1970 * 1000
        store(next, notify: true)
        mirrorToWeb()
    }

    /// プリンターではない機械へのつなぎ（テレビ・スピーカーなど。昔の設定）を外す。外したものを返す
    @discardableResult
    func dropNonPrinterLinks() -> [NPBluetoothLink] {
        let bad = config.bluetooth.filter { $0.isAppLink && !$0.isPrinter }
        guard !bad.isEmpty else { return [] }
        update { c in c.bluetooth.removeAll { l in bad.contains { $0.printerId == l.printerId && $0.deviceId == l.deviceId } } }
        return bad
    }

    /// Web（ブリッジの printConfig）から。reason: load（画面を開いたとき）/ change（Web の設定で変えたとき）
    func importFromWeb(raw: String?, reason: String) {
        let web = NPDirectPrintConfig.parse(raw)
        let rawEmpty = (raw ?? "").isEmpty
        if reason == "load" {
            // 開いたときに Web が空＝新しい WKWebView の保存。ネイティブに設定があればそちらを Web に写す
            if rawEmpty || web.isEmpty, !config.isEmpty {
                mirrorToWeb()
                return
            }
            // ネイティブが書いた写し（updatedAt あり）は、ネイティブより新しいときだけ取り込む（入れ直しなど）
            if let w = web.updatedAt, let n = config.updatedAt, w <= n { return }
        }
        guard !web.sameContent(as: config) else { return }
        var next = web
        next.updatedAt = Date().timeIntervalSince1970 * 1000
        store(next, notify: true)
    }

    private func store(_ next: NPDirectPrintConfig, notify: Bool) {
        config = next
        UserDefaults.standard.set(next.json(), forKey: key)
        if notify { NotificationCenter.default.post(name: Self.changed, object: nil) }
    }

    /// Web の localStorage にも書く（Web の設定画面・Native OFF のときの DirectPrintAgent が同じ設定を見る）
    func mirrorToWeb() {
        let js = "try { localStorage.setItem('tenpo-direct-print', \(Self.jsString(config.json()))); window.dispatchEvent(new Event('tenpo-direct-print-changed')); } catch (e) {}"
        WebViewController.current?.runOnOwnPage(js)
    }

    /// 会計のレシートを出す機械：このiPadのレシートの出し先（cookie）がつないだ機械なら それ、そうでなければ1台だけつないでいるとき その1台
    /// （Web の checkoutBluetoothLink と同じ決め方。サーバーが店のプリンター・自動印刷・つなぎ方を確かめる）
    func checkoutLink(selectedPrinterId: String?) -> NPBluetoothLink? {
        let links = config.appLinks
        if let selectedPrinterId, let hit = links.first(where: { $0.printerId == selectedPrinterId }) { return hit }
        return links.count == 1 ? links[0] : nil
    }

    static func jsString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]), let arr = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(arr.dropFirst().dropLast())
    }
}
