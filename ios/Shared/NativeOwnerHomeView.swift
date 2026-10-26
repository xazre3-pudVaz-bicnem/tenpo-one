import SwiftUI

// iPhone オーナー・店長モードのホーム（ネイティブ）。Web の /app/dashboard（StoreDashboard の上の部分）と同じ中身を
// スマホの縦1列に（2026-10-24 Ronnie「iOS ホーム画面もネイティブに」）。
//   上＝黒いバー（店舗の切り替え・ホーム・お知らせの鈴）／売上と達成率／来店の数／店舗別（全店舗のとき）／本日の予約／30日推移／メニュー
//   下＝Web のスマホと同じ5つのナビ（ホーム・店舗台帳・ハンディ・勤怠・メニュー）
// 他の画面（店舗台帳・伝票明細・設定…）は今までどおり Web。サーバー：GET /api/app/v1/pos?part=ownerHome（lib/native-owner-home-server.ts）

struct NOHNamed: Codable, Identifiable, Hashable { let id: String; let name: String }
struct NOHSales: Codable {
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
struct NOHKpis: Codable {
    let groups: Int
    let groupsYesterday: Int
    let guests: Int
    let guestsYesterday: Int
    let repeaters: Int?
    let walkIns: Int
}
struct NOHReservation: Codable, Identifiable, Hashable {
    let id: String
    let time: String
    let name: String
    let partySize: Int
    let status: String
    let assigned: Bool
    let storeName: String?
}
struct NOHReservations: Codable {
    let count: Int
    let covers: Int
    let unassigned: Int
    let next: NOHReservation?
    let list: [NOHReservation]
}
struct NOHTrend: Codable, Hashable { let date: String; let sales: Int }
struct NOHByStore: Codable, Identifiable, Hashable { let id: String; let name: String; let sales: Int; let guests: Int; let groups: Int }
struct NOHNav: Codable, Identifiable, Hashable {
    let href: String
    let label: String
    let en: String
    let icon: String
    var id: String { href }
}
struct NOHMenuGroup: Codable, Identifiable, Hashable {
    let label: String?
    let en: String?
    let items: [NOHNav]
    var id: String { label ?? "_main" }
}
struct NOHPayload: Codable {
    let store: NOHNamed?
    let stores: [NOHNamed]
    let isHq: Bool
    let displayName: String
    let serverNow: Double
    let today: String
    let sales: NOHSales
    let kpis: NOHKpis
    let noticeCount: Int
    let reservations: NOHReservations?
    let trend: [NOHTrend]
    let byStore: [NOHByStore]
    let nav: [NOHNav]
    let menu: [NOHMenuGroup]
}

enum NOHColor {
    static let plum = Color(hex: 0x292725)
    static let plum2 = Color(hex: 0x45403B)
    static let page = Color(hex: 0xF3EFE8)
    static let iris = Color(hex: 0xBC5940)
    static let irisDeep = Color(hex: 0x9F4630)
    static let irisSoft = Color(hex: 0xF6E4DA)
    static let royal = Color(hex: 0x8A3F2C)
    static let lilacSoft = Color(hex: 0xFBF9F5)
    static let line = Color(hex: 0xE5DFD5)
    static let ink = Color(hex: 0x292725)
    static let ink2 = Color(hex: 0x5C5650)
    static let ink3 = Color(hex: 0x766B62)
    static let saffron = Color(hex: 0xB7791F)
    static let success = Color(hex: 0x1E8F62)
    static let successSoft = Color(hex: 0xDFF3EA)
    static let gray = Color(hex: 0x8E8E93)
}

/** Web の lucide のアイコン名 → SF Symbols（components/layout/nav-icons.tsx と同じ並び） */
func nohIcon(_ name: String) -> String {
    switch name {
    case "home": return "house"
    case "calendar": return "calendar"
    case "pos": return "bell"
    case "monitor": return "iphone"
    case "receipt": return "doc.text"
    case "users": return "person.2"
    case "cash": return "banknote"
    case "wallet": return "arrow.up.arrow.down"
    case "file": return "doc"
    case "truck": return "truck.box"
    case "clipboard": return "list.clipboard"
    case "package": return "shippingbox"
    case "clock": return "clock"
    case "yen": return "yensign"
    case "chart": return "chart.bar"
    case "settings": return "slider.horizontal.3"
    case "gear": return "gearshape"
    case "more": return "ellipsis"
    case "lock": return "lock"
    case "bell": return "bell.badge"
    case "ticket": return "ticket"
    case "bank": return "building.columns"
    case "mail": return "envelope"
    case "drawer": return "tray"
    case "bag": return "bag"
    case "camera": return "camera"
    case "calculator": return "yensign.circle"
    case "store": return "storefront"
    case "trend": return "chart.line.uptrend.xyaxis"
    case "heart": return "heart"
    case "message": return "message"
    case "shield": return "checkmark.shield"
    case "book": return "book"
    case "list": return "list.bullet"
    case "grid": return "square.grid.2x2"
    default: return "square.grid.2x2"
    }
}

@MainActor
final class NativeOwnerHomeModel: ObservableObject {
    @Published var payload: NOHPayload?
    @Published var error: String?
    /// 読めなかった（権限など）。Web の /app/dashboard をそのまま見せる
    @Published var useWeb = false
    @Published var busy = false
    @Published var toast: String?
    private var refresher: Timer?

