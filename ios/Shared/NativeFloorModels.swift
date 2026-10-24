import Foundation
import SwiftUI

// ネイティブのフロア（テーブル一覧）画面のデータ（2026-10-24 Ronnie「レジは全部ネイティブに。Native ON ならネイティブだけ」）。
// サーバー（/api/app/v1/pos?part=floor。lib/native-floor-server.ts）の形をそのまま受ける。
// 卓の状態・残り時間の決め方は Web の components/floor/types.ts と同じ。

struct NFFloor: Codable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct NFLine: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: Int
    let menuItemId: String?
}

struct NFSlip: Codable, Identifiable, Hashable {
    let id: String
    let orderNo: Int
    let openedAtMs: Double
    let guestCount: Int
    let total: Int
    let lines: [NFLine]
}

struct NFCourse: Codable, Hashable {
    let label: String
    let minutes: Int
}

struct NFOrder: Codable, Hashable {
    let id: String
    let openedAtMs: Double
    let guestCount: Int
    let total: Int
    let customerName: String?
    let visitCount: Int?
    let guestName: String?
    let sourceLabel: String
    let clerkName: String?
    let course: NFCourse?
    let endAtMs: Double
    let courseId: String?
    /// モード（アラカルト・飲み放題…。伝票メモから）。無ければ nil
    let plans: [String]?
    let slips: [NFSlip]
}

struct NFUpcoming: Codable, Identifiable, Hashable {
    let id: String
    let startMs: Double
    let time: String
    let name: String
    let partySize: Int
    let sourceLabel: String
}

struct NFCall: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let createdAt: String
    let note: String?
}

struct NFTable: Codable, Identifiable, Hashable {
    let id: String
    let floorId: String?
    let name: String
    let capacityMin: Int
    let capacityMax: Int
    let isPrivateRoom: Bool
    let isCounter: Bool
    let currentStatus: String
    let posX: Int?
    let posY: Int?
    let shape: String
    let order: NFOrder?
    let upcoming: [NFUpcoming]
    let groupTableIds: [String]
    let groupTableNames: [String]
    let calls: [NFCall]

    enum CodingKeys: String, CodingKey {
        case id, name, shape, order, upcoming, groupTableIds, groupTableNames, calls
        case floorId = "floor_id"
        case capacityMin = "capacity_min"
        case capacityMax = "capacity_max"
        case isPrivateRoom = "is_private_room"
        case isCounter = "is_counter"
        case currentStatus = "current_status"
        case posX = "pos_x"
        case posY = "pos_y"
    }
}

struct NFReservation: Codable, Identifiable, Hashable {
    let id: String
    let startMs: Double
    let time: String
    let name: String
    let partySize: Int
    let tableLabel: String
    let status: String
    let createdToday: Bool
}

struct NFSeatCourse: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let durationMinutes: Int?
}

struct NFPlanItem: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let price: Int
    let durationMinutes: Int?
    /// drink / buffet / food / course
    let kind: String
}

struct NFNamed: Codable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct NFSource: Codable, Identifiable, Hashable {
    let id: String
    let label: String
}

struct NFPayload: Codable {
    let store: NFNamed
    let serverNow: Double
    let stayMinutes: Int
    let defaultFloorId: String?
    let floors: [NFFloor]
    let tables: [NFTable]
    let reservations: [NFReservation]
    let seatCourses: [NFSeatCourse]
    let planItems: [NFPlanItem]
    let plans: [NFNamed]
    let visitSources: [NFSource]
    let approvers: [NFNamed]
    let canOperate: Bool
}

/// フロアの操作の返事
struct NFActionResult: Decodable {
    let ok: Bool
    let error: String?
    let orderId: String?
    let planItemError: String?
    let cancelledItems: Int?
    let alreadyResolved: Bool?
    let released: Int?
    let queued: Int?
    let useWeb: Bool?
    /// テーブルクリアのあと、iPad から LAN で直接出す厨房の取消伝票
    let prints: [APIPrintJob]?
}

// MARK: - 卓の状態（Web の tileState と同じ）

enum NFTileState: String {
    case free, reserved, waiting, seated, ordered, lo, over, pay, cleaning, unavailable

    /// 日本語 / English（Web の TILE_LABEL と同じ）
    var label: String {
        switch self {
        case .free: return "空席 / Free"
        case .reserved: return "予約あり / Reserved"
        case .waiting: return "キャンセル待ち / Waitlist"
        case .seated: return "着席中 / Seated"
        case .ordered: return "注文済 / Ordered"
        case .lo: return "L.O.済 / Last order"
        case .over: return "時間超過 / Over time"
        case .pay: return "会計待ち / To pay"
        case .cleaning: return "清掃中 / Cleaning"
        case .unavailable: return "利用停止 / Closed"
        }
    }
}

