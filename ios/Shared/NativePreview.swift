import SwiftUI

/// ネイティブ画面を見本のデータで開く（シミュレーターで形を確かめる用）。
/// 起動の引数 `-tenpoNativePreview order|checkout|options|price|settings` のときだけ。お店で使うときは出ない。
enum NativePreview: String {
    case order, checkout, options, price, settings

    static var current: NativePreview? {
        guard let raw = UserDefaults.standard.string(forKey: "tenpoNativePreview") else { return nil }
        return NativePreview(rawValue: raw)
    }
}

struct NativePreviewView: View {
    let kind: NativePreview
    @StateObject private var model = NativeOrderModel.sample()

    var body: some View {
        content.onAppear {
            // 横向きで確かめる（-tenpoNativeLandscape YES のとき）
            if UserDefaults.standard.bool(forKey: "tenpoNativeLandscape"),
               let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case .order:
            NativeOrderView(model: model)
                .statusBarHidden(true)
        case .checkout:
            NativeCheckoutView(model: model, onClose: {})
                .statusBarHidden(true)
        case .settings:
            NativeSettingsView(model: NativeSettingsModel.sample(), onHome: {}, onWeb: { _ in })
        case .options, .price:
            NativeOrderView(model: model)
                .statusBarHidden(true)
                .onAppear {
                    if let item = model.items.first(where: { $0.id == (kind == .options ? "i2" : "i19") }) {
                        model.selectedCategory = item.categoryId ?? model.selectedCategory
                        model.add(item)
                    }
                }
        }
    }
}

/// サーバーの伝票をネイティブの画面で開く（Web の「オーダー・会計」の代わり）
struct NativeLiveOrderScreen: View {
    @StateObject private var model: NativeOrderModel
    private let checkout: Bool

    init(orderId: String, checkout: Bool = false) {
        _model = StateObject(wrappedValue: NativeOrderModel(orderId: orderId))
        self.checkout = checkout
    }

    var body: some View {
        NativeOrderView(model: model, onHome: {
            // 注文せずに戻ったら、先に伝票を消してから閉じる（フロアに ¥0 の卓が残らない）
            Task {
                await model.discardIfUntouched()
                AppState.shared.closeNativePos(openWebPath: nil)
            }
        }, startInCheckout: checkout)
            .task {
                await model.load()
                // 卓のポップアップの「レジ会計」からは、開いてすぐ会計の画面に
                if checkout { model.openCheckoutOnLoad = true }
            }
    }
}

/// ネイティブのフロア（テーブル一覧）。Web の /app/floor の代わり（2026-10-24）
struct NativeFloorScreen: View {
    @StateObject private var model = NativeFloorModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeFloorView(
            model: model,
            onHome: { state.goNativeHome() },
            onLedger: { state.goNativeLedger() },
            onOpenOrder: { id, checkout in state.openNativeOrder(id, checkout: checkout) },
            // Web の /app/floor/<卓>/setup から来たら、その卓の来店登録（AppState.floorSetupTableId）
            setupRequest: state.floorSetupTableId,
            onSetupRequestHandled: { state.floorSetupTableId = nil }
        )
        .onChange(of: state.floorRefreshTick) { _ in Task { await model.refresh(silent: true) } }
        .onChange(of: state.nativeOrder) { new in if new == nil { Task { await model.refresh(silent: true) } } }
    }
}

