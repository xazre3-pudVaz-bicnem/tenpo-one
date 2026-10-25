import SwiftUI
import UIKit
import QuickLook
import WebKit

// CSV・PDF などのファイルを iPad の中で渡す（2026-10-25 Ronnie「Make everything 101% native」）。
// Web の「CSV出力」（ブラウザのダウンロード）・「印刷」（window.print の印刷用ページ）の代わりに：
//   1. ログイン中のまま（Web と同じ Cookie）サーバーのファイル（/app/…/export など）を取ってくる
//   2. 一時ファイルに保存して
//   3. 共有シート（AirDrop・ファイルに保存・メール・プリント）か QuickLook（見る・印刷・共有）で出す
// 画面からは .sheet(item:) { NativeQuickLookSheet(url:) } ／ { NativeShareSheet(url:) } で使う。
// 裏の Web の画面（WKWebView）で CSV・PDF のダウンロード（/app/…/export など）が始まったときも、Web に出さずにここへ渡す
// （下の WebViewController の拡張。今までは WKWebView が何もしないか、CSV を文字のまま出していた）。

/// .sheet(item:) で出すファイル
struct NativeSharedFile: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}

enum NativeFileShare {
    /// サーバーのファイルを取ってくる（Cookie・x-tenpo-app は Web と同じ）。
    /// ログインが切れてログインの画面（HTML）が返ってきたときは、ファイルにせずにエラーにする
    @MainActor
    static func fetch(_ path: String) async throws -> Data {
        var req = URLRequest(url: AppConfig.url(path))
        req.setValue("1", forHTTPHeaderField: "x-tenpo-app")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let jar = await NativeAPI.shared.cookies()
        if let header = HTTPCookie.requestHeaderFields(with: jar)["Cookie"] {
            req.setValue(header, forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse {
            if http.statusCode >= 400 {
                let text = String(data: data.prefix(200), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let plain = !text.isEmpty && !text.hasPrefix("<") && !text.hasPrefix("{")
                throw NativeAPIError(message: plain ? text : "取り出せませんでした（\(http.statusCode)）", useWeb: false)
            }
            let type = (http.value(forHTTPHeaderField: "content-type") ?? "").lowercased()
            if type.contains("text/html") {
                throw NativeAPIError(message: "ログインし直してから、もう一度出してください", useWeb: false)
            }
        }
        return data
    }

    /// 一時フォルダにファイルを作る（名前の / : は _ に）。作れなければ nil
    static func save(_ data: Data, name: String) -> URL? {
        let safe = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tenpo-files", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(safe.isEmpty ? "file" : safe)
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    /// サーバーのファイルを取ってきて一時ファイルに（.sheet(item:) にそのまま渡せる）
    @MainActor
    static func download(_ path: String, name: String) async throws -> NativeSharedFile {
        let data = try await fetch(path)
        guard let url = save(data, name: name) else { throw NativeAPIError(message: "ファイルを保存できませんでした", useWeb: false) }
        return NativeSharedFile(url: url)
    }

    static func message(_ error: Error) -> String { (error as? NativeAPIError)?.message ?? "通信できませんでした" }

    @MainActor private static var quickLookSource: NativeQuickLookSource?

    /// UIKit から出す（SwiftUI の .sheet が使えない所：裏の Web の画面のダウンロードなど）。preview＝QuickLook、それ以外は共有シート
    @MainActor
    static func present(_ url: URL, preview: Bool) {
        guard let top = topController() else { return }
        if preview {
            let source = NativeQuickLookSource(url: url)
            // dataSource は弱い参照なので持っておく（次に出すときに入れ替わる）
            quickLookSource = source
            let ql = QLPreviewController()
            ql.dataSource = source
            top.present(ql, animated: true)
        } else {
            let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = vc.popoverPresentationController {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: 80, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            top.present(vc, animated: true)
        }
    }

    @MainActor
    static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first,
              var top = window.rootViewController else { return nil }
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    /// Content-Disposition のファイル名（filename*=UTF-8''… を先に。無ければ filename="…"）
    static func fileName(disposition: String?, fallback: String) -> String {
        let d = disposition ?? ""
        if let r = d.range(of: "filename*=UTF-8''", options: .caseInsensitive) {
            let raw = d[r.upperBound...].split(separator: ";").first.map(String.init) ?? ""
            if let name = raw.trimmingCharacters(in: .whitespaces).removingPercentEncoding, !name.isEmpty { return name }
        }
        if let r = d.range(of: "filename=", options: .caseInsensitive) {
            let raw = d[r.upperBound...].split(separator: ";").first.map(String.init) ?? ""
            let name = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")).trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { return name }
        }
        return fallback
    }
}

/// QuickLook の中身（UIKit から出すとき用）
final class NativeQuickLookSource: NSObject, QLPreviewControllerDataSource {
    let url: URL
    init(url: URL) { self.url = url }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}

// MARK: - 裏の Web の画面のダウンロード（CSV・PDF）をアプリで渡す

extension WebViewController {
    /// 自分のサイトの「ファイル」の返事（Content-Disposition: attachment・text/csv・application/pdf）は WKWebView に出さない。
    /// アプリでもう一度取ってきて（ログイン中の Cookie）、CSV は共有シート・PDF は QuickLook へ
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard navigationResponse.isForMainFrame,
              let http = navigationResponse.response as? HTTPURLResponse,
              let url = http.url, AppConfig.isOwnHost(url) else { return decisionHandler(.allow) }
        let disposition = http.value(forHTTPHeaderField: "Content-Disposition")
        let mime = (http.mimeType ?? "").lowercased()
        let isPdf = mime == "application/pdf"
        let isFile = (disposition ?? "").lowercased().hasPrefix("attachment") || mime == "text/csv" || isPdf
        guard isFile, http.statusCode < 400 else { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        var path = url.path
        if let q = url.query, !q.isEmpty { path += "?" + q }
        let fallback = url.lastPathComponent.isEmpty ? (isPdf ? "file.pdf" : "file.csv") : url.lastPathComponent + (isPdf ? ".pdf" : ".csv")
        let name = NativeFileShare.fileName(disposition: disposition, fallback: fallback)
        Task { @MainActor in
            do {
                let file = try await NativeFileShare.download(path, name: name)
                NativeFileShare.present(file.url, preview: isPdf)
            } catch {
                WebViewController.current?.showAlert(title: "ファイルを出せませんでした", message: NativeFileShare.message(error))
            }
        }
    }
}

/// 共有シート（AirDrop・ファイルに保存・メール・プリント）。.sheet の中身に
struct NativeShareSheet: UIViewControllerRepresentable {
    let url: URL
    var onDone: () -> Void = {}

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.completionWithItemsHandler = { _, _, _, _ in onDone() }
        return vc
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// QuickLook（PDF・CSV・写真を見る。右上から印刷・共有・ファイルに保存）。.sheet の中身に
struct NativeQuickLookSheet: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let ql = QLPreviewController()
        ql.dataSource = context.coordinator
        // 閉じるボタンが出るようにナビゲーションの中に入れる
        return UINavigationController(rootViewController: ql)
    }

    func updateUIViewController(_ nav: UINavigationController, context: Context) {
        guard context.coordinator.url != url else { return }
        context.coordinator.url = url
        (nav.viewControllers.first as? QLPreviewController)?.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
