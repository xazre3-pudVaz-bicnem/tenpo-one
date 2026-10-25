import SwiftUI
import CoreImage.CIFilterBuiltins

// iPhone ハンディのテーブル一覧（ネイティブ）。Web の /handy と同じ見た目・同じ並び（2026-10-24 Ronnie「iOS ホーム画面もネイティブに」）。
//   上＝黒いバー（≡・店名・テーブル一覧・更新）／担当者を選ぶまではログイン画面／フロアのタブ／3列の卓タイル
//   下＝呼び出しの帯・黒いバー（SELECT ▴・HANDY・RESERVATION）
// 卓をタップ：利用中→Web の卓の画面（/handy/<id>）、空席→小さいポップアップ（注文を開始・まとめる・ロック）
// サーバー：GET /api/app/v1/pos?part=handy（lib/native-handy-server.ts。中身は Web の /handy と同じ）

struct NHDNamed: Codable, Identifiable, Hashable { let id: String; let name: String }
/// フロアのタブ（ALL・3F・4F・未分類）
struct NHDTab: Identifiable, Hashable { let id: String; let label: String }

struct NHDTable: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let floorId: String?
    let capacityMax: Int
    let currentStatus: String?
    let orderCount: Int
    let openedAtMs: Double?
    let guestCount: Int
    let total: Int
    let groupTableIds: [String]?
    let orderTableId: String?
}

struct NHDCall: Codable, Identifiable, Hashable {
    let id: String
    let tableId: String
    let tableName: String?
    let kind: String
    let createdAtMs: Double
    let note: String?
}

struct NHDPayload: Codable {
    let store: NHDNamed
    let stores: [NHDNamed]
    let currentStoreId: String?
    let isHq: Bool
    let serverNow: Double
    let today: String
    let accountName: String
    let clerk: NHDNamed?
    let clerks: [NHDNamed]
    let canOrder: Bool
    let canLock: Bool
    let bookingUrl: String?
    let tables: [NHDTable]
    let calls: [NHDCall]
    let floors: [NHDNamed]
    let defaultFloorId: String?
}

/// 卓の状態（Web の components/handy/logic.ts tableState と同じ）
enum NHDState {
    case occupied, available, reserved, cleaning, blocked

    static func of(_ t: NHDTable) -> NHDState {
        if t.orderCount > 0 { return .occupied }
        switch t.currentStatus {
        case "seated", "ordering", "billing": return .occupied
        case "cleaning": return .cleaning
        case "unavailable": return .blocked
        case "reserved": return .reserved
        default: return .available
        }
    }

    var ja: String {
        switch self {
        case .occupied: return "利用中"
        case .available: return "空席"
        case .reserved: return "予約あり"
        case .cleaning: return "清掃中"
        case .blocked: return "使用不可"
        }
    }

    var en: String {
        switch self {
        case .occupied: return "In use"
        case .available: return "Available"
        case .reserved: return "Reserved"
        case .cleaning: return "Cleaning"
        case .blocked: return "Locked"
        }
    }

    /// この状態の卓で、ハンディから新しい注文を始められるか（予約ありは来店処理が要るので不可）
    var canStartOrder: Bool { self == .available || self == .occupied || self == .cleaning }
    /// 空いている卓はタップでポップアップ（画面遷移しない）
    var usesSheet: Bool { self == .available || self == .blocked || self == .cleaning }
}

enum NHDColor {
    // 2026-10-25 01:40 Ronnie「iPhone も iPad のネイティブと同じデザイン」→ テラコッタをやめて iPad と同じネイビー・青・うすい灰色に
    static let bg = Color(hex: 0xF4F5F8)
    static let header = Color(hex: 0x171333)
    static let headerLine = Color(hex: 0x2B2650)
    static let accent = Color(hex: 0x2A6FE6)
    static let accentDeep = Color(hex: 0x0A3FA8)
    static let accentSoft = Color(hex: 0xE7EFFD)
    static let line = Color(hex: 0xE4E7EE)
    static let ink = Color(hex: 0x292725)
    static let ink2 = Color(hex: 0x50565F)
    static let ink3 = Color(hex: 0x8A909A)
    static let inkMid = Color(hex: 0x3A3F48)
    static let occupied = Color(hex: 0xEEF3FD)
    static let occupiedLine = Color(hex: 0xAFC6F3)
    static let blocked = Color(hex: 0xE4E7EE)
    static let blockedLine = Color(hex: 0xD3D8E2)
    static let gold = Color(hex: 0xB7791F)
    static let goldSoft = Color(hex: 0xFBF1D9)
    static let callBg = Color(hex: 0xFFF1E6)
    static let callLine = Color(hex: 0xEE853E)
    static let callInk = Color(hex: 0x842F0B)
    static let callBadge = Color(hex: 0xB44814)
    static let navMuted = Color(hex: 0xB9BDD6)
    static let navLabel = Color(hex: 0x9EA3C4)
    static let weakBtn = Color(hex: 0xF1F4FA)
    static let weakBtn2 = Color(hex: 0xEEF1F7)
    static let divider = Color(hex: 0xEDF0F5)
}

/** 経過時間（45分 / 1時間05分）。Web の elapsedLabel と同じ */
func nhdElapsed(fromMs: Double, now: Date) -> String {
    let minutes = max(0, Int((now.timeIntervalSince1970 * 1000 - fromMs) / 60_000))
    if minutes < 60 { return "\(minutes)分" }
    return "\(minutes / 60)時間" + String(format: "%02d", minutes % 60) + "分"
}

func nhdTime(_ ms: Double) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "ja_JP")
    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
    f.dateFormat = "H:mm"
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

