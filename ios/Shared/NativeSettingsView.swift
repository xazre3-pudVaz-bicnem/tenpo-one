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
    /// 左の一覧で選んでいるもの
    @State private var sel: Sel = .page(.printer)

    enum Sel: Hashable {
        case page(Page)
        /// お店の設定のまとめ（id＝ItemGroup.id）
        case group(String)
    }

    /// このiPad の設定の中の画面（2026-10-24 16:08 Ronnie「設定はできるだけ少なく。同じものが2〜3か所にあるなら1つに」→ 印刷は1枚に）
    enum Page: String, CaseIterable, Identifiable {
        case printer, native
        var id: String { rawValue }
        var title: String {
            switch self {
            case .printer: return "プリンター"
            case .native: return "アプリの画面"
            }
        }
        var en: String {
            switch self {
            case .printer: return "Printers & printing"
            case .native: return "Native screens"
            }
        }
        var icon: String {
            switch self {
            case .printer: return "printer"
            case .native: return "ipad"
            }
        }
        var description: String {
            switch self {
            case .printer: return "Bluetooth・USB でつなぐ・機種・紙幅・自動印刷・ドロア・レシートの出し先・LAN・Wi-Fi・ネットが無いときの印刷"
            case .native: return "ホーム・テーブル・オーダー・会計をアプリの画面で開く（OFF で今までの Web）"
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
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "設定", subtitle: "Settings", userName: model.payload?.userName ?? "", onHome: onHome)
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
                        .padding(20).frame(maxWidth: 900).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 24)
                    }
                    .frame(maxWidth: .infinity)
                }
                .onAppear {
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

    // MARK: - 左：一覧（白い地に黒いタブ。印＋名前は大きく。選んでいるものは青。2026-10-24 Ronnie「背景ではなくタブを黒に」）

    private static let sideWidth: CGFloat = 300

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                sideHeader("このiPad", en: "This iPad")
                ForEach(Page.allCases) { p in
                    sideRow(icon: p.icon, title: p.title, en: p.en, dot: pageStatus(p)?.1, on: sel == .page(p)) { select(.page(p)) }
                }
                if !groups.isEmpty {
                    sideHeader("お店の設定", en: "Store").padding(.top, 18)
                    ForEach(groups) { g in
                        sideRow(icon: g.icon, title: g.label, en: g.en, dot: nil, on: sel == .group(g.id)) { select(.group(g.id)) }
                    }
                }
                Text("TENPO ONE \(AppConfig.version)").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3).padding(.top, 22).padding(.horizontal, 12)
            }
            .padding(.horizontal, 14).padding(.vertical, 16)
        }
        .frame(width: Self.sideWidth)
        .background(Color.white)
        .overlay(alignment: .trailing) { Rectangle().fill(NFColor.line).frame(width: 1) }
    }

    private func select(_ s: Sel) {
        withAnimation(.easeOut(duration: 0.12)) { sel = s }
    }

    private func sideHeader(_ title: String, en: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title).font(.system(size: 12.5, weight: .heavy)).foregroundColor(NFColor.ink3)
            Text(en).font(.system(size: 10.5, weight: .semibold)).foregroundColor(NFColor.ink3.opacity(0.7))
        }
        .padding(.horizontal, 4).padding(.bottom, 4)
    }

    /// 一覧の1行＝黒いタブ（選ぶと青）：印＋名前（下に英語）＋いまの状態の点
    private func sideRow(icon: String, title: String, en: String, dot: Color?, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 48, height: 48)
                    .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white.opacity(on ? 0.22 : 0.12)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 18, weight: .heavy)).foregroundColor(.white).lineLimit(1)
                    Text(en).font(.system(size: 11.5, weight: .medium)).foregroundColor(Color.white.opacity(on ? 0.85 : 0.6)).lineLimit(1)
                }
                Spacer(minLength: 4)
                if let dot {
                    Circle().fill(dot).frame(width: 10, height: 10)
                        .overlay(Circle().stroke(Color.white.opacity(0.6), lineWidth: 1))
                }
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(Color.white.opacity(on ? 0.95 : 0.45))
            }
            .padding(.horizontal, 10).frame(height: 68)
            .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(on ? NFColor.iris : NFColor.navy))
            .shadow(color: Color.black.opacity(on ? 0.18 : 0.10), radius: 6, y: 3)
        }
        .buttonStyle(PressableStyle(scale: 0.98))
    }

    // MARK: - 右：中身

    @ViewBuilder
    private var content: some View {
        switch sel {
        case .page(.printer):
            pageTitle(Page.printer.icon, Page.printer.title, en: Page.printer.en, status: pageStatus(.printer))
            // 印刷はぜんぶここ：つなぐ → 出し先 → LAN → Wi-Fi → ネットが無いとき
            bluetoothCard
            receiptCard
            if !model.lanPrinters.isEmpty { lanCard }
            if !model.wifiPrinters.isEmpty { wifiCard }
            NativeOfflinePrintCard()
        case .page(.native):
            pageTitle(Page.native.icon, Page.native.title, en: Page.native.en, status: pageStatus(.native))
            nativeCard
        case .group(let id):
            if let g = groups.first(where: { $0.id == id }) {
                pageTitle(g.icon, g.label, en: g.en, status: nil)
                itemList(g)
                Text("押すとその画面が開きます（パソコンの管理画面と同じ。管理画面からも同じものを変えられます）")
                    .font(.system(size: 12)).foregroundColor(NFColor.ink3)
            } else {
                Text("左から選んでください").font(.system(size: 14)).foregroundColor(NFColor.ink3)
            }
        }
    }

    /// 右の上：印＋名前（＋いまの状態）
    private func pageTitle(_ icon: String, _ title: String, en: String, status: (String, Color)?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundColor(NFColor.iris)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.irisSoft))
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.system(size: 22, weight: .heavy)).foregroundColor(NFColor.navy)
                    Text(en).font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink3)
                }
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
                        Image(systemName: it.allowed ? g.icon : "lock")
                            .font(.system(size: 15, weight: .semibold)).foregroundColor(it.allowed ? NFColor.iris : NFColor.ink3)
                            .frame(width: 34, height: 34)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(it.allowed ? NFColor.irisSoft : NFColor.lilacSoft))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.title).font(.system(size: 16, weight: .bold)).foregroundColor(it.allowed ? NFColor.ink : NFColor.ink3).lineLimit(1)
                            if !it.description.isEmpty {
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
                    .padding(.horizontal, 14).frame(height: 60)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.99))
                .disabled(!it.allowed)
                if i < g.items.count - 1 { Rectangle().fill(NFColor.line).frame(height: 1).padding(.leading, 60) }
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.05), radius: 6, y: 2)
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
                if let id = model.selectedPrinterId, let pr = model.receiptPrinters.first(where: { $0.id == id }) { return ("出し先：\(pr.name)", NFColor.ink2) }
                return ("Bluetooth・USB のプリンターは使わない", NFColor.ink3)
            }
            if let l = model.link { return ("\(l.deviceName.isEmpty ? l.deviceId : l.deviceName)・つないでいます", NFColor.success) }
            return (model.model == nil ? "機種が未選択" : "まだつないでいません", NFColor.saffron)
        case .native:
            let on = state.adminNativePos ?? nativeOn
            return (on ? "ON（アプリの画面）" : "OFF（今までの画面）", on ? NFColor.success : NFColor.ink3)
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
        case "デバイス管理": return "printer"
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
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundColor(NFColor.iris).frame(width: 28).padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
                        Text(en).font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    Text(description).font(.system(size: 13)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            Rectangle().fill(NFColor.line).frame(height: 1)
            content()
        }
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.05), radius: 6, y: 2)
    }

    private func row<Content: View>(_ label: String, en: String, dim: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 15, weight: .bold)).foregroundColor(dim ? NFColor.ink3 : NFColor.ink)
                Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
            .frame(width: 200, alignment: .leading)
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
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

    private func button(_ text: String, icon: String? = nil, primary: Bool = false, busy: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(primary ? .white : NFColor.iris).scaleEffect(0.8) }
                else if let icon { Image(systemName: icon) }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(primary ? .white : NFColor.ink)
            .padding(.horizontal, 18).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 12).fill(primary ? NFColor.iris : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(primary ? Color.clear : NFColor.line, lineWidth: 1))
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
        return card(icon: "dot.radiowaves.left.and.right", title: "このiPadのプリンター（Bluetooth・USB）", en: "Receipt printer",
                    description: "レシートプリンターとドロア（iPad と Bluetooth・USB）") {
            VStack(spacing: 0) {
                row("プリンター利用", en: "Use printer") {
                    toggle(model.usePrinter, disabled: busy != nil || locked) { Task { await model.toggleUse() } }
                    if busy == "use" { ProgressView() }
                }
                row("プリンター", en: "Printer model", dim: off) {
                    VStack(alignment: .leading, spacing: 6) {
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
                            HStack {
                                Text(model.model.map { "\($0.makerLabel)　\($0.name)" } ?? "選択してください")
                                    .font(.system(size: 15, weight: model.model == nil ? .regular : .bold))
                                    .foregroundColor(model.model == nil ? NFColor.ink3 : NFColor.ink)
                                Spacer()
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 14).frame(height: 48).frame(maxWidth: 520)
                            .background(RoundedRectangle(cornerRadius: 12).fill(off ? NFColor.lilacSoft : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                        }
                        .disabled(off || locked || busy != nil)
                        Text("使えるのは Star・EPSON（Bluetooth・USB）とそのほかの ESC/POS（Bluetooth LE）。SII・Citizen・Brother は準備中です")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                }
                row("接続", en: "Connection", dim: off) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 14) {
                            if let l = model.link {
                                (Text(l.deviceName.isEmpty ? l.deviceId : l.deviceName).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                 + Text("（\(l.via == "usb" ? "USB" : "Bluetooth")・つないでいます）").font(.system(size: 13)).foregroundColor(NFColor.ink3))
                            } else {
                                Text("まだつないでいません").font(.system(size: 15)).foregroundColor(NFColor.ink3)
                            }
                            button(model.link == nil ? "プリンターを探す" : "つなぎ直す", icon: "magnifyingglass", busy: busy == "search",
                                   disabled: off || locked || model.model == nil || busy != nil) { Task { await model.search() } }
                        }
                        if model.model == nil && model.usePrinter {
                            Text("先に「プリンター」で機種を選んでください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        }
                        if let found = model.found { foundList(found) }
                    }
                }
                row("レシート紙幅", en: "Paper width", dim: off) {
                    HStack(spacing: 10) {
                        ForEach([58, 80], id: \.self) { w in
                            Button { model.paper = w } label: {
                                HStack(spacing: 8) {
                                    Circle().stroke(model.paper == w ? NFColor.iris : NFColor.line, lineWidth: model.paper == w ? 6 : 1.5).frame(width: 18, height: 18)
                                    Text("\(w)mm").font(.system(size: 15, weight: .bold))
                                }
                                .foregroundColor(model.paper == w ? NFColor.iris : NFColor.ink2)
                                .padding(.horizontal, 18).frame(height: 44)
                                .background(Capsule().fill(model.paper == w ? NFColor.irisSoft : Color.white))
                                .overlay(Capsule().stroke(model.paper == w ? NFColor.iris : NFColor.line, lineWidth: 1))
                            }
                            .buttonStyle(PressableStyle()).disabled(off || locked)
                        }
                    }
                }
                row("会計レシート自動印刷", en: "Print receipt after checkout", dim: off) {
                    toggle(model.autoPrint, disabled: off || locked) { model.autoPrint.toggle() }
                }
                row("キャッシュドロア利用", en: "Cash drawer", dim: off) {
                    toggle(model.drawer, disabled: off || locked) { model.drawer.toggle() }
                }
                HStack(spacing: 12) {
                    button("試し印刷", icon: "printer", busy: busy == "receipt", disabled: off || model.link == nil || busy != nil) { Task { await model.testBluetooth("receipt") } }
                    button("ドロアを開く", icon: "tray", busy: busy == "drawer", disabled: off || model.link == nil || !model.drawer || busy != nil) { Task { await model.testBluetooth("drawer") } }
                    Spacer()
                    if locked { Text("プリンターの設定は店長以上のアカウントで変えられます").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                    button("保存する", primary: true, busy: busy == "save", disabled: off || locked || model.link == nil || busy != nil) { Task { await model.save() } }
                }
                .padding(.horizontal, 18).padding(.vertical, 14)
                if let t = model.lastTiming {
                    Text("\(t)\n応答完了までの計測です。紙が出始める時刻・カット完了の実測ではありません。")
                        .font(.system(size: 12)).foregroundColor(NFColor.ink3).padding(.horizontal, 18).padding(.bottom, 12)
                }
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

    // MARK: - レシートの出し先

    private var receiptCard: some View {
        card(icon: "printer", title: "レシートの出し先", en: "Receipt printer for this iPad",
             description: "レシート・領収書・会計伝票・ドロアを出すプリンター（このiPadだけ。店の設定は変わりません）") {
            let list = model.receiptPrinters
            if list.isEmpty {
                Text(model.canAdd
                     ? "Wi-Fi・LAN のレシートプリンターはありません。「プリンター（Bluetooth・USB）」でつなぐか、パソコンの 設定 > ハードウェア で追加できます"
                     : "レシート用のプリンターがありません。管理画面（パソコン）の 設定 > ハードウェア で追加してください")
                    .font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18)
            } else {
                let cols = [GridItem(.adaptive(minimum: 300), spacing: 10)]
                LazyVGrid(columns: cols, spacing: 10) {
                    choice("おまかせ（店の既定）", sub: "今まで通り", on: model.selectedPrinterId == nil) { Task { await model.choose(nil) } }
                    ForEach(list) { p in
                        choice(p.name, sub: "\(p.maker ?? "メーカー未設定")・\(p.usageLabel)\(p.ip.map { "・\($0)" } ?? "")", on: model.selectedPrinterId == p.id) { Task { await model.choose(p.id) } }
                    }
                }
                .padding(18)
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
                    Text(label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                    Text(sub).font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).frame(height: 60)
            .background(RoundedRectangle(cornerRadius: 12).fill(on ? NFColor.irisSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy == "choose")
    }

    // MARK: - LAN

    private var lanCard: some View {
        card(icon: "cable.connector", title: "LAN のプリンター（EPSON・SII RP-F10 など）", en: "LAN printers",
             description: "この iPad からお店の LAN でプリンターへ送ります（レシート・厨房・ドリンク）") {
            VStack(spacing: 0) {
                ForEach(model.lanPrinters) { p in
                    let on = model.lanOn(p.id)
                    let needsIpad = p.delivery == "ipad-lan"
                    let st = status(p, on: on)
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(p.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                if let m = p.model { Text(m).font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                            }
                            Text("\(p.maker ?? "メーカー未設定")・\(p.usageLabel)・\(p.lanHost ?? "")\((p.lanPort ?? 9100) != 9100 ? ":\(p.lanPort ?? 9100)" : "")")
                                .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            Text(needsIpad ? "どれか1台の iPad で「このiPadから送る」を ON にしてください" : "プリンター自身（Server Direct Print）でも出ます")
                                .font(.system(size: 12, weight: needsIpad ? .bold : .regular)).foregroundColor(needsIpad ? NFColor.iris : NFColor.ink3)
                            Text(st.0).font(.system(size: 12)).foregroundColor(st.1)
                        }
                        Spacer(minLength: 0)
                        button("試し印刷", busy: model.busy == "\(p.id):receipt", disabled: model.busy != nil) { Task { await model.testLan(p, "receipt") } }
                        if p.usage == "receipt" {
                            button("ドロア", busy: model.busy == "\(p.id):drawer", disabled: model.busy != nil) { Task { await model.testLan(p, "drawer") } }
                        }
                        HStack(spacing: 8) {
                            Text("このiPadから送る").font(.system(size: 13, weight: .bold)).foregroundColor(on ? NFColor.iris : NFColor.ink2)
                            toggle(on) { model.toggleLan(p.id) }
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
            }
        }
    }

    // MARK: - Wi-Fi で直接印刷（EPSON）

    private var wifiCard: some View {
        card(icon: "wifi", title: "Wi-Fi で直接印刷（EPSON・速い）", en: "Direct Wi-Fi printing",
             description: "この iPad からお店の Wi-Fi でプリンターへ直接送ります（約1秒）") {
            VStack(spacing: 0) {
                ForEach(model.wifiPrinters) { p in
                    let on = model.wifiOn(p.id)
                    let st = status(p, on: on)
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                            Text("\(p.usageLabel)・\(p.ip ?? "")").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            Text(st.0).font(.system(size: 12)).foregroundColor(st.1)
                        }
                        Spacer(minLength: 0)
                        button("試し印刷", busy: model.busy == "\(p.id):receipt", disabled: model.busy != nil) { Task { await model.testWifi(p, "receipt") } }
                        if p.usage == "receipt" {
                            button("ドロア", busy: model.busy == "\(p.id):drawer", disabled: model.busy != nil) { Task { await model.testWifi(p, "drawer") } }
                        }
                        HStack(spacing: 8) {
                            Text("このiPadから直接印刷").font(.system(size: 13, weight: .bold)).foregroundColor(on ? NFColor.iris : NFColor.ink2)
                            toggle(on) { model.toggleWifi(p.id) }
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
            }
        }
    }

    // MARK: - Native ON/OFF

    private var nativeCard: some View {
        card(icon: "ipad", title: "アプリのオーダー・会計画面", en: "Native screens",
             description: "ON：ホーム・テーブル・オーダー・会計をアプリの画面で開く（速い）。OFF：今までの Web の画面") {
            // 管理画面が決めているときはその値を見せる（端末の切り替えは効かない）
            let shown = state.adminNativePos ?? nativeOn
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 14) {
                    Text(shown ? "ON（アプリの画面）" : "OFF（今までの画面）").font(.system(size: 15, weight: .bold)).foregroundColor(shown ? NFColor.iris : NFColor.ink2)
                    Spacer()
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
                        .font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
        }
    }
}
