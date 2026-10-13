import Foundation
import CoreBluetooth
import ExternalAccessory
#if canImport(StarIO10)
import StarIO10
#endif

/// iPad とつなぐレシートプリンター（＋ドロア）。Bluetooth・USB（2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth、
/// チケットプリンターは LAN・Wi-Fi。ESC/POS・Star・RP-F10 を選べるように。Airレジ・funfo と同じ」）。
///
/// Web（components/printing/direct-print-agent.tsx）が印刷のバイト列（base64）を渡し、ここが送るだけ。
///   star   … Star mC-Print3 など（StarXpand SDK・StarIO10。Bluetooth / USB）。StarPRNT
///   epson  … EPSON TM-m30III など。ESC/POS。iPad とペアリングすれば SDK なしで送れる（External Accessory「com.epson.escpos」）。
///            ePOS SDK を ios/Vendor に置いたときは SDK でも探す（EPSON_SDK）
///   sii    … SII RP-F10 など。ESC/POS。SII の SDK を入れるまでは Bluetooth LE で試す
///   escpos … そのほかの ESC/POS プリンター（Bluetooth LE）
/// Bluetooth（MFi）の Star・EPSON・SII は App Store に出すとき各社の MFi 承認が要る（ios/README.md）。
final class BluetoothPrinters: NSObject {
    static let shared = BluetoothPrinters()

    typealias Device = [String: String] // deviceId, name, maker, via
    typealias Done = (_ ok: Bool, _ code: String?) -> Void

    private let ble = BLEEscPosPrinter()
    private let accessory = AccessoryEscPosPrinters()
    #if canImport(StarIO10)
    private let star = StarPrinters()
    #endif
    #if EPSON_SDK
    private let epson = EpsonPrinters()
    #endif

    /// 近くのプリンターを探す（約6秒）
    func discover(maker: String, completion: @escaping ([Device]) -> Void) {
        let group = DispatchGroup()
        var all: [Device] = []
        let lock = NSLock()
        let add: ([Device]) -> Void = { list in lock.lock(); all.append(contentsOf: list); lock.unlock() }

        #if canImport(StarIO10)
        if maker == "star" || maker == "all" {
            group.enter()
            star.discover { add($0); group.leave() }
        }
        #endif
        #if EPSON_SDK
        if maker == "epson" || maker == "all" {
            group.enter()
            epson.discover { add($0); group.leave() }
        }
        #else
        if maker == "epson" || maker == "all" {
            group.enter()
            // EPSON だけを探していて見つからないときは、iOS のペアリングの一覧を出す
            accessory.discover(pairIfNone: maker == "epson") { add($0); group.leave() }
        }
        #endif
        if maker == "escpos" || maker == "sii" || maker == "all" {
            group.enter()
            ble.discover(maker: maker == "sii" ? "sii" : "escpos") { add($0); group.leave() }
        }
        group.notify(queue: .main) { completion(all) }
    }

    /// バイト列を送る（Star＝StarPRNT、それ以外＝ESC/POS）
    func print(deviceId: String, maker: String, via: String, data: Data, completion: @escaping Done) {
        let done: Done = { ok, code in DispatchQueue.main.async { completion(ok, code) } }
        // iPad とペアリングした EPSON（External Accessory）。メーカーを「その他」で登録していても同じ
        if deviceId.hasPrefix(AccessoryEscPosPrinters.idPrefix) {
            accessory.print(deviceId: deviceId, data: data, completion: done)
            return
        }
        switch maker {
        case "star":
            #if canImport(StarIO10)
            star.print(identifier: deviceId, usb: via == "usb", data: data, completion: done)
            #else
            done(false, "no_sdk")
            #endif
        case "epson":
            #if EPSON_SDK
            epson.print(target: deviceId, data: data, completion: done)
            #else
            done(false, "no_sdk")
            #endif
        default:
            ble.print(identifier: deviceId, data: data, completion: done)
        }
    }
}

// MARK: - Star（StarXpand SDK）

#if canImport(StarIO10)
private final class StarPrinters: NSObject, StarDeviceDiscoveryManagerDelegate {
    private var manager: StarDeviceDiscoveryManager?
    private var found: [BluetoothPrinters.Device] = []
    private var completion: (([BluetoothPrinters.Device]) -> Void)?

    func discover(completion: @escaping ([BluetoothPrinters.Device]) -> Void) {
        found = []
        self.completion = completion
        do {
            let m = try StarDeviceDiscoveryManagerFactory.create(interfaceTypes: [.bluetooth, .usb])
            m.discoveryTime = 6000
            m.delegate = self
            manager = m
            try m.startDiscovery()
        } catch {
            finish()
        }
    }

