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
                if state.needsHandyLogin {
                    HandyLoginView()
                }
                // ネイティブのオーダー・会計画面（試験中。レジの設定で ON にした iPad だけ）。
                // Web の画面の上に重ねる（fullScreenCover だと下の Web が「見えない」扱いになって止まり、
                // Bluetooth のレシート・ドロアの印刷（Web の DirectPrintAgent）が出なくなるため）
                if let ref = state.nativeOrder {
                    NativeLiveOrderScreen(orderId: ref.id)
                        .id(ref.id)
                        .transition(.move(edge: .bottom))
                        .zIndex(10)
                }
            }
        }
        .animation(.easeOut(duration: 0.22), value: state.nativeOrder)
        // レジ（iPad）は画面いっぱいに使う
        .statusBarHidden(state.mode == .regi || state.nativeOrder != nil)
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
