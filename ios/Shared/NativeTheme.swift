import SwiftUI

/// ネイティブのレジ画面の色（Web の TENPO ONE と同じ色。2026-10-13 Ronnie「Airレジのように、アプリは全部ネイティブで」）
enum NT {
    static let header = Color(hex: 0x292725)        // 濃い字・濃いボタン
    /// 上のバーの地＝ネイビー（店舗台帳と同じ）。2026-10-24 23:18 Ronnie「上のバーはネイビーに。うすい灰色だと普通すぎる」
    static let topBar = Color(hex: 0x171333)
    /// 画面の地と同じうすい灰色（22:28 に一度上のバーをこれにした。いまは上のバーには使わない）
    static let bar = Color(hex: 0xF4F5F8)
    // 2026-10-24 21:42 Ronnie「この色（テラコッタ）はもう使わない。こっちも色を合わせて」
    // → 主の色はホームの「オーダー・会計」のボタンと同じ青、地と線はうすい灰色（店舗台帳・テーブル一覧と同じ系統）
    static let page = Color(hex: 0xF4F5F8)          // 画面の地
    static let card = Color.white
    /// iPad（レジ）はどの画面もホームと同じ色：主の色＝紫紺・うすい灰色・黄色（青をやめる）。iPhone は今まで通り
    /// （2026-10-27 03:14 Ronnie「rezi ko everywhere color milau fonts styles ra boldness same banau」・03:21「colorfull pardaina」）
    private static let pad = AppConfig.isPad
    static let purple = pad ? Color(hex: 0x37324D) : Color(hex: 0x2A6FE6)        // 主の色（名前は昔のまま）
    static let purpleDeep = pad ? Color(hex: 0x24203A) : Color(hex: 0x0A3FA8)
    static let lilac = pad ? Color(hex: 0xEFF0F4) : Color(hex: 0xE7EFFD)         // うすい色（チップ・弱いボタン）
    static let lilacLine = pad ? Color(hex: 0xE3E5EA) : Color(hex: 0xDCE3EF)
    /// 太い字は iPad では bold まで（heavy・black を使わない。字の太さをそろえる）。iPhone は今まで通り
    static let strong: Font.Weight = pad ? .bold : .heavy
    static let strongest: Font.Weight = pad ? .bold : .black
    static let ink = Color(hex: 0x292725)
    static let ink2 = Color(hex: 0x50565F)
    static let ink3 = Color(hex: 0x8A909A)
    static let line = Color(hex: 0xE4E7EE)
    /// レジ会計（お会計を確定する）の緑。テーブルのポップアップの「レジ会計」と同じ
    static let pay = pad ? Color(hex: 0x37324D) : Color(hex: 0x1E8F62)
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

/// 横に並べて、はみ出したら次の行へ（チップ用）
struct WrapLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > maxW { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing
            rowH = max(rowH, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, maxW), height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowH = max(rowH, s.height)
        }
    }
}
