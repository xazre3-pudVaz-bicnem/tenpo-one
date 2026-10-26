import SwiftUI
import UIKit

// 店舗名刺（ネイティブ）。Web の 設定 > 店舗情報 > 店舗名刺（app/app/settings/store/business-cards/page.tsx・
// components/settings/booking-meishi.tsx・booking-qr-card.tsx）を iPad の中で（2026-10-24 Ronnie「iPad は全部ネイティブ」）。
//   - A4 に横名刺（91×55mm）を 2列×5段＝10枚。切り取り線（点線）とトンボ（余白の切る位置の線）。中身は予約QRカードと同じ
//     （左：店名 → ご予約 → RESERVATION → 住所・電話、右：予約ページの QR とクーポン1つ、下の真ん中に TENPO ONE）
//   - 見本をそのまま画面に出し、PDF（共有シート）と AirPrint。描き方の道具はテーブルQR と同じ（NativeTableQrView.swift の NTQArtist・NTQOutput）
//   - 中身はサーバー（GET ?part=businessCards。lib/native-modules/business-cards.ts。Web と同じ lib/store-business-cards-server.ts）

struct NBCCard: Codable, Hashable {
    let storeName: String
    /// 〒 付きの住所
    let address: String?
    let phone: String?
    /// 予約ページの URL（QR の中身）
    let bookingUrl: String
    /// 当店のクーポン（名刺はいちばん上の1つだけ）
    let coupons: [String]

    var coupon: String? { coupons.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
}

struct NBCPayload: Codable {
    let store: NFNamed
    /// 予約URL（スラッグ）が無い店舗は nil（作れない）
    let card: NBCCard?
}

// MARK: - 描く（Web の booking-qr-card.tsx・booking-meishi.tsx と同じ寸法）

enum NBCArtist {
    private static func mm(_ v: CGFloat) -> CGFloat { NTQArtist.mm(v) }
    static let couponBg = NTQArtist.ui(0xFBEFE9)
    static let couponInk = NTQArtist.ui(0x8B4536)