    func manager(_ manager: StarDeviceDiscoveryManager, didFind printer: StarPrinter) {
        let settings = printer.connectionSettings
        let model = printer.information.map { "\($0.model)" } ?? "Star"
        found.append([
            "deviceId": settings.identifier,
            "name": model,
            "maker": "star",
            "via": settings.interfaceType == .usb ? "usb" : "bluetooth",
        ])
    }

    func managerDidFinishDiscovery(_ manager: StarDeviceDiscoveryManager) { finish() }

    private func finish() {
        let c = completion
        completion = nil
        c?(found)
    }

    func print(identifier: String, usb: Bool, data: Data, completion: @escaping BluetoothPrinters.Done) {
        let printer = StarPrinter(StarConnectionSettings(interfaceType: usb ? .usb : .bluetooth, identifier: identifier))
        Task {
            do {
                try await printer.open()
                defer { Task { await printer.close() } }
                try await printer.print(raw: data)
                completion(true, nil)
            } catch {
                completion(false, "connect")
            }
        }
    }
}
#endif

// MARK: - EPSON（ePOS SDK。ios/Vendor/libepos2.xcframework があるときだけ。ios/tools/gen_project.py が EPSON_SDK を付ける）

#if EPSON_SDK
private final class EpsonPrinters: NSObject, Epos2DiscoveryDelegate, Epos2PtrReceiveDelegate {
    private var found: [BluetoothPrinters.Device] = []
    private var printing: (printer: Epos2Printer, done: BluetoothPrinters.Done)?

    func discover(completion: @escaping ([BluetoothPrinters.Device]) -> Void) {
        found = []
        let filter = Epos2FilterOption()
        filter.portType = EPOS2_PORTTYPE_ALL.rawValue
        filter.deviceType = EPOS2_TYPE_PRINTER.rawValue
        Epos2Discovery.start(filter, delegate: self)
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            Epos2Discovery.stop()
            completion(self.found.filter { ($0["via"] ?? "") != "lan" })
        }
    }

    func onDiscovery(_ deviceInfo: Epos2DeviceInfo!) {
        guard let info = deviceInfo, let target = info.target else { return }
        let via = target.hasPrefix("USB:") ? "usb" : target.hasPrefix("BT:") ? "bluetooth" : "lan"
        found.append(["deviceId": target, "name": info.deviceName ?? "EPSON", "maker": "epson", "via": via])
    }

    func print(target: String, data: Data, completion: @escaping BluetoothPrinters.Done) {
        guard let printer = Epos2Printer(printerSeries: EPOS2_TM_M30III.rawValue, lang: EPOS2_MODEL_JAPANESE.rawValue) else {
            return completion(false, "no_sdk")
        }
        printer.setReceiveEventDelegate(self)
        printer.addCommand(data)
        guard printer.connect(target, timeout: Int(EPOS2_PARAM_DEFAULT)) == EPOS2_SUCCESS.rawValue else {
            printer.clearCommandBuffer()
            return completion(false, "connect")
        }
        printing = (printer, completion)
        if printer.sendData(Int(EPOS2_PARAM_DEFAULT)) != EPOS2_SUCCESS.rawValue {
            finish(ok: false, code: "send")
        }
    }

    func onPtrReceive(_ printerObj: Epos2Printer!, code: Int32, status: Epos2PrinterStatusInfo!, printJobId: String!) {
        finish(ok: code == EPOS2_CODE_SUCCESS.rawValue, code: code == EPOS2_CODE_SUCCESS.rawValue ? nil : "EPOS2_\(code)")
    }

    private func finish(ok: Bool, code: String?) {
        guard let p = printing else { return }
        printing = nil
        p.printer.clearCommandBuffer()
        p.printer.setReceiveEventDelegate(nil)
        DispatchQueue.global().async { p.printer.disconnect() }
        p.done(ok, code)
    }
}
#endif

// MARK: - EPSON（Bluetooth・USB。SDK なし：iOS の External Accessory で ESC/POS をそのまま送る）

/// EPSON の TM プリンター（TM-m30III など。MFi）は、iPad の 設定 > Bluetooth でペアリングすると
/// External Accessory（プロトコル com.epson.escpos。App/Info.plist の UISupportedExternalAccessoryProtocols）で見える。
/// そこへ Web が作った ESC/POS のバイト列を送るだけで、レシート・領収書・ドロアが動く（ePOS SDK は要らない）。
/// 2026-10-13 Ronnie「五反田の EPSON を Bluetooth で。Airレジのように」
/// つないだまま使う（2枚目からは速い）。プリンターが切れたら、次の印刷でつなぎ直す。
private final class AccessoryEscPosPrinters: NSObject, StreamDelegate {
    static let idPrefix = "ea:"
    static let epsonProtocol = "com.epson.escpos"