struct NFTileTime {
    let elapsed: Int
    let limit: Int
    let left: Int
    /// 残り時間の割合（0〜1）
    let frac: Double
}

/// L.O.（ラストオーダー）とみなす残り時間（分）
let NF_LAST_ORDER_WARN_MINUTES = 30
/// 予約の「次」表示の対象: 開始から30分以内の遅れまでは「次」として出す
let NF_UPCOMING_GRACE_MS: Double = 30 * 60_000

extension NFOrder {
    func tileTime(now: Double) -> NFTileTime {
        let elapsed = max(0, Int(((now - openedAtMs) / 60_000).rounded(.down)))
        let limit = max(1, Int(((endAtMs - openedAtMs) / 60_000).rounded()))
        let left = Int(((endAtMs - now) / 60_000).rounded(.up))
        return NFTileTime(elapsed: elapsed, limit: limit, left: left, frac: max(0, min(1, Double(left) / Double(limit))))
    }

    /// 伝票メモに無ければコースの有無で決める（お客様情報の初期値）
    var plansOrDefault: [String] { plans ?? (courseId != nil ? ["course"] : ["normal"]) }
}

extension NFTable {
    func nextReservation(now: Double) -> NFUpcoming? {
        upcoming.first { $0.startMs >= now - NF_UPCOMING_GRACE_MS }
    }

    func state(now: Double) -> NFTileState {
        let s = currentStatus
        // 会計が済むまで、その卓は同じお客様として扱う。未会計の伝票がある卓は、卓の状態が「清掃中」「使用不可」でもお客様が入っている扱い
        if order == nil && s == "unavailable" { return .unavailable }
        if order == nil && s == "cleaning" { return .cleaning }
        if s == "billing" { return .pay }
        guard let o = order else {
            if s == "seated" || s == "ordering" { return .seated }
            if s == "waiting" { return .waiting }
            if s == "reserved" { return .reserved }
            return .free
        }
        let tt = o.tileTime(now: now)
        if tt.left <= 0 { return .over }
        if tt.left <= NF_LAST_ORDER_WARN_MINUTES { return .lo }
        return o.total > 0 ? .ordered : .seated
    }

    /// 連携（同じ伝票の卓）。2卓以上のときだけ
    var linkedNames: [String]? { groupTableNames.count > 1 ? groupTableNames : nil }

    /// お客様が入っている（伝票がある・着席中・会計待ち）
    func isSeated(now: Double) -> Bool {
        let st = state(now: now)
        return (order?.slips.isEmpty == false) || st == .seated || st == .ordered || st == .lo || st == .over || st == .pay || currentStatus == "seated" || currentStatus == "ordering" || currentStatus == "billing"
    }
}

// MARK: - 色（Web のレジの「オーダー・会計」の青。lib/regi-accent.ts の order）

enum NFColor {
    static let iris = Color(hex: 0x1A5AD6)
    static let irisDeep = Color(hex: 0x0A3FA8)
    static let irisSoft = Color(hex: 0xE7EFFD)
    static let royal = Color(hex: 0x0A3FA8)
    static let wisteria = Color(hex: 0xBCD0F5)
    static let saffron = Color(hex: 0xB7791F)
    static let saffronSoft = Color(hex: 0xFBF1D9)
    static let lo = Color(hex: 0xE0AE00)
    static let loSoft = Color(hex: 0xFFFBEB)
    static let loInk = Color(hex: 0x8A6100)
    static let danger = Color(hex: 0xC62828)
    static let dangerSoft = Color(hex: 0xFDECEC)
    static let success = Color(hex: 0x1E8F62)
    static let successSoft = Color(hex: 0xDFF3EA)
    static let lilac = Color(hex: 0xF3EFE8)
    static let lilacSoft = Color(hex: 0xFBF9F5)
    static let line = Color(hex: 0xE5DFD5)
    static let ink = Color(hex: 0x292725)
    static let ink2 = Color(hex: 0x5C5650)
    static let ink3 = Color(hex: 0x766B62)
    static let navy = Color(hex: 0x292725)
    static let navySoft = Color(hex: 0x45403B)
    static let callOrange = Color(hex: 0xEE853E)
    static let callDeep = Color(hex: 0xB44814)
    static let callSoft = Color(hex: 0xFFF1E6)
    static let callInk = Color(hex: 0x842F0B)

    /// フロアの地（Apple 風の白。2026-10-24 Ronnie「背景を白に」）
    static let floorBg = Color.white
    /// 卓の箱の角
    static let tileRadius: CGFloat = 18
    /// 空席の「＋」
    static let tileIcon = Color(hex: 0x8E8E93)

