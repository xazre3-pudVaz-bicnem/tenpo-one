import SwiftUI

// ネイティブの「テーブル一覧」（Order & Pay のフロア）。Web の /app/floor と同じ中身（/api/app/v1/floor）。
// 2026-10-13 Ronnie「iPad がアプリらしくない。テーブルの画面もネイティブに」。
// 卓をタップ：空席 → 人数を選んで着席 → オーダー、お客様がいる卓 → オーダー、清掃中 → 清掃完了。
// それ以外（予約の来店・テーブル連携・移動・メモ…）は「Classic」で今までの画面。

// MARK: - 卓の状態（Web の components/floor/types.ts の tileState と同じ順）

enum NFTileState {
    case free, reserved, waiting, seated, ordered, lastOrder, over, pay, cleaning, closed

    var label: String {
        switch self {
        case .free: return "Free"
        case .reserved: return "Reserved"
        case .waiting: return "Waitlist"
        case .seated: return "Seated"
        case .ordered: return "Ordered"
        case .lastOrder: return "Last order"
        case .over: return "Over time"
        case .pay: return "To pay"
        case .cleaning: return "Cleaning"
        case .closed: return "Closed"
        }
    }

    var color: Color {
        switch self {
        case .free, .closed: return NT.ink3
        case .reserved, .waiting, .seated: return NT.purpleDeep
        case .ordered: return NT.purple
        case .lastOrder: return Color(hex: 0x8A6100)
        case .over: return NT.danger
        case .pay: return Color(hex: 0xC26A00)
        case .cleaning: return NT.ink2
        }
    }

    var surface: Color {
        switch self {
        case .lastOrder: return Color(hex: 0xFFFBEB)
        case .over: return NT.dangerBg
        case .pay: return Color(hex: 0xFFF3E0)
        case .cleaning, .closed: return Color(hex: 0xF6F3FB)
        default: return .white
        }
    }

    var hasGuests: Bool { [.seated, .ordered, .lastOrder, .over, .pay].contains(self) }
}

/// L.O.（ラストオーダー）とみなす残り時間（分）。Web と同じ
private let lastOrderWarnMinutes = 30

extension APIFloorTable {
    func state(nowMs: Double) -> NFTileState {
        if order == nil && status == "unavailable" { return .closed }
        if order == nil && status == "cleaning" { return .cleaning }
        if status == "billing" { return .pay }
        guard let o = order else {
            if status == "seated" || status == "ordering" { return .seated }
            if status == "waiting" { return .waiting }
            if status == "reserved" { return .reserved }
            return .free
        }
        let left = Int(ceil((o.endAtMs - nowMs) / 60_000))
        if left <= 0 { return .over }
        if left <= lastOrderWarnMinutes { return .lastOrder }
        return o.total > 0 ? .ordered : .seated
    }
}

// MARK: - データ

@MainActor
final class NativeFloorModel: ObservableObject {
    @Published var storeName = ""
    @Published var floors: [APIFloor] = []
    /// 開いているフロア（nil＝すべて）
    @Published var floorId: String?
    @Published var tables: [APIFloorTable] = []
    @Published var reservations: [APIFloorReservation] = []
    @Published var canOperate = true
    @Published var loading = true
    @Published var busy = false
    @Published var notice: String?
    @Published var nowMs: Double = Date().timeIntervalSince1970 * 1000
    /// サーバーの時計との差（端末の時計がずれていても経過時間を合わせる）
    private var skewMs: Double = 0
    private var didPickFloor = false
    /// 見本のデータ（シミュレーターで形を確かめる用）
    var isSample = false

    var visibleTables: [APIFloorTable] {
        guard let f = floorId else { return tables }
        return tables.filter { $0.floorId == f }
    }

    func tick() { nowMs = Date().timeIntervalSince1970 * 1000 + skewMs }

    func load(silent: Bool = false) async {
        if isSample { loading = false; return }
        if !silent { loading = tables.isEmpty }
        defer { loading = false }
        do {
            let p = try await NativeAPI.shared.loadFloor()
            storeName = p.store.name
            if AppState.shared.storeName != p.store.name { AppState.shared.storeName = p.store.name }
            floors = p.floors
            tables = p.tables
            reservations = p.reservations
            canOperate = p.canOperate
            skewMs = p.serverNow - Date().timeIntervalSince1970 * 1000
            tick()
            if !didPickFloor {
                didPickFloor = true
                if let d = p.defaultFloorId, p.floors.contains(where: { $0.id == d }) { floorId = d }
            }
            if !silent { notice = nil }
        } catch let e as NativeAPIError {
            if !silent { notice = e.message }
            if e.useWeb { AppState.shared.chooseClassic(path: "/app/floor") }
        } catch {
            if !silent { notice = "Couldn't load the tables. Check the connection." }
        }
    }