    private final class Job: NSObject {
        let accessory: EAAccessory
        let data: Data
        let done: BluetoothPrinters.Done
        init(accessory: EAAccessory, data: Data, done: @escaping BluetoothPrinters.Done) {
            self.accessory = accessory
            self.data = data
            self.done = done
        }
    }

    // ここから下の queue・current・session は印刷用のスレッド（thread）でだけ触る
    private var thread: Thread!
    private var queue: [Job] = []
    private var current: Job?
    private var offset = 0
    private var session: EASession?
    private var timer: Timer?

    override init() {
        super.init()
        thread = Thread(target: self, selector: #selector(threadMain), object: nil)
        thread.name = "tenpo.printer.accessory"
        thread.start()
        EAAccessoryManager.shared().registerForLocalNotifications()
        NotificationCenter.default.addObserver(self, selector: #selector(accessoryDidDisconnect(_:)), name: .EAAccessoryDidDisconnect, object: nil)
    }

    @objc private func threadMain() {
        RunLoop.current.add(Port(), forMode: .default)
        while true {
            autoreleasepool { _ = RunLoop.current.run(mode: .default, before: .distantFuture) }
        }
    }

    private static func epsonAccessories() -> [EAAccessory] {
        EAAccessoryManager.shared().connectedAccessories.filter { $0.protocolStrings.contains(epsonProtocol) }
    }

    /// 機械の目印（シリアル番号。無ければ名前）
    static func deviceId(of a: EAAccessory) -> String {
        idPrefix + (a.serialNumber.isEmpty ? a.name : a.serialNumber)
    }

    private static func devices() -> [BluetoothPrinters.Device] {
        epsonAccessories().map { a in
            let name = a.name.isEmpty ? "EPSON" : a.name
            return ["deviceId": deviceId(of: a), "name": a.serialNumber.isEmpty ? name : "\(name)（\(a.serialNumber)）", "maker": "epson", "via": "bluetooth"]
        }
    }

    // 探す（ペアリング済み・つながっているもの）
    func discover(pairIfNone: Bool, completion: @escaping ([BluetoothPrinters.Device]) -> Void) {
        DispatchQueue.main.async {
            let list = Self.devices()
            guard list.isEmpty, pairIfNone else { return completion(list) }
            // まだペアリングしていない：iOS の一覧を出す（選ぶとペアリング）。終わったらもう一度見る
            EAAccessoryManager.shared().showBluetoothAccessoryPicker(withNameFilter: nil) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { completion(Self.devices()) }
            }
        }
    }

    // 送る
    func print(deviceId: String, data: Data, completion: @escaping BluetoothPrinters.Done) {
        DispatchQueue.main.async {
            guard let a = Self.epsonAccessories().first(where: { Self.deviceId(of: $0) == deviceId }) else {
                return completion(false, "not_found")
            }
            guard !data.isEmpty else { return completion(true, nil) }
            let job = Job(accessory: a, data: data, done: completion)
            self.perform(#selector(self.enqueue(_:)), on: self.thread, with: job, waitUntilDone: false)
        }
    }

    // MARK: 印刷用のスレッド

    @objc private func enqueue(_ job: Job) {
        queue.append(job)
        startNext()
    }

    private func startNext() {
        guard current == nil, !queue.isEmpty else { return }
        let job = queue.removeFirst()
        current = job
        offset = 0
        if session == nil || session?.accessory?.connectionID != job.accessory.connectionID {
            closeSession()
            guard let s = EASession(accessory: job.accessory, forProtocol: Self.epsonProtocol) else {
                return finish(false, "connect")
            }
            session = s
            let streams: [Stream?] = [s.inputStream, s.outputStream]
            for st in streams.compactMap({ $0 }) {
                st.delegate = self
                st.schedule(in: .current, forMode: .default)
                st.open()
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            self?.closeSession()
            self?.finish(false, "timeout")
        }
        write()
    }

    private func write() {
        guard let job = current, let out = session?.outputStream else { return }
        while offset < job.data.count, out.hasSpaceAvailable {
            let n = job.data.withUnsafeBytes { raw -> Int in
                guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                return out.write(base + offset, maxLength: min(job.data.count - offset, 4096))
            }
            if n < 0 {
                closeSession()
                return finish(false, "connect")
            }
            if n == 0 { break }
            offset += n
        }
        if offset >= job.data.count { finish(true, nil) }
    }

    func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
        switch eventCode {
        case .hasSpaceAvailable:
            write()
        case .hasBytesAvailable:
            // プリンターからの返事（状態）は使わないので読み捨てる
            if let input = aStream as? InputStream {
                var buf = [UInt8](repeating: 0, count: 256)
                while input.hasBytesAvailable, input.read(&buf, maxLength: buf.count) > 0 {}
            }
        case .errorOccurred, .endEncountered:
            closeSession()
            if current != nil { finish(false, "connect") }
        default:
            break
        }
    }

    private func finish(_ ok: Bool, _ code: String?) {
        timer?.invalidate()
        timer = nil
        guard let job = current else { return }
        current = nil
        job.done(ok, code)
        startNext()
    }

    private func closeSession() {
        guard let s = session else { return }
        session = nil
        let streams: [Stream?] = [s.inputStream, s.outputStream]
        for st in streams.compactMap({ $0 }) {
            st.delegate = nil
            st.close()
            st.remove(from: .current, forMode: .default)
        }
    }

    @objc private func accessoryDidDisconnect(_ note: Notification) {
        perform(#selector(dropSession), on: thread, with: nil, waitUntilDone: false)
    }

    @objc private func dropSession() {
        closeSession()
    }
}

// MARK: - そのほかの ESC/POS（Bluetooth LE。SDK なしで動く）

private final class BLEEscPosPrinter: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private var central: CBCentralManager!
    private var ready: [() -> Void] = []
    private var seen: [UUID: CBPeripheral] = [:]
    private var scanning: (maker: String, done: ([BluetoothPrinters.Device]) -> Void)?

    private var target: CBPeripheral?
    private var payload = Data()
    private var sendDone: BluetoothPrinters.Done?
    private var timeout: DispatchWorkItem?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    private func whenOn(_ run: @escaping () -> Void, failed: @escaping () -> Void) {
        switch central.state {
        case .poweredOn: run()
        case .unknown, .resetting: ready.append(run)
        default: failed()
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { return }
        let list = ready
        ready = []
        list.forEach { $0() }
    }

    // 探す
    func discover(maker: String, completion: @escaping ([BluetoothPrinters.Device]) -> Void) {
        whenOn({
            self.seen = [:]
            self.scanning = (maker, completion)
            self.central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                self.central.stopScan()
                let list: [BluetoothPrinters.Device] = self.seen.values.compactMap { p in
                    guard let name = p.name, !name.isEmpty else { return nil }
                    return ["deviceId": p.identifier.uuidString, "name": name, "maker": maker, "via": "bluetooth"]
                }
                let done = self.scanning?.done
                self.scanning = nil
                done?(list)
            }
        }, failed: { completion([]) })
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        seen[peripheral.identifier] = peripheral
    }

    // 送る
    func print(identifier: String, data: Data, completion: @escaping BluetoothPrinters.Done) {
        guard sendDone == nil else { return completion(false, "busy") }
        guard let uuid = UUID(uuidString: identifier) else { return completion(false, "not_found") }
        whenOn({
            guard let p = self.central.retrievePeripherals(withIdentifiers: [uuid]).first else {
                return completion(false, "not_found")
            }
            self.target = p
            self.payload = data
            self.sendDone = completion
            p.delegate = self
            let t = DispatchWorkItem { [weak self] in self?.finish(false, "timeout") }
            self.timeout = t
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: t)
            self.central.connect(p, options: nil)
        }, failed: { completion(false, "bluetooth_off") })
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        finish(false, "connect")
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services, !services.isEmpty else { return finish(false, "connect") }
        services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard sendDone != nil, !payload.isEmpty else { return }
        guard let ch = service.characteristics?.first(where: { $0.properties.contains(.writeWithoutResponse) || $0.properties.contains(.write) }) else {
            return
        }
        let type: CBCharacteristicWriteType = ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        let size = max(20, min(peripheral.maximumWriteValueLength(for: type), 180))
        var offset = 0
        let bytes = payload
        payload = Data()
        while offset < bytes.count {
            let end = min(offset + size, bytes.count)
            peripheral.writeValue(bytes.subdata(in: offset..<end), for: ch, type: type)
            offset = end
        }
        // 書き込み終わるまで少し待ってから切る
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.finish(true, nil) }
    }

    private func finish(_ ok: Bool, _ code: String?) {
        timeout?.cancel()
        timeout = nil
        if let p = target { central.cancelPeripheralConnection(p) }
        target = nil
        payload = Data()
        let done = sendDone
        sendDone = nil
        done?(ok, code)
    }
}
