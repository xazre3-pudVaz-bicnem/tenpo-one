import SwiftUI

@main
struct TenpoOneApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        rootStack
            // ネットが無いときは上に「オフライン」（2026-10-24 Ronnie「net nachale pani …」）
            .overlay(alignment: .top) { NativeOfflineBanner().zIndex(100) }
            .onAppear { NativeDiskCache.sweep(prefix: "live-"); NativeDiskCache.sweep(prefix: "get-") }
    }

    private var rootStack: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            if let preview = NativePreview.current {
                // 画面の確認用（起動の引数 -tenpoNativePreview order|checkout のときだけ。ふだんは出ない）
                NativePreviewView(kind: preview)
            } else if state.mode == nil {
                ModeChooserView()
            } else {
                WebContainer()
                    .id(state.webSession)
                    .accessibilityHidden(state.nativeOrder != nil)
                    // iPhone：暗い表示。iPad：明るい表示（シート・アラートを白に）。
                    // 時計・電波の字はどちらも白（上のバーがネイビー/黒）＝ Info.plist の UIStatusBarStyle（2026-10-25 00:12）
                    .preferredColorScheme(AppConfig.isPad ? .light : .dark)
                if state.needsHandyLogin {
                    HandyLoginView()
                }
                if state.ownerLoginPage && !AppConfig.isPad {
                    OwnerLoginSwitchBar()
                        .transition(.opacity)
                        .zIndex(2)
                }
                // iPhone：ハンディのテーブル一覧（/handy）とオーナー・店長のホーム（/app/dashboard）をネイティブで重ねる（2026-10-24）
                if state.nativeHandyHome && !state.needsHandyLogin {
                    NativeHandyHomeScreen()
                        .transition(.opacity)
                        .zIndex(3)
                }
                if state.nativeOwnerHome {
                    NativeOwnerHomeScreen()
                        .transition(.opacity)
                        .zIndex(3)
                }
                // iPhone ハンディの卓・注文（/handy/<卓>・/handy/<卓>/order の代わり。2026-10-25 Ronnie「iPhone も native に」）
                if let r = state.phoneHandy, !state.needsHandyLogin {
                    NativePhoneHandyScreen(route: r)
                        .id(r)
                        .transition(.move(edge: .trailing))
                        .zIndex(3.5)
                }
                // ネイティブのホーム。Web の /app/dashboard の上に重ねる（2026-10-24）
                if state.nativeHome {
                    NativeHomeScreen()
                        .transition(.opacity)
                        .zIndex(4)
                }
                // ネイティブの店舗台帳。Web の /app/reservations の上に重ねる（2026-10-24）
                if state.nativeLedger {
                    NativeLedgerScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // ネイティブのレジ開局・レジクローズ。Web の /app/cash/open・close の上に重ねる（2026-10-24）
                if state.nativeReports {
                    NativeReportsScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeScan {
                    NativeScanScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeCustomers {
                    NativeCustomersScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeBudget {
                    NativeBudgetScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // ネイティブの予約設定（予約受付ルール）。Web の /app/settings/booking の上に重ねる（2026-10-24）
                if state.nativeBooking {
                    NativeBookingScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeNotices {
                    NativeNoticesScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // ネイティブの設定（このiPadのプリンター・レジの設定）。Web の /app/pos/settings・/app/settings の上に重ねる（2026-10-24）
                if state.nativeSettings {
                    NativeSettingsScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // 設定の中のネイティブの画面（品切れ …。2026-10-24）
                if let key = state.nativeSettingsPage {
                    NativeSettingsPageScreen(key: key)
                        .id(key)
                        .transition(.opacity)
                        .zIndex(6)
                }
                if state.nativeStock {
                    NativeStockScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeInventory {
                    NativeInventoryScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeVendors {
                    NativeVendorsScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativePurchases {
                    NativePurchasesScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeCoupons {
                    NativeCouponsScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // まだ専用の台が無かった画面（勤怠・日報…）のネイティブ（NativeModules.swift）
                if let route = state.nativeModule {
                    NativeModuleScreen(route: route)
                        .id(route.key)
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeExpenses {
                    NativeExpensesScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeSlips {
                    NativeSlipsScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeQuick {
                    NativeQuickScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeCashIo {
                    NativeCashIoScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                if state.nativeCash {
                    NativeCashScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // ネイティブのフロア（テーブル一覧）。Web の /app/floor の上に重ねる（2026-10-24）
                if state.nativeFloor {
                    NativeFloorScreen()
                        .transition(.opacity)
                        .zIndex(5)
                }
                // ネイティブのオーダー・会計画面（レジの設定で ON にした iPad だけ）。
                // Web の画面の上に重ねる（fullScreenCover だと下の Web が「見えない」扱いになって止まり、
                // Bluetooth のレシート・ドロアの印刷（Web の DirectPrintAgent）が出なくなるため）
                if let ref = state.nativeOrder {
                    NativeLiveOrderScreen(orderId: ref.id, checkout: ref.checkout)
                        .id(ref.id)
                        .transition(.move(edge: .bottom))
                        .zIndex(10)
                }
            }
        }
        .animation(.easeOut(duration: 0.22), value: state.nativeOrder)
        .animation(.easeOut(duration: 0.18), value: state.nativeFloor)
        .animation(.easeOut(duration: 0.18), value: state.nativeHandyHome)
        .animation(.easeOut(duration: 0.18), value: state.nativeOwnerHome)
        .animation(.easeOut(duration: 0.2), value: state.phoneHandy)
        .animation(.easeOut(duration: 0.18), value: state.nativeHome)
        .animation(.easeOut(duration: 0.18), value: state.nativeLedger)
        .animation(.easeOut(duration: 0.18), value: state.nativeCash)
        .animation(.easeOut(duration: 0.18), value: state.nativeCashIo)
        .animation(.easeOut(duration: 0.18), value: state.nativeQuick)
        .animation(.easeOut(duration: 0.18), value: state.nativeSlips)
        .animation(.easeOut(duration: 0.18), value: state.nativeExpenses)
        .animation(.easeOut(duration: 0.18), value: state.nativeStock)
        .animation(.easeOut(duration: 0.18), value: state.nativeInventory)
        .animation(.easeOut(duration: 0.18), value: state.nativeVendors)
        .animation(.easeOut(duration: 0.18), value: state.nativePurchases)
        .animation(.easeOut(duration: 0.18), value: state.nativeCoupons)
        .animation(.easeOut(duration: 0.18), value: state.nativeNotices)
        .animation(.easeOut(duration: 0.18), value: state.nativeSettings)
        .animation(.easeOut(duration: 0.18), value: state.nativeSettingsPage)
        .animation(.easeOut(duration: 0.18), value: state.nativeBudget)
        .animation(.easeOut(duration: 0.18), value: state.nativeBooking)
        .animation(.easeOut(duration: 0.18), value: state.nativeCustomers)
        .animation(.easeOut(duration: 0.18), value: state.nativeScan)
        .animation(.easeOut(duration: 0.18), value: state.nativeReports)
        // 上の時刻・電波・電池（iOS のステータスバー）はいつも出す（2026-10-24 Ronnie「時間・電波・電池が見えない」）。
        // 上の黒いバーはステータスバーの下に入れない＝ステータスバーの所は明るい地で、黒い字が見える
        .statusBarHidden(false)
        .sheet(isPresented: $state.scanning) {
            QRScannerView(
                onCode: { code in state.handleScanned(code) },
                onCancel: { state.scanning = false }
            )
            .ignoresSafeArea()
        }
    }
}

enum Brand {
    static let background = Color(red: 0.984, green: 0.976, blue: 0.961) // #fbf9f5
    static let purple = Color(red: 0.737, green: 0.349, blue: 0.251) // #bc5940
    static let ink = Color(red: 0.161, green: 0.153, blue: 0.145) // #292725
    static let ink2 = Color(red: 0.361, green: 0.337, blue: 0.314) // #5c5650
}
