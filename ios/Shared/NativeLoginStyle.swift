import SwiftUI

// アプリのログイン・起動の画面の見た目（App Store の広告の写真と同じ：ネイビーの地・青い光・大きい日本語・明るい青の強調）。
// 2026-10-25 09:39 Ronnie「アプリのログインも、あの写真のようにきれいに。ログインもログアウトもブラウザに行かないように」

enum NLStyle {
    static let navy = Color(hex: 0x171333)
    static let navy2 = Color(hex: 0x223586)
    static let glow = Color(hex: 0x2A6FE6)
    static let accent = Color(hex: 0x8FB4FF)
    static let sub = Color(hex: 0xC9D6F5)
}

/// 地：上がネイビー → 下が紺、真ん中の下に青い光、斜めの薄い光の帯
struct NativeLoginBackground: View {
    /// 青い光の中心（0〜1）
    var glowAt: UnitPoint = UnitPoint(x: 0.5, y: 0.7)

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                LinearGradient(colors: [NLStyle.navy, NLStyle.navy2], startPoint: .top, endPoint: .bottom)
                Ellipse()
                    .fill(NLStyle.glow.opacity(0.55))
                    .frame(width: max(w, h) * 0.95, height: max(w, h) * 0.75)
                    .position(x: w * glowAt.x, y: h * glowAt.y)
                    .blur(radius: max(w, h) * 0.16)
                Path { p in
                    p.move(to: CGPoint(x: w * 0.58, y: 0))
                    p.addLine(to: CGPoint(x: w * 0.78, y: 0))
                    p.addLine(to: CGPoint(x: w * 0.38, y: h))
                    p.addLine(to: CGPoint(x: w * 0.18, y: h))
                    p.closeSubpath()
                }
                .fill(Color.white.opacity(0.05))
                .blur(radius: 30)
            }
            .frame(width: w, height: h)
        }
        .ignoresSafeArea()
    }
}

/// 白い丸い札に「TENPO ONE」
struct NativeBrandPill: View {
    var size: CGFloat = 13

    var body: some View {
        Text("TENPO ONE")
            .font(.system(size: size, weight: .black))
            .tracking(0.6)
            .foregroundColor(NLStyle.navy)
            .padding(.horizontal, size * 1.05)
            .frame(height: size * 2.1)
            .background(Capsule().fill(Color.white))
    }
}

/// 2 行の大きい見出し（2 行目を明るい青に）。広告の写真の「〇〇も、[この1台で。]」と同じ
struct NativeCatchTitle: View {
    let first: String
    let second: String
    var size: CGFloat = 30
    var alignment: HorizontalAlignment = .center

    var body: some View {
        VStack(alignment: alignment, spacing: size * 0.12) {
            Text(first).foregroundColor(.white)
            Text(second).foregroundColor(NLStyle.accent)
        }
        .font(.system(size: size, weight: .black))
        .multilineTextAlignment(alignment == .center ? .center : .leading)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

/// 起動したての画面（Web の画面が決まるまで。ログインの Web の画面を見せない）
struct NativeBootSplash: View {
    var body: some View {
        ZStack {
            NativeLoginBackground(glowAt: UnitPoint(x: 0.5, y: 0.62))
            VStack(spacing: 18) {
                Image("BrandMark").resizable().scaledToFit()
                    .frame(width: AppConfig.isPad ? 112 : 92, height: AppConfig.isPad ? 112 : 92)
                    .clipShape(RoundedRectangle(cornerRadius: AppConfig.isPad ? 26 : 22, style: .continuous))
                    .shadow(color: .black.opacity(0.3), radius: 16, y: 8)
                Text("TENPO ONE")
                    .font(.system(size: AppConfig.isPad ? 40 : 32, weight: .black))
                    .foregroundColor(.white)
                ProgressView().tint(.white).padding(.top, 6)
            }
        }
    }
}