@MainActor
final class NativeHandyModel: ObservableObject {
    @Published var payload: NHDPayload?
    @Published var error: String?
    /// 読めなかった（権限・回線など）。Web の /handy をそのまま見せる
    @Published var useWeb = false
    @Published var now = Date()
    @Published var busy = false
    @Published var toast: String?
    /// 卓の箱（iPad のネイティブのテーブル一覧と同じ中身。GET part=handyFloor。2026-10-25 02:22 Ronnie）。読めない卓は今までの箱
    @Published var floorTables: [String: NFTable] = [:]
    private var offset: TimeInterval = 0
    private var clock: Timer?
    private var refresher: Timer?

    func start() {
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.now = Date().addingTimeInterval(self.offset)
            }
        }
        // 注文・呼び出しは他の端末やお客様の QR からも増える。Web は Realtime、ネイティブは 12 秒ごとに読み直す
        refresher?.invalidate()
        refresher = Timer.scheduledTimer(withTimeInterval: 12, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { await refresh() }
    }

    func stop() {
        clock?.invalidate(); clock = nil
        refresher?.invalidate(); refresher = nil
    }

    func refresh() async {
        // 見本（シミュレーター・App Store の写真）では読みに行かない
        if NativePreview.current != nil { return }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "handy")]
            async let floorTask: Void = refreshFloor()
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NHDPayload.self, from: data)
            _ = await floorTask
            offset = p.serverNow / 1000 - Date().timeIntervalSince1970
            now = Date().addingTimeInterval(offset)
            payload = p
            error = nil
        } catch {
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            if payload == nil {
                // 最初から読めないときは Web の画面をそのまま（ログイン・回線の案内は Web が出す）
                useWeb = true
            } else {
                self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            }
        }
    }

    /// 卓の箱の中身（iPad と同じ）。読めなければ今までの箱のまま
    private struct FloorTables: Decodable { let tables: [NFTable] }
    private func refreshFloor() async {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "handyFloor")]
        guard let url = comps.url, let data = try? await NativeAPI.shared.send(URLRequest(url: url)),
              let f = try? JSONDecoder().decode(FloorTables.self, from: data) else { return }
        floorTables = Dictionary(f.tables.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// 操作（担当者・卓ロック・まとめ・呼び出し対応・店舗の切り替え・ログアウト）。終わったら読み直す
    @discardableResult
    func act(_ body: [String: Any], done: String? = nil) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { toast = r.error ?? "うまくいきませんでした"; return false }
            if let done { toast = done }
            await refresh()
            return true
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativeHandyHomeView: View {
    @ObservedObject var model: NativeHandyModel
    /// Web の画面を開く（卓の画面・今日の予約など）
    var onWeb: (String) -> Void = { _ in }
    /// アプリの使い方を変える（ハンディ／オーナー）
    var onChangeMode: () -> Void = {}
    /// ログアウトしたあと（Web の /handy を読み直す → お店の QR を読む画面）
    var onSignedOut: () -> Void = {}
    /// 店長・オーナーがハンディを開いたとき：オーナー・店長のホームへ戻る（スタッフのハンディは nil）
    var onHome: (() -> Void)? = nil

    @State private var floor: String = "all"
    @State private var sheetTableId: String?
    @State private var callsOpen = false
    @State private var drawerOpen = false
    @State private var selectOpen = false
    @State private var shareOpen = false

    var body: some View {
        ZStack(alignment: .bottom) {
            NHDColor.bg.ignoresSafeArea()
            if let p = model.payload {
                if p.clerk == nil {
                    NativeHandyLoginView(model: model, payload: p, onHome: onHome)
                } else {
                    VStack(spacing: 0) {
                        topBar(p)
                        tableList(p)
                        bottomBar(p)
                    }
                }
            } else {
                VStack(spacing: 0) {
                    topBar(nil)
                    Spacer()
                    if let e = model.error {
                        Text(e).font(.system(size: 14)).foregroundColor(NHDColor.ink3).padding()
                    } else {
                        ProgressView().tint(NHDColor.accent)
                    }
                    Spacer()
                }
            }
            if let t = model.toast {
                Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NHDColor.ink.opacity(0.92)))
                    .padding(.bottom, 120)
                    .transition(.opacity)
                    .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { if model.toast == t { model.toast = nil } } }
            }
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.payload?.store.id) { _ in
            // 最初と、店を変えたとき：その店で前に選んだフロアから（Web の initialHandyFloor と同じ）
            if let p = model.payload { floor = Self.rememberedFloor(storeId: p.store.id, tabs: floorTabs(p), defaultFloorId: p.defaultFloorId) }
        }
        .sheet(isPresented: $callsOpen) { callsSheet.presentationDetents([.medium, .large]) }
        .sheet(isPresented: $drawerOpen) { drawerSheet.presentationDetents([.large]) }
        .sheet(isPresented: $selectOpen) { selectSheet.presentationDetents([.height(220)]) }
        .sheet(isPresented: $shareOpen) { bookingSheet.presentationDetents([.large]) }
        .overlay {
            if let id = sheetTableId, let p = model.payload, let t = p.tables.first(where: { $0.id == id }) {
                NativeHandyTableSheet(model: model, table: t, tables: p.tables, canLock: p.canLock, canOrder: p.canOrder,
                                      onStart: { sheetTableId = nil; onWeb("/handy/\(t.id)/setup") },
                                      onClose: { sheetTableId = nil })
            }
        }
    }

    // MARK: 上のバー（Web の HandyTopBar）

    private func topBar(_ p: NHDPayload?) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                HStack(spacing: 2) {
                    Button { drawerOpen = true } label: {
                        Image(systemName: "line.3.horizontal").font(.system(size: 22, weight: .bold)).foregroundColor(.white)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    // 店長・オーナー：ホームへ戻る
                    if let onHome {
                        Button(action: onHome) {
                            HStack(spacing: 2) {
                                Image(systemName: "chevron.left").font(.system(size: 11, weight: .bold))
                                Text("ホーム").font(.system(size: 12, weight: .bold))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 9).frame(height: 30)
                            .background(Capsule().fill(Color.white.opacity(0.14)))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(width: 110, alignment: .leading)
                .padding(.leading, 7)
                VStack(spacing: 0) {
                    Text(p?.store.name ?? " ").font(.system(size: 10)).foregroundColor(Color.white.opacity(0.72)).lineLimit(1).frame(height: 26)
                    Text("テーブル一覧").font(.system(size: 15, weight: .bold)).foregroundColor(.white).lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                Button { Task { await model.refresh() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 20, weight: .bold)).foregroundColor(.white)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .frame(width: 110, alignment: .trailing)
                .padding(.trailing, 7)
            }
            .frame(minHeight: 53)
            .padding(.bottom, 2)
            Rectangle().fill(NHDColor.headerLine).frame(height: 1)
        }
        .background(NHDColor.header.ignoresSafeArea(edges: .top))
    }

    // MARK: フロアのタブと卓の一覧（Web の HandyTableList）

    private func floorTabs(_ p: NHDPayload) -> [NHDTab] {
        let real = p.floors.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
        let hasUnassigned = p.tables.contains { $0.floorId == nil }
        if real.count + (hasUnassigned ? 1 : 0) < 2 { return [] }
        var tabs: [NHDTab] = [NHDTab(id: "all", label: "ALL")]
        tabs += real.map { NHDTab(id: $0.id, label: $0.name) }
        if hasUnassigned { tabs.append(NHDTab(id: "_none", label: "未分類")) }
        return tabs
    }

    private static func floorKey(_ storeId: String) -> String { "tenpo-handy-floor:\(storeId)" }

    /// 開いたときのフロア：この端末で前に選んだ → 店舗の「レジで最初に出すフロア」→ ALL（Web の initialHandyFloor と同じ）
    private static func rememberedFloor(storeId: String, tabs: [NHDTab], defaultFloorId: String?) -> String {
        let ids = tabs.map { $0.id }
        if let saved = UserDefaults.standard.string(forKey: floorKey(storeId)), ids.contains(saved) { return saved }
        if let d = defaultFloorId, ids.contains(d) { return d }
        return "all"
    }

    private func pickFloor(_ id: String, storeId: String) {
        floor = id
        UserDefaults.standard.set(id, forKey: Self.floorKey(storeId))
    }

    private func shownTables(_ p: NHDPayload, tabs: [NHDTab]) -> [NHDTable] {
        if tabs.isEmpty || floor == "all" { return p.tables }
        if floor == "_none" { return p.tables.filter { $0.floorId == nil } }
        return p.tables.filter { $0.floorId == floor }
    }

    /// 呼び出し中の卓（会計希望が優先。Web の callToneByTable と同じ）
    private func callKinds(_ p: NHDPayload) -> [String: String] {
        var m: [String: String] = [:]
        for c in p.calls where c.kind == "checkout" || m[c.tableId] == nil { m[c.tableId] = c.kind }
        return m
    }

    private func tableList(_ p: NHDPayload) -> some View {
        let tabs = floorTabs(p)
        let shown = shownTables(p, tabs: tabs)
        let kinds = callKinds(p)
        // iPad のネイティブと同じ卓の箱が読めたら 2 列（2026-10-25 02:22 Ronnie「iPhone の卓も iPad のように」）。読めなければ今までの 3 列
        let cards = !model.floorTables.isEmpty
        let columns = cards
            ? [GridItem(.flexible(), spacing: 10, alignment: .top), GridItem(.flexible(), spacing: 10, alignment: .top)]
            : [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return ScrollView {
            VStack(spacing: 0) {
                if !tabs.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(tabs) { t in
                                Button { pickFloor(t.id, storeId: p.store.id) } label: {
                                    Text(t.label).font(.system(size: 14, weight: .bold))
                                        .foregroundColor(t.id == floor ? .white : NHDColor.inkMid)
                                        .padding(.horizontal, 16).frame(minHeight: 38)
                                        .background(Capsule().fill(t.id == floor ? NHDColor.accent : Color.white))
                                        .overlay(Capsule().stroke(t.id == floor ? Color.clear : NHDColor.line, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 8).padding(.vertical, 6)
                    }
                }
                if p.tables.isEmpty {
                    Text("テーブルが登録されていません。\n設定画面からフロア・テーブルを登録してください。")
                        .font(.system(size: 13)).foregroundColor(NHDColor.ink3).multilineTextAlignment(.center).lineSpacing(5)
                        .padding(.horizontal, 24).padding(.vertical, 36)
                } else if shown.isEmpty {
                    Text("このフロアにテーブルがありません。")
                        .font(.system(size: 13)).foregroundColor(NHDColor.ink3)
                        .padding(.horizontal, 24).padding(.vertical, 36)
                }
                LazyVGrid(columns: columns, spacing: cards ? 12 : 8) {
                    ForEach(shown) { t in
                        let state = NHDState.of(t)
                        let tap = {
                            if state.usesSheet && p.canLock {
                                sheetTableId = t.id
                            } else if state.usesSheet && state.canStartOrder {
                                onWeb("/handy/\(t.id)/setup")
                            } else {
                                // まとめた卓で伝票がほかの卓にあるときは、その伝票の卓を開く（2つ目の伝票を立てない）
                                onWeb("/handy/\(t.orderTableId ?? t.id)")
                            }
                        }
                        if cards, let ft = model.floorTables[t.id] {
                            // iPad のネイティブと同じ箱（3D・下の色の帯・残り時間・最終注文から・呼び出し）。押したときの動きはハンディのまま
                            // 箱は小さめに：空いている卓は低く（番号と「4名席 空」だけ）、お客様のいる卓は時間・金額が入る高さ
                            // （2026-10-25 21:24 Ronnie「Handy ko button dherai big」。前は全部 240pt）
                            NativeTableCard(table: ft, now: model.now.timeIntervalSince1970 * 1000, height: Self.phoneCardHeight(ft)) { _ in tap() }
                        } else {
                            Button(action: tap) {
                                NativeHandyTile(table: t, state: state, now: model.now, callKind: kinds[t.id],
                                                groupLabel: Self.groupLabel(t, p.tables),
                                                mainTableName: t.orderTableId.flatMap { id in p.tables.first { $0.id == id }?.name })
                            }
                            .buttonStyle(PressableStyle(scale: 0.96))
                        }
                    }
                }
                .padding(.horizontal, cards ? 12 : 8).padding(.top, cards ? 14 : 6).padding(.bottom, 10)
            }
        }
        .refreshable { await model.refresh() }
    }

    /// iPhone の卓の箱の高さ：空いた卓 118pt、お客様のいる卓 196pt（呼び出し・連携の行があればその分だけ高く）
    static func phoneCardHeight(_ t: NFTable) -> CGFloat {
        guard t.order != nil else { return 118 }
        return 196 + (t.calls.isEmpty ? 0 : 20) + (t.linkedNames == nil ? 0 : 20)
    }

    /// まとめた卓の名前（T-1+T-2）。組んでいなければ空（Web の groupTableLabel と同じ）
    private static func groupLabel(_ t: NHDTable, _ all: [NHDTable]) -> String {
        let ids = t.groupTableIds ?? []
        guard ids.count > 1 else { return "" }
        return all.filter { ids.contains($0.id) }.map { $0.name }.joined(separator: "+")
    }

    // MARK: 下（呼び出しの帯・黒いバー）

    private func bottomBar(_ p: NHDPayload) -> some View {
        VStack(spacing: 0) {
            if !p.calls.isEmpty {
                Button { callsOpen = true } label: {
                    HStack(spacing: 6) {
                        HStack(spacing: 4) {
                            Text("呼び出し").font(.system(size: 12))
                            Text("\(p.calls.count)件").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(RoundedRectangle(cornerRadius: 9).fill(NHDColor.callBadge))
                        }
                        Text(Self.callSummary(p.calls)).font(.system(size: 15, weight: .bold)).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("未対応 · タップして確認 ›").font(.system(size: 9)).lineLimit(2).frame(width: 75, alignment: .trailing)
                    }
                    .foregroundColor(NHDColor.callInk)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(minHeight: 54)
                    .background(NHDColor.callBg)
                    .overlay(alignment: .top) { Rectangle().fill(NHDColor.callLine).frame(height: 2) }
                }
                .buttonStyle(.plain)
            }
            VStack(spacing: 0) {
                Rectangle().fill(NHDColor.headerLine).frame(height: 1)
                Button { selectOpen = true } label: {
                    Text("SELECT ▴").font(.system(size: 8, weight: .bold)).tracking(1.4).foregroundColor(NHDColor.navLabel)
                        .padding(.horizontal, 18).frame(minHeight: 22)
                }
                .buttonStyle(.plain)
                HStack(spacing: 7) {
                    navButton("HANDY", icon: "cart", on: true) {}
                    navButton("RESERVATION", icon: "book.closed", on: false) { onWeb("/handy/reservations") }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
            }
            .background(NHDColor.header.ignoresSafeArea(edges: .bottom))
        }
    }

    private static func callSummary(_ calls: [NHDCall]) -> String {
        var seen: [String] = []
        for c in calls.sorted(by: { $0.createdAtMs < $1.createdAtMs }) {
            let s = (c.tableName ?? "—") + (c.kind == "checkout" ? " 会計希望" : "")
            if !seen.contains(s) { seen.append(s) }
        }
        return seen.joined(separator: "・")
    }

    private func navButton(_ title: String, icon: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 19, weight: .semibold))
                Text(title).font(.system(size: 11, weight: .heavy)).tracking(0.5)
            }
            .foregroundColor(on ? .white : NHDColor.navMuted)
            .frame(maxWidth: .infinity).frame(minHeight: 46)
            .background(RoundedRectangle(cornerRadius: 9).fill(on ? NHDColor.accent : Color.clear))
        }
        .buttonStyle(.plain)
    }

    // MARK: シート：SELECT

    private var selectSheet: some View {
        NativeHandySheet(title: "SELECT", onClose: { selectOpen = false }) {
            sheetLink("HANDY · 注文", icon: "cart") { selectOpen = false }
            sheetLink("RESERVATION · 今日の予約", icon: "book.closed") { selectOpen = false; onWeb("/handy/reservations") }
        }
    }

    // MARK: シート：≡（Web の HandyChrome のドロワー）

    private var drawerSheet: some View {
        let p = model.payload
        return NativeHandySheet(title: "TENPO ONE", onClose: { drawerOpen = false }) {
            Text("\(p?.store.name ?? "") ／ \(p?.clerk?.name ?? p?.accountName ?? "")")
                .font(.system(size: 11)).foregroundColor(NHDColor.ink3).lineSpacing(3)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 12)
            if let p, p.stores.count > 1 || p.isHq {
                HStack {
                    Text("店舗").font(.system(size: 14, weight: .bold)).foregroundColor(NHDColor.inkMid)
                    Spacer()
                    Menu {
                        ForEach(p.stores) { s in
                            Button { Task { if await model.act(["type": "switchStore", "storeId": s.id]) { drawerOpen = false } } } label: {
                                if s.id == p.currentStoreId { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "storefront").font(.system(size: 13))
                            Text(p.store.name).font(.system(size: 13, weight: .bold)).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundColor(NHDColor.inkMid)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(RoundedRectangle(cornerRadius: 10).fill(NHDColor.weakBtn))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NHDColor.line, lineWidth: 1))
                    }
                }
                .padding(.vertical, 8)
                Rectangle().fill(NHDColor.divider).frame(height: 1)
            }
            if let p, let clerk = p.clerk {
                sheetLink("担当者を変更（\(clerk.name)）", icon: "person.crop.circle.badge.xmark") {
                    Task { if await model.act(["type": "handyLogout"]) { drawerOpen = false } }
                }
            }
            // ハンディはハンディだけ。本体（/app）へは行けない（2026-09-30 Ronnie）
            sheetLink("今日の予約", icon: "book.closed") { drawerOpen = false; onWeb("/handy/reservations") }
            if p?.bookingUrl != nil {
                sheetLink("ご予約リンクを紹介", icon: "calendar.badge.plus", trailing: "Share") { drawerOpen = false; shareOpen = true }
            }
            sheetLink("お客様の呼び出し", icon: "person", trailing: "\(p?.calls.count ?? 0)件") { drawerOpen = false; callsOpen = true }
            if let onHome {
                // 店長・オーナーがハンディを開いたとき：ホームへ戻る
                sheetLink("オーナー・店長のホームへ", icon: "house") { drawerOpen = false; onHome() }
            } else {
                // iPhone アプリの中だけ：ハンディ／オーナーの切り替え
                sheetLink("店長・オーナーとしてログイン（ID・パスワード）", icon: "person.badge.key") { drawerOpen = false; onChangeMode() }
            }
            sheetLink("ログアウト", icon: "rectangle.portrait.and.arrow.right", color: Color(hex: 0xC62828)) {
                Task { if await model.act(["type": "signOut"]) { drawerOpen = false; onSignedOut() } }
            }
        }
    }

    private func sheetLink(_ title: String, icon: String, trailing: String? = nil, color: Color = NHDColor.accent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold)).frame(width: 20)
                Text(title).font(.system(size: 14)).lineLimit(1)
                if let trailing { Text(trailing).font(.system(size: 10, weight: .semibold)).foregroundColor(NHDColor.ink3) }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(Color(hex: 0xB9C6E4))
            }
            .foregroundColor(color)
            .frame(minHeight: 49)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Rectangle().fill(NHDColor.divider).frame(height: 1) }
    }

    // MARK: シート：お客様の呼び出し

    private var callsSheet: some View {
        let calls = (model.payload?.calls ?? []).sorted { $0.createdAtMs < $1.createdAtMs }
        return NativeHandySheet(title: "お客様の呼び出し", onClose: { callsOpen = false }) {
            if calls.isEmpty {
                Text("未対応の呼び出しはありません").font(.system(size: 13)).foregroundColor(NHDColor.ink3)
                    .frame(maxWidth: .infinity).padding(.vertical, 28)
            }
            ForEach(calls) { c in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(c.tableName ?? "—").font(.system(size: 16, weight: .bold)).foregroundColor(NHDColor.ink)
                            Text(c.kind == "checkout" ? "会計希望" : "スタッフ呼び出し").font(.system(size: 11, weight: .bold))
                                .foregroundColor(c.kind == "checkout" ? NHDColor.gold : NHDColor.accent)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Capsule().fill(c.kind == "checkout" ? NHDColor.goldSoft : NHDColor.accentSoft))
                        }
                        Text("\(nhdTime(c.createdAtMs)) · \(nhdElapsed(fromMs: c.createdAtMs, now: model.now))前" + (c.note.map { "・\($0)" } ?? ""))
                            .font(.system(size: 11)).foregroundColor(NHDColor.ink3).lineLimit(2)
                    }
                    Spacer()
                    Button {
                        Task { await model.act(["type": "handyCallDone", "callId": c.id], done: "対応済みにしました") }
                    } label: {
                        Text("対応済み").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 14).frame(height: 38)
                            .background(RoundedRectangle(cornerRadius: 9).fill(NHDColor.accent))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.busy)
                }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(NHDColor.divider).frame(height: 1) }
            }
        }
    }

    // MARK: シート：ご予約リンクを紹介（お店の予約ページの QR）

    private var bookingSheet: some View {
        let url = model.payload?.bookingUrl ?? ""
        return NativeHandySheet(title: "ご予約リンクを紹介", onClose: { shareOpen = false }) {
            VStack(spacing: 14) {
                Text(model.payload?.store.name ?? "").font(.system(size: 15, weight: .bold)).foregroundColor(NHDColor.ink)
                if let img = Self.qrImage(url) {
                    Image(uiImage: img).interpolation(.none).resizable().scaledToFit().frame(maxWidth: 260)
                        .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NHDColor.line, lineWidth: 1))
                }
                Text("お客様にこの QR を読んでもらうと、お店の予約ページが開きます").font(.system(size: 12)).foregroundColor(NHDColor.ink3)
                    .multilineTextAlignment(.center)
                Text(url).font(.system(size: 11)).foregroundColor(NHDColor.ink2).textSelection(.enabled).multilineTextAlignment(.center)
                ShareLink(item: URL(string: url) ?? AppConfig.url("/")) {
                    Label("リンクを送る / Share", systemImage: "square.and.arrow.up")
                        .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 10).fill(NHDColor.accent))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
    }

    private static func qrImage(_ s: String) -> UIImage? {
        guard !s.isEmpty else { return nil }
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// シートの外枠（Web の HandySheet：白い紙・見出し・×）
struct NativeHandySheet<Content: View>: View {
    let title: String
    let onClose: () -> Void
    let content: () -> Content

    init(title: String, onClose: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.onClose = onClose
        self.content = content
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title).font(.system(size: 16, weight: .heavy)).foregroundColor(NHDColor.ink)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(NHDColor.ink2)
                        .frame(width: 36, height: 36).background(Circle().fill(NHDColor.weakBtn2))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 8)
            ScrollView {
                VStack(spacing: 0) { content() }
                    .padding(.horizontal, 18).padding(.bottom, 24)
            }
        }
        .background(Color.white.ignoresSafeArea())
    }
}

