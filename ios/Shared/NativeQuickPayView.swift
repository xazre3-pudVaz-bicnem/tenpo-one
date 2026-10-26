import SwiftUI

// 即会計（ネイティブ）。Web の /app/quick-pay（components/pos/quick-pay-screen.tsx）と同じ（2026-10-24）
//   左：電卓（クラシックレジ：訂正・取消・ドロア・C・×・値引・割引・0・00・000・登録）／右：伝票（人数・行・値引・合計・会計する）
//   上：履歴・テイクアウト・メニュー選択。会計・注文はいつものネイティブのオーダー・会計画面

struct NQLine: Codable, Identifiable { let id: String; let name: String; let quantity: Int; let lineTotal: Int; let isAmount: Bool }
struct NQOrder: Codable { let id: String; let orderNo: Int; let guestCount: Int; let lines: [NQLine] }
struct NQHistory: Codable, Identifiable { let id: String; let orderNo: Int; let status: String; let at: String; let total: Int; let guestCount: Int; let clerkName: String?; let methods: [String] }
struct NQPayload: Codable {
    let store: NFNamed
    let lineName: String
    let canCheckout: Bool
    let order: NQOrder?
    let history: [NQHistory]
}

@MainActor
final class NativeQuickModel: ObservableObject {
    @Published var payload: NQPayload?
    @Published var orderId: String?
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var q = [URLQueryItem(name: "part", value: "quick")]
            if let orderId { q.append(URLQueryItem(name: "order", value: orderId)) }
            comps.queryItems = q
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NQPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NQPayload.self, from: data)
            payload = p
            if p.order == nil { orderId = nil }
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func act(_ body: [String: Any]) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return nil }
            return r
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

struct NativeQuickPayView: View {
    @ObservedObject var model: NativeQuickModel
    let onHome: () -> Void
    let onOpenOrder: (_ id: String, _ checkout: Bool) -> Void

    @State private var amount = 0
    @State private var unit: Int?
    @State private var lines: [(amount: Int, quantity: Int)] = []
    @State private var guests = 1
    @State private var discount: (kind: String, value: Int)?
    @State private var historyOpen = false

