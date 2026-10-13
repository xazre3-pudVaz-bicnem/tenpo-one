import Foundation
import UIKit

/// TENPO ONE アプリの設定。アプリは1つ（2026-10-13 Ronnie「funfo のように1つのアプリでいろいろ」）。
/// 何の画面になるかは、開いた端末で決める（コンパイルの印ではなく、動いている端末を見る）:
///   iPad   … レジ（Bluetooth・USB のレシートプリンター＋ドロア）
///   iPhone … 最初に「ハンディ（スタッフ）」か「オーナー・店長」を選ぶ
/// パソコンはアプリを使わない（ブラウザの管理画面）。
enum AppConfig {
    static let baseURL = URL(string: "https://www.tenpo-one.com")!
    static let ownHosts: Set<String> = ["www.tenpo-one.com", "tenpo-one.com"]

    /// iPad で動いているか（iPad＝レジ）
    static let isPad: Bool = UIDevice.current.userInterfaceIdiom == .pad

    /// Web に渡す「アプリの種類」（window.TenpoNative.app）
    static var appKind: String { isPad ? "regi" : "handy" }

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