/// 卓のタイル（Web の HandyTableTile と同じ色・並び）
struct NativeHandyTile: View {
    let table: NHDTable
    let state: NHDState
    let now: Date
    /// staff / checkout / nil
    let callKind: String?
    let groupLabel: String
    let mainTableName: String?
    @State private var pulse = false

    private var bg: Color {
        if callKind == "checkout" { return NHDColor.goldSoft }
        if callKind == "staff" { return NHDColor.accentSoft }
        switch state {
        case .occupied: return NHDColor.occupied
        case .blocked: return NHDColor.blocked
        default: return .white
        }
    }

    private var line: Color {
        if callKind == "checkout" { return NHDColor.gold }
        if callKind == "staff" { return NHDColor.accent }
        switch state {
        case .occupied: return NHDColor.occupiedLine
        case .blocked: return NHDColor.blockedLine
        default: return NHDColor.line
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                Text(table.name).font(.system(size: 15, weight: .semibold)).foregroundColor(NHDColor.ink2).lineLimit(1)
                Spacer(minLength: 0)
                if let k = callKind {
                    Image(systemName: k == "checkout" ? "wallet.pass.fill" : "bell.fill")
                        .font(.system(size: 9, weight: .bold)).foregroundColor(.white)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(k == "checkout" ? NHDColor.gold : NHDColor.accent))
                }
            }
            if state == .occupied && mainTableName != nil {
                // まとめた卓のうち伝票の無い卓：金額・時間は伝票の卓（MAIN）だけに出し、ここは印だけ
                Spacer(minLength: 0)
                HStack { Spacer(minLength: 0); groupMark; Spacer(minLength: 0) }
                Spacer(minLength: 0)
            } else if state == .occupied {
                HStack(spacing: 0) {
                    Text(table.guestCount > 0 ? "\(table.guestCount)名" : "利用中").font(.system(size: 10)).foregroundColor(.black)
                    if table.orderCount > 1 { Text(" · 伝票\(table.orderCount)").font(.system(size: 10)).foregroundColor(.black) }
                    if !groupLabel.isEmpty { Text(" · \(groupLabel)").font(.system(size: 10, weight: .bold)).foregroundColor(NHDColor.accent) }
                }
                .lineLimit(1)
                .padding(.top, 1)
                Spacer(minLength: 0)
                row("開始", table.openedAtMs.map { nhdTime($0) } ?? "—", size: 13, color: NHDColor.ink2)
                row("経過", table.openedAtMs.map { nhdElapsed(fromMs: $0, now: now) } ?? "—", size: 15, color: NHDColor.accent)
                row("未会計", NT.yen(table.total), size: 11, color: NHDColor.ink2)
            } else {
                Spacer(minLength: 0)
                VStack(spacing: 2) {
                    Text(state == .available ? "\(table.capacityMax)名席" : state.ja).font(.system(size: 9)).foregroundColor(NHDColor.ink3)
                    if !groupLabel.isEmpty { groupMark }
                }
                .frame(maxWidth: .infinity)
                Spacer(minLength: 0)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity)
        .aspectRatio(1, contentMode: .fit)
        .background(RoundedRectangle(cornerRadius: 10).fill(bg))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(line, lineWidth: 1))
        .overlay {
            if !groupLabel.isEmpty { RoundedRectangle(cornerRadius: 10).stroke(NHDColor.accent.opacity(0.3), lineWidth: 2).padding(1) }
        }
        .overlay {
            // 呼び出し中の卓は枠が点滅（2026-09-28 Ronnie「卓の箱に知らせを」）
            if let k = callKind {
                RoundedRectangle(cornerRadius: 10).stroke(k == "checkout" ? NHDColor.gold : NHDColor.accent, lineWidth: 3)
                    .padding(1.5)
                    .opacity(pulse ? 0.25 : 1)
                    .onAppear { withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulse = true } }
            }
        }
    }

    private var groupMark: some View {
        HStack(spacing: 2) {
            Image(systemName: "link").font(.system(size: 8, weight: .bold))
            Text(groupLabel).font(.system(size: 9, weight: .bold)).lineLimit(1)
        }
        .foregroundColor(.white)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(Capsule().fill(NHDColor.accent))
    }

    private func row(_ label: String, _ value: String, size: CGFloat, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).font(.system(size: 9)).foregroundColor(NHDColor.ink3)
            Spacer(minLength: 0)
            Text(value).font(.system(size: size, weight: .bold)).foregroundColor(color).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

