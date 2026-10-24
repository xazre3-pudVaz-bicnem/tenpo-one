import Foundation
import CoreGraphics
import CoreText
import UIKit

/// サーバーの TicketDesign（lib/ticket-design.ts。厨房伝票・取消伝票の見た目）
struct TicketDesign: Codable {
    struct Cell: Codable {
        let text: String
        let share: Double?
        let align: String?
        let size: Double?
        let bold: Bool?
    }
    struct Row: Codable {
        let cells: [Cell]
        let size: Double
        let bold: Bool?
        let black: Bool?
        let indent: Double?
        let rule: String?
        let gap: Double?
    }
    let serif: Bool
    let rows: [Row]
}

/// 印字キットの rasterBytes に渡す白黒の画像（1＝黒、行は ceil(width/8) バイト、MSB が左）
struct RasterImage: Codable {
    let width: Int
    let height: Int
    let bits: String
}

/// TicketDesign を白黒の画像にする（オフラインのとき、iPad で。2026-10-24 Ronnie「net nachale pani print」）。
/// サーバーの renderTicketImage（lib/ticket-design-server.ts）と同じ寸法：左右の余白 12・上 14・下 18、
/// 行の上下 6（黒い帯は 12）、セルは share の割合で、文字の箱はセル幅 −8、罫線 2px（点線は 2・4）のあと 6。
/// 文字は Times New Roman ＋ ヒラギノ明朝（サーバーの Tinos ＋ Noto Serif CJK と同じ形）、ゴシックはヒラギノ角ゴ。
/// 白黒にするしきい値もサーバーと同じ 170。
enum NativeTicketRaster {
    static func render(_ design: TicketDesign, width: Int, upsideDown: Bool) -> RasterImage? {
        let margin: CGFloat = 12
        let available = CGFloat(width) - margin * 2

        // 1回目：大きさを測って並べる
        struct Rule { let y: CGFloat; let dotted: Bool }
        var texts: [(attr: NSAttributedString, rect: CGRect)] = []
        var bands: [CGRect] = []
        var rules: [Rule] = []
        var y: CGFloat = 14
        for row in design.rows {
            y += CGFloat(row.gap ?? 0)
            let black = row.black == true
            let pad: CGFloat = black ? 12 : 6
            let indent = CGFloat(row.indent ?? 0)
            let shares = row.cells.reduce(0) { $0 + ($1.share ?? 1) }
            var x = margin + indent + (black ? 8 : 0)
            let contentWidth = available - indent - (black ? 16 : 0)
            var cellBoxes: [(attr: NSAttributedString, x: CGFloat, size: CGSize)] = []
            var h: CGFloat = 0
            for c in row.cells {
                let w = floor(contentWidth * CGFloat(c.share ?? 1) / CGFloat(shares > 0 ? shares : 1))
                if !c.text.isEmpty {
                    let bold = c.bold ?? row.bold ?? false
                    let size = CGFloat(c.size ?? row.size)
                    let attr = attributed(c.text, serif: design.serif, bold: bold, size: size, align: c.align, white: black)
                    let box = max(1, w - 8)
                    let measured = measure(attr, width: box)
                    cellBoxes.append((attr, x, CGSize(width: box, height: measured)))
                    h = max(h, measured)
                }
                x += w
            }
            if black { bands.append(CGRect(x: margin, y: y, width: available, height: h + pad * 2)) }
            for b in cellBoxes {
                let top = y + pad + floor((h - b.size.height) / 2)
                texts.append((b.attr, CGRect(x: b.x, y: top, width: b.size.width, height: b.size.height)))
            }
            y += h + pad * 2
            if let rule = row.rule {
                rules.append(Rule(y: y, dotted: rule == "dotted"))
                y += 6
            }
        }
        let height = Int(ceil(y + 18))
        guard width > 0, height > 0, height < 60_000 else { return nil }

        // 2回目：描く（グレー 8bit。CoreGraphics は左下が原点なので上下を返して描く）
        let bytesPerRow = width
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        let H = CGFloat(height)
        ctx.setFillColor(gray: 1, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.setFillColor(gray: 0, alpha: 1)
        for b in bands { ctx.fill(CGRect(x: b.minX, y: H - b.maxY, width: b.width, height: b.height)) }
        for r in rules {
            if r.dotted {
                var x: CGFloat = 0
                while x < available {
                    ctx.fill(CGRect(x: margin + x, y: H - r.y - 2, width: min(2, available - x), height: 2))
                    x += 6
                }
            } else {
                ctx.fill(CGRect(x: margin, y: H - r.y - 2, width: available, height: 2))
            }
        }
        ctx.textMatrix = .identity
        for t in texts {
            let setter = CTFramesetterCreateWithAttributedString(t.attr)
            // 測った高さより少し余裕を持たせる（最後の行が切れないように）。上から描くので箱の上端を合わせる
            let boxH = t.rect.height + 4
            let path = CGPath(rect: CGRect(x: t.rect.minX, y: H - t.rect.minY - boxH, width: t.rect.width, height: boxH), transform: nil)
            let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), path, nil)
            CTFrameDraw(frame, ctx)
        }
        guard let data = ctx.data else { return nil }
        let px = data.bindMemory(to: UInt8.self, capacity: bytesPerRow * height)