    /// 卓の箱の地（白い背景の上で見分けがつく色。空席・予約は薄いグレー、使用中は白＋影、L.O.・超過・会計待ちは薄い色）
    static func tileSurface(_ s: NFTileState) -> Color {
        switch s {
        case .free, .waiting: return Color(hex: 0xF2F2F7)
        case .reserved: return irisSoft
        case .cleaning, .unavailable: return Color(hex: 0xEDEDF0)
        case .seated, .ordered: return Color(hex: 0xF5F5F8)
        default: return surface(s)
        }
    }

    /// 3D の台（カードの下に見える一段濃い色）
    static func tileEdge(_ s: NFTileState) -> Color {
        switch s {
        case .free, .waiting: return Color(hex: 0xD3D3DA)
        case .reserved: return Color(hex: 0xBFD0F2)
        case .lo: return Color(hex: 0xEBD58A)
        case .over: return Color(hex: 0xEDB9B9)
        case .pay: return Color(hex: 0xE3C88F)
        case .cleaning, .unavailable: return Color(hex: 0xD0D0D6)
        default: return Color(hex: 0xDCDCE3)
        }
    }

    /// 3D のカードの上側（下へ向かって tileSurface に変わる）
    static func tileFaceTop(_ s: NFTileState) -> Color {
        switch s {
        case .free, .waiting: return Color(hex: 0xFBFBFD)
        case .reserved: return Color(hex: 0xF4F8FF)
        case .lo: return Color(hex: 0xFFFEF6)
        case .over: return Color(hex: 0xFFF7F7)
        case .pay: return Color(hex: 0xFFFBF1)
        case .cleaning, .unavailable: return Color(hex: 0xF6F6F8)
        default: return .white
        }
    }

    /// 卓の箱の地の色（Web の SURFACE）
    static func surface(_ s: NFTileState) -> Color {
        switch s {
        case .lo: return loSoft
        case .over: return dangerSoft
        case .pay: return saffronSoft
        case .cleaning, .unavailable: return lilacSoft
        default: return .white
        }
    }

    /// 状態の文字の色（Web の LABEL_COLOR）
    static func label(_ s: NFTileState) -> Color {
        switch s {
        case .free: return ink3
        case .reserved, .waiting, .seated: return royal
        case .ordered: return iris
        case .lo: return loInk
        case .over: return danger
        case .pay: return saffron
        case .cleaning: return ink2
        case .unavailable: return ink3
        }
    }

    /// 残り時間の線の色（Web の BAR_COLOR。既定は iris）
    static func bar(_ s: NFTileState) -> Color {
        switch s {
        case .lo: return lo
        case .over: return danger
        case .pay: return saffron
        default: return iris
        }
    }
}

// MARK: - 時刻の表示

enum NFTime {
    private static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "HH:mm"
        return f
    }()

    static func hm(_ ms: Double) -> String { hm.string(from: Date(timeIntervalSince1970: ms / 1000)) }

    static func hm(iso: String) -> String {
        let p = ISO8601DateFormatter()
        p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = p.date(from: iso) { return hm.string(from: d) }
        p.formatOptions = [.withInternetDateTime]
        if let d = p.date(from: iso) { return hm.string(from: d) }
        return ""
    }
}

// MARK: - 画面の持ちもの

@MainActor
final class NativeFloorModel: ObservableObject {
    @Published var payload: NFPayload?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    /// 画面の時計（サーバーの時刻に合わせて 1 秒ごとに進める）
    @Published var now: Double = Date().timeIntervalSince1970 * 1000
    /// 選んでいるフロア（"all" ＝ すべて、"_none" ＝ 未分類）
    @Published var floorFilter: String = "all"
    /// 押した卓（ポップアップを出す）。押したら、その卓の伝票を裏で読んでおく（レジ会計・注文を押した瞬間に出る）
    @Published var selectedTableId: String? {
        didSet {
            if let t = selectedTable { prefetch((t.order?.slips ?? []).map(\.id), within: 3) }
        }
    }
    /// 裏で読んだ時刻（伝票ごと。読みすぎない）
    private var prefetchedAt: [String: Date] = [:]

    private var offsetMs: Double = 0
    private var clock: Timer?
    private var refresher: Timer?
    private var sweeper: Timer?
    private var toastTimer: Timer?

    var store: NFNamed? { payload?.store }
    /// 画面の時計（Date）
    var nowDate: Date { Date(timeIntervalSince1970: now / 1000) }
    var tables: [NFTable] { payload?.tables ?? [] }
    var floors: [NFFloor] { payload?.floors ?? [] }
    var selectedTable: NFTable? { tables.first { $0.id == selectedTableId } }

    var unassigned: [NFTable] { tables.filter { t in !floors.contains { $0.id == t.floorId } } }

    var visibleTables: [NFTable] {
        switch floorFilter {
        case "all": return tables
        case "_none": return unassigned
        default: return tables.filter { $0.floorId == floorFilter }
        }
    }

