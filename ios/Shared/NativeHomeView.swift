import SwiftUI

// ネイティブのホーム（iPad レジ）。Web のレジのホーム（components/dashboard/regi-home.tsx）と同じ並び：
//   上＝大きい2つ（オーダー・会計／店舗台帳）／左＝操作の列／中＝達成率の輪・実績売上／下＝日付・時計・気温・来店の数
// 2026-10-24 Ronnie「ブラウザの仕組みが要らないくらい全部ネイティブに」

struct NHNamed: Codable, Hashable { let href: String; let label: String; let en: String }
struct NHTool: Codable, Identifiable, Hashable {
    let href: String
    let label: String
    let en: String
    let icon: String
    let action: String?
    let badge: Int?
    var id: String { href }
}
struct NHSales: Codable {
    let actual: Int
    let avgSpend: Int
    let budget: Int?
    let pct: Int?
    let ringPct: Double
    let asOf: String
    let date: String
    let dayLabel: String
    let heading: String?
    let note: String?
    let canAnalytics: Bool
}
struct NHKpis: Codable {
    let groups: Int
    let groupsYesterday: Int
    let guests: Int
    let guestsYesterday: Int
    let repeaters: Int?
    let walkIns: Int
}
struct NHWeather: Codable {
    let temperature: Double?
    let place: String?
    /// sun / partly / cloud / fog / drizzle / rain / snow / thunder（古いサーバーは無い）
    let icon: String?
    /// 昼か夜か（晴れの夜は月）
    let isDay: Bool?

    /// 天気のアイコン（SF Symbols。Web の RegiWeatherGlyph と同じ種類。2026-10-24 Ronnie「15° と天気のアイコンを出して」）
    var symbol: String? {
        let night = isDay == false
        switch icon {
        case "sun": return night ? "moon.fill" : "sun.max.fill"
        case "partly": return night ? "cloud.moon.fill" : "cloud.sun.fill"
        case "cloud": return "cloud.fill"
        case "fog": return "cloud.fog.fill"
        case "drizzle": return "cloud.drizzle.fill"
        case "rain": return "cloud.rain.fill"
        case "snow": return "cloud.snow.fill"
        case "thunder": return "cloud.bolt.rain.fill"
        default: return nil
        }
    }
}

struct NHPayload: Codable {
    let store: NFNamed
    let serverNow: Double
    let today: String
    let needsOpenRegister: Bool
    let bigTiles: [NHNamed]
    let tools: [NHTool]
    let sales: NHSales
    let kpis: NHKpis
    let weather: NHWeather
    let noticeCount: Int
}

@MainActor
final class NativeHomeModel: ObservableObject {
    @Published var payload: NHPayload?
    @Published var error: String?
    @Published var now = Date()
    @Published var busy = false
    @Published var toast: String?
    private var offset: TimeInterval = 0
    private var clock: Timer?
    private var refresher: Timer?
    /// 見本（-tenpoNativePreview home。App Store の画面写真用）：読み込まない・時計を止める。お店では false のまま
    var isPreview = false

    func start() {
        if isPreview { return }
        clock?.invalidate()
        clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.now = Date().addingTimeInterval(self.offset)
            }
        }
        refresher?.invalidate()
        refresher = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        // 保存してあるホームを先に出す（押した瞬間に出る。裏で読み直す）
        if payload == nil, let data = NativeDiskCache.load("home"), let saved = try? JSONDecoder().decode(NHPayload.self, from: data) {
            payload = saved
        }
        Task { await refresh() }
    }

    func stop() {
        clock?.invalidate(); clock = nil
        refresher?.invalidate(); refresher = nil
    }

    func refresh() async {
        if isPreview { return }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "home")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NHPayload.self, from: data)
            // 次に開くとき先に出す・ネットが無いときもこれで出す
            NativeDiskCache.save(data, key: "home")
            offset = p.serverNow / 1000 - Date().timeIntervalSince1970
            now = Date().addingTimeInterval(offset)
            payload = p
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    func openDrawer() async {
        guard let storeId = payload?.store.id else { return }
        busy = true
        defer { busy = false }
        if let r = try? await NativeAPI.shared.floorAct(["type": "floorDrawer", "storeId": storeId]) {
            toast = r.ok ? "ドロアを開けます" : (r.error ?? "ドロアを開けられませんでした")
        } else {
            toast = "ドロアを開けられませんでした"
        }
    }
}

