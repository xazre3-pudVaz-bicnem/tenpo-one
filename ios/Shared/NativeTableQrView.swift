import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins

// テーブルのお客様QR（ネイティブ）。Web の 設定 > テーブル > QR印刷（app/app/settings/tables/qr-print/page.tsx）と
// 各卓の「QRコード」（再発行・停止）を iPad の中で（2026-10-24 Ronnie「QR印刷・再発行をネイティブに」）。
//   - 卓の一覧（QR の小さい絵）→ 卓を押すと大きな QR・URL・この卓だけの PDF／印刷・トークン再発行・QR停止
//   - 全卓を A4 にまとめて：横名刺（91×55mm・A4 に10枚）／ A6（105×148mm・A4 に4枚）。見本をそのまま画面に出し、PDF（共有）と AirPrint
//   - QR はマスを長方形で描く（ベクター。どれだけ大きく刷ってもにじまない）。真ん中に TENPO ONE のマーク
//     （誤り訂正 Q・穴は幅の 22%。Web の lib/qr-matrix.ts と同じ）。中身の URL・トークンは変えない
//   - 卓と URL はサーバー（GET ?part=tableQr。lib/native-table-qr-server.ts）。再発行・停止は POST tableQrRegenerate / tableQrStop
//     （Web の 設定 > テーブル と同じ Server Action。レジ端末のアカウントからは Web と同じく不可）

struct NTQTable: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    /// お客様の注文ページの URL（QR の中身）。QR を止めている卓は nil
    let url: String?
}
struct NTQPayload: Codable { let store: NFNamed; let tables: [NTQTable]; let canEdit: Bool; let editNote: String? }
private struct NTQActResult: Decodable { let ok: Bool; let error: String?; let url: String?; let invalidated: Bool? }

/// 印刷の大きさ（Web の ?size）
enum NTQLayout: String, CaseIterable, Identifiable {
    case card, a6
    var id: String { rawValue }
    var label: String { self == .card ? "名刺（A4に10枚）" : "A6（A4に4枚）" }
    var cardW: CGFloat { self == .card ? 91 : 105 }
    var cardH: CGFloat { self == .card ? 55 : 148 }
    var cols: Int { 2 }
    var rows: Int { self == .card ? 5 : 2 }
    var perPage: Int { cols * rows }
    var fileLabel: String { self == .card ? "名刺_A4に10枚" : "A6_A4に4枚" }
}

// MARK: - 店舗名（店名／支店名の2行。Web の lib/store-name.ts と同じ分け方）

enum NTQStoreName {
    /// 日本語（かな・漢字）か。Web の JP = /[぀-ヿ㐀-鿿豈-﫿]/
    static func isJP(_ ch: Character) -> Bool {
        guard let u = ch.unicodeScalars.first?.value else { return false }
        return (0x3040...0x30FF).contains(u) || (0x3400...0x9FFF).contains(u) || (0xF900...0xFAFF).contains(u)
    }

    static func split(_ name: String) -> (brand: String, branch: String?) {
        let s = name.replacingOccurrences(of: "　", with: " ")
            .split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" })
            .joined(separator: " ")
        // 最後の区切り（スペース）のあとが日本語で始まるときだけ分ける
        if let r = s.range(of: " ", options: .backwards) {
            let brand = s[..<r.lowerBound].trimmingCharacters(in: .whitespaces)
            let branch = String(s[r.upperBound...])
            if let f = branch.first, isJP(f), !brand.isEmpty { return (brand, branch) }
        }
        // スペースなし：英字・記号の店名のあとに日本語の支店名（MEAT CROWN新横浜 → MEAT CROWN ／ 新横浜）
        if let re = try? NSRegularExpression(pattern: "^([A-Za-z0-9][A-Za-z0-9&＆'’.・\\-\\s]*[A-Za-z0-9.])\\s*([぀-ヿ㐀-鿿豈-﫿].*)$"),
           let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
           let r1 = Range(m.range(at: 1), in: s), let r2 = Range(m.range(at: 2), in: s) {
            return (s[r1].trimmingCharacters(in: .whitespaces), s[r2].trimmingCharacters(in: .whitespaces))
        }
        return (s, nil)
    }
}

// MARK: - QR のマス（CoreImage で作って、マスを自分で描く）

struct NTQQr {
    let n: Int
    let modules: [[Bool]]
    /// マークを置く穴（start ≦ 行・列 < end）。マーク無しは nil
    let hole: Range<Int>?

    /// 周りの白（クワイエットゾーン）。QR の規格どおり 4 マス（2026-09-21 店舗報告「読み取れない卓がある」→ Web と同じ）
    static let margin = 4
    /// マークの幅（マス数に対する割合）。Web の QR_LOGO_RATIO
    static let logoRatio = 0.22

