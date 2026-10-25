import SwiftUI
import WebKit
import AudioToolbox

// ディスプレイ端末（キッチンディスプレイ・呼び出しモニター）を TENPO ONE の iPad アプリでネイティブに出す
// （2026-10-25 Ronnie「101% native」。Web の /display・/display-pair は開かない）。
//
//   つなぎ方：レジのログイン画面の「この iPad をディスプレイにする」→ カメラで QR（設定 › ディスプレイ端末 で出したもの）
//             → POST /api/app/v1/display { type: 'pair' }（中身は Web の /display-pair と同じ。5分・1回・同じ回線・運営の ON）
//   画面：GET /api/app/v1/display（Web の /display と同じ判定。lib/display-ops-server.ts）を数秒ごとに読む
//         案内（回線の外・機能 OFF・解除済み…）／キッチン（品目を押して次の段階へ）／呼び出し（調理中・できあがり）
//   ログアウトしない：セッションが切れたらサーバーが端末の鍵でつなぎ直す。解除は店の設定か、この画面の「レジに戻す」だけ
//   AppState からは 1 行ずつ呼ぶだけ（redirect・maybeOpenNativePos・handleScanned・startURL・印刷係）

// MARK: - サーバーの返事（GET /api/app/v1/display。lib/display-ops-server.ts の DisplayAppPayload）

struct NDSNotice: Decodable, Hashable {
    /// network・off・revoked・loading・unpaired
    let icon: String
    let title: String
    let body: String?
    let footer: String?
}

struct NDSDevice: Decodable, Hashable {
    let id: String
    let name: String
    /// kitchen・call
    let kind: String
    let kindLabel: String
    let stations: [String]
    let stationsLabel: String
}

struct NDSKitchen: Decodable {
    let groups: [NKGroup]
    let unservedCount: Int
    let avgElapsedMinutes: Int
    let kdsSettings: NKSettings
    /// 上のタブ（"all" ＋ 端末の持ち場。持ち場を決めていなければ全部）
    let stationOptions: [String]
}

struct NDSCallEntry: Decodable, Identifiable, Hashable {
    let orderId: String
    let orderNo: Int
    let tableName: String?
    /// 調理中: いちばん古い品目の時刻 / できあがり: できあがった時刻
    let since: String
    var id: String { orderId }
}

struct NDSCall: Decodable {
    let cooking: [NDSCallEntry]
    let ready: [NDSCallEntry]
}

struct NDSPayload: Decodable {
    let ok: Bool
    /// notice・board
    let screen: String
    let notice: NDSNotice?
    /// 次に読み直すまでの秒数
    let refreshSec: Int
    /// 数分ごとの見守り（POST heartbeat）を送るか
    let heartbeat: Bool
    /// サーバーの時刻（ミリ秒）
    let now: Double
    let store: NFNamed?
    let device: NDSDevice?
    let kitchen: NDSKitchen?
    let call: NDSCall?
}

// MARK: - 通信

enum NativeDisplayAPI {
    static let path = "/api/app/v1/display"
    static let deviceCookie = "tenpo_display_device"

    @MainActor static func load() async throws -> NDSPayload {
        let data = try await NativeAPI.shared.send(URLRequest(url: AppConfig.url(path)), kickPrint: false)
        return try JSONDecoder().decode(NDSPayload.self, from: data)
    }

    /// POST（{ type: … }）。返事の JSON（ok・error ほか）
    @MainActor static func post(_ body: [String: Any]) async throws -> [String: Any] {
        var req = URLRequest(url: AppConfig.url(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await NativeAPI.shared.send(req, kickPrint: false)
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    /// 端末の鍵（つなぎ直し用の Cookie）をこの iPad から消す（レジに戻すとき）
    @MainActor static func forgetDeviceCookie() async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let all: [HTTPCookie] = await withCheckedContinuation { cont in store.getAllCookies { cont.resume(returning: $0) } }
        for c in all where c.name == deviceCookie {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in store.delete(c) { cont.resume() } }
        }
    }

    static func message(_ error: Error) -> String { (error as? NativeAPIError)?.message ?? "通信できませんでした" }
}

// MARK: - この iPad がディスプレイか（AppState から 1 行ずつ呼ぶ）

final class NativeDisplayStore: ObservableObject {
    static let shared = NativeDisplayStore()
    private static let activeKey = "tenpo.display.active"
    /// この iPad をディスプレイとして使っているか（起動したときの最初の画面・印刷係を決める）
    static var storedActive: Bool { UserDefaults.standard.bool(forKey: activeKey) }

