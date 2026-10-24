import SwiftUI

// まだ専用の台が無かった画面（勤怠・日報・タスク …）をネイティブで開く、ひとつの仕組み。
// 2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」。
//
// 画面を足すとき（3 か所。どれも 1 行ずつ足すだけ）:
//   1. NativeModuleRegistry.paths に Web の道 → key
//   2. NativeModuleScreen の switch に key → 画面
//   3. サーバーは lib/native-modules/registry.ts（GET part ／ POST type）
// 画面の中から別の画面へ行くときは state.leaveNativeFloor(to: Web の道)（ネイティブがあればネイティブで開く）、ホームは state.goNativeHome()

struct NativeModuleRoute: Hashable, Identifiable {
    let key: String
    let url: URL
    var id: String { key + "|" + url.absoluteString }
    /// Web の道の ?name= の値
    func query(_ name: String) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }
    /// 道の残り（/app/employees/<id> の <id> など）
    var rest: String {
        guard let base = NativeModuleRegistry.base(for: url.path) else { return "" }
        return String(url.path.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

enum NativeModuleRegistry {
    /// Web の道 → key（その下の道 /…/<id> も同じ key で開く）。追加は 1 行ずつ
    private static let entries: [(String, String)] = [
        // ("/app/attendance", "attendance"),
    ]
    static let paths: [String: String] = Dictionary(entries, uniquingKeysWith: { a, _ in a })

    /// いちばん長く当たる道
    static func base(for path: String) -> String? {
        paths.keys.filter { path == $0 || path.hasPrefix($0 + "/") }.max { $0.count < $1.count }
    }

    static func route(for url: URL) -> NativeModuleRoute? {
        guard AppConfig.isOwnHost(url), let b = base(for: url.path), let key = paths[b] else { return nil }
        return NativeModuleRoute(key: key, url: url)
    }
}

/// key → 画面。追加は case を 1 つずつ
struct NativeModuleScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState

    var body: some View {
        switch route.key {
        // case "attendance": NativeAttendanceScreen(route: route)
        default:
            // 知らない key（古いアプリ）：Web のまま見せる
            Color.clear.onAppear { state.nativeModule = nil }
        }
    }
}
