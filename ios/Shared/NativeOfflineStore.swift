import Foundation
import Combine

// ネットが無いあいだのレジ（2026-10-24 Ronnie「net nachale pani sabai kam garna sakne / net chalepaxi afai sync」）。
// レジの iPad 1台だけで：卓の開始・注文（厨房伝票）・現金会計（レシート）・会計伝票・取消・テーブルクリア。
// 受けたものはここ（Application Support/tenpo-cache/offline-store.json）に残し、ネットが戻ったら1伝票ずつ
// サーバーへ送る（POST type=offlineSync。lib/native-offline-sync-server.ts。何度送っても二重にならない）。
// 金額の計算はサーバーと同じ決まり（lib/native-offline-kit.ts の offlineTotals）。

/// オフラインで入れた品
struct OfflineLine: Codable, Identifiable, Hashable {
    /// 端末で付けた id（UUID。同期で二重にしないための印）
    let id: String
    let menuItemId: String?
    /// 「その他（金額入力）」のカテゴリ
    let categoryId: String?
    let name: String
    let english: String?
    var quantity: Int
    /// 単価（税込の表示価格・選択肢こみ）
    let unitPrice: Int
    let taxRate: Double
    let taxIncluded: Bool
    let optionItemIds: [String]
    let optionNames: [String]
    let optionNamesEn: [String]
    let optionPrices: [Int]
    let openPrice: Int?
    /// 「その他」の内容（nil でなければ「その他」の行）
    let customMemo: String?
    let isCustom: Bool
    let at: Date
    var cancelled = false

    var lineTotal: Int { unitPrice * quantity }
}

/// オフラインで取り消したサーバーの品（オフラインで入れた品は OfflineLine.cancelled）
struct OfflineCancel: Codable, Hashable {
    /// サーバーの明細 id、またはオフラインの品の id
    let lineId: String
    let serverLine: Bool
    let name: String
    let quantity: Int
    let reason: String
    let approverId: String?
    let at: Date
}

struct OfflinePayment: Codable, Hashable {
    let method: String
    let amount: Int
    let tendered: Int
    let change: Int
}

struct OfflineCheckout: Codable, Hashable {
    let payments: [OfflinePayment]
    let memo: String
    let total: Int
    let subtotal: Int
    let tax: Int
    let serviceCharge: Int
    let at: Date
}

/// オフラインのあいだに触った伝票（オフラインで始めた伝票、またはサーバーの伝票）
struct OfflineOrder: Codable, Identifiable {
    /// サーバーの伝票 id、またはオフラインで始めた伝票の off-<uuid>
    let id: String
    let local: Bool
    /// オフラインで始めた伝票の番号（OFF-1, OFF-2 …）
    let localNo: Int?
    let storeId: String
    var tableId: String?
    var tableName: String?
    var guestCount: Int
    var clerkId: String?
    var clerkName: String?
    var visitSourceId: String?
    /// 来店登録の中身（オフラインで始めた伝票。サーバーの startRegisterVisit に渡す）
    var draftJSON: String?
    /// オフラインになったときのサーバーの伝票（サーバーの伝票のとき）
    var base: APIOrder?
    var lines: [OfflineLine] = []
    var cancels: [OfflineCancel] = []
    var checkout: OfflineCheckout?
    var cleared: OfflineCancel?
    let openedAt: Date
    var discountTotal: Int = 0
    var syncError: String?
    var syncTries = 0
    /// 自動ではもう送らない（合計が合わないなど、人が見る必要があるとき。設定の「もう一度送る」で送る）
    var blocked: Bool?
    /// 来店登録で選んだプラン商品（飲み放題など）。オーダー画面を開くたびにカートに入れ、厨房へ送ったら消す（サーバーの来店登録と同じく未送信）
    var pendingPlanItemIds: [String]?
    /// 変えた回数（同期のあいだに変わったら、送ったあとも残してもう一度送る）
    var rev: Int?
    /// サーバーの伝票をオフラインで触りはじめたときの印（同期の記録の鍵。触りはじめるたびに別）
    var syncKey: String?

    var clientId: String { local ? String(id.dropFirst(4)) : (syncKey ?? id) }
    var number: String { local ? "OFF-\(localNo ?? 0)" : "\(base?.orderNo ?? 0)" }
    var closed: Bool { checkout != nil || cleared != nil }

    /// 今の品（サーバーの品で取り消していないもの＋オフラインで入れた品で取り消していないもの）
    func activeBaseLines() -> [APILine] {
        let gone = Set(cancels.filter { $0.serverLine }.map(\.lineId))
        return (base?.lines ?? []).filter { !gone.contains($0.id) }
    }
    var activeLines: [OfflineLine] { lines.filter { !$0.cancelled } }
}