    @Published private(set) var active: Bool
    /// QR を読む画面を出しているか
    @Published var pairing = false
    /// 読んだ QR の値（登録の確認を出す）
    @Published var pendingCode: String?
    @Published var pairMessage: String?
    @Published var pairBusy = false
    /// カメラを作り直す（エラーのあと、もう一度読めるように）
    @Published var scanEpoch = 0
    @Published var leaving = false

    private init() {
        active = Self.storedActive && NativePreview.current == nil
    }

    /// ディスプレイの QR の値（https://…/display-pair#<48桁の16進>）
    static func pairCode(from url: URL) -> String? {
        guard AppConfig.isOwnHost(url), url.path == "/display-pair" || url.path == "/display-pair/" else { return nil }
        guard let f = url.fragment, f.count == 48, f.allSatisfy({ $0.isHexDigit }) else { return nil }
        return f.lowercased()
    }

    /// Web の画面がディスプレイの道（/display・/display-pair）へ行こうとしたら、Web は開かずにネイティブで出す
    /// （AppState.redirect(for:) から）。差し替える行き先（about:blank）。ほかの道は nil
    func redirect(for url: URL) -> URL? {
        guard AppConfig.isOwnHost(url) else { return nil }
        if let code = Self.pairCode(from: url) {
            DispatchQueue.main.async { self.beginPairing(code: code) }
            return URL(string: "about:blank")
        }
        if url.path == "/display" || url.path == "/display/" {
            DispatchQueue.main.async { self.activate(stopWeb: false) }
            return URL(string: "about:blank")
        }
        return nil
    }

    /// 画面の切り替え（pushState）・読み込みのあとでディスプレイの道に来たとき（AppState.maybeOpenNativePos から）。true なら AppState はそこで終わり
    func handleRoute(_ url: URL) -> Bool {
        guard let blank = redirect(for: url) else { return false }
        DispatchQueue.main.async { WebViewController.current?.load(blank) }
        return true
    }

    /// ほかのカメラ（ハンディの QR など）で読んだのがディスプレイの QR だったとき（AppState.handleScanned から）
    func handleScanned(_ url: URL) -> Bool {
        guard let code = Self.pairCode(from: url) else { return false }
        DispatchQueue.main.async { self.beginPairing(code: code) }
        return true
    }

    /// レジのログイン画面の「この iPad をディスプレイにする」：QR を読む画面
    func startPairing() {
        pendingCode = nil
        pairMessage = nil
        scanEpoch += 1
        pairing = true
    }

    func beginPairing(code: String) {
        pairMessage = nil
        pendingCode = code
        pairing = true
    }

    func cancelPairing() {
        pairing = false
        pendingCode = nil
        pairMessage = nil
    }

    /// このカメラで読んだ文字。ディスプレイの QR なら true（カメラを止める）
    func scanned(_ text: String) -> Bool {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), let code = Self.pairCode(from: url) else {
            DispatchQueue.main.async {
                self.pairMessage = "ディスプレイ端末の QR ではありません。レジの「設定 → デバイス管理 → ディスプレイ端末」で出した QR を読んでください"
            }
            return false
        }
        DispatchQueue.main.async {
            self.pairMessage = nil
            self.pendingCode = code
        }
        return true
    }

    /// 「登録する」：この iPad をディスプレイとして登録する（ログイン状態は Cookie で返ってくる）
    @MainActor func confirmPair() async {
        guard let code = pendingCode, !pairBusy else { return }
        pairBusy = true
        defer { pairBusy = false }
        do {
            let r = try await NativeDisplayAPI.post(["type": "pair", "code": code])
            if r["ok"] as? Bool == true {
                pairing = false
                pendingCode = nil
                activate(stopWeb: true)
                return
            }
            pairMessage = (r["error"] as? String) ?? "登録できませんでした。もう一度 QR を読んでください"
        } catch {
            pairMessage = NativeDisplayAPI.message(error)
        }
        pendingCode = nil
        scanEpoch += 1
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    /// ディスプレイの画面にする（レジの Web・印刷係は止める。ディスプレイのアカウントではレジの API は使えない）
    func activate(stopWeb: Bool) {
        UserDefaults.standard.set(true, forKey: Self.activeKey)
        let wasActive = active
        active = true
        Task { @MainActor in AppState.shared.syncPrintAgent() }
        if stopWeb || !wasActive { WebViewController.current?.load(URL(string: "about:blank")!) }
    }

    /// 「この iPad をレジに戻す」：この端末をディスプレイからはずし（解除・ログアウト）、レジのログインへ
    @MainActor func leave() async {
        guard !leaving else { return }
        leaving = true
        defer { leaving = false }
        _ = try? await NativeDisplayAPI.post(["type": "leave"])
        await NativeDisplayAPI.forgetDeviceCookie()
        UserDefaults.standard.set(false, forKey: Self.activeKey)
        active = false
        pairing = false
        AppState.shared.syncPrintAgent()
        AppState.shared.needsRegiLogin = true
        WebViewController.current?.load(AppConfig.url("/register-login"))
    }
}

// MARK: - 読み込み（数秒ごと）

@MainActor
final class NativeDisplayModel: ObservableObject {
    @Published var payload: NDSPayload?
    /// 通信できないとき（前の画面のまま待つ）
    @Published var offline: String?
    @Published var busy = false
    @Published var now = Date()
    @Published var toast: String?
    private var offset: TimeInterval = 0
    private var seenReady: Set<String>?
    private var seenPending: Set<String>?
    private var lastBeat: Date?
    private var loop: Task<Void, Never>?
    private let isPreview: Bool