    static func make(_ text: String, logo: Bool) -> NTQQr? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = logo ? "Q" : "M"
        guard let out = f.outputImage else { return nil }
        let w = Int(out.extent.width.rounded()), h = Int(out.extent.height.rounded())
        guard w > 0, h > 0 else { return nil }
        let ci = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
        guard let cg = ci.createCGImage(out, from: out.extent) else { return nil }
        var px = [UInt8](repeating: 255, count: w * h)
        let drew: Bool = px.withUnsafeMutableBytes { buf in
            guard let base = buf.baseAddress,
                  let bmp = CGContext(data: base, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            bmp.interpolationQuality = .none
            bmp.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drew else { return nil }
        let dark = { (r: Int, c: Int) -> Bool in px[r * w + c] < 128 }
        // 黒いマスのある範囲＝QR そのもの（CoreImage の出す絵には周りに白が付いている）
        var minR = h, maxR = -1, minC = w, maxC = -1
        for r in 0..<h { for c in 0..<w where dark(r, c) { minR = min(minR, r); maxR = max(maxR, r); minC = min(minC, c); maxC = max(maxC, c) } }
        guard maxR >= minR, maxC >= minC else { return nil }
        let n = maxR - minR + 1
        guard n == maxC - minC + 1, n >= 21 else { return nil }
        var m: [[Bool]] = (0..<n).map { r in (0..<n).map { c in dark(minR + r, minC + c) } }
        // 向きの確認：位置検出パターン（四角の目印）は 左上・右上・左下（右下には無い）。上下さかさまなら直す（鏡像は読めない）
        func finder(_ r0: Int, _ c0: Int) -> Bool {
            for r in 0..<7 { for c in 0..<7 {
                let ring = r == 0 || r == 6 || c == 0 || c == 6
                let core = (2...4).contains(r) && (2...4).contains(c)
                if m[r0 + r][c0 + c] != (ring || core) { return false }
            } }
            return true
        }
        if !(finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0)) {
            if finder(n - 7, 0) && finder(n - 7, n - 7) && finder(0, 0) { m.reverse() }
            else if finder(0, n - 7) && finder(0, 0) && finder(n - 7, n - 7) { m = m.map { Array($0.reversed()) } }
        }
        var hole: Range<Int>? = nil
        if logo {
            var k = Int((Double(n) * logoRatio).rounded())
            if (n - k) % 2 != 0 { k += 1 } // ぴったり真ん中に
            let start = (n - k) / 2
            hole = start..<(start + k)
        }
        return NTQQr(n: n, modules: m, hole: hole)
    }

    private func inHole(_ r: Int, _ c: Int) -> Bool {
        guard let hole else { return false }
        return hole.contains(r) && hole.contains(c)
    }

    /// rect ＝ 周りの白（4マス）込みの正方形。ctx は UIKit の向き（左上が原点）。横に続くマスは 1 本の長方形で描く（Web の SVG と同じ）
    func draw(in ctx: CGContext, rect: CGRect, logo: UIImage?) {
        let total = CGFloat(n + Self.margin * 2)
        let u = rect.width / total
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fill(rect)
        ctx.setFillColor(UIColor.black.cgColor)
        // となりのマスとの境に白い筋が出ないよう、ほんの少し重ねる
        let eps = u * 0.04
        for r in 0..<n {
            var c = 0
            while c < n {
                if !modules[r][c] || inHole(r, c) { c += 1; continue }
                var len = 1
                while c + len < n && modules[r][c + len] && !inHole(r, c + len) { len += 1 }
                ctx.fill(CGRect(x: rect.minX + CGFloat(c + Self.margin) * u, y: rect.minY + CGFloat(r + Self.margin) * u, width: CGFloat(len) * u + eps, height: u + eps))
                c += len
            }
        }
        // 穴のまわり半マスは白のまま残して、マークを置く
        if let hole, let logo {
            let o = CGFloat(Self.margin + hole.lowerBound) + 0.5
            let s = CGFloat(hole.count) - 1
            logo.draw(in: CGRect(x: rect.minX + o * u, y: rect.minY + o * u, width: s * u, height: s * u))
        }
    }
}

// MARK: - カード・A4 を描く（Web の table-qr-business-card.tsx / table-qr-card.tsx / a4-cut-sheets.tsx と同じ見た目）

struct NTQCard {
    let table: NTQTable
    let qr: NTQQr
}

enum NTQArtist {
    static let ptPerMm: CGFloat = 72 / 25.4
    static func mm(_ v: CGFloat) -> CGFloat { v * ptPerMm }
    static let a4 = CGSize(width: mm(210), height: mm(297))
    static let a6 = CGSize(width: mm(105), height: mm(148))

    // 配色は TENPO ONE（app/globals.css）：地はクリーム・字はチャコール・差し色はテラコッタ
    static let cream = ui(0xF7F5F0)
    static let ink = ui(0x292725)
    static let terra = ui(0xBC5940)
    static let frame = ui(0xE5DFD5)
    static let rule = ui(0xD6CDC0)
    static let cut = ui(0x9C948A)
    static let note = ui(0x766B62)
    static func ui(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }

