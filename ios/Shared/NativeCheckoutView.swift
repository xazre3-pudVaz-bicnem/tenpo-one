import SwiftUI

/// ネイティブの会計画面。Web の会計画面と同じ3列：
///   左＝品目一覧・来店経路（booking source）／中＝金額（小計・値引き・お預り・残額・おつり・支払いの内訳）／右＝支払方法・値引・テンキー
/// 2026-10-13 Ronnie「左に注文の一覧、booking source も全部」
/// いまは見本のデータで形を確かめる段階。会計の確定はサーバー（Web と同じ処理）につなぐ。
struct NativeCheckoutView: View {
    @ObservedObject var model: NativeOrderModel
    let onClose: () -> Void

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
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("お会計").font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
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
                Text("品目").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Text("Items").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Text(verbatim: "\(model.itemCount)点").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(model.order.lines) { l in
                        HStack(spacing: 8) {
                            Text(l.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
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
                Text("厨房へ未送信の品目が \(model.unsentCount) 品あります。会計を確定すると厨房へも送信されます。")
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
                Text("来店経路").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                Text("Booking source").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Button(showMoreSources ? "閉じる" : "ほかの経路 ＋") { withAnimation(.easeOut(duration: 0.15)) { showMoreSources.toggle() } }
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
            }
            let sources = showMoreSources ? model.visitSources + NPVisitSource.extras.filter { e in !model.visitSources.contains(e) } : model.visitSources
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 6)], spacing: 6) {
                ForEach(sources) { s in
                    let on = model.order.visitSourceId == s.id
                    Button {
                        model.order.visitSourceId = on ? nil : s.id
                    } label: {
                        Text(s.label)
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
                Text("金額").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Text("Amount").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)
            ScrollView {
                VStack(spacing: 8) {
                    Button {} label: {
                        VStack(spacing: 1) {
                            Text("別々会計").font(.system(size: 15, weight: .bold))
                            Text("Separate payment").font(.system(size: 10, weight: .semibold)).opacity(0.7)
                        }
                        .foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1.5))
                    }
                    .buttonStyle(PressableStyle())
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
                    sumRow("うち消費税", NT.yen(model.tax), small: true)
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
                                .background(RoundedRectangle(cornerRadius: 12).fill(active ? NT.lilac : Color(hex: 0xF8F6FC)))
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
                Text("支払メモ / Payment note（任意）").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                TextField("例）カード決済のつもりが現金で受領", text: $memo)
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
                tabButton("支払", "Payment", .pay)
                tabButton("値引", "Discount", .discount)
            }
            .background(RoundedRectangle(cornerRadius: 12).fill(NT.lilac))

            if tab == .pay { payPanel } else { discountPanel }

            Spacer(minLength: 0)
            Button { withAnimation(.easeOut(duration: 0.2)) { done = true } } label: {
                Text(canPay ? "会計する（\(NT.yen(total))）" : "残り \(NT.yen(remaining)) の支払方法を選んでください")
                    .font(.system(size: 20, weight: .heavy)).foregroundColor(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, minHeight: 68)
                    .background(RoundedRectangle(cornerRadius: 16).fill(canPay ? NT.purple : NT.purple.opacity(0.35)))
            }
            .buttonStyle(PressableStyle())
            .disabled(!canPay)
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
                            Text(m == .sitePoints ? "サイトポイント" : m.label).font(.system(size: 13, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                            Text(m.english).font(.system(size: 9, weight: .semibold)).opacity(0.7)
                        }
                        .foregroundColor(on ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 74)
                        .background(RoundedRectangle(cornerRadius: 12).fill(on ? NT.purple : Color(hex: 0xF8F6FC)))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: on ? 0 : 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }

            // 内訳（クレジット→VISA…、QR→PayPay…、サイトポイント→ホットペッパー…）
            if let m = openMethod, !NPBrands.of(m).isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(m == .sitePoints ? "どのサイトのポイントですか / Choose" : "\(m.label)の種類 / Choose")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 6)], spacing: 6) {
                        ForEach(NPBrands.of(m)) { b in
                            let on = payments.contains { $0.method == m && $0.brand == b }
                            Button { addRow(m, brand: b) } label: {
                                Text(b.name).font(.system(size: 13, weight: .bold))
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
                ("ちょうど", { setActive(exact: true) }),
                ("¥1,000", { bump(1000) }),
                ("¥5,000", { bump(5000) }),
                ("¥10,000", { bump(10000) }),
            ])
        }
    }

    private var discountPanel: some View {
        VStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text("決まった値引き・クーポン / Presets").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 6)], spacing: 6) {
                    ForEach(NPDiscountPreset.defaults) { p in
                        Button {
                            model.order.discountReason = p.name
                            if p.kind == .amount { model.order.discountTotal = p.value }
                            if p.kind == .percent { model.order.discountTotal = model.itemsTotal * p.value / 100 }
                        } label: {
                            Text(p.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                                .frame(maxWidth: .infinity, minHeight: 42)
                                .background(RoundedRectangle(cornerRadius: 10).fill(NT.lilac))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            HStack(spacing: 8) {
                modeButton("￥値引き", .amount)
                modeButton("％値引き", .percent)
            }
            HStack {
                Text(discountMode == .amount ? "値引き額" : "値引き率").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(discountInput.isEmpty ? "—" : (discountMode == .amount ? NT.yen(Int(discountInput) ?? 0) : "\(discountInput)%"))
                    .font(.system(size: 26, weight: .heavy)).foregroundColor(NT.ink)
            }
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xF8F6FC)))
            keypad(onKey: keyForDiscount, quick: [
                ("値引きを適用", applyDiscount),
                ("値引きを外す", { model.order.discountTotal = 0; model.order.discountReason = nil; discountInput = "" }),
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
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xF8F6FC)))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle(scale: 0.93))
                }
            }
        }
    }

    // MARK: - 操作

    private func tapMethod(_ m: NPPayMethod) {
        if !NPBrands.of(m).isEmpty {
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
        if discountMode == .amount {
            model.order.discountTotal = min(v, model.itemsTotal)
            model.order.discountReason = model.order.discountReason ?? "値引き"
        } else {
            let p = min(100, v)
            model.order.discountTotal = model.itemsTotal * p / 100
            model.order.discountReason = "\(p)%値引き"
        }
        discountInput = ""
        tab = .pay
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
                doneButton("printer", "レシート印刷")
                doneButton("doc.text", "領収書")
                Button(action: onClose) {
                    Text("閉じる").font(.system(size: 19, weight: .heavy)).foregroundColor(.white)
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
        Button {} label: {
            HStack(spacing: 8) { Image(systemName: icon); Text(text) }
                .font(.system(size: 18, weight: .bold)).foregroundColor(NT.purple)
                .frame(width: 200, height: 64)
                .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
    }
}