    init(preview: NDSPayload? = nil) {
        isPreview = preview != nil
        if let preview {
            payload = preview
            offset = preview.now / 1000 - Date().timeIntervalSince1970
            now = Date().addingTimeInterval(offset)
        }
    }

    func start() {
        guard !isPreview, loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let wait = await self.load()
                try? await Task.sleep(nanoseconds: UInt64(min(120, max(1, wait))) * 1_000_000_000)
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    /// 読み直す。次に読み直すまでの秒数を返す
    @discardableResult
    func load() async -> Int {
        guard !isPreview else { return 60 }
        do {
            let p = try await NativeDisplayAPI.load()
            offset = p.now / 1000 - Date().timeIntervalSince1970
            now = Date().addingTimeInterval(offset)
            chime(p)
            payload = p
            offline = nil
            if p.heartbeat { await beatIfDue() }
            return p.refreshSec
        } catch {
            offline = NativeDisplayAPI.message(error)
            return 10
        }
    }

    func tick() { now = Date().addingTimeInterval(offset) }

    /// キッチンの操作（advance・served）。終わったら読み直す
    func act(_ body: [String: Any]) async {
        guard !isPreview, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeDisplayAPI.post(body)
            if r["ok"] as? Bool != true { toast = (r["error"] as? String) ?? "うまくいきませんでした" }
        } catch {
            toast = NativeDisplayAPI.message(error)
        }
        await load()
    }

    /// 新しく「できあがり」に入った番号・新しい品でチャイム（開いた直後・案内の画面のあとは鳴らさない）
    private func chime(_ p: NDSPayload) {
        if let c = p.call {
            let ids = Set(c.ready.map(\.orderId))
            if let seen = seenReady, !ids.subtracting(seen).isEmpty { NativeDisplaySound.ready() }
            seenReady = ids
        } else {
            seenReady = nil
        }
        if let k = p.kitchen {
            let ids = Set(k.groups.flatMap { g in g.items.filter { $0.kitchenStatus == "pending" }.map(\.id) })
            if let seen = seenPending, k.kdsSettings.sound, !ids.subtracting(seen).isEmpty { AudioServicesPlaySystemSound(1005) }
            seenPending = ids
        } else {
            seenPending = nil
        }
    }

    /// 5分に1回：端末の鍵の期限を延ばす・「使用中」を記録
    private func beatIfDue() async {
        if let at = lastBeat, Date().timeIntervalSince(at) < 300 { return }
        lastBeat = Date()
        _ = try? await NativeDisplayAPI.post(["type": "heartbeat"])
    }
}

enum NativeDisplaySound {
    private static let bell: SystemSoundID = {
        var id: SystemSoundID = 0
        if let url = Bundle.main.url(forResource: "bell", withExtension: "wav") {
            AudioServicesCreateSystemSoundID(url as CFURL, &id)
        }
        return id
    }()

    /// 呼び出しのチャイム（アプリの bell.wav。無ければ iOS の音）
    static func ready() {
        AudioServicesPlaySystemSound(bell != 0 ? bell : 1005)
    }
}

enum NDSColor {
    /// 呼び出しモニターの地（上のバーと同じネイビー系）
    static let board = Color(hex: 0x0F0C26)
    static let bar = NT.topBar
    static let panel = Color.white.opacity(0.06)
    static let readyPanel = Color(hex: 0x15803D).opacity(0.18)
    static let readyLine = Color(hex: 0x22C55E).opacity(0.45)
    static let readyInk = Color(hex: 0x4ADE80)
    static let readyTile = Color(hex: 0x16A34A)
    static let fresh = Color(hex: 0xF6C77A)
}

// MARK: - いちばん上に重ねる（RootView から 1 行）

struct NativeDisplayLayer: View {
    @ObservedObject private var store = NativeDisplayStore.shared

