import SwiftUI

// ネイティブの設定画面（iPad レジ。2026-10-24 Ronnie「iOS プリンター＋設定」→ 16:22「左に一覧（印つき）、右に中身。説明は少なく」）。
// 左：一覧（このiPad＝プリンター・印刷／アプリの画面、お店の設定＝店舗・メニュー・デバイス管理・予約・顧客・会計・運用・管理・集計）
// 右：選んだものの中身。プリンター・印刷＝つなぐ→出し先→LAN→Wi-Fi→ネットが無いとき。お店の設定＝項目の一覧（押すと Web の画面）
// 印刷そのものはアプリ自身の印刷係（NativePrintAgent）が出す。ここはその状態（接続中・つながらない）も見せる。

struct NativeSettingsView: View {
    @ObservedObject var model: NativeSettingsModel
    @ObservedObject private var printConfig = NativePrintConfig.shared
    @ObservedObject private var agent = NativePrintAgent.shared
    @EnvironmentObject var state: AppState
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var nativeOn = AppState.shared.nativePosEnabled
    /// 左の一覧で選んでいるもの。中の画面から戻ったときは、前に開いていた項目に戻す
    /// （2026-10-25 00:19 Ronnie「メニューから中に入って戻るとハードウェアに行く。メニューに戻るように」）
    @State private var sel: Sel = NativeSettingsView.lastSel
    private static var lastSel: Sel = .page(.printer)
    /// どのフロアの卓の会計伝票もこの iPad で出す（レジ受付）
    @State private var billAtRegister = NativeRegisterBill.enabled
    /// ハードウェアの中のタブ（プリンター／ネットが無いとき）。1 画面に入るように分ける（2026-10-25 00:31 Ronnie）
    /// LAN・Wi-Fi のプリンターは iPad ではつながない＝管理画面で決める（2026-10-25 01:00 Ronnie「iPad は Bluetooth だけ」）
    @State private var hwTab: HWTab = .printer
    enum HWTab: String, CaseIterable { case printer, offline
        var label: String { switch self { case .printer: return "プリンター"; case .offline: return "ネットが無いとき" } }
        var icon: String { switch self { case .printer: return "printer"; case .offline: return "wifi.slash" } }
    }
    /// ログアウトの確認
    @State private var confirmLogout = false

    enum Sel: Hashable {
        case page(Page)
        /// お店の設定のまとめ（id＝ItemGroup.id）
        case group(String)
    }

    /// このiPad の設定の中の画面（2026-10-24 16:08 Ronnie「設定はできるだけ少なく。同じものが2〜3か所にあるなら1つに」→ 印刷は1枚に）
    enum Page: String, CaseIterable, Identifiable {
        case printer, native, guide
        var id: String { rawValue }
        var title: String {
            switch self {
            case .printer: return "ハードウェア"
            case .native: return "アプリの画面"
            case .guide: return "使い方"
            }
        }
        var en: String {
            switch self {
            case .printer: return "Hardware"
            case .native: return "Native screens"
            case .guide: return "How to read"
            }
        }
        var icon: String {
            switch self {
            case .printer: return "printer"
            case .native: return "ipad"
            case .guide: return "questionmark.circle"
            }
        }
        var description: String {
            switch self {
            case .printer: return "プリンター（Bluetooth・USB・LAN・Wi-Fi）・紙幅・自動印刷・キャッシュドロア・レシートの出し先・ネットが無いときの印刷"
            case .native: return "ホーム・テーブル・オーダー・会計をアプリの画面で開く（OFF で今までの Web）"
            case .guide: return "テーブル一覧の色と印の見方"
            }
        }
        /// 見本の tenpoNativePreviewScroll（昔の名前 receipt／lan／wifi／offline も印刷の画面へ）
        static func from(_ s: String) -> Page? {
            if let p = Page(rawValue: s) { return p }
            return ["receipt", "lan", "wifi", "offline"].contains(s) ? .printer : nil
        }
    }

