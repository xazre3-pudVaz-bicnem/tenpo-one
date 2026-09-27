import Foundation

/// TENPO ONE アプリの設定（レジ iPad／ハンディ・オーナー iPhone で共通）。
/// どちらのアプリかはコンパイル時の REGI / HANDY で決める（Xcode の target ごとの SWIFT_ACTIVE_COMPILATION_CONDITIONS）。
enum AppConfig {
    static let baseURL = URL(string: "https://www.tenpo-one.com")!
    static let ownHosts: Set<String> = ["www.tenpo-one.com", "tenpo-one.com"]

    #if REGI
    static let appKind = "regi"
    #else
    static let appKind = "handy"
    #endif

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }

    /// APNs の環境（Xcode から直接入れたときは sandbox、TestFlight・App Store は production）
    static var pushEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    static func isOwnHost(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        return ownHosts.contains(host)
    }

    static func url(_ path: String) -> URL {
        URL(string: path, relativeTo: baseURL)!.absoluteURL
    }
}
