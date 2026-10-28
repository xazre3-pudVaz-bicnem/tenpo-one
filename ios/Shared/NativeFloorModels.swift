import Foundation
import SwiftUI
import Combine

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
    var reservationId: String? = nil
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
    /// 席に着いた予約のタグ（誕生日・記念日・飲み放題…）。卓の箱に小さな印で出す。古いサーバーは無し
    var tags: [String]? = nil
    /// 最後の注文（品）の時刻 ms（「最終注文から N 分」）。古いサーバー・注文なしは nil
    var lastOrderAtMs: Double? = nil
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
    /// 紫紺・うすい灰色（ホームと同じ。iPad も iPhone も。2026-10-27 03:14・03:27 Ronnie）
    static let iris = Color(hex: 0x37324D)
    static let irisDeep = Color(hex: 0x24203A)
    static let irisSoft = Color(hex: 0xEFF0F4)
    /// 濃い青をやめて紫紺（残り時間・ポップアップの字。2026-10-27 03:31 Ronnie「pupup haru sabaiko color milau」）
    static let royal = Color(hex: 0x37324D)
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
    static let lilac = Color(hex: 0xF1F3F8)
    static let lilacSoft = Color(hex: 0xF8F9FC)
    static let line = Color(hex: 0xE3E7EE)
    static let fieldBg = Color(hex: 0xF4F5F7)
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
    static let floorBg = Color(hex: 0xF4F5F8)
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

    /// ISO の時刻 → ミリ秒（小数の秒はけた数に関係なく切り捨て）
    static func ms(iso: String) -> Double? {
        let p = ISO8601DateFormatter()
        p.formatOptions = [.withInternetDateTime]
        let plain = iso.replacingOccurrences(of: "\\.[0-9]+", with: "", options: .regularExpression)
        return p.date(from: plain).map { $0.timeIntervalSince1970 * 1000 }
    }

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
    /// 今出しているテーブル一覧をこの起動中にサーバーから読めたか（false の間は iPad に保存してあった前のもの）
    private var confirmed = false
    /// レジとして使えない（この iPad が未登録・台数の上限・お店の回線の外など）。画面いっぱいに理由を出す（2026-10-26）
    @Published var blocked: NFBlocked?
    /// オフラインの伝票が変わった・同期した → 画面を出し直す・読み直す
    private var offlineSinks = Set<AnyCancellable>()
    private var clock: Timer?
    private var refresher: Timer?
    private var sweeper: Timer?
    private var toastTimer: Timer?
    /// 見本（-tenpoNativePreview floor。App Store の画面写真用）：読み込まない・時計を止める。お店では false のまま
    var isPreview = false

    var store: NFNamed? { payload?.store }
    /// 画面の時計（Date）
    var nowDate: Date { Date(timeIntervalSince1970: now / 1000) }
    /// 卓（この iPad がオフラインで受けた伝票を重ねる。NativeFloorOffline.swift）
    var tables: [NFTable] {
        NativeFloorOffline.overlay(payload?.tables ?? [], storeId: payload?.store.id, stayMinutes: payload?.stayMinutes ?? 120)
    }
    var floors: [NFFloor] { payload?.floors ?? [] }
    var selectedTable: NFTable? { tables.first { $0.id == selectedTableId } }

    var unassigned: [NFTable] { tables.filter { t in !floors.contains { $0.id == t.floorId } } }

    var visibleTables: [NFTable] {
        switch activeFloor {
        case "all": return tables
        case "_none": return unassigned
        default: return tables.filter { $0.floorId == activeFloor }
        }
    }

    /// フロアのチップを出すか（設定 › テーブル・フロア でフロアを作った店だけ：フロアが 2 つ以上、または未分類がある）
    var showFloorChips: Bool { floors.count > 1 || (floors.count > 0 && !unassigned.isEmpty) }

    /// 今出しているフロア。「ALL」は無い（2026-10-27 01:54 Ronnie の見本「1F 2F 3F テラス」）。
    /// 選んでいなければ 最初に出すフロア（設定 › テーブル・フロア＝受付のフロア）、無ければいちばん上のフロア
    var activeFloor: String {
        guard showFloorChips else { return "all" }
        if floorFilter == "_none", !unassigned.isEmpty { return "_none" }
        if floors.contains(where: { $0.id == floorFilter }) { return floorFilter }
        if let d = payload?.defaultFloorId, floors.contains(where: { $0.id == d }) { return d }
        return floors.first?.id ?? "all"
    }

    /// フロアの並び（チップの順。未分類は最後）
    var floorOrder: [String] { floors.map(\.id) + (unassigned.isEmpty ? [] : ["_none"]) }

    /// 卓の欄を横にスライドしたら隣のフロアへ（1＝次・-1＝前）
    func stepFloor(_ delta: Int) {
        let order = floorOrder
        guard let i = order.firstIndex(of: activeFloor), order.indices.contains(i + delta) else { return }
        floorFilter = order[i + delta]
        selectedTableId = nil
    }

    func start() {
        if isPreview { return }
        if offlineSinks.isEmpty {
            NativeOfflineStore.shared.objectWillChange.receive(on: RunLoop.main).sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &offlineSinks)
            NativeOfflineStore.shared.synced.receive(on: RunLoop.main).sink { [weak self] _ in
                Task { @MainActor in await self?.refresh(silent: true) }
            }.store(in: &offlineSinks)
        }
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
        if isPreview { return }
        if !silent { loading = payload == nil }
        do {
            let p = try await NativeAPI.shared.loadFloor(storeId: payload?.store.id)
            // 次に開くとき先に出す・ネットが無いときもこれで出す
            NativeDiskCache.save(p, key: "floor")
            offsetMs = p.serverNow - Date().timeIntervalSince1970 * 1000
            now = p.serverNow
            // 保存してあったのが別の店（別のアカウントでログインし直した）なら、初めて読んだのと同じに扱う（フロアの選択を出し直す）。
            // 前は前の店のフロアを選んだまま＝卓が 1 つも出なかった（2026-10-26 Ronnie「テーブル見つかりません」）
            let first = payload == nil || payload?.store.id != p.store.id
            if first, payload != nil {
                floorFilter = "all"
                selectedTableId = nil
            }
            payload = p
            confirmed = true
            blocked = nil
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
            if let e = error as? NativeAPIError, e.useWeb {
                // レジとして使えない（未登録・台数・回線など）：前の一覧（別の店の保存のことがある）は出さず、理由と「登録」を出す。
                // 前は黙って前の一覧のまま＝来店登録で「テーブルが見つかりません」（2026-10-26 Ronnie）
                blocked = NFBlocked(message: e.message, canRegister: e.canRegister)
                if !confirmed { payload = nil }
                self.error = nil
            } else {
                // 保存してあった前の一覧のままサーバーに断られたときは、黙らずに出す。ネットが無いだけなら出さない
                let refused = !confirmed && payload != nil && error is NativeAPIError
                if !silent || payload == nil || refused { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
            }
        }
        loading = false
    }

    /// 伝票を裏で読んで iPad に保存する（NativeOrderModel が開くときに先に出す）。within 秒以内に読んだものは読まない
    func prefetch(_ ids: [String], within: TimeInterval) {
        // オフライン・オフラインで始めた伝票（off-…）はサーバーに無い
        guard NativeNet.shared.online else { return }
        let now = Date()
        let todo = ids.filter { id in !id.hasPrefix("off-") && (prefetchedAt[id].map { now.timeIntervalSince($0) > within } ?? true) }
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
        // ネットが無い：この iPad でできる操作（卓の開始・会計伝票・テーブルクリア）はここで
        if !NativeNet.shared.online {
            let r = await offlineAct(body)
            if !r.ok { show(error: r.error ?? "オフラインではできません") }
            return r.ok ? r : nil
        }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok {
                show(error: r.error ?? "うまくいきませんでした")
                // 卓が消えた・別の店の一覧だった（「テーブルが見つかりません」など）：一覧を読み直しておく（エラーの帯は残す）
                let shown = error
                await refresh(silent: true)
                if error == nil { error = shown }
                return nil
            }
            if let prints = r.prints, !prints.isEmpty { NativeLanPrint.shared.send(prints) }
            if refreshAfter { await refresh(silent: true) }
            return r
        } catch {
            // サーバーに届く前に落ちた（ネットが切れた）：この iPad でできる操作なら続ける
            if NativeOrderModel.notSent(error) {
                let r = await offlineAct(body)
                if r.ok { return r }
            }
            let text = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            show(error: text)
            // サーバーに断られた（卓が消えた・別の店の一覧だった・レジ登録など）：一覧を読み直す（エラーの帯は残す）
            if error is NativeAPIError {
                await refresh(silent: true)
                if blocked == nil, self.error == nil { self.error = text }
            }
            return nil
        }
    }

    func show(error text: String) {
        self.error = text
    }

    /// この iPad をこの店のレジとして登録する（Web の /app/pos の「登録」と同じ）。できたら読み直す
    func registerDevice() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["type": "floorRegisterDevice"]
        if confirmed, let id = payload?.store.id { body["storeId"] = id }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok {
                blocked = NFBlocked(message: r.error ?? "登録できませんでした", canRegister: false)
                return
            }
            await refresh(silent: false)
            if blocked == nil { show(toast: "この iPad をレジとして登録しました") }
        } catch {
            blocked = NFBlocked(message: (error as? NativeAPIError)?.message ?? "通信できませんでした", canRegister: blocked?.canRegister ?? false)
        }
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

/// テーブル一覧を出せない理由（レジとして使えない）
struct NFBlocked: Equatable {
    let message: String
    /// 「この iPad を登録」を出す（まだ登録していない・台数に空きあり）
    let canRegister: Bool
}