    /// 空席に着席（人数）→ 伝票を開く
    func seat(_ table: APIFloorTable, partySize: Int) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(["type": "walkIn", "tableId": table.id, "partySize": partySize])
            if let id = r.orderId { AppState.shared.openNativeOrder(id) }
            await load(silent: true)
        } catch {
            notice = error.localizedDescription
        }
    }

    /// お客様がいる卓の伝票を開く（伝票が無ければサーバーが作る）
    func open(_ table: APIFloorTable, slip: String? = nil) async {
        if let slip {
            AppState.shared.openNativeOrder(slip)
            return
        }
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(["type": "openOrder", "tableId": table.id])
            if let id = r.orderId { AppState.shared.openNativeOrder(id) }
        } catch {
            notice = error.localizedDescription
        }
    }

    func cleaningDone(_ table: APIFloorTable) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await NativeAPI.shared.floorAct(["type": "cleaningDone", "tableId": table.id])
            await load(silent: true)
        } catch {
            notice = error.localizedDescription
        }
    }
}

// MARK: - 画面

struct NativeFloorView: View {
    @StateObject private var model: NativeFloorModel

    init(model: NativeFloorModel? = nil) {
        _model = StateObject(wrappedValue: model ?? NativeFloorModel())
    }
    /// 人数を選んでいる空席
    @State private var seating: APIFloorTable?
    /// 伝票が2枚以上の卓（どれを開くか選ぶ）
    @State private var pickSlip: APIFloorTable?
    @State private var cleaning: APIFloorTable?
    @State private var other: APIFloorTable?
    @State private var clock = Date()

    private let poll = Timer.publish(every: 15, on: .main, in: .common).autoconnect()
    private let second = Timer.publish(every: 20, on: .main, in: .common).autoconnect()

    var body: some View {
        withDialogs(main)
            .task { await model.load() }
            .onReceive(poll) { _ in Task { await model.load(silent: true) } }
            .onReceive(second) { _ in model.tick(); clock = Date() }
            .onReceive(NotificationCenter.default.publisher(for: .tenpoFloorReload)) { _ in Task { await model.load(silent: true) } }
    }

    static func billLabel(_ no: Int) -> String { "Bill #" + String(no) }

