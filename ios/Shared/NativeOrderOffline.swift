import Foundation
import Combine

// オーダー・会計のオフライン（2026-10-24 Ronnie「net nachale pani sabai kam / net chalepaxi afai sync」）。
// ネットが無いとき（または同期待ちの伝票）は、サーバーの代わりに NativeOfflineStore に入れて、
// 厨房伝票・取消伝票・会計伝票・レシートは NativeOfflinePrint でこの iPad から直接出す。
// できること：注文（厨房へ）・取消・現金会計・会計伝票・担当者・来店経路。できないこと（ネットが戻ってから）：
// 値引き・分割・数量の変更（取消して入れ直す）・カード/QR・お客様情報の変更。

extension NativeOrderModel {
    /// オフラインで開くか（オフラインで始めた伝票・同期待ちの伝票・ネットが無い）
    func shouldOpenOffline(_ orderId: String) -> Bool {
        orderId.hasPrefix("off-") || NativeOfflineStore.shared.has(orderId) || !NativeNet.shared.online
    }

    /// 送る前に失敗した（サーバーに届いていない）通信か。届いたかもしれない（タイムアウト）ときは二重にしないため false
    static func notSent(_ error: Error?) -> Bool {
        guard let e = error as? URLError else { return false }
        return [.notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff].contains(e.code)
    }

    /// オフラインで開く：保存してあるメニュー＋（同期待ちの伝票 → 最後に読んだ伝票 → テーブル一覧の伝票）
    func loadOffline(_ orderId: String) {
        offline = true
        watchSync()
        guard let catalog = NativeCatalogCache.shared.load() else {
            notice = "メニューがまだこの iPad に保存されていません（一度ネットにつないでください）"
            loading = false
            return
        }
        applyCatalogForOffline(catalog)
        let floor = NativeDiskCache.load(NFPayload.self, key: "floor")
        if let o = NativeOfflineStore.shared.order(orderId) {
            offlineStoreId = o.storeId
            offlineTableId = o.tableId
            if offlineBase == nil { offlineBase = o.base }
            if approvers.isEmpty { approvers = (floor?.approvers ?? []).map { APIClerk(id: $0.id, name: $0.name) } }
            applyOffline(o)
            // 来店登録で選んだプラン商品はカートへ（スライドで厨房へ。送るまでは開くたびに入る。サーバーの来店登録と同じく未送信）
            for id in NativeOfflineStore.shared.pendingPlans(orderId) where !cartLines.contains(where: { $0.menuItemId == id }) {
                if let item = items.first(where: { $0.id == id }) { add(item) }
            }
        } else if let saved = NativeDiskCache.load(APILive.self, key: "live-\(orderId)"), saved.order.id == orderId {
            offlineBase = saved.order
            offlineStoreId = saved.storeId
            offlineTableId = floor?.tables.first { $0.order?.slips.contains { $0.id == orderId } == true }?.id
            approvers = saved.approvers ?? []
            applyServerSnapshot(saved.order)
        } else if let floor, let built = Self.orderFromFloor(floor, orderId: orderId, items: items) {
            offlineBase = built.order
            offlineStoreId = floor.store.id
            offlineTableId = built.tableId
            approvers = floor.approvers.map { APIClerk(id: $0.id, name: $0.name) }
            applyServerSnapshot(built.order)
            notice = "オフラインです。この伝票はテーブル一覧の中身から出しています（値段はメニューの値段・選択肢の追加料金は入っていません。会計の前に金額を確かめてください）"
        } else {
            notice = "オフラインです。この伝票はまだ開いたことがないので、ネットが戻るまで開けません"
        }
        notice = notice ?? "オフラインです。注文・取消・現金会計はこの iPad でできます（ネットが戻ると自動で送ります）"
        loading = false
        markLoadedForOffline()
    }

    /// ネットが切れた（または送れなかった）：いまの伝票の中身でオフラインに入る
    func enterOffline() {
        guard !offline, let orderId else { return }
        offline = true
        watchSync()
        if offlineBase == nil { offlineBase = currentAsAPIOrder() }
        if offlineStoreId == nil { offlineStoreId = storeId ?? NativeCatalogCache.shared.load()?.store.id }
        if offlineTableId == nil {
            offlineTableId = NativeDiskCache.load(NFPayload.self, key: "floor")?.tables.first { $0.order?.slips.contains { $0.id == orderId } == true }?.id
        }
        if approvers.isEmpty, let floor = NativeDiskCache.load(NFPayload.self, key: "floor") {
            approvers = floor.approvers.map { APIClerk(id: $0.id, name: $0.name) }
        }
        toast = "オフラインに切り替えました（この iPad で続けられます）"
    }

