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
    /// ネイティブのフロア（テーブル一覧）を出しているか（Web の /app/floor の代わり。2026-10-24）
    @Published var nativeFloor = false
    /// ネイティブのホームを出しているか（Web の /app/dashboard の代わり。2026-10-24）
    @Published var nativeHome = false
    /// ネイティブの店舗台帳を出しているか（Web の /app/reservations の代わり。2026-10-24）
    @Published var nativeLedger = false
    /// ネイティブのレジ開局・レジクローズ（/app/cash/open・/app/cash/close の代わり。2026-10-24）
    @Published var nativeCash = false
    /// ネイティブの入出金（/app/cash のレジ入出金タブ。2026-10-24）
    @Published var nativeCashIo = false
    /// 入出金のタブ（register・petty・closings。Web の ?tab=）
    @Published var cashTab = "register"
    /// ネイティブの即会計（/app/quick-pay。2026-10-24）
    @Published var nativeQuick = false
    @Published var quickRefreshTick = 0
    /// ネイティブの伝票明細（/app/orders。2026-10-24）
    @Published var nativeSlips = false
    /// ネイティブの仕入・経費（/app/expenses。2026-10-24）
    @Published var nativeExpenses = false
    /// ネイティブの在庫設定（本日の残り数。/app/inventory/menu-stock。2026-10-24）
    @Published var nativeStock = false
    /// ネイティブの通知（/app/notifications。2026-10-24）
    @Published var nativeNotices = false
    /// 通知の画面のどちらを出すか（notifications・announcements）
    @Published var noticesTab = "notifications"
    /// ネイティブの日別予算登録（/app/budgets/daily。2026-10-24）
    @Published var nativeBudget = false
    /// ネイティブの顧客台帳（/app/customers の一覧。2026-10-24）
    @Published var nativeCustomers = false
    /// ネイティブのスキャン（レシート撮影。/app/scan。2026-10-24）
    @Published var nativeScan = false
    /// スキャンで紐付ける出金（/app/scan?tx=）
    @Published var scanTx: String?
    /// ネイティブの店舗分析（/app/reports。2026-10-24）と開いたときの期間
    @Published var nativeReports = false
    @Published var reportsFrom: String?
    @Published var reportsTo: String?
    /// 伝票明細で開く伝票（/app/orders/<id> から。2026-10-24）
    @Published var slipsOpenId: String?
    /// フロアを読み直してほしいとき（会計完了など）に増やす
    @Published var floorRefreshTick = 0

    private let nativePosKey = "tenpo.nativePos"
    /// ネイティブのオーダー・会計画面を使うか。この iPad だけ。
    /// 既定は ON（2026-10-13 Ronnie「Native ON」）。レジの設定で OFF にできる。画面の並び（レイアウト）は Web と同じ
    var nativePosEnabled: Bool {
        get { AppConfig.isPad && (UserDefaults.standard.object(forKey: nativePosKey) as? Bool ?? true) }
        set { UserDefaults.standard.set(newValue, forKey: nativePosKey) }
    }
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

    /// Web の画面の行き先を見て、オーダー・会計（/app/pos?order=…）ならネイティブの画面で開く。
    /// ホーム・テーブル一覧のときは、裏でメニューを読んでおく（最初の伝票もすぐ開く。2026-10-21）
    func maybeOpenNativePos(for url: URL) {
        guard mode == .regi, nativePosEnabled, AppConfig.isOwnHost(url) else { return }
        if url.path == "/app/dashboard" || url.path == "/app/floor" || url.path == "/app" {
            Task { @MainActor in NativeCatalogCache.shared.refresh() }
        }
        // ホーム・テーブル一覧はネイティブで（Web の画面の上に重ねる。Native ON の iPad は Web のホーム・テーブル一覧を見せない）
        if url.path == "/app/dashboard" || url.path == "/app" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
            nativeLedger = false
            nativeCash = false
            nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
            if !nativeHome { nativeHome = true }
            return
        }
        if url.path == "/app/floor" {
            nativeLedger = false
            nativeCash = false
            nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
            nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; if !nativeFloor { nativeFloor = true }
            return
        }
        if url.path == "/app/reservations" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let view = q.first { $0.name == "view" }?.value
            // 1日のスケジュールだけネイティブ（週間・グルメ別・キャンセル待ち・受付管理はまだ Web）
            if view == nil || view == "day" {
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
                nativeCash = false
                nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
                if !nativeLedger { nativeLedger = true }
                return
            }
        }
        if url.path == "/app/reports" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
            reportsFrom = q.first { $0.name == "from" }?.value
            reportsTo = q.first { $0.name == "to" }?.value
            if !nativeReports { nativeReports = true }
            return
        }
        // スキャン（ScanSnap のまとめて取り込み #scan-bulk は Web のまま）
        if url.path == "/app/scan" && url.fragment != "scan-bulk" {
            let tx = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "tx" }?.value
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
            scanTx = tx
            if !nativeScan { nativeScan = true }
            return
        }
        // 顧客台帳の一覧だけ（RFM分析・重複候補 ?view=… と 顧客の Web の詳細 /app/customers/<id> は Web のまま）
        if url.path == "/app/customers" && !(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).contains(where: { $0.name == "view" }) {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
            if !nativeCustomers { nativeCustomers = true }
            return
        }
        if url.path == "/app/budgets/daily" {
            nativeFloor = false; nativeNotices = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
            if !nativeBudget { nativeBudget = true }
            return
        }
        if url.path == "/app/notifications" || url.path == "/app/announcements" {
            noticesTab = url.path == "/app/announcements" ? "announcements" : "notifications"
            nativeFloor = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
            if !nativeNotices { nativeNotices = true }
            return
        }
        if url.path == "/app/inventory/menu-stock" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false
            if !nativeStock { nativeStock = true }
            return
        }
        if url.path == "/app/expenses" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeStock = false
            if !nativeExpenses { nativeExpenses = true }
            return
        }
        // 伝票の詳細（/app/orders/<id>）は伝票明細のネイティブの詳細で開く（返金・再オープンは同じ画面にある）
        if url.path.hasPrefix("/app/orders/") {
            let id = String(url.path.dropFirst("/app/orders/".count))
            if id.count == 36, id.allSatisfy({ $0.isHexDigit || $0 == "-" }) {
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeExpenses = false; nativeStock = false
                slipsOpenId = id
                if !nativeSlips { nativeSlips = true }
                return
            }
        }
        if url.path == "/app/orders" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeExpenses = false; nativeStock = false
            if !nativeSlips { nativeSlips = true }
            return
        }
        if url.path == "/app/quick-pay" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
            if !nativeQuick { nativeQuick = true }
            return
        }
        if url.path == "/app/cash" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let tab = q.first { $0.name == "tab" }?.value
            if tab == nil || tab == "register" || tab == "petty" || tab == "closings" {
                cashTab = tab ?? "register"
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
                if !nativeCashIo { nativeCashIo = true }
                return
            }
        }
        if url.path == "/app/cash/open" || url.path == "/app/cash/close" {
            nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
            nativeHome = false
            nativeLedger = false
            if !nativeCash { nativeCash = true }
            return
        }
        if url.path != "/app/pos" {
            // 設定など、まだ Web の画面へ行ったらネイティブを閉じる
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
            nativeHome = false
            nativeLedger = false
            nativeCash = false
            nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        }
        guard nativeOrder == nil, url.path == "/app/pos" else { return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let orderId = items.first(where: { $0.name == "order" })?.value,
              orderId.range(of: "^[0-9a-fA-F-]{36}$", options: .regularExpression) != nil else { return }
        // テーブルグループの別の卓から（seat）・テーブル移動（move）は今までの画面で
        if items.contains(where: { $0.name == "seat" || $0.name == "move" }) { return }

        // 閉じた直後（戻るの途中）だけ開き直さない。長いと「戻る→もう一度レジ会計」が Web で開いてしまう（2026-10-24 Ronnie）
        if let r = recentlyClosed, r.id == orderId, Date().timeIntervalSince(r.at) < 1.5 { return }
        // Web の卓のポップアップ「レジ会計」（?checkout=1）はすぐ会計の画面に
        let checkout = items.contains { $0.name == "checkout" && $0.value == "1" }
        nativeOrder = NativeOrderRef(id: orderId, checkout: checkout)
    }

    /// ネイティブの画面を閉じる。openWebPath があれば Web でそこを開き（その伝票はもうネイティブで開かない）、無ければ前の画面へ戻る
    func closeNativePos(openWebPath: String?) {
        let current = nativeOrder?.id
        nativeOrder = nil
        if let id = current { recentlyClosed = (id, Date()) }
        guard let web = WebViewController.current else { return }
        if let path = openWebPath {
            if let id = current { webChosenOrders.insert(id) }
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
            web.load(AppConfig.url(path))
        } else if nativeQuick {
            quickRefreshTick += 1
        } else if nativeFloor {
            // ネイティブのフロアに戻る（Web は /app/floor のまま。読み直すだけ）
            floorRefreshTick += 1
        } else {
            web.goBackOrHome()
        }
    }

    /// ネイティブのフロアから伝票を開く（注文・レジ会計）
    func openNativeOrder(_ orderId: String, checkout: Bool) {
        recentlyClosed = nil
        webChosenOrders.remove(orderId)
        nativeOrder = NativeOrderRef(id: orderId, checkout: checkout)
    }

    /// ネイティブの画面を閉じて Web の画面へ（店舗台帳・設定など、まだネイティブに無い画面）
    func leaveNativeFloor(to path: String) {
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// ネイティブの店舗台帳へ（Web も /app/reservations にそろえる）
    func goNativeLedger() {
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeLedger = true
        WebViewController.current?.load(AppConfig.url("/app/reservations"))
    }

    /// ネイティブのフロアからホームへ（ネイティブのホームを出す。Web も /app/dashboard にそろえる）
    func goNativeHome() {
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeLedger = false
        nativeCash = false
        nativeHome = true
        WebViewController.current?.load(AppConfig.url("/app/dashboard"))
    }

    /// ネイティブのホームからフロアへ（Web も /app/floor にそろえる＝レシート・ドロアの Web 側の仕組みはそのまま）
    func goNativeFloor() {
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeLedger = false
        nativeCash = false
        nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeFloor = true
        WebViewController.current?.load(AppConfig.url("/app/floor"))
    }

    /// ネイティブのレジ開局・レジクローズへ（Web も同じ画面にそろえる）
    func goNativeCash(_ path: String) {
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = true
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// ネイティブの在庫設定へ
    func goNativeNotices(tab: String = "notifications") {
        noticesTab = tab
        nativeFloor = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeNotices = true
        WebViewController.current?.load(AppConfig.url(tab == "announcements" ? "/app/announcements" : "/app/notifications"))
    }

    func goNativeCustomers() {
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
        nativeCustomers = true
        WebViewController.current?.load(AppConfig.url("/app/customers"))
    }

    func goNativeBudget() {
        nativeFloor = false; nativeNotices = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
        nativeBudget = true
        WebViewController.current?.load(AppConfig.url("/app/budgets/daily"))
    }

    func goNativeStock() {
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = true
        WebViewController.current?.load(AppConfig.url("/app/inventory/menu-stock"))
    }

    /// ネイティブの仕入・経費へ
    func goNativeExpenses() {
        nativeStock = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = true
        WebViewController.current?.load(AppConfig.url("/app/expenses"))
    }

    /// ネイティブの伝票明細へ
    func goNativeSlips() {
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeExpenses = false
        nativeStock = false
        nativeSlips = true
        WebViewController.current?.load(AppConfig.url("/app/orders"))
    }

    /// ネイティブの即会計へ
    func goNativeQuick() {
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeQuick = true
        WebViewController.current?.load(AppConfig.url("/app/quick-pay"))
    }

    /// ネイティブの入出金へ
    func goNativeCashIo(tab: String = "register") {
        cashTab = tab
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false
        nativeCashIo = true
        WebViewController.current?.load(AppConfig.url(tab == "register" ? "/app/cash" : "/app/cash?tab=\(tab)"))
    }

    /// 会計完了は必ず最新のフロアを読み直す。
    func finishNativeCheckout() {
        nativeOrder = nil
        webChosenOrders.removeAll()
        recentlyClosed = nil
        if nativeQuick {
            // 即会計から会計した → 即会計に戻る（次のお客さん）
            quickRefreshTick += 1
        } else if nativeFloor {
            // フロアはネイティブのまま。読み直して卓が空席になったのを見せる
            floorRefreshTick += 1
        } else {
            WebViewController.current?.load(AppConfig.url("/app/floor"))
        }
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
    /// 開いてすぐ会計の画面にする（卓のポップアップの「レジ会計」）
    var checkout: Bool = false
}