    // 字
    static func attr(_ text: String, pt: CGFloat, weight: UIFont.Weight, color: UIColor, track: CGFloat = 0, lineHeight: CGFloat? = nil, wrap: Bool = false) -> NSAttributedString {
        let p = NSMutableParagraphStyle()
        p.alignment = .center
        p.lineBreakMode = wrap ? .byCharWrapping : .byClipping
        if let lh = lineHeight { p.minimumLineHeight = pt * lh; p.maximumLineHeight = pt * lh }
        var a: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: pt, weight: weight), .foregroundColor: color, .paragraphStyle: p]
        if track != 0 { a[.kern] = pt * track }
        return NSAttributedString(string: text, attributes: a)
    }

    /// 1行に収まる大きさ（pt）。maxPt から minPt まで縮める（Web の fitPt と同じ役目。実際の字の幅で測る）
    static func fitPt(_ text: String, width: CGFloat, maxPt: CGFloat, minPt: CGFloat, weight: UIFont.Weight, track: CGFloat) -> CGFloat {
        let w = attr(text, pt: maxPt, weight: weight, color: .black, track: track).size().width
        if w <= width { return maxPt }
        return max(minPt, (maxPt * width / w * 10).rounded(.down) / 10)
    }

    /// 1行を中央に描く。戻り値は高さ
    @discardableResult
    static func line(_ s: NSAttributedString, centerX: CGFloat, y: CGFloat, width: CGFloat) -> CGFloat {
        let h = s.size().height.rounded(.up)
        s.draw(with: CGRect(x: centerX - width / 2, y: y, width: width, height: h), options: [.usesLineFragmentOrigin], context: nil)
        return h
    }

    /// 折り返す字（最大 maxLines 行）。高さを返す（描かずに測るだけもできる）
    @discardableResult
    static func block(_ s: NSAttributedString, centerX: CGFloat, y: CGFloat, width: CGFloat, maxLines: Int, draw: Bool = true) -> CGFloat {
        guard s.length > 0 else { return 0 }
        let lineH = (s.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.maximumLineHeight ?? 0
        let font = s.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        let oneLine = lineH > 0 ? lineH : (font?.lineHeight ?? s.size().height)
        let measured = s.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).height
        let h = min(measured, oneLine * CGFloat(maxLines)).rounded(.up)
        if draw { s.draw(with: CGRect(x: centerX - width / 2, y: y, width: width, height: h), options: [.usesLineFragmentOrigin], context: nil) }
        return h
    }

    /// 店名（1行目）と支店名（2行目）。高さを返す
    @discardableResult
    static func storeName(_ name: String, centerX: CGFloat, y: CGFloat, widthMm: CGFloat, brandPt: CGFloat, branchPt: CGFloat, draw: Bool = true) -> CGFloat {
        let (brand, branch) = NTQStoreName.split(name)
        let w = mm(widthMm)
        let bp = fitPt(brand, width: w, maxPt: brandPt, minPt: brandPt * 0.55, weight: NT.strong, track: 0.03)
        let b = attr(brand, pt: bp, weight: NT.strong, color: ink, track: 0.03, lineHeight: 1.2)
        var h = b.size().height.rounded(.up)
        if draw { line(b, centerX: centerX, y: y, width: w) }
        if let branch {
            let sp = fitPt(branch, width: w, maxPt: branchPt, minPt: branchPt * 0.6, weight: .bold, track: 0.08)
            let s = attr(branch, pt: sp, weight: .bold, color: ink, track: 0.08, lineHeight: 1.2)
            h += mm(0.5)
            if draw { line(s, centerX: centerX, y: y + h, width: w) }
            h += s.size().height.rounded(.up)
        }
        return h
    }

    /// いちばん下の「TENPO ONE」（左右に細い線）
    static func footer(centerX: CGFloat, bottomY: CGFloat, pt: CGFloat, lineMm: CGFloat, gapMm: CGFloat, ruleMm: CGFloat, ctx: CGContext) {
        let s = NSMutableAttributedString()
        s.append(attr("TENPO", pt: pt, weight: NT.strong, color: ink, track: 0.3))
        s.append(attr(" ", pt: pt, weight: NT.strong, color: ink, track: 0.3))
        s.append(attr("ONE", pt: pt, weight: NT.strong, color: terra, track: 0.3))
        let size = s.size()
        let y = bottomY - size.height
        s.draw(at: CGPoint(x: centerX - size.width / 2, y: y))
        ctx.setFillColor(rule.cgColor)
        let ly = y + size.height / 2 - mm(ruleMm) / 2
        ctx.fill(CGRect(x: centerX - size.width / 2 - mm(gapMm) - mm(lineMm), y: ly, width: mm(lineMm), height: mm(ruleMm)))
        ctx.fill(CGRect(x: centerX + size.width / 2 + mm(gapMm), y: ly, width: mm(lineMm), height: mm(ruleMm)))
    }

    static func roundedRect(_ ctx: CGContext, _ r: CGRect, radius: CGFloat, fill: UIColor?, stroke: UIColor?, lineWidth: CGFloat) {
        let path = UIBezierPath(roundedRect: r, cornerRadius: radius).cgPath
        if let fill { ctx.setFillColor(fill.cgColor); ctx.addPath(path); ctx.fillPath() }
        if let stroke { ctx.setStrokeColor(stroke.cgColor); ctx.setLineWidth(lineWidth); ctx.addPath(path); ctx.strokePath() }
    }

    /// QR を白地・角丸・テラコッタの細い枠に入れて描く（box ＝ 枠の外側の大きさ）
    static func qrBox(_ ctx: CGContext, qr: NTQQr, logo: UIImage?, x: CGFloat, y: CGFloat, qrMm: CGFloat, padMm: CGFloat, borderMm: CGFloat, radiusMm: CGFloat) {
        let box = mm(qrMm + padMm * 2 + borderMm * 2)
        roundedRect(ctx, CGRect(x: x, y: y, width: box, height: box), radius: mm(radiusMm), fill: .white, stroke: terra, lineWidth: mm(borderMm))
        qr.draw(in: ctx, rect: CGRect(x: x + mm(padMm + borderMm), y: y + mm(padMm + borderMm), width: mm(qrMm), height: mm(qrMm)), logo: logo)
    }

    /// 横名刺（91×55mm）。左：店名 → TABLE と卓番号（まんなか・いちばん大きく）→ ご注文はスマホから。右：QR
    static func businessCard(_ ctx: CGContext, at origin: CGPoint, store: String, card: NTQCard, logo: UIImage?) {
        ctx.saveGState()
        ctx.translateBy(x: origin.x, y: origin.y)
        let W = mm(91), H = mm(55)
        ctx.setFillColor(cream.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
        ctx.setFillColor(terra.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: W, height: mm(1.4)))
        roundedRect(ctx, CGRect(x: mm(2.6), y: mm(3.2), width: W - mm(5.2), height: H - mm(3.2) - mm(2.6)), radius: mm(1.6), fill: nil, stroke: frame, lineWidth: mm(0.2))

        let top = mm(5), contentH = H - mm(5) - mm(7.2)
        let box = mm(37 + 1.4 + 0.6)
        qrBox(ctx, qr: card.qr, logo: logo, x: W - mm(5) - box, y: top + (contentH - box) / 2, qrMm: 37, padMm: 0.7, borderMm: 0.3, radiusMm: 2)

        // 左の列（幅 38.5mm）。上・下の組を端に、真ん中の組はその間の中央に（justify-between）
        let lw = W - mm(10) - mm(3.5) - box
        let cx = mm(5) + lw / 2
        let colTop = top + mm(0.6), colBottom = top + contentH - mm(0.6)
        var y = colTop
        y += storeName(store, centerX: cx, y: y, widthMm: 38, brandPt: 9, branchPt: 7.2)
        y += mm(1.4)
        ctx.setFillColor(terra.cgColor); ctx.fill(CGRect(x: cx - mm(4.5), y: y, width: mm(9), height: mm(0.3)))
        let topEnd = y + mm(0.3)

        let jp = attr("ご注文はスマホから", pt: 7.6, weight: NT.strong, color: ink, track: 0.06)
        let en = attr("ORDER FROM YOUR PHONE", pt: 4, weight: .bold, color: terra, track: 0.24)
        let bottomH = jp.size().height.rounded(.up) + mm(1) + en.size().height.rounded(.up)
        let bottomStart = colBottom - bottomH
        line(jp, centerX: cx, y: bottomStart, width: lw)
        line(en, centerX: cx, y: bottomStart + jp.size().height.rounded(.up) + mm(1), width: lw)

        let name = card.table.name
        let namePt: CGFloat = name.count <= 4 ? 24 : name.count <= 7 ? 17 : 12
        let label = attr("TABLE", pt: 5, weight: .bold, color: terra, track: 0.42)
        let big = attr(name, pt: namePt, weight: NT.strong, color: ink, track: 0.02, lineHeight: 1.05, wrap: true)
        let labelH = label.size().height.rounded(.up)
        let bigH = block(big, centerX: cx, y: 0, width: lw, maxLines: 2, draw: false)
        let midH = labelH + mm(1.2) + bigH
        let midY = topEnd + max(0, (bottomStart - topEnd - midH) / 2)
        line(label, centerX: cx, y: midY, width: lw)
        block(big, centerX: cx, y: midY + labelH + mm(1.2), width: lw, maxLines: 2)

        footer(centerX: W / 2, bottomY: H - mm(3.4), pt: 5, lineMm: 10, gapMm: 2, ruleMm: 0.2, ctx: ctx)
        ctx.restoreGState()
    }

    /// A6（105×148mm・1卓1枚）。紙の端から 5mm 内側にクリームの面。上から：店名 → TABLE と卓番号 → QR → 読み取りの案内 → TENPO ONE
    static func a6Card(_ ctx: CGContext, at origin: CGPoint, store: String, card: NTQCard, logo: UIImage?) {
        ctx.saveGState()
        ctx.translateBy(x: origin.x, y: origin.y)
        let W = mm(105), H = mm(148)
        ctx.setFillColor(UIColor.white.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
        let inner = CGRect(x: mm(5), y: mm(5), width: W - mm(10), height: H - mm(10))
        ctx.saveGState()
        ctx.addPath(UIBezierPath(roundedRect: inner, cornerRadius: mm(3)).cgPath)
        ctx.clip()
        ctx.setFillColor(cream.cgColor); ctx.fill(inner)
        ctx.setFillColor(terra.cgColor); ctx.fill(CGRect(x: inner.minX, y: inner.minY, width: inner.width, height: mm(2)))
        ctx.restoreGState()
        roundedRect(ctx, CGRect(x: inner.minX + mm(3), y: inner.minY + mm(4.2), width: inner.width - mm(6), height: inner.height - mm(4.2) - mm(3)), radius: mm(2), fill: nil, stroke: frame, lineWidth: mm(0.25))

        let cx = W / 2
        let contentW = inner.width - mm(14)
        var y = inner.minY + mm(8.5)
        y += storeName(store, centerX: cx, y: y, widthMm: 80, brandPt: 15, branchPt: 11)
        y += mm(2.4)
        ctx.setFillColor(terra.cgColor); ctx.fill(CGRect(x: cx - mm(6), y: y, width: mm(12), height: mm(0.4)))
        y += mm(0.4) + mm(3.4)
        y += line(attr("TABLE", pt: 6.5, weight: .bold, color: terra, track: 0.45), centerX: cx, y: y, width: contentW)
        y += mm(1.6)
        let name = card.table.name
        let namePt: CGFloat = name.count <= 4 ? 28 : name.count <= 8 ? 20 : 15
        y += block(attr(name, pt: namePt, weight: NT.strong, color: ink, track: 0.02, lineHeight: 1.05, wrap: true), centerX: cx, y: y, width: contentW, maxLines: 2)

        // 真ん中の組（QR・案内）は、卓番号の下から いちばん下の余白（11mm）までの中央に
        let areaTop = y, areaBottom = inner.maxY - mm(11)
        let box = mm(56 + 2.4 + 0.7)
        let guide = attr("スマートフォンのカメラで読み取って\nご注文ください", pt: 10.5, weight: .bold, color: ink, lineHeight: 1.45)
        let scan = attr("SCAN TO ORDER", pt: 5.6, weight: .bold, color: terra, track: 0.22)
        let guideH = guide.boundingRect(with: CGSize(width: contentW, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).height.rounded(.up)
        let scanH = scan.size().height.rounded(.up)
        let groupH = box + mm(4) + guideH + mm(1.4) + scanH
        var gy = areaTop + max(0, (areaBottom - areaTop - groupH) / 2)
        qrBox(ctx, qr: card.qr, logo: logo, x: cx - box / 2, y: gy, qrMm: 56, padMm: 1.2, borderMm: 0.35, radiusMm: 3)
        gy += box + mm(4)
        guide.draw(with: CGRect(x: cx - contentW / 2, y: gy, width: contentW, height: guideH), options: [.usesLineFragmentOrigin], context: nil)
        gy += guideH + mm(1.4)
        line(scan, centerX: cx, y: gy, width: contentW)

        footer(centerX: cx, bottomY: inner.maxY - mm(5), pt: 6.5, lineMm: 14, gapMm: 2.5, ruleMm: 0.25, ctx: ctx)
        ctx.restoreGState()
    }

    /// A4（210×297mm）にカードを並べて、切り取り線（点線）とトンボ（余白の切る位置の線）を入れる
    static func a4Page(_ ctx: CGContext, items: [NTQCard], layout: NTQLayout, store: String, logo: UIImage?) {
        let A4W = mm(210), A4H = mm(297)
        ctx.setFillColor(UIColor.white.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: A4W, height: A4H))
        let cardW = mm(layout.cardW), cardH = mm(layout.cardH)
        let cols = layout.cols
        let gridW = cardW * CGFloat(cols)
        let left = (A4W - gridW) / 2
        let top = (A4H - cardH * CGFloat(layout.rows)) / 2
        let usedRows = Int(ceil(Double(items.count) / Double(cols)))
        let usedH = cardH * CGFloat(usedRows)
        for (i, card) in items.enumerated() {
            let o = CGPoint(x: left + CGFloat(i % cols) * cardW, y: top + CGFloat(i / cols) * cardH)
            if layout == .card { businessCard(ctx, at: o, store: store, card: card, logo: logo) } else { a6Card(ctx, at: o, store: store, card: card, logo: logo) }
        }
        // 余白が 8mm 以上あるときだけトンボと説明を出す（A6 4枚は余白がほぼ無いので点線だけ）
        let marks = left >= mm(8) && top >= mm(8)
        let xs = (0...cols).map { left + CGFloat($0) * cardW }
        let ys = (0...usedRows).map { top + CGFloat($0) * cardH }
        ctx.saveGState()
        ctx.setStrokeColor(cut.cgColor)
        ctx.setLineWidth(mm(0.2))
        ctx.setLineDash(phase: 0, lengths: [mm(1.2), mm(0.9)])
        // 用紙の端と重なる線は引かない（A6 4枚の上下 0.5mm など）
        for x in xs where x > mm(0.6) && x < A4W - mm(0.6) {
            ctx.move(to: CGPoint(x: x, y: marks ? top : 0)); ctx.addLine(to: CGPoint(x: x, y: top + usedH))
        }
        for y in ys where y > mm(0.6) && y < A4H - mm(1) {
            ctx.move(to: CGPoint(x: marks ? left : 0, y: y)); ctx.addLine(to: CGPoint(x: marks ? left + gridW : A4W, y: y))
        }
        ctx.strokePath()
        ctx.restoreGState()
        if marks {
            ctx.setFillColor(ink.cgColor)
            for x in xs {
                ctx.fill(CGRect(x: x - mm(0.1), y: top - mm(9), width: mm(0.2), height: mm(7)))
                ctx.fill(CGRect(x: x - mm(0.1), y: top + usedH + mm(2), width: mm(0.2), height: mm(7)))
            }
            for y in ys {
                ctx.fill(CGRect(x: left - mm(12), y: y - mm(0.1), width: mm(10), height: mm(0.2)))
                ctx.fill(CGRect(x: left + gridW + mm(2), y: y - mm(0.1), width: mm(10), height: mm(0.2)))
            }
            if layout == .card {
                let n = attr("✂ 線に沿って切ってください ／ 横名刺 91×55mm × 10枚", pt: 5.8, weight: .regular, color: note)
                n.draw(with: CGRect(x: left + mm(20), y: top + usedH + mm(2.2), width: mm(60), height: mm(6)), options: [.usesLineFragmentOrigin], context: nil)
            }
        }
    }

    // MARK: 出力

    static func pages(_ cards: [NTQCard], layout: NTQLayout) -> [[NTQCard]] {
        stride(from: 0, to: cards.count, by: layout.perPage).map { Array(cards[$0..<min($0 + layout.perPage, cards.count)]) }
    }

    /// 全卓を A4 にまとめた PDF
    static func a4Pdf(_ cards: [NTQCard], layout: NTQLayout, store: String, logo: UIImage?) -> Data {
        let fmt = UIGraphicsPDFRendererFormat()
        fmt.documentInfo = [kCGPDFContextTitle as String: "\(store) テーブルQR", kCGPDFContextCreator as String: "TENPO ONE"]
        let r = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: a4), format: fmt)
        return r.pdfData { c in
            for page in pages(cards, layout: layout) {
                c.beginPage()
                a4Page(c.cgContext, items: page, layout: layout, store: store, logo: logo)
            }
        }
    }

    /// 1卓だけ（A6 の紙に 1 枚）
    static func a6Pdf(_ card: NTQCard, store: String, logo: UIImage?) -> Data {
        let fmt = UIGraphicsPDFRendererFormat()
        fmt.documentInfo = [kCGPDFContextTitle as String: "\(store) \(card.table.name) テーブルQR", kCGPDFContextCreator as String: "TENPO ONE"]
        let r = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: a6), format: fmt)
        return r.pdfData { c in
            c.beginPage()
            a6Card(c.cgContext, at: .zero, store: store, card: card, logo: logo)
        }
    }

    /// 画面の見本（A4 1枚を幅 widthPt の絵に）
    static func a4Image(_ items: [NTQCard], layout: NTQLayout, store: String, logo: UIImage?, widthPt: CGFloat) -> UIImage {
        let k = widthPt / a4.width
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 2
        return UIGraphicsImageRenderer(size: CGSize(width: widthPt, height: a4.height * k), format: fmt).image { c in
            c.cgContext.scaleBy(x: k, y: k)
            a4Page(c.cgContext, items: items, layout: layout, store: store, logo: logo)
        }
    }

    /// QR だけの絵（一覧の小さい絵・大きい QR）
    static func qrImage(_ qr: NTQQr, logo: UIImage?, sidePt: CGFloat) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 2
        return UIGraphicsImageRenderer(size: CGSize(width: sidePt, height: sidePt), format: fmt).image { c in
            qr.draw(in: c.cgContext, rect: CGRect(x: 0, y: 0, width: sidePt, height: sidePt), logo: logo)
        }
    }
}

