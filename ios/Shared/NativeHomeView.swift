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

    func start() {
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

    var body: some View {
        VStack(spacing: 0) {
            topBar
            GeometryReader { geo in
                // 横（1000pt 以上）は左に操作の列・右に売上。縦（ポートレート）は上から順に並べてスクロール
                // （2026-10-24 Ronnie「縦にするとオーダー・会計とボタンがくっつく」）
                if geo.size.width >= 1000 {
                    HStack(alignment: .top, spacing: 18) {
                        VStack(spacing: 10) {
                            ForEach(model.payload?.tools ?? []) { t in toolRow(t) }
                            Spacer(minLength: 0)
                        }
                        .frame(width: max(240, geo.size.width * 0.20))
                        VStack(spacing: 18) {
                            // 売上の箱は、上（大きいボタン）と下（時計の行）から同じ距離に（2026-10-24 14:24 Ronnie「下の隙間が大きい。上下を同じに」）
                            Spacer(minLength: 0)
                            salesCard(narrow: false)
                            Spacer(minLength: 0)
                            clockRow
                            kpiRow(columns: 4)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 18)
                    .padding(.bottom, 14)
                } else {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 18) {
                            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                                ForEach(model.payload?.tools ?? []) { t in toolRow(t) }
                            }
                            salesCard(narrow: true)
                            clockRow
                            kpiRow(columns: 2)
                        }
                        .padding(.horizontal, 18)
                        .padding(.top, 18)
                        .padding(.bottom, 24)
                    }
                }
            }
        }
        .background(Color.white.ignoresSafeArea())
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

    // MARK: 上のバー（店・お知らせ・ハンディQR・ログアウト）＋大きい2つ

    private var topBar: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                // 「ホーム」の字は出さない（ここがホーム。2026-10-24 19:01 Ronnie）
                Spacer()
                Button { onWeb("/app/expenses") } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "bell").font(.system(size: 20, weight: .semibold)).foregroundColor(.white).padding(8)
                        if let n = model.payload?.noticeCount, n > 0 {
                            Text("\(n)").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(Capsule().fill(Color(hex: 0xE53935)))
                        }
                    }
                }
                .buttonStyle(PressableStyle())
                // テーブルQR は 設定 の中だけ（2026-10-24 19:01 Ronnie「ホームの上にはいらない」）
                Button { handyQrOpen = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "qrcode")
                        Text("ハンディQR")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.10)))
                }
                .buttonStyle(PressableStyle())
                Image("BrandMark").resizable().scaledToFit().frame(width: 38, height: 38)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                // 店名はログアウトの横（2026-10-24 19:03 Ronnie）
                HStack(spacing: 6) {
                    Image(systemName: "storefront")
                    Text(model.payload?.store.name ?? "").lineLimit(1)
                }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Capsule().fill(Color.white.opacity(0.10)))
                Button { onWeb("/logout") } label: {
                    Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 18, weight: .semibold)).foregroundColor(.white).padding(8)
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 16)
            .frame(height: 64)
            .background(NT.header)

            HStack(spacing: 18) {
                Spacer(minLength: 0)
                ForEach(model.payload?.bigTiles ?? [NHNamed(href: "/app/floor", label: "オーダー・会計", en: "Order & Pay"), NHNamed(href: "/app/reservations", label: "店舗台帳", en: "Reservation")], id: \.href) { t in
                    let isFloor = t.href == "/app/floor"
                    // 店舗台帳の箱：オーダー・会計と同じ作り（薄い灰色の地・黒い字）で、アイコンの角丸だけ 店舗台帳の画面と同じ Tableo 風（紺に黄色のカレンダー）
                    // （2026-10-24 16:45 Ronnie「箱全体に色を塗るのではなく、隣のオーダー・会計と同じ感じに」）
                    Button { isFloor ? onFloor() : onWeb(t.href) } label: {
                        HStack(spacing: 22) {
                            Spacer()
                            Image(systemName: isFloor ? "desktopcomputer" : "calendar")
                                .font(.system(size: 44, weight: .bold)).foregroundColor(isFloor ? .white : NLColor.yellow)
                                .frame(width: 92, height: 92)
                                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(
                                    LinearGradient(colors: isFloor ? [Color(hex: 0x2A6FE6), Self.blueDeep] : [NLColor.navy2, NLColor.navy], startPoint: .top, endPoint: .bottom)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.label).font(.system(size: 30, weight: .heavy)).foregroundColor(NFColor.ink)
                                Text(t.en).font(.system(size: 16, weight: .medium)).foregroundColor(NFColor.ink3)
                            }
                            Spacer()
                        }
                        .frame(maxWidth: 640).frame(height: 150)
                        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Self.tileBg))
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
        }
    }

    // MARK: 左の列

    private func toolRow(_ t: NHTool) -> some View {
        let (icon, color) = Self.toolIcon(t)
        return Button {
            if t.action == "drawer" { Task { await model.openDrawer() } } else { onWeb(t.href) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundColor(color)
                    .frame(width: 44, height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                VStack(alignment: .leading, spacing: 1) {
                    Text(t.label).font(.system(size: 18, weight: .heavy)).foregroundColor(NFColor.ink)
                    Text(t.en).font(.system(size: 12, weight: .medium)).foregroundColor(NFColor.ink3)
                }
                .lineLimit(1)
                Spacer(minLength: 4)
                if let b = t.badge, b > 0 {
                    Text("\(b)").font(.system(size: 13, weight: .heavy)).foregroundColor(.white)
                        .frame(minWidth: 26).padding(.horizontal, 6).frame(height: 26)
                        .background(Capsule().fill(Color(hex: 0xE53935)))
                }
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity).frame(height: 76)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Self.tileBg))
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .disabled(model.busy && t.action == "drawer")
    }

    private static func toolIcon(_ t: NHTool) -> (String, Color) {
        switch t.href {
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

    // MARK: 中：達成率・実績売上

    private func salesCard(narrow: Bool) -> some View {
        let s = model.payload?.sales
        return VStack(spacing: 18) {
            HStack(alignment: .center, spacing: narrow ? 24 : 36) {
            Spacer(minLength: 0)
            ring(s)
            salesNumbers(s)
            if !narrow { VStack(spacing: 14) { salesButtons(s) }.frame(width: 200) }
            Spacer(minLength: 0)
            }
            if narrow {
                HStack(spacing: 12) { salesButtons(s) }
            }
        }
        .padding(.top, narrow ? 0 : 10)
    }

    private func ring(_ s: NHSales?) -> some View {
            ZStack {
                Circle().stroke(Color(hex: 0xE5E5EA), lineWidth: 22)
                Circle().trim(from: 0, to: CGFloat(max(0, min(1, (s?.ringPct ?? 0) / 100))))
                    .stroke(Self.blue, style: StrokeStyle(lineWidth: 22, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text(s?.pct.map { "\($0)" } ?? "—").font(.system(size: 40, weight: .heavy))
                        Text("%").font(.system(size: 18, weight: .bold))
                    }
                    .foregroundColor(NFColor.ink)
                    Text(s?.heading ?? "本日の達成率").font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.ink2)
                    Text("Budget").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
            }
            .frame(width: 180, height: 180)
    }

    private func salesNumbers(_ s: NHSales?) -> some View {
            VStack(alignment: .leading, spacing: 6) {
                Text("実績売上高").font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink2)
                Text("Sales").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                Text(NT.yen(s?.actual ?? 0)).font(.system(size: 56, weight: .heavy)).monospacedDigit().foregroundColor(Self.blueDeep)
                    .lineLimit(1).minimumScaleFactor(0.6)
                HStack(spacing: 6) {
                    Text("客単価").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                    Text(NT.yen(s?.avgSpend ?? 0)).font(.system(size: 15, weight: .heavy)).foregroundColor(Self.blueDeep)
                }
                Rectangle().fill(Color(hex: 0xE5E5EA)).frame(height: 1).padding(.vertical, 6)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("予算売上高").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                        Text("Target").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                    }
                    // 未設定のときはここに何も置かない（空の 28pt の字を置くと下の隙間が広がる。2026-10-24 14:24 Ronnie「上下の隙間を同じに」）。
                    // 右の「予算登録」ボタンに赤い丸の「!」だけ（13:47 Ronnie）
                    if let b = s?.budget {
                        Text(NT.yen(b)).font(.system(size: 28, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
                    }
                }
                HStack(spacing: 4) {
                    Image(systemName: "arrow.clockwise").font(.system(size: 11))
                    Text(s?.asOf ?? "").font(.system(size: 12))
                    if let n = s?.note { Text(n).font(.system(size: 12)) }
                }
                .foregroundColor(NFColor.ink3)
            }
            .frame(maxWidth: 420, alignment: .leading)
    }

    @ViewBuilder private func salesButtons(_ s: NHSales?) -> some View {
        if s?.canAnalytics ?? false {
            outlineButton("店舗分析", en: "Analytics") { onWeb("/app/reports") }
        }
        // 予算が未設定のときは右上に赤い丸の「!」（文字は書かない。2026-10-24 Ronnie）
        outlineButton("予算登録", en: "Set budget", alert: s != nil && s?.budget == nil) { onWeb("/app/budgets/daily") }
    }

    private func outlineButton(_ ja: String, en: String, alert: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(ja).font(.system(size: 18, weight: .heavy)).foregroundColor(NFColor.ink)
                Text(en).font(.system(size: 12, weight: .medium)).foregroundColor(NFColor.ink3)
            }
            .frame(maxWidth: .infinity).frame(height: 76)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(hex: 0xC9CDD6), lineWidth: 1.5))
            .overlay(alignment: .topTrailing) {
                if alert {
                    Text("!").font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(NFColor.danger))
                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                        .offset(x: 8, y: -8)
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.98))
    }

    // MARK: 下：日付・時計・気温・地名

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
        HStack(alignment: .lastTextBaseline, spacing: 16) {
            Spacer()
            Text(Self.dateFmt.string(from: model.now)).font(.system(size: 20, weight: .medium)).foregroundColor(Self.blueDeep)
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(Self.hmFmt.string(from: model.now)).font(.system(size: 72, weight: .thin, design: .rounded)).monospacedDigit()
                Text(Self.ssFmt.string(from: model.now)).font(.system(size: 28, weight: .light, design: .rounded)).monospacedDigit().opacity(0.7)
            }
            .foregroundColor(Self.blue)
            Rectangle().fill(Color(hex: 0xC9CDD6)).frame(width: 1, height: 70)
            if let t = model.payload?.weather.temperature {
                Text("\(Int(t.rounded()))°").font(.system(size: 64, weight: .thin, design: .rounded)).foregroundColor(Self.blue)
            }
            // 天気のアイコン（気温の右。晴れ・くもり・雨・雪・雷、晴れの夜は月。1色の濃い青）
            if model.payload?.weather.temperature != nil, let sym = model.payload?.weather.symbol {
                Image(systemName: sym).font(.system(size: 40, weight: .regular)).foregroundColor(Self.blue)
                    .padding(.bottom, 8)
            }
            if let p = model.payload?.weather.place {
                HStack(spacing: 4) {
                    Image(systemName: "location.fill").font(.system(size: 11))
                    Text(p)
                }
                .font(.system(size: 15, weight: .medium)).foregroundColor(Self.blueDeep)
            }
            Spacer()
        }
    }

    // MARK: 来店組数・客数・リピーター・ウォークイン

    private func kpiRow(columns: Int) -> some View {
        let k = model.payload?.kpis
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: columns), spacing: 0) {
            kpi(icon: "person.2.fill", color: Color(hex: 0x1A5AD6), "来店組数", en: "Groups", value: k?.groups, unit: "組", diff: k.map { $0.groups - $0.groupsYesterday })
            kpi(icon: "person.fill", color: Color(hex: 0x6E63B8), "客数", en: "Guests", value: k?.guests, unit: "名", diff: k.map { $0.guests - $0.guestsYesterday })
            kpi(icon: "arrow.triangle.2.circlepath", color: Color(hex: 0xE8603C), "リピーター", en: "Repeat", value: k?.repeaters, unit: "組", diff: nil)
            kpi(icon: "figure.walk", color: Color(hex: 0xF2A000), "当日ウォークイン", en: "Walk-in", value: k?.walkIns, unit: "組", diff: nil)
        }
        .padding(.top, 10)
        .overlay(alignment: .top) { Rectangle().fill(Color(hex: 0xE5E5EA)).frame(height: 1) }
    }

    private func kpi(icon: String, color: Color, _ ja: String, en: String, value: Int?, unit: String, diff: Int?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    .frame(width: 42, height: 42)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color))
                VStack(alignment: .leading, spacing: 0) {
                    Text(ja).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                    Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
            }
            HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(value.map { "\($0)" } ?? "—").font(.system(size: 34, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
                Text(unit).font(.system(size: 14)).foregroundColor(NFColor.ink3)
                Spacer()
                if let d = diff {
                    Text("前日比 \(d >= 0 ? "+" : "")\(d)\(unit)").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .trailing) { Rectangle().fill(Color(hex: 0xE5E5EA)).frame(width: 1).padding(.vertical, 8) }
    }
}
