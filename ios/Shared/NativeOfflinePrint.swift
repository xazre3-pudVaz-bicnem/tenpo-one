import Foundation

/// ネットが無いときの印字（2026-10-24 Ronnie「net nachale pani print haru sabai kam」）。
/// 印字キット（NativePrintKit）でバイト列・TicketDesign を作り、厨房伝票・取消伝票は NativeTicketRaster で画像にして、
/// この iPad から直接プリンターへ送る：
///   Bluetooth・USB でつないだ機械（この iPad の印刷の設定）→ BluetoothPrinters
///   お店の LAN のアドレスがある機械 → LanPrinters（TCP 9100）
/// サーバーを通らないので、ネットが無くても出る。どのプリンターに出すかはサーバーと同じ決まり（lib/native-offline-kit.ts）。
@MainActor
final class NativeOfflinePrint {
    static let shared = NativeOfflinePrint()
    private init() {}

    /// 印字キットが返すプリンター（lib/print-kit.ts の KitPrinter）
    struct KitPrinter: Codable {
        struct Lan: Codable { let host: String; let port: Int }
        let printerId: String
        let printerName: String
        let maker: String
        let paperWidth: Int
        let dots: Int
        let upsideDown: Bool
        let lan: Lan?
    }

    struct DesignJob: Decodable {
        let printer: KitPrinter
        let designs: [TicketDesign]
        let buzzer: String?
    }

    struct BytesJob: Decodable {
        let printer: KitPrinter
        let data: String
    }

    /// 1台に送った結果
    struct Outcome {
        let printerName: String
        let ok: Bool
        let code: String?
    }

    // MARK: - 伝票ごと

    struct KitchenOrder: Encodable {
        let id: String
        let orderNo: String
        let tableId: String?
        let tableName: String?
        let guestCount: Int?
        let clerkName: String?
    }

    struct KitchenLine: Encodable {
        struct Modifier: Encodable { let name: String; let name_en: String? }
        let menuItemId: String?
        let categoryId: String?
        let name: String
        let modifiers: [Modifier]
        let memo: String?
        /// 正＝作る数、負＝取消
        let delta: Int
        let cancelReason: String?
    }

    /// 厨房伝票（持ち場・フロアでプリンターに分けて、1枚ずつ画像で）
    func kitchen(order: KitchenOrder, lines: [KitchenLine]) async -> [Outcome] {
        struct In: Encodable { let order: KitchenOrder; let lines: [KitchenLine]; let printedAt: String }
        do {
            let jobs = try await NativePrintKit.shared.call("kitchenJobs", In(order: order, lines: lines, printedAt: Self.hm(Date())), as: [DesignJob].self)
            var out: [Outcome] = []
            for job in jobs { out.append(await sendDesigns(job)) }
            return out
        } catch {
            return [Outcome(printerName: "厨房", ok: false, code: error.localizedDescription)]
        }
    }

    struct CancelItem: Encodable {
        let name: String
        let quantity: Int
        let amount: Int
        let taxRate: Double
        let taxIncluded: Bool
        let modifiers: [String]
        let memo: String?
    }

    /// 取消会計伝票（レジ機へ）
    func cancelSlip(orderNo: String, tableName: String?, guestCount: Int?, staffName: String?, orderedAt: Date, cancelledBy: String?, reason: String?, items: [CancelItem]) async -> Outcome? {
        struct In: Encodable {
            let orderNo: String; let tableName: String?; let guestCount: Int?; let staffName: String?
            let orderedAt: String; let cancelledAt: String; let cancelledBy: String?; let reason: String?; let items: [CancelItem]
        }
        let input = In(orderNo: orderNo, tableName: tableName, guestCount: guestCount, staffName: staffName,
                       orderedAt: Self.ymdhm(orderedAt), cancelledAt: Self.ymdhm(Date()), cancelledBy: cancelledBy, reason: reason, items: items)
        do {
            guard let job = try await NativePrintKit.shared.call("cancelJob", input, as: DesignJob?.self) else { return nil }
            return await sendDesigns(job)
        } catch {
            return Outcome(printerName: "レジ", ok: false, code: error.localizedDescription)
        }
    }

    struct SlipLine: Encodable {
        struct Modifier: Encodable { let name: String; let price: Int }
        let name: String
        let quantity: Int
        let unitPrice: Int
        let lineTotal: Int
        let modifiers: [Modifier]
    }