    private var main: some View {
        VStack(spacing: 0) {
            NativeTopBar(
                storeName: model.storeName, title: "Tables", subtitle: "テーブル一覧",
                userName: Self.hm(clock),
                onHome: { AppState.shared.nativeScreen = .home },
                onWeb: { AppState.shared.chooseClassic(path: "/app/floor") },
                backText: "Home", rightIcon: "clock"
            )
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 10) {
                    floorTabs
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 158, maximum: 240), spacing: 12)], spacing: 12) {
                            ForEach(model.visibleTables) { t in
                                NFTableTile(table: t, nowMs: model.nowMs) { tap(t) }
                            }
                        }
                        .padding(.bottom, 12)
                    }
                    .refreshable { await model.load(silent: true) }
                    legend
                }
                reservationsPanel.frame(width: 300)
            }
            .padding(12)
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .top) { noticeBanner }
        .overlay {
            if model.loading {
                ZStack {
                    NT.page.opacity(0.85).ignoresSafeArea()
                    ProgressView("Loading…").font(.system(size: 16, weight: .bold)).tint(NT.purple)
                }
            }
        }
        .overlay {
            if let t = seating {
                NFSeatPanel(table: t, busy: model.busy, onCancel: { seating = nil }) { n in
                    seating = nil
                    Task { await model.seat(t, partySize: n) }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: seating?.id)
    }

    private func withDialogs<V: View>(_ v: V) -> some View {
        v
        .confirmationDialog("Which bill?", isPresented: Binding(get: { pickSlip != nil }, set: { if !$0 { pickSlip = nil } }), titleVisibility: .visible) {
            if let t = pickSlip, let o = t.order {
                ForEach(o.slips, id: \.id) { s in
                    Button(Self.billLabel(s.orderNo)) { Task { await model.open(t, slip: s.id) } }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Cleaning done?", isPresented: Binding(get: { cleaning != nil }, set: { if !$0 { cleaning = nil } }), titleVisibility: .visible) {
            if let t = cleaning {
                Button("Cleaning done — " + t.name + " is free") { Task { await model.cleaningDone(t) } }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(otherTitle,
                            isPresented: Binding(get: { other != nil }, set: { if !$0 { other = nil } }), titleVisibility: .visible) {
            if let t = other {
                Button("Open on classic screen") { AppState.shared.openWeb("/app/floor/\(t.id)") }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Reservations check-in and closed tables are handled on the classic screen.")
        }
    }

    private var otherTitle: String {
        guard let t = other else { return "" }
        return t.name + " · " + t.state(nowMs: model.nowMs).label
    }

    private func tap(_ t: APIFloorTable) {
        guard !model.busy else { return }
        let st = t.state(nowMs: model.nowMs)
        if let o = t.order {
            if o.slips.count > 1 { pickSlip = t } else { Task { await model.open(t, slip: o.id) } }
            return
        }
        switch st {
        case .free:
            if model.canOperate { seating = t } else { model.notice = "You can't seat guests with this account." }
        case .seated, .pay:
            Task { await model.open(t) }
        case .cleaning:
            cleaning = t
        default:
            other = t
        }
    }

    // フロアの切り替え（すべて＋フロア）
    private var floorTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if model.floors.count > 1 { tab("All", id: nil) }
                ForEach(model.floors) { f in tab(f.name, id: f.id) }
                Spacer(minLength: 0)
            }
        }
        .frame(height: model.floors.count > 1 ? 44 : 0)
        .opacity(model.floors.count > 1 ? 1 : 0)
    }

    private func tab(_ title: String, id: String?) -> some View {
        let on = model.floorId == id
        return Button { model.floorId = id } label: {
            Text(title).font(.system(size: 16, weight: .bold))
                .foregroundColor(on ? .white : NT.ink2)
                .padding(.horizontal, 18).frame(height: 40)
                .background(Capsule().fill(on ? NT.purple : Color.white))
                .overlay(Capsule().stroke(on ? Color.clear : NT.lilacLine, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private var legend: some View {
        HStack(spacing: 14) {
            ForEach([NFTileState.seated, .ordered, .lastOrder, .over, .pay, .free], id: \.label) { s in
                HStack(spacing: 5) {
                    Circle().fill(s == .free ? NT.lilacLine : s.color).frame(width: 9, height: 9)
                    Text(s.label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2)
                }
            }
            Spacer()
            Text("Bar = time left").font(.system(size: 12)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 4)
    }

    // 右：今日の予約
    private var reservationsPanel: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Today's reservations").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(verbatim: "\(model.reservations.count)").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            Divider().overlay(NT.line)
            if model.reservations.isEmpty {
                Spacer()
                Text("No reservations today").font(.system(size: 14)).foregroundColor(NT.ink3)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(model.reservations) { r in
                            HStack(alignment: .top, spacing: 10) {
                                Text(r.time).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.purple).frame(width: 48, alignment: .leading)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                    Text(verbatim: "\(r.partySize) pax · \(r.tableLabel == "席未定" ? "No table" : r.tableLabel)")
                                        .font(.system(size: 12)).foregroundColor(NT.ink2).lineLimit(1)
                                }
                                Spacer(minLength: 4)
                                Text(Self.statusLabel(r.status))
                                    .font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink2)
                                    .padding(.horizontal, 7).padding(.vertical, 3)
                                    .background(Capsule().fill(NT.lilac))
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            Divider().overlay(NT.line).padding(.leading, 14)
                        }
                    }
                }
            }
            Button { AppState.shared.openWeb("/app/reservations") } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                    Text("Open reservation book")
                }
                .font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(NT.lilac))
            }
            .buttonStyle(PressableStyle())
            .padding(12)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    @ViewBuilder private var noticeBanner: some View {
        if let n = model.notice {
            Button { model.notice = nil } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text(n).multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Image(systemName: "xmark")
                }
                .font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14).fill(NT.dangerBg))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(NT.danger.opacity(0.3), lineWidth: 1))
                .frame(maxWidth: 720)
            }
            .buttonStyle(.plain)
            .padding(.top, 74)
        }
    }

    static func statusLabel(_ s: String) -> String {
        switch s {
        case "pending": return "Pending"
        case "confirmed": return "Booked"
        case "waiting": return "Waitlist"
        case "arrived": return "Arrived"
        case "seated": return "Seated"
        case "billing": return "Paying"
        case "completed": return "Done"
        case "no_show": return "No-show"
        default: return s
        }
    }

    static func hm(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

// MARK: - 卓の箱

private struct NFTableTile: View {
    let table: APIFloorTable
    let nowMs: Double
    let onTap: () -> Void

    var body: some View {
        let st = table.state(nowMs: nowMs)
        let o = table.order
        let next = table.upcoming.first { $0.startMs >= nowMs - 30 * 60_000 }
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(table.name).font(.system(size: 20, weight: .heavy))
                        .foregroundColor(st.hasGuests ? NT.ink : NT.ink3).lineLimit(1)
                    Spacer(minLength: 4)
                    HStack(spacing: 3) {
                        Image(systemName: "person.2.fill").font(.system(size: 11))
                        Text(verbatim: o.map { "\($0.guestCount)/\(table.capacityMax)" } ?? "\(table.capacityMax)")
                    }
                    .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                }
                Text(st.label).font(.system(size: 13, weight: .heavy)).foregroundColor(st.color)
                if let o {
                    let elapsed = max(0, Int((nowMs - o.openedAtMs) / 60_000))
                    let left = Int(ceil((o.endAtMs - nowMs) / 60_000))
                    HStack(spacing: 4) {
                        Image(systemName: "clock").font(.system(size: 11))
                        Text(verbatim: "\(elapsed) min")
                        if left > 0 { Text(verbatim: "· \(left) left").foregroundColor(NT.ink3) }
                    }
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
                    Text(NT.yen(o.total)).font(.system(size: 19, weight: .heavy)).foregroundColor(NT.ink)
                    if let name = o.guestName ?? o.clerkName {
                        Text(name).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                    }
                } else if let n = next {
                    Text(verbatim: "Next \(n.time) · \(n.partySize) pax")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NT.purpleDeep).lineLimit(1)
                    Text(n.name).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 0)
                if !table.groupNames.isEmpty {
                    Label(table.groupNames.joined(separator: "+"), systemImage: "link")
                        .font(.system(size: 11, weight: .bold)).foregroundColor(NT.purpleDeep).lineLimit(1)
                }
                if let o {
                    // 残り時間のバー
                    let limit = max(1, (o.endAtMs - o.openedAtMs) / 60_000)
                    let frac = min(1, max(0, ((o.endAtMs - nowMs) / 60_000) / limit))
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NT.lilac)
                            Capsule().fill(st == .over ? NT.danger : st == .lastOrder ? Color(hex: 0xE0AE00) : st == .pay ? Color(hex: 0xE08A00) : NT.purple)
                                .frame(width: g.size.width * frac)
                        }
                    }
                    .frame(height: 5)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(st.surface))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(st == .free || st == .reserved ? NT.lilacLine : st.color.opacity(0.35),
                            style: StrokeStyle(lineWidth: st == .free ? 1.5 : 1.5, dash: st == .free ? [5, 4] : []))
            )
            .overlay(alignment: .topTrailing) {
                if !table.calls.isEmpty {
                    let checkout = table.calls.contains { $0.kind == "checkout" }
                    Label(checkout ? "Bill" : "Call", systemImage: "bell.fill")
                        .font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Color(hex: 0xB44814)))
                        .offset(x: 4, y: -8)
                }
            }
            .opacity(st == .closed ? 0.6 : 1)
        }
        .buttonStyle(PressableStyle(scale: 0.97))
    }
}

