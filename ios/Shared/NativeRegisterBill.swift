import Foundation

/// 会計伝票は、どのフロアの卓でもこの iPad のレシートプリンターで出す（いつも。設定の ON/OFF は無い）。
/// 2026-10-25 00:16 Ronnie「フロアのある店で受付は 4F。3F のお客様がレジに来て会計伝票を頼んだら、
/// レジ受付からどのフロアの会計伝票も出せるように。設定で」
/// → 2026-10-26 19:47 Ronnie「this is default setting, always on, tesaile option ma add garna pardaina」
///
/// サーバーから伝票の最新（品・金額）を読み、iPad の印字キットで会計伝票を作って、
/// この iPad のレシートプリンター（Bluetooth・LAN）へ直接送る（卓のフロアでは選ばない＝ tableId を渡さない）。
/// この iPad にレシートプリンターが決まっていない（管理画面の「設定 › レジ端末」）ときだけ、今まで通りサーバーの floorBill
/// （その卓のフロア担当のプリンター）。ハンディ代わりの iPad などは今まで通り。
/// 伝票の形はオフラインの会計伝票と同じ印字キット（lib/print-kit.ts の slipJob）。サーバーの印刷の仕組みは変えない
enum NativeRegisterBill {
    enum Outcome {
        case printed
        case failed(String)
        /// この iPad にレシートプリンターが無い → 呼ぶ側はサーバーの floorBill（その卓のフロアのプリンター）へ
        case noPrinter
    }

    @MainActor
    static func print(orderId: String, clerkName: String?) async -> Outcome {
        // この iPad のレシートプリンターが決まっていない（道具箱がまだ無いときも）→ 今まで通りその卓のフロアのプリンター
        guard NativePrintKit.shared.kit?.preferredReceiptPrinterId != nil else { return .noPrinter }
        guard let live = try? await NativeAPI.shared.loadLive(orderId: orderId) else { return .failed("伝票を読めませんでした") }
        let o = live.order
        let lines = o.lines.map { l in
            NativeOfflinePrint.SlipLine(name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
                                        modifiers: (l.options ?? []).map { NativeOfflinePrint.SlipLine.Modifier(name: $0, price: 0) })
        }
        guard !lines.isEmpty else { return .failed("印刷する注文明細がありません") }
        let totals = NativeOfflinePrint.SlipTotals(subtotal: o.subtotal, taxTotal: o.taxTotal, serviceCharge: o.serviceCharge, discount: o.discountTotal, total: o.total)
        let r = await NativeOfflinePrint.shared.orderSlip(orderNo: String(o.orderNo), tableId: nil, tableName: o.tableName, guestCount: o.guestCount,
                                                          clerkName: clerkName, openedAt: nil, lines: lines, totals: totals)
        guard let r else { return .noPrinter }
        return r.ok ? .printed : .failed("\(r.printerName)：\(r.code ?? "出せませんでした")")
    }
}