    /// 予約QRの横名刺（91×55mm）1枚
    static func drawCard(_ ctx: CGContext, at origin: CGPoint, card c: NBCCard, qr: NTQQr) {
        ctx.saveGState()
        ctx.translateBy(x: origin.x, y: origin.y)
        let W = mm(91), H = mm(55)
        // 地はクリーム、上端にテラコッタの細い帯、内側に細い線（額縁）
        ctx.setFillColor(NTQArtist.cream.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
        ctx.setFillColor(NTQArtist.terra.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: W, height: mm(1.4)))
        NTQArtist.roundedRect(ctx, CGRect(x: mm(2.6), y: mm(3.2), width: W - mm(5.2), height: H - mm(3.2) - mm(2.6)), radius: mm(1.6), fill: nil, stroke: NTQArtist.frame, lineWidth: mm(0.2))

        // 中身の枠：左右 5mm・上 5mm・下 7.2mm。右の列（QR・クーポン）は 33mm、左の列との間は 4mm
        let top = mm(5), bottom = H - mm(7.2)
        let rightW = mm(33)
        let rightX = W - mm(5) - rightW
        let leftX = mm(5)
        let leftW = rightX - mm(4) - leftX

        // 右：QR（白地・角丸・テラコッタの細い枠）と、その下にクーポン。まとめて上下の真ん中に
        let coupon = c.coupon
        let qrMm: CGFloat = coupon == nil ? 29 : 27
        let box = mm(qrMm + 0.9 * 2 + 0.3 * 2)
        let couponPadX = mm(1.4), couponPadY = mm(0.8), couponBorder = mm(0.25)
        let couponInnerW = rightW - couponPadX * 2 - couponBorder * 2
        var couponTitle: NSAttributedString?
        var couponBody: NSAttributedString?
        var couponBodyH: CGFloat = 0
        var couponH: CGFloat = 0
        if let coupon {
            let t = NTQArtist.attr("当店のクーポン COUPON", pt: 3.8, weight: .bold, color: NTQArtist.terra, track: 0.3)
            let b = NTQArtist.attr(coupon, pt: 5.6, weight: .bold, color: couponInk, lineHeight: 1.3, wrap: true)
            couponBodyH = NTQArtist.block(b, centerX: 0, y: 0, width: couponInnerW, maxLines: 2, draw: false)
            couponH = couponBorder * 2 + couponPadY * 2 + t.size().height.rounded(.up) + mm(0.6) + couponBodyH
            couponTitle = t
            couponBody = b
        }
        let groupH = box + (coupon == nil ? 0 : mm(1.4) + couponH)
        var ry = top + max(0, (bottom - top - groupH) / 2)
        NTQArtist.qrBox(ctx, qr: qr, logo: nil, x: rightX + (rightW - box) / 2, y: ry, qrMm: qrMm, padMm: 0.9, borderMm: 0.3, radiusMm: 2)
        ry += box
        if let t = couponTitle, let b = couponBody {
            ry += mm(1.4)
            let r = CGRect(x: rightX, y: ry, width: rightW, height: couponH).insetBy(dx: couponBorder / 2, dy: couponBorder / 2)
            let path = UIBezierPath(roundedRect: r, cornerRadius: mm(1.2)).cgPath
            ctx.saveGState()
            ctx.setFillColor(couponBg.cgColor)
            ctx.addPath(path)
            ctx.fillPath()
            ctx.setStrokeColor(NTQArtist.terra.cgColor)
            ctx.setLineWidth(couponBorder)
            ctx.setLineDash(phase: 0, lengths: [mm(0.8), mm(0.5)])
            ctx.addPath(path)
            ctx.strokePath()
            ctx.restoreGState()
            let rcx = rightX + rightW / 2
            var ty = ry + couponBorder + couponPadY
            ty += NTQArtist.line(t, centerX: rcx, y: ty, width: couponInnerW)
            ty += mm(0.6)
            NTQArtist.block(b, centerX: rcx, y: ty, width: couponInnerW, maxLines: 2)
        }

        // 左の上：店名 → 細い線 → ご予約 → RESERVATION → 案内（真ん中ぞろえ）
        let cx = leftX + leftW / 2
        var ly = top
        ly += NTQArtist.storeName(c.storeName, centerX: cx, y: ly, widthMm: 44, brandPt: 11.5, branchPt: 9)
        ly += mm(1.6)
        ctx.setFillColor(NTQArtist.terra.cgColor)
        ctx.fill(CGRect(x: cx - mm(4.5), y: ly, width: mm(9), height: mm(0.3)))
        ly += mm(0.3) + mm(1.6)
        ly += NTQArtist.line(NTQArtist.attr("ご予約", pt: 13, weight: NT.strong, color: NTQArtist.ink, track: 0.12, lineHeight: 1.1), centerX: cx, y: ly, width: leftW)
        ly += mm(1)
        ly += NTQArtist.line(NTQArtist.attr("RESERVATION", pt: 5.2, weight: .bold, color: NTQArtist.terra, track: 0.42, lineHeight: 1.1), centerX: cx, y: ly, width: leftW)
        ly += mm(1.8)
        NTQArtist.line(NTQArtist.attr("QRコードからご予約いただけます", pt: 5, weight: .regular, color: NTQArtist.note, lineHeight: 1.4), centerX: cx, y: ly, width: leftW)

        // 左の下：住所（2行まで）と電話番号。下の端にそろえる
        var addr: NSAttributedString?
        var addrH: CGFloat = 0
        if let a = c.address, !a.isEmpty {
            let s = NTQArtist.attr(a, pt: 4.8, weight: .regular, color: NTQArtist.note, lineHeight: 1.45, wrap: true)
            addrH = NTQArtist.block(s, centerX: cx, y: 0, width: leftW, maxLines: 2, draw: false)
            addr = s
        }
        var tel: NSAttributedString?
        var telH: CGFloat = 0
        if let p = c.phone, !p.isEmpty {
            let s = NSMutableAttributedString(attributedString: NTQArtist.attr("TEL", pt: 4.6, weight: .bold, color: NTQArtist.terra, track: 0.2))
            // 「TEL」と番号の間 1.2mm
            s.addAttribute(.kern, value: 4.6 * 0.2 + mm(1.2), range: NSRange(location: 2, length: 1))
            s.append(NTQArtist.attr(p, pt: 8.2, weight: NT.strong, color: NTQArtist.ink, track: 0.06))
            telH = s.size().height.rounded(.up)
            tel = s
        }
        let gap = (addr != nil && tel != nil) ? mm(0.8) : 0
        var by = bottom - (addrH + gap + telH)
        if let s = addr {
            NTQArtist.block(s, centerX: cx, y: by, width: leftW, maxLines: 2)
            by += addrH + gap
        }
        if let s = tel { NTQArtist.line(s, centerX: cx, y: by, width: leftW) }

        // いちばん下の真ん中：TENPO ONE（左右に細い線）
        NTQArtist.footer(centerX: W / 2, bottomY: H - mm(3.4), pt: 5, lineMm: 10, gapMm: 2, ruleMm: 0.2, ctx: ctx)
        ctx.restoreGState()
    }