/// ネイティブのホーム。Web の /app/dashboard の代わり（2026-10-24）
struct NativeHomeScreen: View {
    @StateObject private var model = NativeHomeModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeHomeView(
            model: model,
            onWeb: { path in
                if path == "/app/reservations" { state.goNativeLedger() }
                else if path == "/app/cash/close" || path == "/app/cash/open" { state.goNativeCash(path) }
                else if path == "/app/cash" { state.goNativeCashIo() }
                else if path == "/app/quick-pay" { state.goNativeQuick() }
                else if path == "/app/orders" { state.goNativeSlips() }
                else if path == "/app/expenses" { state.goNativeExpenses() }
                else if path == "/app/notifications" { state.goNativeNotices() }
                else if path == "/app/budgets/daily" { state.goNativeBudget() }
                else if path == "/app/announcements" { state.goNativeNotices(tab: "announcements") }
                else if path == "/app/inventory" || path == "/app/inventory/menu-stock" { state.goNativeStock() }
                else if path == "/app/settings" || path == "/app/pos/settings" { state.goNativeSettings() }
                else { state.leaveNativeFloor(to: path) }
            },
            onFloor: { state.goNativeFloor() }
        )
        .onReceive(model.$payload) { p in
            // まだ開局していなければ、Web の「レジの中の現金を数える」開局画面へ（Web のホームと同じ）
            if let p, p.needsOpenRegister { state.goNativeCash("/app/cash/open") }
        }
        .onChange(of: state.nativeFloor) { on in if !on { Task { await model.refresh() } } }
        .onChange(of: state.floorRefreshTick) { _ in Task { await model.refresh() } }
    }
}

/// ネイティブの店舗台帳。Web の /app/reservations（1日のスケジュール）の代わり（2026-10-24）
struct NativeLedgerScreen: View {
    @StateObject private var model = NativeLedgerModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeLedgerView(
            model: model,
            onHome: { state.goNativeHome() },
            onFloor: { state.goNativeFloor() },
            onOpenOrder: { id in state.openNativeOrder(id, checkout: false) },
            onWeb: { path in
                // 📅「台帳設定」はネイティブの予約設定（Web の画面を見せない。2026-10-24）
                if path == "/app/settings/booking" { state.goNativeBooking() } else { state.leaveNativeFloor(to: path) }
            }
        )
        .onChange(of: state.nativeOrder) { new in if new == nil { Task { await model.refresh(silent: true) } } }
        // Web の ?view= ?open= から来たら、その表示・その予約（2026-10-24 22:05 Ronnie「全部ネイティブ」）
        .onAppear(perform: applyRoute)
        .onChange(of: state.ledgerView) { _ in applyRoute() }
        .onChange(of: state.ledgerOpenId) { _ in applyRoute() }
    }

    private func applyRoute() {
        if let v = state.ledgerView { model.applyView(v); state.ledgerView = nil }
        if let id = state.ledgerOpenId {
            state.ledgerOpenId = nil
            Task { await model.open(reservationId: id) }
        }
    }
}

/// ネイティブのレジ開局・レジクローズ（2026-10-24）
struct NativeCashScreen: View {
    @StateObject private var model = NativeCashModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeCashView(
            model: model,
            mode: "",
            onHome: { state.goNativeHome() },
            onOpened: { state.goNativeFloor() },
            onWeb: { path in state.leaveNativeFloor(to: path) },
            onSignedOut: { state.leaveNativeFloor(to: "/register-login") }
        )
    }
}

/// ネイティブの入出金（2026-10-24）
struct NativeCashIoScreen: View {
    @StateObject private var model = NativeCashIoModel()
    @StateObject private var petty = NativePettyModel()
    @StateObject private var closings = NativeClosingsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        switch state.cashTab {
        case "petty":
            NativePettyView(model: petty, onHome: { state.goNativeHome() }, onTab: { state.goNativeCashIo(tab: $0) })
        case "closings":
            NativeClosingsView(model: closings, onHome: { state.goNativeHome() }, onTab: { state.goNativeCashIo(tab: $0) })
        default:
            NativeCashIoView(
                model: model,
                onHome: { state.goNativeHome() },
                onWeb: { path in state.leaveNativeFloor(to: path) },
                onClose: { state.goNativeCash("/app/cash/close") },
                onTab: { state.goNativeCashIo(tab: $0) }
            )
        }
    }
}

/// ネイティブの即会計（2026-10-24）
struct NativeQuickScreen: View {
    @StateObject private var model = NativeQuickModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeQuickPayView(
            model: model,
            onHome: { state.goNativeHome() },
            onOpenOrder: { id, checkout in state.openNativeOrder(id, checkout: checkout) }
        )
        .onChange(of: state.quickRefreshTick) { _ in Task { await model.refresh() } }
        .onChange(of: state.nativeOrder) { new in if new == nil { Task { await model.refresh() } } }
    }
}