// MARK: - AirPrint・共有

enum NTQOutput {
    static func topController() -> UIViewController? {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first,
              var top = window.rootViewController else { return nil }
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    /// AirPrint（A4 の PDF をそのまま。用紙 A4・100% で刷ると線のとおりに切れる）
    static func print(pdf: Data, jobName: String) -> String? {
        guard UIPrintInteractionController.isPrintingAvailable else { return "この iPad では印刷できません" }
        guard UIPrintInteractionController.canPrint(pdf), let top = topController() else { return "印刷の準備ができませんでした" }
        let pc = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = jobName
        info.orientation = .portrait
        pc.printInfo = info
        pc.printingItem = pdf
        pc.present(from: CGRect(x: top.view.bounds.midX, y: 80, width: 1, height: 1), in: top.view, animated: true, completionHandler: nil)
        return nil
    }

    /// 共有シート（AirDrop・ファイルに保存・メール・プリント）
    static func share(pdf: Data, fileName: String) -> String? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do { try pdf.write(to: url, options: .atomic) } catch { return "PDF を作れませんでした" }
        guard let top = topController() else { return "共有の準備ができませんでした" }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: 80, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        top.present(vc, animated: true)
        return nil
    }
}

// MARK: - 画面

@MainActor
final class NativeTableQrModel: ObservableObject {
    @Published var payload: NTQPayload?
    @Published var error: String?
    @Published var busy = false
    @Published var toast: String?
    @Published var layout: NTQLayout = .card
    @Published var selected: NTQTable?
    /// 見本（A4 ごとの絵）。layout と卓が変わると作り直す
    @Published var pages: [UIImage] = []
    /// 一覧の小さい QR
    @Published var thumbs: [String: UIImage] = [:]
    private var qrs: [String: NTQQr] = [:]
    private var pagesKey = ""
    let logo = UIImage(named: "BrandMark")

