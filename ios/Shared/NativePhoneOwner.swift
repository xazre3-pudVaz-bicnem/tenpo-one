import SwiftUI

// iPhone の店長・オーナーの画面（ネイティブ）を開く、ひとつの仕組み（2026-10-25 Ronnie「iPhone も native に」）。
// iPad の NativeModules.swift と同じ形。iPad の画面は使わない（iPhone の幅に合わせた画面を別に作る＝iPad を壊さない）。
//
// 画面を足すとき（どれも 1 行ずつ）:
//   1. NativePhoneOwnerRegistry.entries に Web の道 → key
//   2. NativePhoneOwnerScreen の switch に key → 画面（NPOFrame の中に作ると上のバー・戻るがそろう）
//   3. サーバーは iPad と同じ GET part（無ければ lib/native-modules/registry.ts に足す）
// 戻る＝オーナー・店長のホーム（state.closePhoneOwnerModule()）。別の画面へは state.leaveNativePhone(to: Web の道)（ネイティブがあればネイティブで開く）

enum NativePhoneOwnerRegistry {
    /// Web の道 → key（その下の道 /…/<id> も同じ key）。追加は 1 行ずつ
    private static let entries: [(String, String)] = [
        // ("/app/reports", "reports"),
        ("/app/reports", "reports"),
        ("/app/orders", "orders"),
        ("/app/budgets", "budgets"),
        ("/app/budgets/daily", "budgetDaily"),
    ]
    static let paths: [String: String] = Dictionary(entries, uniquingKeysWith: { a, _ in a })

    static func route(for url: URL) -> NativeModuleRoute? {
        guard AppConfig.isOwnHost(url) else { return nil }
        // ?web=1 は Web の画面のまま（返金・取消など、iPhone のネイティブに無い操作）
        if URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "web" }) == true { return nil }
        let path = url.path
        guard let b = paths.keys.filter({ path == $0 || path.hasPrefix($0 + "/") }).max(by: { $0.count < $1.count }), let key = paths[b] else { return nil }
        return NativeModuleRoute(key: key, url: url)
    }
}

/// key → 画面。追加は case を 1 つずつ
struct NativePhoneOwnerScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState

    var body: some View {
        switch route.key {
        case "reports": NativePhoneOwnerReportsScreen(route: route)
        case "orders": NativePhoneOwnerOrdersScreen(route: route)
        case "budgets": NativePhoneOwnerBudgetsScreen(route: route)
        case "budgetDaily": NativePhoneOwnerBudgetDailyScreen(route: route)
        default:
            // 知らない key：Web のまま見せる
            Color.clear.onAppear { state.phoneOwnerModule = nil }
        }
    }
}

/// iPhone の店長・オーナーの画面の枠（上のバー＝ネイビー・戻る・題名・右のボタン）。中身はスクロールしない（各画面で）
struct NPOFrame<Trailing: View, Content: View>: View {
    let title: String
    var subtitle: String = ""
    let onBack: () -> Void
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return VStack(spacing: 0) {
            NPHTopBar(title: title, subtitle: subtitle, backLabel: "ホーム", onBack: onBack, trailing: trailing)
            inner.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
    }
}

/// iPhone の店長・オーナーの画面で使う白いカード
struct NPOCard<Content: View>: View {
    var title: String = ""
    var trailing: String = ""
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 10) {
            if !title.isEmpty {
                HStack {
                    Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                    Spacer()
                    if !trailing.isEmpty { Text(trailing).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3) }
                }
            }
            inner
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }
}
