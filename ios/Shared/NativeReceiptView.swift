import SwiftUI

// レシートのプレビュー（ネイティブ。iPad のレジ・iPhone の店長・オーナー）。2026-10-25 12:49 Ronnie「レシートのプレビュー Native banau」
// Web の /app/pos/receipt/<伝票>（?tab=invoice 領収書のタブ・?reissue=1 再発行の印・?from=orders 伝票明細から）の代わり。
// サーバーは GET ?part=receipt&id=<伝票>（lib/native-modules/receipt.ts。中身・入口の確かめは Web のページと同じ）。
// 印刷は今までの POST：レシート＝slipReceipt（伝票明細の「レシート」と同じ・再発行の印字）、領収書＝slipRyoshusho
//   （宛名・但し書き・分けて発行は NSRyoshushoSheet＝伝票明細とお会計の完了画面と同じ画面）。
// iPad の画面はこのファイル、iPhone は NativePhoneOwnerReceipt.swift（紙の見た目・読み込みはここを使う）。

/// GET ?part=receipt の中身
struct NRcptPayload: Decodable {
    struct Modifier: Decodable, Hashable { let name: String; let price: Int }
    struct Line: Decodable, Hashable {
        let name: String
        let quantity: Double
        let unitPrice: Int
        let lineTotal: Int
        let modifiers: [Modifier]
    }
    struct TaxRow: Decodable, Hashable { let rate: Double; let taxable: Int; let tax: Int }
    struct Payment: Decodable, Hashable { let label: String; let amount: Int }
    struct Receipt: Decodable {
        let isReissue: Bool
        let storeName: String
        let storeAddress: String?
        let storePhone: String?
        let registrationNumber: String?
        let tableName: String?
        let staffName: String?
        let guestCount: Double?
        let orderNo: String
        let issuedAt: String
        let startedAt: String?
        let completedAt: String?
        let lines: [Line]
        let subtotal: Int
        let taxRows: [TaxRow]
        let serviceCharge: Int
        let discount: Int
        let couponCode: String?
        let total: Int
        let payments: [Payment]
        let tendered: Int?
        let change: Int?
        let refundTotal: Int
        let netPaid: Int
        let pointsEarned: Int?
        let pointsUsed: Int?
        let pointBalance: Int?
    }
    /// 領収書の 1 つの印（印字と同じ座標。lib/classic-invoice.ts）
    struct InvoiceItem: Decodable, Hashable {
        let kind: String
        let x: Double
        let y: Double
        let w: Double
        let h: Double
        let text: String
        let size: Double
        let bold: Bool
        let align: String
    }
    struct Layout: Decodable { let width: Double; let height: Double; let items: [InvoiceItem] }
    struct Invoice: Decodable {
        let amount: Int
        let tax: Int
        let purpose: String
        let invoiceNote: String?
        let noStampNote: String
        let layout: Layout
    }
    struct Ryoshusho: Decodable {
        let issued: Bool
        let at: String?
        let atLabel: String
        let count: Int
        let message: String
    }
    let ok: Bool
    let orderId: String
    let orderNo: String
    let status: String
    let storeName: String
    let canPrint: Bool
    let canRyoshusho: Bool
    let printerReady: Bool
    let receipt: Receipt
    let invoice: Invoice
    let ryoshusho: Ryoshusho
}

enum NRTab: Hashable { case receipt, invoice }

@MainActor
final class NativeReceiptModel: ObservableObject {
    @Published var payload: NRcptPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    @Published var tab: NRTab
    /// この画面で領収書を出した（読み直す前でも「発行済み」にする）
    @Published var issuedHere = false

    let orderId: String
    let reissue: Bool
    let fromOrders: Bool
    /// iPad（印刷係を起こす POST）か iPhone か
    let pad: Bool

    init(orderId: String, reissue: Bool = false, tab: NRTab = .receipt, fromOrders: Bool = false, pad: Bool = AppConfig.isPad, sample: NRcptPayload? = nil) {
        self.orderId = orderId
        self.reissue = reissue
        self.tab = tab
        self.fromOrders = fromOrders
        self.pad = pad
        self.payload = sample
    }

