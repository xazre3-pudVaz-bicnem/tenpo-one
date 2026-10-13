import SwiftUI

/// アプリ全体の状態（どのモードで開くか・QR を読んでいるか）。
///
/// アプリは1つ。iPad か iPhone かで決まる（AppConfig.isPad）
/// - レジ（iPad）：いつもレジ。ログインしていなければ /register-login
/// - iPhone：最初に「ハンディ（スタッフ）」か「オーナー・店長」を選ぶ（あとで変えられる）
///   - ハンディ：/handy。ログインはお店の QR を読む（/handy-join）
///   - オーナー：/app（メール＋パスワード）。スマホでも本体の画面を開ける
final class AppState: ObservableObject {
    static let shared = AppState()

    enum Mode: String {
        case regi, handy, owner
    }

    private let modeKey = "tenpo.app.mode"

    @Published var mode: Mode?
    @Published var scanning = false
    /// ハンディでまだログインしていない（QR を読む画面を出す）
    @Published var needsHandyLogin = false
    /// Web の画面を作り直す（モードを変えたとき）
    @Published var webSession = UUID()
    /// ネイティブのオーダー・会計画面で開いている伝票（nil＝出していない）
    @Published var nativeOrder: NativeOrderRef?
    /// ネイティブのホーム・テーブル一覧（Web の上に重ねる。.none＝Web の画面）
    @Published var nativeScreen: NativeScreen = .none

    enum NativeScreen: Equatable { case none, home, floor }

    /// 店の名前（ネイティブのホームの上に出す。テーブル一覧・オーダーを開いたときに覚える）
    @Published var storeName: String = UserDefaults.standard.string(forKey: "tenpo.storeName") ?? "" {
        didSet { if storeName != oldValue { UserDefaults.standard.set(storeName, forKey: "tenpo.storeName") } }
    }

    private let nativePosKey = "tenpo.nativePos"
    /// ネイティブの画面（ホーム・テーブル一覧・オーダー・会計）を使うか。この iPad だけ。
    /// 既定は ON（2026-10-13 Ronnie「iPad がアプリらしくない」→「Native ON」）。レジの設定で OFF にできる
    var nativePosEnabled: Bool {
        get { AppConfig.isPad && (UserDefaults.standard.object(forKey: nativePosKey) as? Bool ?? true) }
        set {
            UserDefaults.standard.set(newValue, forKey: nativePosKey)
            if !newValue { nativeScreen = .none }
        }
    }
    /// 「今までの画面」を選んだ（アプリを開き直すまで、ホーム・テーブル一覧をネイティブで出さない）
    private var classicChosen = false
    /// 「今までの画面で開く」を選んだ伝票（もう一度ネイティブで開かない）
    private var webChosenOrders = Set<String>()
    /// 閉じたばかりの伝票（戻る途中にもう一度開かないように）
    private var recentlyClosed: (id: String, at: Date)?

    private init() {
        if AppConfig.isPad {
            // iPad はいつもレジ
            mode = .regi
        } else if let raw = UserDefaults.standard.string(forKey: modeKey), let saved = Mode(rawValue: raw), saved != .regi {
            mode = saved
        } else {
            mode = nil
        }
    }

    /// User-Agent に付ける印（サーバーが「アプリのどのモードか」を見分ける）
    var userAgentTag: String { mode?.rawValue ?? AppConfig.appKind }

    /// 最初に開く画面
    var startURL: URL {
        switch mode {
        case .handy: return AppConfig.url("/handy")
        case .owner, .regi, .none: return AppConfig.url("/app/dashboard")
        }
    }

    func choose(_ newMode: Mode) {
        UserDefaults.standard.set(newMode.rawValue, forKey: modeKey)
        needsHandyLogin = false
        mode = newMode
        webSession = UUID()
    }

    /// Web の「アプリのモードを変える」から
    func resetMode() {
        guard !AppConfig.isPad else { return } // iPad はレジのまま
        UserDefaults.standard.removeObject(forKey: modeKey)
        needsHandyLogin = false
        mode = nil
    }