    func qr(for table: NTQTable) -> NTQQr? {
        guard let url = table.url else { return nil }
        if let q = qrs[url] { return q }
        let q = NTQQr.make(url, logo: true)
        if let q { qrs[url] = q }
        return q
    }

    /// 印刷に入れる卓（QR を止めている卓は入れない）
    var cards: [NTQCard] {
        (payload?.tables ?? []).compactMap { t in qr(for: t).map { NTQCard(table: t, qr: $0) } }
    }
    var stopped: [NTQTable] { (payload?.tables ?? []).filter { $0.url == nil } }
    var storeName: String { payload?.store.name ?? "" }

    func load() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "tableQr")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NTQPayload.self, from: data)
            payload = p
            error = nil
            if let s = selected { selected = p.tables.first { $0.id == s.id } }
            rebuild()
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    /// 小さい QR と A4 の見本を作り直す（裏で描いて、できたら画面へ）
    func rebuild() {
        let cards = self.cards, layout = self.layout, store = storeName, logo = self.logo
        let key = layout.rawValue + "|" + cards.map { $0.table.id + ":" + ($0.table.url ?? "") }.joined(separator: ",")
        guard key != pagesKey else { return }
        pagesKey = key
        let needThumb = cards.filter { thumbs[$0.table.url ?? ""] == nil }
        Task.detached(priority: .userInitiated) {
            var t: [String: UIImage] = [:]
            for c in needThumb { t[c.table.url ?? ""] = NTQArtist.qrImage(c.qr, logo: logo, sidePt: 120) }
            let imgs = NTQArtist.pages(cards, layout: layout).map { NTQArtist.a4Image($0, layout: layout, store: store, logo: logo, widthPt: 420) }
            await MainActor.run { [t, imgs, key] in
                guard self.pagesKey == key else { return }
                self.thumbs.merge(t) { _, new in new }
                self.pages = imgs
            }
        }
    }

    func setLayout(_ l: NTQLayout) {
        guard l != layout else { return }
        layout = l
        rebuild()
    }

    func sharePdf() {
        let cards = self.cards
        guard !cards.isEmpty else { toast = "印刷できる卓がありません"; return }
        let data = NTQArtist.a4Pdf(cards, layout: layout, store: storeName, logo: logo)
        if let e = NTQOutput.share(pdf: data, fileName: "\(storeName)_テーブルQR_\(layout.fileLabel).pdf") { toast = e }
    }

    func printPdf() {
        let cards = self.cards
        guard !cards.isEmpty else { toast = "印刷できる卓がありません"; return }
        let data = NTQArtist.a4Pdf(cards, layout: layout, store: storeName, logo: logo)
        if let e = NTQOutput.print(pdf: data, jobName: "\(storeName) テーブルQR（\(layout.label)）") { toast = e }
    }

    func shareOne(_ table: NTQTable) {
        guard let q = qr(for: table) else { return }
        let data = NTQArtist.a6Pdf(NTQCard(table: table, qr: q), store: storeName, logo: logo)
        if let e = NTQOutput.share(pdf: data, fileName: "\(storeName)_\(table.name)_テーブルQR_A6.pdf") { toast = e }
    }

    func printOne(_ table: NTQTable) {
        guard let q = qr(for: table) else { return }
        let data = NTQArtist.a6Pdf(NTQCard(table: table, qr: q), store: storeName, logo: logo)
        if let e = NTQOutput.print(pdf: data, jobName: "\(storeName) \(table.name) テーブルQR") { toast = e }
    }

    /// 再発行（旧 QR は使えなくなる）／停止
    func act(_ type: String, table: NTQTable) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["type": type, "tableId": table.id])
            let data = try await NativeAPI.shared.send(req)
            let r = try JSONDecoder().decode(NTQActResult.self, from: data)
            if !r.ok { toast = r.error ?? "うまくいきませんでした"; return false }
            toast = type == "tableQrStop" ? "\(table.name) の QR注文を止めました" : "\(table.name) の QR を再発行しました。古い QR は使えません"
            await load()
            return true
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