        // 白黒に（170 より暗い＝黒）。上下さかさまのプリンターは 180 度回す
        let rowBytes = (width + 7) / 8
        var bits = [UInt8](repeating: 0, count: rowBytes * height)
        for yy in 0..<height {
            // CGContext の data は上の行から並ぶ
            let srcY = upsideDown ? (height - 1 - yy) : yy
            let base = srcY * bytesPerRow
            for xx in 0..<width {
                let srcX = upsideDown ? (width - 1 - xx) : xx
                if px[base + srcX] < 170 { bits[yy * rowBytes + (xx >> 3)] |= UInt8(0x80 >> (xx & 7)) }
            }
        }
        return RasterImage(width: width, height: height, bits: Data(bits).base64EncodedString())
    }

    /// 文字の飾り（サーバーの pango と同じ：明朝は Times＋ヒラギノ明朝、ゴシックはヒラギノ角ゴ。行間 4）。
    /// CoreText のキー（CTForegroundColor・CTParagraphStyle）で渡す（UIKit の NSColor・NSParagraphStyle は CTFrameDraw が見ないことがある）
    private static func attributed(_ text: String, serif: Bool, bold: Bool, size: CGFloat, align: String?, white: Bool) -> NSAttributedString {
        let font = makeFont(serif: serif, bold: bold, size: size)
        var alignment: CTTextAlignment = align == "right" ? .right : align == "center" ? .center : .left
        var spacing: CGFloat = 4
        var lineBreak: CTLineBreakMode = .byWordWrapping
        let style: CTParagraphStyle = withUnsafeBytes(of: &alignment) { a in
            withUnsafeBytes(of: &spacing) { s in
                withUnsafeBytes(of: &lineBreak) { l in
                    let settings = [
                        CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: a.baseAddress!),
                        CTParagraphStyleSetting(spec: .lineSpacingAdjustment, valueSize: MemoryLayout<CGFloat>.size, value: s.baseAddress!),
                        CTParagraphStyleSetting(spec: .lineBreakMode, valueSize: MemoryLayout<CTLineBreakMode>.size, value: l.baseAddress!),
                    ]
                    return CTParagraphStyleCreate(settings, settings.count)
                }
            }
        }
        let color = CGColor(gray: white ? 1 : 0, alpha: 1)
        let attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font as CTFont,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
            NSAttributedString.Key(kCTParagraphStyleAttributeName as String): style,
        ]
        return NSAttributedString(string: text, attributes: attrs)
    }

    private static var fontCache: [String: UIFont] = [:]
    private static let fontLock = NSLock()

    private static func makeFont(serif: Bool, bold: Bool, size: CGFloat) -> UIFont {
        let key = "\(serif)-\(bold)-\(size)"
        fontLock.lock(); defer { fontLock.unlock() }
        if let f = fontCache[key] { return f }
        let latin = serif ? (bold ? "TimesNewRomanPS-BoldMT" : "TimesNewRomanPSMT") : (bold ? "HiraginoSans-W6" : "HiraginoSans-W3")
        let cjk = serif ? (bold ? "HiraMinProN-W6" : "HiraMinProN-W3") : (bold ? "HiraginoSans-W6" : "HiraginoSans-W3")
        var desc = UIFontDescriptor(name: latin, size: size)
        desc = desc.addingAttributes([.cascadeList: [UIFontDescriptor(name: cjk, size: size)]])
        let f = UIFont(descriptor: desc, size: size)
        fontCache[key] = f
        return f
    }

    private static func measure(_ attr: NSAttributedString, width: CGFloat) -> CGFloat {
        let setter = CTFramesetterCreateWithAttributedString(attr)
        let size = CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(location: 0, length: 0), nil,
                                                                CGSize(width: width, height: .greatestFiniteMagnitude), nil)
        return ceil(size.height)
    }
}