    var body: some View {
        ZStack {
            if store.active {
                NativeDisplayScreen().transition(.opacity)
            }
            if store.pairing {
                NativeDisplayPairView().transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: store.active)
        .animation(.easeOut(duration: 0.2), value: store.pairing)
    }
}

// MARK: - ディスプレイの画面（案内／キッチン／呼び出し）

struct NativeDisplayScreen: View {
    @StateObject private var model: NativeDisplayModel
    @ObservedObject private var store = NativeDisplayStore.shared
    @State private var menuOpen = false
    @State private var station = "all"
    @State private var showServed = false
    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(preview: NDSPayload? = nil) {
        _model = StateObject(wrappedValue: NativeDisplayModel(preview: preview))
    }

    var body: some View {
        ZStack {
            NDSColor.board.ignoresSafeArea()
            content
        }
        .overlay(alignment: .bottom) { banner }
        .statusBarHidden(true)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            model.start()
        }
        .onDisappear { model.stop() }
        .onReceive(clock) { _ in model.tick() }
        .alert("この iPad（ディスプレイ）", isPresented: $menuOpen) {
            Button("今すぐ読み直す") { Task { await model.load() } }
            Button("QR を読み直す（つなぎ直す）") { store.startPairing() }
            Button("レジに戻す（ディスプレイを解除）", role: .destructive) { Task { await store.leave() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「レジに戻す」を押すと、この iPad はディスプレイの登録を解除して、レジのログイン画面に戻ります。")
        }
    }

    @ViewBuilder private var content: some View {
        if let p = model.payload {
            if p.screen == "board", let call = p.call {
                NDSCallBoard(payload: p, call: call, now: model.now, onMenu: { menuOpen = true })
            } else if p.screen == "board", let kitchen = p.kitchen {
                NDSKitchenBoard(model: model, payload: p, kitchen: kitchen, station: $station, showServed: $showServed, onMenu: { menuOpen = true })
            } else {
                NDSNoticeView(
                    notice: p.notice ?? NDSNotice(icon: "loading", title: "接続を確認しています…", body: nil, footer: nil),
                    onRescan: { store.startPairing() },
                    onMenu: { menuOpen = true }
                )
            }
        } else {
            NDSNoticeView(
                notice: NDSNotice(icon: "loading", title: model.offline == nil ? "読み込み中…" : "接続を確認しています…", body: model.offline, footer: nil),
                onRescan: { store.startPairing() },
                onMenu: { menuOpen = true }
            )
        }
    }

    @ViewBuilder private var banner: some View {
        if let t = model.toast {
            Text(t).font(.system(size: 16, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 20).padding(.vertical, 12)
                .background(Capsule().fill(NT.danger.opacity(0.92)))
                .padding(.bottom, 24)
                .task {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if model.toast == t { model.toast = nil }
                }
        } else if model.offline != nil, model.payload != nil {
            HStack(spacing: 8) {
                Image(systemName: "wifi.exclamationmark")
                Text("通信できません。このまま待っています（ログアウトはしていません）")
            }
            .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
            .padding(.horizontal, 18).padding(.vertical, 10)
            .background(Capsule().fill(Color.black.opacity(0.7)))
            .padding(.bottom, 20)
        }
    }
}

/// 上のバー（店名・端末名・時計）。長押しでメニュー（レジに戻す など）
struct NDSHeader: View {
    let title: String
    let subtitle: String
    let now: Date
    /// 右にメニューのボタンを出す（キッチン。お客様が見る呼び出しモニターは長押しだけ）
    var menuButton = false
    let onMenu: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 22, weight: .heavy)).foregroundColor(.white).lineLimit(1)
                Text(subtitle).font(.system(size: 13, weight: .semibold)).foregroundColor(.white.opacity(0.55)).lineLimit(1)
            }
            Spacer(minLength: 12)
            Text(Self.hm(now)).font(.system(size: 34, weight: .heavy)).monospacedDigit().foregroundColor(.white)
            if menuButton {
                Button(action: onMenu) {
                    Image(systemName: "ellipsis").font(.system(size: 18, weight: .bold)).foregroundColor(.white.opacity(0.8))
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Color.white.opacity(0.1)))
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("メニュー")
            }
        }
        .padding(.horizontal, 22).padding(.vertical, 12)
        .background(NDSColor.bar.ignoresSafeArea(edges: .top))
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 1.5) { onMenu() }
    }

    private static let hmFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "HH:mm"
        return f
    }()

    static func hm(_ d: Date) -> String { hmFormatter.string(from: d) }
}

