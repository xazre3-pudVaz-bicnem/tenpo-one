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
        ("/app/attendance", "attendance"),
        ("/app/shifts", "shifts"),
        ("/app/leave", "leave"),
        ("/app/employees", "employees"),
        ("/app/reports", "reports"),
        ("/app/orders", "orders"),
        ("/app/budgets", "budgets"),
        ("/app/budgets/daily", "budgetDaily"),
        ("/app/notifications", "notifications"),
        ("/app/announcements", "announcements"),
        ("/app/daily-reports", "dailyReports"),
        ("/app/tasks", "tasks"),
        ("/app/reservations", "reservations"), // 店舗台帳（NativePhoneOwnerLedger.swift）
        ("/app/customers", "customers"), // 顧客（NativePhoneOwnerCustomers.swift）
        ("/app/cash", "cash"),
        ("/app/cash/open", "cashClose"),
        ("/app/cash/close", "cashClose"),
        ("/app/expenses", "expenses"),
        ("/app/scan", "scan"),
        ("/app/inventory", "inventory"), // 在庫（品目・棚卸・移動・発注提案・予測。NativePhoneOwnerInventory.swift。?tab=menu は品切れ・残り数）
        ("/app/inventory/menu-stock", "stock"), // 品切れ・残り数（在庫設定。NativePhoneOwnerStock.swift）
        ("/app/vendors", "vendors"), // 仕入先（NativePhoneOwnerVendors.swift）
        ("/app/purchases", "purchases"), // 発注（一覧・作成・詳細・入荷。NativePhoneOwnerPurchases.swift）
        ("/app/costing", "costing"), // 原価管理（NativePhoneOwnerCosting.swift）
        ("/app/payroll", "payroll"),
        ("/app/manuals", "manuals"),
        ("/app/coupons", "coupons"),
        ("/app/pos/receipt", "receipt"), // レシートのプレビュー（NativePhoneOwnerReceipt.swift）
        ("/app/accounting", "accounting"), // 会計（仕訳・月次締め・帳簿・財務レポート・銀行口座・自動仕訳・固定資産。NativePhoneOwnerAccounting*.swift）
        ("/app/invoices", "invoices"), // 請求書・書類（?tab=inbox|documents。NativePhoneOwnerInvoices*.swift）
        ("/app/reconciliation", "reconciliation"), // 照合（NativePhoneOwnerReconciliation.swift）
        ("/app/settlement", "settlement"), // 月次清算（NativePhoneOwnerSettlement.swift）
        ("/app/settings", "settings"), // 設定（入口・/app/settings/<画面>。NativePhoneOwnerSettings*.swift）
        ("/app/settings-all", "settings"),
        ("/app/pos/settings", "settings"),
        ("/app/pos/sold-out", "settings"), // 品切れ（設定 › 品切れ）
        ("/app/staff", "staff"), // スタッフ管理（NativePhoneOwnerSettingsPeople.swift）
        ("/app/kitchen", "kitchen"), // キッチン（KDS。NativePhoneOwnerKitchen.swift）
    ]
    static let paths: [String: String] = Dictionary(entries, uniquingKeysWith: { a, _ in a })

    static func route(for url: URL) -> NativeModuleRoute? {
        guard AppConfig.isOwnHost(url) else { return nil }
        // ?web=1 は Web の画面のまま（返金・取消など、iPhone のネイティブに無い操作）
        if URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "web" }) == true { return nil }
        // ScanSnap のまとめて取り込み（/app/scan#scan-bulk）は iPhone のまとめて取り込み（NativePhoneOwnerScanBulk.swift）。CSV の取り出し（/app/cash/export など）は Web のまま
        if url.fragment == "scan-bulk" { return url.path == "/app/scan" ? NativeModuleRoute(key: "scanBulk", url: AppConfig.url("/app/scan#scan-bulk")) : nil }
        if url.path.hasSuffix("/export") { return nil }
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
        case "attendance": NativePhoneAttendanceScreen(route: route, onBack: { state.closePhoneOwnerModule() })
        case "shifts": NativePhoneShiftsScreen(route: route, onBack: { state.closePhoneOwnerModule() }, onWeb: { NPWNav.openWeb(state, $0) })
        case "leave": NativePhoneLeaveScreen(route: route, onBack: { state.closePhoneOwnerModule() })
        case "employees": NativePhoneEmployeesScreen(route: route, onBack: { state.closePhoneOwnerModule() })
        case "reports": NativePhoneOwnerReportsScreen(route: route)
        case "orders": NativePhoneOwnerOrdersScreen(route: route)
        case "budgets": NativePhoneOwnerBudgetsScreen(route: route)
        case "budgetDaily": NativePhoneOwnerBudgetDailyScreen(route: route)
        case "notifications": NativePhoneNotificationsScreen(route: route)
        case "announcements": NativePhoneAnnouncementsScreen(route: route)
        case "dailyReports": NativePhoneDailyReportsScreen(route: route)
        case "tasks": NativePhoneTasksScreen(route: route)
        case "reservations": NPOLedgerScreen(route: route)
        case "customers": NPOCustomersScreen(route: route)
        case "cash": NativePhoneOwnerCashScreen(route: route)
        case "cashClose": NativePhoneOwnerRegisterScreen(route: route)
        case "expenses": NativePhoneOwnerExpensesScreen(route: route)
        case "scan": NativePhoneOwnerScanScreen(route: route)
        case "scanBulk": NativePhoneOwnerScanBulkScreen(route: route) // ScanSnap のまとめて取り込み（/app/scan#scan-bulk）
        case "inventory": NativePhoneInventoryScreen(route: route)
        case "stock": NativePhoneStockScreen(route: route)
        case "vendors": NativePhoneVendorsScreen(route: route)
        case "purchases": NativePhonePurchasesScreen(route: route)
        case "costing": NativePhoneCostingScreen(route: route)
        case "payroll": NativePhonePayrollScreen(route: route)
        case "manuals": NativePhoneManualsScreen(route: route)
        case "coupons": NativePhoneCouponsScreen(route: route)
        case "receipt": NativePhoneOwnerReceiptScreen(route: route)
        case "accounting": NativePhoneAccountingScreen(route: route)
        case "invoices": NativePhoneInvoicesScreen(route: route)
        case "reconciliation": NativePhoneReconciliationScreen(route: route)
        case "settlement": NativePhoneSettlementScreen(route: route)
        case "settings": NativePhoneOwnerSettingsScreen(route: route)
        case "staff": NativePhoneOwnerStaffScreen(route: route)
        case "kitchen": NativePhoneOwnerKitchenScreen(route: route)
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
                    Text(title).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
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