    /// メニューの1枚（Web の設定のまとめ＋レジの設定を1つにして、同じ画面は1回だけ）
    private struct Item: Identifiable {
        let id: String
        let title: String
        let description: String
        let url: String
        let allowed: Bool
    }
    private struct ItemGroup: Identifiable {
        let id: String
        let label: String
        let en: String
        let icon: String
        var items: [Item]
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "設定", subtitle: "", userName: model.payload?.userName ?? "", onHome: onHome)
            if model.payload != nil {
                HStack(spacing: 0) {
                    sidebar
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            if let n = agent.notice, let at = agent.noticeAt, Date().timeIntervalSince(at) < 600 {
                                noticeBar(n)
                            }
                            content
                        }
                        .padding(20).frame(maxWidth: 1400).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 24)
                    }
                    .frame(maxWidth: .infinity)
                }
                .onAppear {
                    // 管理画面（設定 › レジ端末）で決めた LAN・Wi-Fi・アプリの画面を読み直す
                    state.refreshDeviceSettings(force: true)
                    // 見本（-tenpoNativePreview settings）：tenpoNativePreviewScroll=printer|native|<まとめの名前> で右を切り替える
                    if let to = UserDefaults.standard.string(forKey: "tenpoNativePreviewScroll"), !to.isEmpty {
                        if let p = Page.from(to) { sel = .page(p) }
                        else if let g = groups.first(where: { $0.label == to || $0.id == to }) { sel = .group(g.id) }
                    }
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        Button("もう一度") { Task { await model.refresh() } }
                    }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        // 背景は白（2026-10-24 Ronnie「背景は全部白」）
        .background(Color.white.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22).fill(NFColor.navy.opacity(0.92)))
                    .padding(.horizontal, 40).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 3_000_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .task { await model.refresh() }
        .onReceive(printConfig.$config) { _ in model.syncForm() }
    }

    // MARK: - 左：一覧（白いタブに黒い印。印＋名前は大きく。選んでいるものは青。2026-10-24 Ronnie「タブの背景は白、印を黒に」）

    private static let sideWidth: CGFloat = 300

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                // 見出し（このiPad／お店の設定）は出さない・ハードウェアとデバイス管理は 会計 の下（2026-10-24 19:14 Ronnie）
                ForEach(sideEntries, id: \.self) { e in
                    switch e {
                    case .page(let p):
                        sideRow(icon: p.icon, title: p.title, en: p.en, dot: pageStatus(p)?.1, on: sel == e) { select(e) }
                    case .group(let id):
                        if let g = groups.first(where: { $0.id == id }) {
                            sideRow(icon: g.icon, title: g.label, en: g.en, dot: g.label == "デバイス管理" ? pageStatus(.native)?.1 : nil, on: sel == e) { select(e) }
                        }
                    }
                }
                // ログアウトは一覧のいちばん下（ホームの上のバーからは外した。2026-10-24 19:16 Ronnie）
                sideRow(icon: "rectangle.portrait.and.arrow.right", title: "ログアウト", en: "Log out", dot: nil, on: false) { confirmLogout = true }
                    .padding(.top, 18)
                Text("TENPO ONE \(AppConfig.version)").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3).padding(.top, 22).padding(.horizontal, 12)
            }
            .padding(.horizontal, 14).padding(.vertical, 16)
        }
        .confirmationDialog("ログアウトしますか？", isPresented: $confirmLogout, titleVisibility: .visible) {
            // この iPad だけログアウト → ネイティブのログイン（企業番号・店舗コードはそのまま。2026-10-25 Ronnie）。
            // 前は Web の /logout を開いていたが、その道は無かった（404）
            Button("ログアウト", role: .destructive) { Task { await state.regiLogout() } }
            Button("やめる", role: .cancel) {}
        }
        .frame(width: Self.sideWidth)
        .background(Color.white)
        .overlay(alignment: .trailing) { Rectangle().fill(NFColor.line).frame(width: 1) }
    }

    /// 左の並び：店舗・メニュー・予約・顧客・会計 → ハードウェア・デバイス管理 → 運用・管理・集計（2026-10-24 19:14 Ronnie「ハードウェアとデバイス管理は会計の下」）
    private var sideEntries: [Sel] {
        let gs = groups
        let devices = gs.first { $0.label == "デバイス管理" }
        var out: [Sel] = []
        var placed = false
        for g in gs where g.label != "デバイス管理" {
            out.append(.group(g.id))
            if g.label == "会計" {
                out.append(.page(.printer))
                if let d = devices { out.append(.group(d.id)) }
                placed = true
            }
        }
        if !placed {
            // 会計 が無い（権限で出ない）ときは末尾に
            out.append(.page(.printer))
            if let d = devices { out.append(.group(d.id)) }
        }
        // 使い方（テーブル一覧の色と印の見方）はいちばん下（2026-10-24 22:35 Ronnie）
        out.append(.page(.guide))
        return out
    }

    private func select(_ s: Sel) {
        Self.lastSel = s
        withAnimation(.easeOut(duration: 0.12)) { sel = s }
    }

    private func sideHeader(_ title: String, en: String) -> some View {
        // 英語は出さない（2026-10-24 18:40 Ronnie「いまは日本語だけでいい」）
        Text(title).font(.system(size: 13, weight: .heavy)).foregroundColor(NFColor.ink3)
            .padding(.horizontal, 4).padding(.bottom, 4)
    }

    /// 一覧の1行＝白いタブに黒い印（選ぶと青）：印＋名前（下に英語）＋いまの状態の点（2026-10-24 17:03 Ronnie「タブの背景は白、印を黒に」）
    private func sideRow(icon: String, title: String, en: String, dot: Color?, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 48, height: 48)
                    .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(on ? NFColor.iris : NFColor.navy))
                Text(title).font(.system(size: 19, weight: .heavy)).foregroundColor(on ? NFColor.iris : NFColor.ink).lineLimit(1)
                Spacer(minLength: 4)
                if let dot {
                    Circle().fill(dot).frame(width: 10, height: 10)
                        .overlay(Circle().stroke(Color.white, lineWidth: 1))
                }
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(on ? NFColor.iris : NFColor.ink3)
            }
            .padding(.horizontal, 10).frame(height: 66)
            .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(on ? NFColor.irisSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(on ? NFColor.iris : NFColor.line, lineWidth: on ? 1.5 : 1))
            .shadow(color: Color.black.opacity(0.06), radius: 6, y: 3)
        }
        .buttonStyle(PressableStyle(scale: 0.98))
    }

    // MARK: - 右：中身

    @ViewBuilder
    private var content: some View {
        switch sel {
        case .page(.printer):
            pageTitle(Page.printer.icon, Page.printer.title, en: Page.printer.en, status: pageStatus(.printer))
            // 印刷はぜんぶここ。横に 2 列（左：Bluetooth でつなぐ／右：会計伝票・LAN・Wi-Fi（管理画面で決めたもの））で、スクロールせずに 1 画面に
            // （2026-10-25 00:31 Ronnie「設定の右側はスクロールしなくても同じ画面でできるように」）
            // LAN・Wi-Fi のプリンター・レシートの出し先は管理画面（設定 › レジ端末）で決める。iPad でつなぐのは Bluetooth だけ
            // （2026-10-25 01:00 Ronnie「LAN / Wi-Fi は app からつながない、control centre から。iPad は Bluetooth だけ」）
            hwTabs
            switch hwTab {
            case .printer:
                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 16) { bluetoothCard }
                        .frame(maxWidth: .infinity, alignment: .top)
                    VStack(spacing: 16) {
                        billSlipCard
                        networkCard
                    }
                    .frame(maxWidth: .infinity, alignment: .top)
                }
            case .offline:
                NativeOfflinePrintCard().frame(maxWidth: 900, alignment: .leading)
            }
        case .page(.native):
            pageTitle(Page.native.icon, Page.native.title, en: Page.native.en, status: pageStatus(.native))
            nativeCard
        case .page(.guide):
            pageTitle(Page.guide.icon, Page.guide.title, en: Page.guide.en, status: nil)
            NativeFloorGuide()
        case .group(let id):
            if let g = groups.first(where: { $0.id == id }) {
                pageTitle(g.icon, g.label, en: g.en, status: g.label == "デバイス管理" ? pageStatus(.native) : nil)
                // アプリの画面（Native ON/OFF）は デバイス管理 の中のいちばん上（2026-10-24 19:09 Ronnie）
                if g.label == "デバイス管理" { nativeCard }
                itemList(g)
            } else {
                Text("左から選んでください").font(.system(size: 14)).foregroundColor(NFColor.ink3)
            }
        }
    }

    /// 右の上：印＋名前（＋いまの状態）
    private func pageTitle(_ icon: String, _ title: String, en: String, status: (String, Color)?) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 24, weight: .heavy)).foregroundColor(NFColor.navy)
                if let status {
                    HStack(spacing: 5) {
                        Circle().fill(status.1).frame(width: 7, height: 7)
                        Text(status.0).font(.system(size: 13, weight: .bold)).foregroundColor(status.1)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 2)
    }

    /// お店の設定の項目：名前だけの短い行（説明は1行・薄く）。権限が無いものは 🔒
    private func itemList(_ g: ItemGroup) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(g.items.enumerated()), id: \.element.id) { i, it in
                // ネイティブの画面があるものはアプリの画面で（押した瞬間に）。まだのものは Web（「Web」の印）
                let native = NativeSettingsPageKey.from(path: Self.path(it.url))
                Button {
                    if let native { state.openSettingsPage(native, webPath: it.url) } else { onWeb(it.url) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: it.allowed ? Self.itemIcon(Self.path(it.url), fallback: g.icon) : "lock")
                            .font(.system(size: 16, weight: .semibold)).foregroundColor(it.allowed ? NFColor.iris : NFColor.ink3)
                            .frame(width: 36, height: 36)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(it.allowed ? NFColor.irisSoft : NFColor.lilacSoft))
                        // 説明は出さない（2026-10-24 17:09 Ronnie「設定の中に説明を長く書かない」）。権限が無いときの理由だけ
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.title).font(.system(size: 17, weight: .bold)).foregroundColor(it.allowed ? NFColor.ink : NFColor.ink3).lineLimit(1)
                            if !it.allowed && !it.description.isEmpty {
                                Text(it.description).font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 8)
                        if native == nil && it.allowed {
                            Text("Web").font(.system(size: 10.5, weight: .heavy)).foregroundColor(NFColor.ink3)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .overlay(Capsule().stroke(NFColor.line, lineWidth: 1))
                        }
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3)
                    }
                    .padding(.horizontal, 14).frame(height: 62)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.99))
                .disabled(!it.allowed)
                if i < g.items.count - 1 { Rectangle().fill(NFColor.line).frame(height: 1).padding(.leading, 62) }
            }
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.05), radius: 8, y: 3)
    }

    /// Web の設定のまとめ（hubs）を土台に、レジの設定（sections）の項目で同じ画面が無いものだけ足す。
    /// 「レジの設定」（自分自身）は出さない。レジの設定の項目は ?from=register 付き（開いた画面の上の「レジの設定に戻る」で戻れる）
    private var groups: [ItemGroup] {
        guard let payload = model.payload else { return [] }
        var out: [ItemGroup] = payload.hubs.map { h in
            ItemGroup(id: h.href, label: h.label, en: h.en, icon: Self.hubIcon(h.label),
                      items: h.children
                        .filter { Self.path($0.href) != "/app/pos/settings" }
                        .map { Item(id: $0.href, title: $0.label, description: $0.description, url: Self.withFromRegister($0.href), allowed: true) })
        }
        var seen = Set(out.flatMap { $0.items.map { Self.path($0.url) } })
        for s in payload.sections {
            for l in s.links where !seen.contains(Self.path(l.url)) && Self.path(l.url) != "/app/pos/settings" {
                seen.insert(Self.path(l.url))
                let item = Item(id: l.url, title: l.title, description: l.allowed ? l.description : (l.hint ?? "権限がありません"), url: l.url, allowed: l.allowed)
                let label = Self.hubLabel(forSection: s.id)
                if let i = out.firstIndex(where: { $0.label == label }) {
                    // 品切れはメニューのいちばん上に（レジでいちばん使う）
                    if l.id == "sold-out" { out[i].items.insert(item, at: 0) } else { out[i].items.append(item) }
                } else {
                    out.append(ItemGroup(id: "section:\(s.id)", label: s.title, en: s.en, icon: Self.sectionIcon(s.id), items: [item]))
                }
            }
        }
        return out.filter { !$0.items.isEmpty }
    }

    /// 項目ごとの印（lib/settings-hubs.ts の icon と同じ意味の SF Symbols。2026-10-24 18:45 Ronnie「全部同じ印はダメ」）
    private static let itemIcons: [String: String] = [
        "/app/settings/store": "storefront", "/app/settings/clerks": "person.2", "/app/settings/tables/qr-print": "qrcode", "/app/settings/hours": "clock",
        "/app/settings/company": "building.2", "/app/settings/menu": "fork.knife", "/app/settings/plans": "list.bullet.rectangle", "/app/settings/options": "slider.horizontal.3",
        "/app/settings/categories": "square.grid.2x2", "/app/settings/menu-book": "book", "/app/settings/qr-service": "qrcode.viewfinder", "/app/settings/menu-bulk": "tablecells",
        "/app/settings/dynamic-pricing": "yensign.circle", "/app/pos/sold-out": "nosign", "/app/settings/printers": "printer", "/app/settings/devices": "ipad",
        "/app/settings/handy-qr": "qrcode", "/app/settings/handy": "iphone", "/app/settings/reservation-book": "calendar.badge.clock", "/app/settings/booking": "calendar",
        "/app/settings/tables": "rectangle.split.3x3", "/app/staff": "person.badge.key", "/app/settings/payments": "creditcard", "/app/settings/tax": "percent",
        "/app/settings/accounts": "list.number", "/app/settings/approvals": "checkmark.seal", "/app/settings/loyalty": "star", "/app/settings/alerts": "bell.badge",
        "/app/settings/import": "square.and.arrow.down", "/app/settings/integrations": "link", "/app/settings/audit": "doc.text.magnifyingglass", "/app/settings/summary": "chart.bar",
    ]
    private static func itemIcon(_ path: String, fallback: String) -> String {
        if let i = itemIcons[path] { return i }
        if path.contains("kitchen") || path.contains("ticket") { return "flame" }
        if path.contains("qr") { return "qrcode" }
        return fallback
    }

    /// クエリを除いた道（同じ画面かどうかの判定用）
    private static func path(_ url: String) -> String { String(url.split(separator: "?", maxSplits: 1).first ?? Substring(url)) }

    /// 開いた画面の上に「レジの設定に戻る」を出す印（lib/register-settings.ts の FROM_REGISTER と同じ）
    private static func withFromRegister(_ href: String) -> String {
        if href.contains("from=register") { return href }
        return href + (href.contains("?") ? "&" : "?") + "from=register"
    }

    /// レジの設定の区分 → 管理画面のまとめ
    private static func hubLabel(forSection id: String) -> String {
        switch id {
        case "menu", "kitchen": return "メニュー"
        case "tables": return "店舗"
        case "handy": return "デバイス管理"
        case "booking": return "予約・顧客"
        default: return ""
        }
    }

    /// カードの下に出す「いまの状態」
    private func pageStatus(_ p: Page) -> (String, Color)? {
        switch p {
        case .printer:
            if !model.usePrinter {
                if let id = model.selectedPrinterId, let pr = model.receiptPrinters.first(where: { $0.id == id }) { return ("出し先：\(pr.name)（管理画面で設定）", NFColor.ink2) }
                return ("レシートプリンター（Bluetooth・USB）は使わない", NFColor.ink3)
            }
            if let l = model.link { return ("\(l.deviceName.isEmpty ? l.deviceId : l.deviceName)・つないでいます", NFColor.success) }
            return (model.model == nil ? "機種が未選択" : "まだつないでいません", NFColor.saffron)
        case .native:
            let on = state.adminNativePos ?? nativeOn
            return (on ? "ON（アプリの画面）" : "OFF（今までの画面）", on ? NFColor.success : NFColor.ink3)
        case .guide:
            return nil
        }
    }

    private static func sectionIcon(_ id: String) -> String {
        switch id {
        case "menu": return "fork.knife"
        case "kitchen": return "flame"
        case "tables": return "qrcode"
        case "handy": return "iphone"
        case "booking": return "calendar"
        default: return "slider.horizontal.3"
        }
    }

    private static func hubIcon(_ label: String) -> String {
        switch label {
        case "店舗": return "storefront"
        case "メニュー": return "fork.knife"
        case "デバイス管理": return "iphone"   // 2026-10-24 19:08 Ronnie「デバイスの印はプリンターではなく iPhone」
        case "予約・顧客": return "calendar"
        case "会計": return "creditcard"
        case "運用・管理": return "gearshape"
        case "集計": return "chart.bar"
        default: return "square.grid.2x2"
        }
    }

    // MARK: - 部品

    private func card<Content: View>(icon: String, title: String, en: String, description: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // 見本（Funfo の「receipt printer setting」）と同じく、印は置かず見出しと線だけ（2026-10-24 18:44 Ronnie「スタイルはこれ」）
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 18, weight: .heavy)).foregroundColor(NFColor.navy)
                if !description.isEmpty { Text(description).font(.system(size: 13)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.vertical, 12)
            Rectangle().fill(NFColor.line).frame(height: 1)
            content()
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func row<Content: View>(_ label: String, en: String, dim: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        // 名前は左・操作は右（見本の Funfo と同じ並び）
        HStack(alignment: .center, spacing: 16) {
            // 名前は縮めない（右のメニューに押されて消えないように）
            // 長い名前は折り返す（1 行に固定すると列の幅を押し広げて画面からはみ出す）
            Text(label).font(.system(size: 17, weight: .bold)).foregroundColor(dim ? NFColor.ink3 : NFColor.ink)
                .fixedSize(horizontal: false, vertical: true).layoutPriority(1)
            Spacer(minLength: 12)
            content()
        }
        // 行は少し低く（1 画面に入るように）
        .padding(.horizontal, 18).padding(.vertical, 7).frame(minHeight: 54)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1).padding(.horizontal, 18) }
    }

    private func toggle(_ on: Bool, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? NFColor.iris : Color(hex: 0xCFC9C0)).frame(width: 56, height: 32)
                Circle().fill(Color.white).frame(width: 26, height: 26).shadow(color: .black.opacity(0.15), radius: 2, y: 1).padding(3)
            }
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .animation(.easeOut(duration: 0.15), value: on)
    }

    private func button(_ text: String, icon: String? = nil, primary: Bool = false, busy: Bool = false, disabled: Bool = false, fill: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(primary ? .white : NFColor.iris).scaleEffect(0.8) }
                else if let icon { Image(systemName: icon) }
                Text(text).lineLimit(1).fixedSize(horizontal: !fill, vertical: false)
            }
            .font(.system(size: fill ? 17 : 15.5, weight: .bold))
            .foregroundColor(primary ? .white : NFColor.ink)
            .padding(.horizontal, 18).frame(height: fill ? 54 : 46).frame(maxWidth: fill ? .infinity : nil)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(primary ? NFColor.iris : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(primary ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }

    private func noticeBar(_ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NFColor.danger)
            Text(text).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger)
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft))
    }

    /// 印刷係から見たプリンターの状態
    private func status(_ p: NSTPrinter, on: Bool) -> (String, Color) {
        if let problem = agent.problems[p.id] { return (problem, NFColor.danger) }
        if !on { return ("この iPad からは送りません", NFColor.ink3) }
        if let at = agent.lastPrintedAt[p.id] { return ("接続中・最後の印刷 \(Self.time.string(from: at))", NFColor.success) }
        return (agent.running ? "待機中（印刷が入るとこの iPad から送ります）" : "印刷係は Native ON のときに動きます", NFColor.ink3)
    }

    private static let time: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Tokyo"); return f }()

    // MARK: - このiPadのプリンター（Bluetooth・USB）

    private var bluetoothCard: some View {
        let off = !model.usePrinter
        let locked = !model.canAdd
        let busy = model.busy
        return card(icon: "dot.radiowaves.left.and.right", title: "レシートプリンター（Bluetooth・USB）", en: "Receipt printer",
                    description: "") {
            VStack(spacing: 0) {
                row("レシートプリンターを使う", en: "Use printer") {
                    if busy == "use" { ProgressView() }
                    toggle(model.usePrinter, disabled: busy != nil || locked) { Task { await model.toggleUse() } }
                }
                row("機種", en: "Printer model", dim: off) {
                    VStack(alignment: .trailing, spacing: 6) {
                        Menu {
                            ForEach(makerGroups) { g in
                                Section(g.label) {
                                    ForEach(g.items) { m in
                                        Button { model.chooseModel(m.id) } label: {
                                            Text("\(m.name)\(m.mobile ? "（モバイル）" : "")\(m.ready ? "" : "（準備中）")")
                                        }
                                        .disabled(!m.ready)
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Text(model.model.map { "\($0.makerLabel)　\($0.name)" } ?? "選択してください")
                                    .font(.system(size: 16, weight: model.model == nil ? .regular : .bold))
                                    .foregroundColor(model.model == nil ? NFColor.saffron : NFColor.ink)
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 14).frame(height: 46).frame(minWidth: 200, alignment: .trailing)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(off ? NFColor.lilacSoft : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                        }
                        .disabled(off || locked || busy != nil)
                    }
                }
                row("接続", en: "Connection", dim: off) {
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 14) {
                            if let l = model.link {
                                (Text(l.deviceName.isEmpty ? l.deviceId : l.deviceName).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.success)
                                 + Text("（\(l.via == "usb" ? "USB" : "Bluetooth")・つないでいます）").font(.system(size: 13)).foregroundColor(NFColor.ink3))
                            } else {
                                // 半分の幅（縦向き）でも 1 行に（2 行に折れてボタンの字が「プリンタ…」に切れていた）
                                Text("まだつないでいません").font(.system(size: 15, weight: .semibold)).foregroundColor(off ? NFColor.ink3 : NFColor.saffron)
                                    .lineLimit(1).minimumScaleFactor(0.8)
                            }
                            button(model.link == nil ? "探す" : "つなぎ直す", icon: "magnifyingglass", busy: busy == "search",
                                   disabled: off || locked || model.model == nil || busy != nil) { Task { await model.search() } }
                        }
                        if model.model == nil && model.usePrinter {
                            Text("先に「機種」を選んでください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        }
                    }
                }
                if let found = model.found { foundList(found).padding(.horizontal, 20).padding(.vertical, 12) }
                row("レシート紙幅", en: "Paper width", dim: off) {
                    // 押して中から選ぶ（機種と同じ形）。外にボタンを並べると、分からない人が触って変えてしまうので
                    // （2026-10-25 00:22 Ronnie「中に入って選ぶように。外だと知らない人が壊すこともある」）
                    Menu {
                        ForEach([58, 80], id: \.self) { w in
                            Button { model.paper = w } label: {
                                if model.paper == w { Label("\(w)mm", systemImage: "checkmark") } else { Text("\(w)mm") }
                            }
                        }
                    } label: {
                        HStack(spacing: 10) {
                            Text("\(model.paper)mm").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                        }
                        .padding(.horizontal, 14).frame(height: 46).frame(minWidth: 140, alignment: .trailing)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(off ? NFColor.lilacSoft : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    }
                    .disabled(off || locked)
                }
                row("会計レシート自動印刷", en: "Print receipt after checkout", dim: off) {
                    toggle(model.autoPrint, disabled: off || locked) { model.autoPrint.toggle() }
                }
                row("キャッシュドロア利用", en: "Cash drawer", dim: off) {
                    toggle(model.drawer, disabled: off || locked) { model.drawer.toggle() }
                }
                row("試し印刷", en: "Test print", dim: off) {
                    button("実行", icon: "printer", busy: busy == "receipt", disabled: off || model.link == nil || busy != nil) { Task { await model.testBluetooth("receipt") } }
                }
                row("ドロアを開く", en: "Open drawer", dim: off || !model.drawer) {
                    button("実行", icon: "tray", busy: busy == "drawer", disabled: off || model.link == nil || !model.drawer || busy != nil) { Task { await model.testBluetooth("drawer") } }
                }
                if let t = model.lastTiming {
                    Text("\(t)（応答完了までの計測）").font(.system(size: 12)).foregroundColor(NFColor.ink3).padding(.horizontal, 20).padding(.top, 10)
                }
                if locked { Text("プリンターの設定は店長以上のアカウントで変えられます").font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(.horizontal, 20).padding(.top, 10) }
                // 見本と同じく、いちばん下に幅いっぱいの「保存する」
                button("保存する", primary: true, busy: busy == "save", disabled: off || locked || model.link == nil || busy != nil, fill: true) { Task { await model.save() } }
                    .padding(20)
            }
        }
    }

    private struct MakerGroup: Identifiable { let id: String; let label: String; let items: [NSTModel] }

    private var makerGroups: [MakerGroup] {
        var order: [String] = []
        var groups: [String: [NSTModel]] = [:]
        for m in model.models {
            if groups[m.maker] == nil { order.append(m.maker) }
            groups[m.maker, default: []].append(m)
        }
        return order.map { MakerGroup(id: $0, label: groups[$0]?.first?.makerLabel ?? $0, items: groups[$0] ?? []) }
    }

    private func foundList(_ found: [NSTFound]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("見つかったプリンター（押すとつなぎます）").font(.system(size: 13)).foregroundColor(NFColor.ink2)
            WrapLayout(spacing: 8) {
                ForEach(found) { d in
                    Button { Task { await model.connect(d) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                if model.busy == "connect:\(d.deviceId)" { ProgressView().scaleEffect(0.8) }
                                Text(d.name.isEmpty ? d.deviceId : d.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                            }
                            Text("\(Self.makerLabel(d.maker))・\(d.via == "usb" ? "USB" : "Bluetooth")").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10).frame(minWidth: 220, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle()).disabled(model.busy != nil)
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.irisSoft))
    }

    private static func makerLabel(_ m: String) -> String {
        switch m { case "star": return "Star"; case "epson": return "EPSON"; case "sii": return "SII（セイコー）"; default: return "ESC/POS" }
    }

    /// ハードウェアの中のタブ
    private var hwTabs: some View {
        HStack(spacing: 8) {
            ForEach(HWTab.allCases, id: \.self) { t in
                Button { withAnimation(.easeOut(duration: 0.12)) { hwTab = t } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: t.icon).font(.system(size: 14, weight: .bold))
                        Text(t.label).font(.system(size: 15, weight: .bold))
                    }
                    .foregroundColor(hwTab == t ? .white : NFColor.ink2)
                    .padding(.horizontal, 16).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(hwTab == t ? Color(hex: 0x171333) : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(hwTab == t ? Color.clear : NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
            Spacer(minLength: 0)
        }
    }

    /// 会計伝票：どのフロアの卓もこのレジで（レジ受付）。端末ごとの設定
    private var billSlipCard: some View {
        card(icon: "doc.text", title: "会計伝票（フロアがある店）", en: "Bill slips",
             description: "受付のレジで、どのフロアの卓の会計伝票もこの iPad のレシートプリンター（Bluetooth・LAN）で出します。OFF のときは今まで通り、その卓のフロアのプリンターから出ます") {
            row("どのフロアの会計伝票もこのレジで出す", en: "Print every floor's bill here") {
                Toggle("", isOn: Binding(get: { billAtRegister }, set: { v in billAtRegister = v; NativeRegisterBill.enabled = v }))
                    .labelsHidden().tint(NFColor.iris)
            }
        }
    }

    private func choice(_ label: String, sub: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1.5).frame(width: 22, height: 22)
                    if on { Circle().fill(NFColor.iris).frame(width: 22, height: 22); Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundColor(.white) }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                    Text(sub).font(.system(size: 12.5)).foregroundColor(NFColor.ink3).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).frame(height: 62)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NFColor.irisSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy == "choose")
    }

    // MARK: - LAN・Wi-Fi（管理画面で決める。iPad では見るだけ）

    /// この iPad から送る LAN・Wi-Fi のプリンター（管理画面の 設定 › レジ端末 で決めたもの）と、その状態
    private var networkCard: some View {
        card(icon: "network", title: "LAN・Wi-Fi のプリンター", en: "LAN / Wi-Fi printers",
             description: "") {
            let lan = model.lanPrinters.filter { model.lanOn($0.id) }
            let wifi = model.wifiPrinters.filter { model.wifiOn($0.id) && !model.lanOn($0.id) }
            VStack(alignment: .leading, spacing: 0) {
                if lan.isEmpty && wifi.isEmpty {
                    Text("この iPad から LAN・Wi-Fi のプリンターへは送りません")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                        .padding(.horizontal, 18).padding(.vertical, 12)
                } else {
                    ForEach(lan + wifi) { p in
                        let st = status(p, on: true)
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: model.lanOn(p.id) ? "cable.connector" : "wifi")
                                .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                                Text("\(p.usageLabel)・\(p.lanHost ?? p.ip ?? "")").font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                                Text(st.0).font(.system(size: 12)).foregroundColor(st.1).fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 18).padding(.vertical, 9)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                }
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "desktopcomputer").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.iris)
                    Text("LAN・Wi-Fi のプリンターとレシートの出し先は、管理画面（パソコン）の「設定 › レジ端末」で決めます。iPad でつなぐのは Bluetooth のプリンターだけです")
                        .font(.system(size: 12.5)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
            }
        }
    }

    // MARK: - Native ON/OFF

    private var nativeCard: some View {
        card(icon: "ipad", title: "アプリの画面", en: "Native screens",
             description: "") {
            // 管理画面が決めているときはその値を見せる（端末の切り替えは効かない）
            let shown = state.adminNativePos ?? nativeOn
            VStack(spacing: 0) {
                row("アプリのオーダー・会計画面を使う", en: "Native screens") {
                    Text(shown ? "ON" : "OFF（今までの画面）").font(.system(size: 15, weight: .bold)).foregroundColor(shown ? NFColor.success : NFColor.ink3)
                    // 管理画面（設定 › レジ端末）が決めているときは端末から変えない（2026-10-24）
                    toggle(shown, disabled: state.adminNativePos != nil) {
                        if state.adminNativePos != nil { return }
                        nativeOn.toggle()
                        // OFF：Web の「レジの設定」を読み直す（Web 側のトグルも OFF で出る・印刷係は Web に戻る）
                        state.setNativePos(nativeOn, reloadWeb: true)
                    }
                }
                if state.adminNativePos != nil {
                    Text("管理画面の「設定 › レジ端末」で決めています（この iPad では変えられません）")
                        .font(.system(size: 12.5)).foregroundColor(NFColor.ink3).padding(.horizontal, 20).padding(.vertical, 12)
                }
            }
        }
    }
}