    /// 同期でサーバーの伝票になったら入れ替える／ネットが戻ったら読み直す
    func watchSync() {
        guard offlineSinks.isEmpty else { return }
        NativeOfflineStore.shared.synced.receive(on: RunLoop.main).sink { [weak self] old, new in
            guard let self, self.orderId == old else { return }
            // プラン商品はサーバーに未送信の品として入った：カートから外す（二重に送らない）
            for plan in NativeOfflineStore.shared.takeSyncedPlans(old) {
                if let i = self.order.lines.firstIndex(where: { $0.local && $0.menuItemId == plan }) {
                    if self.order.lines[i].quantity > 1 { self.order.lines[i].quantity -= 1 } else { self.order.lines.remove(at: i) }
                }
            }
            self.orderId = new
            self.offline = false
            self.notice = nil
            Task { await self.load() }
        }.store(in: &offlineSinks)
        NativeNet.shared.$cameBackAt.dropFirst().receive(on: RunLoop.main).sink { [weak self] at in
            guard let self, at != nil, self.offline, let id = self.orderId, !NativeOfflineStore.shared.has(id), !id.hasPrefix("off-") else { return }
            // 何も触っていない伝票：そのままオンラインに戻る
            self.offline = false
            self.notice = nil
            Task { await self.load() }
        }.store(in: &offlineSinks)
    }

    // MARK: - 表示

    /// サーバーの伝票（最後に読んだもの）をそのまま出す
    private func applyServerSnapshot(_ o: APIOrder) {
        let cart = cartLines
        order = NPOrder(
            id: o.id, orderNo: o.orderNo, tableName: o.tableName ?? "", guestCount: o.guestCount,
            customerName: o.customerName, seatFrom: o.seatFrom, seatTo: o.seatTo, clerkName: nil,
            lines: o.lines.map {
                NPOrderLine(id: $0.id, menuItemId: $0.menuItemId, name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, sent: $0.sent,
                            optionNames: $0.options ?? [], optionNamesEn: $0.optionsEn ?? [], english: englishOf($0.menuItemId))
            } + cart,
            visitSourceId: o.visitSourceId, serviceCharge: o.serviceCharge, discountTotal: o.discountTotal,
            discountReason: o.discountReason, clerkId: o.clerkId,
            serverSubtotal: o.subtotal, serverTax: o.taxTotal, serverTotal: o.total,
            takeoutLike: ["takeout", "delivery", "pre_order"].contains(o.orderType),
            sourceRequired: o.sourceRequired ?? false
        )
    }

    /// 同期待ちの伝票（サーバーの中身＋オフラインで入れた品・取消）を出す
    func applyOffline(_ o: OfflineOrder) {
        let cart = cartLines
        let baseLines = o.activeBaseLines().map {
            NPOrderLine(id: $0.id, menuItemId: $0.menuItemId, name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, sent: true,
                        optionNames: $0.options ?? [], optionNamesEn: $0.optionsEn ?? [], english: englishOf($0.menuItemId))
        }
        let offLines = o.activeLines.map {
            NPOrderLine(id: $0.id, menuItemId: $0.menuItemId, name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, sent: true,
                        optionNames: $0.optionNames, optionNamesEn: $0.optionNamesEn, english: $0.english)
        }
        let t = offlineTotals(o)
        let draftSource: String? = {
            guard let j = o.draftJSON, let d = try? JSONSerialization.jsonObject(with: Data(j.utf8)) as? [String: Any],
                  let s = d["source"] as? String, !s.isEmpty else { return nil }
            return s
        }()
        order = NPOrder(
            id: o.id, orderNo: o.local ? (o.localNo ?? 0) : (o.base?.orderNo ?? 0), tableName: o.tableName ?? o.base?.tableName ?? "",
            guestCount: o.guestCount, customerName: o.base?.customerName, seatFrom: o.base?.seatFrom, seatTo: o.base?.seatTo,
            clerkName: o.clerkName, lines: baseLines + offLines + cart,
            visitSourceId: o.visitSourceId, serviceCharge: t.serviceCharge, discountTotal: o.discountTotal,
            discountReason: o.base?.discountReason, clerkId: o.clerkId,
            serverSubtotal: t.subtotal, serverTax: t.tax, serverTotal: t.total,
            takeoutLike: false,
            // オフラインで始めた卓は、来店登録で来店経路を選んでいなければ会計で選ぶ（サーバーと同じ）
            sourceRequired: o.local ? draftSource == nil : (o.base?.sourceRequired ?? false),
            offlineNo: o.local ? o.number : nil
        )
    }

