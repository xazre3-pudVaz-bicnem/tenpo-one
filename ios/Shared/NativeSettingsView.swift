import SwiftUI

// ネイティブの設定画面（iPad レジ。2026-10-24 Ronnie「iOS プリンター＋設定」）。Web の /app/pos/settings「レジの設定」と同じ並び：
//   このiPadのプリンター（Bluetooth・USB。Airレジの「レジ・プリンター」と同じ：プリンター利用・機種・接続・紙幅・自動印刷・ドロア・試し印刷・保存）
//   → レシートの出し先 → LAN のプリンター → Wi-Fi で直接印刷（EPSON） → アプリのオーダー・会計画面（Native ON/OFF）
//   → レジから変えられる設定（Web の各画面へ） → 管理画面の設定（Web の設定のまとめへ）
// 印刷そのものはアプリ自身の印刷係（NativePrintAgent）が出す。ここはその状態（接続中・つながらない）も見せる。

struct NativeSettingsView: View {
    @ObservedObject var model: NativeSettingsModel
    @ObservedObject private var printConfig = NativePrintConfig.shared
    @ObservedObject private var agent = NativePrintAgent.shared
    @EnvironmentObject var state: AppState
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var nativeOn = AppState.shared.nativePosEnabled

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "設定", subtitle: "Settings", userName: model.payload?.userName ?? "", onHome: onHome)
            if model.payload != nil {
                ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let n = agent.notice, let at = agent.noticeAt, Date().timeIntervalSince(at) < 600 {
                            noticeBar(n)
                        }
                        bluetoothCard
                        receiptCard
                        if !model.lanPrinters.isEmpty { lanCard.id("lan") }
                        if !model.wifiPrinters.isEmpty { wifiCard }
                        nativeCard.id("native")
                        sectionsCard.id("sections")
                        hubsCard
                        Text("TENPO ONE \(AppConfig.version)").font(.system(size: 12)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity, alignment: .center).padding(.top, 6)
                            .id("bottom")
                    }
                    .padding(16).frame(maxWidth: 980).frame(maxWidth: .infinity)
                    .padding(.bottom, 24)
                }
                .onAppear {
                    // 見本（-tenpoNativePreview settings）で下の方を確かめる用
                    if let to = UserDefaults.standard.string(forKey: "tenpoNativePreviewScroll"), !to.isEmpty {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { proxy.scrollTo(to, anchor: to == "bottom" ? .bottom : .top) }
                    }
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
        .background(NFColor.lilac.ignoresSafeArea())
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
                    description: "レシートプリンターとドロアは iPad と Bluetooth・USB でつなぎます（厨房・ドリンクのプリンターは LAN・Wi-Fi）") {
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
             description: "レシート・領収書・会計伝票・ドロア・レジ精算をどのプリンターに出すか、このiPadだけで選びます（店の設定は変わりません）。上の Bluetooth のプリンターをつなぐと、そのプリンターになります") {
            let list = model.receiptPrinters
            if list.isEmpty {
                Text(model.canAdd
                     ? "Wi-Fi・LAN のレシートプリンターはありません。上の「このiPadのプリンター」（Bluetooth・USB）でつなぐか、パソコンの 設定 > ハードウェア で追加できます"
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
             description: "この iPad から、お店の LAN（有線・Wi-Fi）でプリンターへ送ります。レシートも厨房・ドリンクの伝票も出ます。SII RP-F10 は自分から印刷を取りに来られないので、この方法で出します（レジの iPad は TENPO ONE アプリを開いたままに）") {
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
             description: "ON にすると、このiPadからお店の Wi-Fi でプリンターへ直接送ります（約1秒）。つながらないときは、今まで通りプリンター自身が印刷します。アプリでは証明書の許可は要りません（iPad とプリンターを同じ Wi-Fi に）") {
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
             description: "ON（既定）：この iPad では、ホーム・テーブル一覧・オーダー・会計・店舗台帳・設定などがアプリの画面（同じ並び・速い）で開き、印刷もアプリ自身が出します。OFF にすると今まで通りの Web の画面です") {
            HStack(spacing: 14) {
                Text(nativeOn ? "ON（アプリの画面）" : "OFF（今までの画面）").font(.system(size: 15, weight: .bold)).foregroundColor(nativeOn ? NFColor.iris : NFColor.ink2)
                Spacer()
                toggle(nativeOn) {
                    nativeOn.toggle()
                    // OFF：Web の「レジの設定」を読み直す（Web 側のトグルも OFF で出る・印刷係は Web に戻る）
                    state.setNativePos(nativeOn, reloadWeb: true)
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
        }
    }

    // MARK: - レジから変えられる設定（Web の各画面へ）

    private var sectionsCard: some View {
        card(icon: "slider.horizontal.3", title: "レジから変えられる設定", en: "Register settings",
             description: "品切れ・メニュー・キッチンの振り分け・テーブルQR・ハンディ・担当者・予約・営業時間。押すとその画面が開きます（上の「レジの設定に戻る」でここに戻ります）") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.payload?.sections ?? []) { s in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(s.title).font(.system(size: 14, weight: .heavy)).foregroundColor(NFColor.navy)
                            Text(s.en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
                        }
                        let cols = [GridItem(.adaptive(minimum: 300), spacing: 10)]
                        LazyVGrid(columns: cols, spacing: 10) {
                            ForEach(s.links) { l in linkTile(l) }
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
            }
        }
    }

    private func linkTile(_ l: NSTLink) -> some View {
        Button { onWeb(l.url) } label: {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.title).font(.system(size: 14, weight: .bold)).foregroundColor(l.allowed ? NFColor.ink : NFColor.ink3).multilineTextAlignment(.leading)
                    Text(l.allowed ? l.description : (l.hint ?? "権限がありません")).font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: l.allowed ? "chevron.right" : "lock").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 64)
            .background(RoundedRectangle(cornerRadius: 12).fill(l.allowed ? NFColor.lilacSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!l.allowed)
    }

    // MARK: - 管理画面の設定（まとめ）

    private var hubsCard: some View {
        card(icon: "gearshape.2", title: "管理画面の設定", en: "All settings",
             description: "店舗・メニュー・デバイス管理・予約・顧客・会計・運用・管理。パソコンの管理画面と同じ画面が開きます") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.payload?.hubs ?? []) { h in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(h.label).font(.system(size: 14, weight: .heavy)).foregroundColor(NFColor.navy)
                            Text(h.en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
                        }
                        WrapLayout(spacing: 8) {
                            ForEach(h.children, id: \.href) { c in
                                Button { onWeb(c.href) } label: {
                                    HStack(spacing: 6) {
                                        Text(c.label).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                                    }
                                    .padding(.horizontal, 14).frame(height: 42)
                                    .background(Capsule().fill(Color.white))
                                    .overlay(Capsule().stroke(NFColor.line, lineWidth: 1))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
            }
        }
    }
}