struct NativeHomeView: View {
    @ObservedObject var model: NativeHomeModel
    /// Web の画面を開く（まだネイティブに無いもの）
    var onWeb: (String) -> Void = { _ in }
    var onFloor: () -> Void = {}
    /// ハンディQR をネイティブで大きく出す（2026-10-24）
    @State private var handyQrOpen = false
    // テーブルのお客様QR（印刷・再発行）は 設定 の中から（2026-10-24 19:01 Ronnie。前はホームの上のボタン）

    private static let blue = Color(hex: 0x1A5AD6)
    private static let blueDeep = Color(hex: 0x0A3FA8)
    private static let terracotta = Color(hex: 0xBC5940)
    private static let tileBg = Color(hex: 0xF2F2F5)

    // 左のメニューの色（2026-10-27 01:27 Ronnie の見本：濃い紫紺の地・黄色の「ホーム」・TENPO ONE の黄色い字）
    private static let sideBg = Color(hex: 0x37324D)
    private static let sideItem = Color(hex: 0x433E5B)
    private static let sideText = Color(hex: 0xEDEBF5)
    private static let sideSub = Color(hex: 0xA9A4BE)
    private static let sideActive = Color(hex: 0xF2D06B)
    private static let sideActiveText = Color(hex: 0x2B2740)
    // 右の箱（白・細い枠・灰色の線のアイコン）
    private static let pageBg = Color(hex: 0xF6F7F9)
    private static let tileLine = Color(hex: 0xE2E2EA)
    private static let tileText = Color(hex: 0x403C55)

    /// 左のメニューに出す道具（即会計・入出金・ドロア）と、いちばん下の 設定
    private static let sideTools = ["/app/quick-pay", "/app/cash", "#drawer"]
    private static let settingsHref = "/app/settings"
    /// 右の箱の並び（見本の順。ここに無い道具は後ろに足す）
    private static let gridOrder = ["/app/orders", "#handyqr", "/app/cash/close", "/app/expenses", "#analytics", "#budget"]

    private var tools: [NHTool] { model.payload?.tools ?? [] }
    private var bigTiles: [NHNamed] {
        model.payload?.bigTiles ?? [NHNamed(href: "/app/floor", label: "注文・会計", en: "Order & Pay"), NHNamed(href: "/app/reservations", label: "店舗台帳", en: "Reservation")]
    }