/// 空いている卓のポップアップ（Web の HandyTableSheet）：注文を開始・テーブルをまとめる・ロック
struct NativeHandyTableSheet: View {
    @ObservedObject var model: NativeHandyModel
    let table: NHDTable
    let tables: [NHDTable]
    let canLock: Bool
    let canOrder: Bool
    let onStart: () -> Void
    let onClose: () -> Void
    /// まとめる卓を選んでいる間だけ（nil＝選ぶ画面を閉じている）
    @State private var pick: [String]?

    private var state: NHDState { NHDState.of(table) }
    private var groupIds: [String] { table.groupTableIds ?? [] }
    private var grouped: Bool { groupIds.count > 1 }
    private var groupSeats: Int { tables.filter { groupIds.contains($0.id) }.reduce(0) { $0 + $1.capacityMax } }
    private func label(_ ids: [String]) -> String { tables.filter { ids.contains($0.id) }.map { $0.name }.joined(separator: "+") }

    var body: some View {
        ZStack {
            NHDColor.ink.opacity(0.53).ignoresSafeArea().onTapGesture { onClose() }
            VStack(spacing: 0) {
                Text(table.name).font(.system(size: 15, weight: .bold)).foregroundColor(NHDColor.ink)
                // 英語を上・日本語を下に小さく（2026-10-18 Ronnie）
                VStack(spacing: 1) {
                    Text("\(table.capacityMax) seats · \(state.en)").font(.system(size: 11))
                    Text("\(table.capacityMax)名席 · \(state.ja)").font(.system(size: 9))
                }
                .foregroundColor(NHDColor.ink3).padding(.top, 2)
                if grouped {
                    VStack(spacing: 1) {
                        HStack(spacing: 4) {
                            Image(systemName: "link").font(.system(size: 11, weight: .bold))
                            Text(label(groupIds)).font(.system(size: 13, weight: .bold)).lineLimit(1)
                        }
                        Text("Merged · \(groupSeats) seats").font(.system(size: 10))
                        Text("まとめた卓 · \(groupSeats)名席").font(.system(size: 9))
                    }
                    .foregroundColor(NHDColor.accent)
                    .frame(maxWidth: .infinity).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 8).fill(NHDColor.accentSoft))
                    .padding(.top, 8)
                }

                if let picking = pick {
                    VStack(spacing: 0) {
                        Text("SELECT TABLES").font(.system(size: 12, weight: .bold)).foregroundColor(NHDColor.inkMid)
                        Text("まとめる卓を選ぶ").font(.system(size: 9, weight: .medium)).foregroundColor(NHDColor.ink3)
                    }
                    .padding(.top, 12)
                    // 選べる卓はレジと同じく同じフロアの卓
                    let candidates = tables.filter { $0.floorId == table.floorId }
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)], spacing: 4) {
                            ForEach(candidates) { t in
                                let on = picking.contains(t.id)
                                Button {
                                    pick = on ? picking.filter { $0 != t.id } : picking + [t.id]
                                } label: {
                                    Text(t.name).font(.system(size: 13, weight: .bold)).lineLimit(1)
                                        .foregroundColor(on ? .white : NHDColor.inkMid)
                                        .frame(maxWidth: .infinity).frame(minHeight: 40)
                                        .background(RoundedRectangle(cornerRadius: 8).fill(on ? NHDColor.accent : Color.white))
                                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.clear : NHDColor.line, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                                .disabled(t.id == table.id || model.busy)
                            }
                        }
                    }
                    .frame(maxHeight: 220)
                    .padding(.top, 8)
                    VStack(spacing: 6) {
                        bigButton(en: "MERGE", ja: "まとめる", filled: true, disabled: model.busy || picking.count < 2) {
                            Task { if await model.act(["type": "handyGroup", "tableIds": picking], done: "\(label(picking)) をまとめました") { pick = nil } }
                        }
                        if grouped {
                            // 1卓だけ渡す＝その卓が入っているグループをまるごと解除（レジの「解除」と同じ）
                            bigButton(en: "UNMERGE", ja: "まとめを解除", filled: false, disabled: model.busy) {
                                Task { if await model.act(["type": "handyGroup", "tableIds": [table.id]], done: "まとめを解除しました") { pick = nil } }
                            }
                        }
                        smallButton(en: "BACK", ja: "戻る") { pick = nil }
                    }
                    .padding(.top, 10)
                } else {
                    VStack(spacing: 6) {
                        if state.canStartOrder && canOrder {
                            bigButton(en: "START ORDER", ja: "注文を開始", filled: true, disabled: model.busy, action: onStart)
                        }
                        if canLock && state.canStartOrder {
                            bigButton(en: grouped ? "EDIT MERGE" : "MERGE TABLES", ja: grouped ? "まとめを変更" : "テーブルをまとめる", filled: false, disabled: model.busy) {
                                pick = grouped ? groupIds : [table.id]
                            }
                        }
                        if canLock {
                            let locked = state == .blocked
                            bigButton(en: locked ? "UNLOCK TABLE" : "LOCK TABLE", ja: locked ? "ロック解除" : "テーブルをロック", filled: false, disabled: model.busy) {
                                // 「ロックしました」のお知らせは出さない（卓が「使用不可」になるので分かる。2026-10-19 Ronnie）
                                Task { if await model.act(["type": "handyLock", "tableId": table.id, "unavailable": !locked]) { onClose() } }
                            }
                        }
                        smallButton(en: "CLOSE", ja: "閉じる", action: onClose)
                    }
                    .padding(.top, 12)
                }
            }
            .padding(14)
            .frame(width: 250)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .shadow(color: .black.opacity(0.33), radius: 45, y: 20)
        }
    }

    private func bigButton(en: String, ja: String, filled: Bool, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(en).font(.system(size: 15, weight: .bold))
                Text(ja).font(.system(size: 10, weight: .medium)).opacity(0.75)
            }
            .foregroundColor(filled ? .white : NHDColor.inkMid)
            .frame(maxWidth: .infinity).frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 8).fill(filled ? NHDColor.accent : NHDColor.weakBtn))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(filled ? Color.clear : NHDColor.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    private func smallButton(en: String, ja: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(en).font(.system(size: 13, weight: .bold))
                Text(ja).font(.system(size: 10, weight: .medium)).opacity(0.75)
            }
            .foregroundColor(NHDColor.ink2)
            .frame(maxWidth: .infinity).frame(minHeight: 42)
            .background(RoundedRectangle(cornerRadius: 8).fill(NHDColor.weakBtn2))
        }
        .buttonStyle(.plain)
    }
}