// MARK: - 着席（人数）

private struct NFSeatPanel: View {
    let table: APIFloorTable
    let busy: Bool
    let onCancel: () -> Void
    let onSeat: (Int) -> Void
    @State private var count: Int

    init(table: APIFloorTable, busy: Bool, onCancel: @escaping () -> Void, onSeat: @escaping (Int) -> Void) {
        self.table = table
        self.busy = busy
        self.onCancel = onCancel
        self.onSeat = onSeat
        _count = State(initialValue: max(1, min(table.capacityMin, table.capacityMax)))
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.38).ignoresSafeArea().onTapGesture(perform: onCancel)
            VStack(spacing: 18) {
                VStack(spacing: 4) {
                    Text(verbatim: "\(table.name) · Seat guests").font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                    Text(verbatim: "Up to \(table.capacityMax) seats").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                }
                HStack(spacing: 22) {
                    stepButton("minus") { count = max(1, count - 1) }
                    Text(verbatim: "\(count)").font(.system(size: 56, weight: .heavy)).foregroundColor(NT.purple).frame(minWidth: 90)
                    stepButton("plus") { count = min(999, count + 1) }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
                    ForEach(1...12, id: \.self) { n in
                        Button { count = n } label: {
                            Text(verbatim: "\(n)").font(.system(size: 20, weight: .bold))
                                .foregroundColor(count == n ? .white : NT.ink)
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .background(RoundedRectangle(cornerRadius: 12).fill(count == n ? NT.purple : Color(hex: 0xF8F6FC)))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: count == n ? 0 : 1))
                        }
                        .buttonStyle(PressableStyle(scale: 0.93))
                    }
                }
                HStack(spacing: 10) {
                    Button(action: onCancel) {
                        Text("Cancel").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2)
                            .frame(maxWidth: .infinity, minHeight: 58)
                            .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                    Button { onSeat(count) } label: {
                        Text(verbatim: "Seat \(count) & order").font(.system(size: 18, weight: .heavy)).foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 58)
                            .background(RoundedRectangle(cornerRadius: 14).fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(busy)
                }
            }
            .padding(24)
            .frame(maxWidth: 520)
            .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(NT.card))
            .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
            .padding(28)
        }
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 24, weight: .bold)).foregroundColor(NT.purple)
                .frame(width: 64, height: 64)
                .background(Circle().fill(NT.lilac))
        }
        .buttonStyle(PressableStyle(scale: 0.9))
    }
}

