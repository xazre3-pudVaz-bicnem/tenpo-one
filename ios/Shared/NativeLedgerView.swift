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
    private var clock: Timer?
    private var refresher: Timer?
    private var offset: TimeInterval = 0

    func start() {
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
        if !silent { loading = true }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var items = [URLQueryItem(name: "part", value: "ledger")]
            if let date { items.append(URLQueryItem(name: "date", value: date)) }
            comps.queryItems = items
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
    @State private var findSeatsOpen = false
    @State private var walkInOpen = false
    @State private var exporting = false

    private let rowH: CGFloat = 64
    private let slotW: CGFloat = 96
    private let nameW: CGFloat = 132

    var body: some View {
        VStack(spacing: 0) {
            topBar
            // Web と同じ上のボタン（退店管理・CSV出力・集計・PDF作成・＋予約登録・📅）
            NLToolbar(
                model: model,
                onFloor: onFloor,
                onWeb: onWeb,
                onNew: { newOpen = true },
                onFindSeats: { findSeatsOpen = true },
                onWalkIn: { walkInOpen = true },
                onPdf: { makePdf() },
                onCsv: { exportCsv() }
            )
            .disabled(exporting)
            if let p = model.payload {
                summaryRow(p)
                if model.waitMode {
                    NativeLedgerWaitView(model: model, onOpenOrder: onOpenOrder)
                } else if model.weekMode {
                    NativeLedgerWeekView(date: model.date ?? p.date) { d in
                        model.weekMode = false; model.listMode = false; model.gourmetMode = false; model.waitMode = false
                        model.date = d
                        Task { await model.refresh(silent: false) }
                    }
                } else if model.gourmetMode { ScrollView { gourmetRows(p) } } else if model.listMode { listBody(p) } else { board(p) }
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
        .sheet(isPresented: $newOpen) {
            NativeNewReservationSheet(model: model, onClose: { newOpen = false })
        }
        .sheet(isPresented: $findSeatsOpen) {
            NLFindSeatsSheet(model: model, onClose: { findSeatsOpen = false })
        }
        .sheet(isPresented: $walkInOpen) {
            NLWalkInSheet(model: model, onClose: { walkInOpen = false })
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
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
        HStack(spacing: 10) {
            Button(action: onHome) {
                HStack(spacing: 6) { Image(systemName: "chevron.left"); Text("ホーム") }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.12)))
            }
            .buttonStyle(PressableStyle())
            HStack(spacing: 6) {
                Image(systemName: "storefront")
                Text(model.payload?.store.name ?? "").lineLimit(1)
            }
            .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.12)))
            Spacer(minLength: 8)
            VStack(spacing: 0) {
                Text("店舗台帳").font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
                Text("Reservation").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.yellow)
            }
            Spacer(minLength: 8)
            // 日付
            HStack(spacing: 4) {
                navBtn("chevron.left") { model.shiftDate(-1) }
                Button { model.goToday() } label: {
                    Text(dateLabel).font(.system(size: 16, weight: .bold)).monospacedDigit().foregroundColor(.white)
                        .padding(.horizontal, 12).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.12)))
                }
                .buttonStyle(PressableStyle())
                navBtn("chevron.right") { model.shiftDate(1) }
                if let p = model.payload, !p.isToday {
                    Button { model.goToday() } label: {
                        Text("今日").font(.system(size: 14, weight: .bold)).foregroundColor(NLColor.navy)
                            .padding(.horizontal, 12).frame(height: 38)
                            .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.yellow))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            // 表示の切り替え
            HStack(spacing: 0) {
                modeBtn("スケジュール", on: !model.listMode && !model.gourmetMode && !model.weekMode && !model.waitMode) { model.listMode = false; model.gourmetMode = false; model.weekMode = false; model.waitMode = false }
                modeBtn("予約リスト", on: model.listMode && !model.gourmetMode && !model.weekMode && !model.waitMode) { model.listMode = true; model.gourmetMode = false; model.weekMode = false; model.waitMode = false }
                // グルメ別・週間は 📅 のメニューから（上のバーが狭いので）
                modeBtn("ウェイティング", on: model.waitMode) { model.waitMode = true }
            }
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.12)))
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(NLColor.navy.ignoresSafeArea(edges: .top))
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

    private func modeBtn(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold))
                .foregroundColor(on ? NLColor.navy : .white)
                .padding(.horizontal, 12).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.white : Color.clear))
                .padding(3)
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 集計

    private func summaryRow(_ p: NLPayload) -> some View {
        let s = p.summary
        return HStack(spacing: 10) {
            sumTile("ご予約", "\(s.count)", unit: "組", sub: "\(s.guests)名", color: NLColor.blue)
            sumTile("当日予約", "\(s.sameDayCount)", unit: "組", sub: "\(s.sameDayGuests)名", color: NLColor.navy2)
            sumTile("来店済み", "\(s.inCount)", unit: "組", sub: nil, color: NLColor.green)
            sumTile("退店", "\(s.outCount)", unit: "組", sub: nil, color: NLColor.gray)
            sumTile("来店待ち", "\(s.waitingCount)", unit: "組", sub: s.unconfirmed > 0 ? "未確定 \(s.unconfirmed)" : nil, color: NLColor.yellow)
            sumTile("キャンセル", "\(s.cancelled)", unit: "組", sub: nil, color: NLColor.red)
            Spacer()
            if p.isClosedDay {
                Text("定休日").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
            }
            Text("営業 \(nlHm(p.openMin))〜\(nlHm(p.closeMin))").font(.system(size: 13)).monospacedDigit().foregroundColor(NLColor.muted)
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
            }
        }
        .padding(.horizontal, 12).frame(height: 54)
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
        let unassigned = p.reservations.filter { $0.tableIds.isEmpty }
        let nowMin = p.isToday ? nlJstMinutes(ISO8601DateFormatter().string(from: model.now), dayStart: p.date) : nil
        let rows: [(name: String, status: String, reservations: [NLReservation])] =
            (unassigned.isEmpty ? [] : [("席未定", "\(unassigned.count)組", unassigned)])
            + p.tables.map { t in (t.name, t.statusLabel.isEmpty ? "\(t.capacityMax)名席" : t.statusLabel, p.reservations.filter { $0.tableIds.contains(t.id) }) }

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
                .frame(width: nameW, height: rowH, alignment: .leading)
                .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
            }
        }
        .frame(width: nameW)
        .background(NLColor.card)
        .overlay(alignment: .trailing) { Rectangle().fill(NLColor.line).frame(width: 1) }
        .shadow(color: Color.black.opacity(scrollable ? 0.06 : 0), radius: 6, x: 4, y: 0)
        .zIndex(1)

        let grid = VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<slots, id: \.self) { i in
                    let m = p.viewStartMin + i * p.slotMinutes
                    Text(nlHm(m)).font(.system(size: 12, weight: m % 60 == 0 ? .bold : .regular)).monospacedDigit()
                        .foregroundColor(m % 60 == 0 ? NLColor.ink : NLColor.muted)
                        .frame(width: slotW, height: 34, alignment: .leading)
                }
            }
            .background(NLColor.card)
            Rectangle().fill(NLColor.line).frame(height: 1)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                tableRow(reservations: row.reservations, p: p, slots: slots, totalW: totalW, nowMin: nowMin)
            }
        }
        .frame(width: totalW)

        return Group {
            if scrollable {
                ScrollView(.vertical) {
                    HStack(alignment: .top, spacing: 0) {
                        names
                        ScrollView(.horizontal, showsIndicators: true) { grid }
                    }
                }
            } else {
                HStack(alignment: .top, spacing: 0) { names; grid }
            }
        }
    }

    private func tableRow(reservations: [NLReservation], p: NLPayload, slots: Int, totalW: CGFloat, nowMin: Int?) -> some View {
        HStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                // マス目
                HStack(spacing: 0) {
                    ForEach(0..<slots, id: \.self) { i in
                        let m = p.viewStartMin + i * p.slotMinutes
                        let closed = m < p.openMin || m >= p.closeMin
                        Rectangle().fill(closed ? NLColor.graySoft.opacity(0.6) : Color.clear)
                            .frame(width: slotW, height: rowH)
                            .overlay(alignment: .leading) { Rectangle().fill(NLColor.line.opacity(m % 60 == 0 ? 1 : 0.5)).frame(width: 1) }
                    }
                }
                // 予約の箱
                ForEach(reservations) { r in
                    let s = nlJstMinutes(r.startAt, dayStart: p.date)
                    let e = nlJstMinutes(r.endAt, dayStart: p.date)
                    let x = CGFloat(s - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW
                    let w = max(slotW * 0.9, CGFloat(e - s) / CGFloat(p.slotMinutes) * slotW - 4)
                    let late = model.isLate(r)
                    let tone = NLColor.tone(r.status, late: late)
                    Button { selected = r } label: {
                        HStack(spacing: 0) {
                            Rectangle().fill(NLColor.bar(r.status, late: late)).frame(width: 5)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 4) {
                                    Text("\(nlHm(s))").font(.system(size: 11, weight: .bold)).monospacedDigit()
                                    Text("\(stripSama(r.guestName)) 様").font(.system(size: 13, weight: .heavy)).lineLimit(1)
                                }
                                HStack(spacing: 4) {
                                    Text("\(r.partySize)名").font(.system(size: 11, weight: .bold))
                                    if let src = r.sourceName { Text(src).font(.system(size: 10)).lineLimit(1) }
                                    Text(p.statusLabels[r.status] ?? r.status).font(.system(size: 10, weight: .bold)).opacity(0.8)
                                }
                            }
                            .foregroundColor(tone.1)
                            .padding(.horizontal, 6)
                            Spacer(minLength: 0)
                        }
                        .frame(width: w, height: rowH - 10)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tone.0))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(NLColor.bar(r.status, late: late).opacity(0.5), lineWidth: 1))
                        .clipped()
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                    .offset(x: max(0, x) + 2, y: 5)
                }
                // 今の時刻の線
                if let nowMin, nowMin >= p.viewStartMin, nowMin <= p.viewEndMin {
                    Rectangle().fill(NLColor.red).frame(width: 2, height: rowH)
                        .offset(x: CGFloat(nowMin - p.viewStartMin) / CGFloat(p.slotMinutes) * slotW)
                }
            }
            .frame(width: totalW, height: rowH)
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
                            Text(g.name).font(.system(size: 12, weight: .medium)).foregroundColor(NLColor.muted).lineLimit(1)
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
                                        Text("\(r.partySize)名").font(.system(size: 13, weight: .bold)).monospacedDigit()
                                        Text("\(stripSama(r.guestName)) 様").font(.system(size: 13, weight: .medium)).lineLimit(1)
                                        if let c = r.courseName { Text(c).font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(1) }
                                        Spacer()
                                        Text(r.tableNames.isEmpty ? "席未定" : r.tableNames.joined(separator: "+")).font(.system(size: 12)).foregroundColor(NLColor.muted)
                                        Text(p.statusLabels[r.status] ?? r.status).font(.system(size: 11, weight: .bold)).foregroundColor(tone.1)
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

    private func listBody(_ p: NLPayload) -> some View {
        ScrollView { listRows(p) }
    }

    private func listRows(_ p: NLPayload) -> some View {
            LazyVStack(spacing: 8) {
                if p.reservations.isEmpty {
                    Text("この日の予約はありません").font(.system(size: 14)).foregroundColor(NLColor.muted).padding(.vertical, 40)
                }
                ForEach(p.reservations) { r in
                    let late = model.isLate(r)
                    let tone = NLColor.tone(r.status, late: late)
                    Button { selected = r } label: {
                        HStack(spacing: 14) {
                            Rectangle().fill(NLColor.bar(r.status, late: late)).frame(width: 5, height: 44).clipShape(Capsule())
                            Text("\(nlHm(nlJstMinutes(r.startAt, dayStart: p.date)))〜\(nlHm(nlJstMinutes(r.endAt, dayStart: p.date)))")
                                .font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NLColor.ink).frame(width: 130, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(stripSama(r.guestName)) 様").font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.ink)
                                Text([r.sourceName, r.courseName, r.tags?.joined(separator: " ")].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ・ "))
                                    .font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(1)
                            }
                            Spacer()
                            Text("\(r.partySize)名").font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.ink)
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