    /// /app/pos/receipt/<伝票>?tab=invoice&reissue=1&from=orders
    convenience init(route: NativeModuleRoute) {
        self.init(
            orderId: NativeReceiptModel.orderId(from: route.url),
            reissue: route.query("reissue") == "1",
            tab: route.query("tab") == "invoice" ? .invoice : .receipt,
            fromOrders: route.query("from") == "orders"
        )
    }

    static func orderId(from url: URL) -> String {
        let base = "/app/pos/receipt/"
        guard url.path.hasPrefix(base) else { return "" }
        return String(url.path.dropFirst(base.count)).split(separator: "/").first.map(String.init) ?? ""
    }

    private var query: [String: String] {
        var q = ["id": orderId]
        if reissue { q["reissue"] = "1" }
        return q
    }

    var ryoshushoIssued: Bool { issuedHere || payload?.ryoshusho.issued == true }

    func load() async {
        if NativePreview.current != nil { return }
        guard orderId.count == 36, orderId.allSatisfy({ $0.isHexDigit || $0 == "-" }) else {
            error = "レシートが見つかりません"
            return
        }
        if payload == nil, let saved = NativeModuleAPI.cached(NRcptPayload.self, part: "receipt", query: query) { payload = saved }
        do {
            payload = try await NativeModuleAPI.get(NRcptPayload.self, part: "receipt", query: query)
            error = nil
        } catch {
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// レシートをもう一度（伝票明細と同じ POST slipReceipt。お店のレシートプリンターから「再発行」で出る）
    func printReceipt() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if NativePreview.current != nil { toast = "レシートを印刷します"; return }
        if let e = await post(["type": "slipReceipt", "orderId": orderId]) { error = e } else { toast = "レシートを印刷します" }
    }

    /// 領収書（NSRyoshushoSheet から。nil＝受け付けた、文字＝エラー）
    func sendRyoshusho(_ body: [String: Any]) async -> String? {
        if NativePreview.current != nil {
            issuedHere = true
            toast = "領収書を印刷します"
            return nil
        }
        if let e = await post(body) { return e }
        issuedHere = true
        toast = "領収書を印刷します"
        await load()
        return nil
    }

    /// POST。nil＝できた、文字＝サーバーのことば。iPad は印刷係をすぐ起こす（お会計の完了画面の領収書と同じ）
    private func post(_ body: [String: Any]) async -> String? {
        if pad {
            do {
                let r = try await NativeAPI.shared.act(body, throwOnFail: false)
                return r.ok ? nil : (r.error ?? "印刷できませんでした")
            } catch {
                return (error as? NativeAPIError)?.message ?? "通信できませんでした"
            }
        }
        let r = await NSPApi.postJSON(body)
        return r.ok ? nil : (r.error ?? "印刷できませんでした")
    }
}

// MARK: - 紙のレシート（Web の ReceiptView のレシートのタブと同じ並び）

/// 下がギザギザの紙
struct NRZigzag: Shape {
    var tooth: CGFloat = 7
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - tooth))
        var x = rect.maxX
        var down = true
        while x > rect.minX {
            let nx = max(rect.minX, x - tooth)
            p.addLine(to: CGPoint(x: nx, y: down ? rect.maxY : rect.maxY - tooth))
            down.toggle()
            x = nx
        }
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        p.closeSubpath()
        return p
    }
}