    private let maxQty = 99
    private var p: NQPayload? { model.payload }
    private var order: NQOrder? { p?.order }
    private var orderedTotal: Int { (order?.lines ?? []).reduce(0) { $0 + $1.lineTotal } }
    private var linesTotal: Int { lines.reduce(0) { $0 + $1.amount * $1.quantity } }
    private var pendingLine: (amount: Int, quantity: Int)? {
        if let u = unit { return (u, min(maxQty, max(1, amount))) }
        return amount > 0 ? (amount, 1) : nil
    }
    private var pendingTotal: Int { pendingLine.map { $0.amount * $0.quantity } ?? 0 }
    private var subtotal: Int { orderedTotal + linesTotal + pendingTotal }
    private var discountAmount: Int {
        guard let d = discount, subtotal > 0, d.value > 0 else { return 0 }
        if d.kind == "percent" { return d.value > 100 ? 0 : subtotal * d.value / 100 }
        return min(d.value, subtotal)
    }
    private var total: Int { subtotal - discountAmount }
    private var paid: [NQHistory] { (p?.history ?? []).filter { $0.status == "paid" || $0.status == "refunded" } }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "即会計", subtitle: "Quick pay", onHome: onHome)
            header
            GeometryReader { geo in
                ScrollView {
                    let wide = geo.size.width >= 900
                    let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
                    layout {
                        calculator.frame(maxWidth: .infinity)
                        slip.frame(width: wide ? 380 : nil)
                    }
                    .padding(16)
                    .frame(maxWidth: 1100)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let e = model.error {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft)).frame(maxWidth: 720)
                }.buttonStyle(.plain).padding(.top, 74)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NFColor.navy.opacity(0.92))).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .sheet(isPresented: $historyOpen) { historySheet }
        .task { await model.refresh() }
        .onChange(of: model.payload?.order?.guestCount) { g in if let g { guests = g } }
    }

    // MARK: 上（クラシックレジ・履歴・テイクアウト・メニュー選択）

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text("クラシックレジ").font(.system(size: 15, weight: NT.strong)).tracking(1.8).foregroundColor(NFColor.royal)
                Text("CLASSIC REGISTER").font(.system(size: 10, weight: .bold)).tracking(3).foregroundColor(NFColor.ink3)
            }
            Spacer()
            topButton("clock.arrow.circlepath", "履歴\(paid.isEmpty ? "" : " \(paid.count)件")", en: "History", filled: false) { historyOpen = true }
            topButton("bag", "テイクアウト", en: "Take out", filled: false) {
                Task { if let r = await model.act(["type": "quickTakeout"]), let id = r.orderId { onOpenOrder(id, false) } }
            }
            topButton("fork.knife", "メニュー選択", en: "Order from menu", filled: true) {
                Task {
                    if let o = order { onOpenOrder(o.id, false); return }
                    if let r = await model.act(["type": "quickStart", "guestCount": guests]), let id = r.orderId {
                        model.orderId = id
                        onOpenOrder(id, false)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 12)
        .disabled(model.busy)
    }

    private func topButton(_ icon: String, _ ja: String, en: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 18, weight: .semibold))
                VStack(alignment: .leading, spacing: 0) {
                    Text(ja).font(.system(size: 15, weight: .bold))
                    Text(en).font(.system(size: 10, weight: .semibold)).opacity(0.7)
                }
            }
            .foregroundColor(filled ? .white : NFColor.royal)
            .padding(.horizontal, 16).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(filled ? NFColor.royal : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(filled ? Color.clear : NFColor.line, lineWidth: 2))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 電卓

    private var calculator: some View {
        VStack(spacing: 12) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(unit != nil ? "個数を入れてください / Quantity" : "金額（税込） / Amount").font(.system(size: 11)).foregroundColor(.white.opacity(0.6))
                if let u = unit {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(NT.yen(u))
                        Text("×").foregroundColor(.white.opacity(0.6))
                        Text(amount > 0 ? "\(amount)" : "_").foregroundColor(amount > 0 ? .white : .white.opacity(0.4))
                        Text("= \(NT.yen(pendingTotal))").font(.system(size: 24, weight: .bold)).foregroundColor(.white.opacity(0.7))
                    }
                    .font(.system(size: 38, weight: NT.strong)).monospacedDigit()
                } else {
                    Text(NT.yen(amount)).font(.system(size: 44, weight: NT.strong)).monospacedDigit()
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(LinearGradient(colors: [Color(hex: 0x1F2A44), Color(hex: 0x0E1526)], startPoint: .top, endPoint: .bottom)))

            let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)
            LazyVGrid(columns: cols, spacing: 8) {
                key("訂正", en: "Void", tone: .gray, enabled: pendingLine != nil || !lines.isEmpty) { voidLast() }
                key("取消", en: "Cancel", tone: .gray, enabled: pendingLine != nil || !lines.isEmpty || discount != nil) { amount = 0; unit = nil; lines = []; discount = nil }
                key("ドロア", en: "Drawer", tone: .dark, enabled: true) {
                    Task { if let sid = p?.store.id, await model.act(["type": "floorDrawer", "storeId": sid]) != nil { model.toast = "ドロアを開きます / Opening drawer" } }
                }
                key("C", en: "Clear", tone: .red, big: true, enabled: amount != 0 || unit != nil) { if amount > 0 { amount = 0 } else { unit = nil } }
                ForEach(["7", "8", "9"], id: \.self) { d in key(d, tone: .white, big: true) { digit(d) } }
                key("×", en: "個数 Quantity", tone: .blue, big: true, enabled: unit == nil && amount > 0) { unit = amount; amount = 0 }
                ForEach(["4", "5", "6"], id: \.self) { d in key(d, tone: .white, big: true) { digit(d) } }
                key("値引", en: "¥ off", tone: .amber, enabled: unit == nil && amount > 0) { discount = ("yen", amount); amount = 0 }
                ForEach(["1", "2", "3"], id: \.self) { d in key(d, tone: .white, big: true) { digit(d) } }
                key("割引", en: "% off", tone: .amber, enabled: unit == nil && amount > 0) {
                    if amount > 100 { model.error = "割引は 1〜100% で入れてください"; return }
                    discount = ("percent", amount); amount = 0
                }
                ForEach(["0", "00", "000"], id: \.self) { d in key(d, tone: .white, big: true) { digit(d) } }
                key("登録", en: "Add", tone: .brand, enabled: pendingLine != nil) {
                    if let l = pendingLine { lines.append(l); amount = 0; unit = nil }
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        .disabled(model.busy)
    }

    private func digit(_ d: String) {
        var next: Int
        let s = String(amount == 0 ? "" : "\(amount)") + d
        next = Int(s.prefix(7)) ?? amount
        if unit != nil { next = min(maxQty, next) }
        amount = next
    }

    private func voidLast() {
        if pendingLine != nil { amount = 0; unit = nil; return }
        if !lines.isEmpty { lines.removeLast() }
    }

    private enum Tone { case white, gray, dark, red, blue, amber, brand }
    private func key(_ label: String, en: String? = nil, tone: Tone, big: Bool = false, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        let (top, bottom, ink): (Color, Color, Color) = {
            switch tone {
            case .white: return (.white, Color(hex: 0xECE7E0), NFColor.navy)
            case .gray: return (Color(hex: 0xEFEBE5), Color(hex: 0xDDD6CC), NFColor.navy)
            case .dark: return (Color(hex: 0x3D3833), Color(hex: 0x252220), .white)
            case .red: return (Color(hex: 0xFDECEC), Color(hex: 0xF5CDC5), Color(hex: 0xC62828))
            case .blue: return (Color(hex: 0xE8EEFB), Color(hex: 0xCBD8F3), Color(hex: 0x27468F))
            case .amber: return (Color(hex: 0xFDF2DF), Color(hex: 0xF6DDB0), Color(hex: 0x8A4B08))
            case .brand: return (NFColor.iris, NFColor.royal, .white)
            }
        }()
        return Button(action: action) {
            VStack(spacing: 0) {
                Text(label).font(.system(size: big ? 30 : 20, weight: NT.strong)).monospacedDigit()
                if let en { Text(en).font(.system(size: 9.5, weight: .bold)).opacity(0.7).lineLimit(1) }
            }
            .foregroundColor(ink)
            .frame(maxWidth: .infinity).frame(height: 70)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(LinearGradient(colors: [top, bottom], startPoint: .top, endPoint: .bottom)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.black.opacity(0.08), lineWidth: 1))
            .shadow(color: Color.black.opacity(0.12), radius: 0, x: 0, y: 3)
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(PressableStyle(scale: 0.96))
        .disabled(!enabled)
    }

    // MARK: 伝票

    private var slip: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 4) {
                    Text("伝票").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                    if let o = order { Text("#\(o.orderNo)").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                }
                Spacer()
                Text("人数 Guests").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                stepBtn("minus", enabled: guests > 1) { guests = max(1, guests - 1) }
                Text("\(guests)").font(.system(size: 18, weight: .bold)).monospacedDigit().frame(width: 34)
                stepBtn("plus", enabled: guests < 999) { guests = min(999, guests + 1) }
            }
            VStack(spacing: 0) {
                ForEach(order?.lines ?? []) { l in
                    row(l.isAmount ? l.name : "\(l.name) ×\(l.quantity)", NT.yen(l.lineTotal), color: NFColor.ink, remove: nil)
                }
                ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                    row(l.quantity > 1 ? "\(p?.lineName ?? "即会計")  \(NT.yen(l.amount)) × \(l.quantity)" : (p?.lineName ?? "即会計"), NT.yen(l.amount * l.quantity), color: NFColor.ink2) {
                        lines.remove(at: i)
                    }
                }
                if let pl = pendingLine {
                    row(pl.quantity > 1 ? "入力中 / Typing  \(NT.yen(pl.amount)) × \(pl.quantity)" : "入力中 / Typing", NT.yen(pendingTotal), color: NFColor.ink3, remove: nil)
                }
                if let d = discount, discountAmount > 0 {
                    row(d.kind == "percent" ? "割引 \(d.value)%" : "値引 \(NT.yen(d.value))", "−\(NT.yen(discountAmount))", color: Color(hex: 0xC27C0E)) { discount = nil }
                }
                if (order?.lines.isEmpty ?? true) && lines.isEmpty && pendingLine == nil {
                    VStack(spacing: 2) {
                        Text("金額を打って「登録」、または右上の「メニュー選択」")
                        Text("Enter an amount, or choose from the menu")
                    }
                    .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    .frame(maxWidth: .infinity).padding(.vertical, 28)
                }
            }
            .frame(minHeight: 140, alignment: .top)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
            if (order?.lines ?? []).contains(where: { !$0.isAmount }) {
                Text("メニューの商品の取消は、会計画面の伝票から行います").font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
            HStack(alignment: .firstTextBaseline) {
                Text("合計").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                Text("Total（税込）").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                Spacer()
                Text(NT.yen(total)).font(.system(size: 34, weight: NT.strong)).monospacedDigit().foregroundColor(NFColor.royal)
            }
            Button { Task { await checkout() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "wallet.pass").font(.system(size: 22))
                    Text(model.busy ? "準備中…" : "会計する").font(.system(size: 22, weight: NT.strong))
                    Text("Checkout").font(.system(size: 12, weight: .semibold)).opacity(0.75)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity).frame(height: 68)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NFColor.success))
                .opacity(model.busy || total <= 0 || !(p?.canCheckout ?? false) ? 0.45 : 1)
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            .disabled(model.busy || total <= 0 || !(p?.canCheckout ?? false))
            if !(p?.canCheckout ?? true) {
                Text("会計する権限がありません。店長・管理者に権限の付与を依頼してください").font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func row(_ name: String, _ value: String, color: Color, remove: (() -> Void)?) -> some View {
        HStack(spacing: 8) {
            Text(name).font(.system(size: 14)).foregroundColor(color).lineLimit(1)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).monospacedDigit().foregroundColor(color)
            if let remove {
                Button(action: remove) { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 30, height: 30) }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).frame(minHeight: 40)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func stepBtn(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle()).disabled(!enabled).opacity(enabled ? 1 : 0.4)
    }

    private func checkout() async {
        var all = lines
        if let pl = pendingLine { all.append(pl) }
        if all.isEmpty && orderedTotal <= 0 { model.error = "金額を入れてください / Enter an amount"; return }
        var body: [String: Any] = [
            "type": "quickCheckout",
            "orderId": order?.id ?? NSNull(),
            "guestCount": guests,
            "lines": all.map { ["amount": $0.amount, "quantity": $0.quantity] },
        ]
        if let d = discount, discountAmount > 0 { body["discount"] = ["kind": d.kind, "value": d.value] }
        if let r = await model.act(body), let id = r.orderId {
            lines = []; amount = 0; unit = nil; discount = nil
            model.orderId = nil
            // ここからはいつもの会計（支払方法・お預かり・お釣り・レシート・ドロア）
            onOpenOrder(id, true)
        }
    }

    // MARK: 履歴（今日・即会計の伝票だけ）

    private var historySheet: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Text("会計済 \(paid.count)件").font(.system(size: 14, weight: .semibold))
                        Text("Paid").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                        Spacer()
                        Text(NT.yen(paid.reduce(0) { $0 + $1.total })).font(.system(size: 20, weight: NT.strong)).monospacedDigit()
                    }
                }
                Section(footer: Text("テーブルの会計は入りません。全部の伝票は「伝票明細」で見られます。")) {
                    if (p?.history ?? []).isEmpty {
                        VStack(spacing: 2) { Text("今日の即会計はまだありません"); Text("No quick pay checkouts today").font(.system(size: 12)) }
                            .foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 20)
                    }
                    ForEach(p?.history ?? []) { h in
                        let open = h.status == "open"
                        HStack(spacing: 12) {
                            Text(NFTime.hm(iso: h.at)).font(.system(size: 16, weight: .bold)).monospacedDigit().foregroundColor(NFColor.navy).frame(width: 52, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text("#\(h.orderNo)").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.royal)
                                    Text("\(h.guestCount)名").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                    Text(open ? "未会計" : h.status == "refunded" ? "返金済" : "会計済").font(.system(size: 11, weight: .bold))
                                        .foregroundColor(open ? Color(hex: 0xC27C0E) : h.status == "refunded" ? NFColor.danger : NFColor.success)
                                }
                                Text((h.methods.isEmpty ? (open ? "未会計（開く）" : "—") : h.methods.joined(separator: "・")) + (h.clerkName.map { "  \($0)" } ?? ""))
                                    .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            }
                            Spacer()
                            Text(NT.yen(h.total)).font(.system(size: 16, weight: NT.strong)).monospacedDigit()
                            if open {
                                Button("開く") { historyOpen = false; model.orderId = h.id; Task { await model.refresh() } }.buttonStyle(.borderedProminent)
                            } else {
                                Button { Task { if await model.act(["type": "floorReceipt", "orderId": h.id]) != nil { model.toast = "レシートを印刷します" } } } label: {
                                    Label("レシート", systemImage: "printer")
                                }.buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }
            .navigationTitle("即会計の履歴（今日） / Quick pay history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { historyOpen = false } } }
        }
    }
}