    var body: some View {
        GeometryReader { root in
            // 横（1000pt 以上）は左にメニュー・右にホーム。縦は上から順に並べてスクロール
            if root.size.width >= 1000 {
                HStack(spacing: 0) {
                    sidebar.frame(width: 128)
                    VStack(spacing: 0) {
                        topBar
                        // 箱のあいだは同じだけ空ける（画面が大きい iPad でも下に寄って空かない）
                        VStack(spacing: 14) {
                            bigTileRow
                            summaryCard
                            kpiRow(columns: 4)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 18)
                        .padding(.bottom, 14)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Self.pageBg)
                    }
                }
            } else {
                VStack(spacing: 0) {
                    topBar
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 18) {
                            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                                ForEach(navItems, id: \.key) { n in navTile(n, tall: false) }
                                if let st = tools.first(where: { $0.href == Self.settingsHref }) { navTile(navItem(st), tall: false) }
                            }
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Self.sideBg))
                            tileGrid(columns: 3)
                            salesCard(narrow: true)
                            clockRow
                            kpiRow(columns: 2)
                        }
                        .padding(.horizontal, 18)
                        .padding(.top, 18)
                        .padding(.bottom, 24)
                    }
                    .background(Self.pageBg)
                }
            }
        }
        .background(Self.sideBg.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NFColor.navy.opacity(0.92)))
                    .padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .overlay {
            if model.payload == nil {
                ZStack {
                    Color.white.opacity(0.9).ignoresSafeArea()
                    if let e = model.error {
                        VStack(spacing: 12) {
                            Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                            Button("もう一度") { Task { await model.refresh() } }.font(.system(size: 15, weight: .bold))
                        }
                    } else {
                        ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(Self.blue)
                    }
                }
            }
        }
        .sheet(isPresented: $handyQrOpen) {
            NativeHandyQrSheet(onClose: { handyQrOpen = false }, onWeb: { path in handyQrOpen = false; onWeb(path) })
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: 上のバー（お知らせ・店名）

    private var topBar: some View {
        VStack(spacing: 0) {
            // 時計・電波・電池の行（白い字）は左のメニューと同じ濃い色の細い帯（2026-10-27 02:36 Ronnie「mathi ko bar color thikai xa vayo do not change」）
            Self.sideBg.frame(height: 20)
            // 上のバーは本文と同じ色（2026-10-27 01:58 Ronnie「top ko bar ma yo color hudaina hai left patti matrai hunxa top ko bar body color jastai hunxa」）
            HStack(spacing: 10) {
                // 「ホーム」の字は出さない（ここがホーム。2026-10-24 19:01 Ronnie）
                Spacer()
                // お知らせのベルは出さない。お知らせ（仕入・経費）は「仕入・経費」の箱の赤い数字で（無いときは何も出ない）
                // （2026-10-27 02:34 Ronnie「top ma vayeko ring bell 仕入・経費 ko vayeko hunale notify aauda tei button ma dekhine banau」）
                // 店名はログアウトの横（2026-10-24 19:03 Ronnie）。ハンディQR は右の箱へ（2026-10-27 の見本）
                HStack(spacing: 6) {
                    Image(systemName: "storefront")
                    Text(model.payload?.store.name ?? "").lineLimit(1)
                }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(Self.tileText)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Color.white))
                .overlay(Capsule().stroke(Self.tileLine, lineWidth: 1))
            }
            .padding(.horizontal, 20)
            .frame(height: 52)
            .background(Self.pageBg)
        }
    }

    // MARK: 左のメニュー（ホーム・オーダー・会計・店舗台帳・即会計・入出金・ドロア／いちばん下に 設定）
    // 2026-10-27 01:27 Ronnie「start ma home ko left menu bar lai yesto banau … language change nagara just design matrai ra color」
    // 「word haru add garne yeta uti nagara」：字は今のまま（日本語・英語）。形と色だけ見本に合わせる

    private struct NavItem {
        let key: String
        /// "home" / "floor" / "ledger" / 道具の href（アイコンと色は toolIcon）
        let icon: String
        let label: String
        let en: String
        var active = false
        var badge: Int? = nil
        /// 指定があればこの SF Symbol（左のメニューに足した 伝票明細 など）
        var symbol: String? = nil
        let action: () -> Void
    }

    private var navItems: [NavItem] {
        var out: [NavItem] = [NavItem(key: "home", icon: "home", label: "ホーム", en: "Home", active: true, action: {})]
        for t in bigTiles {
            let isFloor = t.href == "/app/floor"
            out.append(NavItem(key: t.href, icon: isFloor ? "floor" : "ledger", label: t.label, en: t.en, action: { isFloor ? onFloor() : onWeb(t.href) }))
        }
        for href in Self.sideTools {
            if let t = tools.first(where: { $0.href == href }) { out.append(navItem(t)) }
        }
        return out
    }

    private func navItem(_ t: NHTool) -> NavItem {
        NavItem(key: t.href, icon: t.href, label: t.label, en: t.en, badge: t.badge, action: { toolTap(t) })
    }

    /// 左のメニューのアイコンは「ホーム」と同じ線のアイコンで、字と同じ色（地に合わせる。白い四角・色は付けない）。
    /// 形は今までのまま（2026-10-27 01:46 Ronnie「clip sign haruko color home button ko jasto background sanga milne … setting ko alali vayeko chhaina」）
    private func navIcon(_ n: NavItem, size: CGFloat) -> AnyView {
        let sym: String
        // 注文・会計 は箱と同じ、画面の中に 4 つの四角があるモニター（2026-10-29 01:14 Ronnie）
        if n.icon == "floor" { return AnyView(MonitorLogo(size: size * 0.8, color: n.active ? Self.sideActiveText : Self.sideText, line: 1.3).frame(width: size, height: size)) }
        if let own = n.symbol { return AnyView(Image(systemName: own).font(.system(size: size * 0.62, weight: .regular)).frame(width: size, height: size)) }
        switch n.icon {
        case "home": sym = "house"
        case "floor": sym = "desktopcomputer"
        case "ledger": sym = "calendar"
        default: sym = Self.toolIcon(n.icon).0
        }
        return AnyView(Image(systemName: sym).font(.system(size: size * 0.62, weight: .regular)).frame(width: size, height: size))
    }

    private var sidebar: some View {
        VStack(spacing: 10) {
            VStack(spacing: 6) {
                Text("TENPO ONE").font(.system(size: 17, weight: NT.strong)).foregroundColor(Self.sideActive).lineLimit(1).minimumScaleFactor(0.8)
                Text("POS × RESERVE").font(.system(size: 9, weight: .semibold)).tracking(1.0).foregroundColor(Self.sideSub).lineLimit(1).minimumScaleFactor(0.8)
            }
            // 上は時計・電波の行の下から
            .padding(.top, 30).padding(.bottom, 12)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.10)).frame(height: 1) }
            .padding(.bottom, 6)
            // 全部の選択肢を左のメニューに（2026-10-28 22:04 Ronnie「option sabai left mai rakha」）
            ScrollView(showsIndicators: false) {
                VStack(spacing: 4) {
                    ForEach(Array(sidebarItems.enumerated()), id: \.element.key) { i, n in
                        if i == 1 + Self.sideTools.count { Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1).padding(.horizontal, 14).padding(.vertical, 4) }
                        navCompact(n)
                    }
                }
            }
            Spacer(minLength: 0)
            if let st = tools.first(where: { $0.href == Self.settingsHref }) { navCompact(navItem(st)) }
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 14)
        .frame(maxHeight: .infinity)
        .background(Self.sideBg)
    }

    /// 左のメニューの全部：ホーム・注文・会計・店舗台帳・即会計・入出金・ドロア ＋ 伝票明細・ハンディQR・レジクローズ・仕入・経費・店舗分析・予算登録
    private var sidebarItems: [NavItem] {
        // 注文・会計 と 店舗台帳 は大きい箱が本体にあるので、左のメニューには入れない（2026-10-29 01:24 Ronnie「Menu bar ma kina chaiyo ra」）
        let bigKeys = Set(bigTiles.map { $0.href })
        var out = navItems.filter { !bigKeys.contains($0.key) }
        for g in gridTiles {
            out.append(NavItem(key: "g" + g.key, icon: g.key, label: g.label, en: g.en, badge: g.badge, symbol: g.icon, action: g.action))
        }
        return out
    }

    private func navCompact(_ n: NavItem) -> some View {
        let fg = n.active ? Self.sideActiveText : Self.sideText
        let sub = n.active ? Self.sideActiveText.opacity(0.7) : Self.sideSub
        return Button(action: n.action) {
            VStack(spacing: 2) {
                navIcon(n, size: 22)
                Text(n.label).font(.system(size: 11, weight: .regular)).lineLimit(1).minimumScaleFactor(0.6)
                Text(n.en).font(.system(size: 8, weight: .regular)).foregroundColor(sub).lineLimit(1).minimumScaleFactor(0.6)
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity).frame(height: 54)
            .foregroundColor(fg)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(n.active ? Self.sideActive : Color.clear))
            .overlay(alignment: .topTrailing) {
                if let b = n.badge, b > 0 {
                    Text("\(b)").font(.system(size: 10, weight: .regular)).foregroundColor(.white)
                        .frame(minWidth: 16).padding(.horizontal, 3).frame(height: 16)
                        .background(Capsule().fill(Color(hex: 0xE53935)))
                        .offset(x: -2, y: 2)
                }
            }
        }
        .buttonStyle(LiveTapStyle(scale: 0.94))
        .disabled(model.busy && n.key == "#drawer")
    }

    // MARK: 注文・会計 と 店舗台帳 の大きい白い箱（2026-10-28 22:04 Ronnie の最終見本）

    private var bigTileRow: some View {
        HStack(spacing: 14) {
            ForEach(Array(bigTiles.enumerated()), id: \.element.href) { _, t in
                let isFloor = t.href == "/app/floor"
                Button(action: { isFloor ? onFloor() : onWeb(t.href) }) {
                    VStack(alignment: .center, spacing: 14) {
                        if isFloor {
                            MonitorLogo(size: 62, color: Self.sideBg, line: 1.6)
                        } else {
                            Image(systemName: "calendar").font(.system(size: 56, weight: .ultraLight)).foregroundColor(Self.sideBg)
                        }
                        VStack(spacing: 6) {
                            Text(t.label).font(.system(size: 36, weight: .light)).tracking(1.5).foregroundColor(Self.tileText).lineLimit(1).minimumScaleFactor(0.6)
                            Text(t.en).font(.system(size: 13, weight: .regular)).tracking(1.5).foregroundColor(Self.inkSub)
                        }
                    }
                    .padding(.horizontal, 28).padding(.vertical, 26)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    // 少し色を付ける（2026-10-29 01:23 Ronnie「alli color chamkilo」）注文・会計＝うすい紫、店舗台帳＝うすい黄色
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(isFloor ? Color(hex: 0xEAE6F7) : Color(hex: 0xFFF3CC)))
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(isFloor ? Color(hex: 0xCFC7EA) : Color(hex: 0xF2D06B), lineWidth: 1.5))
                }
                .buttonStyle(LiveTapStyle(scale: 0.97))
            }
        }
        .frame(maxHeight: .infinity)
    }

    // MARK: 実績売上・達成率・日付と時計を 1 つの白い箱に

    private var summaryCard: some View {
        let s = model.payload?.sales
        return card {
            HStack(alignment: .center, spacing: 28) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("実績売上高").font(.system(size: 15, weight: .regular)).foregroundColor(Self.inkSub)
                        Text("Sales").font(.system(size: 12)).foregroundColor(Self.inkSub)
                    }
                    Text(NT.yen(s?.actual ?? 0)).font(.system(size: 46, weight: .light)).monospacedDigit().foregroundColor(Self.ink)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    HStack(alignment: .top, spacing: 32) {
                        VStack(alignment: .leading, spacing: 2) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("予算売上高").font(.system(size: 13, weight: .regular))
                                Text("Target").font(.system(size: 11))
                            }
                            .foregroundColor(Self.inkSub)
                            Text(s?.budget.map { NT.yen($0) } ?? "—").font(.system(size: 20, weight: .light)).monospacedDigit().foregroundColor(Self.ink)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("客単価").font(.system(size: 13, weight: .regular)).foregroundColor(Self.inkSub)
                            Text(NT.yen(s?.avgSpend ?? 0)).font(.system(size: 20, weight: .light)).monospacedDigit().foregroundColor(Self.ink)
                        }
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise").font(.system(size: 10))
                        Text(s?.asOf ?? "").font(.system(size: 11))
                        if let n = s?.note { Text(n).font(.system(size: 11)) }
                    }
                    .foregroundColor(Self.inkSub)
                }
                ring(s, size: 124)
                Spacer(minLength: 0)
                Rectangle().fill(Self.cardLine).frame(width: 1, height: 110)
                VStack(alignment: .leading, spacing: 4) {
                    Text(Self.dateFmt.string(from: model.now)).font(.system(size: 14, weight: .regular)).foregroundColor(Self.inkSub)
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text(Self.hmFmt.string(from: model.now)).font(.system(size: 46, weight: .light)).monospacedDigit()
                        Text(Self.ssFmt.string(from: model.now)).font(.system(size: 16, weight: .light)).monospacedDigit().opacity(0.5)
                    }
                    .foregroundColor(Self.ink)
                    HStack(spacing: 8) {
                        if let t = model.payload?.weather.temperature {
                            if let sym = model.payload?.weather.symbol { Image(systemName: sym).font(.system(size: 18, weight: .regular)) }
                            Text("\(Int(t.rounded()))°").font(.system(size: 18, weight: .regular))
                        }
                        if let p = model.payload?.weather.place { Text(p).font(.system(size: 13, weight: .regular)).lineLimit(1) }
                    }
                    .foregroundColor(Self.inkSub)
                }
                .frame(minWidth: 220, alignment: .leading)
            }
            .padding(.horizontal, 32).padding(.vertical, 18)
        }
        .frame(height: 190)
    }

    private func navTile(_ n: NavItem, tall: Bool) -> some View {
        let fg = n.active ? Self.sideActiveText : Self.sideText
        let sub = n.active ? Self.sideActiveText.opacity(0.7) : Self.sideSub
        return Button(action: n.action) {
            // アイコンは真ん中、字はその下（どれも同じ形）。メニューは細く
            // （2026-10-27 02:17 Ronnie「clip lai bich ma 文字 lai tala banayera menu bar lai ajai slim banau」）
            VStack(spacing: 4) {
                navIcon(n, size: 30)
                Text(n.label).font(.system(size: 14, weight: .bold)).lineLimit(1).minimumScaleFactor(0.65)
                Text(n.en).font(.system(size: 9, weight: .medium)).foregroundColor(sub).lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity).frame(height: 84)
            .foregroundColor(fg)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(n.active ? Self.sideActive : Self.sideItem))
            .overlay(alignment: .topTrailing) {
                if let b = n.badge, b > 0 {
                    Text("\(b)").font(.system(size: 12, weight: NT.strong)).foregroundColor(.white)
                        .frame(minWidth: 22).padding(.horizontal, 5).frame(height: 22)
                        .background(Capsule().fill(Color(hex: 0xE53935)))
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.97))
        .disabled(model.busy && n.key == "#drawer")
    }

    /// 道具のアイコンと色（今までのホームと同じ。2026-10-27 01:33 Ronnie「clip sign haru pani change nagara ani clip ko color pani change nagara」）
    private static func toolIcon(_ href: String) -> (String, Color) {
        switch href {
        case "/app/quick-pay": return ("yensign.circle", Color(hex: 0x1E8F62))
        case "/app/orders": return ("doc.text", Color(hex: 0x5C5650))
        case "/app/cash": return ("arrow.up.arrow.down", Color(hex: 0x1E8F62))
        case "/app/expenses": return ("cart", Color(hex: 0x1A5AD6))
        case "#drawer": return ("tray", Color(hex: 0x0F8A8A))
        case "/app/cash/close": return ("lock", Color(hex: 0x5C5650))
        case "/app/inventory": return ("shippingbox", Color(hex: 0x8A6100))
        case "/app/settings": return ("slider.horizontal.3", Color(hex: 0x5C5650))
        default: return ("square.grid.2x2", Color(hex: 0x5C5650))
        }
    }

    private func toolTap(_ t: NHTool) {
        if t.action == "drawer" { Task { await model.openDrawer() } } else { onWeb(t.href) }
    }

    // MARK: 右の箱（伝票明細・ハンディQR・レジクローズ・仕入・経費・店舗分析・予算登録／ほかの道具は後ろに）

    private struct GridTile {
        let key: String
        let icon: String
        var color = Color(hex: 0x77738A)
        let label: String
        let en: String
        var badge: Int? = nil
        var alert = false
        let action: () -> Void
    }

    private var gridTiles: [GridTile] {
        let s = model.payload?.sales
        var byKey: [String: GridTile] = [:]
        // 在庫設定は「メニュー在庫管理」として 注文・会計 の上のバーへ（2026-10-27 01:45 Ronnie）
        for t in tools where !Self.sideTools.contains(t.href) && t.href != Self.settingsHref && t.href != "/app/inventory" {
            // 道具・数字の印の色は付けない（2026-10-27 10:12 Ronnie「clip haru ko color ni same vanau color なし」）
            let (sym, _) = Self.toolIcon(t.href)
            // 仕入・経費 は前の上のベルのお知らせの数も（多いほう）
            let badge = t.href == "/app/expenses" ? max(t.badge ?? 0, model.payload?.noticeCount ?? 0) : t.badge
            byKey[t.href] = GridTile(key: t.href, icon: sym, color: Self.tileText, label: t.label, en: t.en, badge: badge, action: { toolTap(t) })
        }
        // ハンディQR は今までの上のバーと同じ qrcode（紺）
        byKey["#handyqr"] = GridTile(key: "#handyqr", icon: "qrcode", color: NFColor.navy, label: "ハンディQR", en: "Handy QR", action: { handyQrOpen = true })
        if s?.canAnalytics ?? false {
            byKey["#analytics"] = GridTile(key: "#analytics", icon: "chart.line.uptrend.xyaxis", label: "店舗分析", en: "Analytics", action: { onWeb("/app/reports") })
        }
        // 予算が未設定のときは右上に赤い丸の「!」（文字は書かない。2026-10-24 Ronnie）
        byKey["#budget"] = GridTile(key: "#budget", icon: "target", label: "予算登録", en: "Set budget", alert: s != nil && s?.budget == nil, action: { onWeb("/app/budgets/daily") })
        var out = Self.gridOrder.compactMap { byKey.removeValue(forKey: $0) }
        // 見本に無い道具（在庫設定など）は後ろに、サーバーの順で
        for t in tools { if let g = byKey.removeValue(forKey: t.href) { out.append(g) } }
        return out
    }

    private func tileGrid(columns: Int) -> some View {
        let tiles = gridTiles
        // 見本は 3 列・6 つ。在庫設定なども出る店（7 つ以上）は 4 列にして 2 段に収める
        let cols = columns == 3 && tiles.count > 6 ? 4 : columns
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: cols), spacing: 14) {
            ForEach(tiles, id: \.key) { g in
                Button(action: g.action) {
                    VStack(spacing: 6) {
                        Image(systemName: g.icon).font(.system(size: 24, weight: .semibold)).foregroundColor(g.color)
                        VStack(spacing: 0) {
                            Text(g.label).font(.system(size: 16, weight: .semibold)).foregroundColor(Self.tileText).lineLimit(1).minimumScaleFactor(0.7)
                            Text(g.en).font(.system(size: 10, weight: .medium)).foregroundColor(NFColor.ink3).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity).frame(height: 92)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Self.tileLine, lineWidth: 1))
                    .overlay(alignment: .topTrailing) {
                        if let b = g.badge, b > 0 {
                            Text("\(b)").font(.system(size: 13, weight: NT.strong)).foregroundColor(.white)
                                .frame(minWidth: 26).padding(.horizontal, 6).frame(height: 26)
                                .background(Capsule().fill(Color(hex: 0xE53935)))
                                .padding(8)
                        } else if g.alert {
                            Text("!").font(.system(size: 14, weight: NT.strong)).foregroundColor(.white)
                                .frame(width: 24, height: 24)
                                .background(Circle().fill(NFColor.danger))
                                .overlay(Circle().stroke(Color.white, lineWidth: 2))
                                .padding(8)
                        }
                    }
                }
                .buttonStyle(PressableStyle(scale: 0.98))
            }
        }
    }

    // MARK: 中：実績売上・予算・客単価（白い箱）＋右に達成率の輪
    // 2026-10-27 01:32 Ronnie の見本：「layout change hai color pani simple banau yesari but word haru add nagara」
    // 字は今のまま（実績売上高・Sales・客単価・予算売上高・Target・本日の達成率・Budget・更新の時刻）。色は黒・灰色だけ
    // 数字は太すぎない（semibold・medium。01:49 Ronnie「numbers haru dherai bold vayo さわやか banaune ho k alli」）

    private static let ink = Color(hex: 0x1F2329)
    private static let inkSub = Color(hex: 0x6B7280)
    private static let cardLine = Color(hex: 0xE3E5EA)
    /// 達成率の輪は左のメニューの地と同じ紫紺（2026-10-27 01:42 Ronnie「round ko color menu bar ko background color jasto banau」）
    private static let ringColor = Color(hex: 0x37324D)
    private static let ringTrack = Color(hex: 0xECEEF2)
    private static let clockBg = Color(hex: 0xEEF1F6)

    private func card<Content: View>(fill: Color = .white, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(fill == .white ? Self.cardLine : Color.clear, lineWidth: 1))
    }

    private func salesCard(narrow: Bool) -> some View {
        let s = model.payload?.sales
        return card {
            HStack(alignment: .center, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("実績売上高").font(.system(size: 17, weight: .medium)).foregroundColor(Self.inkSub)
                        Text("Sales").font(.system(size: 14)).foregroundColor(Self.inkSub)
                    }
                    Text(NT.yen(s?.actual ?? 0)).font(.system(size: narrow ? 44 : 52, weight: .semibold)).monospacedDigit().foregroundColor(Self.ink)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    HStack(alignment: .top, spacing: 36) {
                        VStack(alignment: .leading, spacing: 4) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("予算売上高").font(.system(size: 14, weight: .medium))
                                Text("Target").font(.system(size: 12))
                            }
                            .foregroundColor(Self.inkSub)
                            // 未設定のときは何も置かない（「予算登録」の箱に赤い「!」）
                            Text(s?.budget.map { NT.yen($0) } ?? "—").font(.system(size: 26, weight: .medium)).monospacedDigit().foregroundColor(Self.ink)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("客単価").font(.system(size: 14, weight: .medium)).foregroundColor(Self.inkSub)
                            Text(NT.yen(s?.avgSpend ?? 0)).font(.system(size: 26, weight: .medium)).monospacedDigit().foregroundColor(Self.ink)
                        }
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise").font(.system(size: 11))
                        Text(s?.asOf ?? "").font(.system(size: 12))
                        if let n = s?.note { Text(n).font(.system(size: 12)) }
                    }
                    .foregroundColor(Self.inkSub)
                }
                Spacer(minLength: 0)
                ring(s, size: narrow ? 140 : 168)
            }
            .padding(.horizontal, 28).padding(.vertical, 22)
        }
    }

    private func ring(_ s: NHSales?, size: CGFloat) -> some View {
        ZStack {
            Circle().stroke(Self.ringTrack, lineWidth: 12)
            Circle().trim(from: 0, to: CGFloat(max(0, min(1, (s?.ringPct ?? 0) / 100))))
                .stroke(Self.ringColor, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(s?.pct.map { "\($0)" } ?? "—").font(.system(size: 36, weight: .semibold)).monospacedDigit()
                    Text("%").font(.system(size: 15, weight: .bold))
                }
                .foregroundColor(Self.ink)
                Text(s?.heading ?? "本日の達成率").font(.system(size: 12, weight: .medium)).foregroundColor(Self.inkSub)
                Text("Budget").font(.system(size: 10)).foregroundColor(Self.inkSub)
            }
        }
        .frame(width: size, height: size)
    }

    // MARK: 日付・時計・気温・地名（薄い灰色の箱）

    private static let dateFmt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy年M月d日（E）"
        return f
    }()
    private static let hmFmt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "HH:mm"
        return f
    }()
    private static let ssFmt: DateFormatter = {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "ss"
        return f
    }()

    private var clockRow: some View {
        card(fill: Self.clockBg) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.dateFmt.string(from: model.now)).font(.system(size: 16, weight: .medium)).foregroundColor(Self.inkSub)
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text(Self.hmFmt.string(from: model.now)).font(.system(size: 44, weight: .semibold)).monospacedDigit()
                        Text(Self.ssFmt.string(from: model.now)).font(.system(size: 18, weight: .medium)).monospacedDigit().opacity(0.5)
                    }
                    .foregroundColor(Self.ink)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 4) {
                    HStack(spacing: 8) {
                        // 天気のアイコン（晴れ・くもり・雨・雪・雷、晴れの夜は月）。今まで通り青
                        if model.payload?.weather.temperature != nil, let sym = model.payload?.weather.symbol {
                            Image(systemName: sym).font(.system(size: 26, weight: .regular)).foregroundColor(Self.ink)
                        }
                        if let t = model.payload?.weather.temperature {
                            Text("\(Int(t.rounded()))°").font(.system(size: 36, weight: .regular)).foregroundColor(Self.inkSub)
                        }
                    }
                    if let p = model.payload?.weather.place {
                        HStack(spacing: 4) {
                            Image(systemName: "location.fill").font(.system(size: 11))
                            Text(p)
                        }
                        .font(.system(size: 15, weight: .medium)).foregroundColor(Self.inkSub)
                    }
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 14)
        }
    }

    // MARK: 来店組数・客数・リピーター・ウォークイン（白い箱 4 つ）

    private func kpiRow(columns: Int) -> some View {
        let k = model.payload?.kpis
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: columns), spacing: 14) {
            kpi(icon: "person.2.fill", color: Color(hex: 0x1A5AD6), "来店組数", en: "Groups", value: k?.groups, unit: "組", diff: k.map { $0.groups - $0.groupsYesterday })
            kpi(icon: "person.fill", color: Color(hex: 0x6E63B8), "客数", en: "Guests", value: k?.guests, unit: "名", diff: k.map { $0.guests - $0.guestsYesterday })
            kpi(icon: "arrow.triangle.2.circlepath", color: Color(hex: 0xE8603C), "リピーター", en: "Repeat", value: k?.repeaters, unit: "組", diff: nil)
            kpi(icon: "figure.walk", color: Color(hex: 0xF2A000), "当日ウォークイン", en: "Walk-in", value: k?.walkIns, unit: "組", diff: nil)
        }
    }

    private func kpi(icon: String, color: Color, _ ja: String, en: String, value: Int?, unit: String, diff: Int?) -> some View {
        card {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .frame(width: 32, height: 32)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Self.sideBg))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(ja).font(.system(size: 15, weight: .medium)).foregroundColor(Self.inkSub).lineLimit(1)
                        Text(en).font(.system(size: 11)).foregroundColor(Self.inkSub).lineLimit(1)
                    }
                }
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text(value.map { "\($0)" } ?? "—").font(.system(size: 34, weight: .medium)).monospacedDigit().foregroundColor(Self.ink)
                    Text(unit).font(.system(size: 14)).foregroundColor(Self.inkSub)
                    Spacer(minLength: 0)
                    if let d = diff {
                        Text("前日比 \(d >= 0 ? "+" : "")\(d)\(unit)").font(.system(size: 12)).foregroundColor(Self.inkSub).lineLimit(1)
                    }
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
        }
    }
}

/// 画面の中に 4 つの小さい四角があるモニターのロゴ（注文・会計）
struct MonitorLogo: View {
    var size: CGFloat = 62
    var color: Color
    var line: CGFloat = 1.5
    var body: some View {
        let w = size
        let h = size * 0.68
        let gap = w * 0.07
        let cell = (h - w * 0.2 - gap) / 2
        VStack(spacing: size * 0.05) {
            ZStack {
                RoundedRectangle(cornerRadius: w * 0.1, style: .continuous).stroke(color, lineWidth: line).frame(width: w, height: h)
                VStack(spacing: gap) {
                    HStack(spacing: gap) { sq(cell); sq(cell) }
                    HStack(spacing: gap) { sq(cell); sq(cell) }
                }
            }
            Rectangle().fill(color).frame(width: w * 0.3, height: line)
        }
        .frame(width: size, height: size)
    }
    private func sq(_ s: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: s * 0.2, style: .continuous).stroke(color, lineWidth: line).frame(width: s, height: s)
    }
}