/// 点線
struct NRDashed: View {
    var color: Color = Color(hex: 0xB8BDC6)
    var body: some View {
        GeometryReader { g in
            Path { p in
                p.move(to: CGPoint(x: 0, y: 0.5))
                p.addLine(to: CGPoint(x: g.size.width, y: 0.5))
            }
            .stroke(color, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
        .frame(height: 1)
    }
}

struct NRReceiptPaper: View {
    let r: NRcptPayload.Receipt
    /// 字の大きさ（iPad 1.0・iPhone 少し小さく）
    var scale: CGFloat = 1

    private func f(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size * scale, weight: weight) }
    private var paperInk: Color { Color(hex: 0x1F2329) }
    private var rule: Color { Color(hex: 0x9AA0AA) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if r.isReissue {
                Text("※再発行").font(f(14, .bold)).foregroundColor(NT.danger).frame(maxWidth: .infinity).padding(.bottom, 4)
            }
            header
            infoGrid.padding(.top, 8)
            itemsTable.padding(.top, 8)
            NRDashed().padding(.vertical, 8)
            totals
            paymentsBlock.padding(.top, 8)
            if r.pointsEarned != nil || r.pointsUsed != nil || r.pointBalance != nil {
                NRDashed().padding(.vertical, 8)
                pointsBlock
            }
            NRDashed().padding(.vertical, 8)
            Text("ご来店ありがとうございました\nまたのご来店をお待ちしております")
                .font(f(12)).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.top, 2)
        }
        .foregroundColor(paperInk)
        .monospacedDigit()
        .padding(.horizontal, 18 * scale)
        .padding(.top, 20 * scale)
        .padding(.bottom, 26 * scale)
        .background(NRZigzag().fill(Color.white).shadow(color: Color.black.opacity(0.14), radius: 8, x: 0, y: 3))
    }

    private var header: some View {
        VStack(spacing: 2) {
            Text(r.storeName).font(f(18, .bold)).multilineTextAlignment(.center)
            Text("会計レシート").font(f(12, .bold)).padding(.vertical, 3)
            if let a = r.storeAddress, !a.isEmpty { Text(a).font(f(12)).multilineTextAlignment(.center) }
            if let t = r.storePhone, !t.isEmpty { Text("TEL \(t)").font(f(12)) }
            if let n = r.registrationNumber, !n.isEmpty { Text("登録番号 \(n)").font(f(12)) }
        }
        .frame(maxWidth: .infinity)
    }

    private var infoGrid: some View {
        VStack(spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text("卓番号").font(f(12))
                Spacer()
                Text(r.tableName ?? "—").font(f(20, .bold)).lineLimit(1)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(r.staffName.map { "担当 \($0)" } ?? "").font(f(12)).lineLimit(1)
                Spacer()
                Text(r.guestCount.map { "人数 \(Int($0.rounded()))名" } ?? "").font(f(12))
            }
            pair("伝票番号", "No.\(r.orderNo)")
            pair("開始日時", r.startedAt ?? "—")
            if let c = r.completedAt, !c.isEmpty { pair("会計日時", c) }
        }
    }

    private func pair(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(f(12))
            Spacer()
            Text(value).font(f(12)).lineLimit(1)
        }
    }

    private var itemsTable: some View {
        VStack(spacing: 0) {
            Rectangle().fill(rule).frame(height: 1)
            HStack(spacing: 4) {
                Text("商品名").frame(maxWidth: .infinity, alignment: .leading)
                Text("数").frame(width: 30 * scale, alignment: .trailing)
                Text("金額").frame(width: 76 * scale, alignment: .trailing)
            }
            .font(f(12)).padding(.vertical, 4)
            Rectangle().fill(rule).frame(height: 1)
            ForEach(Array(r.lines.enumerated()), id: \.offset) { _, it in
                HStack(alignment: .top, spacing: 4) {
                    Text(it.name).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
                    Text(NRFormat.qty(it.quantity)).frame(width: 30 * scale, alignment: .trailing)
                    Text(NT.yen(it.lineTotal)).frame(width: 76 * scale, alignment: .trailing)
                }
                .font(f(12)).padding(.vertical, 3)
            }
        }
    }

    private var totals: some View {
        VStack(spacing: 3) {
            row("小計", NT.yen(r.subtotal))
            ForEach(r.taxRows, id: \.self) { t in
                HStack {
                    Text("（内消費税\(NRFormat.rate(t.rate))%対象 \(NT.yen(t.taxable))）")
                    Spacer()
                    Text("税額 \(NT.yen(t.tax))")
                }
                .font(f(10)).foregroundColor(Color(hex: 0x6B7280))
            }
            if r.serviceCharge > 0 { row("サービス料", NT.yen(r.serviceCharge)) }
            if r.discount > 0 { row("値引き\(r.couponCode.map { "（クーポン: \($0)）" } ?? "")", "-\(NT.yen(r.discount))") }
            VStack(spacing: 0) {
                Rectangle().fill(rule).frame(height: 1)
                HStack {
                    Text("合計")
                    Spacer()
                    Text(NT.yen(r.total))
                }
                .font(f(20, .bold)).padding(.vertical, 7)
                Rectangle().fill(rule).frame(height: 1)
            }
            .padding(.top, 2)
        }
    }

    private var paymentsBlock: some View {
        VStack(spacing: 3) {
            ForEach(Array(r.payments.enumerated()), id: \.offset) { _, p in row(p.label, NT.yen(p.amount)) }
            if let t = r.tendered {
                row("預り金", NT.yen(t))
                row("お釣り", NT.yen(r.change ?? 0))
            }
            if r.refundTotal > 0 {
                row("返金", "-\(NT.yen(r.refundTotal))", color: NT.danger)
                HStack {
                    Text("実質お支払い額")
                    Spacer()
                    Text(NT.yen(r.netPaid))
                }
                .font(f(13, .bold))
            }
        }
    }

    private var pointsBlock: some View {
        VStack(spacing: 2) {
            if let u = r.pointsUsed, u != 0 { small("ポイント利用", "-\(u)pt") }
            if let e = r.pointsEarned, e != 0 { small("ポイント付与", "+\(e)pt") }
            if let b = r.pointBalance { small("ポイント残高", "\(b)pt") }
        }
    }

    private func row(_ label: String, _ value: String, color: Color? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).lineLimit(1)
            Spacer(minLength: 6)
            Text(value)
        }
        .font(f(12))
        .foregroundColor(color ?? paperInk)
    }

    private func small(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
        }
        .font(f(10)).foregroundColor(Color(hex: 0x6B7280))
    }
}