// MARK: - 見本（-tenpoNativePreview floor）

extension NativeFloorModel {
    static func sample() -> NativeFloorModel {
        let m = NativeFloorModel()
        m.isSample = true
        m.loading = false
        m.storeName = "MEAT CROWN 新横浜"
        let now = Date().timeIntervalSince1970 * 1000
        let min = 60_000.0
        func order(_ no: Int, _ guests: Int, _ total: Int, _ started: Double, _ limit: Double, name: String? = nil) -> APIFloorOrder {
            APIFloorOrder(id: "o\(no)", orderNo: no, openedAtMs: now - started * min, endAtMs: now - started * min + limit * min,
                          guestCount: guests, total: total, clerkName: "Bimal", guestName: name, sourceLabel: "Walk in",
                          courseLabel: nil, slips: [APIFloorSlip(id: "o\(no)", orderNo: no)])
        }
        func t(_ id: String, _ name: String, _ cap: Int, _ status: String, _ o: APIFloorOrder? = nil,
               upcoming: [APIFloorUpcoming] = [], calls: [APIFloorCall] = [], floor: String = "f1") -> APIFloorTable {
            APIFloorTable(id: id, floorId: floor, name: name, capacityMin: 1, capacityMax: cap, status: status, isCounter: false,
                          isPrivateRoom: false, order: o, upcoming: upcoming, groupNames: [], calls: calls)
        }
        m.floors = [APIFloor(id: "f1", name: "1F"), APIFloor(id: "f2", name: "2F")]
        m.tables = [
            t("t1", "T1", 4, "seated", order(6001, 3, 8_420, 52, 120)),
            t("t2", "T2", 4, "available"),
            t("t3", "T3", 2, "seated", order(5998, 2, 3_130, 35, 120, name: "Tanaka")),
            t("t4", "T4", 6, "seated", order(6003, 5, 21_780, 98, 120), calls: [APIFloorCall(kind: "checkout")]),
            t("t5", "T5", 4, "available", upcoming: [APIFloorUpcoming(id: "r1", startMs: now + 40 * min, time: "19:30", name: "Suzuki", partySize: 4, sourceLabel: "Tabelog")]),
            t("t6", "T6", 2, "seated", order(6005, 2, 0, 6, 90)),
            t("t7", "T7", 8, "seated", order(5990, 7, 46_200, 131, 120)),
            t("t8", "T8", 4, "cleaning"),
            t("t9", "C1", 1, "available"),
            t("t10", "C2", 1, "billing", order(6007, 1, 2_480, 70, 120)),
            t("t11", "T11", 4, "available"),
            t("t12", "T12", 4, "unavailable"),
        ]
        m.reservations = [
            APIFloorReservation(id: "r1", startMs: now + 40 * min, time: "19:30", name: "Suzuki", partySize: 4, tableLabel: "T5", status: "confirmed"),
            APIFloorReservation(id: "r2", startMs: now + 70 * min, time: "20:00", name: "Kim", partySize: 2, tableLabel: "席未定", status: "pending"),
            APIFloorReservation(id: "r3", startMs: now - 50 * min, time: "17:45", name: "Tanaka", partySize: 2, tableLabel: "T3", status: "seated"),
        ]
        m.tick()
        return m
    }
}
