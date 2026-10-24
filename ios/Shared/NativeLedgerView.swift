import SwiftUI

// ネイティブの店舗台帳（予約のスケジュール。iPad レジ）。Web の /app/reservations（view=day）と同じ機能：
//   日付の前後／予約登録／卓ごとの時間の帯（予約の箱）／予約の詳細（来店・着席→注文・退店・キャンセル・卓・時間・担当・経路・コース・メモ）
// 色は Tableo 風（濃いネイビー・黄・青・緑・赤。2026-10-24 Ronnie「Tableo の色が良い。ご予約台帳にこの色を」）

struct NLTable: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let capacityMin: Int
    let capacityMax: Int
    let statusLabel: String
}

struct NLReservation: Codable, Identifiable, Hashable {
    let id: String
    let code: String
    let reservedDate: String
    let startAt: String
    let endAt: String
    let guestName: String
    let guestNameKana: String?
    let guestPhone: String
    let guestEmail: String?
    let partySize: Int
    let adults: Int
    let children: Int
    let status: String
    let courseId: String?
    let courseName: String?
    let seatType: String?
    let purpose: String?
    let allergyNote: String?
    let requestNote: String?
    let memo: String?
    let sourceName: String?
    let sourceId: String?
    let createdVia: String
    let tableIds: [String]
    let tableNames: [String]
    let staffId: String?
    let staffName: String?
    let isPrivateHire: Bool
    let createdAt: String?
    let arrivedAt: String?
    let leftAt: String?
    let visitCount: Int?
    let tags: [String]?
    /// 人数を範囲で受けたときの最小人数（4〜6 名の 4。最大は partySize）
    var partySizeMin: Int? = nil
}

extension NLReservation {
    /// 「4〜6名」「4名」
    var partyLabel: String { partySizeMin.map { "\($0)〜\(partySize)名" } ?? "\(partySize)名" }
}

struct NLSummary: Codable {
    let count: Int
    let guests: Int
    let cancelled: Int
    let sameDayCount: Int
    let sameDayGuests: Int
    let inCount: Int
    let outCount: Int
    let waitingCount: Int
    let unconfirmed: Int
    let unseated: Int
}

struct NLCode: Codable, Hashable { let code: String; let name: String }
struct NLSourceRow: Codable, Identifiable, Hashable { let id: String; let code: String; let name: String }

struct NLPayload: Codable {
    let store: NFNamed
    let date: String
    let today: String
    let isToday: Bool
    let nowMs: Double
    let viewStartMin: Int
    let viewEndMin: Int
    let openMin: Int
    let closeMin: Int
    let isClosedDay: Bool
    let bufferMinutes: Int
    let slotMinutes: Int
    let tables: [NLTable]
    let reservations: [NLReservation]
    let summary: NLSummary
    let sources: [NLCode]
    let sourceRows: [NLSourceRow]
    let courses: [NFNamed]
    let staffOptions: [NFNamed]
    let statusLabels: [String: String]
    let transitions: [String: [String]]
    /// タグの名前 → アイコン名（予約カード・詳細に小さく出す）
    var tagIcons: [String: String]? = nil
    let canWrite: Bool
    /// 上のボタンの出し分け（古いサーバーは無い）
    let links: NLLinks?
    let unconfirmed: Int?
}

struct NLLinks: Codable { let tables: Bool; let customers: Bool; let analytics: Bool; let settings: Bool }

/// Tableo 風の色
enum NLColor {
    static let navy = Color(hex: 0x171333)
    static let navy2 = Color(hex: 0x353057)
    static let page = Color(hex: 0xF7F6FC)
    static let card = Color.white
    static let line = Color(hex: 0xE2E8F0)
    static let ink = Color(hex: 0x212121)
    static let muted = Color(hex: 0x64748B)
    static let yellow = Color(hex: 0xFFC634)
    static let blue = Color(hex: 0x1863DC)
    static let blueSoft = Color(hex: 0xDBEAFE)
    static let green = Color(hex: 0x00C689)
    static let greenSoft = Color(hex: 0xD9F7EC)
    static let red = Color(hex: 0xFE6564)
    static let redSoft = Color(hex: 0xFFE4E3)
    static let gray = Color(hex: 0x94A3B8)
    static let graySoft = Color(hex: 0xEDEFF3)
    static let yellowSoft = Color(hex: 0xFFF3CC)
    /// ウォークイン（直接来店）の色（上のタイル・スケジュールの箱の左の帯。2026-10-24 20:33 Ronnie「walk-in も見えるように、色を使って」）
    static let walkIn = Color(hex: 0x8B5CF6)
    /// 今より前の時間のうすい影（2026-10-24 20:32 Ronnie「今の線より前は少し暗く」）
    static let pastShade = Color(hex: 0x171333).opacity(0.055)
    /// スケジュールの予約の箱（全部同じ色＝上のバーのネイビーを少し明るく。2026-10-24 Ronnie「箱の色は全部同じ、見出しの色を少し明るく。入り口の印だけ各社の色で小さく」）
    static let box = navy2

    /// 予約の状態の色（箱の地・文字）
    static func tone(_ status: String, late: Bool) -> (Color, Color) {
        switch status {
        case "pending": return (yellowSoft, Color(hex: 0x8A6100))
        case "confirmed", "waiting": return late ? (redSoft, Color(hex: 0xB42318)) : (blueSoft, Color(hex: 0x0B3A8C))
        case "arrived", "seated": return (greenSoft, Color(hex: 0x036B4A))
        case "billing": return (yellowSoft, Color(hex: 0x8A6100))
        case "completed": return (graySoft, muted)
        default: return (graySoft, muted)
        }
    }

    static func bar(_ status: String, late: Bool) -> Color {
        switch status {
        case "pending": return yellow
        case "confirmed", "waiting": return late ? red : blue
        case "arrived", "seated": return green
        case "billing": return yellow
        default: return gray
        }
    }
}

/// timestamptz → JST の分（0〜）。翌日にまたがる閉店（25:00 など）は 24*60 を足す
/// スケジュールの1行（卓、またはウェイティング）。lane = 予約ごとの段（0 が一番上）
struct NLBoardRow {
    /// 卓の id（ウェイティングの行は nil）
    var tableId: String? = nil
    let name: String
    let status: String
    let reservations: [NLReservation]
    let lane: [String: Int]
    let height: CGFloat
}

/// 時間が重なる予約を別の段に分ける（早い順に、空いている一番上の段へ）。段の数は 1 以上
/// 箱は短くても 1 マスの幅があるので、終わりは「始まり＋1マス」より前にしない
func nlLanes(_ rs: [NLReservation], dayStart: String, minMinutes: Int) -> (lane: [String: Int], count: Int) {
    let items = rs.map { r -> (id: String, s: Int, e: Int) in
        let s = nlJstMinutes(r.startAt, dayStart: dayStart)
        let e = max(nlJstMinutes(r.endAt, dayStart: dayStart), s + max(minMinutes, 1))
        return (r.id, s, e)
    }
    .sorted { $0.s != $1.s ? $0.s < $1.s : $0.id < $1.id }
    var ends: [Int] = []
    var lane: [String: Int] = [:]
    for it in items {
        if let i = ends.firstIndex(where: { $0 <= it.s }) {
            ends[i] = it.e
            lane[it.id] = i
        } else {
            ends.append(it.e)
            lane[it.id] = ends.count - 1
        }
    }
    return (lane, max(1, ends.count))
}

