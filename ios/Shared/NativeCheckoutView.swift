import SwiftUI

/// ネイティブの会計画面。Web の会計画面と同じ3列：
///   左＝品目一覧・来店経路（booking source）／中＝金額（小計・値引き・お預り・残額・おつり・支払いの内訳）／右＝支払方法・値引・テンキー
/// 2026-10-13 Ronnie「左に注文の一覧、booking source も全部」
/// いまは見本のデータで形を確かめる段階。会計の確定はサーバー（Web と同じ処理）につなぐ。
struct NativeCheckoutView: View {
    @ObservedObject var model: NativeOrderModel
    let onClose: () -> Void
    /// 会計が終わって「閉じる」（ライブはオーダー画面も閉じて前の画面へ）
    var onFinished: () -> Void = {}

    enum Tab { case pay, discount }
    enum DiscountMode { case amount, percent }

    @State private var tab: Tab = .pay
    @State private var payments: [NPPaymentRow] = []
    @State private var activeId: UUID?
    /// 「ちょうど」を押したか（押す前は他のボタンと同じ色。押して残りが 0 のときだけ緑。2026-10-24 23:08 Ronnie「押した時だけ色を。間違える」）
    @State private var exactOn = false
    /// 支払方法を選ばずに数字・ちょうどを押した（勝手に現金にしない。現金も押した時だけ緑。2026-10-24 23:08 Ronnie）
    @State private var needMethodHint = false
    @State private var openMethod: NPPayMethod?
    @State private var memo = ""
    @State private var done = false
    @State private var splitting = false
    @State private var splitPick: [String: Int] = [:]
    /// 伝票分割で「分ける」（何人で分けるか）を開いている品
    @State private var divideFor: String?
    @State private var showMoreSources = false
    @State private var discountMode: DiscountMode = .amount
    @State private var discountInput = ""
    @State private var paying = false
    @State private var reprinting = false
    /// 決めておいた値引き（金額はレジで打つもの）の名前
    @State private var pendingReason: String?
    // stera（金額を端末へ送って決済）
    @State private var steraPick = false
    @State private var stera: SteraState?

    struct SteraState: Equatable {
        var requestId: String?
        var label: String
        var status: String   // starting / queued / sent / succeeded / failed / canceled / expired
        var message: String?
    }

    // MARK: 金額
    private var total: Int { model.total }
    private var nonCashPaid: Int { payments.filter { $0.method != .cash }.reduce(0) { $0 + $1.amount } }
    private var cashRow: NPPaymentRow? { payments.first { $0.method == .cash } }
    private var cashDue: Int { max(0, total - nonCashPaid) }
    private var cashApplied: Int { min(cashRow?.tendered ?? 0, cashDue) }
    private var tenderedTotal: Int { nonCashPaid + (cashRow?.tendered ?? 0) }
    private var remaining: Int { max(0, total - nonCashPaid - cashApplied) }
    private var change: Int { max(0, (cashRow?.tendered ?? 0) - cashDue) }
    /// 最新の金額を読み終わったか（保存してあった中身を先に出しているあいだは確定しない）
    private var fresh: Bool { !model.isLive || model.orderLoaded }
    private var canPay: Bool { fresh && !needsSource && (total == 0 || (remaining == 0 && !payments.isEmpty)) }
    /// 来店経路がまだ（予約の無い卓の伝票）。選ばないと会計できない（2026-10-24 Ronnie）
    private var needsSource: Bool { model.isLive && model.order.sourceRequired && model.order.visitSourceId == nil }