    /// フロアのチップを出すか（フロアが 2 つ以上、または未分類がある）
    var showFloorChips: Bool { floors.count > 1 || (floors.count > 0 && !unassigned.isEmpty) }

    func start() {
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.now = Date().timeIntervalSince1970 * 1000 + self.offsetMs
            }
        }
        // 15 秒ごとに読み直す（Web と同じ。Realtime の代わり）
        refresher?.invalidate()
        refresher = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh(silent: true) }
        }
        // 清掃中のまま時間が過ぎた卓を 1 分ごとに空席へ（Web と同じ）
        sweeper?.invalidate()
        sweeper = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.sweepCleaning() }
        }
        // 保存してあるテーブル一覧を先に出す（押した瞬間に出る。裏で読み直す）
        if payload == nil, let saved = NativeDiskCache.load(NFPayload.self, key: "floor") {
            payload = saved
            if let d = saved.defaultFloorId, saved.floors.contains(where: { $0.id == d }) { floorFilter = d }
        }
        Task { await refresh(silent: payload != nil) }
    }

    func stop() {
        clock?.invalidate(); clock = nil
        refresher?.invalidate(); refresher = nil
        sweeper?.invalidate(); sweeper = nil
    }

    func refresh(silent: Bool) async {
        if !silent { loading = payload == nil }
        do {
            let p = try await NativeAPI.shared.loadFloor(storeId: payload?.store.id)
            // 次に開くとき先に出す・ネットが無いときもこれで出す
            NativeDiskCache.save(p, key: "floor")
            offsetMs = p.serverNow - Date().timeIntervalSince1970 * 1000
            now = p.serverNow
            let first = payload == nil
            payload = p
            // 金額が変わった伝票・まだ読んでいない伝票を裏で読んでおく（会計・注文を押した瞬間に出る。2026-10-24 Ronnie「会計 ma jada pani 取込み navai」）
            let stale = p.tables.flatMap { $0.order?.slips ?? [] }.filter { s in
                NativeDiskCache.load(APILive.self, key: "live-\(s.id)")?.order.total != s.total
            }
            prefetch(Array(stale.prefix(15)).map(\.id), within: 20)
            if first {
                // 最初に出すフロア（設定 > テーブル・フロア）。無ければ「すべて」
                if let d = p.defaultFloorId, p.floors.contains(where: { $0.id == d }) { floorFilter = d }
                await sweepCleaning()
            }
            error = nil
        } catch {
            if !silent || payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
        loading = false
    }

    /// 伝票を裏で読んで iPad に保存する（NativeOrderModel が開くときに先に出す）。within 秒以内に読んだものは読まない
    func prefetch(_ ids: [String], within: TimeInterval) {
        let now = Date()
        let todo = ids.filter { id in prefetchedAt[id].map { now.timeIntervalSince($0) > within } ?? true }
        guard !todo.isEmpty else { return }
        for id in todo { prefetchedAt[id] = now }
        Task {
            for id in todo {
                if let live = try? await NativeAPI.shared.loadLive(orderId: id) { NativeDiskCache.save(live, key: "live-\(id)") }
            }
        }
    }

    private func sweepCleaning() async {
        guard let storeId = payload?.store.id else { return }
        if let r = try? await NativeAPI.shared.floorAct(["type": "floorRelease", "storeId": storeId]), (r.released ?? 0) > 0 {
            await refresh(silent: true)
        }
    }

    /// 操作して、終わったら読み直す。失敗はエラーの帯に出す。返事は呼ぶ側が使う（伝票の id など）
    @discardableResult
    func act(_ body: [String: Any], refreshAfter: Bool = true) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok {
                show(error: r.error ?? "うまくいきませんでした")
                return nil
            }
            if let prints = r.prints, !prints.isEmpty { NativeLanPrint.shared.send(prints) }
            if refreshAfter { await refresh(silent: true) }
            return r
        } catch {
            show(error: (error as? NativeAPIError)?.message ?? "通信できませんでした")
            return nil
        }
    }

    func show(error text: String) {
        self.error = text
    }

    func show(toast text: String) {
        toast = text
        toastTimer?.invalidate()
        toastTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.toast = nil }
        }
    }
}

extension NativeAPI {
    /// フロア（テーブル一覧）の全部
    func loadFloor(storeId: String?) async throws -> NFPayload {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "part", value: "floor")]
        if let storeId { items.append(URLQueryItem(name: "store", value: storeId)) }
        comps.queryItems = items
        let data = try await send(URLRequest(url: comps.url!))
        return try JSONDecoder().decode(NFPayload.self, from: data)
    }

    /// フロアの操作（type: floor…）
    func floorAct(_ body: [String: Any]) async throws -> NFActionResult {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await send(req)
        return try JSONDecoder().decode(NFActionResult.self, from: data)
    }
}
