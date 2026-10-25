import SwiftUI

/// iPad：どの大きさの iPad でも、iPad Pro 11 インチ（横 1194×834pt）と同じ並びのまま画面に収める。
/// 小さい iPad（10.2 インチ 1080×810・10.9/11 インチ Air 1180×820・mini など）では、全体を同じ比率で縮めて表示する
/// （スクロールで逃げない）。iPad Pro 11 インチ以上は今まで通り（縮めない）。iPhone は何もしない。
/// 2026-10-25 16:15 Ronnie「fit to page any ipad size」（SHUNKA 新宿本店の iPad 8th gen でホームの下が切れていた）
struct PadCanvas<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    /// 縮める基準の画面（iPad Pro 11 インチ）
    static var baseLandscape: CGSize { CGSize(width: 1194, height: 834) }

    /// この大きさの画面での縮める比率（1 ならそのまま）
    static func scale(for size: CGSize) -> CGFloat {
        guard size.width > 0, size.height > 0 else { return 1 }
        let landscape = size.width >= size.height
        let base = landscape ? baseLandscape : CGSize(width: baseLandscape.height, height: baseLandscape.width)
        let s = min(size.width / base.width, size.height / base.height)
        return s < 0.995 ? s : 1
    }

    var body: some View {
        if AppConfig.isPad {
            GeometryReader { geo in
                let size = geo.size
                let s = Self.scale(for: size)
                if s < 1 {
                    content
                        .frame(width: size.width / s, height: size.height / s)
                        .scaleEffect(s, anchor: .topLeading)
                        .frame(width: size.width, height: size.height, alignment: .topLeading)
                } else {
                    content
                        .frame(width: size.width, height: size.height)
                }
            }
            .ignoresSafeArea()
        } else {
            content
        }
    }
}
