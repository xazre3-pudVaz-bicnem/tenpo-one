import SwiftUI

// iPhone の店長・オーナー：伝票の返金・取消（VOID）・再会計（Web の /app/orders/<id> の RefundDialog・再会計と同じ。2026-10-25 Ronnie「101% native」）
// iPad と同じ GET part=slip&id=（返金できる額・品目・支払の内訳は iPad の型 NSDetail で読む）／ POST slipRefund・slipReopen（pos.refund）。
// どれも必ず確認を出す（iPhone はお店の外からも押せるため）。再会計の伝票は未会計で作られる（会計はハンディ・レジで）

@MainActor
final class NPORefundModel: ObservableObject {
    @Published var detail: NSDetail?
    @Published var error: String?
    @Published var busy = false
    let orderId: String

    init(orderId: String) {
        self.orderId = orderId
        detail = NativeModuleAPI.cached(NSDetail.self, part: "slip", query: ["id": orderId])
    }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            detail = try await NativeModuleAPI.get(NSDetail.self, part: "slip", query: ["id": orderId])
            error = nil
        } catch {
            if detail == nil { self.error = NativeModuleAPI.message(error) }
        }
    }

    /// 返金・取消（nil＝できた、字＝エラー）
    func refund(_ body: [String: Any]) async -> String? {
        busy = true
        defer { busy = false }
        if NativePreview.current != nil { return nil }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { return r.error ?? "返金できませんでした" }
        await load()
        return nil
    }

    /// 再会計（全額返金済みの伝票の品目をコピーした新しい未会計の伝票）。返事は新しい伝票の id
    func reopen(reason: String) async -> String? {
        busy = true
        defer { busy = false }
        if NativePreview.current != nil { return nil }
        let r = await NSPApi.postJSON(["type": "slipReopen", "orderId": orderId, "reason": reason])
        guard r.ok else { return r.error ?? "再会計できませんでした" }
        await load()
        return nil
    }
}

/// 伝票の詳細の下の「返金・取消・再会計」（Web の画面へは行かない）
struct NPOSlipMoneyActions: View {
    let orderId: String
    /// 返金・取消・再会計がすんだ（詳細・一覧を読み直す。ことばは toast へ）
    let onDone: (String) -> Void
    @StateObject private var model: NPORefundModel
    @State private var refundOpen = false
    @State private var reopenOpen = false

    init(orderId: String, onDone: @escaping (String) -> Void) {
        self.orderId = orderId
        self.onDone = onDone
        _model = StateObject(wrappedValue: NPORefundModel(orderId: orderId))
    }