@MainActor
final class NativeOfflineStore: ObservableObject {
    static let shared = NativeOfflineStore()
    private static let key = "offline-store"

    @Published private(set) var orders: [OfflineOrder] = []
    @Published private(set) var syncing = false
    /// 最後に同期で困ったこと
    @Published private(set) var lastError: String?
    /// 送れたけれど確かめてほしいこと（端数調整・そのまま入れた品など。設定に出す。消すまで残る）
    @Published private(set) var notes: [String] = []
    /// 送れなかった伝票がある（帯に出す。起動し直しても）
    var hasProblems: Bool { orders.contains { $0.syncError != nil } }
    /// オフラインの伝票が同期でサーバーの伝票になった（off-… → サーバーの id）。開いている画面が入れ替える
    let synced = PassthroughSubject<(String, String), Never>()

    private struct Saved: Codable { var orders: [OfflineOrder]; var nextNo: Int; var noDay: String; var notes: [String]? }
    private var nextNo = 1
    private var noDay = ""
    private var netSink: AnyCancellable?
    private var timer: Timer?

    private init() {
        loadSaved()
        netSink = NativeNet.shared.$cameBackAt.dropFirst().sink { [weak self] at in
            guard at != nil else { return }
            Task { @MainActor in
                // 戻った直後は回線が落ち着かないことがあるので少し待つ
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                await self?.syncAll()
            }
        }
        // 起動したときに残っていれば送る
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await self?.syncAll()
        }
        // 送れなかった伝票は30秒ごとにもう一度（ネットが戻った知らせが来ないこともある）
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, !self.orders.isEmpty, NativeNet.shared.online else { return }
                await self.syncAll()
            }
        }
    }

    /// 保存を読む。1つの伝票が読めなくてもほかは捨てない（読めなかったときは元のファイルを別名で残す）
    private func loadSaved() {
        guard let data = NativeDiskCache.load(Self.key) else { return }
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // 読めない：上書きする前に別名で残す
            NativeDiskCache.save(data, key: "\(Self.key)-backup-\(Int(Date().timeIntervalSince1970))")
            return
        }
        nextNo = obj["nextNo"] as? Int ?? 1
        noDay = obj["noDay"] as? String ?? ""
        notes = obj["notes"] as? [String] ?? []
        var bad = false
        for raw in (obj["orders"] as? [Any]) ?? [] {
            if let d = try? JSONSerialization.data(withJSONObject: raw), let o = try? JSONDecoder().decode(OfflineOrder.self, from: d) {
                orders.append(o)
            } else {
                bad = true
            }
        }
        if bad { NativeDiskCache.save(data, key: "\(Self.key)-backup-\(Int(Date().timeIntervalSince1970))") }
    }

    private func save() {
        NativeDiskCache.save(Saved(orders: orders, nextNo: nextNo, noDay: noDay, notes: notes), key: Self.key)
    }

    func clearNotes() {
        notes = []
        save()
    }

    /// 人が確かめて、この iPad の伝票を消す（送れなかった伝票を Web で直したあと）
    func discard(_ id: String) {
        orders.removeAll { $0.id == id }
        save()
        synced.send((id, id))
    }

    /// まだサーバーに入れていない伝票の数
    var pendingCount: Int { orders.count }

    func order(_ id: String) -> OfflineOrder? { orders.first { $0.id == id } }
    func has(_ id: String) -> Bool { orders.contains { $0.id == id } }

    /// 中身を変える（変えた回数を進める）
    private func update(_ id: String, _ change: (inout OfflineOrder) -> Void) {
        guard let i = orders.firstIndex(where: { $0.id == id }) else { return }
        change(&orders[i])
        orders[i].rev = (orders[i].rev ?? 0) + 1
        save()
    }

    /// 同期の記録だけ変える（変えた回数は進めない）
    private func mark(_ id: String, _ change: (inout OfflineOrder) -> Void) {
        guard let i = orders.firstIndex(where: { $0.id == id }) else { return }
        change(&orders[i])
        save()
    }

    // MARK: - 作る

    /// オフラインで卓を始める（来店登録の中身は同期のときにサーバーへ）
    func startLocal(storeId: String, tableId: String, tableName: String, guestCount: Int, draft: [String: Any]) -> OfflineOrder {
        let today = Self.dayString(Date())
        if noDay != today { noDay = today; nextNo = 1 }
        var d = draft
        // 開始時刻：選んだ時刻（今日の HH:mm。先の時刻なら昨日）か、いま（同期した時刻にしない）
        var opened = Date()
        if let hm = d["startTime"] as? String, let t = Self.resolveHm(hm) { opened = t } else { d["startTime"] = Self.hm(opened) }
        let json = (try? JSONSerialization.data(withJSONObject: d)).map { String(decoding: $0, as: UTF8.self) }
        var o = OfflineOrder(id: "off-" + UUID().uuidString.lowercased(), local: true, localNo: nextNo, storeId: storeId,
                             tableId: tableId, tableName: tableName, guestCount: guestCount, draftJSON: json, openedAt: opened)
        o.pendingPlanItemIds = (draft["planItemIds"] as? [String]) ?? []
        nextNo += 1
        orders.append(o)
        save()
        return o
    }

    /// サーバーの伝票をオフラインで触りはじめる（オフラインになったときの中身を残す）
    @discardableResult
    func ensure(serverOrder base: APIOrder, storeId: String, tableId: String?) -> OfflineOrder {
        if let o = order(base.id) { return o }
        var o = OfflineOrder(id: base.id, local: false, localNo: nil, storeId: storeId, tableId: tableId, tableName: base.tableName,
                             guestCount: base.guestCount, clerkId: base.clerkId, visitSourceId: base.visitSourceId, base: base,
                             openedAt: Date(), discountTotal: base.discountTotal)
        o.syncKey = UUID().uuidString.lowercased()
        orders.append(o)
        save()
        return o
    }

    // MARK: - 操作

    func addLines(_ id: String, _ lines: [OfflineLine]) {
        update(id) { $0.lines += lines }
    }

    func cancel(_ id: String, lineId: String, serverLine: Bool, name: String, quantity: Int, reason: String, approverId: String?) {
        update(id) { o in
            if serverLine {
                o.cancels.append(OfflineCancel(lineId: lineId, serverLine: true, name: name, quantity: quantity, reason: reason, approverId: approverId, at: Date()))
            } else if let i = o.lines.firstIndex(where: { $0.id == lineId }) {
                o.lines[i].cancelled = true
                o.cancels.append(OfflineCancel(lineId: lineId, serverLine: false, name: name, quantity: quantity, reason: reason, approverId: approverId, at: Date()))
            }
        }
    }

    /// まだ厨房へ送っていないプラン商品（カートに入れる。消すのは送ったとき）
    func pendingPlans(_ id: String) -> [String] { order(id)?.pendingPlanItemIds ?? [] }
    func plansSent(_ id: String) { mark(id) { $0.pendingPlanItemIds = [] } }

    func setClerk(_ id: String, clerkId: String?, name: String?) { update(id) { $0.clerkId = clerkId; $0.clerkName = name } }
    func setVisitSource(_ id: String, _ sourceId: String?) { update(id) { $0.visitSourceId = sourceId } }
    func checkout(_ id: String, _ c: OfflineCheckout) { update(id) { $0.checkout = c } }

    /// テーブルクリア（品の無い卓）。オフラインで始めた伝票は消すだけ（いまサーバーへ送っている最中なら、クリアとして送る）
    func clear(_ id: String, reason: String, approverId: String?) {
        guard let o = order(id) else { return }
        if o.local && o.activeLines.isEmpty && o.lines.isEmpty && inFlightId != id {
            orders.removeAll { $0.id == id }
            save()
            return
        }
        update(id) { $0.cleared = OfflineCancel(lineId: id, serverLine: false, name: "", quantity: 0, reason: reason, approverId: approverId, at: Date()) }
    }

    /// 品を1つも入れずに戻った、オフラインで始めた伝票（卓を空席に戻す）
    func discardIfEmpty(_ id: String) {
        guard let o = order(id), o.local, o.lines.isEmpty, !o.closed, (o.pendingPlanItemIds ?? []).isEmpty else { return }
        if inFlightId == id {
            // サーバーへ送っている最中：伝票ができるので、クリアとして送る
            clear(id, reason: "", approverId: nil)
            return
        }
        orders.removeAll { $0.id == id }
        save()
    }

    // MARK: - 同期（ネットが戻ったら）

    /// 1伝票ずつ送る。失敗した伝票は残して次へ（つながらないときはそこで止める）
    /// 届いたかどうか分からない通信（タイムアウト）のあとは少し待つ（サーバーがまだ入れている最中かもしれない。サーバーの札は6分）
    private var waitUntil: [String: Date] = [:]
    /// いまサーバーへ送っている伝票
    private(set) var inFlightId: String?
    /// 同期で送ったプラン商品（開いているオーダー画面のカートから外す。サーバーに未送信の品として入った）
    private(set) var syncedPlans: [String: [String]] = [:]
    func takeSyncedPlans(_ id: String) -> [String] { syncedPlans.removeValue(forKey: id) ?? [] }

    func syncAll(force: Bool = false) async {
        guard !syncing, NativeNet.shared.online, !orders.isEmpty else { return }
        syncing = true
        defer { syncing = false }
        var problems: [String] = []
        outer: for id in orders.map(\.id) {
            // 送るあいだにも画面で変わることがあるので、送るたびに今の中身を読む。変わっていたらもう一度（サーバーは入れ済みの所を飛ばす）
            for _ in 0..<3 {
                guard let o = order(id), force || o.blocked != true else { continue outer }
                if !force, let w = waitUntil[id], w > Date() { continue outer }
                // 何も触っていない（会計伝票を出しただけ等の）サーバーの伝票は捨てて、開いている画面をオンラインに戻す
                if !o.local && o.lines.isEmpty && o.cancels.isEmpty && !o.closed && o.visitSourceId == o.base?.visitSourceId && o.clerkId == o.base?.clerkId {
                    orders.removeAll { $0.id == id }
                    save()
                    synced.send((id, id))
                    continue outer
                }
                let sentRev = o.rev ?? 0
                inFlightId = id
                defer { inFlightId = nil }
                do {
                    let r = try await NativeAPI.shared.offlineSync(body(for: o))
                    if r.ok, let serverId = r.orderId {
                        if let w = r.warnings, !w.isEmpty { addNote("\(o.number)：\(w.joined(separator: " / "))") }
                        if (order(id)?.rev ?? 0) != sentRev {
                            // 送っているあいだに品・会計が増えた：残してもう一度
                            mark(id) { $0.syncError = nil }
                            continue
                        }
                        if o.local, let plans = o.pendingPlanItemIds, !plans.isEmpty { syncedPlans[id] = plans }
                        orders.removeAll { $0.id == id }
                        save()
                        waitUntil[id] = nil
                        // 古い伝票の保存は捨てる（次に開くときサーバーの中身を読む）
                        NativeDiskCache.remove("live-\(id)")
                        synced.send((id, serverId))
                    } else {
                        // 人が見る必要があるもの（retry:false）だけ止める。一時的なもの（レジが閉まっている・ほかの通信が入れている）は30秒ごとに
                        mark(id) {
                            $0.syncError = r.error ?? "送れませんでした"
                            $0.syncTries += 1
                            if r.retry == false { $0.blocked = true }
                        }
                        problems.append("\(o.number)：\(r.error ?? "送れませんでした")")
                    }
                } catch {
                    if let e = error as? URLError, e.code == .timedOut || e.code == .networkConnectionLost {
                        // 届いたかもしれない：サーバーが入れ終わるまで少し待ってから（サーバーの札が6分なので）
                        waitUntil[id] = Date().addingTimeInterval(370)
                    }
                    if NativeNet.isOfflineError(error) { break outer }
                    mark(id) { $0.syncError = error.localizedDescription; $0.syncTries += 1 }
                    problems.append("\(o.number)：\(error.localizedDescription)")
                }
                continue outer
            }
        }
        lastError = problems.isEmpty ? nil : problems.joined(separator: "\n")
    }

    private func addNote(_ text: String) {
        notes.append(text)
        if notes.count > 30 { notes.removeFirst(notes.count - 30) }
        save()
    }

    private func body(for o: OfflineOrder) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var order: [String: Any] = [
            "clientId": o.clientId,
            "storeId": o.storeId,
            "serverOrderId": o.local ? NSNull() : o.id,
            "tableId": o.local ? (o.tableId ?? NSNull()) as Any : NSNull(),
            "localNo": o.local ? o.number : NSNull(),
            "openedAt": o.local ? iso.string(from: o.openedAt) : NSNull(),
            "planItemIds": o.local ? (o.pendingPlanItemIds ?? []) : [],
            "clerkId": (o.clerkId != o.base?.clerkId || o.local) ? (o.clerkId ?? NSNull()) as Any : NSNull(),
            "visitSourceId": (o.visitSourceId != o.base?.visitSourceId || o.local) ? (o.visitSourceId ?? NSNull()) as Any : NSNull(),
        ]
        if o.local, let j = o.draftJSON, let d = try? JSONSerialization.jsonObject(with: Data(j.utf8)) { order["draft"] = d }
        order["lines"] = o.lines.map { l -> [String: Any] in
            var d: [String: Any] = [
                "clientLineId": l.id, "optionItemIds": l.optionItemIds, "quantity": l.quantity, "unitPrice": l.unitPrice,
                "openPrice": l.openPrice.map { $0 as Any } ?? NSNull(), "at": iso.string(from: l.at),
            ]
            if l.isCustom {
                d["menuItemId"] = NSNull()
                d["custom"] = ["categoryId": l.categoryId.map { $0 as Any } ?? NSNull(), "price": l.unitPrice, "memo": l.customMemo.map { $0 as Any } ?? NSNull()] as [String: Any]
            } else {
                d["menuItemId"] = l.menuItemId ?? NSNull()
                d["custom"] = NSNull()
            }
            return d
        }
        order["cancels"] = o.cancels.map { c -> [String: Any] in
            [
                "ref": c.serverLine ? ["kind": "server", "lineId": c.lineId] : ["kind": "client", "clientLineId": c.lineId],
                "reason": c.reason, "approvedByClerkId": c.approverId.map { $0 as Any } ?? NSNull(), "at": iso.string(from: c.at),
            ]
        }
        order["cleared"] = o.cleared.map { c -> Any in
            ["reason": c.reason, "approvedByClerkId": c.approverId.map { $0 as Any } ?? NSNull(), "at": iso.string(from: c.at)] as [String: Any]
        } ?? NSNull()
        order["checkout"] = o.checkout.map { c -> Any in
            [
                "payments": c.payments.map { ["method": $0.method, "amount": $0.amount, "tendered": $0.tendered] },
                "memo": c.memo, "at": iso.string(from: c.at), "total": c.total,
            ] as [String: Any]
        } ?? NSNull()
        return ["type": "offlineSync", "order": order]
    }

    // MARK: - 時刻

    private static func formatter(_ f: String) -> DateFormatter {
        let d = DateFormatter()
        d.locale = Locale(identifier: "ja_JP")
        d.timeZone = TimeZone(identifier: "Asia/Tokyo")
        d.dateFormat = f
        return d
    }
    private static let dayF = formatter("yyyy-MM-dd")
    private static let hmF = formatter("HH:mm")
    static func dayString(_ d: Date) -> String { dayF.string(from: d) }

    /// 今日の HH:mm（日本時間）。今より5分以上先なら昨日
    static func resolveHm(_ hm: String) -> Date? {
        let parts = hm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        guard var d = cal.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) else { return nil }
        if d > Date().addingTimeInterval(300) { d = cal.date(byAdding: .day, value: -1, to: d) ?? d }
        return d
    }
    static func hm(_ d: Date) -> String { hmF.string(from: d) }
}