/// ホームの「テーブルQR」から開く画面（ホームの上に重ねる）
struct NativeTableQrScreen: View {
    let onClose: () -> Void
    @StateObject private var model = NativeTableQrModel()

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 190), spacing: 12)]

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.storeName, title: "テーブルQRコード", subtitle: "", onHome: onClose, backIcon: "chevron.left")
            if let p = model.payload {
                content(p)
            } else if let e = model.error {
                VStack(spacing: 12) {
                    Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                    Button("もう一度") { Task { await model.load() } }.font(.system(size: 15, weight: .bold))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("読み込み中…").font(.system(size: 16, weight: .bold))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NFColor.navy.opacity(0.92)))
                    .padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 3_000_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .sheet(item: $model.selected) { t in
            NTQTableSheet(table: t, model: model, onClose: { model.selected = nil })
        }
        .task { await model.load() }
    }

    private func content(_ p: NTQPayload) -> some View {
        GeometryReader { geo in
            // 横（1000pt 以上）は左に卓の一覧・右に A4 の見本。縦は一覧だけ（大きさと印刷は上の列に）
            let wide = geo.size.width >= 1000
            HStack(alignment: .top, spacing: 16) {
                // 左：卓の一覧
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Text("卓を押すと、大きな QR・この卓だけの印刷・再発行").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                        Spacer()
                        Text("\(p.tables.count)卓" + (model.stopped.isEmpty ? "" : "（停止中 \(model.stopped.count)）")).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3)
                    }
                    if !wide {
                        HStack(spacing: 10) {
                            layoutPicker.frame(maxWidth: 360)
                            Spacer()
                            printBar(p)
                        }
                    }
                    ScrollView {
                        if p.tables.isEmpty {
                            VStack(spacing: 6) {
                                Text("テーブルがありません").font(.system(size: 15, weight: .bold))
                                Text("管理画面の 設定 > フロア・テーブル で追加してください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            }
                            .frame(maxWidth: .infinity).padding(40)
                        } else {
                            LazyVGrid(columns: columns, spacing: 12) {
                                ForEach(p.tables) { t in tile(t) }
                            }
                            .padding(2)
                        }
                    }
                }
                .frame(maxWidth: .infinity)

                // 右：A4 の見本と印刷
                if wide { preview(p).frame(width: max(380, geo.size.width * 0.36)) }
            }
            .padding(16)
        }
    }

    private var layoutPicker: some View {
        Picker("大きさ", selection: Binding(get: { model.layout }, set: { model.setLayout($0) })) {
            ForEach(NTQLayout.allCases) { l in Text(l.label).tag(l) }
        }
        .pickerStyle(.segmented)
    }

    private func tile(_ t: NTQTable) -> some View {
        Button { model.selected = t } label: {
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Color.white)
                    if let img = model.thumbs[t.url ?? ""] {
                        Image(uiImage: img).resizable().interpolation(.high).scaledToFit().padding(6)
                    } else if t.url == nil {
                        VStack(spacing: 4) {
                            Image(systemName: "qrcode").font(.system(size: 36)).foregroundColor(NFColor.ink3.opacity(0.4))
                            Text("QR停止中").font(.system(size: 12, weight: NT.strong)).foregroundColor(NFColor.danger)
                        }
                    } else {
                        ProgressView()
                    }
                }
                .frame(height: 120)
                Text(t.name).font(.system(size: 17, weight: NT.strong)).foregroundColor(NFColor.ink).lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(t.url == nil ? NFColor.dangerSoft : NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.url == nil ? NFColor.danger.opacity(0.4) : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func preview(_ p: NTQPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            layoutPicker
            printBar(p)
            Text(model.layout == .card
                 ? "A4・100%（実際のサイズ）で刷り、点線とトンボに沿って切ると横名刺（91×55mm）になります。QR は真ん中に TENPO ONE のマーク入り。中身（URL）は今までと同じです"
                 : "A4・100%（実際のサイズ）で刷り、点線で切ると A6 のカードになります。QR は真ん中に TENPO ONE のマーク入り。中身（URL）は今までと同じです")
                .font(.system(size: 12)).foregroundColor(NFColor.ink2)
            if !model.stopped.isEmpty {
                Text("QR を止めている卓（\(model.stopped.map { $0.name }.joined(separator: "・"))）は入っていません。卓を押して「再発行して再開」")
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.danger)
            }
            ScrollView {
                VStack(spacing: 14) {
                    if model.pages.isEmpty && !model.cards.isEmpty {
                        ProgressView("見本を作っています…").font(.system(size: 13)).padding(30)
                    }
                    ForEach(Array(model.pages.enumerated()), id: \.offset) { i, img in
                        VStack(spacing: 4) {
                            Image(uiImage: img).resizable().interpolation(.high).scaledToFit()
                                .background(Color.white)
                                .shadow(color: Color.black.opacity(0.12), radius: 6, y: 2)
                            Text("A4 \(i + 1) / \(model.pages.count)").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func printBar(_ p: NTQPayload) -> some View {
        HStack(spacing: 8) {
            Button { model.printPdf() } label: {
                HStack(spacing: 6) { Image(systemName: "printer"); Text("印刷する") }
                    .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 14).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
            Button { model.sharePdf() } label: {
                HStack(spacing: 6) { Image(systemName: "square.and.arrow.up"); Text("PDF") }
                    .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                    .padding(.horizontal, 14).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
            .buttonStyle(PressableStyle())
        }
        .disabled(model.cards.isEmpty)
        .opacity(model.cards.isEmpty ? 0.5 : 1)
    }
}

/// 1 卓の QR（大きく）・URL・この卓だけの PDF／印刷・再発行・停止
struct NTQTableSheet: View {
    let table: NTQTable
    @ObservedObject var model: NativeTableQrModel
    let onClose: () -> Void

    @State private var big: UIImage?
    @State private var confirm: Confirm?
    private enum Confirm: Identifiable { case regenerate, stop; var id: Int { self == .regenerate ? 1 : 2 } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Text(table.name).font(.system(size: 30, weight: NT.strong)).foregroundColor(NFColor.ink)
                    if table.url == nil {
                        VStack(spacing: 6) {
                            Image(systemName: "qrcode").font(.system(size: 60)).foregroundColor(NFColor.ink3.opacity(0.4))
                            Text("この卓の QR注文は止めています").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.danger)
                            Text("「再発行して再開」で新しい QR ができます（印刷し直してください）").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        }
                        .padding(.vertical, 20)
                    } else if let big {
                        Image(uiImage: big).resizable().interpolation(.high).scaledToFit()
                            .frame(width: 300, height: 300)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(NT.purple, lineWidth: 1.5))
                        VStack(spacing: 4) {
                            Text("お客様がスマホのカメラで読むと、この卓の注文ページが開きます").font(.system(size: 14, weight: .bold))
                            if let url = table.url {
                                Text(url).font(.system(size: 11, design: .monospaced)).foregroundColor(NFColor.ink3)
                                    .lineLimit(2).multilineTextAlignment(.center).textSelection(.enabled)
                            }
                        }
                        HStack(spacing: 10) {
                            Button { model.printOne(table) } label: { Label("この卓だけ印刷（A6）", systemImage: "printer") }
                            Button { model.shareOne(table) } label: { Label("PDF（A6）", systemImage: "square.and.arrow.up") }
                        }
                        .buttonStyle(.bordered)
                        .font(.system(size: 14, weight: .bold))
                    } else {
                        ProgressView().frame(height: 300)
                    }

                    Divider().padding(.vertical, 4)

                    if let p = model.payload, !p.canEdit {
                        Text(p.editNote ?? "この設定は管理画面で変更します").font(.system(size: 13)).foregroundColor(NFColor.ink3).multilineTextAlignment(.center)
                    } else {
                        VStack(spacing: 10) {
                            Button { confirm = .regenerate } label: {
                                Label(table.url == nil ? "再発行して再開" : "トークンを再発行（QR を作り直す）", systemImage: "arrow.triangle.2.circlepath")
                                    .font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity).frame(height: 44)
                            }
                            .buttonStyle(.borderedProminent).tint(NT.purple)
                            if table.url != nil {
                                Button(role: .destructive) { confirm = .stop } label: {
                                    Label("この卓の QR注文を止める", systemImage: "nosign")
                                        .font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity).frame(height: 44)
                                }
                                .buttonStyle(.bordered)
                            }
                            Text("再発行すると、今まで置いてあった QR は読んでも開かなくなります（印刷し直してください）。止めると、その卓からの QR注文が止まります")
                                .font(.system(size: 12)).foregroundColor(NFColor.ink3).multilineTextAlignment(.center)
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .background(NFColor.lilacSoft)
            .navigationTitle("テーブルQR / Table QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
            .disabled(model.busy)
            .overlay { if model.busy { ProgressView().padding(20).background(RoundedRectangle(cornerRadius: 12).fill(Color.white)) } }
        }
        .alert(item: $confirm) { c in
            switch c {
            case .regenerate:
                return Alert(
                    title: Text("\(table.name) の QR を再発行しますか？"),
                    message: Text("今まで置いてあった QR は使えなくなります。新しい QR を印刷して置き換えてください"),
                    primaryButton: .destructive(Text("再発行する")) { Task { _ = await model.act("tableQrRegenerate", table: table) } },
                    secondaryButton: .cancel(Text("やめる"))
                )
            case .stop:
                return Alert(
                    title: Text("\(table.name) の QR注文を止めますか？"),
                    message: Text("この卓の QR を読んでも注文ページが開かなくなります。再開は「再発行して再開」"),
                    primaryButton: .destructive(Text("止める")) { Task { _ = await model.act("tableQrStop", table: table) } },
                    secondaryButton: .cancel(Text("やめる"))
                )
            }
        }
        .task(id: table.url) {
            big = nil
            guard let q = model.qr(for: table) else { return }
            let logo = model.logo
            big = await Task.detached(priority: .userInitiated) { NTQArtist.qrImage(q, logo: logo, sidePt: 300) }.value
        }
    }
}