    struct SlipTotals: Encodable {
        let subtotal: Int
        let taxTotal: Int
        let serviceCharge: Int
        let discount: Int
        let total: Int
    }

    /// 会計伝票（その卓のフロアのプリンターへ）
    func orderSlip(orderNo: String, tableId: String?, tableName: String?, guestCount: Int?, clerkName: String?, openedAt: Date?, lines: [SlipLine], totals: SlipTotals) async -> Outcome? {
        struct Slip: Encodable {
            let orderNo: String; let tableName: String?; let guestCount: Int?; let clerkName: String?
            let issuedAt: String; let startedAt: String?; let lines: [SlipLine]
            let subtotal: Int; let taxTotal: Int; let serviceCharge: Int; let discount: Int; let total: Int
        }
        struct In: Encodable { let slip: Slip; let tableId: String? }
        let slip = Slip(orderNo: orderNo, tableName: tableName, guestCount: guestCount, clerkName: clerkName,
                        issuedAt: Self.shortDateTime(Date()), startedAt: openedAt.map(Self.shortDateTime), lines: lines,
                        subtotal: totals.subtotal, taxTotal: totals.taxTotal, serviceCharge: totals.serviceCharge, discount: totals.discount, total: totals.total)
        do {
            guard let job = try await NativePrintKit.shared.call("slipJob", In(slip: slip, tableId: tableId), as: BytesJob?.self) else { return nil }
            return await sendBytes(job)
        } catch {
            return Outcome(printerName: "レジ", ok: false, code: error.localizedDescription)
        }
    }

    struct ReceiptInput: Encodable {
        struct Order: Encodable {
            let orderNo: String; let closedAt: String; let openedAt: String?
            let subtotal: Int; let taxTotal: Int; let serviceCharge: Int; let discountTotal: Int; let total: Int
        }
        struct Item: Encodable {
            struct Modifier: Encodable { let name: String; let price: Int }
            let name: String; let quantity: Int; let unitPrice: Int; let lineTotal: Int; let taxRate: Double; let modifiers: [Modifier]
        }
        struct Payment: Encodable { let method: String; let amount: Int; let tendered: Int?; let change: Int? }
        let order: Order
        let items: [Item]
        let payments: [Payment]
        let staffName: String?
        let guestCount: Int?
        let tableName: String?
    }

    /// レシート（レジ機へ）。drawer＝現金でドロアも開ける
    func receipt(_ receipt: ReceiptInput, drawer: Bool, print: Bool) async -> Outcome? {
        struct In: Encodable { let receipt: ReceiptInput; let drawer: Bool; let print: Bool }
        do {
            guard let job = try await NativePrintKit.shared.call("receiptJob", In(receipt: receipt, drawer: drawer, print: print), as: BytesJob?.self) else { return nil }
            return await sendBytes(job)
        } catch {
            return Outcome(printerName: "レジ", ok: false, code: error.localizedDescription)
        }
    }

    // MARK: - テスト（設定の「オフライン印刷のテスト」）

    /// 厨房機には見本の厨房伝票、レジ機には見本のレシート（キットと道具箱だけで。サーバーを通らない）
    func test() async -> [Outcome] {
        guard let kit = NativePrintKit.shared.kit else {
            return [Outcome(printerName: "—", ok: false, code: "お店のプリンターの情報がまだ保存されていません（一度ネットにつないでください）")]
        }
        var out: [Outcome] = []
        let order = KitchenOrder(id: "offline-test", orderNo: "TEST", tableId: nil, tableName: "TEST", guestCount: 2, clerkName: nil)
        // 持ち場ごとに1品ずつ（その持ち場の機械に出る）
        let stations = Set(kit.printers.filter { $0.usage == "kitchen" }.flatMap { $0.stations })
        if !stations.isEmpty {
            let lines = stations.sorted().map { st in
                KitchenLine(menuItemId: nil, categoryId: kitCategory(for: st), name: st == "drink" ? "テスト（ドリンク）" : "テスト（料理）",
                            modifiers: [], memo: "オフライン印刷のテスト", delta: 1, cancelReason: nil)
            }
            out += await kitchen(order: order, lines: lines)
        }
        let now = ISO8601DateFormatter().string(from: Date())
        let sample = ReceiptInput(
            order: .init(orderNo: "TEST", closedAt: now, openedAt: now, subtotal: 0, taxTotal: 0, serviceCharge: 0, discountTotal: 0, total: 0),
            items: [.init(name: "オフライン印刷のテスト", quantity: 1, unitPrice: 0, lineTotal: 0, taxRate: 10, modifiers: [])],
            payments: [.init(method: "cash", amount: 0, tendered: 0, change: 0)],
            staffName: nil, guestCount: nil, tableName: "TEST")
        if let r = await receipt(sample, drawer: false, print: true) { out.append(r) }
        return out
    }