    /// A4（210×297mm）に横名刺 10枚と、切り取り線（点線）・トンボ・切り方の説明
    static func a4Page(_ ctx: CGContext, card: NBCCard, qr: NTQQr) {
        let A4W = mm(210), A4H = mm(297)
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: A4W, height: A4H))
        let cw = mm(91), ch = mm(55)
        let cols = 2, rows = 5
        let gridW = cw * CGFloat(cols), gridH = ch * CGFloat(rows)
        let left = (A4W - gridW) / 2 // 14mm
        let top = (A4H - gridH) / 2 // 11mm
        for i in 0..<(cols * rows) {
            drawCard(ctx, at: CGPoint(x: left + CGFloat(i % cols) * cw, y: top + CGFloat(i / cols) * ch), card: card, qr: qr)
        }
        let xs = (0...cols).map { left + CGFloat($0) * cw }
        let ys = (0...rows).map { top + CGFloat($0) * ch }
        ctx.saveGState()
        ctx.setStrokeColor(NTQArtist.cut.cgColor)
        ctx.setLineWidth(mm(0.2))
        ctx.setLineDash(phase: 0, lengths: [mm(1.2), mm(0.9)])
        for x in xs {
            ctx.move(to: CGPoint(x: x, y: top))
            ctx.addLine(to: CGPoint(x: x, y: top + gridH))
        }
        for y in ys {
            ctx.move(to: CGPoint(x: left, y: y))
            ctx.addLine(to: CGPoint(x: left + gridW, y: y))
        }
        ctx.strokePath()
        ctx.restoreGState()
        ctx.setFillColor(NTQArtist.ink.cgColor)
        for x in xs {
            ctx.fill(CGRect(x: x - mm(0.1), y: top - mm(9), width: mm(0.2), height: mm(7)))
            ctx.fill(CGRect(x: x - mm(0.1), y: top + gridH + mm(2), width: mm(0.2), height: mm(7)))
        }
        for y in ys {
            ctx.fill(CGRect(x: left - mm(12), y: y - mm(0.1), width: mm(10), height: mm(0.2)))
            ctx.fill(CGRect(x: left + gridW + mm(2), y: y - mm(0.1), width: mm(10), height: mm(0.2)))
        }
        let note = NTQArtist.attr("✂ 線に沿って切ってください ／ 横名刺 91×55mm × 10枚", pt: 5.8, weight: .regular, color: NTQArtist.note)
        note.draw(with: CGRect(x: left + mm(20), y: top + gridH + mm(2.2), width: mm(60), height: mm(6)), options: [.usesLineFragmentOrigin], context: nil)
    }

    /// A4 1枚の PDF（共有・AirPrint）
    static func pdf(card: NBCCard, qr: NTQQr) -> Data {
        let fmt = UIGraphicsPDFRendererFormat()
        fmt.documentInfo = [kCGPDFContextTitle as String: "\(card.storeName) 店舗名刺", kCGPDFContextCreator as String: "TENPO ONE"]
        let r = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: NTQArtist.a4), format: fmt)
        return r.pdfData { c in
            c.beginPage()
            a4Page(c.cgContext, card: card, qr: qr)
        }
    }

    /// 画面の見本（A4 1枚を幅 widthPt の絵に）
    static func image(card: NBCCard, qr: NTQQr, widthPt: CGFloat) -> UIImage {
        let k = widthPt / NTQArtist.a4.width
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 2
        return UIGraphicsImageRenderer(size: CGSize(width: widthPt, height: NTQArtist.a4.height * k), format: fmt).image { c in
            c.cgContext.scaleBy(x: k, y: k)
            a4Page(c.cgContext, card: card, qr: qr)
        }
    }
}