/// 同期の返事
struct OfflineSyncResult: Decodable {
    let ok: Bool
    let orderId: String?
    let error: String?
    let warnings: [String]?
    let retry: Bool?
}

extension NativeAPI {
    func offlineSync(_ body: [String: Any]) async throws -> OfflineSyncResult {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 40
        do {
            let data = try await send(req, kickPrint: false)
            return try JSONDecoder().decode(OfflineSyncResult.self, from: data)
        } catch let e as NativeAPIError {
            // ログイン切れ・サーバーの不調など：あとでもう一度（止めない）
            return OfflineSyncResult(ok: false, orderId: nil, error: e.message, warnings: nil, retry: true)
        }
    }
}

// MARK: - 合計（サーバーの recalc_order_totals と同じ。lib/native-offline-kit.ts の offlineTotals）

struct OfflineTotals {
    let subtotal: Int
    let tax: Int
    let serviceCharge: Int
    let total: Int
}

enum OfflineMath {
    static func totals(_ lines: [(lineTotal: Int, taxRate: Double, taxIncluded: Bool)], serviceRate: Double, discount: Int) -> OfflineTotals {
        var gross = 0
        var tax = 0
        for l in lines {
            var g = l.lineTotal
            let t: Int
            let rate = Int(l.taxRate.rounded())
            if l.taxIncluded {
                t = g - Int(floor(Double(g * 100) / Double(100 + rate)))
            } else {
                t = Int(floor(Double(g * rate) / 100))
                g += t
            }
            gross += g
            tax += t
        }
        let service = serviceRate > 0 ? Int(floor(Double(gross) * serviceRate / 100)) : 0
        return OfflineTotals(subtotal: gross - tax, tax: tax, serviceCharge: service, total: max(0, gross + service - discount))
    }
}