    var body: some View {
        VStack(spacing: 0) {
            header
            if done {
                doneView
            } else {
                GeometryReader { geo in
                    HStack(alignment: .top, spacing: 12) {
                        itemsColumn.frame(width: max(300, geo.size.width * 0.28))
                        amountColumn.frame(width: max(300, geo.size.width * 0.30))
                        rightColumn
                    }
                    .padding(12)
                }
            }
        }
        .background(NT.page.ignoresSafeArea())
        // 伝票分割は同じ画面の上に重ねる（Web の伝票分割と同じ2列。シートだと狭い）
        .overlay {
            if splitting {
                splitScreen.transition(.move(edge: .trailing))
            }
        }
        .animation(.easeOut(duration: 0.22), value: splitting)
        .overlay { if let st = stera { steraOverlay(st) } }
        .overlay(alignment: .top) {
            if let n = model.notice {
                Button { model.notice = nil } label: {
                    Text(n).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger)
                        .padding(14).frame(maxWidth: 720)
                        .background(RoundedRectangle(cornerRadius: 14).fill(NT.dangerBg))
                }
                .buttonStyle(.plain)
                .padding(.top, 74)
            }
        }
    }

    private func steraOverlay(_ st: SteraState) -> some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 16) {
                if ["failed", "canceled", "expired"].contains(st.status) {
                    Image(systemName: "xmark.octagon.fill").font(.system(size: 52)).foregroundColor(NT.danger)
                } else {
                    ProgressView().scaleEffect(1.6).tint(NT.purple)
                }
                Text("stera · \(st.label)").font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                Text(NT.yen(total)).font(.system(size: 40, weight: .heavy)).foregroundColor(NT.purple)
                if let msg = st.message {
                    Text(msg).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
                }
                HStack(spacing: 12) {
                    if ["failed", "canceled", "expired"].contains(st.status) {
                        Button("閉じる") { stera = nil }
                            .font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                            .frame(width: 180, height: 52).background(RoundedRectangle(cornerRadius: 12).fill(NT.purple))
                    } else {
                        Button("キャンセル") { cancelStera() }
                            .font(.system(size: 17, weight: .bold)).foregroundColor(NT.danger)
                            .frame(width: 180, height: 52).background(RoundedRectangle(cornerRadius: 12).fill(NT.dangerBg))
                    }
                }
            }
            .padding(32)
            .frame(maxWidth: 460)
            .background(RoundedRectangle(cornerRadius: 22).fill(NT.card))
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("お会計").font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
            Text(model.order.tableName).font(.system(size: 22, weight: .heavy)).foregroundColor(Color(hex: 0xC9B6F5))
            Text(verbatim: model.order.noLabel).font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.6))
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Color.white.opacity(0.12)))
            }
        }
        .padding(.horizontal, 20).frame(height: 64)
        .background(NT.topBar)
    }

    // MARK: - 左：品目一覧・来店経路

    private var itemsColumn: some View {
        VStack(spacing: 0) {
            HStack {
                Text("明細").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(verbatim: "\(model.itemCount)品").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(model.order.lines) { l in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.displayName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                if let opts = l.optionLabel {
                                    Text(opts).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 4)
                            Text(verbatim: "×\(l.quantity)").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2)
                                .frame(width: 40, alignment: .trailing)
                            Text(NT.yen(l.lineTotal)).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                                .frame(width: 84, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        Divider().overlay(NT.line).padding(.leading, 16)
                    }
                }
            }
            if model.unsentCount > 0 {
                Text("厨房へ未送信の品目が \(model.unsentCount) 品あります。会計を確定すると同時に厨房へ送信されます。")
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(Color(hex: 0x8A5A00))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color(hex: 0xFFF6E0))
            }
            Divider().overlay(NT.line)
            sourcesBlock
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    /// 来店経路（booking source）。全部の経路から1つ選ぶ（売上の集計で使う）
    private var sourcesBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("来店経路").font(.system(size: 14, weight: .heavy)).foregroundColor(needsSource ? NT.danger : NT.ink)
                if needsSource {
                    Text("必須・選んでください").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(NT.danger))
                }
                Spacer()
                Button(showMoreSources ? "閉じる" : "もっと見る ＋") { withAnimation(.easeOut(duration: 0.15)) { showMoreSources.toggle() } }
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
            }
            let sources = showMoreSources ? model.visitSources + NPVisitSource.extras.filter { e in !model.visitSources.contains(e) } : model.visitSources
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 6)], spacing: 6) {
                ForEach(sources) { s in
                    let on = model.order.visitSourceId == s.id
                    Button {
                        Task { await model.setVisitSource(on ? nil : s.id) }
                    } label: {
                        // 各社の色（ホットペッパー＝赤、食べログ＝黄…）。選ぶとその色で塗る
                        VStack(spacing: 0) {
                            Text(s.label).font(.system(size: 13, weight: .bold))
                            if s.english != s.label { Text(s.english).font(.system(size: 9, weight: .semibold)).opacity(0.8) }
                        }
                            .lineLimit(1).minimumScaleFactor(0.7)
                            // 白の上で黄色（食べログ）は読みにくいので濃い黄土色に
                            .foregroundColor(on ? (s.darkText ? NT.ink : .white) : (s.darkText ? Color(hex: 0xA67C00) : s.color))
                            .frame(maxWidth: .infinity, minHeight: 42)
                            // 選ぶ前は白（ピンクなどのうすい色はやめる。2026-10-24 23:16 Ronnie）。選ぶと各社の色で塗る
                            .background(RoundedRectangle(cornerRadius: 10).fill(on ? s.color : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? Color.clear : Color(hex: 0xDCE3EF), lineWidth: 1))
                            .shadow(color: Color.black.opacity(on ? 0.12 : 0.04), radius: on ? 4 : 2, y: 1)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .padding(14)
        // 地はごくうすいネイビー（赤っぽいピンクはやめる。2026-10-24 23:14 Ronnie「うすいネイビー、すごく明るく」）。必須は赤いチップで分かる
        .background(Color(hex: 0xEEF2F9))
        .overlay(alignment: .top) { Rectangle().fill(Color(hex: 0xDCE3EF)).frame(height: 1) }
    }

    // MARK: - 中：金額

    private var amountColumn: some View {
        VStack(spacing: 0) {
            HStack {
                Text("金額").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)
            ScrollView {
                VStack(spacing: 8) {
                    Button {
                        splitPick = [:]
                        divideFor = nil
                        splitting = true
                    } label: {
                        VStack(spacing: 1) {
                            Text("別々会計").font(.system(size: 15, weight: .bold))
                            Text("Separate payment").font(.system(size: 10, weight: .semibold)).opacity(0.7)
                        }
                        .foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1.5))
                    }
                    .buttonStyle(PressableStyle())
                    // 品が2つ以上、または分けられる品（¥0 でない）があるときだけ（Web の canSplit と同じ）
                    .disabled(!model.isLive || !canSplit || stera != nil)
                    .opacity(!model.isLive || !canSplit ? 0.4 : 1)
                    .padding(.bottom, 4)

                    sumRow("小計", NT.yen(model.subtotal))
                    if model.order.serviceCharge > 0 { sumRow("サービス料", NT.yen(model.order.serviceCharge), small: true) }
                    sumRow(model.order.discountReason.map { "値引き・クーポン（\($0)）" } ?? "値引き・クーポン",
                           model.order.discountTotal > 0 ? "-\(NT.yen(model.order.discountTotal))" : NT.yen(0),
                           color: model.order.discountTotal > 0 ? NT.warn : NT.ink2)
                    dashed
                    HStack(alignment: .lastTextBaseline) {
                        Text("お支払い金額").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                        Spacer()
                        Text(NT.yen(total)).font(.system(size: 36, weight: .heavy)).foregroundColor(NT.purple)
                    }
                    sumRow("内消費税", NT.yen(model.tax), small: true)
                    dashed
                    sumRow("お預り", NT.yen(tenderedTotal))
                    HStack(alignment: .lastTextBaseline) {
                        Text("残額").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2)
                        Spacer()
                        Text(NT.yen(remaining)).font(.system(size: 26, weight: .heavy)).foregroundColor(remaining == 0 ? NT.ok : NT.warn)
                    }
                    HStack(alignment: .lastTextBaseline) {
                        Text("おつり").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2)
                        Spacer()
                        Text(NT.yen(change)).font(.system(size: 26, weight: .heavy)).foregroundColor(NT.ok)
                    }

                    if !payments.isEmpty {
                        VStack(spacing: 6) {
                            ForEach(payments) { p in
                                let active = p.id == activeId
                                HStack(spacing: 8) {
                                    Text(p.title).font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                                        .padding(.horizontal, 8).padding(.vertical, 4)
                                        .background(Capsule().fill(NT.header))
                                    Spacer()
                                    Text(NT.yen(p.method == .cash ? p.tendered : p.amount))
                                        .font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink)
                                    Button { remove(p) } label: {
                                        Image(systemName: "trash").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink3)
                                            .frame(width: 32, height: 32)
                                    }
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(RoundedRectangle(cornerRadius: 12).fill(active ? NT.lilac : Color(hex: 0xFBF9F5)))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(active ? NT.purple : Color.clear, lineWidth: 1.5))
                                .onTapGesture { activeId = p.id }
                            }
                        }
                        .padding(.top, 6)
                    }
                }
                .padding(16)
            }
            Divider().overlay(NT.line)
            VStack(alignment: .leading, spacing: 4) {
                Text("会計メモ（任意）").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                TextField("例）カード払いのつもりで現金で受け取った", text: $memo)
                    .font(.system(size: 14))
                    .padding(.horizontal, 10).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(NT.lilacLine, lineWidth: 1))
            }
            .padding(12)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    private var dashed: some View {
        Rectangle().fill(Color.clear).frame(height: 1)
            .overlay(Rectangle().stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 4])).foregroundColor(NT.lilacLine))
            .padding(.vertical, 4)
    }

    private func sumRow(_ label: String, _ value: String, small: Bool = false, color: Color = NT.ink2) -> some View {
        HStack {
            Text(label).font(.system(size: small ? 13 : 15, weight: .medium)).foregroundColor(small ? NT.ink3 : color)
            Spacer()
            Text(value).font(.system(size: small ? 13 : 16, weight: .bold)).foregroundColor(small ? NT.ink3 : color)
        }
        .padding(.leading, small ? 12 : 0)
    }

    // MARK: - 右：支払方法・値引・テンキー

    private var rightColumn: some View {
        VStack(spacing: 10) {
            // 支払 / 値引
            HStack(spacing: 0) {
                tabButton("支払", "支払", .pay)
                tabButton("値引", "値引", .discount)
            }
            .background(RoundedRectangle(cornerRadius: 12).fill(NT.lilac))

            if tab == .pay { payPanel } else { discountPanel }

            Spacer(minLength: 0)
            if showSteraButton, let m = openMethod {
                Button { steraPick = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "creditcard.and.123")
                        VStack(spacing: 0) {
                            Text("stera で決済 \(NT.yen(total))")
                            Text("Pay with stera").font(.system(size: 11, weight: .bold)).opacity(0.8)
                        }
                    }
                    .font(.system(size: 18, weight: .heavy)).foregroundColor(NT.purple)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NT.purple, lineWidth: 1.5))
                }
                .buttonStyle(PressableStyle())
                .confirmationDialog("stera：お客様の支払方法は？", isPresented: $steraPick, titleVisibility: .visible) {
                    ForEach(steraTypes(for: m), id: \.code) { t in
                        Button(t.label) { startStera(t) }
                    }
                    Button("キャンセル", role: .cancel) {}
                }
            }
            Button(action: pay) {
                Text(paying ? "処理中…" : !fresh ? "最新の金額を確認中…" : needsSource ? "来店経路を選択してください" : canPay ? "お会計を確定 \(NT.yen(total))" : "残額 \(NT.yen(remaining)) の支払方法を選択")
                    .font(.system(size: 20, weight: .heavy)).foregroundColor(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, minHeight: 68)
                    // 「お会計を確定」はレジ会計の緑（2026-10-24 21:36・21:42 Ronnie）
                    .background(RoundedRectangle(cornerRadius: 16).fill(canPay ? NT.pay : NT.pay.opacity(0.35)))
            }
            .buttonStyle(PressableStyle())
            .disabled(!canPay || paying)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    private func tabButton(_ title: String, _ en: String, _ t: Tab) -> some View {
        Button { tab = t } label: {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 16, weight: .heavy))
                Text(en).font(.system(size: 11, weight: .bold)).opacity(0.7)
            }
            .foregroundColor(tab == t ? .white : NT.ink2)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(tab == t ? NT.purple : Color.clear))
            .padding(3)
        }
        .buttonStyle(PressableStyle())
    }

    private var payPanel: some View {
        VStack(spacing: 10) {
            // オフラインは現金だけ（カード・QR・ポイントはネットが戻ってから。2026-10-24 Ronnie）
            let methods: [NPPayMethod] = model.offline ? [.cash] : [.cash, .credit, .qr, .emoney, .external, .other, .sitePoints, .points]
            if model.offline {
                Text("オフラインです：現金の会計だけできます（レシートはこの iPad から。ネットが戻ると自動で送ります）")
                    .font(.system(size: 13, weight: .bold)).foregroundColor(Color(hex: 0xC62828))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xFDECEC)))
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(methods) { m in
                    let on = payments.contains { $0.method == m } || openMethod == m
                    Button { tapMethod(m) } label: {
                        // 支払方法ごとの色（現金＝緑、クレジット＝青…）。選ぶとその色で塗る
                        VStack(spacing: 4) {
                            Image(systemName: m.icon).font(.system(size: 20, weight: .semibold)).foregroundColor(on ? .white : m.color)
                            Text(m.label).font(.system(size: 13, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                            Text(m.english).font(.system(size: 9, weight: .semibold)).opacity(0.7).lineLimit(1)
                        }
                        .foregroundColor(on ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 74)
                        .background(RoundedRectangle(cornerRadius: 12).fill(on ? m.color : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Color.clear : m.color.opacity(0.35), lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(needMethodHint ? 4 : 0)
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color(hex: 0xE53935), lineWidth: needMethodHint ? 2.5 : 0))

            if needMethodHint {
                HStack(spacing: 6) {
                    Image(systemName: "hand.point.up.left.fill")
                    Text("先に支払方法（現金・クレジット・QR…）を押してください")
                }
                .font(.system(size: 14, weight: .heavy)).foregroundColor(Color(hex: 0xC62828))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10).background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xFDECEC)))
                .transition(.opacity)
            }
            // 内訳（クレジット→VISA…、QR→PayPay…、サイトポイント→ホットペッパー…）。各社の色で
            if let m = openMethod, m != .external, !brands(m).isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(m == .sitePoints ? "どのサイトのポイント？ / Which site" : "\(m.label)の種類 / \(m.english) type")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    // 各社の名前を白いカードに並べる（ロゴのように。店が設定で選んだものだけ。2026-10-24 22:35 Ronnie）
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        ForEach(brands(m)) { b in
                            let on = payments.contains { $0.method == m && $0.brand == b }
                            Button { addRow(m, brand: b) } label: { NPBrandTile(brand: b, fallback: m.color, on: on) }
                                .buttonStyle(PressableStyle())
                        }
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1))
            }
            // 外部端末：つないである端末（stera など）を出す。無ければ追加へ（2026-10-24 Ronnie）
            if openMethod == .external { externalPanel }

            keypad(onKey: keyForPayment, quick: [
                ("ちょうど", "Exact", { setActive(exact: true) }),
                ("¥1,000", nil, { bump(1000) }),
                ("¥5,000", nil, { bump(5000) }),
                ("¥10,000", nil, { bump(10000) }),
            ])
        }
    }

    private var discountPanel: some View {
        VStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text("値引き・クーポン").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 6)], spacing: 6) {
                    ForEach(model.discountPresets) { p in
                        Button {
                            switch p.kind {
                            case .amount: Task { await model.setDiscount(amount: p.value, reason: p.name) }
                            case .percent: Task { await model.setDiscount(amount: model.itemsTotal * p.value / 100, reason: p.name) }
                            case .manual:
                                // 金額はレジで打つ（「幹事様無料」など）
                                pendingReason = p.name
                                discountMode = .amount
                                discountInput = ""
                            }
                        } label: {
                            VStack(spacing: 0) {
                                Text(p.name).font(.system(size: 14, weight: .bold))
                                if p.english != p.name { Text(p.english).font(.system(size: 9, weight: .semibold)).opacity(0.8) }
                            }
                            .foregroundColor(NT.purple)
                                .frame(maxWidth: .infinity, minHeight: 42)
                                .background(RoundedRectangle(cornerRadius: 10).fill(NT.lilac))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            HStack(spacing: 8) {
                modeButton("金額（¥）", .amount)
                modeButton("割合（%）", .percent)
            }
            HStack {
                Text(discountMode == .amount ? "値引き額" : "値引き率").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(discountInput.isEmpty ? "—" : (discountMode == .amount ? NT.yen(Int(discountInput) ?? 0) : "\(discountInput)%"))
                    .font(.system(size: 26, weight: .heavy)).foregroundColor(NT.ink)
            }
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xFBF9F5)))
            keypad(onKey: keyForDiscount, quick: [
                ("値引きする", "Apply", applyDiscount),
                ("値引き解除", "Remove", { discountInput = ""; pendingReason = nil; Task { await model.setDiscount(amount: 0, reason: "") } }),
            ])
        }
    }

    private func modeButton(_ title: String, _ m: DiscountMode) -> some View {
        Button { discountMode = m; discountInput = "" } label: {
            Text(title).font(.system(size: 14, weight: .bold))
                .foregroundColor(discountMode == m ? .white : NT.ink2)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(discountMode == m ? NT.header : NT.lilac))
        }
        .buttonStyle(PressableStyle())
    }

    private func keypad(onKey: @escaping (String) -> Void, quick: [(String, String?, () -> Void)]) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                // 大きめのボタン・大きめの字、「ちょうど」は緑（2026-10-24 Ronnie「alli thulo、exact lai green」）
                ForEach(Array(quick.enumerated()), id: \.offset) { _, q in
                    let exact = q.1 == "Exact" && exactOn && remaining == 0 && !payments.isEmpty
                    Button(action: q.2) {
                        VStack(spacing: 1) {
                            Text(q.0).font(.system(size: 20, weight: .heavy))
                            if let en = q.1 { Text(en).font(.system(size: 12, weight: .bold)).opacity(0.8) }
                        }
                        .foregroundColor(exact ? .white : NT.purple)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(exact ? NT.ok : NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            let keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "⌫"]
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(keys, id: \.self) { k in
                    Button { onKey(k) } label: {
                        Group {
                            if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) }
                        }
                        .font(.system(size: 24, weight: .bold)).foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xFBF9F5)))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle(scale: 0.93))
                }
            }
        }
    }

    // MARK: - 操作

    /// 支払方法の内訳（店の設定。無ければ既定）
    /// 外部端末：つないである決済端末（stera）と、店で登録した端末の名前。無ければ「端末を追加」
    private var externalPanel: some View {
        let c = NPPayMethod.external.color
        let terminals = model.steraTerminals
        let named = brands(.external)
        return VStack(alignment: .leading, spacing: 6) {
            Text("どの端末で / Which terminal")
                .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            if terminals.isEmpty && named.isEmpty {
                Text("端末が登録されていません / No terminal")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
                Button { model.openInWeb(path: "/app/settings/payments") } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus.circle.fill")
                        Text("端末を追加 / Add terminal")
                    }
                    .font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .background(RoundedRectangle(cornerRadius: 10).fill(c))
                }
                .buttonStyle(PressableStyle())
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(terminals, id: \.id) { t in
                        // provider（支払の内訳）には端末の名前を残す（40字まで。Web の「外部端末」の内訳と同じ）
                        let b = NPBrand(id: String(t.name.prefix(40)), name: t.name)
                        let on = payments.contains { $0.method == .external && $0.brand == b }
                        Button { addRow(.external, brand: b) } label: {
                            // stera はつながっていると自動で出る（緑の点＝いま使える）
                            NPBrandTile(brand: NPBrand(id: "stera", name: t.name), fallback: Color(hex: 0x0B6E6E), on: on)
                                .overlay(alignment: .topLeading) {
                                    HStack(spacing: 4) {
                                        Circle().fill(t.online ? Color(hex: 0x1E8F62) : NT.ink3).frame(width: 8, height: 8)
                                        Text(t.online ? "接続中" : "未接続").font(.system(size: 9, weight: .bold))
                                    }
                                    .foregroundColor(on ? .white : NT.ink3).padding(6)
                                }
                        }
                        .buttonStyle(PressableStyle())
                    }
                    ForEach(named) { b in
                        let on = payments.contains { $0.method == .external && $0.brand == b }
                        Button { addRow(.external, brand: b) } label: { NPBrandTile(brand: b, fallback: c, on: on) }
                            .buttonStyle(PressableStyle())
                    }
                    Button { model.openInWeb(path: "/app/settings/payments") } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus")
                            Text("追加 / Add")
                        }
                        .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        .frame(maxWidth: .infinity, minHeight: 62)
                        .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1))
    }

    private func brands(_ m: NPPayMethod) -> [NPBrand] {
        if m == .sitePoints { return model.pointBrands.isEmpty ? NPBrands.sitePoints : model.pointBrands }
        if let set = model.methodBrands[m.rawValue], !set.isEmpty { return set }
        return NPBrands.of(m)
    }

    private func tapMethod(_ m: NPPayMethod) {
        if m == .external || !brands(m).isEmpty {
            openMethod = (openMethod == m) ? nil : m
            return
        }
        openMethod = nil
        addRow(m, brand: nil)
    }

    private func addRow(_ m: NPPayMethod, brand: NPBrand?) {
        if let existing = payments.first(where: { $0.method == m && $0.brand == brand }) {
            activeId = existing.id
            return
        }
        var row = NPPaymentRow(method: m, brand: brand, amount: 0)
        if m != .cash { row.amount = remaining }
        payments.append(row)
        activeId = row.id
    }

    private func remove(_ p: NPPaymentRow) {
        exactOn = false
        payments.removeAll { $0.id == p.id }
        if activeId == p.id { activeId = payments.last?.id }
    }

    @discardableResult
    private func updateActive(_ f: (inout NPPaymentRow) -> Void) -> Bool {
        if activeId == nil || !payments.contains(where: { $0.id == activeId }) {
            // 何も選んでいなければ勝手に現金にしない（間違いのもと）。先に支払方法を押してもらう
            showMethodHint()
            return false
        }
        guard let i = payments.firstIndex(where: { $0.id == activeId }) else { return false }
        f(&payments[i])
        return true
    }

    private func showMethodHint() {
        withAnimation(.easeOut(duration: 0.15)) { needMethodHint = true }
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { withAnimation { needMethodHint = false } }
    }

    private func keyForPayment(_ k: String) {
        exactOn = false
        updateActive { row in
            var digits = String(row.method == .cash ? row.tendered : row.amount)
            if digits == "0" { digits = "" }
            if k == "⌫" { digits = String(digits.dropLast()) } else if digits.count < 7 { digits += k }
            let v = Int(digits) ?? 0
            if row.method == .cash { row.tendered = v } else { row.amount = v }
        }
    }

    private func setActive(exact: Bool) {
        let due = cashDue
        let rest = remaining
        exactOn = updateActive { row in
            if row.method == .cash { row.tendered = due } else { row.amount += rest }
        }
    }

    private func bump(_ yen: Int) {
        exactOn = false
        updateActive { row in
            if row.method == .cash { row.tendered += yen } else { row.amount += yen }
        }
    }

    private func keyForDiscount(_ k: String) {
        if k == "⌫" { discountInput = String(discountInput.dropLast()); return }
        if discountInput.count >= (discountMode == .percent ? 3 : 7) { return }
        if discountInput.isEmpty && (k == "0" || k == "00") { return }
        discountInput += k
    }

    private func applyDiscount() {
        let v = Int(discountInput) ?? 0
        guard v > 0 else { return }
        let amount: Int
        let reason: String
        if discountMode == .amount {
            amount = min(v, model.itemsTotal)
            reason = pendingReason ?? "値引き"
        } else {
            let p = min(100, v)
            amount = model.itemsTotal * p / 100
            reason = pendingReason.map { "\($0)（\(p)%）" } ?? "\(p)%値引き"
        }
        discountInput = ""
        pendingReason = nil
        tab = .pay
        Task { await model.setDiscount(amount: amount, reason: reason) }
    }

    // MARK: - 会計を確定

    private func pay() {
        guard canPay, !paying else { return }
        paying = true
        let rows = payments
        let due = cashDue
        let note = memo
        Task {
            let ok = await model.checkout(payments: rows, cashDue: due, memo: note)
            paying = false
            if ok { withAnimation(.easeOut(duration: 0.2)) { done = true } }
        }
    }

    // MARK: - stera（金額を端末へ送って決済。Web のレジと同じ流れ）

    private var steraMethods: Set<NPPayMethod> { [.credit, .qr, .emoney] }
    private var showSteraButton: Bool {
        model.isLive && !model.offline && !model.steraTerminals.isEmpty && (openMethod.map { steraMethods.contains($0) } ?? false)
    }

    private func steraTypes(for m: NPPayMethod) -> [APISteraType] {
        model.steraTypes.filter { $0.method == m.rawValue }
    }

    private func startStera(_ t: APISteraType) {
        guard let orderId = model.orderId else { return }
        let terminal = model.steraTerminals.first(where: { $0.online }) ?? model.steraTerminals.first
        guard let terminal else { return }
        stera = SteraState(requestId: nil, label: t.label, status: "starting", message: "stera に金額を送っています…")
        Task {
            do {
                let r = try await NativeAPI.shared.act(["type": "steraStart", "orderId": orderId, "terminalId": terminal.id, "paymentType": t.code], throwOnFail: false)
                if !r.ok {
                    stera?.status = "failed"
                    stera?.message = r.error ?? "stera に送れませんでした"
                    return
                }
                if r.finalized == true { steraDone(r); return }
                stera?.requestId = r.requestId
                stera?.status = r.status ?? "queued"
                stera?.message = "\(terminal.name) でお客様にお支払いいただいてください"
                await pollStera()
            } catch {
                stera?.status = "failed"
                stera?.message = error.localizedDescription
            }
        }
    }

    private func pollStera() async {
        while let s = stera, let id = s.requestId, ["queued", "sent", "succeeded"].contains(s.status) {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard stera?.requestId == id else { return }
            guard let r = try? await NativeAPI.shared.act(["type": "steraCheck", "requestId": id], throwOnFail: false) else { continue }
            if r.finalized == true { steraDone(r); return }
            if let st = r.status { stera?.status = st }
            if !r.ok || ["failed", "canceled", "expired"].contains(r.status ?? "") {
                stera?.status = r.status ?? "failed"
                stera?.message = r.error ?? "決済に失敗しました"
                return
            }
        }
    }

    private func steraDone(_ r: APIResult) {
        stera = nil
        guard let orderId = model.orderId else { return }
        // ドロア（キャッシュレスは店の設定しだい）
        Task {
            _ = try? await NativeAPI.shared.act(["type": "drawer", "orderId": orderId, "methods": [r.method ?? "credit"]], throwOnFail: false)
        }
        withAnimation(.easeOut(duration: 0.2)) { done = true }
    }

    private func cancelStera() {
        guard let id = stera?.requestId else { stera = nil; return }
        Task {
            let r = try? await NativeAPI.shared.act(["type": "steraCancel", "requestId": id], throwOnFail: false)
            if r?.ok == false {
                stera?.message = r?.error ?? "端末で決済中は取り消せません。端末側で完了または取消してください"
            } else {
                stera = nil
            }
        }
    }

    // MARK: - 伝票分割（別々会計。Web の checkout-dialog の splitScreen と同じ：左＝元の伝票、右＝分ける伝票）

    /// 分けられる品（サーバーの明細。カートは会計へ来る前に注文確定している）
    private var splitLines: [NPOrderLine] { model.order.lines.filter { !$0.local } }
    private var splitTotal: Int { splitLines.reduce(0) { $0 + (splitPick[$1.id] ?? 0) * $1.unitPrice } }
    private var splitCount: Int { splitPick.values.reduce(0, +) }
    /// 全部を選んだら分割にならない（元の伝票が空になる）
    private var splitIsAll: Bool { splitLines.allSatisfy { (splitPick[$0.id] ?? 0) >= $0.quantity } }
    /// 品が2つ以上ある、または分けられる品がある（1つの品を何人かで食べた）ときだけ別々会計できる
    private var canSplit: Bool {
        splitLines.reduce(0) { $0 + $1.quantity } >= 2 || splitLines.contains { $0.unitPrice > 0 }
    }

    private func pickSplit(_ line: NPOrderLine, _ delta: Int) {
        let next = min(line.quantity, max(0, (splitPick[line.id] ?? 0) + delta))
        if next == 0 { splitPick.removeValue(forKey: line.id) } else { splitPick[line.id] = next }
    }

    private func confirmSplit() {
        guard splitCount > 0, !splitIsAll, !model.busy else { return }
        let picks = splitPick
        Task {
            if await model.splitForCheckout(picks) {
                payments = []; activeId = nil; openMethod = nil; memo = ""
                splitPick = [:]
                divideFor = nil
                withAnimation(.easeOut(duration: 0.22)) { splitting = false }
            }
        }
    }

    private func divide(_ line: NPOrderLine, parts: Int) {
        Task {
            if await model.divide(line, parts: parts) {
                // 分けた品は数量が変わるので、選んでいた分は戻す（Web と同じ）
                splitPick.removeValue(forKey: line.id)
                divideFor = nil
            }
        }
    }

    private var splitScreen: some View {
        VStack(spacing: 0) {
            // 上のバー
            HStack(spacing: 12) {
                Button {
                    divideFor = nil
                    withAnimation(.easeOut(duration: 0.22)) { splitting = false }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                        Text("レジ会計")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.10)))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy)
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("伝票分割").font(.system(size: 20, weight: .heavy)).foregroundColor(.white)
                    Text("Split by item").font(.system(size: 12, weight: .bold)).foregroundColor(Color(hex: 0xC9B6F5))
                }
                Spacer()
                Text(model.order.tableName).font(.system(size: 18, weight: .heavy)).foregroundColor(Color(hex: 0xC9B6F5))
                Text(verbatim: model.order.noLabel).font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.6))
            }
            .padding(.horizontal, 20).frame(height: 64)
            .background(NT.topBar)

            HStack(alignment: .top, spacing: 0) {
                // 左：元の伝票に残る分
                splitColumn(
                    title: "伝票 \(model.order.noLabel)", sub: "元の伝票 / Stays", total: model.total - splitTotal, totalColor: NT.ink, strong: false
                ) {
                    ForEach(splitLines) { l in
                        let left = l.quantity - (splitPick[l.id] ?? 0)
                        if left > 0 {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(l.displayName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                        if let opts = l.optionLabel { Text(opts).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                                    }
                                    Spacer(minLength: 4)
                                    Text(verbatim: "×\(left)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                                    Text(NT.yen(l.unitPrice * left)).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                                        .frame(width: 84, alignment: .trailing)
                                    if l.unitPrice > 0 {
                                        // 1つの品を何人かで食べた → 人数分に分けて1人分ずつ移せるように
                                        Button { withAnimation(.easeOut(duration: 0.15)) { divideFor = divideFor == l.id ? nil : l.id } } label: {
                                            HStack(spacing: 3) {
                                                Image(systemName: "divide")
                                                Text("分ける")
                                            }
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundColor(divideFor == l.id ? .white : NT.purple)
                                            .padding(.horizontal, 8).frame(height: 36)
                                            .background(RoundedRectangle(cornerRadius: 9).fill(divideFor == l.id ? NT.purple : Color.white))
                                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(divideFor == l.id ? NT.purple : NT.lilacLine, lineWidth: 1))
                                        }
                                        .buttonStyle(PressableStyle())
                                        .disabled(model.busy)
                                    }
                                    moveButton("chevron.right") { pickSplit(l, 1) }
                                }
                                if divideFor == l.id {
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(spacing: 4) {
                                            Text(l.quantity > 1 ? "1つ（\(NT.yen(l.unitPrice))）を何人で分けますか？" : "何人で分けますか？")
                                                .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2)
                                            Text("How many people shared it?").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                                        }
                                        HStack(spacing: 6) {
                                            ForEach([2, 3, 4, 5, 6], id: \.self) { n in
                                                Button { divide(l, parts: n) } label: {
                                                    VStack(spacing: 0) {
                                                        Text("\(n)人").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                                                        Text("\(NT.yen((l.unitPrice + n - 1) / n))〜").font(.system(size: 10)).foregroundColor(NT.ink3)
                                                    }
                                                    .frame(minWidth: 64, minHeight: 44)
                                                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                                                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(NT.lilacLine, lineWidth: 1))
                                                }
                                                .buttonStyle(PressableStyle())
                                                .disabled(model.busy)
                                            }
                                            if model.busy { ProgressView().tint(NT.purple) }
                                        }
                                    }
                                    .padding(10)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(NT.lilac))
                                }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            Divider().overlay(NT.line).padding(.leading, 16)
                        }
                    }
                }

                // 真ん中の矢印
                VStack(spacing: 16) {
                    Image(systemName: "chevron.right")
                    Image(systemName: "chevron.left")
                }
                .font(.system(size: 30, weight: .bold)).foregroundColor(NT.ink3)
                .frame(width: 72).frame(maxHeight: .infinity)

                // 右：分けて先に会計する分
                splitColumn(title: "分ける伝票", sub: "この分を先に会計 / Pay now", total: splitTotal, totalColor: NT.purple, strong: true) {
                    ForEach(splitLines) { l in
                        let picked = splitPick[l.id] ?? 0
                        if picked > 0 {
                            HStack(spacing: 8) {
                                moveButton("chevron.left") { pickSplit(l, -1) }
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(l.displayName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                    if let opts = l.optionLabel { Text(opts).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                                }
                                Spacer(minLength: 4)
                                Text(verbatim: "×\(picked)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                                Text(NT.yen(l.unitPrice * picked)).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                                    .frame(width: 84, alignment: .trailing)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            Divider().overlay(NT.line).padding(.leading, 16)
                        }
                    }
                    if splitCount == 0 {
                        VStack(spacing: 6) {
                            Text("左の伝票から「›」で品を移してください")
                            Text("1つの品を何人かで食べたときは「分ける」で人数分に分けられます").font(.system(size: 12))
                        }
                        .font(.system(size: 13)).foregroundColor(NT.ink3)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16).padding(.vertical, 40)
                    }
                }
            }
            .padding(12)

            // 下：この分を会計
            HStack(spacing: 12) {
                Spacer()
                if splitIsAll && splitCount > 0 {
                    Text("全部を移すと分かれません。1つは元の伝票に残してください")
                        .font(.system(size: 13, weight: .bold)).foregroundColor(NT.warn)
                }
                Button(action: confirmSplit) {
                    VStack(spacing: 1) {
                        Text(model.busy ? "処理中…" : "この分を会計").font(.system(size: 18, weight: .heavy))
                        Text("Pay this part").font(.system(size: 11, weight: .bold)).opacity(0.85)
                    }
                    .foregroundColor(.white)
                    .frame(width: 240, height: 60)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy || splitCount == 0 || splitIsAll)
                .opacity(model.busy || splitCount == 0 || splitIsAll ? 0.4 : 1)
            }
            .padding(.horizontal, 16).padding(.bottom, 16)
        }
        .background(NT.page.ignoresSafeArea())
    }

    private func splitColumn<Content: View>(title: String, sub: String, total: Int, totalColor: Color, strong: Bool, @ViewBuilder rows: () -> Content) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.purple)
                Text(sub).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            Divider().overlay(NT.line)
            ScrollView {
                LazyVStack(spacing: 0) { rows() }
            }
            Divider().overlay(NT.line)
            HStack(alignment: .lastTextBaseline) {
                Text("合計金額").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(NT.yen(total)).font(.system(size: 22, weight: .heavy)).foregroundColor(totalColor)
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.15), value: total)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(strong ? NT.purple : NT.lilacLine, lineWidth: strong ? 2 : 1))
    }

    private func moveButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(NT.purple)
                .frame(width: 40, height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(NT.lilacLine, lineWidth: 1))
        }
        .buttonStyle(PressableStyle(scale: 0.92))
        .disabled(model.busy)
    }

    // MARK: - 完了

    private var doneView: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "checkmark.circle.fill").font(.system(size: 76)).foregroundColor(NT.ok)
            Text("会計が完了しました").font(.system(size: 28, weight: .heavy)).foregroundColor(NT.ink)
            if cashRow != nil {
                Text("おつり \(NT.yen(change))").font(.system(size: 44, weight: .heavy)).foregroundColor(NT.ok)
            }
            HStack(spacing: 14) {
                doneButton("printer", "レシート再発行", "Reprint receipt")
                Button {
                    if model.splitParentOrderId != nil {
                        Task {
                            if await model.resumeSplitParent() {
                                payments = []; activeId = nil; openMethod = nil; memo = ""; done = false
                            } else if model.notice == nil { onFinished() }
                        }
                    } else { (model.isLive ? onFinished : onClose)() }
                } label: {
                    // 英語を大きく・日本語を小さく下に（2026-10-24 Ronnie）
                    VStack(spacing: 2) {
                        Text(model.splitParentOrderId == nil ? "閉じる" : "同じ卓の残りを会計").font(.system(size: 19, weight: .heavy))
                        Text(model.splitParentOrderId == nil ? "Close" : "Pay the rest").font(.system(size: 11, weight: .bold)).opacity(0.85)
                    }
                    .foregroundColor(.white)
                    .frame(width: 220, height: 64)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.top, 10)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func doneButton(_ icon: String, _ ja: String, _ en: String) -> some View {
        Button {
            // レシートの再発行はネイティブで（直前のレシートをもう一度プリンターへ。2026-10-24 Ronnie「Web に飛ばない」）
            Task {
                reprinting = true
                let ok = await model.reprintReceipt()
                reprinting = false
                model.notice = ok ? nil : "レシートを再発行できませんでした。プリンターの接続を確認してください"
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon)
                VStack(spacing: 2) {
                    Text(reprinting ? "印刷中…" : ja).font(.system(size: 18, weight: .bold))
                    Text(en).font(.system(size: 11, weight: .bold)).opacity(0.8)
                }
            }
            .foregroundColor(NT.purple)
            .frame(width: 220, height: 64)
            .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
        .disabled(reprinting)
    }
}