// MARK: - 案内（回線の外・機能 OFF・解除済み・未登録・接続確認中）

struct NDSNoticeView: View {
    let notice: NDSNotice
    let onRescan: () -> Void
    let onMenu: () -> Void

    private var needsAction: Bool { notice.icon == "unpaired" || notice.icon == "revoked" }

    var body: some View {
        ZStack {
            NativeLoginBackground(glowAt: UnitPoint(x: 0.5, y: 0.85))
            VStack(spacing: 18) {
                icon
                Text(notice.title).font(.system(size: 34, weight: .heavy)).foregroundColor(.white)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                if let b = notice.body, !b.isEmpty {
                    Text(b).font(.system(size: 19, weight: .semibold)).foregroundColor(NLStyle.sub)
                        .multilineTextAlignment(.center).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
                }
                if needsAction {
                    HStack(spacing: 14) {
                        actionButton("QR を読み直す", icon: "qrcode.viewfinder", primary: true, action: onRescan)
                        actionButton("レジに戻す", icon: "arrow.uturn.backward", primary: false, action: onMenu)
                    }
                    .padding(.top, 10)
                }
                if let f = notice.footer, !f.isEmpty {
                    Text(f).font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.45)).padding(.top, 24)
                }
            }
            .padding(40)
            .frame(maxWidth: 820)
        }
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 1.5) { onMenu() }
    }

    @ViewBuilder private var icon: some View {
        if notice.icon == "loading" {
            ProgressView().tint(.white).scaleEffect(2).frame(width: 72, height: 72)
        } else {
            Image(systemName: Self.symbol(notice.icon)).font(.system(size: 56, weight: .semibold)).foregroundColor(.white.opacity(0.85))
                .frame(width: 72, height: 72)
        }
    }

    static func symbol(_ icon: String) -> String {
        switch icon {
        case "network": return "wifi.slash"
        case "revoked": return "xmark.circle"
        case "unpaired": return "display"
        default: return "exclamationmark.circle"
        }
    }

    private func actionButton(_ text: String, icon: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                Text(text)
            }
            .font(.system(size: 18, weight: .heavy))
            .foregroundColor(primary ? .white : NLStyle.accent)
            .padding(.horizontal, 22).frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(primary ? NT.purple : Color.white.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(primary ? 0 : 0.2), lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - 呼び出しモニター（左「調理中」・右「できあがり」）

struct NDSCallBoard: View {
    let payload: NDSPayload
    let call: NDSCall
    let now: Date
    let onMenu: () -> Void

    /// できあがってからこの時間は番号を光らせる（Web と同じ 30 秒）
    private static let freshMs: Double = 30_000

    var body: some View {
        VStack(spacing: 0) {
            NDSHeader(
                title: payload.store?.name ?? "",
                subtitle: "\(payload.device?.name ?? "")・呼び出しモニター",
                now: now,
                onMenu: onMenu
            )
            GeometryReader { geo in
                let wide = geo.size.width > 700
                let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
                layout {
                    cookingPanel
                        .frame(width: wide ? (geo.size.width - 48) * 0.4 : nil)
                        .frame(maxHeight: .infinity, alignment: .top)
                    readyPanel
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                .padding(16)
            }
        }
    }

    private var cookingPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("調理中").font(.system(size: 34, weight: .heavy)).foregroundColor(.white.opacity(0.85))
                Spacer()
                Text("\(call.cooking.count)件").font(.system(size: 16, weight: .bold)).foregroundColor(.white.opacity(0.4))
            }
            Rectangle().fill(Color.white.opacity(0.1)).frame(height: 1)
            if call.cooking.isEmpty {
                Text("ありません").font(.system(size: 20, weight: .semibold)).foregroundColor(.white.opacity(0.4))
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12)], spacing: 12) {
                        ForEach(call.cooking) { e in tile(e, ready: false) }
                    }
                }
            }
        }
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(NDSColor.panel))
    }

    private var readyPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 10) {
                    Image(systemName: "bell.fill")
                    Text("できあがり")
                }
                .font(.system(size: 40, weight: .heavy)).foregroundColor(NDSColor.readyInk)
                Spacer()
                Text("お受け取りください").font(.system(size: 18, weight: .bold)).foregroundColor(NDSColor.readyInk.opacity(0.85))
            }
            Rectangle().fill(NDSColor.readyLine).frame(height: 1)
            if call.ready.isEmpty {
                Text("ありません").font(.system(size: 20, weight: .semibold)).foregroundColor(.white.opacity(0.4))
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 16)], spacing: 16) {
                        ForEach(call.ready) { e in tile(e, ready: true) }
                    }
                }
            }
        }
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(NDSColor.readyPanel))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(NDSColor.readyLine, lineWidth: 2))
    }

    private func tile(_ e: NDSCallEntry, ready: Bool) -> some View {
        let fresh = ready && (NFTime.ms(iso: e.since).map { now.timeIntervalSince1970 * 1000 - $0 < Self.freshMs } ?? false)
        return VStack(spacing: 4) {
            Text("\(e.orderNo)").font(.system(size: ready ? 72 : 48, weight: .heavy)).monospacedDigit()
                .foregroundColor(ready ? .white : .white.opacity(0.85))
                .lineLimit(1).minimumScaleFactor(0.5)
            if let t = e.tableName, !t.isEmpty {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(ready ? .white.opacity(0.85) : .white.opacity(0.5)).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, ready ? 18 : 14).padding(.horizontal, 8)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(ready ? NDSColor.readyTile : Color.white.opacity(0.1)))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(NDSColor.fresh, lineWidth: fresh ? 5 : 0))
        .shadow(color: .black.opacity(ready ? 0.3 : 0), radius: 8, y: 4)
    }
}

