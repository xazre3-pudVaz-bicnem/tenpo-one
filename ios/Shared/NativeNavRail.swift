import SwiftUI

// iPad レジの左の細いメニュー（アイコンだけ）。ホームでは広いメニュー（NativeHomeView の左）、
// ホームから 注文・会計・店舗台帳・即会計・入出金・設定 などへ行くと、メニューは細くなってアイコンだけ残り、本文が広くなる。
// 2026-10-27 02:13 Ronnie「会計 ma click gariyo vane ahile purai side ko button haru pani dekhinna ra naya 画面 aauxa tyo nagarera
//   … menu bar auto sano vayera clip haru matra vayeko menu bar hunxa ra ipad ko body thulo hunxa … 整理して」

/// 細いメニューが出ている画面か（上のバーの「ホーム」のロゴを出さない）
private struct NavRailShownKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var tenpoNavRail: Bool {
        get { self[NavRailShownKey.self] }
        set { self[NavRailShownKey.self] = newValue }
    }
}

struct NativeNavRail: View {
    @EnvironmentObject var state: AppState
    static let width: CGFloat = 80

    // 色はホームの左のメニューと同じ（NativeHomeView）
    static let bg = Color(hex: 0x37324D)
    private static let item = Color(hex: 0x433E5B)
    private static let text = Color(hex: 0xEDEBF5)
    private static let active = Color(hex: 0xF2D06B)
    private static let activeText = Color(hex: 0x2B2740)

    /// 見本（-tenpoNativePreview floor）で光らせる項目
    var previewActive: String? = nil
    @State private var toast: String?
    @State private var busy = false

    /// 細いメニューを出す画面か（iPad のレジで、ホーム以外のネイティブの画面。伝票・会計の画面は全画面のまま）
    @MainActor static func shown(_ s: AppState) -> Bool {
        guard AppConfig.isPad, s.mode == .regi, !s.needsRegiLogin, s.nativeOrder == nil else { return false }
        return s.nativeFloor || s.nativeLedger || s.nativeQuick || s.nativeCashIo || s.nativeSettings || s.nativeSettingsPage != nil
            || s.nativeSlips || s.nativeExpenses || s.nativeStock || s.nativeBudget || s.nativeReports || s.nativeCash || s.nativeNotices
    }

    private struct Item: Identifiable {
        let id: String
        let icon: String
        let label: String
        let active: Bool
        let action: () -> Void
    }

    /// ホームの保存（道具の有無・店）から。無ければいつもの並び
    private var home: NHPayload? {
        guard let data = NativeDiskCache.load("home") else { return nil }
        return try? JSONDecoder().decode(NHPayload.self, from: data)
    }

    private var items: [Item] {
        let tools = home?.tools.map(\.href)
        func has(_ href: String) -> Bool { tools?.contains(href) ?? true }
        var out: [Item] = [
            Item(id: "home", icon: "house", label: "ホーム", active: false, action: { state.goNativeHome() }),
            Item(id: "floor", icon: "desktopcomputer", label: "注文・会計", active: state.nativeFloor || previewActive == "floor", action: { state.goNativeFloor() }),
            Item(id: "ledger", icon: "calendar", label: "店舗台帳", active: state.nativeLedger, action: { state.goNativeLedger() }),
        ]
        if has("/app/quick-pay") { out.append(Item(id: "quick", icon: "yensign.circle", label: "即会計", active: state.nativeQuick, action: { state.goNativeQuick() })) }
        if has("/app/cash") { out.append(Item(id: "cashio", icon: "arrow.up.arrow.down", label: "入出金", active: state.nativeCashIo, action: { state.goNativeCashIo() })) }
        if has("#drawer") { out.append(Item(id: "drawer", icon: "tray", label: "ドロアオープン", active: false, action: { Task { await openDrawer() } })) }
        return out
    }

    var body: some View {
        VStack(spacing: 10) {
            // 上は時計・電波の行の下から
            VStack(spacing: 0) {
                Text("TENPO").font(.system(size: 12, weight: .heavy))
                Text("ONE").font(.system(size: 12, weight: .heavy))
            }
            .foregroundColor(Self.active)
            .padding(.top, 30).padding(.bottom, 8)
            ForEach(items) { tile($0) }
            Spacer(minLength: 0)
            if home?.tools.contains(where: { $0.href == "/app/settings" }) ?? true {
                tile(Item(id: "settings", icon: "slider.horizontal.3", label: "設定", active: state.nativeSettings || state.nativeSettingsPage != nil, action: { state.goNativeSettings() }))
            }
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 14)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(Self.bg.ignoresSafeArea())
        .overlay(alignment: .bottomLeading) {
            if let t = toast {
                Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Capsule().fill(Color.black.opacity(0.8)))
                    .fixedSize()
                    .offset(x: Self.width + 8, y: -24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if toast == t { toast = nil } }
            }
        }
    }

    private func tile(_ it: Item) -> some View {
        Button(action: it.action) {
            Image(systemName: it.icon)
                .font(.system(size: 22, weight: .regular))
                .foregroundColor(it.active ? Self.activeText : Self.text)
                .frame(width: 58, height: 58)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(it.active ? Self.active : Self.item))
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .accessibilityLabel(it.label)
        .disabled(busy && it.id == "drawer")
    }

    /// ドロアを開ける（ホームの「ドロアオープン」と同じ）
    private func openDrawer() async {
        guard let storeId = home?.store.id else { toast = "ドロアを開けられませんでした"; return }
        busy = true
        defer { busy = false }
        if let r = try? await NativeAPI.shared.floorAct(["type": "floorDrawer", "storeId": storeId]) {
            toast = r.ok ? "ドロアを開けます" : (r.error ?? "ドロアを開けられませんでした")
        } else {
            toast = "ドロアを開けられませんでした"
        }
    }
}