    /// その持ち場のカテゴリ（見本の行の振り分け用）
    private func kitCategory(for station: String) -> String? {
        guard let data = NativeDiskCache.load("offline-kit"),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let map = obj["categoryStations"] as? [String: String] else { return nil }
        return map.first(where: { $0.value == station })?.key
    }

    // MARK: - 送る

    private func sendDesigns(_ job: DesignJob) async -> Outcome {
        let printer = job.printer
        let images: [RasterImage] = await Task.detached(priority: .userInitiated) {
            job.designs.compactMap { NativeTicketRaster.render($0, width: printer.dots, upsideDown: printer.upsideDown) }
        }.value
        guard images.count == job.designs.count else { return Outcome(printerName: printer.printerName, ok: false, code: "画像を作れませんでした") }
        struct In: Encodable { let images: [RasterImage]; let buzzer: String?; let maker: String }
        do {
            let b64 = try await NativePrintKit.shared.call("rasterBytes", String(decoding: try JSONEncoder().encode(In(images: images, buzzer: job.buzzer, maker: printer.maker)), as: UTF8.self))
            return await send(printer, b64)
        } catch {
            return Outcome(printerName: printer.printerName, ok: false, code: error.localizedDescription)
        }
    }

    private func sendBytes(_ job: BytesJob) async -> Outcome {
        await send(job.printer, job.data)
    }

    private func send(_ printer: KitPrinter, _ base64: String) async -> Outcome {
        guard let data = Data(base64Encoded: base64), !data.isEmpty else {
            return Outcome(printerName: printer.printerName, ok: false, code: "印刷データがありません")
        }
        // この iPad と Bluetooth・USB でつないでいる機械が先（レジのレシート機はたいていこれ）
        if let link = NativePrintConfig.shared.config.appLinks.first(where: { $0.printerId == printer.printerId }) {
            let (ok, code) = await withCheckedContinuation { (cont: CheckedContinuation<(Bool, String?), Never>) in
                BluetoothPrinters.shared.print(deviceId: link.deviceId, maker: link.maker, via: link.via == "usb" ? "usb" : "bluetooth", data: data) { ok, code in
                    cont.resume(returning: (ok, code))
                }
            }
            return Outcome(printerName: printer.printerName, ok: ok, code: ok ? nil : EposDirect.errorLabel(code))
        }
        if let lan = printer.lan {
            let (ok, code) = await withCheckedContinuation { (cont: CheckedContinuation<(Bool, String?), Never>) in
                LanPrinters.shared.print(host: lan.host, port: lan.port, data: data) { ok, code in cont.resume(returning: (ok, code)) }
            }
            return Outcome(printerName: printer.printerName, ok: ok, code: ok ? nil : Self.lanLabel(code))
        }
        return Outcome(printerName: printer.printerName, ok: false, code: "この iPad から直接送れません（LAN のアドレスか Bluetooth の設定が必要です）")
    }

    private static func lanLabel(_ code: String?) -> String {
        switch code {
        case "unreachable": return "プリンターにつながりません（電源・LAN・アドレスを確かめてください）"
        case "timeout_sent": return "送りましたが返事がありません（紙を確かめてください）"
        case "bad_host": return "お店の中のアドレスではありません"
        default: return code ?? "送れませんでした"
        }
    }

    // MARK: - 時刻の書き方（サーバーと同じ。日本時間）

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = format
        return f
    }
    private static let hmFormatter = formatter("HH:mm")
    private static let ymdhmFormatter = formatter("yyyy/MM/dd HH:mm")
    private static let shortFormatter = formatter("yyyy/MM/dd H:mm")

    static func hm(_ d: Date) -> String { hmFormatter.string(from: d) }
    static func ymdhm(_ d: Date) -> String { ymdhmFormatter.string(from: d) }
    static func shortDateTime(_ d: Date) -> String { shortFormatter.string(from: d) }
}