enum NRFormat {
    static func qty(_ q: Double) -> String { q == q.rounded() ? String(Int(q)) : String(format: "%.1f", q) }
    static func rate(_ r: Double) -> String { r == r.rounded() ? String(Int(r)) : String(r) }
}

// MARK: - 紙の領収書（印字と同じ座標を描く。lib/classic-invoice.ts の classicInvoiceLayout）

struct NRInvoiceCanvas: View {
    let layout: NRcptPayload.Layout

    var body: some View {
        let w = CGFloat(max(1, layout.width))
        let h = CGFloat(max(1, layout.height))
        Canvas { context, size in
            let s = size.width / w
            for it in layout.items {
                let x = CGFloat(it.x) * s
                let y = CGFloat(it.y) * s
                switch it.kind {
                case "text":
                    let font = Font.system(size: max(1, CGFloat(it.size) * s), weight: it.bold ? .bold : .regular)
                    let anchor: UnitPoint = it.align == "right" ? .topTrailing : it.align == "center" ? .top : .topLeading
                    context.draw(Text(it.text).font(font).foregroundColor(Color(hex: 0x1F2329)), at: CGPoint(x: x, y: y), anchor: anchor)
                case "line":
                    var p = Path()
                    p.move(to: CGPoint(x: x, y: y))
                    p.addLine(to: CGPoint(x: x + CGFloat(it.w) * s, y: y))
                    context.stroke(p, with: .color(Color(hex: 0x555555)), lineWidth: max(0.5, s))
                default:
                    let rect = CGRect(x: x, y: y, width: CGFloat(it.w) * s, height: CGFloat(it.h) * s)
                    context.stroke(Path(rect), with: .color(Color(hex: 0x888888)), style: StrokeStyle(lineWidth: max(0.5, s), dash: [4 * s, 4 * s]))
                }
            }
        }
        .aspectRatio(w / h, contentMode: .fit)
        .accessibilityLabel("領収書")
    }
}

/// 白い紙に載せた領収書（下に小さく押印の注記）
struct NRInvoicePaper: View {
    let invoice: NRcptPayload.Invoice

    var body: some View {
        VStack(spacing: 6) {
            NRInvoiceCanvas(layout: invoice.layout)
            Text(invoice.noStampNote).font(.system(size: 10)).foregroundColor(Color(hex: 0x6B7280)).frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.white).shadow(color: Color.black.opacity(0.12), radius: 8, x: 0, y: 3))
    }
}

// MARK: - 共通の部品（タブ・発行済みの案内）

struct NRTabSwitch: View {
    @Binding var tab: NRTab
    var height: CGFloat = 44