    /// 伝票の合計（サーバーの recalc_order_totals と同じ。税は保存した道具箱の商品から）
    func offlineTotals(_ o: OfflineOrder) -> OfflineTotals {
        let kit = NativePrintKit.shared.kit
        var rows: [(lineTotal: Int, taxRate: Double, taxIncluded: Bool)] = o.activeBaseLines().map { l in
            let item = l.menuItemId.flatMap { kit?.items[$0] }
            return (l.lineTotal, item?.taxRate ?? 10, item?.taxIncluded ?? true)
        }
        rows += o.activeLines.map { ($0.lineTotal, $0.taxRate, $0.taxIncluded) }
        return OfflineMath.totals(rows, serviceRate: kit?.serviceChargeRate ?? 0, discount: o.discountTotal)
    }

    /// いまの伝票（オフラインの保存に入れる。サーバーの伝票のとき）
    private func currentAsAPIOrder() -> APIOrder {
        APIOrder(
            id: order.id, orderNo: order.orderNo, orderType: order.takeoutLike ? "takeout" : "dine_in", tableName: order.tableName,
            guestCount: order.guestCount, clerkId: order.clerkId, customerName: order.customerName, seatFrom: order.seatFrom, seatTo: order.seatTo,
            visitSourceId: order.visitSourceId, sourceRequired: order.sourceRequired,
            subtotal: order.serverSubtotal ?? 0, taxTotal: order.serverTax ?? 0, serviceCharge: order.serviceCharge, discountTotal: order.discountTotal,
            discountReason: order.discountReason, total: order.serverTotal ?? 0,
            lines: order.lines.filter { !$0.local }.map {
                APILine(id: $0.id, menuItemId: $0.menuItemId, name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, lineTotal: $0.lineTotal,
                        sent: $0.sent, options: $0.optionNames, optionsEn: $0.optionNamesEn)
            }
        )
    }

    /// テーブル一覧に保存してある伝票から（値段はメニューから。開いたことの無い伝票のとき）
    static func orderFromFloor(_ floor: NFPayload, orderId: String, items: [NPMenuItem]) -> (order: APIOrder, tableId: String)? {
        for t in floor.tables {
            guard let o = t.order, let slip = o.slips.first(where: { $0.id == orderId }) else { continue }
            let lines = slip.lines.map { l -> APILine in
                let price = items.first { $0.id == l.menuItemId }?.price ?? 0
                return APILine(id: l.id, menuItemId: l.menuItemId, name: l.name, quantity: l.quantity, unitPrice: price, lineTotal: price * l.quantity,
                               sent: true, options: nil, optionsEn: nil)
            }
            let order = APIOrder(
                id: slip.id, orderNo: slip.orderNo, orderType: "dine_in", tableName: t.name, guestCount: slip.guestCount, clerkId: nil,
                customerName: o.customerName, seatFrom: nil, seatTo: nil, visitSourceId: nil, sourceRequired: false,
                subtotal: slip.total, taxTotal: 0, serviceCharge: 0, discountTotal: 0, discountReason: nil, total: slip.total, lines: lines
            )
            return (order, t.id)
        }
        return nil
    }

    // MARK: - 操作

    /// 見るだけ（会計伝票を出す）：保存があればそれ、無ければ保存しないで今の中身から（何も触っていない伝票を同期待ちにしない）
    private func offlineSnapshot() -> OfflineOrder? {
        guard let orderId else { return nil }
        if let o = NativeOfflineStore.shared.order(orderId) { return o }
        guard let base = offlineBase ?? (orderId.hasPrefix("off-") ? nil : currentAsAPIOrder()) else { return nil }
        return OfflineOrder(id: base.id, local: false, localNo: nil, storeId: offlineStoreId ?? storeId ?? "", tableId: offlineTableId,
                            tableName: base.tableName, guestCount: base.guestCount, clerkId: base.clerkId, visitSourceId: base.visitSourceId,
                            base: base, openedAt: Date(), discountTotal: base.discountTotal)
    }

