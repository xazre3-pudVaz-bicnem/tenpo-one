import SwiftUI

// iPhone の店長・オーナー：レシートのプレビュー（Web の /app/pos/receipt/<伝票> の代わり。2026-10-25 12:49 Ronnie「レシートのプレビュー Native banau」）
// 読み込み・紙の見た目は iPad と同じ（NativeReceiptView.swift の NativeReceiptModel・NRReceiptPaper・NRInvoicePaper）。
// 操作は iPhone の伝票明細と同じものだけ：レシートの再印刷（POST slipReceipt。お店のレシートプリンターから出る）・
// 領収書（一度きり。NSRyoshushoSheet → POST slipRyoshusho）。iPhone 自身からは印刷しない（iPhone に印刷を足さない）。

struct NativePhoneOwnerReceiptView: View {
    @ObservedObject var model: NativeReceiptModel
    let onBack: () -> Void

    @State private var reprintConfirm = false
    @State private var ryoshushoOpen = false

    var body: some View {
        VStack(spacing: 0) {
            NPHTopBar(title: "レシート", subtitle: model.payload.map { "伝票 No.\($0.orderNo)" } ?? "Receipt", backLabel: model.fromOrders ? "伝票" : "ホーム", onBack: onBack) {
                Color.clear.frame(width: 44, height: 40)
            }
            ZStack(alignment: .bottom) {
                if let p = model.payload {
                    content(p)
                } else {
                    NOSStateView(error: model.error) { Task { await model.load() } }
                }
                NPHToast(text: $model.toast)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .confirmationDialog("レシートをもう一度印刷しますか？", isPresented: $reprintConfirm, titleVisibility: .visible) {
            Button("レシートを印刷する") { Task { await model.printReceipt() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("お店のレシートプリンターから出ます（「※再発行」の印字）。")
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

    private func content(_ p: NRcptPayload) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                NRTabSwitch(tab: $model.tab, height: 40)
                if model.tab == .receipt {
                    NRReceiptPaper(r: p.receipt, scale: 0.95)
                        .frame(maxWidth: 330)
                        .padding(.horizontal, 4)
                } else {
                    // 領収書は横長（印字と同じ形）。横に動かして見る
                    ScrollView(.horizontal, showsIndicators: true) {
                        NRInvoicePaper(invoice: p.invoice).frame(width: 640).padding(.vertical, 6).padding(.horizontal, 2)
                    }
                    Text("横に動かして全体を見られます。宛名は発行のときに入れます").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                }
                if let e = model.error {
                    Text(e).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger).frame(maxWidth: .infinity, alignment: .leading)
                }
                actions(p)
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 48)
        }
        .refreshable { await model.load() }
    }

    @ViewBuilder private func actions(_ p: NRcptPayload) -> some View {
        NPOCard {
            if model.tab == .receipt {
                if p.canPrint {
                    Button { reprintConfirm = true } label: { actionLabel(model.busy ? "印刷中…" : "レシートを再印刷", icon: "printer", filled: true) }
                        .buttonStyle(PressableStyle())
                        .disabled(model.busy)
                    hint("お店のレシートプリンターから出ます。")
                    if !p.printerReady {
                        hint("レシートプリンター（CloudPRNT）が登録されていません。設定 › プリンター で確かめてください。", color: NT.warn)
                    }
                } else {
                    hint("未会計の伝票です。会計が済むとレシートを印刷できます。")
                }
            } else {
                if model.ryoshushoIssued {
                    NRIssuedNotice(atLabel: p.ryoshusho.atLabel, count: p.ryoshusho.count, message: p.ryoshusho.message)
                } else if p.canRyoshusho {
                    Button { ryoshushoOpen = true } label: { actionLabel("領収書を発行", icon: "doc.text", filled: true) }
                        .buttonStyle(PressableStyle())
                    hint("領収書は一度しか発行できません。領収額 \(NT.yen(p.invoice.amount))（内消費税 \(NT.yen(p.invoice.tax))）")
                } else {
                    hint(p.status == "paid" ? "取消（VOID）のある伝票は領収書を発行できません。" : "会計済みの伝票だけ領収書を発行できます。")
                }
                if let note = p.invoice.invoiceNote { hint(note) }
            }
        }
    }

    private func actionLabel(_ t: String, icon: String, filled: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold))
            Text(t).font(.system(size: 15, weight: .heavy))
        }
        .foregroundColor(filled ? .white : NT.purpleDeep)
        .frame(maxWidth: .infinity).frame(height: 50)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(filled ? NT.purple : NT.lilac))
    }

    private func hint(_ t: String, color: Color = NT.ink3) -> some View {
        Text(t).font(.system(size: 12, weight: .semibold)).foregroundColor(color).fixedSize(horizontal: false, vertical: true)
    }
}

/// key "receipt" の画面（NativePhoneOwnerScreen から）
struct NativePhoneOwnerReceiptScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model: NativeReceiptModel

    init(route: NativeModuleRoute) {
        self.route = route
        _model = StateObject(wrappedValue: NativeReceiptModel(route: route))
    }

    var body: some View {
        NativePhoneOwnerReceiptView(model: model, onBack: {
            // 伝票明細から開いた → その伝票の詳細（iPhone の伝票明細）へ。それ以外はホーム
            if model.fromOrders, !model.orderId.isEmpty {
                state.leaveNativePhone(to: "/app/orders/\(model.orderId)")
            } else {
                state.closePhoneOwnerModule()
            }
        })
        .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }
}
