import SwiftUI

/// ネイティブのレジ画面の色（Web の TENPO ONE と同じ色。2026-10-13 Ronnie「Airレジのように、アプリは全部ネイティブで」）
enum NT {
    static let header = Color(hex: 0x231A35)        // 上のバー
    static let page = Color(hex: 0xEFEAF7)          // 画面の地
    static let card = Color.white
    static let purple = Color(hex: 0x7B3FE4)        // 主の色
    static let purpleDeep = Color(hex: 0x5B2BB5)
    static let lilac = Color(hex: 0xF1EBFC)         // 薄い紫（チップ・弱いボタン）
    static let lilacLine = Color(hex: 0xE4DAF6)
    static let ink = Color(hex: 0x2A2138)
    static let ink2 = Color(hex: 0x5E5470)
    static let ink3 = Color(hex: 0x958BA6)
    static let line = Color(hex: 0xE9E4F1)
    static let danger = Color(hex: 0xC62828)
    static let dangerBg = Color(hex: 0xFDECEC)
    static let ok = Color(hex: 0x1E8E5A)
    static let warn = Color(hex: 0xB7791F)

    static func yen(_ v: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "ja_JP")
        return "¥" + (f.string(from: NSNumber(value: v)) ?? "\(v)")
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

/// 押すと少し沈むボタン（Airレジのような手触り）
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}