    var body: some View {
        VStack(spacing: 8) {
            if let d = model.detail {
                if d.canRefund {
                    Button { refundOpen = true } label: {
                        label("返金・取消する（返金可能 \(NT.yen(d.refundable))）", icon: "arrow.uturn.backward.circle", danger: true)
                    }
                    .buttonStyle(PressableStyle())
                } else if ["paid", "refunded"].contains(d.status) && d.canReopen && d.refundable <= 0 {
                    Text("これ以上返金できる金額はありません").font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
                }
                if d.canReopen {
                    if let dv = d.openDerived {
                        Text("再会計伝票 #\(dv.orderNo) が作成済みです（未会計）。会計はハンディかレジ（iPad）で。")
                            .font(.system(size: 12.5)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading)
                    } else if d.fullyRefunded {
                        Button { reopenOpen = true } label: { label("再会計する", icon: "arrow.triangle.2.circlepath", danger: false) }
                            .buttonStyle(PressableStyle())
                    } else if ["paid", "refunded"].contains(d.status) {
                        Text("再会計するには先に全額返金してください\(d.refundable > 0 ? "（未返金 \(NT.yen(d.refundable))）" : "")")
                            .font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                if !d.canRefund && !d.canReopen {
                    Text("返金・取消・再会計は店長以上（返金の権限）のアカウントでできます").font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let e = model.error {
                Text(e).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task(id: orderId) { await model.load() }
        .sheet(isPresented: $refundOpen) {
            if let d = model.detail {
                NPORefundSheet(model: model, detail: d, onClose: { refundOpen = false }, onDone: { msg in
                    refundOpen = false
                    onDone(msg)
                })
                .presentationDetents([.large])
            }
        }
        .sheet(isPresented: $reopenOpen) {
            NPZReasonSheet(title: "再会計", message: "全額返金済みの伝票の品目をコピーした、新しい未会計の伝票を作ります。元の伝票は返金済みのまま残ります。会計はハンディかレジ（iPad）で。",
                           okText: "再会計する", busy: model.busy, send: { reason in
                               if let e = await model.reopen(reason: reason) { return e }
                               onDone("再会計の伝票を作りました（未会計）")
                               return nil
                           }, onClose: { reopenOpen = false })
        }
    }

    private func label(_ t: String, icon: String, danger: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold))
            Text(t).font(.system(size: 14.5, weight: NT.strong)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .foregroundColor(danger ? NT.danger : NT.purpleDeep)
        .frame(maxWidth: .infinity).frame(height: 50)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(danger ? NT.dangerBg : NT.lilac))
    }
}

/// 返金・取消（VOID）のシート（Web の RefundDialog・iPad の NSRefundSheet と同じ決まり）
struct NPORefundSheet: View {
    @ObservedObject var model: NPORefundModel
    let detail: NSDetail
    let onClose: () -> Void
    let onDone: (String) -> Void

    @State private var kind = "refund"
    @State private var mode = "amount"
    @State private var amountText = ""
    @State private var method = "cash"
    @State private var reason = ""
    @State private var picked: [String: Pick] = [:]
    @State private var problem: String?
    @State private var confirm = false

    struct Pick: Equatable { var qty: Double; var restock: Bool }

    static let methods: [(String, String)] = [("cash", "現金"), ("credit", "クレジット"), ("qr", "QRコード決済"), ("emoney", "電子マネー"), ("voucher", "商品券"), ("on_account", "掛売"), ("other", "その他")]

    private func amountFor(_ it: NSDetail.Refundable, _ qty: Double) -> Int {
        if qty >= it.remainingQty { return it.remainingAmount }
        return Int((Double(it.remainingAmount) / it.remainingQty * qty).rounded())
    }

    private var itemsPayload: [[String: Any]] {
        detail.refundableItems.compactMap { it in
            guard let s = picked[it.orderItemId], s.qty > 0 else { return nil }
            return ["orderItemId": it.orderItemId, "quantity": s.qty, "amount": amountFor(it, s.qty), "restock": s.restock]
        }
    }

    private var effectiveAmount: Int {
        if kind == "void" { return detail.refundable }
        if mode == "items" { return itemsPayload.reduce(0) { $0 + (($1["amount"] as? Int) ?? 0) } }
        return Int(amountText.filter(\.isNumber)) ?? 0
    }

    private var canSubmit: Bool {
        !model.busy && !reason.trimmingCharacters(in: .whitespaces).isEmpty && effectiveAmount > 0 && effectiveAmount <= detail.refundable
            && (mode == "amount" || kind == "void" || !itemsPayload.isEmpty)
    }

    var body: some View {
        NPOCSheetFrame(title: "返金・取消 #\(detail.orderNo)", confirmText: kind == "void" ? "取消" : "返金", busy: model.busy, onCancel: onClose, onConfirm: {
            if let why = blockReason { problem = why; return }
            confirm = true
        }) {
            HStack {
                Text("返金可能額").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(NT.yen(detail.refundable)).font(.system(size: 22, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            .padding(14).background(npocCard(14))
            if !detail.paymentBreakdown.isEmpty {
                NPOCard(title: "この取引の支払内訳") {
                    ForEach(detail.paymentBreakdown) { b in
                        HStack {
                            Text(b.label).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 1) {
                                Text("残 \(NT.yen(b.paid - b.refunded))").font(.system(size: 14, weight: NT.strong)).monospacedDigit()
                                Text("支払 \(NT.yen(b.paid))・返金 \(NT.yen(b.refunded))").font(.system(size: 10.5)).foregroundColor(NT.ink3).monospacedDigit()
                            }
                        }
                    }
                }
            }
            NPOCField(label: "区分") {
                NPSChoice(options: [("refund", "返金"), ("void", "取消（VOID）")], selection: kind) { kind = $0 }
            }
            if kind == "void" {
                NOMNote(text: "会計の取消。残りの全額 \(NT.yen(detail.refundable)) を返金します（金額は変えられません）。")
            } else {
                NPOCField(label: "返金のしかた") {
                    NPSChoice(options: [("amount", "金額指定"), ("items", "商品単位")], selection: mode) { mode = $0 }
                }
                if mode == "amount" {
                    NPSInput(label: "返金額", text: $amountText, placeholder: String(detail.refundable), keyboard: .numberPad, suffix: "円")
                } else {
                    itemsCard
                }
            }
            NPOCField(label: "返金先（支払方法）") {
                NPSChoice(options: Self.methods, selection: method) { method = $0 }
            }
            if let b = detail.paymentBreakdown.first(where: { $0.method == method }), effectiveAmount > b.paid - b.refunded {
                Text("選んだ支払方法の残額（\(NT.yen(b.paid - b.refunded))）を超えています。支払方法を確かめてください。").font(.system(size: 12)).foregroundColor(NT.warn)
            } else if !detail.paymentBreakdown.contains(where: { $0.method == method }) && effectiveAmount > 0 {
                Text("この取引ではこの支払方法での支払がありません。").font(.system(size: 12)).foregroundColor(NT.warn)
            }
            NPSInput(label: "理由（必須）", text: $reason, placeholder: "例：料理の提供ミス", required: true)
            if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
            NPOCWideButton(text: model.busy ? "処理中…" : (kind == "void" ? "取消（VOID）を実行" : "\(NT.yen(effectiveAmount)) を返金する"),
                           icon: "arrow.uturn.backward", kind: .danger, busy: model.busy, disabled: !canSubmit) { confirm = true }
        }
        .confirmationDialog(kind == "void" ? "会計を取消（VOID）しますか？" : "\(NT.yen(effectiveAmount)) を返金しますか？", isPresented: $confirm, titleVisibility: .visible) {
            Button(kind == "void" ? "取消（VOID）する" : "返金する", role: .destructive) { Task { await submit() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("伝票 #\(detail.orderNo)・\(Self.methods.first { $0.0 == method }?.1 ?? method)へ \(NT.yen(effectiveAmount))。この操作は取り消せません。")
        }
        .onAppear { if amountText.isEmpty { amountText = String(detail.refundable) } }
    }

    private var blockReason: String? {
        if reason.trimmingCharacters(in: .whitespaces).isEmpty { return "理由を入力してください" }
        if effectiveAmount <= 0 { return kind == "refund" && mode == "items" ? "返金する品目を選んでください" : "返金額は1円以上で入力してください" }
        if effectiveAmount > detail.refundable { return "返金可能額（\(NT.yen(detail.refundable))）を超えています" }
        return nil
    }

    private var itemsCard: some View {
        NPOCard(title: "返金する品目・数量", trailing: "返金額 \(NT.yen(effectiveAmount))") {
            if detail.refundableItems.isEmpty { Text("返金可能な品目がありません").font(.system(size: 13)).foregroundColor(NT.ink3) }
            ForEach(detail.refundableItems) { it in
                let sel = picked[it.orderItemId]
                VStack(alignment: .leading, spacing: 6) {
                    Toggle(isOn: Binding(get: { sel != nil }, set: { on in picked[it.orderItemId] = on ? Pick(qty: it.remainingQty, restock: false) : nil })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                            Text("未返金 \(NPS.num(it.remainingQty))点 / \(NT.yen(it.remainingAmount))").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                        }
                    }
                    .tint(NT.purple)
                    if let s = sel {
                        HStack {
                            Stepper("数量 \(NPS.num(s.qty))", value: Binding(get: { s.qty }, set: { picked[it.orderItemId] = Pick(qty: min(it.remainingQty, max(1, $0)), restock: s.restock) }),
                                    in: 1...max(1, it.remainingQty))
                                .font(.system(size: 13.5, weight: .bold))
                            Text(NT.yen(amountFor(it, s.qty))).font(.system(size: 14, weight: NT.strong)).monospacedDigit()
                        }
                        Toggle("在庫を戻す", isOn: Binding(get: { s.restock }, set: { picked[it.orderItemId] = Pick(qty: s.qty, restock: $0) }))
                            .font(.system(size: 12.5)).tint(NT.purple)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func submit() async {
        problem = nil
        var body: [String: Any] = ["type": "slipRefund", "orderId": detail.id, "amount": effectiveAmount, "method": method, "reason": reason.trimmingCharacters(in: .whitespaces), "kind": kind]
        if kind == "refund" && mode == "items" { body["items"] = itemsPayload }
        let done = kind == "void" ? "取消を記録しました" : "返金を記録しました"
        if let e = await model.refund(body) { problem = e } else { onDone(done) }
    }
}
