import Foundation
import UIKit

/// アプリ自身の印刷係（Web の components/printing/direct-print-agent.tsx と同じ仕事をネイティブで。2026-10-24 Ronnie「iOS プリンター＋設定」）。
/// ネイティブ ON の iPad（レジ）で、この iPad の印刷の設定（NativePrintConfig）にあるプリンター宛ての印刷を
/// /api/print/direct から1秒ごと（注文・会計の直後は何回か早めに）受け取り、
///   Bluetooth・USB（ios/Shared/BluetoothPrinters.swift）／ LAN（LanPrinters.swift）／ Wi-Fi 直接（EposDirect.swift）
/// で出す。出せなかった（つながらない）ときはキューに戻して、プリンター自身（CloudPRNT・Server Direct Print）に任せる。
/// Web の画面が裏で止まっていても出る（WKWebView に頼らない）。Web の DirectPrintAgent はこのあいだ休む（window.TenpoNative.print.native）。
@MainActor
final class NativePrintAgent: ObservableObject {
    static let shared = NativePrintAgent()

    /// 印刷を受け取りに行く間隔（lib/direct-print.ts の DIRECT_POLL_MS）
    private static let poll: TimeInterval = 1
    /// 注文・会計が入った直後に早めに見る時刻（direct-print-agent.tsx の KICK_DELAYS_MS）
    private static let kickDelays: [TimeInterval] = [0, 0.15, 0.6, 1.2, 2.0]
    private static let lanBackoff: TimeInterval = 5
    private static let btBackoff: TimeInterval = 5
    private static let wifiBackoff: TimeInterval = 15
    /// Bluetooth で送れなかった理由のうち「つながらない」もの（戻してもう一度）
    private static let btUnreachable: Set<String> = ["not_found", "connect", "unreachable", "bluetooth_off", "timeout", "no_sdk"]

    @Published private(set) var running = false
    /// プリンターごとの困りごと（printerId → 言葉）。つながって出せたら消える
    @Published private(set) var problems: [String: String] = [:]
    /// 最後の知らせ（設定画面の上に出す）
    @Published private(set) var notice: String?
    @Published private(set) var noticeAt: Date?
    /// 最後に出せた時刻（printerId → 時刻。「接続中」の表示）
    @Published private(set) var lastPrintedAt: [String: Date] = [:]
    /// 最後に取りに行った時刻（止まっていないかの目安）
    @Published private(set) var lastPolledAt: Date?

    private var pending: Task<Void, Never>?
    private var kicks: [Task<Void, Never>] = []
    private var ticking = false
    private var kickPending = false
    private var btBackoffUntil = Date.distantPast
    private var wifiBackoffUntil = Date.distantPast
    private var lanBackoffUntil: [String: Date] = [:]
    private var observers: [NSObjectProtocol] = []

    private init() {}