func nlJstMinutes(_ iso: String, dayStart: String) -> Int {
    let p = ISO8601DateFormatter()
    p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var d = p.date(from: iso)
    if d == nil { p.formatOptions = [.withInternetDateTime]; d = p.date(from: iso) }
    guard let date = d else { return 0 }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    let ymd = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    let extra = ymd > dayStart ? 24 * 60 : 0
    return (c.hour ?? 0) * 60 + (c.minute ?? 0) + extra
}

func nlHm(_ min: Int) -> String { String(format: "%02d:%02d", (min / 60) % 24, min % 60) }

extension View {
    /// 内容が画面に収まるときは上下にバウンドしない（iOS 16.4〜。それより前はそのまま）
    /// 2026-10-24 Ronnie「画面が上下に揺れないように」
    @ViewBuilder func nlNoVerticalBounce() -> some View {
        if #available(iOS 16.4, *) {
            self.scrollBounceBehavior(.basedOnSize, axes: .vertical)
        } else {
            self
        }
    }
}

/// スケジュールの横スクロールの位置（内容の左端。左へ動かすと負）
struct NLScrollXKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// スケジュールの時間の側の、見えている幅
struct NLBoardWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

@MainActor
final class NativeLedgerModel: ObservableObject {
    @Published var payload: NLPayload?
    @Published var date: String?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var now = Date()
    @Published var listMode = false
    /// グルメ別（その日の予約を入り口ごとに。Web の GourmetPanel と同じ）
    @Published var gourmetMode = false
    /// 週間（Web の view=week）
    @Published var weekMode = false
    /// ウェイティング（Web の view=waitlist）
    @Published var waitMode = false
    /// 月間カレンダー（Web の /app/reservations/calendar）
    @Published var monthMode = false
    /// 予約リストを未連絡（仮予約）だけにする（Web の 予約リスト status=pending）
    @Published var pendingOnly = false
    /// 開く予約（Web の ?open=。台帳を読み直したら詳細を出す）
    @Published var openReservationId: String?
    /// 開く受付管理・メッセージ（Web の ?view=inbox / messages）
    @Published var inboxRequest: String?

    /// Web の ?view= に合わせて表示を切り替える（list / week / gourmet / waitlist / month / inbox / messages）
    func applyView(_ v: String) {
        listMode = false; gourmetMode = false; weekMode = false; waitMode = false; monthMode = false; pendingOnly = false
        switch v {
        case "list": listMode = true
        case "week": weekMode = true
        case "gourmet": gourmetMode = true
        case "waitlist", "wait": waitMode = true
        case "month", "calendar": monthMode = true
        case "inbox", "messages": inboxRequest = v
        default: break
        }
    }

    /// その予約の日の台帳を読んで、詳細を開く
    func open(reservationId id: String) async {
        if payload?.reservations.contains(where: { $0.id == id }) == true { openReservationId = id; return }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "ledger"), URLQueryItem(name: "open", value: id)]
        if let data = try? await NativeAPI.shared.send(URLRequest(url: comps.url!)),
           let p = try? JSONDecoder().decode(NLPayload.self, from: data) {
            payload = p
            date = p.date
        }
        openReservationId = id
    }
    private var clock: Timer?
    private var refresher: Timer?
    private var offset: TimeInterval = 0
    /// 見本（-tenpoNativePreview ledger。App Store の画面写真用）：読み込まない・時計を止める。お店では false のまま
    var isPreview = false
    /// 見本のときの、オーダー・会計の卓（来店中の予約の箱をフロアと同じ色に）。お店では nil のまま
    var previewFloor: NFPayload?

    func start() {
        if isPreview { return }
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date().addingTimeInterval(self?.offset ?? 0) }
        }
        refresher?.invalidate()
        refresher = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh(silent: true) }
        }
        Task { await refresh(silent: false) }
    }

    func stop() {
        clock?.invalidate(); clock = nil
        refresher?.invalidate(); refresher = nil
    }

    func refresh(silent: Bool) async {
        if isPreview { return }
        if !silent { loading = true }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var items = [URLQueryItem(name: "part", value: "ledger")]
            if let date { items.append(URLQueryItem(name: "date", value: date)) }
            comps.queryItems = items
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NLPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NLPayload.self, from: data)
            offset = p.nowMs / 1000 - Date().timeIntervalSince1970
            now = Date().addingTimeInterval(offset)
            payload = p
            date = p.date
            error = nil
        } catch {
            if !silent || payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
        loading = false
    }

    func shiftDate(_ days: Int) {
        guard let cur = date ?? payload?.date else { return }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        guard let d = f.date(from: cur), let n = Calendar.current.date(byAdding: .day, value: days, to: d) else { return }
        date = f.string(from: n)
        Task { await refresh(silent: false) }
    }

    func goToday() {
        date = payload?.today
        Task { await refresh(silent: false) }
    }

    @discardableResult
    func act(_ body: [String: Any]) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return nil }
            await refresh(silent: true)
            return r
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }

    func show(toast t: String) { toast = t }

    /// 遅れ（来店前なのに開始から15分過ぎた）
    func isLate(_ r: NLReservation) -> Bool {
        guard let p = payload, p.isToday, ["pending", "confirmed", "waiting"].contains(r.status) else { return false }
        let start = nlJstMinutes(r.startAt, dayStart: p.date)
        let nowMin = nlJstMinutes(ISO8601DateFormatter().string(from: now), dayStart: p.date)
        return nowMin > start + 15
    }
}

struct NativeLedgerView: View {
    @ObservedObject var model: NativeLedgerModel
    var onHome: () -> Void = {}
    var onFloor: () -> Void = {}
    var onOpenOrder: (String) -> Void = { _ in }
    var onWeb: (String) -> Void = { _ in }

    @State private var selected: NLReservation?
    @State private var newOpen = false
    @State private var inboxOpen = false
    /// スケジュールの空いたマスを押した（その場の受付）
    @State private var quickSlot: NLQuickSlot?
    /// その場の受付から予約登録の画面へ渡すもの
    @State private var slotPrefill: NLReservationPrefill?
    @State private var dateCalendarOpen = false
    @StateObject private var inbox = NLInboxModel()
    @State private var findSeatsOpen = false
    @State private var walkInOpen = false
    @State private var gourmetOpen = false
    @State private var exporting = false
    /// オーダー・会計の卓の状態（読むだけ）。来店中の予約の箱をフロアの卓と同じ色・同じ時間に
    /// （2026-10-24 21:08 Ronnie「ご予約台帳のスケジュールも同じ色に、連携して時間も全部」）
    @State private var floorTables: [String: NFTable] = [:]
    @State private var floorOffsetMs: Double = 0

    // 今の時刻の線（カーソル）は画面の決まった場所に止めて、時間の側を左へ動かす
    // （2026-10-24 Ronnie「カーソルは止めて、スケジュールが時間どおり自分で左に動く」）。
    // 手で横にスクロールしたら追いかけるのをやめ、上の「現在」で戻す。
    @State private var followNow = true
    @State private var autoScrolledOnce = false
    @State private var autoScrollUntil = Date.distantPast
    @State private var gridVisibleW: CGFloat = 0
    @State private var boardProxy: ScrollViewProxy?

