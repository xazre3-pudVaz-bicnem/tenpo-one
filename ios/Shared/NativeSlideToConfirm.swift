import SwiftUI
import UIKit

/// 右へスライドして決めるボタン（Web の SlideToConfirm と同じ決まり。押し間違いで注文が飛ばない。
/// 2026-09-25 店舗要望「Order 決定はスライドで。3Dで楽しく」・2026-10-24 Ronnie「order lai slide banau」）。
/// つまみを右端の手前（9割）まで運ぶと onConfirm。途中で離すと戻る。
/// 色はホームの左のバーと同じ：バーは紫紺・白い字、つまみは選んだボタンと同じ黄色
/// （2026-10-27 02:52 Ronnie「yello style」→ 03:03「yesko lable lai same menu bar color banau、sano right slide button lai yello hamro style」）
struct NativeSlideToConfirm: View {
    let label: String
    var hint: String = "スライドして確定 / Slide"
    var disabled = false
    var busy = false
    let onConfirm: () -> Void

    @State private var x: CGFloat = 0
    @State private var done = false
    private let knob: CGFloat = 62
    private let pad: CGFloat = 5
    private let radius: CGFloat = 18

    var body: some View {
        GeometryReader { geo in
            let limit = max(0, geo.size.width - knob - pad * 2)
            let progress = limit > 0 ? min(1, x / limit) : 0
            ZStack(alignment: .leading) {
                // 立体の土台（下に少しずらした濃い色）
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(OV.primaryDeep)
                    .offset(y: 4)
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(OV.primary)
                // 進み具合を明るく塗る
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color.white.opacity(0.10))
                    .frame(width: knob + pad * 2 + x)
                VStack(spacing: 2) {
                    Text(label).font(.system(size: 20, weight: .heavy))
                    Text(hint).font(.system(size: 11, weight: .bold)).opacity(0.8)
                }
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity)
                .padding(.leading, knob + 14)
                .padding(.trailing, 14)
                .opacity(1 - Double(progress) * 0.8)
                // つまみ
                ZStack {
                    RoundedRectangle(cornerRadius: radius - 4, style: .continuous)
                        .fill(OV.yellow)
                        .shadow(color: .black.opacity(0.22), radius: 4, y: 2)
                    if busy {
                        ProgressView().tint(OV.primary)
                    } else {
                        Image(systemName: progress >= 0.9 ? "checkmark" : "chevron.right.2")
                            .font(.system(size: 22, weight: .heavy))
                            .foregroundColor(OV.primary)
                    }
                }
                .frame(width: knob, height: max(0, geo.size.height - pad * 2))
                .offset(x: pad + x)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { v in
                        guard !done, !disabled, !busy else { return }
                        x = min(limit, max(0, v.translation.width))
                    }
                    .onEnded { _ in
                        guard !done, !disabled, !busy else { return }
                        if limit > 0 && x >= limit * 0.9 {
                            done = true
                            withAnimation(.easeOut(duration: 0.1)) { x = limit }
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            onConfirm()
                            // 送り終わるころに戻す（連打防止）
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) { x = 0 }
                                done = false
                            }
                        } else {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) { x = 0 }
                        }
                    }
            )
        }
        .frame(height: 70)
        .padding(.bottom, 4)
        .opacity(disabled && !busy ? 0.4 : 1)
        .allowsHitTesting(!disabled && !busy)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(hint)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if !disabled && !busy { onConfirm() } }
    }
}