// MARK: - キッチンディスプレイ（/app/kitchen と同じ：品を押すと 未着手→調理中→完成→提供済）

struct NDSKitchenBoard: View {
    @ObservedObject var model: NativeDisplayModel
    let payload: NDSPayload
    let kitchen: NDSKitchen
    @Binding var station: String
    @Binding var showServed: Bool
    let onMenu: () -> Void

    private static let stationLabel = ["all": "すべて", "kitchen": "キッチン", "grill": "焼き場", "drink": "ドリンク", "dessert": "デザート"]
    private static let statusLabel = ["pending": "未着手", "preparing": "調理中", "ready": "完成", "served": "提供済"]
    private static let nextStatus = ["pending": "preparing", "preparing": "ready", "ready": "served"]
    private static let nextLabel = ["pending": "調理開始", "preparing": "完成", "ready": "提供済"]
    private static let sourceLabel = ["pos": "POS", "qr": "QR", "online": "オンライン"]

    /// 選んでいるタブ（端末の持ち場が変わってタブから消えたら「すべて」）
    private var current: String { kitchen.stationOptions.contains(station) ? station : "all" }

    var body: some View {
        VStack(spacing: 0) {
            NDSHeader(
                title: payload.store?.name ?? "",
                subtitle: "\(payload.device?.name ?? "")・キッチンディスプレイ・持ち場 \(payload.device?.stationsLabel ?? "すべて")",
                now: model.now,
                menuButton: true,
                onMenu: onMenu
            )
            toolbar
            board
        }
        .background(NT.page.ignoresSafeArea())
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            if kitchen.stationOptions.count > 2 {
                HStack(spacing: 4) {
                    ForEach(kitchen.stationOptions, id: \.self) { st in
                        let n = unserved.filter { st == "all" || $0.station == st }.count
                        Button { station = st } label: {
                            HStack(spacing: 6) {
                                Text(Self.stationLabel[st] ?? st).font(.system(size: 16, weight: .heavy))
                                if n > 0 {
                                    Text("\(n)").font(.system(size: 12, weight: .heavy)).monospacedDigit()
                                        .padding(.horizontal, 6).frame(height: 20)
                                        .background(Capsule().fill(current == st ? Color.white.opacity(0.25) : NT.lilac))
                                }
                            }
                            .foregroundColor(current == st ? .white : NT.ink)
                            .padding(.horizontal, 14).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(current == st ? NT.purple : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(current == st ? Color.clear : NT.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            Spacer(minLength: 8)
            stat("未提供", "\(kitchen.unservedCount)", "品")
            stat("平均待ち", "\(kitchen.avgElapsedMinutes)", "分")
            Button { showServed.toggle() } label: {
                HStack(spacing: 6) {
                    Image(systemName: showServed ? "checkmark.square.fill" : "square").font(.system(size: 16, weight: .semibold))
                    Text("提供済を表示").font(.system(size: 14, weight: .bold))
                }
                .foregroundColor(showServed ? NT.purple : NT.ink2)
                .padding(.horizontal, 12).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(showServed ? NT.purple : NT.line, lineWidth: 1))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private func stat(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                Text(unit).font(.system(size: 11)).foregroundColor(NT.ink3)
            }
        }
        .padding(.horizontal, 12).frame(height: 46)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private var unserved: [NKItem] { kitchen.groups.flatMap { $0.items.filter { $0.kitchenStatus != "served" } } }

    private func visibleItems(_ g: NKGroup) -> [NKItem] {
        g.items.filter { (current == "all" || $0.station == current) && (showServed || $0.kitchenStatus != "served") }
    }

    @ViewBuilder private var board: some View {
        let groups = kitchen.groups.filter { !visibleItems($0).isEmpty }
        if groups.isEmpty {
            VStack(spacing: 10) {
                Spacer()
                Image(systemName: "checkmark.circle").font(.system(size: 48)).foregroundColor(NT.ok)
                Text("いま作る品はありません").font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                Text("新しい注文が入るとここに出ます").font(.system(size: 15)).foregroundColor(NT.ink3)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14, alignment: .top)], spacing: 14) {
                    ForEach(groups) { g in card(g) }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
        }
    }

    private func minutes(since iso: String) -> Int {
        guard let ms = NFTime.ms(iso: iso) else { return 0 }
        return max(0, Int((model.now.timeIntervalSince1970 * 1000 - ms) / 60_000))
    }

    private func tone(_ m: Int) -> Color {
        let s = kitchen.kdsSettings
        if m >= s.warn3 { return NT.danger }
        if m >= s.warn2 { return Color(hex: 0xF59E0B) }
        if m >= s.warn1 { return NT.purple }
        return NT.ink3
    }

    private func card(_ g: NKGroup) -> some View {
        let m = minutes(since: g.orderTime)
        let c = tone(m)
        let items = visibleItems(g)
        let open = items.filter { $0.kitchenStatus != "served" }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(g.tableName ?? "#\(g.orderNo)").font(.system(size: 24, weight: .heavy)).foregroundColor(NT.ink)
                Text(Self.sourceLabel[g.orderSource] ?? g.orderSource).font(.system(size: 11, weight: .heavy)).foregroundColor(NT.ink2)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(NT.lilac))
                if g.tableName != nil { Text("#\(g.orderNo)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3) }
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(m)").font(.system(size: 26, weight: .heavy)).monospacedDigit()
                    Text("分").font(.system(size: 12, weight: .bold))
                }
                .foregroundColor(c)
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            Rectangle().fill(NT.line).frame(height: 1)
            ForEach(items) { it in itemRow(it) }
            if !open.isEmpty {
                Button {
                    // 画面に出ている品だけ（端末の持ち場・タブで絞った分。サーバーも端末の持ち場で確かめる）
                    Task { await model.act(["type": "served", "orderId": g.orderId, "itemIds": open.map(\.id)]) }
                } label: {
                    Text(current == "all" ? "すべて提供済" : "\(Self.stationLabel[current] ?? "") をすべて提供済")
                        .font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.pay))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy)
                .padding(12)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(c == NT.ink3 ? NT.line : c, lineWidth: c == NT.ink3 ? 1 : 2.5))
        .shadow(color: Color.black.opacity(0.05), radius: 8, y: 3)
    }

    private func itemRow(_ it: NKItem) -> some View {
        let next = Self.nextStatus[it.kitchenStatus]
        let chip: (Color, Color) = {
            switch it.kitchenStatus {
            case "preparing": return (Color(hex: 0xFEF3C7), Color(hex: 0x92400E))
            case "ready": return (Color(hex: 0xD9F7EC), Color(hex: 0x036B4A))
            case "served": return (NT.lilac, NT.ink3)
            default: return (Color(hex: 0xF1F1F5), NT.ink2)
            }
        }()
        return Button {
            if let next { Task { await model.act(["type": "advance", "itemId": it.id, "next": next]) } }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("\(it.quantity)").font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink).frame(minWidth: 28, alignment: .trailing)
                VStack(alignment: .leading, spacing: 2) {
                    Text(it.name).font(.system(size: 19, weight: .bold)).foregroundColor(it.kitchenStatus == "served" ? NT.ink3 : NT.ink)
                        .strikethrough(it.kitchenStatus == "served")
                    if !it.modifiers.isEmpty {
                        Text(it.modifiers.map(\.name).joined(separator: "・")).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.purple)
                    }
                    if let memo = it.memo, !memo.isEmpty {
                        Text(memo).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger)
                    }
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(Self.statusLabel[it.kitchenStatus] ?? it.kitchenStatus).font(.system(size: 13, weight: .heavy)).foregroundColor(chip.1)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(chip.0))
                    if next != nil, let label = Self.nextLabel[it.kitchenStatus] {
                        Text("押して\(label)").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(next == nil || model.busy)
    }
}

// MARK: - この iPad をディスプレイにする（QR を読む）

struct NativeDisplayPairView: View {
    @ObservedObject private var store = NativeDisplayStore.shared
    /// 見本（カメラを出さない）
    var preview = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                NativeLoginBackground(glowAt: UnitPoint(x: 0.7, y: 0.6))
                if geo.size.width > 820 {
                    HStack(alignment: .center, spacing: 48) {
                        guide.frame(width: 420, alignment: .leading)
                        camera.frame(width: 380, height: 380)
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 24) {
                            guide
                            camera.frame(width: 300, height: 300)
                        }
                        .padding(24)
                    }
                }
            }
        }
        .environment(\.colorScheme, .dark)
    }

    private var guide: some View {
        VStack(alignment: .leading, spacing: 16) {
            NativeBrandPill(size: 14)
            Text("この iPad を\nディスプレイにする").font(.system(size: 34, weight: .heavy)).foregroundColor(.white)
            Text("キッチンディスプレイ（KDS）か呼び出しモニターとして、お店に置いておく iPad にします。登録するとレジとしては使えません（あとで「レジに戻す」で戻せます）。")
                .font(.system(size: 15, weight: .semibold)).foregroundColor(NLStyle.sub).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 10) {
                step(1, "レジ（別の iPad・パソコン）で「設定 → デバイス管理 → ディスプレイ端末」を開き、種類と持ち場を選んで「QRコードを表示」")
                step(2, "この iPad をレジと同じお店の Wi-Fi につなぐ")
                step(3, "右のカメラで QR を読む")
            }
            if let m = store.pairMessage {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundColor(Color(hex: 0xFF8A80))
                    Text(m).font(.system(size: 14, weight: .semibold)).foregroundColor(.white).fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: 0xC62828).opacity(0.35)))
            }
            Button { store.cancelPairing() } label: {
                Text("やめる").font(.system(size: 16, weight: .bold)).foregroundColor(NLStyle.accent)
                    .padding(.horizontal, 20).frame(height: 46)
                    .overlay(Capsule().stroke(NLStyle.accent.opacity(0.6), lineWidth: 1))
            }
            .buttonStyle(PressableStyle())
            .padding(.top, 6)
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(.system(size: 14, weight: .heavy)).foregroundColor(NLStyle.navy)
                .frame(width: 24, height: 24).background(Circle().fill(NLStyle.accent))
            Text(text).font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.9)).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var camera: some View {
        ZStack {
            if preview {
                Color.black
                Image(systemName: "qrcode.viewfinder").font(.system(size: 90, weight: .light)).foregroundColor(.white.opacity(0.35))
            } else {
                QRScannerView(embedded: true, onCode: { store.scanned($0) })
                    .id(store.scanEpoch)
            }
            if store.pendingCode != nil { confirm }
        }
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(NLStyle.accent.opacity(0.8), lineWidth: 3))
    }

    private var confirm: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 40)).foregroundColor(Color(hex: 0x4ADE80))
            Text("QR を読みました").font(.system(size: 20, weight: .heavy)).foregroundColor(.white)
            Text("この iPad をお店のディスプレイとして登録します").font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.85))
                .multilineTextAlignment(.center)
            Button { Task { await store.confirmPair() } } label: {
                HStack(spacing: 8) {
                    if store.pairBusy { ProgressView().tint(.white) }
                    Text(store.pairBusy ? "登録しています…" : "登録する").font(.system(size: 18, weight: .heavy))
                }
                .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 54)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
            .disabled(store.pairBusy)
            Button {
                store.pendingCode = nil
                store.scanEpoch += 1
            } label: {
                Text("読み直す").font(.system(size: 15, weight: .bold)).foregroundColor(.white.opacity(0.8))
            }
            .disabled(store.pairBusy)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.78))
    }
}

/// レジのログイン画面の「この iPad をディスプレイにする」（NativeRegiLogin.swift から 1 行）
struct NativeDisplayPairLink: View {
    var body: some View {
        Button { NativeDisplayStore.shared.startPairing() } label: {
            HStack(spacing: 6) {
                Image(systemName: "display")
                Text("この iPad をディスプレイにする（KDS・呼び出し）")
            }
            .font(.system(size: 13, weight: .bold))
            .foregroundColor(NLStyle.accent)
        }
        .buttonStyle(PressableStyle())
    }
}