/// 担当者を選ぶログイン画面（Web の HandyLoginScreen：黒い地・TENPO ONE・日付・店舗名・担当者・Login）
struct NativeHandyLoginView: View {
    @ObservedObject var model: NativeHandyModel
    let payload: NHDPayload
    /// 店長・オーナーがハンディを開いたとき：ホームへ戻る（スタッフのハンディは nil）
    var onHome: (() -> Void)? = nil
    @State private var clerkId: String = ""
    @State private var infoOpen = false

    var body: some View {
        ZStack {
            NHDColor.header.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    // Web と同じ「ON」のトグル風の印
                    ZStack(alignment: .trailing) {
                        Capsule().fill(NHDColor.accent).frame(width: 44, height: 25)
                        Circle().fill(Color.white).frame(width: 21, height: 21).padding(.trailing, 2)
                    }
                    Button { infoOpen = true } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "bolt.fill").font(.system(size: 11))
                            Text("POS設定").font(.system(size: 11))
                        }
                        .foregroundColor(NHDColor.line)
                        .padding(.horizontal, 10).frame(minHeight: 35)
                        .background(RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.09)))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.15), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    if let onHome {
                        Button(action: onHome) {
                            HStack(spacing: 3) {
                                Image(systemName: "chevron.left").font(.system(size: 11, weight: .bold))
                                Text("ホーム").font(.system(size: 12, weight: .bold))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 12).frame(minHeight: 35)
                            .background(Capsule().fill(Color.white.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 16)

                VStack(spacing: 0) {
                    HStack(spacing: 9) {
                        Image("BrandMark").resizable().scaledToFit().frame(width: 45, height: 48)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        Text("TENPO").font(.system(size: 30, weight: .heavy)).foregroundColor(Color(hex: 0x8FB4FF))
                        Text("ONE").font(.system(size: 30, weight: .heavy)).foregroundColor(.white)
                    }
                    Text("HANDY · TENPO ONE").font(.system(size: 11, weight: .semibold)).tracking(1.2).foregroundColor(.white).padding(.top, 28)
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").font(.system(size: 14)).foregroundColor(Color(hex: 0xC9D6F5))
                        Text(payload.today).font(.system(size: 16)).foregroundColor(.white)
                    }
                    .padding(.top, 22)
                }
                .padding(.top, 48)

                Spacer()
                VStack(spacing: 13) {
                    HStack(spacing: 13) {
                        Text("店舗名").font(.system(size: 13)).foregroundColor(.white).frame(width: 60, alignment: .leading)
                        Text(payload.store.name).font(.system(size: 16)).foregroundColor(NHDColor.ink).lineLimit(1)
                            .padding(.horizontal, 8).frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(NHDColor.line, lineWidth: 1))
                    }
                    HStack(spacing: 13) {
                        Text("担当者").font(.system(size: 13)).foregroundColor(.white).frame(width: 60, alignment: .leading)
                        Menu {
                            ForEach(payload.clerks) { c in
                                Button(c.name) { clerkId = c.id }
                            }
                        } label: {
                            HStack {
                                Text(payload.clerks.first { $0.id == clerkId }?.name
                                     ?? (payload.clerks.isEmpty ? "担当者が登録されていません" : "担当者を選んでください"))
                                    .font(.system(size: 16)).foregroundColor(clerkId.isEmpty ? NHDColor.ink3 : NHDColor.ink).lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NHDColor.ink3)
                            }
                            .padding(.horizontal, 8).frame(maxWidth: .infinity, minHeight: 40)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(NHDColor.line, lineWidth: 1))
                        }
                        .disabled(payload.clerks.isEmpty)
                    }
                }
                .padding(.vertical, 36)
                Spacer()

                Button {
                    Task { await model.act(["type": "handyLogin", "clerkId": clerkId]) }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.turn.down.right").font(.system(size: 18, weight: .semibold))
                        Text(model.busy ? "ログイン中…" : "Login").font(.system(size: 19, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 9).fill(NHDColor.accent))
                }
                .buttonStyle(.plain)
                .disabled(model.busy || clerkId.isEmpty)
                .opacity(model.busy || clerkId.isEmpty ? 0.45 : 1)
                if let t = model.toast {
                    Text(t).font(.system(size: 12)).foregroundColor(Color(hex: 0xFFB4B4)).multilineTextAlignment(.center).padding(.top, 10)
                }
                Text(payload.clerks.isEmpty
                     ? "担当者が登録されていません。レジの 設定 → POS担当者 で登録してからログインしてください。"
                     : "担当者を選ばないと Login できません。ハンディで作った伝票の担当者になります。")
                    .font(.system(size: 9)).foregroundColor(Color(hex: 0xC9D6F5)).multilineTextAlignment(.center).lineSpacing(3)
                    .padding(.top, 10)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 28)
        }
        .sheet(isPresented: $infoOpen) {
            NativeHandySheet(title: "POS設定", onClose: { infoOpen = false }) {
                infoRow("接続", "接続済み", color: Color(hex: 0x1E6B4D))
                infoRow("店舗", payload.store.name, color: NHDColor.inkMid)
                infoRow("端末", payload.accountName, color: NHDColor.inkMid)
                Text("別の店舗につなぎ直すときは、レジ（管理画面）の 設定 → ハンディ端末 でこの端末を解除し、もう一度お店の QR を読んでください。")
                    .font(.system(size: 11)).foregroundColor(NHDColor.ink3).lineSpacing(4).padding(.top, 12)
            }
            .presentationDetents([.medium])
        }
    }

    private func infoRow(_ k: String, _ v: String, color: Color) -> some View {
        HStack {
            Text(k).font(.system(size: 14)).foregroundColor(NHDColor.ink3)
            Spacer()
            Text(v).font(.system(size: 14, weight: .bold)).foregroundColor(color).lineLimit(1)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NHDColor.divider).frame(height: 1) }
    }
}