    /// Web の画面に行く前に差し替える行き先（ログイン画面をモードに合わせる）。nil ならそのまま
    func redirect(for url: URL) -> URL? {
        guard AppConfig.isOwnHost(url) else { return nil }
        let path = url.path
        switch mode {
        case .regi:
            // レジはレジ用のログイン（企業番号＋店舗ユーザー名＋レジ用パスワード）
            if path == "/login" { return AppConfig.url("/register-login") }
        case .handy:
            // ハンディのログインはお店の QR。メールのログイン画面は出さない
            if path == "/login" || path == "/register-login" {
                DispatchQueue.main.async { self.needsHandyLogin = true }
                return URL(string: "about:blank")
            }
        default:
            break
        }
        return nil
    }

    /// Web の画面の行き先を見て、ネイティブの画面で開く:
    ///   /app/dashboard（ホーム）→ ネイティブのホーム、/app/floor（オーダー・会計）→ テーブル一覧、/app/pos?order=… → オーダー
    func maybeOpenNativePos(for url: URL) {
        guard mode == .regi, nativePosEnabled, AppConfig.isOwnHost(url) else { return }
        if !classicChosen && nativeOrder == nil {
            if url.path == "/app/dashboard" { nativeScreen = .home; return }
            if url.path == "/app/floor" && (url.query ?? "").isEmpty { nativeScreen = .floor; return }
        }
        guard nativeOrder == nil, url.path == "/app/pos" else { return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let orderId = items.first(where: { $0.name == "order" })?.value,
              orderId.range(of: "^[0-9a-fA-F-]{36}$", options: .regularExpression) != nil else { return }
        // テーブルグループの別の卓から（seat）・テーブル移動（move）は今までの画面で
        if items.contains(where: { $0.name == "seat" || $0.name == "move" }) { return }
        if webChosenOrders.contains(orderId) { return }
        if let r = recentlyClosed, r.id == orderId, Date().timeIntervalSince(r.at) < 4 { return }
        nativeOrder = NativeOrderRef(id: orderId)
    }

    /// ネイティブの画面を閉じる。openWebPath があれば Web でそこを開き（その伝票はもうネイティブで開かない）、無ければ前の画面へ戻る
    /// （テーブル一覧から開いた伝票は、テーブル一覧に戻る）
    func closeNativePos(openWebPath: String?) {
        let current = nativeOrder
        nativeOrder = nil
        if let id = current?.id { recentlyClosed = (id, Date()) }
        guard let web = WebViewController.current else { return }
        if let path = openWebPath {
            if let id = current?.id { webChosenOrders.insert(id) }
            nativeScreen = .none
            web.load(AppConfig.url(path))
        } else if current?.fromNative == true {
            NotificationCenter.default.post(name: .tenpoFloorReload, object: nil)
        } else {
            web.goBackOrHome()
        }
    }

    /// テーブル一覧（ネイティブ）から伝票を開く
    func openNativeOrder(_ orderId: String) {
        nativeOrder = NativeOrderRef(id: orderId, fromNative: true)
    }

    /// ネイティブのホームから Web の画面へ（その画面の間はネイティブを重ねない）
    func openWeb(_ path: String) {
        nativeScreen = .none
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// 「今までの画面」：アプリを開き直すまで、ホーム・テーブル一覧は Web のまま
    func chooseClassic(path: String) {
        classicChosen = true
        openWeb(path)
    }

    /// QR を読んだ結果
    func handleScanned(_ text: String) {
        scanning = false
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), AppConfig.isOwnHost(url) else {
            WebViewController.current?.showAlert(title: "TENPO ONE の QR ではありません", message: "お店の「ハンディ QR」を読んでください。")
            return
        }
        needsHandyLogin = false
        WebViewController.current?.load(url)
    }
}

/// ネイティブで開く伝票（Web の上に重ねて出す）
struct NativeOrderRef: Identifiable, Equatable {
    let id: String
    /// ネイティブのテーブル一覧から開いた（閉じたらテーブル一覧に戻る）
    var fromNative = false
}

extension Notification.Name {
    /// テーブル一覧を読み直す（伝票を閉じたとき）
    static let tenpoFloorReload = Notification.Name("tenpo.floorReload")
}
