import Foundation

// テーブル一覧のオフライン（2026-10-24 Ronnie「net nachale pani sabai kam」）。
// 保存してあるテーブル一覧に、この iPad がオフラインで受けた伝票を重ねて出す
// （オフラインで始めた卓は着席中、オフラインで会計・クリアした卓は空席）。
// ネットが無いときの操作：卓の開始・会計伝票・テーブルクリア（品の無い卓）。ほかはネットが戻ってから。

extension NFActionResult {
    static func local(ok: Bool, error: String? = nil, orderId: String? = nil, cancelledItems: Int? = nil) -> NFActionResult {
        NFActionResult(ok: ok, error: error, orderId: orderId, planItemError: nil, cancelledItems: cancelledItems, alreadyResolved: nil,
                       released: nil, queued: nil, useWeb: nil, prints: nil)
    }
}

extension NFTable {
    fileprivate func with(order: NFOrder?, status: String) -> NFTable {
        NFTable(id: id, floorId: floorId, name: name, capacityMin: capacityMin, capacityMax: capacityMax, isPrivateRoom: isPrivateRoom,
                isCounter: isCounter, currentStatus: status, posX: posX, posY: posY, shape: shape, order: order, upcoming: upcoming,
                groupTableIds: groupTableIds, groupTableNames: groupTableNames, calls: calls)
    }
}

extension NFOrder {
    fileprivate func with(slips: [NFSlip], total: Int, guestCount: Int) -> NFOrder {
        NFOrder(id: id, openedAtMs: openedAtMs, guestCount: guestCount, total: total, customerName: customerName, visitCount: visitCount,
                guestName: guestName, sourceLabel: sourceLabel, clerkName: clerkName, course: course, endAtMs: endAtMs, courseId: courseId,
                plans: plans, slips: slips)
    }
}

enum NativeFloorOffline {
    /// 保存してあるテーブル一覧に、オフラインの伝票を重ねる
    @MainActor
    static func overlay(_ tables: [NFTable], storeId: String?, stayMinutes: Int) -> [NFTable] {
        let store = NativeOfflineStore.shared
        let mine = store.orders.filter { storeId == nil || $0.storeId == storeId }
        guard !mine.isEmpty else { return tables }
        let model = OfflineTotalsCalc()
        var out = tables
        for o in mine {
            if o.local {
                guard !o.closed, let tid = o.tableId, let i = out.firstIndex(where: { $0.id == tid }) else { continue }
                let total = model.total(o)
                let opened = o.openedAt.timeIntervalSince1970 * 1000
                let minutes = draftMinutes(o) ?? stayMinutes
                let slip = NFSlip(id: o.id, orderNo: o.localNo ?? 0, openedAtMs: opened, guestCount: o.guestCount, total: total,
                                  lines: o.activeLines.map { NFLine(id: $0.id, name: $0.name, quantity: $0.quantity, menuItemId: $0.menuItemId) })
                if let existing = out[i].order {
                    let slips = existing.slips + [slip]
                    out[i] = out[i].with(order: existing.with(slips: slips, total: slips.reduce(0) { $0 + $1.total }, guestCount: existing.guestCount + o.guestCount),
                                         status: "seated")
                } else {
                    let order = NFOrder(id: o.id, openedAtMs: opened, guestCount: o.guestCount, total: total, customerName: nil, visitCount: nil,
                                        guestName: nil, sourceLabel: "オフライン", clerkName: o.clerkName, course: nil,
                                        endAtMs: opened + Double(minutes) * 60_000, courseId: nil, plans: nil, slips: [slip])
                    out[i] = out[i].with(order: order, status: "seated")
                }
            } else {
                guard let i = out.firstIndex(where: { $0.order?.slips.contains { $0.id == o.id } == true }), let existing = out[i].order else { continue }
                var slips = existing.slips
                if o.closed {
                    slips.removeAll { $0.id == o.id }
                } else if let si = slips.firstIndex(where: { $0.id == o.id }) {
                    let s = slips[si]
                    let lines = o.activeBaseLines().map { NFLine(id: $0.id, name: $0.name, quantity: $0.quantity, menuItemId: $0.menuItemId) }
                        + o.activeLines.map { NFLine(id: $0.id, name: $0.name, quantity: $0.quantity, menuItemId: $0.menuItemId) }
                    slips[si] = NFSlip(id: s.id, orderNo: s.orderNo, openedAtMs: s.openedAtMs, guestCount: o.guestCount, total: model.total(o), lines: lines)
                }
                if slips.isEmpty {
                    out[i] = out[i].with(order: nil, status: "available")
                } else {
                    out[i] = out[i].with(order: existing.with(slips: slips, total: slips.reduce(0) { $0 + $1.total }, guestCount: existing.guestCount),
                                         status: out[i].currentStatus)
                }
            }
        }
        return out
    }