    private let rowH: CGFloat = 64
    /// 時間が重なる予約を下の段に置くときの1段の高さ（箱 54 ＋ すき間）
    private let laneStep: CGFloat = 58
    private let slotW: CGFloat = 96
    private let nameW: CGFloat = 132
    /// カーソルを止める場所（時間の側の左から 1/4。見えている 6 時間なら 1.5 時間ぶん過去が左に残る）
    private let nowAnchor: CGFloat = 0.25
    private static let nowMarkerId = "nl-now-marker"

    private var isBoardMode: Bool { !model.listMode && !model.gourmetMode && !model.weekMode && !model.waitMode && !model.monthMode }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if let p = model.payload {
                // 集計と、表示の切り替え（スケジュール・予約リスト）を 1 行に。予約受付・その他は上のバーへ（2026-10-24 20:55 Ronnie）
                HStack(spacing: 0) {
                    summaryRow(p)
                    viewSwitch.padding(.trailing, 16)
                }
                if model.monthMode {
                    NativeLedgerMonthView(date: model.date ?? p.date) { d in
                        model.monthMode = false; model.weekMode = false; model.listMode = false; model.gourmetMode = false; model.waitMode = false
                        model.date = d
                        Task { await model.refresh(silent: false) }
                    }
                } else if model.waitMode {
                    NativeLedgerWaitView(model: model, onOpenOrder: onOpenOrder)
                } else if model.weekMode {
                    NativeLedgerWeekView(date: model.date ?? p.date) { d in
                        model.weekMode = false; model.monthMode = false; model.listMode = false; model.gourmetMode = false; model.waitMode = false
                        model.date = d
                        Task { await model.refresh(silent: false) }
                    }
                } else if model.gourmetMode { ScrollView { gourmetRows(p) }.nlNoVerticalBounce() } else if model.listMode { listBody(p) } else { board(p) }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.red)
                        Button("もう一度") { Task { await model.refresh(silent: false) } }
                    }
                } else {
                    ProgressView("読み込み中…").tint(NLColor.blue)
                }
                Spacer()
            }
        }
        .background(NLColor.page.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NLColor.navy.opacity(0.95)))
                    .padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(Color(hex: 0xB42318))
                        .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(NLColor.redSoft))
                        .frame(maxWidth: 720)
                }
                .buttonStyle(.plain)
                .padding(.top, 74)
            }
        }
        .sheet(item: $selected) { r in
            NativeReservationSheet(model: model, reservation: r, onClose: { selected = nil }, onOpenOrder: { id in selected = nil; onOpenOrder(id) })
        }
        // 予約登録は画面いっぱいの 1 枚（左＝日時・人数・おすすめのテーブル、右＝お客様・キーワード。2026-10-24 19:36 Ronnie）
        .fullScreenCover(isPresented: $newOpen) {
            NativeReservationEntry(model: model, prefill: slotPrefill, onClose: { newOpen = false; slotPrefill = nil }, onWalkIn: {
                newOpen = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { walkInOpen = true }
            })
        }
        .sheet(isPresented: $findSeatsOpen) {
            NLFindSeatsSheet(model: model, onClose: { findSeatsOpen = false })
        }

        .sheet(isPresented: $walkInOpen) {
            NLWalkInSheet(model: model, onClose: { walkInOpen = false })
        }
        .sheet(isPresented: $gourmetOpen) {
            NativeGourmetSheet(onClose: { gourmetOpen = false }, onOpenReservation: { id, date in openReservation(id: id, date: date) })
        }
        .onAppear { model.start(); if !model.isPreview { inbox.start() } }
        .task { await floorLoop() }
        // Web の ?open=<予約>：読めたら詳細を出す
        .onChange(of: model.openReservationId) { id in
            guard let id else { return }
            if let r = model.payload?.reservations.first(where: { $0.id == id }) { selected = r } else { model.show(toast: "この予約は台帳の表示対象外です（キャンセル済みなど）") }
            model.openReservationId = nil
        }
        // Web の ?view=messages：メッセージを開く（受付管理 inbox は上の 予約受付 が開く）
        .onChange(of: model.inboxRequest) { v in
            if v == "messages" { inboxOpen = true; model.inboxRequest = nil }
        }
        .onDisappear { model.stop(); inbox.stop() }
        // 予約を登録・変更したら、お知らせの数も読み直す
        .onChange(of: model.payload?.summary.count ?? -1) { _ in Task { await inbox.load() } }
    }

    /// オーダー・会計の卓を 20 秒ごとに読む（読むだけ。清掃中→空席などの書き込みはフロアの画面がする）
    private func floorLoop() async {
        // 見本（-tenpoNativePreview ledger）：見本の卓で色をつけて、読み込まない
        if let p = model.previewFloor { applyFloor(p, fresh: false); return }
        if floorTables.isEmpty, let saved = NativeDiskCache.load(NFPayload.self, key: "floor") { applyFloor(saved, fresh: false) }
        while !Task.isCancelled {
            if let p = try? await NativeAPI.shared.loadFloor(storeId: nil) { applyFloor(p, fresh: true) }
            try? await Task.sleep(nanoseconds: 20_000_000_000)
        }
    }

    private func applyFloor(_ p: NFPayload, fresh: Bool) {
        let tables = NativeFloorOffline.overlay(p.tables, storeId: p.store.id, stayMinutes: p.stayMinutes)
        floorTables = Dictionary(tables.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        if fresh { floorOffsetMs = p.serverNow - Date().timeIntervalSince1970 * 1000 }
    }

    /// 来店中（来店・着席・会計待ち）の予約が座っている卓の、オーダー・会計と同じ状態と残り時間
    private func floorState(_ r: NLReservation, p: NLPayload) -> (band: (jp: String, en: String, color: Color, ink: Color), left: Int?)? {
        guard p.isToday, ["arrived", "seated", "billing"].contains(r.status) else { return nil }
        let nowMs = model.now.timeIntervalSince1970 * 1000 + floorOffsetMs
        for id in r.tableIds {
            guard let t = floorTables[id], let b = NativeTableCard.band(t.state(now: nowMs)) else { continue }
            return (b, t.order.map { $0.tileTime(now: nowMs).left })
        }
        return nil
    }

    /// グルメ連携の「台帳で見る」：その日の台帳を開いて予約の詳細を出す
    private func openReservation(id: String, date: String?) {
        gourmetOpen = false
        Task {
            if let date, date != (model.date ?? model.payload?.date) {
                model.date = date
                model.listMode = false; model.gourmetMode = false; model.weekMode = false; model.monthMode = false; model.waitMode = false
                await model.refresh(silent: false)
            } else if model.payload?.reservations.first(where: { $0.id == id }) == nil {
                await model.refresh(silent: true)
            }
            if let r = model.payload?.reservations.first(where: { $0.id == id }) {
                selected = r
            } else {
                model.show(toast: "この予約は台帳の表示対象外です（キャンセル済みなど）")
            }
        }
    }

    // MARK: 上のバー（Tableo 風のネイビー）

    private static let dayFmt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy/M/d（E）"
        return f
    }()

    private var dateLabel: String {
        guard let d = model.date ?? model.payload?.date else { return "" }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        return f.date(from: d).map { Self.dayFmt.string(from: $0) } ?? d
    }

    private var topBar: some View {
        ZStack {
            HStack(spacing: 10) {
                // 左上はホームへのボタン＝ TENPO ONE のロゴ（字なし。2026-10-24 18:57・19:22 Ronnie）
                Button(action: onHome) {
                    NativeHomeLogo(ink: NLColor.navy)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("ホーム")
                // 店名は出さない（ホームだけ）。その場所に画面の名前（2026-10-24 18:55・18:56 Ronnie）
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("店舗台帳").font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                    Text("Reservation").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.yellow)
                }
                .fixedSize()
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Color.white.opacity(0.12)))
                Spacer(minLength: 8)
                // 予約受付（仮予約・要連絡・新しいネット予約…）はメッセージの左（2026-10-24 20:55 Ronnie）
                toolbar(.tasks)
                // メッセージ（新しい予約・変更・キャンセルのお知らせ）。予約登録の横（2026-10-24 19:56・20:18 Ronnie）
                Button { inboxOpen = true } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "envelope").font(.system(size: 18, weight: .semibold)).foregroundColor(.white)
                            .frame(width: 46, height: 38)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.12)))
                        if inbox.unreadNotices > 0 {
                            Text(inbox.unreadNotices > 99 ? "99+" : "\(inbox.unreadNotices)").font(.system(size: 11, weight: .heavy)).monospacedDigit().foregroundColor(.white)
                                .padding(.horizontal, 5).frame(minWidth: 20, minHeight: 20)
                                .background(Capsule().fill(NLColor.red))
                                .overlay(Capsule().stroke(NLColor.navy, lineWidth: 2))
                                .offset(x: 7, y: -7)
                        }
                    }
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("メッセージ")
                .popover(isPresented: $inboxOpen, arrowEdge: .top) {
                    NLInboxSheet(inbox: inbox, model: model, onClose: { inboxOpen = false }, tab: .messages)
                }
                // 予約登録は右上に、Reservation と同じ黄色で（2026-10-24 18:49 Ronnie「右上のウェイティングはいらない、そこに予約登録を黄色で」）
                if model.payload?.canWrite ?? false {
                    Button { newOpen = true } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus").font(.system(size: 14, weight: .heavy))
                            Text("予約登録").font(.system(size: 15, weight: .heavy))
                        }
                        .foregroundColor(NLColor.navy)
                        .padding(.horizontal, 14).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.yellow))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("予約登録")
                }
                // その他（CSV・集計・PDF・空席検索・ほかの台帳・設定）は ＋予約登録 の右（2026-10-24 20:55 Ronnie）
                toolbar(.more)
            }
            // 日付は上のバーのまん中（2026-10-24 19:57・20:06 Ronnie「‹ 今日 10/24(土) ▾ ›、今日を押すと今日へ」）
            dateNav
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(NLColor.navy)
    }

    private var dateNav: some View {
        let isToday = model.payload?.isToday ?? true
        return HStack(spacing: 8) {
            HStack(spacing: 0) {
                dateSeg("chevron.left", label: "前の日") { model.shiftDate(-1) }
                HStack(spacing: 10) {
                    Button { goToday() } label: {
                        Text("今日").font(.system(size: 13, weight: .heavy))
                            .foregroundColor(isToday ? NLColor.muted : NLColor.navy)
                            .padding(.horizontal, 8).frame(height: 26)
                            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(isToday ? Color.clear : NLColor.yellow))
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(isToday ? NLColor.gray : NLColor.yellow, lineWidth: 1.2))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("今日へ")
                    Button { dateCalendarOpen = true } label: {
                        HStack(spacing: 8) {
                            Text(dateLabel).font(.system(size: 18, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.ink)
                            Image(systemName: "chevron.down").font(.system(size: 12, weight: .heavy)).foregroundColor(NLColor.muted)
                        }
                    }
                    .buttonStyle(PressableStyle())
                    // 月の表（日ごとの組数・人数、仮予約・要連絡の赤い点）。2026-10-24 20:20 Ronnie
                    .popover(isPresented: $dateCalendarOpen, arrowEdge: .top) {
                        NLDatePickerPanel(selected: model.date ?? model.payload?.date ?? "", today: model.payload?.today ?? "") { d in
                            model.date = d
                            followNow = true
                            dateCalendarOpen = false
                            Task { await model.refresh(silent: false) }
                        }
                    }
                }
                .padding(.horizontal, 14).frame(height: 44)
                .background(Color.white)
                dateSeg("chevron.right", label: "次の日") { model.shiftDate(1) }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            if let p = model.payload, p.isToday, isBoardMode, !followNow {
                // 手で横に動かしたあと：カーソル（今の時刻）の場所へ戻す
                Button { resumeFollow() } label: {
                    HStack(spacing: 4) { Image(systemName: "clock"); Text("現在") }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(NLColor.navy)
                        .padding(.horizontal, 12).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.yellow))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func dateSeg(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                .frame(width: 46, height: 44)
                .background(Color.white.opacity(0.16))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }

    // MARK: CSV出力・PDF作成（Web と同じ働き。CSV は Web の /app/reservations/list/export、PDF は画面をそのまま 1 枚に）

    private func exportCsv() {
        guard let d = model.date ?? model.payload?.date else { return }
        exporting = true
        Task {
            defer { exporting = false }
            do {
                let data = try await NativeAPI.shared.download("/app/reservations/list/export?from=\(d)&to=\(d)")
                if let url = NLShare.tempFile("予約リスト_\(d).csv", data: data) { NLShare.present(url: url) } else { model.error = "CSV を保存できませんでした" }
            } catch {
                model.error = (error as? NativeAPIError)?.message ?? "CSV を取り出せませんでした"
            }
        }
    }

    private func makePdf() {
        guard let p = model.payload, let d = model.date ?? model.payload?.date else { return }
        let slots = max(1, (p.viewEndMin - p.viewStartMin) / p.slotMinutes)
        let width = nameW + CGFloat(slots) * slotW + 32
        let page = VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("店舗台帳").font(.system(size: 22, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("\(p.store.name)　\(dateLabel)").font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.muted)
            }
            summaryRow(p)
            if model.gourmetMode { gourmetRows(p) } else if model.listMode { listRows(p) } else { boardRows(p, scrollable: false) }
        }
        .padding(16)
        .background(Color.white)
        if let url = NLShare.pdf(of: page, width: width, name: "店舗台帳_\(d).pdf") { NLShare.present(url: url) } else { model.error = "PDF を作れませんでした" }
    }

    private func navBtn(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.12)))
        }
        .buttonStyle(PressableStyle())
    }

    private func toolbar(_ part: NLToolbar.Part) -> some View {
        NLToolbar(
            model: model,
            inbox: inbox,
            onFloor: onFloor,
            onWeb: onWeb,
            onFindSeats: { findSeatsOpen = true },
            onWalkIn: { walkInOpen = true },
            onPdf: { makePdf() },
            onCsv: { exportCsv() },
            onGourmet: { gourmetOpen = true },
            part: part
        )
        .disabled(exporting)
        .fixedSize()
    }

    /// 表示の切り替え（スケジュール・予約リスト）。グルメ別・週間・ウェイティングなどは「その他」から
    private var viewSwitch: some View {
        HStack(spacing: 0) {
            modeBtn("スケジュール", on: !model.listMode && !model.gourmetMode && !model.weekMode && !model.waitMode && !model.monthMode) { model.listMode = false; model.gourmetMode = false; model.weekMode = false; model.monthMode = false; model.waitMode = false }
            modeBtn("予約リスト", on: model.listMode && !model.gourmetMode && !model.weekMode && !model.waitMode && !model.monthMode) { model.listMode = true; model.gourmetMode = false; model.weekMode = false; model.monthMode = false; model.waitMode = false }
        }
        .background(RoundedRectangle(cornerRadius: 11).fill(NLColor.graySoft))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(NLColor.line, lineWidth: 1))
        .fixedSize()
    }

    private func modeBtn(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .heavy))
                .foregroundColor(on ? .white : NLColor.muted)
                .padding(.horizontal, 14).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 9).fill(on ? NLColor.navy : Color.clear))
                .padding(3)
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 集計

    private func summaryRow(_ p: NLPayload) -> some View {
        let s = p.summary
        // ウォークイン（直接来店。キャンセル・無断キャンセル・キャンセル待ちは除く）
        let walkIns = p.reservations.filter { $0.createdVia == "walk_in" && !["cancelled", "no_show", "waitlisted"].contains($0.status) }
        return HStack(spacing: 8) {
            sumTile("ご予約", "\(s.count)", unit: "組", sub: "\(s.guests)名", color: NLColor.blue)
            sumTile("当日予約", "\(s.sameDayCount)", unit: "組", sub: "\(s.sameDayGuests)名", color: NLColor.navy2)
            sumTile("ウォークイン", "\(walkIns.count)", unit: "組", sub: "\(walkIns.reduce(0) { $0 + $1.partySize })名", color: NLColor.walkIn)
            sumTile("来店済み", "\(s.inCount)", unit: "組", sub: nil, color: NLColor.green)
            sumTile("退店", "\(s.outCount)", unit: "組", sub: nil, color: NLColor.gray)
            sumTile("来店待ち", "\(s.waitingCount)", unit: "組", sub: s.unconfirmed > 0 ? "未確定 \(s.unconfirmed)" : nil, color: NLColor.yellow)
            sumTile("キャンセル", "\(s.cancelled)", unit: "組", sub: nil, color: NLColor.red)
            if p.isClosedDay {
                Text("定休日").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted).fixedSize()
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func sumTile(_ label: String, _ value: String, unit: String, sub: String?, color: Color) -> some View {
        HStack(spacing: 10) {
            Rectangle().fill(color).frame(width: 4, height: 34).clipShape(Capsule())
            VStack(alignment: .leading, spacing: 0) {
                Text(label).font(.system(size: 11, weight: .semibold)).foregroundColor(NLColor.muted)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(value).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.ink)
                    Text(unit).font(.system(size: 11)).foregroundColor(NLColor.muted)
                    if let sub { Text(sub).font(.system(size: 11, weight: .semibold)).foregroundColor(NLColor.muted).padding(.leading, 4) }
                }
                .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        // 横は字に合わせて少し小さく（124 から）。右の切り替えまで切れずに並ぶ（2026-10-24 21:00 Ronnie「箱の横を少し小さく」）
        .padding(.horizontal, 12).frame(minWidth: 124).fixedSize(horizontal: true, vertical: false).frame(height: 54)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.card))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1))
    }

    // MARK: スケジュール（卓 × 時間）

    private func board(_ p: NLPayload) -> some View {
        boardRows(p, scrollable: true).background(NLColor.card)
    }

    /// 卓 × 時間の表。左の「テーブル」の列は固定で、時間の側だけ横にスクロール
    /// （2026-10-24 Ronnie「テーブルの列は横にスライドしても消えないように」）。PDF のときはスクロールなしで全部
    private func boardRows(_ p: NLPayload, scrollable: Bool) -> some View {
        let slots = max(1, (p.viewEndMin - p.viewStartMin) / p.slotMinutes)
        let totalW = CGFloat(slots) * slotW
        // 席がまだ決まっていない予約（会計の済んだものは除く。Web の「席未定」と同じ）
        let unassigned = p.reservations.filter { $0.tableIds.isEmpty && $0.status != "completed" }
        let nowMin = p.isToday ? nlJstMinutes(ISO8601DateFormatter().string(from: model.now), dayStart: p.date) : nil
        let nowX: CGFloat? = nowMin.flatMap { m in
            m >= p.viewStartMin && m <= p.viewEndMin ? CGFloat(m - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW : nil
        }
        // 卓の上に「ウェイティング」の行（席がまだ決まっていない予約）。待っている予約があるときだけ出す
        // （2026-10-24 Ronnie「ウェイティングはテーブルより上に。言葉もウェイティング」、18:48「waiting ma manxe vaye matra dekhauxa」）
        // 時間が重なる予約は下の段に並べ、行の高さが広がる（18:48「booking dherai vayo vane thau farakilo hudai janxa」）
        let waiting: [(id: String?, name: String, status: String, reservations: [NLReservation])] =
            unassigned.isEmpty ? [] : [(nil, "ウェイティング", "\(unassigned.count)組", unassigned)]
        let tableData: [(id: String?, name: String, status: String, reservations: [NLReservation])] =
            p.tables.map { t in (t.id, t.name, t.statusLabel.isEmpty ? "\(t.capacityMax)名席" : t.statusLabel, p.reservations.filter { $0.tableIds.contains(t.id) }) }
        let rows: [NLBoardRow] = (waiting + tableData)
            .map { row in
                let lanes = nlLanes(row.reservations, dayStart: p.date, minMinutes: p.slotMinutes)
                return NLBoardRow(tableId: row.id, name: row.name, status: row.status, reservations: row.reservations, lane: lanes.lane, height: rowH + CGFloat(lanes.count - 1) * laneStep)
            }

        let names = VStack(spacing: 0) {
            Text("テーブル").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                .frame(width: nameW, height: 34, alignment: .leading).padding(.leading, 12)
            Rectangle().fill(NLColor.line).frame(height: 1)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name).font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink).lineLimit(1)
                    Text(row.status).font(.system(size: 11)).foregroundColor(NLColor.muted).lineLimit(1)
                }
                .padding(.leading, 12)
                .frame(width: nameW, height: row.height, alignment: .leading)
                .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
            }
        }
        .frame(width: nameW)
        .background(NLColor.card)
        .overlay(alignment: .trailing) { Rectangle().fill(NLColor.line).frame(width: 1) }
        .shadow(color: Color.black.opacity(scrollable ? 0.06 : 0), radius: 6, x: 4, y: 0)
        .zIndex(1)

        let grid = VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                HStack(spacing: 0) {
                    ForEach(0..<slots, id: \.self) { i in
                        let m = p.viewStartMin + i * p.slotMinutes
                        Text(nlHm(m)).font(.system(size: 12, weight: m % 60 == 0 ? .bold : .regular)).monospacedDigit()
                            .foregroundColor(m % 60 == 0 ? NLColor.ink : NLColor.muted)
                            .frame(width: slotW, height: 34, alignment: .leading)
                    }
                }
                // 今の時刻の目印（自動スクロールの行き先。見えない）
                if let nowX {
                    HStack(spacing: 0) {
                        Color.clear.frame(width: nowX, height: 1)
                        Color.clear.frame(width: 2, height: 34).id(Self.nowMarkerId)
                        Spacer(minLength: 0)
                    }
                }
            }
            .background(NLColor.card)
            Rectangle().fill(NLColor.line).frame(height: 1)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                tableRow(row, p: p, slots: slots, totalW: totalW, nowMin: nowMin)
            }
        }
        .frame(width: totalW)

        return Group {
            if scrollable {
                // 卓が少なくて画面に収まるときは上下に動かない（2026-10-24 Ronnie「画面が上下に揺れないように」）
                ScrollView(.vertical) {
                    HStack(alignment: .top, spacing: 0) {
                        names
                        ScrollViewReader { proxy in
                            ScrollView(.horizontal, showsIndicators: true) {
                                grid.background(GeometryReader { g in
                                    Color.clear.preference(key: NLScrollXKey.self, value: g.frame(in: .named("nlBoard")).minX)
                                })
                            }
                            .coordinateSpace(name: "nlBoard")
                            .background(GeometryReader { g in Color.clear.preference(key: NLBoardWidthKey.self, value: g.size.width) })
                            .onPreferenceChange(NLScrollXKey.self) { x in
                                Task { @MainActor in noteScroll(x, nowX: nowX, totalW: totalW) }
                            }
                            .onPreferenceChange(NLBoardWidthKey.self) { w in
                                Task { @MainActor in
                                    let changed = abs(w - gridVisibleW) > 1
                                    gridVisibleW = w
                                    if changed, p.isToday, followNow { scrollToNow(proxy, animated: false) }
                                }
                            }
                            .onAppear {
                                boardProxy = proxy
                                if p.isToday, followNow { scrollToNowSoon(proxy) }
                            }
                            // 30 秒ごとに時刻が進む → 時間の側を左へ動かしてカーソルの場所へ
                            .onChange(of: model.now) { _ in if p.isToday, followNow { scrollToNow(proxy, animated: true) } }
                            .onChange(of: p.date) { _ in
                                followNow = true
                                if p.isToday { scrollToNowSoon(proxy) }
                            }
                        }
                    }
                }
                .nlNoVerticalBounce()
            } else {
                HStack(alignment: .top, spacing: 0) { names; grid }
            }
        }
    }

    /// 今の時刻の目印を、見えている幅の左から 1/4 の場所へ（日の始め・終わりでは端で止まる）
    private func scrollToNow(_ proxy: ScrollViewProxy, animated: Bool) {
        autoScrollUntil = Date().addingTimeInterval(1.2)
        autoScrolledOnce = true
        let anchor = UnitPoint(x: nowAnchor, y: 0)
        if animated {
            withAnimation(.easeInOut(duration: 0.5)) { proxy.scrollTo(Self.nowMarkerId, anchor: anchor) }
        } else {
            proxy.scrollTo(Self.nowMarkerId, anchor: anchor)
        }
    }

    /// 画面が組み上がってから（少し待って）カーソルの場所へ
    private func scrollToNowSoon(_ proxy: ScrollViewProxy) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 60_000_000)
            scrollToNow(proxy, animated: false)
        }
    }

    /// 横スクロールの位置が変わった。自動で動かした場所から大きく離れていたら、手で動かしたとみて追いかけるのをやめる
    private func noteScroll(_ x: CGFloat, nowX: CGFloat?, totalW: CGFloat) {
        guard followNow, autoScrolledOnce, let nowX, gridVisibleW > 0, Date() > autoScrollUntil else { return }
        let maxOffset = max(totalW - gridVisibleW, 0)
        let expected = -min(max(nowX - nowAnchor * gridVisibleW, 0), maxOffset)
        if abs(x - expected) > 48 { followNow = false }
    }

    /// 「今日」へ（カーソルを追いかけるのも再開）
    private func goToday() {
        followNow = true
        model.goToday()
    }

    /// 「現在」：手で動かしたあと、カーソルの場所へ戻る
    private func resumeFollow() {
        followNow = true
        if let proxy = boardProxy { scrollToNow(proxy, animated: true) }
    }

    /// 入り口の小さな印（Web の schedule-board の sourceBadge と同じ出し分け）。色は各社のブランド色（来店経路と同じ NPVisitSource の色）
    /// ウォークインは名前が「ウォークイン 様」なので印は出さない
    private func sourceChip(_ r: NLReservation, p: NLPayload) -> (text: String, color: Color, darkText: Bool)? {
        if r.createdVia == "walk_in" { return nil }
        if r.createdVia == "phone" { return ("TEL", NPVisitSource(id: "phone", label: "TEL").color, false) }
        if r.createdVia == "manual" && (r.sourceName ?? "").isEmpty { return ("手動", NLColor.gray, false) }
        if let name = r.sourceName, !name.isEmpty {
            let code = r.sourceId.flatMap { id in p.sourceRows.first { $0.id == id }?.code } ?? ""
            let short = name.count <= 4 ? name : String(name.prefix(3))
            if let c = Self.ledgerSourceColors[code] { return (short, c, false) }
            let v = NPVisitSource(id: code, label: name)
            return (short, v.color, v.darkText)
        }
        if r.createdVia == "web" { return ("WEB", NLColor.blue, false) }
        return nil
    }

    /// NPVisitSource に無い入り口の色（予約台帳だけの code）
    private static let ledgerSourceColors: [String: Color] = [
        "web": NLColor.blue,                 // 公式Web予約：青
        "gourmet_site": Color(hex: 0xF28C28), // グルメサイト：橙
        "table_one": Color(hex: 0x6C4AB6),    // TABLE ONE：紫
        "facebook": Color(hex: 0x1877F2),     // Facebook：青
        "yahoo_line": Color(hex: 0xFF0033),   // Yahoo!リザベーション：赤
        "storefront": Color(hex: 0x45403B),   // 店頭：チャコール
    ]

    /// マス目の縦の線：00 分は普通の線、30 分は少し細く、15・45 分はもっと細く
    /// （2026-10-24 18:53 Ronnie「00 ma normal line, 30 ma thorai masino, 15 ma ajai masino」）
    private func gridLines(from m: Int, minutes: Int, height: CGFloat) -> some View {
        let step = 15
        let marks = stride(from: 0, to: max(minutes, step), by: step).map { m + $0 }
        return ZStack(alignment: .topLeading) {
            ForEach(marks, id: \.self) { t in
                // 00 分 = 1pt（今までの線）、30 分 = 0.5pt、15・45 分 = 0.5pt でうすく
                let style: (w: CGFloat, a: Double) = t % 60 == 0 ? (1, 1) : t % 30 == 0 ? (0.5, 1) : (0.5, 0.5)
                Rectangle().fill(NLColor.line.opacity(style.a))
                    .frame(width: style.w, height: height)
                    .offset(x: CGFloat(t - m) / CGFloat(max(minutes, 1)) * slotW)
            }
        }
        .frame(width: slotW, height: height, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// 今より前の幅（今日は今の線まで、前の日は全部、先の日はなし）
    private func pastWidth(_ p: NLPayload, nowMin: Int?, totalW: CGFloat) -> CGFloat? {
        if p.date < p.today { return totalW }
        guard p.isToday, let nowMin else { return nil }
        let x = CGFloat(nowMin - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW
        return min(max(x, 0), totalW)
    }

    /// 空いたマスを押した：その卓・押した時刻（5 分に切り下げ）。過去・ウェイティングの行・書けない人は何もしない
    private func slotTapped(_ row: NLBoardRow, x: CGFloat, p: NLPayload, nowMin: Int?) {
        guard p.canWrite, let tableId = row.tableId else { return }
        let raw = p.viewStartMin + Int(x / slotW * CGFloat(p.slotMinutes))
        let minute = (raw / 5) * 5
        guard minute < 24 * 60 else { return }
        if p.date < p.today { return }
        if p.isToday, let now = nowMin, minute < (now / 5) * 5 { return }
        let nearNow = p.isToday && (nowMin.map { minute <= $0 + 30 } ?? false)
        quickSlot = NLQuickSlot(tableId: tableId, tableName: row.name, date: p.date, minute: minute, nearNow: nearNow)
    }

    private func tableRow(_ row: NLBoardRow, p: NLPayload, slots: Int, totalW: CGFloat, nowMin: Int?) -> some View {
        let h = row.height
        return HStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                // マス目（空いたところを押すと、その卓・その時間で受付。赤い今の線より先だけ。2026-10-24 20:21 Ronnie）
                HStack(spacing: 0) {
                    ForEach(0..<slots, id: \.self) { i in
                        let m = p.viewStartMin + i * p.slotMinutes
                        let closed = m < p.openMin || m >= p.closeMin
                        Rectangle().fill(closed ? NLColor.graySoft.opacity(0.6) : Color.clear)
                            .frame(width: slotW, height: h)
                            .overlay(alignment: .topLeading) { gridLines(from: m, minutes: p.slotMinutes, height: h) }
                    }
                }
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { v in slotTapped(row, x: v.location.x, p: p, nowMin: nowMin) })
                // 今より前の時間はうすく暗く（前の日は全部）
                if let pastW = pastWidth(p, nowMin: nowMin, totalW: totalW), pastW > 0 {
                    NLColor.pastShade.frame(width: pastW, height: h).allowsHitTesting(false)
                }
                // 押したマスの点線の枠（その場の受付を出しているあいだ）
                if let q = quickSlot, q.tableId == row.tableId, q.date == p.date {
                    let qx = CGFloat(q.minute - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW
                    HStack(spacing: 6) {
                        Image(systemName: "plus.circle.fill")
                        Text("\(nlHm(q.minute))〜").monospacedDigit()
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 13, weight: .heavy)).foregroundColor(Color(hex: 0x05603A))
                    .padding(.horizontal, 10)
                    .frame(width: slotW * 3, height: rowH - 12)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NLColor.greenSoft.opacity(0.85)))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(NLColor.green, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                    .popover(isPresented: Binding(get: { quickSlot != nil }, set: { if !$0 { quickSlot = nil } }), arrowEdge: .leading) {
                        NLQuickAddPanel(slot: q, onClose: { quickSlot = nil }, onReserve: { party, partyMax, tags in
                            slotPrefill = NLReservationPrefill(date: q.date, time: nlHm(q.minute), adults: party, tableIds: [q.tableId], partyMax: partyMax, tags: tags)
                            quickSlot = nil
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { newOpen = true }
                        }, onWalkIn: { party in
                            quickSlot = nil
                            Task {
                                if await model.act(["type": "ledgerWalkIn", "tableId": q.tableId, "adults": party, "children": 0, "name": "", "phone": ""]) != nil {
                                    await model.refresh(silent: true)
                                    model.show(toast: "\(q.tableName) に \(party)名 を案内しました")
                                }
                            }
                        })
                    }
                    .offset(x: max(0, qx) + 2, y: 6)
                }
                // 予約の箱
                ForEach(row.reservations) { r in
                    let s = nlJstMinutes(r.startAt, dayStart: p.date)
                    let e = nlJstMinutes(r.endAt, dayStart: p.date)
                    let x = CGFloat(s - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW
                    let w = max(slotW * 0.9, CGFloat(e - s) / CGFloat(p.slotMinutes) * slotW - 4)
                    let late = model.isLate(r)
                    // 退店したお客様はうすく（2026-10-24 20:32 Ronnie「退店した customers も dim」）
                    let out = r.status == "completed"
                    // 来店中はオーダー・会計の卓と同じ色（着席＝緑・注文済＝青・L.O.＝黄・時間超過＝赤・会計待ち＝橙）
                    let fs = out ? nil : floorState(r, p: p)
                    let ink: Color = fs?.band.ink ?? .white
                    // 箱は全部同じ色（見出しのネイビーを少し明るく）。入り口の印だけ各社の色で小さく。ウォークインは左の帯が紫
                    Button { selected = r } label: {
                        HStack(spacing: 0) {
                            Rectangle().fill(r.createdVia == "walk_in" ? NLColor.walkIn : NLColor.navy).frame(width: 5)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text("\(nlHm(s))").font(.system(size: 11, weight: .bold)).monospacedDigit()
                                    Text("\(stripSama(r.guestName)) 様").font(.system(size: 13, weight: .heavy)).lineLimit(1)
                                }
                                HStack(spacing: 5) {
                                    Text(r.partyLabel).font(.system(size: 11, weight: .bold))
                                    if let chip = sourceChip(r, p: p) {
                                        Text(chip.text).font(.system(size: 9, weight: .heavy)).lineLimit(1)
                                            .foregroundColor(chip.darkText ? NLColor.ink : .white)
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Capsule().fill(chip.color))
                                    }
                                    if let fs {
                                        // フロアと同じ状態と残り時間
                                        Text(fs.band.jp + (fs.left.map { $0 > 0 ? "・残\($0)分" : "・超過\(-$0)分" } ?? ""))
                                            .font(.system(size: 10, weight: .heavy)).monospacedDigit()
                                            .foregroundColor(ink.opacity(0.9))
                                    } else {
                                        Text(late ? "未連絡" : (p.statusLabels[r.status] ?? r.status)).font(.system(size: 10, weight: .bold))
                                            .foregroundColor(late ? NLColor.yellow : Color.white.opacity(0.8))
                                    }
                                    // 予約のタグ（区分のタグは小さいアイコンつき。2026-10-24 Ronnie「台帳の予約カードに小さく」）
                                    ForEach(Array((r.tags ?? []).filter { $0 != "要連絡" }.prefix(3)), id: \.self) { t in
                                        HStack(spacing: 2) {
                                            if let ic = p.tagIcons?[t] { Image(systemName: NRWTagIcon.symbol(ic)).font(.system(size: 8, weight: .bold)) }
                                            else if let ic = NRWKeywordIcon.symbol(for: t) { Image(systemName: ic).font(.system(size: 8, weight: .bold)) }
                                            Text(t).font(.system(size: 9, weight: .bold)).lineLimit(1)
                                        }
                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                        .background(Capsule().fill(ink.opacity(0.18)))
                                    }
                                }
                            }
                            .foregroundColor(ink)
                            .padding(.horizontal, 6)
                            Spacer(minLength: 0)
                        }
                        .frame(width: w, height: rowH - 10)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(out ? NLColor.gray : (fs?.band.color ?? NLColor.box)))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(out ? NLColor.gray : (fs.map { $0.band.color.opacity(0.9) } ?? NLColor.navy.opacity(0.5)), lineWidth: 1))
                        .clipped()
                        .opacity(out ? 0.5 : 1)
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                    .offset(x: max(0, x) + 2, y: 5 + CGFloat(row.lane[r.id] ?? 0) * laneStep)
                }
                // 今の時刻の線
                if let nowMin, nowMin >= p.viewStartMin, nowMin <= p.viewEndMin {
                    Rectangle().fill(NLColor.red).frame(width: 2, height: h)
                        .offset(x: CGFloat(nowMin - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW)
                }
            }
            .frame(width: totalW, height: h)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
    }

    // MARK: 予約リスト

    // MARK: グルメ別（入り口ごとの組数・名数と一覧）

    private static let viaLabel: [String: String] = ["web": "WEB予約", "phone": "電話", "walk_in": "直接来店", "manual": "手動登録"]

    private func gourmetRows(_ p: NLPayload) -> some View {
        let live = p.reservations.filter { $0.status != "cancelled" && $0.status != "no_show" }
        var groups: [String: [NLReservation]] = [:]
        for r in live {
            let key = (r.sourceName?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? Self.viaLabel[r.createdVia] ?? "そのほか"
            groups[key, default: []].append(r)
        }
        let ordered = groups.map { (name: $0.key, rows: $0.value, guests: $0.value.reduce(0) { $0 + $1.partySize }) }
            .sorted { $0.rows.count != $1.rows.count ? $0.rows.count > $1.rows.count : $0.name < $1.name }
        let totalGuests = live.reduce(0) { $0 + $1.partySize }
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("グルメ別").font(.system(size: 18, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("Gourmet").font(.system(size: 11)).foregroundColor(NLColor.muted)
                Text(p.date.replacingOccurrences(of: "-", with: "/")).font(.system(size: 13)).foregroundColor(NLColor.muted)
                Spacer()
                Text("合計 \(live.count)組 \(totalGuests)名").font(.system(size: 13)).monospacedDigit().foregroundColor(NLColor.muted)
            }
            if ordered.isEmpty {
                VStack(spacing: 4) {
                    Text("この日の予約はありません").font(.system(size: 15, weight: .bold))
                    Text("日付を変えるか、右上の「予約登録」から追加してください。").font(.system(size: 12)).foregroundColor(NLColor.muted)
                }.frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                    ForEach(ordered, id: \.name) { g in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 5) {
                                if let first = g.rows.first, let st = NLSource.style(for: first, in: p) { Circle().fill(st.color).frame(width: 8, height: 8) }
                                Text(g.name).font(.system(size: 12, weight: .medium)).foregroundColor(NLColor.muted).lineLimit(1)
                            }
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text("\(g.rows.count)").font(.system(size: 22, weight: .heavy)).foregroundColor(NLColor.blue)
                                Text("組").font(.system(size: 12)).foregroundColor(NLColor.muted)
                                Text("\(g.guests)").font(.system(size: 22, weight: .heavy)).foregroundColor(NLColor.ink)
                                Text("名").font(.system(size: 12)).foregroundColor(NLColor.muted)
                            }.monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .background(RoundedRectangle(cornerRadius: 12).fill(NLColor.card))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
                    }
                }
                ForEach(ordered, id: \.name) { g in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if let first = g.rows.first, let st = NLSource.style(for: first, in: p) { Circle().fill(st.color).frame(width: 10, height: 10) }
                            Text(g.name).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.navy)
                            Text("\(g.rows.count)組 \(g.guests)名").font(.system(size: 12)).foregroundColor(NLColor.muted)
                        }
                        VStack(spacing: 0) {
                            ForEach(g.rows) { r in
                                let late = model.isLate(r)
                                let tone = NLColor.tone(r.status, late: late)
                                Button { selected = r } label: {
                                    HStack(spacing: 12) {
                                        Text("\(nlHm(nlJstMinutes(r.startAt, dayStart: p.date)))〜\(nlHm(nlJstMinutes(r.endAt, dayStart: p.date)))").font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(NLColor.blue)
                                        Text(r.partyLabel).font(.system(size: 13, weight: .bold)).monospacedDigit()
                                        Text("\(stripSama(r.guestName)) 様").font(.system(size: 13, weight: .medium)).lineLimit(1)
                                        if let c = r.courseName { Text(c).font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(1) }
                                        Spacer()
                                        Text(r.tableNames.isEmpty ? "席未定" : r.tableNames.joined(separator: "+")).font(.system(size: 12)).foregroundColor(NLColor.muted)
                                        if r.createdVia == "gourmet_mail" { Image(systemName: "envelope.fill").font(.system(size: 11)).foregroundColor(NLColor.muted) }
                                        Text(late ? "未連絡" : (p.statusLabels[r.status] ?? r.status)).font(.system(size: 11, weight: .bold)).foregroundColor(tone.1)
                                            .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(tone.0))
                                    }
                                    .foregroundColor(NLColor.ink)
                                    .padding(.horizontal, 12).padding(.vertical, 9)
                                }.buttonStyle(.plain)
                                .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
                            }
                        }
                        .background(RoundedRectangle(cornerRadius: 12).fill(NLColor.card))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
        .padding(16)
    }

    private func listChip(_ t: String, on: Bool) -> some View {
        Text(t).font(.system(size: 13, weight: .semibold)).foregroundColor(on ? .white : NLColor.muted)
            .padding(.horizontal, 14).frame(height: 34)
            .background(Capsule().fill(on ? NLColor.navy : NLColor.card))
            .overlay(Capsule().stroke(on ? Color.clear : NLColor.line, lineWidth: 1))
    }

    private func listBody(_ p: NLPayload) -> some View {
        ScrollView { listRows(p) }.nlNoVerticalBounce()
    }

    private func listRows(_ p: NLPayload) -> some View {
            let rows = model.pendingOnly ? p.reservations.filter { $0.status == "pending" } : p.reservations
            return LazyVStack(spacing: 8) {
                HStack(spacing: 8) {
                    Button { model.pendingOnly = false } label: { listChip("すべて", on: !model.pendingOnly) }.buttonStyle(.plain)
                    Button { model.pendingOnly = true } label: { listChip("未連絡の予約（\(p.reservations.filter { $0.status == "pending" }.count)）", on: model.pendingOnly) }.buttonStyle(.plain)
                    Spacer()
                }
                if rows.isEmpty {
                    Text(model.pendingOnly ? "未連絡の予約はありません" : "この日の予約はありません").font(.system(size: 14)).foregroundColor(NLColor.muted).padding(.vertical, 40)
                }
                ForEach(rows) { r in
                    let late = model.isLate(r)
                    let tone = NLColor.tone(r.status, late: late)
                    Button { selected = r } label: {
                        HStack(spacing: 14) {
                            Rectangle().fill(NLColor.bar(r.status, late: late)).frame(width: 5, height: 44).clipShape(Capsule())
                            Text("\(nlHm(nlJstMinutes(r.startAt, dayStart: p.date)))〜\(nlHm(nlJstMinutes(r.endAt, dayStart: p.date)))")
                                .font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NLColor.ink).frame(width: 130, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text("\(stripSama(r.guestName)) 様").font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.ink)
                                    if let st = NLSource.style(for: r, in: p) { NLSourceChip(style: st, auto: r.createdVia == "gourmet_mail", size: 10) }
                                }
                                Text([r.sourceName, r.courseName, r.tags?.joined(separator: " ")].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ・ "))
                                    .font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(1)
                            }
                            Spacer()
                            Text(r.partyLabel).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.ink)
                            Text(r.tableNames.isEmpty ? "席未定" : r.tableNames.joined(separator: " + ")).font(.system(size: 13)).foregroundColor(NLColor.muted).frame(width: 110, alignment: .leading)
                            Text(late ? "未連絡" : (p.statusLabels[r.status] ?? r.status))
                                .font(.system(size: 12, weight: .bold)).foregroundColor(tone.1)
                                .padding(.horizontal, 10).padding(.vertical, 5).background(Capsule().fill(tone.0))
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.card))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle(scale: 0.99))
                }
            }
            .padding(16)
    }
}
