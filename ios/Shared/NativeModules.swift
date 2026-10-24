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
        ("/app/kitchen", "kitchen"),
        ("/app/onboarding", "onboarding"),
        ("/app/payroll", "payroll"),
        ("/app/accounting", "accounting"),
        ("/app/shifts", "shifts"),
        ("/app/employees", "employees"),
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
        case "kitchen": NativeKitchenView(onHome: { state.goNativeHome() })
        case "onboarding": NativeOnboardingView(onHome: { state.goNativeHome() })
        case "payroll": NativePayrollView(route: route, onHome: { state.goNativeHome() }, onWeb: { state.leaveNativeFloor(to: $0) })
        case "accounting": NativeAccountingView(route: route)
        case "shifts": NativeShiftsView(route: route, onHome: { state.goNativeHome() }, onWeb: { state.leaveNativeFloor(to: $0) })
        case "employees": NativeEmployeesView(route: route, onHome: { state.goNativeHome() })
        default:
            // 知らない key（古いアプリ）：Web のまま見せる
            Color.clear.onAppear { state.nativeModule = nil }
        }
    }
}

// MARK: - 読み込み・操作の共通（GET part ／ POST type）

struct NativeModuleOK: Decodable {
    let ok: Bool
    let error: String?
    let id: String?
}

enum NativeModuleAPI {
    /// GET /api/app/v1/pos?part=<part>&… を読む。前に読んだ中身があれば cached に入る（画面を開いた瞬間に出す用）
    static func url(_ part: String, _ query: [String: String] = [:]) -> URL {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: part)] + query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return comps.url!
    }

    static func get<T: Decodable>(_ type: T.Type, part: String, query: [String: String] = [:]) async throws -> T {
        let data = try await NativeAPI.shared.send(URLRequest(url: url(part, query)))
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func cached<T: Decodable>(_ type: T.Type, part: String, query: [String: String] = [:]) -> T? {
        NativeAPI.cached(T.self, url(part, query))
    }

    /// POST（{ type: …, … }）。失敗はサーバーのことばを投げる
    @discardableResult
    static func post(_ body: [String: Any]) async throws -> NativeModuleOK {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await NativeAPI.shared.send(req, kickPrint: false)
        let r = try JSONDecoder().decode(NativeModuleOK.self, from: data)
        if !r.ok { throw NativeAPIError(message: r.error ?? "保存できませんでした", useWeb: false) }
        return r
    }

    static func message(_ error: Error) -> String { (error as? NativeAPIError)?.message ?? "通信できませんでした" }
}