/// ネイティブの伝票明細（2026-10-24）
struct NativeSlipsScreen: View {
    @StateObject private var model = NativeSlipsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeSlipsView(
            model: model,
            onHome: { state.goNativeHome() },
            onOpenOrder: { id in state.openNativeOrder(id, checkout: false) },
            openId: state.slipsOpenId,
            onOpened: { state.slipsOpenId = nil }
        )
        .onChange(of: state.nativeOrder) { new in if new == nil { Task { await model.refresh() } } }
    }
}

/// ネイティブの仕入・経費（2026-10-24）
struct NativeExpensesScreen: View {
    @StateObject private var model = NativeExpensesModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeExpensesView(
            model: model,
            onHome: { state.goNativeHome() },
            onWeb: { path in state.leaveNativeFloor(to: path) }
        )
    }
}

/// ネイティブの在庫設定（2026-10-24）
struct NativeStockScreen: View {
    @StateObject private var model = NativeStockModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeStockView(
            model: model,
            onHome: { state.goNativeHome() },
            onWeb: { path in state.leaveNativeFloor(to: path) }
        )
    }
}

/// ネイティブの在庫（品目・棚卸・移動・発注提案・予測。2026-10-24）
struct NativeInventoryScreen: View {
    @StateObject private var model = NativeInventoryModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeInventoryView(
            model: model,
            onHome: { state.goNativeHome() },
            onWeb: { path in state.leaveNativeFloor(to: path) },
            onStock: { state.goNativeStock() }
        )
        .onAppear { sync() }
        .onChange(of: state.inventoryTab) { _ in sync() }
        .onChange(of: state.inventoryCountId) { _ in sync() }
    }

    private func sync() {
        if model.tab != state.inventoryTab { model.tab = state.inventoryTab }
        if let id = state.inventoryCountId { model.countId = id }
    }
}

/// ネイティブの仕入先（2026-10-24）
struct NativeVendorsScreen: View {
    @StateObject private var model = NativePurchasingModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NativeVendorsView(model: model, onHome: { state.goNativeHome() }, onWeb: { path in state.leaveNativeFloor(to: path) }, onOpenPo: { id in state.goNativePurchases(.detail(id)) })
    }
}

/// ネイティブの発注（一覧・作成・詳細。2026-10-24）
struct NativePurchasesScreen: View {
    @StateObject private var model = NativePurchasingModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NativePurchasesView(model: model, route: $state.purchasesRoute, onHome: { state.goNativeHome() }, onWeb: { path in state.leaveNativeFloor(to: path) })
    }
}

/// ネイティブのクーポン管理（2026-10-24）
struct NativeCouponsScreen: View {
    @StateObject private var model = NativePurchasingModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NativeCouponsView(model: model, onHome: { state.goNativeHome() }, onWeb: { path in state.leaveNativeFloor(to: path) })
    }
}

/// ネイティブの通知（2026-10-24）
struct NativeNoticesScreen: View {
    @StateObject private var model = NativeNoticesModel()
    @StateObject private var announcements = NativeAnnouncementsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        if state.noticesTab == "announcements" {
            NativeAnnouncementsView(model: announcements, onHome: { state.goNativeHome() }, onNotifications: { state.goNativeNotices() })
        } else {
            NativeNoticesView(
                model: model,
                onHome: { state.goNativeHome() },
                onLink: { path in state.leaveNativeFloor(to: path) }
            )
        }
    }
}

/// ネイティブの設定（このiPadのプリンター・レシートの出し先・LAN・Wi-Fi・Native ON/OFF・レジの設定・管理画面の設定。2026-10-24）
struct NativeSettingsScreen: View {
    @StateObject private var model = NativeSettingsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeSettingsView(model: model, onHome: { state.goNativeHome() }, onWeb: { path in state.leaveNativeFloor(to: path) })
    }
}

