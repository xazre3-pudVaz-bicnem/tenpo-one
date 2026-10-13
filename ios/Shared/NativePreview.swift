import SwiftUI

/// ネイティブ画面を見本のデータで開く（シミュレーターで形を確かめる用）。
/// 起動の引数 `-tenpoNativePreview order` か `-tenpoNativePreview checkout` のときだけ。お店で使うときは出ない。
enum NativePreview: String {
    case order, checkout

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
        }
    }
}