    var body: some View {
        HStack(spacing: 6) {
            chip("レシート", "Receipt", .receipt)
            chip("領収書", "Receipt for expenses", .invoice)
        }
        .padding(4)
        .background(Capsule().fill(NT.lilac))
    }

    private func chip(_ ja: String, _ en: String, _ t: NRTab) -> some View {
        let on = tab == t
        return Button { tab = t } label: {
            VStack(spacing: 0) {
                Text(ja).font(.system(size: 15, weight: NT.strong))
                Text(en).font(.system(size: 9.5, weight: .bold)).opacity(0.75).lineLimit(1)
            }
            .foregroundColor(on ? .white : NT.purpleDeep)
            .frame(maxWidth: .infinity).frame(height: height)
            .background(Capsule().fill(on ? NT.topBar : Color.clear))
        }
        .buttonStyle(PressableStyle())
    }
}

/// 領収書 発行済み（一度きり。Web と同じ字）
struct NRIssuedNotice: View {
    let atLabel: String
    let count: Int
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("領収書 発行済み\(atLabel.isEmpty ? "" : "（\(atLabel)\(count > 1 ? "・\(count)枚" : "")）")")
                .font(.system(size: 14, weight: NT.strong))
            Text("\(message)。二重発行を防ぐため、再発行はできません。").font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundColor(Color(hex: 0x7A4B00))
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: 0xFFF7E6)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0xF3C56B), lineWidth: 1))
    }
}

// MARK: - iPad の画面

struct NativeReceiptView: View {
    @ObservedObject var model: NativeReceiptModel
    let onBack: () -> Void