/// ネイティブの日別予算登録（2026-10-24）
struct NativeBudgetScreen: View {
    @StateObject private var model = NativeBudgetDailyModel()
    @StateObject private var monthly = NativeBudgetsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if state.budgetView == "monthly" {
                NativeBudgetsView(model: monthly, onHome: { state.goNativeHome() }, onDaily: { m in state.switchBudgetView("daily", month: m) })
            } else {
                NativeBudgetDailyView(model: model, onHome: { state.goNativeHome() }, onWeb: { path in
                    if path == "/app/budgets" { state.switchBudgetView("monthly", month: model.month) } else { state.leaveNativeFloor(to: path) }
                })
            }
        }
        .onAppear { syncMonth() }
        .onChange(of: state.budgetMonth) { _ in syncMonth() }
        .onChange(of: state.budgetView) { _ in syncMonth() }
    }

    private func syncMonth() {
        guard let m = state.budgetMonth else { return }
        if state.budgetView == "monthly" { if monthly.month != m { monthly.month = m } } else if model.month != m { model.month = m }
    }
}

/// ネイティブの予約設定＝予約受付ルール（2026-10-24）
struct NativeBookingScreen: View {
    @StateObject private var model = NativeBookingSettingsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeBookingSettingsView(
            model: model,
            onHome: { state.goNativeHome() },
            onLedger: { state.goNativeLedger() },
            onWeb: { path in state.leaveNativeFloor(to: path) }
        )
    }
}

/// ネイティブの顧客台帳（2026-10-24）
struct NativeCustomersScreen: View {
    @StateObject private var model = NativeCustomersModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeCustomersView(model: model, onHome: { state.goNativeHome() }, onWeb: { path in state.leaveNativeFloor(to: path) }, view: $state.customersView, openRequest: $state.customersOpenId)
    }
}

/// ネイティブのスキャン（レシート撮影。2026-10-24）
struct NativeScanScreen: View {
    @StateObject private var model = NativeScanModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeScanView(
            model: model,
            onHome: { state.goNativeHome() },
            onWeb: { path in state.leaveNativeFloor(to: path) },
            onCashClose: { state.goNativeCash("/app/cash/close") },
            onPetty: { state.goNativeCashIo(tab: "petty") }
        )
        .onAppear { model.tx = state.scanTx }
        .onChange(of: state.scanTx) { tx in model.tx = tx }
    }
}

/// ネイティブの店舗分析（2026-10-24）
struct NativeReportsScreen: View {
    @StateObject private var model = NativeReportsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeReportsView(model: model, onHome: { state.goNativeHome() }, onWeb: { path in state.leaveNativeFloor(to: path) })
            .onAppear {
                model.from = state.reportsFrom
                model.to = state.reportsTo
            }
    }
}

/// iPhone ハンディのテーブル一覧（Web の /handy の代わり。2026-10-24）
struct NativeHandyHomeScreen: View {
    @StateObject private var model = NativeHandyModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeHandyHomeView(
            model: model,
            onWeb: { path in state.leaveNativePhone(to: path) },
            onChangeMode: { state.resetMode() },
            onSignedOut: { state.leaveNativePhone(to: "/handy") }
        )
        .onChange(of: state.phoneRefreshTick) { _ in Task { await model.refresh() } }
        .onChange(of: model.useWeb) { on in if on { state.fallbackPhoneToWeb() } }
    }
}

/// iPhone オーナー・店長のホーム（Web の /app/dashboard の代わり。2026-10-24）
struct NativeOwnerHomeScreen: View {
    @StateObject private var model = NativeOwnerHomeModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NativeOwnerHomeView(
            model: model,
            onWeb: { path in state.leaveNativePhone(to: path) },
            // 店を変えたら裏の Web も同じ店で読み直す（Cookie はもう変わっている）
            onStoreSwitched: { WebViewController.current?.load(AppConfig.url("/app/dashboard")) }
        )
        .onChange(of: state.phoneRefreshTick) { _ in Task { await model.refresh() } }
        .onChange(of: model.useWeb) { on in if on { state.fallbackPhoneToWeb() } }
    }
}