    func start() {
        refresher?.invalidate()
        refresher = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { await refresh() }
    }

    func stop() {
        refresher?.invalidate(); refresher = nil
    }

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "ownerHome")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NOHPayload.self, from: data)
            error = nil
        } catch {
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true; return }
            if payload == nil { useWeb = true } else { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    /// 店舗を切り替える（Cookie が変わる → Web も同じ店になる）
    func switchStore(_ id: String?) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(["type": "switchStore", "storeId": id ?? "all"])
            if !r.ok { toast = r.error ?? "切り替えられませんでした"; return false }
            await refresh()
            return true
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativeOwnerHomeView: View {
    @ObservedObject var model: NativeOwnerHomeModel
    /// Web の画面を開く（店舗台帳・伝票明細・設定…）
    var onWeb: (String) -> Void = { _ in }
    /// 店舗を切り替えたあと、裏の Web も同じ店で読み直す
    var onStoreSwitched: () -> Void = {}
    /// ログアウト（Web を見せずにネイティブのログインへ。2026-10-25 09:39 Ronnie）。nil なら出さない
    var onLogout: (() -> Void)? = nil
    @State private var menuOpen = false
    @State private var logoutAsk = false

    var body: some View {
        ZStack(alignment: .bottom) {
            NOHColor.page.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                if let p = model.payload {
                    content(p)
                    bottomNav(p)
                } else {
                    Spacer()
                    if let e = model.error {
                        Text(e).font(.system(size: 14)).foregroundColor(NOHColor.ink3).padding()
                    } else {
                        ProgressView().tint(NOHColor.iris)
                    }
                    Spacer()
                }
            }
            if let t = model.toast {
                Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NOHColor.ink.opacity(0.92)))
                    .padding(.bottom, 90)
                    .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { if model.toast == t { model.toast = nil } } }
            }
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .sheet(isPresented: $menuOpen) { menuSheet.presentationDetents([.large]) }
    }

    // MARK: 上のバー（Web の TopBar：黒・下に細い赤茶の線）

    private var topBar: some View {
        let p = model.payload
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                if let p {
                    Menu {
                        if p.isHq {
                            Button { Task { if await model.switchStore(nil) { onStoreSwitched() } } } label: {
                                if p.store == nil { Label("全店舗", systemImage: "checkmark") } else { Text("全店舗") }
                            }
                        }
                        ForEach(p.stores) { s in
                            Button { Task { if await model.switchStore(s.id) { onStoreSwitched() } } } label: {
                                if s.id == p.store?.id { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: p.store == nil ? "building.2" : "storefront").font(.system(size: 14, weight: .semibold))
                            Text(p.store?.name ?? "全店舗").font(.system(size: 13, weight: .bold)).lineLimit(1)
                            if p.stores.count > 1 || p.isHq { Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)) }
                        }
                        .foregroundColor(.white)
                        .padding(.leading, 8).padding(.trailing, 12).frame(height: 32)
                        .background(Capsule().fill(Color.white.opacity(0.12)))
                    }
                    .disabled(!(p.stores.count > 1 || p.isHq))
                } else {
                    Text("TENPO ONE").font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                }
                Spacer(minLength: 4)
                Button { Task { await model.refresh() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 17, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                Button { onWeb("/app/notifications") } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "bell").font(.system(size: 18, weight: .semibold)).foregroundColor(.white).frame(width: 40, height: 40)
                        if let n = p?.noticeCount, n > 0 {
                            Text(n > 99 ? "99+" : "\(n)").font(.system(size: 10, weight: NT.strong)).foregroundColor(.white)
                                .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18)
                                .background(Capsule().fill(Color(hex: 0xE53935)))
                                .offset(x: 2, y: 2)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .frame(height: 58)
            Rectangle().fill(NOHColor.iris).frame(height: 3)
        }
        .background(NOHColor.plum.ignoresSafeArea(edges: .top))
    }

    // MARK: 中身

    private func content(_ p: NOHPayload) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                salesCard(p)
                kpiGrid(p)
                if p.store == nil && !p.byStore.isEmpty { byStoreCard(p) }
                if let r = p.reservations { reservationsCard(r) }
                if !p.trend.isEmpty { trendCard(p) }
                menuCard(p)
                Text("\(p.displayName)　·　Version \(AppConfig.version)").font(.system(size: 11)).foregroundColor(NOHColor.ink3).padding(.top, 4)
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 16)
        }
        .refreshable { await model.refresh() }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NOHColor.line, lineWidth: 1))
    }

    private func cardTitle(_ ja: String, en: String, link: String? = nil, href: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(ja).font(.system(size: 15, weight: NT.strong)).foregroundColor(NOHColor.ink)
            Text(en).font(.system(size: 11, weight: .medium)).foregroundColor(NOHColor.ink3)
            Spacer()
            if let link, let href {
                Button { onWeb(href) } label: {
                    Text("\(link) ›").font(.system(size: 13, weight: .bold)).foregroundColor(NOHColor.iris)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
    }

    // 売上と達成率（Web の HomeTop の売上の箱）
    private func salesCard(_ p: NOHPayload) -> some View {
        let s = p.sales
        return card {
            cardTitle(s.heading ?? "\(s.dayLabel)の売上", en: "Sales", link: s.canAnalytics ? "店舗分析" : nil, href: s.canAnalytics ? "/app/reports" : nil)
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("実績売上高").font(.system(size: 12, weight: .medium)).foregroundColor(NOHColor.ink3)
                    Text(NT.yen(s.actual)).font(.system(size: 32, weight: NT.strong)).foregroundColor(NOHColor.royal).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    HStack(spacing: 14) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("客単価").font(.system(size: 11)).foregroundColor(NOHColor.ink3)
                            Text(NT.yen(s.avgSpend)).font(.system(size: 15, weight: .bold)).foregroundColor(NOHColor.ink).monospacedDigit()
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("予算売上高").font(.system(size: 11)).foregroundColor(NOHColor.ink3)
                            Text(s.budget.map { NT.yen($0) } ?? "—").font(.system(size: 15, weight: .bold)).foregroundColor(NOHColor.ink).monospacedDigit()
                        }
                    }
                }
                Spacer(minLength: 0)
                ring(s)
            }
            .padding(.horizontal, 16)
            HStack(spacing: 8) {
                if let note = s.note {
                    Text(note).font(.system(size: 11)).foregroundColor(NOHColor.saffron)
                }
                Spacer()
                Text("\(s.asOf)時点").font(.system(size: 10)).foregroundColor(NOHColor.ink3)
            }
            .padding(.horizontal, 16).padding(.top, 10)
            HStack(spacing: 8) {
                smallLink("伝票明細", en: "Slips", icon: "doc.text") { onWeb("/app/orders?from=\(s.date)&to=\(s.date)") }
                if s.canAnalytics { smallLink("店舗分析", en: "Analytics", icon: "chart.bar") { onWeb("/app/reports") } }
                smallLink("日別予算", en: "Budget", icon: "target") { onWeb("/app/budgets/daily") }
            }
            .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 14)
        }
    }

    private func ring(_ s: NOHSales) -> some View {
        let pct = max(0, min(1, s.ringPct / 100))
        let tone: Color = s.pct == nil ? NOHColor.gray : (s.pct ?? 0) >= 100 ? NOHColor.success : (s.pct ?? 0) >= 90 ? NOHColor.saffron : NOHColor.iris
        return ZStack {
            Circle().stroke(NOHColor.page, lineWidth: 10)
            Circle().trim(from: 0, to: pct).stroke(tone, style: StrokeStyle(lineWidth: 10, lineCap: .round)).rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(s.pct.map { "\($0)%" } ?? "—").font(.system(size: 20, weight: NT.strong)).foregroundColor(NOHColor.ink).monospacedDigit()
                Text("達成率").font(.system(size: 9)).foregroundColor(NOHColor.ink3)
            }
        }
        .frame(width: 96, height: 96)
    }

    private func smallLink(_ ja: String, en: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                VStack(alignment: .leading, spacing: 0) {
                    Text(ja).font(.system(size: 12, weight: .bold))
                    Text(en).font(.system(size: 9)).opacity(0.7)
                }
            }
            .foregroundColor(NOHColor.ink2)
            .frame(maxWidth: .infinity).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 10).fill(NOHColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NOHColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    // 来店の数（Web の HomeTop の KPI）
    private func kpiGrid(_ p: NOHPayload) -> some View {
        let k = p.kpis
        let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        return LazyVGrid(columns: cols, spacing: 10) {
            kpi("来店組数", en: "Groups", icon: "person.2.fill", color: NOHColor.iris, value: k.groups, unit: "組", diff: k.groups - k.groupsYesterday)
            kpi("客数", en: "Guests", icon: "person.fill", color: NOHColor.royal, value: k.guests, unit: "名", diff: k.guests - k.guestsYesterday)
            kpi("リピーター", en: "Repeat", icon: "arrow.triangle.2.circlepath", color: Color(hex: 0xE8603C), value: k.repeaters, unit: "組", diff: nil)
            kpi("当日ウォークイン", en: "Walk-in", icon: "figure.walk", color: NOHColor.saffron, value: k.walkIns, unit: "組", diff: nil)
        }
    }

    private func kpi(_ ja: String, en: String, icon: String, color: Color, value: Int?, unit: String, diff: Int?) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .frame(width: 34, height: 34).background(RoundedRectangle(cornerRadius: 9).fill(color))
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(ja).font(.system(size: 11, weight: .bold)).foregroundColor(NOHColor.ink2).lineLimit(1).minimumScaleFactor(0.8)
                    Text(en).font(.system(size: 9)).foregroundColor(NOHColor.ink3)
                }
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(value.map { "\($0)" } ?? "—").font(.system(size: 22, weight: NT.strong)).foregroundColor(NOHColor.ink).monospacedDigit()
                    Text(unit).font(.system(size: 11)).foregroundColor(NOHColor.ink3)
                    if let d = diff {
                        Text("前日比 \(d >= 0 ? "+" : "")\(d)").font(.system(size: 9)).foregroundColor(d >= 0 ? NOHColor.success : NOHColor.iris).padding(.leading, 4)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NOHColor.line, lineWidth: 1))
    }

    // 店舗別（全店舗のとき）
    private func byStoreCard(_ p: NOHPayload) -> some View {
        card {
            cardTitle("店舗別の売上（本日）", en: "By store")
            ForEach(Array(p.byStore.enumerated()), id: \.element.id) { i, s in
                Button {
                    Task { if await model.switchStore(s.id) { onStoreSwitched() } }
                } label: {
                    HStack(spacing: 10) {
                        Text("\(i + 1)").font(.system(size: 12, weight: NT.strong)).foregroundColor(i < 3 ? .white : NOHColor.ink3)
                            .frame(width: 22, height: 22).background(Circle().fill(i < 3 ? NOHColor.iris : NOHColor.page))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(s.name).font(.system(size: 14, weight: .bold)).foregroundColor(NOHColor.ink).lineLimit(1)
                            Text("\(s.groups)組 · \(s.guests)名").font(.system(size: 11)).foregroundColor(NOHColor.ink3)
                        }
                        Spacer()
                        Text(NT.yen(s.sales)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NOHColor.royal).monospacedDigit()
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NOHColor.ink3)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Rectangle().fill(NOHColor.line.opacity(0.6)).frame(height: 1).padding(.leading, 16) }
            }
            Color.clear.frame(height: 6)
        }
    }

    // 本日の予約（Web の StoreDashboard の「本日の予約」）
    private func reservationsCard(_ r: NOHReservations) -> some View {
        card {
            cardTitle("本日の予約", en: "Reservations", link: "台帳を見る", href: "/app/reservations")
            HStack(spacing: 8) {
                resvSum("組数", value: r.count, unit: "組", warn: false)
                resvSum("予約人数", value: r.covers, unit: "名", warn: false)
                resvSum("席未定", value: r.unassigned, unit: "件", warn: r.unassigned > 0)
            }
            .padding(.horizontal, 16)
            if r.count == 0 {
                Text("本日の予約はありません").font(.system(size: 13)).foregroundColor(NOHColor.ink3)
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                if let n = r.next {
                    HStack(spacing: 4) {
                        Text("次のご予約：").font(.system(size: 12))
                        Text(n.time).font(.system(size: 12, weight: .bold)).monospacedDigit()
                        Text("\(n.name) 様（\(n.partySize)名）").font(.system(size: 12)).lineLimit(1)
                        Spacer()
                    }
                    .foregroundColor(NOHColor.royal)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 8).fill(NOHColor.irisSoft))
                    .padding(.horizontal, 16).padding(.top, 10)
                }
                VStack(spacing: 0) {
                    ForEach(r.list) { x in
                        Button { onWeb("/app/reservations") } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(x.time).font(.system(size: 14, weight: .bold)).monospacedDigit()
                                        Text("\(x.name) 様").font(.system(size: 14, weight: .bold)).lineLimit(1)
                                    }
                                    .foregroundColor(NOHColor.ink)
                                    Text("\(x.partySize)名" + (!x.assigned && x.status != "seated" ? "・テーブル未割当" : "") + (x.storeName.map { "・\($0)" } ?? ""))
                                        .font(.system(size: 11)).foregroundColor(NOHColor.ink3).lineLimit(1)
                                }
                                Spacer()
                                badge(x.status)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 9)
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .bottom) { Rectangle().fill(NOHColor.line.opacity(0.6)).frame(height: 1).padding(.leading, 16) }
                    }
                }
                .padding(.top, 6)
                if r.count > r.list.count {
                    Text("他 \(r.count - r.list.count)件").font(.system(size: 11)).foregroundColor(NOHColor.ink3).padding(.horizontal, 16).padding(.vertical, 8)
                } else {
                    Color.clear.frame(height: 6)
                }
            }
        }
    }

    private func resvSum(_ label: String, value: Int, unit: String, warn: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 11, weight: .medium)).foregroundColor(NOHColor.ink3).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text("\(value)").font(.system(size: 20, weight: NT.strong)).foregroundColor(warn ? NOHColor.saffron : NOHColor.royal).monospacedDigit()
                Text(unit).font(.system(size: 10)).foregroundColor(NOHColor.ink3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 10).fill(NOHColor.lilacSoft))
    }

    private func badge(_ status: String) -> some View {
        let (text, fg, bg): (String, Color, Color) = status == "seated"
            ? ("着席中", NOHColor.success, NOHColor.successSoft)
            : status == "pending" ? ("未確定", NOHColor.saffron, Color(hex: 0xFBF1D9)) : ("予約", NOHColor.iris, NOHColor.irisSoft)
        return Text(text).font(.system(size: 11, weight: .bold)).foregroundColor(fg)
            .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(bg))
    }

    // 30日推移（レジ締めの純売上）
    private func trendCard(_ p: NOHPayload) -> some View {
        let maxV = max(1, p.trend.map { $0.sales }.max() ?? 1)
        return card {
            cardTitle("売上推移（過去30日）", en: "Sales trend", link: p.sales.canAnalytics ? "売上分析" : nil, href: p.sales.canAnalytics ? "/app/reports" : nil)
            GeometryReader { geo in
                let n = CGFloat(max(1, p.trend.count))
                let gap: CGFloat = 2
                let w = max(2, (geo.size.width - gap * (n - 1)) / n)
                HStack(alignment: .bottom, spacing: gap) {
                    ForEach(Array(p.trend.enumerated()), id: \.offset) { _, t in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(NOHColor.iris.opacity(0.85))
                            .frame(width: w, height: max(2, geo.size.height * CGFloat(t.sales) / CGFloat(maxV)))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            .frame(height: 96)
            .padding(.horizontal, 16)
            HStack {
                Text(p.trend.first?.date ?? "").font(.system(size: 10)).foregroundColor(NOHColor.ink3)
                Spacer()
                Text("最高 \(NT.yen(maxV))").font(.system(size: 10)).foregroundColor(NOHColor.ink3)
                Spacer()
                Text(p.trend.last?.date ?? "").font(.system(size: 10)).foregroundColor(NOHColor.ink3)
            }
            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 12)
        }
        .onTapGesture { if p.sales.canAnalytics { onWeb("/app/reports") } }
    }

    // メニュー（Web の /app/menu の先頭グループ。全部は下の「メニュー」から）
    private func menuCard(_ p: NOHPayload) -> some View {
        let items = Array((p.menu.first?.items ?? []).prefix(8))
        let cols = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return card {
            cardTitle("メニュー", en: "Menu", link: "すべて", href: "/app/menu")
            LazyVGrid(columns: cols, spacing: 10) {
                ForEach(items) { it in
                    Button { onWeb(it.href) } label: {
                        VStack(spacing: 5) {
                            Image(systemName: nohIcon(it.icon)).font(.system(size: 20, weight: .semibold)).foregroundColor(NOHColor.iris)
                                .frame(width: 48, height: 48).background(RoundedRectangle(cornerRadius: 12).fill(NOHColor.lilacSoft))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NOHColor.line, lineWidth: 1))
                            Text(it.label).font(.system(size: 10, weight: .bold)).foregroundColor(NOHColor.ink2).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 12).padding(.bottom, 14)
        }
    }

    // MARK: 下のナビ（Web の MobileNav と同じ5つ）

    private func bottomNav(_ p: NOHPayload) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color(hex: 0xE5E5EA)).frame(height: 1)
            HStack(spacing: 0) {
                ForEach(p.nav) { n in
                    let active = n.href == "/app/dashboard"
                    Button {
                        if active { Task { await model.refresh() } } else if n.href == "/app/menu" { menuOpen = true } else { onWeb(n.href) }
                    } label: {
                        VStack(spacing: 2) {
                            Image(systemName: nohIcon(n.icon)).font(.system(size: 19, weight: .semibold))
                            Text(n.label).font(.system(size: 10, weight: .medium)).lineLimit(1)
                        }
                        .foregroundColor(active ? NOHColor.iris : NOHColor.gray)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(Color.white)
        }
        .background(Color.white.ignoresSafeArea(edges: .bottom))
    }

    // MARK: シート：メニュー（Web の /app/menu と同じ並び）

    private var menuSheet: some View {
        let groups = model.payload?.menu ?? []
        return NativeHandySheet(title: "メニュー", onClose: { menuOpen = false }) {
            ForEach(groups) { g in
                if let label = g.label {
                    HStack(spacing: 6) {
                        Text(label).font(.system(size: 12, weight: NT.strong)).foregroundColor(NOHColor.ink3)
                        if let en = g.en { Text(en).font(.system(size: 10)).foregroundColor(NOHColor.ink3.opacity(0.8)) }
                        Spacer()
                    }
                    .padding(.top, 16).padding(.bottom, 4)
                }
                ForEach(g.items) { it in
                    Button { menuOpen = false; onWeb(it.href) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: nohIcon(it.icon)).font(.system(size: 17, weight: .semibold)).foregroundColor(NOHColor.iris).frame(width: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(it.label).font(.system(size: 15, weight: .bold)).foregroundColor(NOHColor.ink)
                                Text(it.en).font(.system(size: 11)).foregroundColor(NOHColor.ink3)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NOHColor.ink3)
                        }
                        .frame(minHeight: 50)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) { Rectangle().fill(NOHColor.line.opacity(0.6)).frame(height: 1) }
                }
            }
            if onLogout != nil {
                Button { logoutAsk = true } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 17, weight: .semibold)).foregroundColor(Color(hex: 0xC62828)).frame(width: 28)
                        Text("ログアウト").font(.system(size: 15, weight: .bold)).foregroundColor(Color(hex: 0xC62828))
                        Spacer()
                    }
                    .frame(minHeight: 50)
                }
                .buttonStyle(.plain)
                .padding(.top, 18)
                .confirmationDialog("ログアウトしますか？", isPresented: $logoutAsk, titleVisibility: .visible) {
                    Button("ログアウト", role: .destructive) { menuOpen = false; onLogout?() }
                    Button("やめる", role: .cancel) {}
                }
            }
        }
    }
}