// MARK: - 画面

@MainActor
final class NativeBusinessCardsModel: NSPModel<NBCPayload> {
    /// A4 の見本（中身が変わったら作り直す）
    @Published var preview: UIImage?
    private var qr: NTQQr?
    private var previewKey = ""

    init() { super.init(part: NativeSettingsPageKey.businessCards.rawValue) }

    override func loaded(_ p: NBCPayload) { rebuild(p.card) }

    private func rebuild(_ card: NBCCard?) {
        guard let card else { preview = nil; qr = nil; previewKey = ""; return }
        let key = [card.storeName, card.address ?? "", card.phone ?? "", card.bookingUrl, card.coupon ?? ""].joined(separator: "|")
        guard key != previewKey else { return }
        previewKey = key
        // 予約QR はマークなし（Web の QrSvg と同じ。誤り訂正 M）
        guard let q = NTQQr.make(card.bookingUrl, logo: false) else { toast = "QRコードを作れませんでした"; return }
        qr = q
        Task.detached(priority: .userInitiated) {
            let img = NBCArtist.image(card: card, qr: q, widthPt: 620)
            await MainActor.run { [img, key] in
                guard self.previewKey == key else { return }
                self.preview = img
            }
        }
    }

    func sharePdf() {
        guard let c = payload?.card, let q = qr else { toast = "まだ準備ができていません"; return }
        let data = NBCArtist.pdf(card: c, qr: q)
        if let e = NTQOutput.share(pdf: data, fileName: "\(c.storeName)_店舗名刺_A4.pdf") { toast = e }
    }

    func printPdf() {
        guard let c = payload?.card, let q = qr else { toast = "まだ準備ができていません"; return }
        let data = NBCArtist.pdf(card: c, qr: q)
        if let e = NTQOutput.print(pdf: data, jobName: "\(c.storeName) 店舗名刺（A4）") { toast = e }
    }
}

struct NativeBusinessCardsScreen: View {
    @StateObject private var model = NativeBusinessCardsModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "店舗名刺", en: "Business cards", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                if let c = p.card {
                    NSPCard(title: "店舗名刺（A4に10枚）", note: "\(c.storeName)｜A4 に横名刺（91×55mm）10枚。印刷して線に沿って切り、レジに置いてください") {
                        HStack(spacing: 10) {
                            NSPButton(text: "印刷する", icon: "printer", primary: true, disabled: model.preview == nil) { model.printPdf() }
                            NSPButton(text: "PDFを共有（A4）", icon: "square.and.arrow.up", disabled: model.preview == nil) { model.sharePdf() }
                            Spacer(minLength: 0)
                        }
                        .padding(18)
                    }
                    NSPCard(title: "印刷のしかた") {
                        VStack(alignment: .leading, spacing: 8) {
                            tip("印刷は「用紙 A4」「倍率 100%（実際のサイズ）」で。フチなし印刷は要りません（まわりの白い余白に切る位置の線があります）。")
                            tip("点線（カードの境目）と、余白の短い線（トンボ）に沿って切ると、横名刺（91×55mm）が10枚できます。")
                            tip("厚めの紙（名刺用紙・画用紙）に印刷すると、レジに置いたりお客様に渡したりしやすくなります。")
                        }
                        .padding(18)
                    }
                    NSPCard(title: "見本") {
                        Group {
                            if let img = model.preview {
                                Image(uiImage: img).resizable().interpolation(.high).scaledToFit()
                                    .frame(maxWidth: 620)
                                    .background(Color.white)
                                    .shadow(color: Color.black.opacity(0.15), radius: 6, y: 2)
                            } else {
                                ProgressView("見本を作っています…").font(.system(size: 13)).padding(40)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(18)
                        .background(NT.page)
                    }
                } else {
                    NSPCard(title: "予約URLがありません", note: "店舗の予約URL（スラッグ）が決まると作れます") { EmptyView() }
                }
            }
        }
        .task { await model.refresh() }
    }

    private func tip(_ s: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text("・").font(.system(size: 14)).foregroundColor(NFColor.ink2)
            Text(s).font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
        }
    }
}
