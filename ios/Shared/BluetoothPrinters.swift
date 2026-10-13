import Foundation
import CoreBluetooth
#if canImport(StarIO10)
import StarIO10
#endif

/// iPad とつなぐレシートプリンター（＋ドロア）。Bluetooth・USB（2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth、
/// チケットプリンターは LAN・Wi-Fi。ESC/POS・Star・RP-F10 を選べるように。Airレジ・funfo と同じ」）。
///
/// Web（components/printing/direct-print-agent.tsx）が印刷のバイト列（base64）を渡し、ここが送るだけ。
///   star   … Star mC-Print3 など（StarXpand SDK・StarIO10。Bluetooth / USB）。StarPRNT
///   epson  … EPSON TM-m30III など（ePOS SDK。Bluetooth / USB）。ESC/POS。SDK を ios/Vendor に置いたときだけ（EPSON_SDK）
///   sii    … SII RP-F10 など。ESC/POS。SII の SDK を入れるまでは Bluetooth LE で試す
///   escpos … そのほかの ESC/POS プリンター（Bluetooth LE）
/// Bluetooth（MFi）の Star・EPSON・SII は App Store に出すとき各社の MFi 承認が要る（ios/README.md）。
final class BluetoothPrinters: NSObject {
    static let shared = BluetoothPrinters()

    typealias Device = [String: String] // deviceId, name, maker, via
    typealias Done = (_ ok: Bool, _ code: String?) -> Void

    private let ble = BLEEscPosPrinter()
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
