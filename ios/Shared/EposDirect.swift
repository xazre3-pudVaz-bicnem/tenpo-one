import Foundation

/// EPSON の ePOS-Print（プリンター内蔵の https）へ、お店の Wi-Fi で直接送る（Web の components/printing/direct-print-client.ts
/// sendToEposPrinter と同じ。2026-10-24 Ronnie「iOS プリンター＋設定」でネイティブに）。
/// プリンターの証明書は自己署名なので、お店の中のアドレス（192.168.x.x など）だけ信用する（Safari の「証明書を許可」が要らない）。
final class EposDirect: NSObject, URLSessionDelegate {
    static let shared = EposDirect()

    enum Outcome: Equatable {
        case printed
        /// プリンターは受け取ったが印刷できなかった（紙切れ・カバーなど）
        case printerError(String?)
        /// つながらない（Wi-Fi が違う・電源が切れている）
        case unreachable
        /// 送ったが返事が来なかった（印刷されたかどうか分からない）
        case timeout
    }

    /// プリンターの返事を待つ上限（lib/direct-print.ts の DIRECT_TIMEOUT_MS）
    static let timeoutMs = 10_000

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = TimeInterval(Self.timeoutMs) / 1000 + 2
        c.timeoutIntervalForResource = TimeInterval(Self.timeoutMs) / 1000 + 4
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpShouldSetCookies = false
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    /// SOAP（サーバーが作った ePOS-Print の本文）を送る
    func send(host: String, soap: String) async -> Outcome {
        let h = host.trimmingCharacters(in: .whitespaces)
        guard LanPrinters.isLocal(h), let url = URL(string: "https://\(h)/cgi-bin/epos/service.cgi?devid=local_printer&timeout=\(Self.timeoutMs)") else {
            return .unreachable
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("text/xml; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.setValue("Thu, 01 Jan 1970 00:00:00 GMT", forHTTPHeaderField: "If-Modified-Since")
        req.setValue("\"\"", forHTTPHeaderField: "SOAPAction")
        req.httpBody = soap.data(using: .utf8)
        do {
            let (data, response) = try await session.data(for: req)
            let text = String(data: data, encoding: .utf8) ?? ""
            let r = Self.parseResponse(text)
            if r.success { return .printed }
            if let code = r.code { return .printerError(code) }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) { return .printerError("HTTP \(http.statusCode)") }
            return .printerError(nil)
        } catch let e as URLError where e.code == .timedOut {
            return .timeout
        } catch {
            return .unreachable
        }
    }

    /// <response success="true" code="" status="…"/> を読む（lib/direct-print.ts の parseEposResponse と同じ）
    static func parseResponse(_ text: String) -> (success: Bool, code: String?) {
        guard let tagRange = text.range(of: "<response\\b[^>]*>", options: [.regularExpression, .caseInsensitive]) else { return (false, nil) }
        let tag = String(text[tagRange])
        func attr(_ name: String) -> String? {
            guard let r = tag.range(of: "\\b\(name)\\s*=\\s*\"([^\"]*)\"", options: [.regularExpression, .caseInsensitive]) else { return nil }
            let m = String(tag[r])
            guard let q1 = m.firstIndex(of: "\""), let q2 = m.lastIndex(of: "\""), q1 < q2 else { return nil }
            return String(m[m.index(after: q1)..<q2])
        }
        let success = ["true", "1"].contains((attr("success") ?? "").lowercased())
        let code = (attr("code") ?? "").trimmingCharacters(in: .whitespaces)
        return (success, code.isEmpty ? nil : code)
    }

    /// プリンターのエラーを、お店の人に分かる言葉に（lib/direct-print.ts の eposErrorLabel と同じ）
    static func errorLabel(_ code: String?) -> String {
        switch code {
        case "EPTR_COVER_OPEN": return "プリンターのカバーが開いています"
        case "EPTR_REC_EMPTY": return "レシートの紙がありません"
        case "EPTR_AUTOMATICAL", "EPTR_MECHANICAL", "EPTR_UNRECOVERABLE": return "プリンターのエラーです。電源を入れ直してください"
        case "DeviceNotFound", "EX_TIMEOUT": return "プリンターが応答しません"
        case "SchemaError", "ParameterError": return "印刷データをプリンターが読めませんでした"
        default: return code.map { "プリンターのエラー（\($0)）" } ?? "プリンターのエラー"
        }
    }

    // お店の中のプリンター（自己署名の証明書）だけ信用する
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        let space = challenge.protectionSpace
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust, LanPrinters.isLocal(space.host), let trust = space.serverTrust {
            return (.useCredential, URLCredential(trust: trust))
        }
        return (.performDefaultHandling, nil)
    }
}