    /// この伝票の保存（無ければ作る）
    private func offlineEntry() -> OfflineOrder? {
        guard let orderId else { return nil }
        let store = NativeOfflineStore.shared
        if let o = store.order(orderId) { return o }
        guard let base = offlineBase ?? (orderId.hasPrefix("off-") ? nil : currentAsAPIOrder()),
              let storeId = offlineStoreId ?? storeId ?? NativeCatalogCache.shared.load()?.store.id else { return nil }
        return store.ensure(serverOrder: base, storeId: storeId, tableId: offlineTableId)
    }

    private func kitchenOrder(_ o: OfflineOrder) -> NativeOfflinePrint.KitchenOrder {
        NativeOfflinePrint.KitchenOrder(id: o.id, orderNo: o.number, tableId: o.tableId ?? offlineTableId, tableName: order.tableName.isEmpty ? nil : order.tableName,
                                        guestCount: order.guestCount, clerkName: clerkName)
    }

    private func report(_ outcomes: [NativeOfflinePrint.Outcome], what: String) {
        let bad = outcomes.filter { !$0.ok }
        if !bad.isEmpty {
            notice = "\(what)を出せませんでした：" + bad.map { "\($0.printerName)（\($0.code ?? "")）" }.joined(separator: "、")
        }
    }

    /// 注文確定（オフライン）：保存して、厨房伝票をこの iPad から出す
    func sendOffline() async -> Bool {
        guard let entry = offlineEntry() else {
            notice = "オフラインでこの伝票に入れられません（伝票の中身が保存されていません）"
            return false
        }
        var merged: [NPOrderLine] = []
        for l in cartLines where l.menuItemId != nil || l.custom != nil {
            if let i = merged.firstIndex(where: { $0.cartKey == l.cartKey }) { merged[i].quantity += l.quantity } else { merged.append(l) }
        }
        guard !merged.isEmpty else { return true }
        let kit = NativePrintKit.shared.kit
        let now = Date()
        var lines: [OfflineLine] = []
        for l in merged {
            let item = l.menuItemId.flatMap { kit?.items[$0] }
            let optionPrices: [Int] = l.optionItemIds.map { id in
                (optionGroups[l.menuItemId ?? ""] ?? []).flatMap { $0.items }.first { $0.id == id }?.price ?? 0
            }
            var unit = l.unitPrice
            if let mid = l.menuItemId, l.openPrice == nil, l.custom == nil {
                // 時間帯の値段（ハッピーアワーなど）はサーバーと同じ計算で
                struct In: Encodable { let menuItemId: String; let optionExtra: Int; let at: String }
                if let p = try? await NativePrintKit.shared.call("unitPrice", In(menuItemId: mid, optionExtra: optionPrices.reduce(0, +), at: ISO8601DateFormatter().string(from: now)), as: Int?.self) {
                    unit = p
                }
            }
            lines.append(OfflineLine(
                id: UUID().uuidString.lowercased(), menuItemId: l.custom == nil ? l.menuItemId : nil, categoryId: l.custom?.categoryId,
                name: l.name, english: l.english, quantity: l.quantity, unitPrice: unit,
                taxRate: item?.taxRate ?? 10, taxIncluded: item?.taxIncluded ?? true,
                optionItemIds: l.optionItemIds, optionNames: l.optionNames, optionNamesEn: l.optionNamesEn, optionPrices: optionPrices,
                openPrice: l.openPrice, customMemo: l.custom?.memo, isCustom: l.custom != nil, at: now))
        }
        NativeOfflineStore.shared.addLines(entry.id, lines)
        if entry.local { NativeOfflineStore.shared.plansSent(entry.id) }
        order.lines.removeAll { $0.local }
        if let o = NativeOfflineStore.shared.order(entry.id) { applyOffline(o) }
        // 厨房伝票（持ち場・フロアでプリンターに分けて）
        let kitchenLines = lines.map { l in
            NativeOfflinePrint.KitchenLine(
                menuItemId: l.menuItemId, categoryId: l.categoryId ?? items.first { $0.id == l.menuItemId }?.categoryId,
                name: l.isCustom ? (l.customMemo ?? "その他") : l.name,
                modifiers: zip(l.optionNames, l.optionNamesEn + Array(repeating: "", count: max(0, l.optionNames.count - l.optionNamesEn.count))).map {
                    NativeOfflinePrint.KitchenLine.Modifier(name: $0.0, name_en: $0.1.isEmpty || $0.1 == $0.0 ? nil : $0.1)
                },
                memo: nil, delta: l.quantity, cancelReason: nil)
        }
        let outcomes = await NativeOfflinePrint.shared.kitchen(order: kitchenOrder(NativeOfflineStore.shared.order(entry.id) ?? entry), lines: kitchenLines)
        report(outcomes, what: "厨房伝票")
        toast = "注文を入れました（オフライン）"
        return true
    }

