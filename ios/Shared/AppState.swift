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
    /// ネイティブの在庫（/app/inventory の品目・棚卸・移動・発注提案・予測。2026-10-24）と開くタブ・棚卸
    @Published var nativeInventory = false
    @Published var inventoryTab = "items"
    @Published var inventoryCountId: String?
    /// ネイティブの仕入先（/app/vendors）・発注（/app/purchases・new・<id>。2026-10-24）
    @Published var nativeVendors = false
    @Published var nativePurchases = false
    @Published var purchasesRoute: NUPurchasesRoute = .list
    /// ネイティブのクーポン管理（/app/coupons。2026-10-24）
    @Published var nativeCoupons = false
    /// ネイティブの通知（/app/notifications。2026-10-24）
    @Published var nativeNotices = false
    /// 通知の画面のどちらを出すか（notifications・announcements）
    @Published var noticesTab = "notifications"
    /// ネイティブの日別予算登録（/app/budgets/daily。2026-10-24）
    @Published var nativeBudget = false
    /// 予算の画面のどちらを出すか（monthly＝予算管理 /app/budgets、daily＝日別予算登録）と開く月
    @Published var budgetView = "daily"
    @Published var budgetMonth: String?
    /// ネイティブの顧客台帳（/app/customers の一覧。2026-10-24）
    @Published var nativeCustomers = false
    /// 顧客台帳のどれを出すか（list・rfm・duplicates。Web の ?view=）
    @Published var customersView = "list"
    @Published var customersOpenId: String?
    /// ネイティブのスキャン（レシート撮影。/app/scan。2026-10-24）
    @Published var nativeScan = false
    /// スキャンで紐付ける出金（/app/scan?tx=）
    @Published var scanTx: String?
    /// ネイティブの店舗分析（/app/reports。2026-10-24）と開いたときの期間
    @Published var nativeReports = false
    /// ネイティブの設定（このiPadのプリンター・レジの設定・管理画面への入口。2026-10-24）
    @Published var nativeSettings = false
    /// 設定の中のネイティブの画面（品切れ …。2026-10-24 Ronnie「設定の中も全部ネイティブ」）。nil なら無し
    @Published var nativeSettingsPage: NativeSettingsPageKey?
    @Published var reportsFrom: String?
    @Published var reportsTo: String?
    /// 伝票明細で開く伝票（/app/orders/<id> から。2026-10-24）
    @Published var slipsOpenId: String?
    /// まだ専用の台が無かった画面（勤怠・日報…）をネイティブで開いているとき（NativeModules.swift の仕組み）
    @Published var nativeModule: NativeModuleRoute?
    /// ネイティブの店舗台帳で開く表示（list / week / gourmet / wait / month / inbox / messages）と、開く予約。Web の ?view= ?open= から
    @Published var ledgerView: String?
    @Published var ledgerOpenId: String?
    /// iPhone：ハンディのテーブル一覧（/handy の代わり）とオーナー・店長のホーム（/app/dashboard の代わり）をネイティブで出しているか（2026-10-24）
    @Published var nativeHandyHome = false
    @Published var nativeOwnerHome = false
    /// iPhone ハンディの卓・注文をネイティブで出しているとき（/handy/<卓>・/handy/<卓>/order の代わり。2026-10-25 Ronnie「iPhone も native に」）
    struct PhoneHandyRoute: Equatable, Hashable { let tableId: String; var orderId: String? }
    @Published var phoneHandy: PhoneHandyRoute?
    /// iPhone のネイティブの画面を読み直してほしいとき（Web が /handy に戻ってきたときなど）に増やす
    @Published var phoneRefreshTick = 0
    /// ネイティブの予約設定＝予約受付ルール（/app/settings/booking。店舗台帳の 📅「台帳設定」から。2026-10-24）
    @Published var nativeBooking = false
    /// フロアを読み直してほしいとき（会計完了など）に増やす
    @Published var floorRefreshTick = 0
    /// Web の /app/floor/<卓>/setup（テーブルの準備＝来店登録）から来たとき、ネイティブのテーブル一覧で来店登録を開く卓（開いたら nil に戻す）
    @Published var floorSetupTableId: String?

    private let nativePosKey = "tenpo.nativePos"
    private let nativePhoneKey = "tenpo.nativePhone"
    /// iPhone のホーム（ハンディのテーブル一覧・オーナーのホーム）をネイティブで出すか。既定は ON（2026-10-24 Ronnie「iOS ホーム画面」）
    var nativePhoneEnabled: Bool {
        get { !AppConfig.isPad && (UserDefaults.standard.object(forKey: nativePhoneKey) as? Bool ?? true) }
        set { UserDefaults.standard.set(newValue, forKey: nativePhoneKey) }
    }
    /// ネイティブのオーダー・会計画面を使うか。この iPad だけ。
    /// 既定は ON（2026-10-13 Ronnie「Native ON」）。レジの設定で OFF にできる。画面の並び（レイアウト）は Web と同じ
    var nativePosEnabled: Bool {
        get { AppConfig.isPad && (UserDefaults.standard.object(forKey: nativePosKey) as? Bool ?? true) }
        set { UserDefaults.standard.set(newValue, forKey: nativePosKey) }
    }
    /// アプリ自身の印刷係（NativePrintAgent）を動かすか＝ネイティブ ON の iPad（レジ）。OFF のときは今まで通り Web の DirectPrintAgent
    var nativePrintAgentOn: Bool { AppConfig.isPad && mode == .regi && nativePosEnabled }

    /// 管理画面（設定 › レジ端末）がこの端末のネイティブ ON/OFF を決めているか（nil＝端末まかせ）。
    /// 2026-10-24 Ronnie「管理画面から全部の設定を。アプリのも」。GET /api/app/v1/pos?part=device（lib/register-device-server.ts）
    @Published var adminNativePos: Bool? = nil
    /// 管理画面が LAN（この iPad から送る）・Wi-Fi 直接印刷のプリンターを決めているか
    @Published var adminLanManaged = false
    @Published var adminWifiManaged = false
    private var deviceSettingsFetchedAt: Date?

    private struct APIDeviceSetting: Decodable {
        struct Device: Decodable {
            let id: String; let name: String?; let printerConfigId: String?; let nativePos: Bool?
            /// LAN / Wi-Fi のプリンター（管理画面で決める。2026-10-25 Ronnie「LAN / Wi-Fi は app からつながない、control centre から」）。nil は端末まかせ
            let lanPrinterIds: [String]?; let wifiPrinterIds: [String]?
        }
        let ok: Bool
        let device: Device?
    }

    /// 管理画面で決めた端末の設定を読んで従う（ホーム・テーブル一覧を開いたとき。1 分に 1 回まで）。
    /// nativePos が true/false なら、端末の ON/OFF をそれに合わせる（端末の切り替えは出さない）。nil なら今までどおり端末まかせ
    @MainActor func refreshDeviceSettings(force: Bool = false) {
        guard AppConfig.isPad, mode == .regi else { return }
        if !force, let at = deviceSettingsFetchedAt, Date().timeIntervalSince(at) < 60 { return }
        deviceSettingsFetchedAt = Date()
        Task { @MainActor in
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "device")]
            guard let url = comps.url, let data = try? await NativeAPI.shared.send(URLRequest(url: url), kickPrint: false),
                  let res = try? JSONDecoder().decode(APIDeviceSetting.self, from: data), res.ok else { return }
            let admin = res.device?.nativePos
            adminNativePos = admin
            if let admin, admin != nativePosEnabled { setNativePos(admin) }
            applyAdminNetworkPrinters(lan: res.device?.lanPrinterIds, wifi: res.device?.wifiPrinterIds)
        }
    }

    /// 管理画面（設定 › レジ端末）で決めた LAN・Wi-Fi のプリンターを、この iPad の印刷の設定に入れる（nil の方は触らない）
    @MainActor private func applyAdminNetworkPrinters(lan: [String]?, wifi: [String]?) {
        adminLanManaged = lan != nil
        adminWifiManaged = wifi != nil
        let cur = NativePrintConfig.shared.config
        let nextLan = lan.map { Array($0.prefix(8)) }
        let nextWifi = wifi.map { Array($0.prefix(8)) }
        let lanChanged = nextLan.map { $0 != cur.lan } ?? false
        let wifiChanged = nextWifi.map { $0 != cur.printerIds } ?? false
        guard lanChanged || wifiChanged else { return }
        NativePrintConfig.shared.update { c in
            if let nextLan { c.lan = nextLan }
            if let nextWifi { c.printerIds = nextWifi }
        }
        syncPrintAgent()
    }

    /// ネイティブ ON/OFF（レジの設定）。OFF にしたらネイティブの画面を全部閉じて Web の画面をそのまま見せる。
    /// reloadWeb：ネイティブの設定画面から変えたとき true。OFF のあと Web の「レジの設定」を読み直し、Web 側のトグル表示を合わせる
    @MainActor func setNativePos(_ on: Bool, reloadWeb: Bool = false) {
        nativePosEnabled = on
        syncPrintAgent()
        // 次に読み込む Web の画面に渡す ON/OFF・印刷係の有無（ブリッジのスクリプト）も作り直す。
        // これが無いと、ネイティブの設定で OFF にしたあと Web を読み直すと古い print.native=true が入り、
        // Web の DirectPrintAgent が休んだまま（アプリの印刷係も止まっている）＝印刷されなくなる（2026-10-24 レビュー）
        WebViewController.current?.refreshBridgeScript()
        let onJs = on ? "true" : "false"
        let agentJs = nativePrintAgentOn ? "true" : "false"
        WebViewController.current?.runOnOwnPage(
            "if (window.TenpoNative) { if (window.TenpoNative.print) { window.TenpoNative.print.native = \(agentJs); } if (window.TenpoNative.nativePos) { window.TenpoNative.nativePos.enabled = \(onJs); } }"
        )
        if on {
            if let url = WebViewController.current?.currentURL { maybeOpenNativePos(for: url) }
        } else {
            nativeOrder = nil
            closeAllNative()
            if reloadWeb { WebViewController.current?.load(AppConfig.url("/app/pos/settings")) }
        }
    }

    /// 印刷係を設定に合わせて動かす・止める
    @MainActor func syncPrintAgent() {
        if nativePrintAgentOn { NativePrintAgent.shared.start() } else { NativePrintAgent.shared.stop() }
        // ネットが無いときに印刷するための印字キット・お店のプリンターの情報を、ネットのあるうちに保存しておく（レジの iPad だけ）
        if nativePrintAgentOn { NativePrintKit.shared.start() } else { NativePrintKit.shared.stop() }
    }

    /// /app/floor/<卓の id>/setup の卓の id（それ以外の道は nil）
    static func setupTableId(fromPath path: String) -> String? {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 4, parts[0] == "app", parts[1] == "floor", parts[3] == "setup" else { return nil }
        let id = parts[2]
        guard id.count == 36, id.allSatisfy({ $0.isHexDigit || $0 == "-" }) else { return nil }
        return id
    }

    /// ネイティブの画面を全部閉じる（Web の画面がそのまま見える）
    func closeAllNative() {
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false
        nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeSettingsPage = nil
        nativeBooking = false
        nativeModule = nil
    }

    /// 設定の中のネイティブの画面を開く（押した瞬間に出す。Web も同じ道にそろえる）
    func openSettingsPage(_ key: NativeSettingsPageKey, webPath: String) {
        closeAllNative()
        nativeSettingsPage = key
        WebViewController.current?.load(AppConfig.url(webPath))
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
        Task { @MainActor in self.syncPrintAgent() }
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
        nativeHandyHome = false
        nativeOwnerHome = false
        phoneHandy = nil
        mode = newMode
        webSession = UUID()
    }

    /// Web の「アプリのモードを変える」から
    func resetMode() {
        guard !AppConfig.isPad else { return } // iPad はレジのまま
        UserDefaults.standard.removeObject(forKey: modeKey)
        needsHandyLogin = false
        nativeHandyHome = false
        nativeOwnerHome = false
        phoneHandy = nil
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
                DispatchQueue.main.async { self.needsHandyLogin = true; self.nativeHandyHome = false; self.phoneHandy = nil }
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
        guard AppConfig.isOwnHost(url) else { return }
        if !AppConfig.isPad {
            maybeOpenNativePhone(for: url)
            return
        }
        // 管理画面（設定 › レジ端末）の ON/OFF に従う（ホーム・テーブル一覧を開くたび。OFF の端末も管理画面で ON にできる）
        if url.path == "/app/dashboard" || url.path == "/app/floor" || url.path == "/app" { Task { @MainActor in self.refreshDeviceSettings() } }
        guard mode == .regi, nativePosEnabled else { return }
        if url.path == "/app/dashboard" || url.path == "/app/floor" || url.path == "/app" {
            Task { @MainActor in NativeCatalogCache.shared.refresh() }
        }
        // 設定の中のネイティブの画面（品切れ・POS担当者・営業時間 …）。その道でなければ閉じる（ほかの画面に移ったとき）
        if let key = NativeSettingsPageKey.from(path: url.path) {
            closeAllNative()
            nativeSettingsPage = key
            return
        }
        if nativeSettingsPage != nil { nativeSettingsPage = nil }
        // まだ専用の台が無かった画面（勤怠・日報…）をネイティブで（NativeModuleRegistry に道があるもの。2026-10-24 22:05 Ronnie「全部ネイティブ」）
        if let route = NativeModuleRegistry.route(for: url) {
            closeAllNative()
            nativeModule = route
            return
        }
        if nativeModule != nil { nativeModule = nil }
        // テーブルの準備（来店登録。/app/floor/<卓>/setup）は、ネイティブのテーブル一覧の来店登録（NativeSetupSheet・Web と同じ並び）で開く。
        // Web は /app/floor にそろえる（goNativeFloor と同じ。レシート・ドロアの Web 側の仕組みはそのまま）
        if let tableId = Self.setupTableId(fromPath: url.path) {
            closeAllNative()
            floorSetupTableId = tableId
            nativeFloor = true
            DispatchQueue.main.async { WebViewController.current?.load(AppConfig.url("/app/floor")) }
            return
        }
        // 店舗ナウ（/app/now）はテーブル一覧（オーダー・会計）と同じ中身なので、iPad ではネイティブのテーブル一覧で。
        // メニュー一覧（/app/menu）・管理（/app/management）はネイティブのホームで
        if url.path == "/app/now" { closeAllNative(); nativeFloor = true; return }
        if url.path == "/app/menu" || url.path == "/app/management" { closeAllNative(); nativeHome = true; return }
        // 予約設定（/app/settings/booking）は上の NativeSettingsPageKey（.booking）で開く。店舗台帳の 📅 から開いた nativeBooking は閉じる
        nativeBooking = false
        // ホーム・テーブル一覧はネイティブで（Web の画面の上に重ねる。Native ON の iPad は Web のホーム・テーブル一覧を見せない）
        if url.path == "/app/dashboard" || url.path == "/app" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
            nativeLedger = false
            nativeCash = false
            nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
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
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; if !nativeFloor { nativeFloor = true }
            return
        }
        // 設定（レジの設定 /app/pos/settings・設定の入口 /app/settings・設定の一覧 /app/settings-all・プリンター・レジ端末）はネイティブで。
        // プリンター・レジ端末はネイティブの設定の「ハードウェア」（最初に開くページ）
        if url.path == "/app/pos/settings" || url.path == "/app/settings" || url.path == "/app/settings-all"
            || url.path == "/app/settings/printers" || url.path.hasPrefix("/app/settings/printers/") || url.path == "/app/settings/devices" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
            nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false
            nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false
            if !nativeSettings { nativeSettings = true }
            return
        }
        // 店舗台帳は全部の表示をネイティブで（1日・予約リスト・週間・グルメ別・キャンセル待ち・月間・受付管理・メッセージ。
        // 2026-10-24 22:05 Ronnie「iPad のオプションは全部ネイティブ」）。?open=<予約> はその予約の詳細を開く
        if url.path == "/app/reservations" || url.path == "/app/reservations/list" || url.path == "/app/reservations/calendar" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let view = url.path == "/app/reservations/list" ? "list" : url.path == "/app/reservations/calendar" ? "month" : q.first { $0.name == "view" }?.value
            ledgerView = view
            ledgerOpenId = q.first { $0.name == "open" }?.value
            do {
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
                nativeCash = false
                nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
                if !nativeLedger { nativeLedger = true }
                return
            }
        }
        if url.path == "/app/reports" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            reportsFrom = q.first { $0.name == "from" }?.value
            reportsTo = q.first { $0.name == "to" }?.value
            if !nativeReports { nativeReports = true }
            return
        }
        // スキャン（ScanSnap のまとめて取り込み #scan-bulk は Web のまま）
        if url.path == "/app/scan" && url.fragment != "scan-bulk" {
            let tx = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "tx" }?.value
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            scanTx = tx
            if !nativeScan { nativeScan = true }
            return
        }
        // 顧客の詳細（/app/customers/<id>。データ書き出し …/export は Web のまま）
        if url.path.hasPrefix("/app/customers/") {
            let id = String(url.path.dropFirst("/app/customers/".count))
            if id.count == 36, id.allSatisfy({ $0.isHexDigit || $0 == "-" }) {
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
                customersView = "list"
                customersOpenId = id
                if !nativeCustomers { nativeCustomers = true }
                return
            }
        }
        // 顧客台帳（一覧・RFM分析・重複候補 ?view=…）
        if url.path == "/app/customers" {
            let v = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "view" }?.value
            customersView = (v == "rfm" || v == "duplicates") ? v! : "list"
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeCustomers { nativeCustomers = true }
            return
        }
        if url.path == "/app/budgets/daily" || url.path == "/app/budgets" {
            budgetView = url.path == "/app/budgets" ? "monthly" : "daily"
            let m = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "month" }?.value
            budgetMonth = (m?.count == 7) ? m : nil
            nativeFloor = false; nativeNotices = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeBudget { nativeBudget = true }
            return
        }
        if url.path == "/app/notifications" || url.path == "/app/announcements" {
            noticesTab = url.path == "/app/announcements" ? "announcements" : "notifications"
            nativeFloor = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeNotices { nativeNotices = true }
            return
        }
        if url.path == "/app/coupons" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false
            if !nativeCoupons { nativeCoupons = true }
            return
        }
        // 仕入先・発注（一覧・作成・詳細）。CSV（/app/purchases/export）は Web のまま
        if url.path == "/app/vendors" || url.path == "/app/purchases" || url.path == "/app/purchases/new"
            || (url.path.hasPrefix("/app/purchases/") && url.path.count == "/app/purchases/".count + 36) {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false
            if url.path == "/app/vendors" {
                nativePurchases = false; nativeCoupons = false; nativeSettings = false
                if !nativeVendors { nativeVendors = true }
                return
            }
            if url.path == "/app/purchases" {
                purchasesRoute = .list
            } else if url.path == "/app/purchases/new" {
                let items = (q.first { $0.name == "items" }?.value ?? "").split(separator: ",").compactMap { pair -> NUInitialItem? in
                    let p = pair.split(separator: ":")
                    guard p.count == 2, let n = Double(p[1]), n > 0 else { return nil }
                    return NUInitialItem(id: String(p[0]), qty: n)
                }
                purchasesRoute = .new(item: q.first { $0.name == "item" }?.value, items: items)
            } else {
                purchasesRoute = .detail(String(url.path.dropFirst("/app/purchases/".count)))
            }
            nativeVendors = false; nativeCoupons = false; nativeSettings = false
            if !nativePurchases { nativePurchases = true }
            return
        }
        // 在庫（品目・棚卸・移動・発注提案・予測）と棚卸の入力。?tab=menu は在庫設定（本日の残り数）の画面
        if url.path == "/app/inventory" || url.path.hasPrefix("/app/inventory/counts/") {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let tab = q.first { $0.name == "tab" }?.value ?? "items"
            if url.path == "/app/inventory" && tab == "menu" {
                nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false
                if !nativeStock { nativeStock = true }
                return
            }
            if url.path.hasPrefix("/app/inventory/counts/") {
                let id = String(url.path.dropFirst("/app/inventory/counts/".count))
                inventoryCountId = id.count == 36 ? id : nil
                inventoryTab = "counts"
            } else {
                inventoryTab = ["items", "counts", "transfers", "reorder", "forecast"].contains(tab) ? tab : "items"
                inventoryCountId = nil
            }
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeInventory { nativeInventory = true }
            return
        }
        if url.path == "/app/inventory/menu-stock" {
            nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false
            if !nativeStock { nativeStock = true }
            return
        }
        if url.path == "/app/expenses" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeExpenses { nativeExpenses = true }
            return
        }
        // 伝票の詳細（/app/orders/<id>）は伝票明細のネイティブの詳細で開く（返金・再オープンは同じ画面にある）
        if url.path.hasPrefix("/app/orders/") {
            let id = String(url.path.dropFirst("/app/orders/".count))
            if id.count == 36, id.allSatisfy({ $0.isHexDigit || $0 == "-" }) {
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
                slipsOpenId = id
                if !nativeSlips { nativeSlips = true }
                return
            }
        }
        if url.path == "/app/orders" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeSlips { nativeSlips = true }
            return
        }
        if url.path == "/app/quick-pay" {
            nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
            if !nativeQuick { nativeQuick = true }
            return
        }
        if url.path == "/app/cash" {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let tab = q.first { $0.name == "tab" }?.value
            if tab == nil || tab == "register" || tab == "petty" || tab == "closings" {
                cashTab = tab ?? "register"
                nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
                if !nativeCashIo { nativeCashIo = true }
                return
            }
        }
        if url.path == "/app/cash/open" || url.path == "/app/cash/close" {
            nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
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
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
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

    /// iPhone：ハンディのテーブル一覧（/handy）とオーナー・店長のホーム（/app/dashboard）だけネイティブ。
    /// Web の画面の上に重ねる（裏の Web はそのまま動く＝予約・呼び出しのチャイム・通知は Web が出す）。ほかの画面へ行ったら閉じる
    func maybeOpenNativePhone(for url: URL) {
        guard nativePhoneEnabled else { return }
        let path = url.path
        switch mode {
        case .handy:
            nativeOwnerHome = false
            let on = path == "/handy" || path == "/handy/"
            if on { phoneRefreshTick += 1; if phoneHandy != nil { phoneHandy = nil } }
            if nativeHandyHome != on { nativeHandyHome = on }
            // Web がハンディの卓・注文の画面へ行ったら（お客様情報のあとなど）ネイティブで重ねる
            if let r = Self.phoneHandyRoute(for: url) { phoneHandy = r }
        case .owner:
            nativeHandyHome = false
            let on = path == "/app/dashboard" || path == "/app" || path == "/app/"
            if on { phoneRefreshTick += 1 }
            if nativeOwnerHome != on { nativeOwnerHome = on }
        default:
            nativeHandyHome = false
            nativeOwnerHome = false
        }
    }

    /// /handy/<卓> → 卓、/handy/<卓>/order?order=<伝票> → 注文（ネイティブで出す道）。それ以外は nil
    static func phoneHandyRoute(for url: URL) -> PhoneHandyRoute? {
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[0] == "handy" else { return nil }
        let id = parts[1]
        guard id.count == 36, id.allSatisfy({ $0.isHexDigit || $0 == "-" }) else { return nil }
        if parts.count == 2 { return PhoneHandyRoute(tableId: id, orderId: nil) }
        if parts.count == 3, parts[2] == "order" {
            let order = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "order" }?.value
            guard let order, order.count == 36 else { return PhoneHandyRoute(tableId: id, orderId: nil) }
            return PhoneHandyRoute(tableId: id, orderId: order)
        }
        return nil
    }

    /// iPhone ハンディの卓をネイティブで開く
    func openPhoneHandy(tableId: String, orderId: String? = nil) {
        guard nativePhoneEnabled else {
            WebViewController.current?.load(AppConfig.url("/handy/\(tableId)"))
            return
        }
        phoneHandy = PhoneHandyRoute(tableId: tableId, orderId: orderId)
    }

    /// iPhone ハンディの卓・注文を閉じてテーブル一覧へ（裏の Web が卓・注文の画面なら /handy に戻す）
    func closePhoneHandy() {
        phoneHandy = nil
        let path = WebViewController.current?.currentURL?.path ?? ""
        if path == "/handy" || path == "/handy/" {
            nativeHandyHome = true
            phoneRefreshTick += 1
        } else {
            nativeHandyHome = true
            WebViewController.current?.load(AppConfig.url("/handy"))
        }
    }

    /// iPhone のネイティブの画面を閉じて Web の画面へ（卓の画面・店舗台帳・設定など）
    func leaveNativePhone(to path: String) {
        // 卓・注文の画面はネイティブで（2026-10-25）
        if mode == .handy, nativePhoneEnabled, let url = URL(string: path, relativeTo: AppConfig.url("/")), let r = Self.phoneHandyRoute(for: url.absoluteURL) {
            phoneHandy = r
            return
        }
        phoneHandy = nil
        nativeHandyHome = false
        nativeOwnerHome = false
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// iPhone：読めなかったときは Web の画面をそのまま見せる（ログイン・回線の案内は Web が出す）
    func fallbackPhoneToWeb() {
        nativeHandyHome = false
        nativeOwnerHome = false
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
        nativeModule = nil
        recentlyClosed = nil
        webChosenOrders.remove(orderId)
        nativeOrder = NativeOrderRef(id: orderId, checkout: checkout)
    }

    /// ネイティブの画面を閉じて Web の画面へ（店舗台帳・設定など、まだネイティブに無い画面）
    func leaveNativeFloor(to path: String) {
        nativeModule = nil
        nativeBooking = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// ネイティブの設定へ（Web も /app/pos/settings にそろえる）
    func goNativeSettings() {
        nativeModule = nil
        closeAllNative()
        nativeSettings = true
        WebViewController.current?.load(AppConfig.url("/app/pos/settings"))
    }

    /// ネイティブの店舗台帳へ（Web も /app/reservations にそろえる）
    func goNativeLedger() {
        nativeModule = nil
        nativeBooking = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeLedger = true
        WebViewController.current?.load(AppConfig.url("/app/reservations"))
    }

    /// ネイティブのフロアからホームへ（ネイティブのホームを出す。Web も /app/dashboard にそろえる）
    func goNativeHome() {
        nativeModule = nil
        nativeBooking = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeLedger = false
        nativeCash = false
        nativeHome = true
        WebViewController.current?.load(AppConfig.url("/app/dashboard"))
    }

    /// ネイティブのホームからフロアへ（Web も /app/floor にそろえる＝レシート・ドロアの Web 側の仕組みはそのまま）
    func goNativeFloor() {
        nativeModule = nil
        nativeBooking = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeLedger = false
        nativeCash = false
        nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeFloor = true
        WebViewController.current?.load(AppConfig.url("/app/floor"))
    }

    /// ネイティブのレジ開局・レジクローズへ（Web も同じ画面にそろえる）
    func goNativeCash(_ path: String) {
        nativeModule = nil
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = true
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// ネイティブの在庫設定へ
    func goNativeNotices(tab: String = "notifications") {
        nativeModule = nil
        noticesTab = tab
        nativeFloor = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeNotices = true
        WebViewController.current?.load(AppConfig.url(tab == "announcements" ? "/app/announcements" : "/app/notifications"))
    }

    func goNativeCustomers() {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeCustomers = true
        WebViewController.current?.load(AppConfig.url("/app/customers"))
    }

    func goNativeBudget() {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        budgetView = "daily"
        budgetMonth = nil
        nativeBudget = true
        WebViewController.current?.load(AppConfig.url("/app/budgets/daily"))
    }

    /// 予算の画面の中で、予算管理と日別予算登録を切り替える（Web も同じ場所にそろえる）
    func switchBudgetView(_ view: String, month: String?) {
        budgetView = view
        budgetMonth = month
        let path = view == "monthly" ? "/app/budgets" : "/app/budgets/daily"
        WebViewController.current?.load(AppConfig.url(month.map { "\(path)?month=\($0)" } ?? path))
    }

    func goNativeStock() {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeStock = true
        WebViewController.current?.load(AppConfig.url("/app/inventory/menu-stock"))
    }

    /// ネイティブの発注へ（Web も同じ場所にそろえる）
    func goNativePurchases(_ route: NUPurchasesRoute = .list) {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false
        purchasesRoute = route
        nativeCoupons = false; nativeSettings = false
        nativePurchases = true
        let path: String
        switch route {
        case .list: path = "/app/purchases"
        case .new: path = "/app/purchases/new"
        case .detail(let id): path = "/app/purchases/\(id)"
        }
        WebViewController.current?.load(AppConfig.url(path))
    }

    /// ネイティブの在庫へ（Web も /app/inventory にそろえる）
    func goNativeInventory(tab: String = "items") {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false
        inventoryTab = tab
        inventoryCountId = nil
        nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeInventory = true
        WebViewController.current?.load(AppConfig.url("/app/inventory?tab=\(tab)"))
    }

    /// ネイティブの仕入・経費へ
    func goNativeExpenses() {
        nativeModule = nil
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
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
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeQuick = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeSlips = true
        WebViewController.current?.load(AppConfig.url("/app/orders"))
    }

    /// ネイティブの即会計へ
    func goNativeQuick() {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeCashIo = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeQuick = true
        WebViewController.current?.load(AppConfig.url("/app/quick-pay"))
    }

    /// ネイティブの入出金へ
    func goNativeCashIo(tab: String = "register") {
        nativeModule = nil
        cashTab = tab
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false
        nativeLedger = false
        nativeCash = false
        nativeQuick = false
        nativeSlips = false
        nativeExpenses = false
        nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false; nativeCoupons = false; nativeSettings = false
        nativeCashIo = true
        WebViewController.current?.load(AppConfig.url(tab == "register" ? "/app/cash" : "/app/cash?tab=\(tab)"))
    }

    /// ネイティブの予約設定へ（店舗台帳の 📅「台帳設定」。Web も /app/settings/booking にそろえる）
    func goNativeBooking() {
        nativeModule = nil
        nativeFloor = false; nativeNotices = false; nativeBudget = false; nativeCustomers = false; nativeScan = false; nativeReports = false
        nativeHome = false; nativeLedger = false; nativeCash = false; nativeCashIo = false; nativeQuick = false; nativeSlips = false; nativeExpenses = false; nativeStock = false; nativeInventory = false; nativeVendors = false; nativePurchases = false
        nativeBooking = true
        WebViewController.current?.load(AppConfig.url("/app/settings/booking"))
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
