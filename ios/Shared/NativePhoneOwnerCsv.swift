import SwiftUI
import UIKit

// iPhone の店長・オーナー：CSV の取り出し（現金台帳・経費・原価・発注など。2026-10-25 Ronnie「101% native」）
// Web の画面の「CSV」ボタンと同じ道（/app/<画面>/export?…。中身・権限 csv.export は Web のまま）をアプリの中で取りに行き、
// iPhone の共有シート（ファイルに保存・AirDrop・メール）で渡す。Web の画面には行かない。
// ログインは Web と同じ Cookie（NativeAPI と同じく WKWebView の Cookie を付ける）。CSV 以外（ログイン画面など）が返ったらエラー

enum NPOCsv {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// CSV を取りに行って一時ファイルにする（返す URL を共有シートへ）
    static func download(path: String, query: [String: String] = [:], fallbackName: String) async throws -> URL {
        var comps = URLComponents(url: AppConfig.url(path), resolvingAgainstBaseURL: false)
        let items = query.filter { !$0.value.isEmpty }.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        comps?.queryItems = items.isEmpty ? nil : items
        guard let url = comps?.url else { throw Failure(message: "CSV の場所が正しくありません") }
        var req = URLRequest(url: url)
        req.setValue("1", forHTTPHeaderField: "x-tenpo-app")
        req.setValue("text/csv", forHTTPHeaderField: "accept")
        let jar = await NativeAPI.shared.cookies()
        if let header = HTTPCookie.requestHeaderFields(with: jar)["Cookie"] { req.setValue(header, forHTTPHeaderField: "Cookie") }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 60
        let (data, response) = try await URLSession(configuration: config).data(for: req)
        guard let http = response as? HTTPURLResponse else { throw Failure(message: "通信できませんでした") }
        if http.statusCode == 401 || http.statusCode == 403 { throw Failure(message: "CSV を取り出す権限がありません") }
        if http.statusCode >= 400 { throw Failure(message: "CSV を取り出せませんでした（\(http.statusCode)）") }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        guard type.contains("csv") || type.contains("octet-stream") else {
            throw Failure(message: "CSV を取り出せませんでした。もう一度ログインしてからお試しください")
        }
        let name = fileName(http.value(forHTTPHeaderField: "Content-Disposition")) ?? fallbackName
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("csv", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(name.replacingOccurrences(of: "/", with: "_"))
        try data.write(to: file, options: .atomic)
        return file
    }

    /// Content-Disposition の filename*=UTF-8''… ／ filename="…"
    static func fileName(_ header: String?) -> String? {
        guard let h = header else { return nil }
        if let r = h.range(of: "filename*=UTF-8''") {
            let rest = h[r.upperBound...].split(separator: ";").first.map(String.init) ?? ""
            if let decoded = rest.removingPercentEncoding, !decoded.isEmpty { return decoded }
        }
        if let r = h.range(of: "filename=") {
            let rest = h[r.upperBound...].split(separator: ";").first.map(String.init) ?? ""
            let trimmed = rest.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
    }
}

/// 共有シートに渡すファイル
struct NPOCsvFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// iPhone の共有シート（ファイルに保存・AirDrop・メール）
struct NPOShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// 「CSV を取り出す」の行（押すと取りに行って共有シート）。各画面の CSV ボタンの代わり
struct NPOCsvButton: View {
    let title: String
    var sub: String = "iPhone の「ファイル」に保存・AirDrop・メールで送れます"
    let path: String
    var query: [String: String] = [:]
    let fileName: String
    /// 失敗したときのことばの出し先（各画面の toast・error）
    var onError: (String) -> Void = { _ in }

    @State private var busy = false
    @State private var file: NPOCsvFile?

    var body: some View {
        Button {
            guard !busy else { return }
            busy = true
            Task {
                defer { busy = false }
                if NativePreview.current != nil { onError("見本では CSV を取り出しません"); return }
                do {
                    let url = try await NPOCsv.download(path: path, query: query, fallbackName: fileName)
                    file = NPOCsvFile(url: url)
                } catch {
                    onError((error as? LocalizedError)?.errorDescription ?? "CSV を取り出せませんでした")
                }
            }
        } label: {
            HStack(spacing: 10) {
                Group {
                    if busy { ProgressView().tint(NT.purple) } else { Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .bold)) }
                }
                .foregroundColor(NT.purple).frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14.5, weight: NT.strong)).foregroundColor(NT.ink)
                    if !sub.isEmpty { Text(sub).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(2) }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 12).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
        .disabled(busy)
        .sheet(item: $file) { f in
            NPOShareSheet(items: [f.url]).ignoresSafeArea()
        }
    }
}