    func start() {
        guard !running else { return }
        running = true
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.schedule(after: 0) }
            },
            center.addObserver(forName: NativePrintConfig.changed, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.configChanged() }
            },
        ]
        schedule(after: 0.8)
    }

    func stop() {
        running = false
        pending?.cancel(); pending = nil
        kicks.forEach { $0.cancel() }; kicks = []
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
    }

    /// 注文・会計が入った：いつもの1秒を待たずに何回か早めに見る（NativeAPI の POST のあと）
    func kick() {
        guard running else { return }
        kickPending = true
        kicks.forEach { $0.cancel() }
        kicks = Self.kickDelays.map { delay in
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard !Task.isCancelled, let self, !self.ticking else { return }
                await self.tick()
            }
        }
    }

    /// 設定が変わった：待ちを忘れてすぐ見に行く
    private func configChanged() {
        btBackoffUntil = .distantPast
        wifiBackoffUntil = .distantPast
        lanBackoffUntil = [:]
        problems = [:]
        schedule(after: 0)
    }

    private func schedule(after seconds: TimeInterval) {
        guard running else { return }
        pending?.cancel()
        pending = Task { @MainActor [weak self] in
            if seconds > 0 { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            guard !Task.isCancelled, let self else { return }
            await self.tick()
        }
    }

    private func tick() async {
        guard running else { return }
        if ticking { schedule(after: Self.poll); return }
        let cfg = NativePrintConfig.shared.config
        // この iPad は使っていない（何もしない。設定が変わったら configChanged で動き出す）
        guard cfg.usesDevicePrinting else { return }
        // 画面が裏のときは見ない（戻ってきたら didBecomeActive で動き出す）
        guard UIApplication.shared.applicationState == .active else { return }
        ticking = true
        kickPending = false
        lastPolledAt = Date()
        let printedBt = await bluetoothOnce(cfg.appLinks)
        let printedWifi = await wifiOnce(cfg.printerIds)
        let printedLan = await lanOnce(cfg.lan)
        ticking = false
        // 出したら続けて次の1件
        schedule(after: (printedBt || printedWifi || printedLan || kickPending) ? 0 : Self.poll)
    }

    // MARK: - 1件ずつ

    /// Bluetooth・USB のレシートプリンター。出したら true
    private func bluetoothOnce(_ links: [NPBluetoothLink]) async -> Bool {
        guard !links.isEmpty, Date() >= btBackoffUntil else { return false }
        guard let job = await next(["action": "next-bt", "printerIds": links.map { $0.printerId }]) else { return false }
        guard let link = links.first(where: { $0.printerId == job.printerId }) else {
            await done(job, "unreachable", nil)
            return false
        }
        guard let data = Data(base64Encoded: job.data), !data.isEmpty else {
            await done(job, "failed", "bt: bad_data")
            return false
        }
        let (ok, code) = await printBluetooth(link, data)
        if ok {
            await done(job, "printed", nil)
            printed(job.printerId)
            return true
        }
        if Self.btUnreachable.contains(code ?? "") {
            // 戻して、少し待ってからもう一度（Bluetooth はプリンター自身では印刷しないので、つながれば出る）
            await done(job, "unreachable", nil)
            btBackoffUntil = Date().addingTimeInterval(Self.btBackoff)
            problem(job.printerId, "\(job.printerName) につながりません。プリンターの電源と iPad の Bluetooth（USB はケーブル）を確かめてください")
            return false
        }
        await done(job, "failed", "bt: \(code ?? "error")")
        problem(job.printerId, "\(job.printerName)：\(EposDirect.errorLabel(code))")
        return false
    }

    /// Wi-Fi で直接印刷（EPSON）。出したら true
    private func wifiOnce(_ ids: [String]) async -> Bool {
        guard !ids.isEmpty, Date() >= wifiBackoffUntil else { return false }
        guard let job = await next(["action": "next", "printerIds": ids]) else { return false }
        switch await EposDirect.shared.send(host: job.host, soap: job.data) {
        case .printed:
            await done(job, "printed", nil)
            printed(job.printerId)
            return true
        case .unreachable:
            await done(job, "unreachable", nil)
            wifiBackoffUntil = Date().addingTimeInterval(Self.wifiBackoff)
            problem(job.printerId, "\(job.printerName) に Wi-Fi でつながりません。プリンター自身の印刷に切り替えます")
            return false
        case .timeout:
            // 送ったが返事が無い：もう一度送ると2枚出るかもしれないので、戻さない
            await done(job, "failed", "direct: timeout")
            problem(job.printerId, "\(job.printerName) の返事がありません。印刷されたか確かめてください")
            return false
        case .printerError(let code):
            await done(job, "failed", code)
            problem(job.printerId, "\(job.printerName)：\(EposDirect.errorLabel(code))")
            return false
        }
    }

    /// LAN のプリンター。出したら true
    private func lanOnce(_ ids: [String]) async -> Bool {
        let now = Date()
        let ready = ids.filter { (lanBackoffUntil[$0] ?? .distantPast) <= now }
        guard !ready.isEmpty else { return false }
        guard let job = await next(["action": "next-lan", "printerIds": ready]) else { return false }
        guard let data = Data(base64Encoded: job.data), !data.isEmpty else {
            await done(job, "failed", "lan: bad_data")
            return false
        }
        let (ok, code) = await withCheckedContinuation { (cont: CheckedContinuation<(Bool, String?), Never>) in
            LanPrinters.shared.print(host: job.host, port: job.port, data: data) { ok, code in cont.resume(returning: (ok, code)) }
        }
        if ok {
            await done(job, "printed", nil)
            lanBackoffUntil[job.printerId] = nil
            printed(job.printerId)
            return true
        }
        if code == "timeout_sent" {
            await done(job, "failed", "lan: timeout")
            problem(job.printerId, "\(job.printerName) の返事がありません。印刷されたか確かめてください")
            return false
        }
        if code == "unreachable" || code == "timeout" || code == "bad_host" {
            await done(job, "unreachable", nil)
            lanBackoffUntil[job.printerId] = Date().addingTimeInterval(Self.lanBackoff)
            problem(job.printerId, "\(job.printerName) に LAN でつながりません。プリンターの電源・LAN ケーブル・IPアドレスを確かめてください")
            return false
        }
        await done(job, "failed", "lan: \(code ?? "error")")
        problem(job.printerId, "\(job.printerName)：\(EposDirect.errorLabel(code))")
        return false
    }

    // MARK: - サーバー（/api/print/direct）

    private struct Job {
        let id: String
        let printerId: String
        let printerName: String
        /// bt・lan は印刷のバイト列（base64）、Wi-Fi は SOAP
        let data: String
        let host: String
        let port: Int
    }

    private func next(_ body: [String: Any]) async -> Job? {
        guard let res = await post(body), let j = res["job"] as? [String: Any],
              let id = j["id"] as? String, let printerId = j["printerId"] as? String else { return nil }
        return Job(
            id: id,
            printerId: printerId,
            printerName: (j["printerName"] as? String) ?? "プリンター",
            data: (j["data"] as? String) ?? (j["soap"] as? String) ?? "",
            host: (j["host"] as? String) ?? "",
            port: (j["port"] as? NSNumber)?.intValue ?? 9100
        )
    }

    private func done(_ job: Job, _ result: String, _ code: String?) async {
        _ = await post(["action": "done", "printerId": job.printerId, "jobId": job.id, "result": result, "code": code.map { $0 as Any } ?? NSNull()])
    }

    private func post(_ body: [String: Any]) async -> [String: Any]? {
        var req = URLRequest(url: AppConfig.url("/api/print/direct"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let data = try? await NativeAPI.shared.send(req, kickPrint: false) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func printBluetooth(_ link: NPBluetoothLink, _ data: Data) async -> (Bool, String?) {
        await withCheckedContinuation { (cont: CheckedContinuation<(Bool, String?), Never>) in
            BluetoothPrinters.shared.print(deviceId: link.deviceId, maker: link.maker, via: link.via == "usb" ? "usb" : "bluetooth", data: data) { ok, code in
                cont.resume(returning: (ok, code))
            }
        }
    }

    // MARK: - 知らせ

    private func printed(_ printerId: String) {
        lastPrintedAt[printerId] = Date()
        if problems[printerId] != nil { problems[printerId] = nil }
    }

    private func problem(_ printerId: String, _ text: String) {
        let first = problems[printerId] == nil
        problems[printerId] = text
        // 同じ困りごとを毎秒出し直さない（初めてのときだけ上に出す）
        if first { notice = text; noticeAt = Date() }
    }
}