    @State private var ryoshushoOpen = false

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.storeName ?? "", title: "レシート", subtitle: subtitle, onHome: onBack, backIcon: model.fromOrders ? "chevron.left" : "house.fill")
            if let p = model.payload {
                HStack(spacing: 0) {
                    paperArea(p)
                    sidePanel(p).frame(width: 360)
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 12) {
                        Image(systemName: "doc.text.magnifyingglass").font(.system(size: 34)).foregroundColor(NT.ink3)
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                        HStack(spacing: 10) {
                            Button("もう一度") { Task { await model.load() } }.buttonStyle(.borderedProminent)
                            Button(model.fromOrders ? "伝票明細へ戻る" : "ホームへ戻る", action: onBack).buttonStyle(.bordered)
                        }
                    }
                    .padding(30)
                } else {
                    ProgressView("読み込み中…").tint(NT.purple)
                }
                Spacer()
            }
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text(e).multilineTextAlignment(.leading)
                        Spacer()
                        Image(systemName: "xmark")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger)
                    .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NT.dangerBg)).frame(maxWidth: 720)
                }
                .buttonStyle(.plain).padding(.top, 74)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NT.topBar.opacity(0.92))).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .sheet(isPresented: $ryoshushoOpen) {
            if let p = model.payload {
                NSRyoshushoSheet(orderId: p.orderId, orderNo: Int(p.orderNo) ?? 0, amount: p.invoice.amount, onClose: { ryoshushoOpen = false }, send: { body in
                    await model.sendRyoshusho(body)
                })
                .environment(\.colorScheme, .light)
            }
        }
        .task { await model.load() }
    }

    private var subtitle: String {
        if let p = model.payload { return "Receipt ・ 伝票 No.\(p.orderNo)" }
        return "Receipt"
    }

    // 左：紙（レシート＝80mm の幅・領収書＝横長）
    private func paperArea(_ p: NRcptPayload) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                if model.tab == .receipt {
                    NRReceiptPaper(r: p.receipt).frame(width: 340)
                } else {
                    NRInvoicePaper(invoice: p.invoice).frame(maxWidth: 820)
                    Text("宛名は発行のときに入れます（空欄なら手書き用の空欄）").font(.system(size: 12)).foregroundColor(NT.ink3)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28).padding(.vertical, 26)
        }
        .refreshable { await model.load() }
        .background(Color(hex: 0xE6E9EF))
    }

    // 右：タブ・伝票の要約・操作
    private func sidePanel(_ p: NRcptPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                NRTabSwitch(tab: $model.tab, height: 46)
                summary(p)
                if model.tab == .receipt { receiptActions(p) } else { invoiceActions(p) }
            }
            .padding(18)
        }
        .background(Color.white)
        .overlay(alignment: .leading) { Rectangle().fill(NT.line).frame(width: 1) }
    }

    private func summary(_ p: NRcptPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "fork.knife").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                Text(p.receipt.tableName ?? "—").font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                Spacer()
                statusBadge(p.status)
            }
            Text(NT.yen(p.receipt.total)).font(.system(size: 30, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
            if p.receipt.refundTotal > 0 {
                Text("返金 −\(NT.yen(p.receipt.refundTotal))　実質 \(NT.yen(p.receipt.netPaid))").font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
            }
            kv("伝票番号", "No.\(p.receipt.orderNo)")
            kv("会計日時", p.receipt.completedAt ?? "—")
            if let s = p.receipt.staffName, !s.isEmpty { kv("担当", s) }
            kv("支払", p.receipt.payments.map(\.label).joined(separator: "・").isEmpty ? "—" : p.receipt.payments.map(\.label).joined(separator: "・"))
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
    }

    private func kv(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
            Spacer()
            Text(v).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
        }
    }

    private func statusBadge(_ s: String) -> some View {
        let (label, color) = nosSlipStatus(s)
        return Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(color)
            .padding(.horizontal, 9).padding(.vertical, 3).background(Capsule().fill(color.opacity(0.12)))
    }

    @ViewBuilder private func receiptActions(_ p: NRcptPayload) -> some View {
        if p.canPrint {
            bigButton(model.busy ? "印刷中…" : "レシートを再印刷", sub: "Reprint receipt", icon: "printer", filled: true) {
                Task { await model.printReceipt() }
            }
            .disabled(model.busy)
            hint("お店のレシートプリンターから出ます（「※再発行」の印字）。")
            if !p.printerReady {
                hint("レシートプリンター（CloudPRNT）が登録されていません。設定 › プリンター で確かめてください。", color: NT.warn)
            }
        } else {
            hint("未会計の伝票です。会計が済むとレシートを印刷できます。")
        }
    }

    @ViewBuilder private func invoiceActions(_ p: NRcptPayload) -> some View {
        if model.ryoshushoIssued {
            NRIssuedNotice(atLabel: p.ryoshusho.atLabel, count: p.ryoshusho.count, message: p.ryoshusho.message)
        } else if p.canRyoshusho {
            bigButton("領収書を発行", sub: "宛名・但し書き・分けて発行", icon: "doc.text", filled: true) { ryoshushoOpen = true }
            hint("領収書は一度しか発行できません。領収額 \(NT.yen(p.invoice.amount))（内消費税 \(NT.yen(p.invoice.tax))）")
        } else {
            hint(p.status == "paid" ? "取消（VOID）のある伝票は領収書を発行できません。" : "会計済みの伝票だけ領収書を発行できます。")
        }
        if let note = p.invoice.invoiceNote { hint(note) }
    }

    private func bigButton(_ title: String, sub: String, icon: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 19, weight: .bold))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 17, weight: NT.strong))
                    Text(sub).font(.system(size: 11, weight: .bold)).opacity(0.8)
                }
                Spacer()
            }
            .foregroundColor(filled ? .white : NT.purpleDeep)
            .padding(.horizontal, 16).frame(height: 62)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(filled ? NT.purple : NT.lilac))
        }
        .buttonStyle(PressableStyle())
    }

    private func hint(_ t: String, color: Color = NT.ink3) -> some View {
        Text(t).font(.system(size: 12.5, weight: .semibold)).foregroundColor(color).fixedSize(horizontal: false, vertical: true)
    }
}

/// key "receipt" の画面（NativeModuleScreen から。iPad）
struct NativeReceiptScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NativeReceiptModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NativeReceiptModel(route: route))
    }

    var body: some View {
        NativeReceiptView(model: model, onBack: {
            // 伝票明細から開いた → その伝票の詳細（ネイティブの伝票明細）へ。それ以外はホーム（Web の戻り先と同じ考え）
            if model.fromOrders, !model.orderId.isEmpty {
                state.slipsOpenId = model.orderId
                state.goNativeSlips()
            } else {
                state.goNativeHome()
            }
        })
        .onChange(of: model.useWeb) { on in if on { state.nativeModule = nil } }
    }
}
