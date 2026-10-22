import Foundation

/// 注文確定の返事に付いてきた厨房伝票を、その場で LAN のプリンターへ送る（ios/Shared/LanPrinters.swift）。
/// 結果はサーバーへ printDone（出せなかったときは戻して、Web の DirectPrintAgent かプリンター自身が出す）。
/// 2026-10-21 Ronnie「印刷は超速く」
final class NativeLanPrint {
    static let shared = NativeLanPrint()

    func send(_ jobs: [APIPrintJob]) {
        for job in jobs {
            guard let data = Data(base64Encoded: job.data), !data.isEmpty else {
                report(job, result: "failed", code: "bad_data")
                continue
            }
            LanPrinters.shared.print(host: job.host, port: job.port, data: data) { [weak self] ok, code in
                guard let self else { return }
                if ok {
                    self.report(job, result: "printed", code: nil)
                } else if code == "unreachable" || code == "timeout" || code == "bad_host" {
                    self.report(job, result: "unreachable", code: code)
                } else {
                    // 送りかけて返事が無い（timeout_sent）など：もう一度送ると2枚出るかもしれないので戻さない
                    self.report(job, result: "failed", code: code.map { "lan: \($0)" })
                }
            }
        }
    }

    private func report(_ job: APIPrintJob, result: String, code: String?) {
        let body: [String: Any] = [
            "type": "printDone", "printerId": job.printerId, "jobId": job.id, "result": result,
            "code": code.map { $0 as Any } ?? NSNull(),
        ]
        Task { @MainActor in
            _ = try? await NativeAPI.shared.act(body, throwOnFail: false)
        }
    }
}
