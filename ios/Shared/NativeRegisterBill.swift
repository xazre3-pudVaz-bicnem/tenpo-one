import Foundation

/// レジ受付で、どのフロアの卓の会計伝票もこの iPad のレシートプリンターで出す（端末ごとの設定。既定 OFF）。
/// 2026-10-25 00:16 Ronnie「フロアのある店で受付は 4F。3F のお客様がレジに来て会計伝票を頼んだら、
/// レジ受付からどのフロアの会計伝票も出せるように。設定で」
///
/// ON のとき：サーバーから伝票の最新（品・金額）を読み、iPad の印字キットで会計伝票を作って、
/// この iPad のレシートプリンター（Bluetooth・LAN）へ直接送る（卓のフロアでは選ばない＝ tableId を渡さない）。
/// OFF のとき：今まで通りサーバーの floorBill（その卓のフロア担当のプリンター）。
/// 伝票の形はオフラインの会計伝票と同じ印字キット（lib/print-kit.ts の slipJob）。サーバーの印刷の仕組みは変えない
enum NativeRegisterBill {
    private static let key = "tenpo.billSlipsAtRegister"

    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// 出したら nil、出せなかったら理由
    @MainActor
    static func print(orderId: String, clerkName: String?) async -> String? {
        guard let live = try? await NativeAPI.shared.loadLive(orderId: orderId) else { return "伝票を読めませんでした" }
        let o = live.order
        let lines = o.lines.map { l in
            NativeOfflinePrint.SlipLine(name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
                                        modifiers: (l.options ?? []).map { NativeOfflinePrint.SlipLine.Modifier(name: $0, price: 0) })
        }
        guard !lines.isEmpty else { return "印刷する注文明細がありません" }
        let totals = NativeOfflinePrint.SlipTotals(subtotal: o.subtotal, taxTotal: o.taxTotal, serviceCharge: o.serviceCharge, discount: o.discountTotal, total: o.total)
        let r = await NativeOfflinePrint.shared.orderSlip(orderNo: String(o.orderNo), tableId: nil, tableName: o.tableName, guestCount: o.guestCount,
                                                          clerkName: clerkName, openedAt: nil, lines: lines, totals: totals)
        guard let r else { return "この iPad のレシートプリンターがありません（設定 › ハードウェア）" }
        return r.ok ? nil : "\(r.printerName)：\(r.code ?? "出せませんでした")"
    }
}