    /// 1品の取消（オフライン）：保存して、厨房の取消伝票とレジの取消伝票を出す
    func cancelOffline(_ line: NPOrderLine, approver: String?, reason: String) async -> Bool {
        guard let entry = offlineEntry() else {
            notice = "オフラインでこの伝票の品を取り消せません"
            return false
        }
        let isOfflineLine = entry.lines.contains { $0.id == line.id }
        let approverName = approver.flatMap { id in approvers.first { $0.id == id }?.name }
        let why = reason.isEmpty ? (approverName.map { "担当: \($0)" } ?? "") : reason
        NativeOfflineStore.shared.cancel(entry.id, lineId: line.id, serverLine: !isOfflineLine, name: line.name, quantity: line.quantity, reason: reason, approverId: approver)
        guard let o = NativeOfflineStore.shared.order(entry.id) else { return false }
        applyOffline(o)
        let off = o.lines.first { $0.id == line.id }
        let kit = NativePrintKit.shared.kit
        let item = line.menuItemId.flatMap { kit?.items[$0] }
        var outcomes = await NativeOfflinePrint.shared.kitchen(order: kitchenOrder(o), lines: [
            NativeOfflinePrint.KitchenLine(
                menuItemId: line.menuItemId, categoryId: off?.categoryId ?? items.first { $0.id == line.menuItemId }?.categoryId, name: line.name,
                modifiers: line.optionNames.enumerated().map { i, n in
                    NativeOfflinePrint.KitchenLine.Modifier(name: n, name_en: i < line.optionNamesEn.count && line.optionNamesEn[i] != n ? line.optionNamesEn[i] : nil)
                },
                memo: nil, delta: -line.quantity, cancelReason: why.isEmpty ? nil : why),
        ])
        if let r = await NativeOfflinePrint.shared.cancelSlip(
            orderNo: o.number, tableName: order.tableName.isEmpty ? nil : order.tableName, guestCount: order.guestCount, staffName: clerkName,
            orderedAt: off?.at ?? o.openedAt, cancelledBy: approverName, reason: why.isEmpty ? nil : why,
            items: [.init(name: line.name, quantity: line.quantity, amount: line.lineTotal, taxRate: off?.taxRate ?? item?.taxRate ?? 10,
                          taxIncluded: off?.taxIncluded ?? item?.taxIncluded ?? true, modifiers: line.optionNames, memo: nil)]
        ) { outcomes.append(r) }
        report(outcomes, what: "取消伝票")
        toast = "「\(line.displayName)」を取消しました（オフライン）"
        return true
    }

    func setClerkOffline(_ id: String?) {
        guard let entry = offlineEntry() else { order.clerkId = id; return }
        NativeOfflineStore.shared.setClerk(entry.id, clerkId: id, name: clerks.first { $0.id == id }?.name)
        if let o = NativeOfflineStore.shared.order(entry.id) { applyOffline(o) }
    }

    func setVisitSourceOffline(_ id: String?) {
        guard let entry = offlineEntry() else { order.visitSourceId = id; return }
        NativeOfflineStore.shared.setVisitSource(entry.id, id)
        if let o = NativeOfflineStore.shared.order(entry.id) { applyOffline(o) }
    }

