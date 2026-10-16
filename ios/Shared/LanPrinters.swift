import Foundation
import Network

/// LAN（有線・Wi-Fi）のプリンターへ、印刷のバイト列（ESC/POS）をそのまま送る（TCP の 9100 番。RAW）。
/// 2026-10-16 Ronnie「EPSON と SII RP-F10 を LAN で。どの店でも選べるように」
///
/// SII RP-F10（有線LAN）は、Star の CloudPRNT・EPSON の Server Direct Print のように自分から TENPO ONE へ
/// 印刷を取りに行けない。そこでレジの iPad（このアプリ）が印刷を受け取り（components/printing/direct-print-agent.tsx）、
/// お店の LAN でプリンターへ送る。EPSON でも Server Direct Print の無い機種はこれで送れる。
///
/// 送り先はお店の中のアドレスだけ（192.168.x.x・10.x.x.x・172.16〜31.x.x・○○.local）。
/// 初めて送るとき iOS の「ローカルネットワーク」の許可が出る（Info.plist の NSLocalNetworkUsageDescription）。
final class LanPrinters {
    static let shared = LanPrinters()

    typealias Done = (_ ok: Bool, _ code: String?) -> Void

    /// 送り終わるまで待つ上限（つながらない・送りかけて止まったとき）
    private let timeout: TimeInterval = 8
    /// 送ったあと、閉じる前に少し待つ（プリンターが受け取りきる前に切らない）
    private let settle: TimeInterval = 0.4
    /// 1台ずつ順番に送る（同じプリンターに2つの接続を同時に張らない）
    private let queue = DispatchQueue(label: "tenpo.lan-printers")

    /// バイト列を送る。code: unreachable（つながらない・まだ送っていない）/ timeout_sent（送りかけて返事が無い）/ bad_host / send
    func print(host: String, port: Int, data: Data, completion: @escaping Done) {
        let done: Done = { ok, code in DispatchQueue.main.async { completion(ok, code) } }
        let h = host.trimmingCharacters(in: .whitespaces)
        guard Self.isLocal(h), (1...65535).contains(port), let p = NWEndpoint.Port(rawValue: UInt16(port)), !data.isEmpty else {
            done(false, "bad_host")
            return
        }
        queue.async { self.send(host: h, port: p, data: data, done: done) }
    }

    /// queue の上で1件送る（終わるまで次の1件に進まない）
    private func send(host: String, port: NWEndpoint.Port, data: Data, done: @escaping Done) {
        let finishedSignal = DispatchSemaphore(value: 0)
        let conn = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        let worker = DispatchQueue(label: "tenpo.lan-printers.conn")
        var finished = false
        var started = false

        let finish: (Bool, String?) -> Void = { ok, code in
            // worker の上だけで呼ぶ
            if finished { return }
            finished = true
            conn.stateUpdateHandler = nil
            conn.cancel()
            done(ok, code)
            finishedSignal.signal()
        }

        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if started { return }
                started = true
                conn.send(content: data, completion: .contentProcessed { error in
                    if error != nil {
                        finish(false, "send")
                        return
                    }
                    worker.asyncAfter(deadline: .now() + self.settle) { finish(true, nil) }
                })
            case .waiting:
                // 経路が無い・断られた（プリンターの電源・LAN ケーブル・IP の違い・ローカルネットワークの許可）
                finish(false, "unreachable")
            case .failed:
                finish(false, started ? "send" : "unreachable")
            default:
                break
            }
        }
        worker.asyncAfter(deadline: .now() + timeout) {
            // 送りはじめていたら、出たかどうか分からない（もう一度送ると2枚出るかもしれない）
            finish(false, started ? "timeout_sent" : "unreachable")
        }
        conn.start(queue: worker)
        // 次の1件は、この1件が終わってから
        _ = finishedSignal.wait(timeout: .now() + timeout + 2)
    }

    /// お店の中のアドレスか（lib/direct-print.ts の isLocalPrinterHost と同じ）
    static func isLocal(_ host: String) -> Bool {
        let h = host.lowercased()
        if h.isEmpty { return false }
        if h.hasSuffix(".local") {
            return h.range(of: "^[a-z0-9-]+(\\.[a-z0-9-]+)*\\.local$", options: .regularExpression) != nil
        }
        let parts = h.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        var n: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.count <= 3, part.allSatisfy({ $0.isASCII && $0.isNumber }), let v = Int(part), v <= 255 else { return false }
            n.append(v)
        }
        return n[0] == 10 || (n[0] == 192 && n[1] == 168) || (n[0] == 172 && (16...31).contains(n[1]))
    }
}
