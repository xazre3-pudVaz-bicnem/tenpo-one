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
    @State private var openMethod: NPPayMethod?
    @State private var memo = ""
    @State private var done = false
    @State private var showMoreSources = false
    @State private var discountMode: DiscountMode = .amount
    @State private var discountInput = ""
    @State private var paying = false
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
    private var canPay: Bool { total == 0 || (remaining == 0 && !payments.isEmpty) }

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
                        Button("Close") { stera = nil }
                            .font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                            .frame(width: 180, height: 52).background(RoundedRectangle(cornerRadius: 12).fill(NT.purple))
                    } else {
                        Button("Cancel") { cancelStera() }
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
            Text("Checkout").font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
            Text(model.order.tableName).font(.system(size: 22, weight: .heavy)).foregroundColor(Color(hex: 0xC9B6F5))
            Text(verbatim: "#\(model.order.orderNo)").font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.6))
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Color.white.opacity(0.12)))
            }
        }
        .padding(.horizontal, 20).frame(height: 64)
        .background(NT.header)
    }

    // MARK: - 左：品目一覧・来店経路

    private var itemsColumn: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Items").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(verbatim: "\(model.itemCount) items").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
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
                Text("\(model.unsentCount) item(s) not sent to the kitchen yet. They will be sent when you complete checkout.")
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
                Text("Booking source").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Button(showMoreSources ? "Less" : "More ＋") { withAnimation(.easeOut(duration: 0.15)) { showMoreSources.toggle() } }
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
            }
            let sources = showMoreSources ? model.visitSources + NPVisitSource.extras.filter { e in !model.visitSources.contains(e) } : model.visitSources
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 6)], spacing: 6) {
                ForEach(sources) { s in
                    let on = model.order.visitSourceId == s.id
                    Button {
                        Task { await model.setVisitSource(on ? nil : s.id) }
                    } label: {
                        Text(s.english)
                            .font(.system(size: 13, weight: .bold))
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundColor(on ? .white : NT.ink2)
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(RoundedRectangle(cornerRadius: 10).fill(on ? NT.purple : NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .padding(14)
    }

    // MARK: - 中：金額

    private var amountColumn: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Amount").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)
            ScrollView {
                VStack(spacing: 8) {
                    Button {
                        if let id = model.orderId { model.openInWeb(path: "/app/pos?order=\(id)&checkout=1") }
                    } label: {
                        VStack(spacing: 1) {
                            Text("Separate payment").font(.system(size: 15, weight: .bold))
                        }
                        .foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1.5))
                    }
                    .buttonStyle(PressableStyle())
                    .padding(.bottom, 4)

                    sumRow("Subtotal", NT.yen(model.subtotal))
                    if model.order.serviceCharge > 0 { sumRow("Service charge", NT.yen(model.order.serviceCharge), small: true) }
                    sumRow(model.order.discountReason.map { "Discount / coupon (\($0))" } ?? "Discount / coupon",
                           model.order.discountTotal > 0 ? "-\(NT.yen(model.order.discountTotal))" : NT.yen(0),
                           color: model.order.discountTotal > 0 ? NT.warn : NT.ink2)
                    dashed
                    HStack(alignment: .lastTextBaseline) {
                        Text("Total to pay").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                        Spacer()
                        Text(NT.yen(total)).font(.system(size: 36, weight: .heavy)).foregroundColor(NT.purple)
                    }
                    sumRow("incl. tax", NT.yen(model.tax), small: true)
                    dashed
                    sumRow("Received", NT.yen(tenderedTotal))
                    HStack(alignment: .lastTextBaseline) {
                        Text("Remaining").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2)
                        Spacer()
                        Text(NT.yen(remaining)).font(.system(size: 26, weight: .heavy)).foregroundColor(remaining == 0 ? NT.ok : NT.warn)
                    }
                    HStack(alignment: .lastTextBaseline) {
                        Text("Change").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2)
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
                Text("Payment note (optional)").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                TextField("e.g. meant to pay by card, received cash", text: $memo)
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
                tabButton("Payment", "支払", .pay)
                tabButton("Discount", "値引", .discount)
            }
            .background(RoundedRectangle(cornerRadius: 12).fill(NT.lilac))

            if tab == .pay { payPanel } else { discountPanel }

            Spacer(minLength: 0)
            if showSteraButton, let m = openMethod {
                Button { steraPick = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "creditcard.and.123")
                        Text("Pay with stera \(NT.yen(total))")
                    }
                    .font(.system(size: 18, weight: .heavy)).foregroundColor(NT.purple)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NT.purple, lineWidth: 1.5))
                }
                .buttonStyle(PressableStyle())
                .confirmationDialog("stera: how will the guest pay?", isPresented: $steraPick, titleVisibility: .visible) {
                    ForEach(steraTypes(for: m), id: \.code) { t in
                        Button(t.en ?? t.label) { startStera(t) }
                    }
                    Button("Cancel", role: .cancel) {}
                }
            }
            Button(action: pay) {
                Text(paying ? "Processing…" : canPay ? "Complete checkout \(NT.yen(total))" : "Choose how to pay the remaining \(NT.yen(remaining))")
                    .font(.system(size: 20, weight: .heavy)).foregroundColor(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, minHeight: 68)
                    .background(RoundedRectangle(cornerRadius: 16).fill(canPay ? NT.purple : NT.purple.opacity(0.35)))
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
            let methods: [NPPayMethod] = [.cash, .credit, .qr, .emoney, .external, .other, .sitePoints, .points]
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(methods) { m in
                    let on = payments.contains { $0.method == m } || openMethod == m
                    Button { tapMethod(m) } label: {
                        VStack(spacing: 4) {
                            Image(systemName: m.icon).font(.system(size: 20, weight: .semibold))
                            Text(m.english).font(.system(size: 13, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                            Text(m.label).font(.system(size: 9, weight: .semibold)).opacity(0.7).lineLimit(1)
                        }
                        .foregroundColor(on ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 74)
                        .background(RoundedRectangle(cornerRadius: 12).fill(on ? NT.purple : Color(hex: 0xFBF9F5)))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: on ? 0 : 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }

            // 内訳（クレジット→VISA…、QR→PayPay…、サイトポイント→ホットペッパー…）
            if let m = openMethod, !brands(m).isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(m == .sitePoints ? "Which site's points?" : "Choose \(m.english.lowercased()) type")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], spacing: 6) {
                        ForEach(brands(m)) { b in
                            let on = payments.contains { $0.method == m && $0.brand == b }
                            Button { addRow(m, brand: b) } label: {
                                Text(b.english).font(.system(size: 13, weight: .bold))
                                    .lineLimit(1).minimumScaleFactor(0.7)
                                    .foregroundColor(on ? .white : NT.purple)
                                    .frame(maxWidth: .infinity, minHeight: 38)
                                    .background(RoundedRectangle(cornerRadius: 10).fill(on ? NT.purple : NT.lilac))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1))
            }

            keypad(onKey: keyForPayment, quick: [
                ("Exact", { setActive(exact: true) }),
                ("¥1,000", { bump(1000) }),
                ("¥5,000", { bump(5000) }),
                ("¥10,000", { bump(10000) }),
            ])
        }
    }

    private var discountPanel: some View {
        VStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Preset discounts / coupons").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
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
                            Text(p.english).font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                                .frame(maxWidth: .infinity, minHeight: 42)
                                .background(RoundedRectangle(cornerRadius: 10).fill(NT.lilac))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            HStack(spacing: 8) {
                modeButton("¥ off", .amount)
                modeButton("% off", .percent)
            }
            HStack {
                Text(discountMode == .amount ? "Discount amount" : "Discount rate").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(discountInput.isEmpty ? "—" : (discountMode == .amount ? NT.yen(Int(discountInput) ?? 0) : "\(discountInput)%"))
                    .font(.system(size: 26, weight: .heavy)).foregroundColor(NT.ink)
            }
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xFBF9F5)))
            keypad(onKey: keyForDiscount, quick: [
                ("Apply discount", applyDiscount),
                ("Remove discount", { discountInput = ""; pendingReason = nil; Task { await model.setDiscount(amount: 0, reason: "") } }),
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

    private func keypad(onKey: @escaping (String) -> Void, quick: [(String, () -> Void)]) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                ForEach(Array(quick.enumerated()), id: \.offset) { _, q in
                    Button(action: q.1) {
                        Text(q.0).font(.system(size: 13, weight: .heavy)).foregroundColor(NT.purple)
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(NT.lilac))
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
    private func brands(_ m: NPPayMethod) -> [NPBrand] {
        if m == .sitePoints { return model.pointBrands.isEmpty ? NPBrands.sitePoints : model.pointBrands }
        if let set = model.methodBrands[m.rawValue], !set.isEmpty { return set }
        return NPBrands.of(m)
    }

    private func tapMethod(_ m: NPPayMethod) {
        if !brands(m).isEmpty {
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
        payments.removeAll { $0.id == p.id }
        if activeId == p.id { activeId = payments.last?.id }
    }

    private func updateActive(_ f: (inout NPPaymentRow) -> Void) {
        if activeId == nil || !payments.contains(where: { $0.id == activeId }) {
            // 何も選んでいなければ現金にする
            addRow(.cash, brand: nil)
        }
        guard let i = payments.firstIndex(where: { $0.id == activeId }) else { return }
        f(&payments[i])
    }

    private func keyForPayment(_ k: String) {
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
        updateActive { row in
            if row.method == .cash { row.tendered = due } else { row.amount += rest }
        }
    }

    private func bump(_ yen: Int) {
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
        model.isLive && !model.steraTerminals.isEmpty && (openMethod.map { steraMethods.contains($0) } ?? false)
    }

    private func steraTypes(for m: NPPayMethod) -> [APISteraType] {
        model.steraTypes.filter { $0.method == m.rawValue }
    }

    private func startStera(_ t: APISteraType) {
        guard let orderId = model.orderId else { return }
        let terminal = model.steraTerminals.first(where: { $0.online }) ?? model.steraTerminals.first
        guard let terminal else { return }
        stera = SteraState(requestId: nil, label: t.en ?? t.label, status: "starting", message: "Sending the amount to stera…")
        Task {
            do {
                let r = try await NativeAPI.shared.act(["type": "steraStart", "orderId": orderId, "terminalId": terminal.id, "paymentType": t.code], throwOnFail: false)
                if !r.ok {
                    stera?.status = "failed"
                    stera?.message = r.error ?? "Could not send to stera"
                    return
                }
                if r.finalized == true { steraDone(r); return }
                stera?.requestId = r.requestId
                stera?.status = r.status ?? "queued"
                stera?.message = "Ask the guest to pay on \(terminal.name)"
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
                stera?.message = r.error ?? "Payment failed"
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
                stera?.message = r?.error ?? "Can't cancel while the terminal is paying. Finish or cancel it on the terminal."
            } else {
                stera = nil
            }
        }
    }

    // MARK: - 完了

    private var doneView: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "checkmark.circle.fill").font(.system(size: 76)).foregroundColor(NT.ok)
            Text("Checkout complete").font(.system(size: 28, weight: .heavy)).foregroundColor(NT.ink)
            if cashRow != nil {
                Text("Change \(NT.yen(change))").font(.system(size: 44, weight: .heavy)).foregroundColor(NT.ok)
            }
            HStack(spacing: 14) {
                doneButton("printer", "Receipt")
                Button(action: model.isLive ? onFinished : onClose) {
                    Text("Close").font(.system(size: 19, weight: .heavy)).foregroundColor(.white)
                        .frame(width: 200, height: 64)
                        .background(RoundedRectangle(cornerRadius: 14).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.top, 10)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func doneButton(_ icon: String, _ text: String) -> some View {
        Button {
            // レシート・領収書は今までの画面（印刷・再発行・宛名）で
            if let id = model.orderId { model.openInWeb(path: "/app/pos/receipt/\(id)") }
        } label: {
            HStack(spacing: 8) { Image(systemName: icon); Text(text) }
                .font(.system(size: 18, weight: .bold)).foregroundColor(NT.purple)
                .frame(width: 200, height: 64)
                .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
    }
}
