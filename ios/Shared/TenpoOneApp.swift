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
            if state.mode == nil {
                ModeChooserView()
            } else {
                WebContainer()
                    .id(state.webSession)
                if state.needsHandyLogin {
                    HandyLoginView()
                }
            }
        }
        // レジ（iPad）は画面いっぱいに使う
        .statusBarHidden(state.mode == .regi)
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
    static let background = Color(red: 0.965, green: 0.953, blue: 0.984) // #f6f3fb
    static let purple = Color(red: 0.482, green: 0.247, blue: 0.894) // #7b3fe4
    static let ink = Color(red: 0.165, green: 0.129, blue: 0.220) // #2a2138
    static let ink2 = Color(red: 0.369, green: 0.329, blue: 0.439) // #5e5470
}
