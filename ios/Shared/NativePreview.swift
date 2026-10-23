import SwiftUI

/// ネイティブ画面を見本のデータで開く（シミュレーターで形を確かめる用）。
/// 起動の引数 `-tenpoNativePreview order|checkout|options|price` のときだけ。お店で使うときは出ない。
enum NativePreview: String {
    case order, checkout, options, price

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
        NativeOrderView(model: model, onHome: { AppState.shared.closeNativePos(openWebPath: nil) })
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
            onOpenOrder: { id, checkout in state.openNativeOrder(id, checkout: checkout) }
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
                if path == "/app/reservations" { state.goNativeLedger() } else { state.leaveNativeFloor(to: path) }
            },
            onFloor: { state.goNativeFloor() }
        )
        .onReceive(model.$payload) { p in
            // まだ開局していなければ、Web の「レジの中の現金を数える」開局画面へ（Web のホームと同じ）
            if let p, p.needsOpenRegister { state.leaveNativeFloor(to: "/app/cash/open") }
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
            onWeb: { path in state.leaveNativeFloor(to: path) }
        )
        .onChange(of: state.nativeOrder) { new in if new == nil { Task { await model.refresh(silent: true) } } }
    }
}
