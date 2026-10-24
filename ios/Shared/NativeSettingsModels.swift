import Foundation
import UIKit

// ネイティブの設定（2026-10-24 Ronnie「iOS プリンター＋設定」）。Web の /app/pos/settings「レジの設定」と /app/settings の入口。
//   読み込み GET /api/app/v1/pos?part=settings（lib/native-settings-server.ts）。操作は settingsPrinterSelect / Add / Save。
//   「この iPad から送る」などの端末ごとの ON/OFF は NativePrintConfig（UserDefaults・Web の localStorage と同期）。

struct NSTPrinter: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let maker: String?
    let btMaker: String?
    let model: String?
    let usage: String
    let usageLabel: String
    let billSlips: Bool
    let ip: String?
    let lanHost: String?
    let lanPort: Int?
    let enabled: Bool
    let connection: String?
    let delivery: String
    let paperWidthMm: Int
    let autoPrint: Bool
    let drawerKick: Bool
    let lanRelay: Bool
    let wifiDirect: Bool
    let deviceLink: Bool
}

struct NSTModel: Codable, Identifiable, Hashable {
    let id: String
    let maker: String
    let makerLabel: String
    let name: String
    let paper: Int
    let drawer: Bool
    let mobile: Bool
    let ready: Bool
}

struct NSTLink: Codable, Identifiable, Hashable { let id: String; let title: String; let description: String; let url: String; let allowed: Bool; let hint: String? }
struct NSTSection: Codable, Identifiable, Hashable { let id: String; let title: String; let en: String; let links: [NSTLink] }
struct NSTHubChild: Codable, Hashable { let href: String; let label: String; let en: String; let description: String }
struct NSTHub: Codable, Identifiable, Hashable { let label: String; let en: String; let href: String; let children: [NSTHubChild]; var id: String { href } }

struct NSTPayload: Codable {
    let store: NFNamed
    let userName: String
    let isRegisterDevice: Bool
    let canAdd: Bool
    let printers: [NSTPrinter]
    let selectedPrinterId: String?
    let models: [NSTModel]
    let sections: [NSTSection]
    let hubs: [NSTHub]
}

/// iPad が見つけたプリンター（BluetoothPrinters.discover の 1台）
struct NSTFound: Identifiable, Hashable {
    let deviceId: String
    let name: String
    let maker: String
    let via: String
    var id: String { deviceId }
}

@MainActor
final class NativeSettingsModel: ObservableObject {
    @Published var payload: NSTPayload?
    @Published var error: String?
    /// いま動かしている操作（ボタンを二重に押さない）
    @Published var busy: String?
    @Published var toast: String?
    @Published var found: [NSTFound]?
    @Published var lastTiming: String?

    // このiPadのプリンター（Bluetooth）のフォーム（Airレジと同じ並び）
    @Published var usePrinter = false
    @Published var modelId = ""
    @Published var paper = 80
    @Published var autoPrint = false
    @Published var drawer = true
    /// このiPadのレシートの出し先（cookie）。nil＝おまかせ
    @Published var selectedPrinterId: String?

    private var formKey = ""

    /// プリンターらしい名前（lib/direct-print.ts の PRINTER_NAME_PATTERN と同じ）
    private static let printerName = try? NSRegularExpression(
        pattern: #"(print|prt|pos\b|pos[-_ ]|receipt|thermal|label|\btm[-_ ]?[a-z0-9]|mc[-_ ]?print|\brp[-_ ]?[a-z]?\d|\bmpt|\bpt[-_ ]?\d|\bxp[-_ ]?[a-z]?\d|\bgp[-_ ]?[a-z]?\d|\btsp\d|\bsm[-_ ]?[a-z]\d|\bspp[-_ ]?r|\bcmp[-_ ]?\d|\bmtp|\brpp|\bztp|epson|\bstar\b|\bsii\b|seiko|citizen|bixolon|sunmi|hprt|xprinter|munbyn|rongta|gainscha|zebra|brother|58mm|80mm)"#,
        options: [.caseInsensitive]
    )