    private static func draftMinutes(_ o: OfflineOrder) -> Int? {
        guard let j = o.draftJSON, let d = try? JSONSerialization.jsonObject(with: Data(j.utf8)) as? [String: Any],
              d["timed"] as? Bool == true, let m = d["duration"] as? Int, m > 0 else { return nil }
        return m
    }
}

/// 卓の箱に出す合計（NativeOrderModel.offlineTotals と同じ計算）
@MainActor
private struct OfflineTotalsCalc {
    let kit = NativePrintKit.shared.kit
    func total(_ o: OfflineOrder) -> Int {
        var rows: [(lineTotal: Int, taxRate: Double, taxIncluded: Bool)] = o.activeBaseLines().map { l in
            let item = l.menuItemId.flatMap { kit?.items[$0] }
            return (l.lineTotal, item?.taxRate ?? 10, item?.taxIncluded ?? true)
        }
        rows += o.activeLines.map { ($0.lineTotal, $0.taxRate, $0.taxIncluded) }
        return OfflineMath.totals(rows, serviceRate: kit?.serviceChargeRate ?? 0, discount: o.discountTotal).total
    }
}

extension NativeFloorModel {
    /// ネットが無いときの卓の操作。この iPad でできないものは「ネットが戻ってから」
    func offlineAct(_ body: [String: Any]) async -> NFActionResult {
        let type = body["type"] as? String ?? ""
        switch type {
        case "floorStart":
            guard let tableId = body["tableId"] as? String, let table = tables.first(where: { $0.id == tableId }),
                  let storeId = payload?.store.id, let draft = body["draft"] as? [String: Any] else {
                return .local(ok: false, error: "オフラインで卓を始められませんでした")
            }
            guard NativeCatalogCache.shared.load() != nil else {
                return .local(ok: false, error: "メニューがまだこの iPad に保存されていません（一度ネットにつないでください）")
            }
            let guests = ((draft["male"] as? Int) ?? 0) + ((draft["female"] as? Int) ?? 0)
            let o = NativeOfflineStore.shared.startLocal(storeId: storeId, tableId: tableId, tableName: table.name, guestCount: max(1, guests), draft: draft)
            return .local(ok: true, orderId: o.id)
        case "floorBill":
            guard let orderId = body["orderId"] as? String else { return .local(ok: false, error: "伝票がありません") }
            let m = NativeOrderModel(orderId: orderId)
            m.loadOffline(orderId)
            await m.printBillOffline()
            if let n = m.notice, n.contains("出せません") { return .local(ok: false, error: n) }
            return .local(ok: true)
        case "floorClear":
            guard let orderId = body["orderId"] as? String else { return .local(ok: false, error: "伝票がありません") }
            let store = NativeOfflineStore.shared
            let approver = body["approvedByClerkId"] as? String
            if store.order(orderId) == nil, !orderId.hasPrefix("off-") {
                // サーバーの伝票（品の無い卓）：最後に読んだ中身で保存してからクリア
                let m = NativeOrderModel(orderId: orderId)
                m.loadOffline(orderId)
                guard let base = m.offlineBase, let storeId = m.offlineStoreId ?? payload?.store.id else {
                    return .local(ok: false, error: "オフラインでこの卓をクリアできません（ネットが戻ってから）")
                }
                store.ensure(serverOrder: base, storeId: storeId, tableId: m.offlineTableId)
            }
            store.clear(orderId, reason: (body["reason"] as? String) ?? "", approverId: approver)
            return .local(ok: true, cancelledItems: 0)
        default:
            return .local(ok: false, error: "オフラインではできません（ネットが戻ってから）")
        }
    }
}