    /// 品目（レシート・会計伝票）
    private func receiptItems(_ o: OfflineOrder) -> [NativeOfflinePrint.ReceiptInput.Item] {
        let kit = NativePrintKit.shared.kit
        let base = o.activeBaseLines().map { l in
            NativeOfflinePrint.ReceiptInput.Item(name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
                                                 taxRate: l.menuItemId.flatMap { kit?.items[$0]?.taxRate } ?? 10,
                                                 modifiers: (l.options ?? []).map { .init(name: $0, price: 0) })
        }
        let off = o.activeLines.map { l in
            NativeOfflinePrint.ReceiptInput.Item(name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, taxRate: l.taxRate,
                                                 modifiers: zip(l.optionNames, l.optionPrices + Array(repeating: 0, count: max(0, l.optionNames.count - l.optionPrices.count))).map { .init(name: $0.0, price: $0.1) })
        }
        return base + off
    }

    /// 会計（オフライン）：現金だけ。保存して、レシート（自動印刷のとき）とドロア
    func checkoutOffline(payments: [NPPaymentRow], memo: String) async -> Bool {
        if payments.contains(where: { $0.method != .cash }) {
            notice = "オフラインでは現金の会計だけできます（カード・QR はネットが戻ってから）"
            return false
        }
        // まだ送っていない品は、会計の前に厨房へ（サーバーの会計と同じ）
        if !cartLines.isEmpty {
            guard await sendOffline() else { return false }
        }
        guard let entry = offlineEntry() else {
            notice = "オフラインでこの伝票を会計できません"
            return false
        }
        let t = offlineTotals(entry)
        let tendered = payments.reduce(0) { $0 + $1.tendered }
        guard tendered >= t.total else {
            notice = "お預かり金額が足りません"
            return false
        }
        let now = Date()
        let pay = OfflinePayment(method: "cash", amount: t.total, tendered: tendered, change: tendered - t.total)
        NativeOfflineStore.shared.checkout(entry.id, OfflineCheckout(payments: [pay], memo: memo, total: t.total, subtotal: t.subtotal, tax: t.tax,
                                                                     serviceCharge: t.serviceCharge, at: now))
        guard let o = NativeOfflineStore.shared.order(entry.id) else { return false }
        let iso = ISO8601DateFormatter()
        let receipt = NativeOfflinePrint.ReceiptInput(
            order: .init(orderNo: o.number, closedAt: iso.string(from: now), openedAt: iso.string(from: o.openedAt),
                         subtotal: t.subtotal, taxTotal: t.tax, serviceCharge: t.serviceCharge, discountTotal: o.discountTotal, total: t.total),
            items: receiptItems(o),
            payments: [.init(method: "cash", amount: t.total, tendered: tendered, change: tendered - t.total)],
            staffName: clerkName, guestCount: order.guestCount, tableName: order.tableName.isEmpty ? nil : order.tableName)
        offlineReceipt = receipt
        notice = nil
        let drawer = NativePrintKit.shared.kit?.drawer.autoOpenOnCash ?? true
        if let r = await NativeOfflinePrint.shared.receipt(receipt, drawer: drawer, print: nil), !r.ok {
            notice = "会計は完了しました（オフライン）。レシート・ドロア：\(r.printerName)（\(r.code ?? "")）"
        }
        lastReceipt = nil
        return true
    }

    func reprintOfflineReceipt() async -> Bool {
        guard let r = offlineReceipt else { return false }
        return await NativeOfflinePrint.shared.receipt(r, drawer: false, print: true)?.ok ?? false
    }

    /// 会計伝票（オフライン）
    func printBillOffline() async {
        guard let entry = offlineSnapshot() else {
            notice = "オフラインでこの伝票の会計伝票を出せません"
            return
        }
        let t = offlineTotals(entry)
        let lines = receiptItems(entry).map {
            NativeOfflinePrint.SlipLine(name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice, lineTotal: $0.lineTotal,
                                        modifiers: $0.modifiers.map { .init(name: $0.name, price: $0.price) })
        }
        let r = await NativeOfflinePrint.shared.orderSlip(
            orderNo: entry.number, tableId: entry.tableId ?? offlineTableId, tableName: order.tableName.isEmpty ? nil : order.tableName,
            guestCount: order.guestCount, clerkName: clerkName, openedAt: entry.openedAt, lines: lines,
            totals: .init(subtotal: t.subtotal, taxTotal: t.tax, serviceCharge: t.serviceCharge, discount: entry.discountTotal, total: t.total))
        if let r, !r.ok { notice = "お会計伝票を出せませんでした：\(r.printerName)（\(r.code ?? "")）" } else if r != nil { toast = "お会計伝票を印刷します（オフライン）" }
    }
}