    // MARK: - 読み込み

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "settings")]
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NSTPayload.self, comps.url) { payload = saved; syncForm() }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NSTPayload.self, from: data)
            payload = p
            selectedPrinterId = p.selectedPrinterId
            error = nil
            syncForm()
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    // MARK: - 見るだけ

    var printers: [NSTPrinter] { payload?.printers ?? [] }
    var models: [NSTModel] { payload?.models ?? [] }
    var canAdd: Bool { payload?.canAdd ?? false }
    var config: NPDirectPrintConfig { NativePrintConfig.shared.config }

    /// iPad とつなぐレシート機：印刷を受けるもの＋管理画面で Bluetooth・USB として足しただけのもの
    var bluetoothPrinters: [NSTPrinter] { printers.filter { $0.usage == "receipt" && ($0.enabled || $0.deviceLink) } }
    /// このiPadとつないでいるプリンター（1台）
    var link: NPBluetoothLink? { config.appLinks.first { l in bluetoothPrinters.contains { $0.id == l.printerId } } }
    var linked: NSTPrinter? { link.flatMap { l in bluetoothPrinters.first { $0.id == l.printerId } } }
    var model: NSTModel? { models.first { $0.id == modelId } }
    /// 出し先に選べるのは Wi-Fi・LAN のプリンター（＋いま選んでいるこのiPadの Bluetooth のプリンター）
    var receiptPrinters: [NSTPrinter] {
        printers.filter { $0.enabled && ($0.usage == "receipt" || $0.billSlips) && (!$0.deviceLink || $0.id == selectedPrinterId) }
    }
    var lanPrinters: [NSTPrinter] { printers.filter { $0.lanRelay } }
    var wifiPrinters: [NSTPrinter] { printers.filter { $0.wifiDirect } }

    /// 保存してある機種名・メーカー名から、フォームの機種を決める（分からなければメーカーの代表機種）
    private func initialModel(of p: NSTPrinter) -> NSTModel? {
        let name = (p.model ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        if !name.isEmpty, let hit = models.first(where: { $0.name.lowercased() == name }) { return hit }
        let maker = (p.maker ?? "").lowercased()
        if maker.contains("star") { return models.first { $0.id == "star-mcp31" } }
        if maker.contains("epson") { return models.first { $0.id == "epson-tm-m30iii" } }
        return models.first { $0.id == (p.paperWidthMm == 58 ? "escpos-ble-58" : "escpos-ble-80") }
    }

    /// つないでいるプリンターの設定をフォームに入れる（読み込み・つなぎ直したとき）
    func syncForm() {
        guard let p = linked else { return }
        let key = "\(p.id):\(p.model ?? ""):\(p.paperWidthMm):\(p.autoPrint):\(p.drawerKick)"
        guard key != formKey else { return }
        formKey = key
        usePrinter = true
        modelId = initialModel(of: p)?.id ?? ""
        paper = p.paperWidthMm == 58 ? 58 : 80
        autoPrint = p.autoPrint
        drawer = p.drawerKick
    }

    func chooseModel(_ id: String) {
        modelId = id
        found = nil
        if let m = model { paper = m.paper; drawer = m.drawer }
    }

    // MARK: - サーバー

    private func act(_ body: [String: Any]) async -> [String: Any]? {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }

    /// /api/print/direct（試し印刷のデータ）
    private func direct(_ body: [String: Any]) async -> [String: Any]? {
        var req = URLRequest(url: AppConfig.url("/api/print/direct"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let data = try? await NativeAPI.shared.send(req, kickPrint: false) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    // MARK: - レシートの出し先

    func choose(_ id: String?) async {
        let prev = selectedPrinterId
        selectedPrinterId = id
        busy = "choose"
        defer { busy = nil }
        guard let r = await act(["type": "settingsPrinterSelect", "printerId": id.map { $0 as Any } ?? NSNull()]), r["ok"] as? Bool == true else {
            selectedPrinterId = prev
            return
        }
        let name = printers.first { $0.id == id }?.name
        toast = name.map { "このiPadのレシートは「\($0)」に出ます" } ?? "このiPadのレシートは店の既定のプリンターに出ます"
    }

    // MARK: - このiPadのプリンター（Bluetooth・USB）

    func toggleUse() async {
        if !usePrinter { usePrinter = true; return }
        // 使わない：このiPadとのつながりを外し、レシートは店の既定（おまかせ）に。店のプリンターの設定は消さない
        busy = "use"
        defer { busy = nil }
        if let l = link { NativePrintConfig.shared.update { c in c.bluetooth.removeAll { $0.printerId == l.printerId } } }
        guard let r = await act(["type": "settingsPrinterSelect", "printerId": NSNull()]), r["ok"] as? Bool == true else { return }
        usePrinter = false
        found = nil
        selectedPrinterId = nil
        formKey = ""
        await refresh()
        toast = "このiPadのプリンターを使わない設定にしました（レシートは店の既定のプリンター）"
    }

    private func discoverKind(_ m: NSTModel) -> String { m.maker == "star" ? "star" : m.maker == "epson" ? "epson" : "all" }

    private func matches(_ m: NSTModel, _ d: NSTFound) -> Bool {
        if m.maker == "star" { return d.maker == "star" }
        if m.maker == "epson" { return d.maker == "epson" }
        return d.maker == "escpos" || d.maker == "sii"
    }

    private func likelyPrinter(_ d: [String: String]) -> Bool {
        if d["via"] == "usb" { return true }
        if d["maker"] == "epson" || d["maker"] == "star" { return true }
        if ["1", "yes", "true"].contains(d["printer"] ?? "") { return true }
        let name = d["name"] ?? ""
        guard let re = Self.printerName else { return false }
        return re.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }

    func search() async {
        guard let m = model else { return }
        busy = "search"
        found = nil
        defer { busy = nil }
        let devices: [BluetoothPrinters.Device] = await withCheckedContinuation { cont in
            BluetoothPrinters.shared.discover(maker: discoverKind(m)) { cont.resume(returning: $0) }
        }
        let list = devices.compactMap { d -> NSTFound? in
            guard let id = d["deviceId"], !id.isEmpty else { return nil }
            return NSTFound(deviceId: id, name: d["name"] ?? "", maker: d["maker"] ?? "escpos", via: d["via"] == "usb" ? "usb" : "bluetooth")
        }.filter { f in matches(m, f) && likelyPrinter(devices.first { $0["deviceId"] == f.deviceId } ?? [:]) }
        if list.isEmpty {
            toast = m.maker == "escpos"
                ? "見つかりません。プリンターの電源を入れ、iPad の近くでもう一度押してください"
                : "見つかりません。プリンターの電源を入れ、iPad の 設定 > Bluetooth でプリンターをペアリングしてから、もう一度押してください"
            return
        }
        found = list
    }

    func connect(_ d: NSTFound) async {
        guard let m = model else { return }
        busy = "connect:\(d.deviceId)"
        defer { busy = nil }
        var body: [String: Any] = [
            "type": "settingsPrinterAdd", "name": d.name, "maker": d.maker, "via": d.via, "modelId": m.id,
            "paperWidthMm": paper, "autoPrint": autoPrint, "drawerKick": drawer,
        ]
        if let l = linked { body["printerId"] = l.id }
        guard let r = await act(body) else { return }
        guard r["ok"] as? Bool == true, let printer = r["printer"] as? [String: Any], let printerId = printer["id"] as? String else {
            toast = (r["error"] as? String) ?? "プリンターを使えるようにできませんでした"
            return
        }
        let oldId = linked?.id
        NativePrintConfig.shared.update { c in
            c.bluetooth.removeAll { $0.printerId == printerId || $0.printerId == oldId || $0.deviceId == d.deviceId }
            c.bluetooth.append(NPBluetoothLink(printerId: printerId, deviceId: d.deviceId, deviceName: d.name, maker: d.maker, via: d.via))
        }
        found = nil
        selectedPrinterId = printerId
        formKey = ""
        await refresh()
        toast = "「\(d.name)」とつなぎました。「試し印刷」で確かめてください"
    }

    func save() async {
        guard let l = linked else { toast = "先に「プリンターを探す」でプリンターとつないでください"; return }
        busy = "save"
        defer { busy = nil }
        let body: [String: Any] = [
            "type": "settingsPrinterSave", "printerId": l.id, "modelId": model.map { $0.id as Any } ?? NSNull(),
            "paperWidthMm": paper, "autoPrint": autoPrint, "drawerKick": drawer,
        ]
        guard let r = await act(body) else { return }
        guard r["ok"] as? Bool == true else { toast = (r["error"] as? String) ?? "保存できませんでした"; return }
        formKey = ""
        await refresh()
        toast = "保存しました"
    }

    /// 試し印刷・ドロア（Bluetooth・USB）
    func testBluetooth(_ kind: String) async {
        guard let l = link else { return }
        busy = kind
        defer { busy = nil }
        let started = Date()
        guard let r = await direct(["action": "test-bt", "printerId": l.printerId, "kind": kind]), r["ok"] as? Bool == true,
              let b64 = r["data"] as? String, let data = Data(base64Encoded: b64) else {
            toast = "試し印刷のデータを作れませんでした"
            return
        }
        let prepared = Date()
        let (ok, code) = await withCheckedContinuation { (cont: CheckedContinuation<(Bool, String?), Never>) in
            BluetoothPrinters.shared.print(deviceId: l.deviceId, maker: l.maker, via: l.via == "usb" ? "usb" : "bluetooth", data: data) { cont.resume(returning: ($0, $1)) }
        }
        if ok {
            let now = Date()
            lastTiming = "\(kind == "drawer" ? "ドロア" : "試し印刷")：サーバー \(Self.ms(started, prepared))・プリンター \(Self.ms(prepared, now))・合計 \(Self.ms(started, now))"
            toast = kind == "drawer" ? "ドロアが開きました" : "印刷できました"
        } else {
            toast = "つながりません（\(code ?? "エラー")）。プリンターの電源と iPad の Bluetooth を確かめてください"
        }
    }

    private static func ms(_ a: Date, _ b: Date) -> String { "\(Int(b.timeIntervalSince(a) * 1000))ms" }

    // MARK: - LAN

    func lanOn(_ id: String) -> Bool { config.lan.contains(id) }

    func toggleLan(_ id: String) {
        let on = !lanOn(id)
        NativePrintConfig.shared.update { c in
            if on { if !c.lan.contains(id) { c.lan.append(id) } } else { c.lan.removeAll { $0 == id } }
        }
        toast = on ? "この iPad から LAN で送ります（この iPad だけ）" : "この iPad から LAN で送るのをやめました"
    }

    func testLan(_ p: NSTPrinter, _ kind: String) async {
        busy = "\(p.id):\(kind)"
        defer { busy = nil }
        guard let r = await direct(["action": "test-lan", "printerId": p.id, "kind": kind]), r["ok"] as? Bool == true,
              let host = r["host"] as? String, let b64 = r["data"] as? String, let data = Data(base64Encoded: b64) else {
            toast = "試し印刷のデータを作れませんでした"
            return
        }
        let port = (r["port"] as? NSNumber)?.intValue ?? 9100
        let (ok, code) = await withCheckedContinuation { (cont: CheckedContinuation<(Bool, String?), Never>) in
            LanPrinters.shared.print(host: host, port: port, data: data) { cont.resume(returning: ($0, $1)) }
        }
        if ok { toast = kind == "drawer" ? "ドロアを開きました（LAN）" : "送りました（LAN）。紙が出たか確かめてください" }
        else if code == "timeout_sent" { toast = "プリンターの返事がありません。紙が出たか確かめてください" }
        else { toast = "つながりません。プリンターの電源・LAN ケーブル・IPアドレス、iPad が同じネットワークか確かめてください" }
    }

    // MARK: - Wi-Fi で直接印刷（EPSON）

    func wifiOn(_ id: String) -> Bool { config.printerIds.contains(id) }

    func toggleWifi(_ id: String) {
        let on = !wifiOn(id)
        NativePrintConfig.shared.update { c in
            if on { if !c.printerIds.contains(id) { c.printerIds.append(id) } } else { c.printerIds.removeAll { $0 == id } }
        }
        toast = on ? "Wi-Fi で直接印刷を ON にしました（このiPadだけ）" : "Wi-Fi で直接印刷を OFF にしました"
    }

    func testWifi(_ p: NSTPrinter, _ kind: String) async {
        busy = "\(p.id):\(kind)"
        defer { busy = nil }
        guard let r = await direct(["action": "test", "printerId": p.id, "kind": kind]), r["ok"] as? Bool == true,
              let host = r["host"] as? String, let soap = r["soap"] as? String else {
            toast = "試し印刷のデータを作れませんでした"
            return
        }
        switch await EposDirect.shared.send(host: host, soap: soap) {
        case .printed: toast = kind == "drawer" ? "ドロアが開きました（Wi-Fi 直接）" : "印刷できました（Wi-Fi 直接）"
        case .unreachable: toast = "つながりません。iPad がプリンターと同じ Wi-Fi か、IPアドレスを確かめてください"
        case .timeout: toast = "プリンターの返事がありません"
        case .printerError(let code): toast = EposDirect.errorLabel(code)
        }
    }
}

// MARK: - 見本（シミュレーターで形を確かめる用。-tenpoNativePreview settings）

extension NativeSettingsModel {
    static func sample() -> NativeSettingsModel {
        let m = NativeSettingsModel()
        let json = """
        {"store":{"id":"s1","name":"ORIENTAL ELEPHANT 高田馬場店"},"userName":"店長","isRegisterDevice":true,"canAdd":true,
         "printers":[
          {"id":"p1","name":"レジ（Star mC-Print3）","maker":"Star","btMaker":"star","model":"mC-Print3","usage":"receipt","usageLabel":"レシート","billSlips":false,"ip":null,"lanHost":null,"lanPort":null,"enabled":true,"connection":"bluetooth","delivery":"ipad","paperWidthMm":80,"autoPrint":true,"drawerKick":true,"lanRelay":false,"wifiDirect":false,"deviceLink":true},
          {"id":"p2","name":"キッチン","maker":"SII","btMaker":"sii","model":"RP-F10","usage":"kitchen","usageLabel":"厨房","billSlips":false,"ip":"192.168.1.50","lanHost":"192.168.1.50","lanPort":9100,"enabled":true,"connection":"lan","delivery":"ipad-lan","paperWidthMm":80,"autoPrint":true,"drawerKick":false,"lanRelay":true,"wifiDirect":false,"deviceLink":false},
          {"id":"p3","name":"ドリンク・バー","maker":"EPSON","btMaker":"epson","model":"TM-m30III","usage":"kitchen","usageLabel":"厨房","billSlips":false,"ip":"192.168.1.51","lanHost":"192.168.1.51","lanPort":9100,"enabled":true,"connection":"wifi","delivery":"sdp","paperWidthMm":80,"autoPrint":true,"drawerKick":false,"lanRelay":true,"wifiDirect":true,"deviceLink":false},
          {"id":"p4","name":"レジ（EPSON Wi-Fi）","maker":"EPSON","btMaker":"epson","model":"TM-m30III","usage":"receipt","usageLabel":"レシート","billSlips":true,"ip":"192.168.1.52","lanHost":"192.168.1.52","lanPort":9100,"enabled":true,"connection":"wifi","delivery":"sdp","paperWidthMm":80,"autoPrint":true,"drawerKick":true,"lanRelay":true,"wifiDirect":true,"deviceLink":false}
         ],
         "selectedPrinterId":"p4",
         "models":[
          {"id":"star-mcp31","maker":"star","makerLabel":"Star（スター精密）","name":"mC-Print3","paper":80,"drawer":true,"mobile":false,"ready":true},
          {"id":"star-mpop","maker":"star","makerLabel":"Star（スター精密）","name":"mPOP","paper":58,"drawer":true,"mobile":false,"ready":true},
          {"id":"epson-tm-m30iii","maker":"epson","makerLabel":"EPSON（エプソン）","name":"TM-m30III","paper":80,"drawer":true,"mobile":false,"ready":true},
          {"id":"sii-rp-f10","maker":"sii","makerLabel":"SII（セイコーインスツル）","name":"RP-F10","paper":80,"drawer":true,"mobile":false,"ready":false},
          {"id":"escpos-ble-80","maker":"escpos","makerLabel":"その他","name":"そのほかの ESC/POS（80mm）","paper":80,"drawer":true,"mobile":false,"ready":true}
         ],
         "sections":[
          {"id":"menu","title":"メニュー","en":"Menu","links":[
            {"id":"sold-out","title":"品切れ（売切・販売再開）","description":"売切にした商品は、レジ・ハンディ・お客様QRで注文できなくなります","url":"/app/pos/sold-out?from=register","allowed":true,"hint":null},
            {"id":"menu-items","title":"商品の追加・編集","description":"商品名・値段・英語名・カテゴリ・販売時間","url":"/app/settings/menu?from=register","allowed":true,"hint":null},
            {"id":"options","title":"選択肢（サイズ・トッピング）","description":"商品に付ける選択肢と追加料金","url":"/app/settings/options?from=register","allowed":false,"hint":"店長以上が変更できます"}
          ]},
          {"id":"kitchen","title":"キッチン・ドリンク","en":"Kitchen & drink","links":[
            {"id":"stations","title":"ドリンク機・キッチン機への振り分け","description":"カテゴリごとに出す厨房プリンター","url":"/app/settings/categories?from=register","allowed":true,"hint":null}
          ]}
         ],
         "hubs":[
          {"label":"店舗","en":"Store","href":"/app/settings/store","children":[{"href":"/app/settings/store","label":"店舗情報","en":"Store","description":""},{"href":"/app/settings/clerks","label":"POS担当者","en":"Clerks","description":""},{"href":"/app/settings/hours","label":"営業時間・休業日","en":"Hours","description":""}]},
          {"label":"メニュー","en":"Menu","href":"/app/settings/menu","children":[{"href":"/app/settings/menu","label":"メニュー","en":"Menu","description":""},{"href":"/app/settings/plans","label":"プラン","en":"Plans","description":""},{"href":"/app/settings/categories","label":"カテゴリ","en":"Categories","description":""}]},
          {"label":"予約・顧客","en":"Booking","href":"/app/settings/booking","children":[{"href":"/app/settings/booking","label":"予約受付ルール","en":"Booking rules","description":""},{"href":"/app/settings/tables","label":"テーブル・フロア","en":"Tables","description":""}]}
         ]}
        """
        if let p = try? JSONDecoder().decode(NSTPayload.self, from: Data(json.utf8)) {
            m.payload = p
            m.selectedPrinterId = p.selectedPrinterId
            m.usePrinter = true
            m.modelId = "star-mcp31"
            m.autoPrint = true
        }
        return m
    }
}
