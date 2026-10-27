import SwiftUI

/// ネイティブのオーダー画面（iPad レジ）。Web の「オーダー・会計」と同じ並び：
///   左＝伝票（卓・人数・明細・合計）／右の上＝ページのタブ（1 おすすめ・2 ドリンク…）／
///   右の下＝そのページのカテゴリ（左の列）と検索・商品・Order（スライド）。
/// 会計はここからは行かない（テーブルの「会計」から。2026-10-24 Ronnie）。卓の無いテイクアウトだけ「会計へ」を残す（Web と同じ）。
/// タップしたらすぐ画面に出す（Web より速い）。
struct NativeOrderView: View {
    @ObservedObject var model: NativeOrderModel
    var onHome: () -> Void = {}
    @State private var showCheckout: Bool
    @State private var pickClerk = false
    /// 担当者を選んだあとにすること（注文確定・会計へ）
    @State private var afterClerk: (() -> Void)?
    /// 上のタブの編集（店長以上）
    @State private var editingPages = false
    /// お客様情報（人数・席の時間・モード・コース）の直し
    @State private var guestInfoOpen = false
    @State private var printOpen = false

    /// startInCheckout：テーブルの「レジ会計」から開いたとき。オーダー画面を一瞬も見せず、最初から会計の画面
    /// （2026-10-24 Ronnie「1 sec lai order gamen aaucha、sidai 会計 ma jane banau」）
    init(model: NativeOrderModel, onHome: @escaping () -> Void = {}, startInCheckout: Bool = false) {
        self.model = model
        self.onHome = onHome
        _showCheckout = State(initialValue: startInCheckout)
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(
                storeName: model.storeName, title: "注文・会計", subtitle: "Order & Pay",
                userName: model.clerkName ?? "担当なし",
                onHome: onHome
            )
            GeometryReader { geo in
                let slipW = max(320, geo.size.width * 0.30)
                let catW = max(150, geo.size.width * 0.13)
                HStack(alignment: .top, spacing: 12) {
                    SlipPanel(model: model, onBack: onHome, onClerk: { pickClerk = true }, onGuestInfo: { guestInfoOpen = true }, onPrint: { printOpen = true })
                        .frame(width: slipW)
                    VStack(spacing: 12) {
                        // 上のタブ（ページ）。Web と同じく2つ以上あるときだけ（テイクアウトは出さない）
                        if model.pages.count > 1 {
                            PageTabsBar(model: model, onEdit: { editingPages = true })
                        }
                        HStack(alignment: .top, spacing: 12) {
                            CategoryColumn(model: model)
                                .frame(width: catW)
                            ItemsPanel(model: model, onSend: send, onCheckout: goCheckout)
                        }
                    }
                }
                .padding(12)
            }
            .background(NT.page)
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let n = model.notice {
                Button { model.notice = nil } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text(n).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Image(systemName: "xmark")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.dangerBg))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NT.danger.opacity(0.3), lineWidth: 1))
                    .frame(maxWidth: 720)
                }
                .buttonStyle(.plain)
                .padding(.top, 74)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t)
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NT.header.opacity(0.92)))
                    .padding(.bottom, 100)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        if model.toast == t { model.toast = nil }
                    }
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.toast)
        .overlay {
            if model.loading {
                ZStack {
                    NT.page.opacity(0.85).ignoresSafeArea()
                    ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(OV.primary)
                }
            }
        }
        // 選択肢・金額を選ぶパネル
        .overlay {
            if let p = model.pending {
                NativePendingItemPanel(model: model, pending: p)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.pending)
        // 「その他（金額入力）」のパネル
        .overlay {
            if let t = model.customTarget {
                ZStack {
                    Color.black.opacity(0.38).ignoresSafeArea()
                        .onTapGesture { model.customTarget = nil }
                    NativeCustomPricePad(
                        title: "その他 / Other（\(t.label)）",
                        onCancel: { model.customTarget = nil },
                        onDone: { price, memo in model.addCustom(price: price, memo: memo) }
                    )
                    .frame(maxWidth: 480)
                    .padding(28)
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.customTarget)
        // 上のタブの編集（Web のレジの「編集 Edit tabs」と同じ中身）
        .overlay {
            if editingPages, let sid = model.storeId {
                NativeMenuPagesEditor(storeId: sid, onClose: { editingPages = false }, onSaved: {
                    editingPages = false
                    model.toast = "ページを保存しました（レジ・ハンディ・お客様QRに反映）"
                    model.reloadCatalog()
                })
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: editingPages)
        // 人数・時間を押したら、テーブルで開くのと同じ「お客様情報」（開始時間・時間・人数・モード・コース）
        .overlay {
            if guestInfoOpen {
                NativeOrderGuestInfo(model: model, onClose: { guestInfoOpen = false })
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: guestInfoOpen)
        .overlay {
            if printOpen {
                NativeOrderPrintPanel(model: model, onClose: { printOpen = false })
            }
        }
        // 会計は同じ画面の上に重ねる（fullScreenCover にすると、下の Web が止まって Bluetooth の印刷・ドロアが出ない）
        .overlay {
            if showCheckout {
                // 会計の「×」はオーダー画面に戻らず、テーブル一覧（ホーム）へ（2026-10-24 Ronnie「x click garyo vane home ma aaune」）
                NativeCheckoutView(model: model, onClose: { showCheckout = false; onHome() }, onFinished: {
                    showCheckout = false
                    if model.isLive { AppState.shared.finishNativeCheckout() }
                })
                // 伝票の中身がまだ1つも無いときだけ「読み込み中」をかぶせる（¥0 を一瞬見せない）。
                // 前に読んだ中身があればすぐ出す（2026-10-24 Ronnie「会計 ma jada pani 取込み navai」）。確定ボタンは最新の金額を待つ
                .overlay {
                    if model.isLive && !model.hasOrderData {
                        ZStack {
                            NT.page.opacity(0.92).ignoresSafeArea()
                            ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(OV.primary)
                        }
                    }
                }
                .transition(.move(edge: .trailing))
            }
        }
        .animation(.easeOut(duration: 0.22), value: showCheckout)
        .onReceive(model.$openCheckoutOnLoad) { on in
            if on {
                model.openCheckoutOnLoad = false
                goCheckout()
            }
        }
        .confirmationDialog("担当を選ぶ", isPresented: $pickClerk, titleVisibility: .visible) {
            ForEach(model.clerks, id: \.id) { c in
                Button(c.name) {
                    let then = afterClerk
                    afterClerk = nil
                    Task {
                        await model.setClerk(c.id)
                        then?()
                    }
                }
            }
            Button("キャンセル", role: .cancel) { afterClerk = nil }
        }
        .alert(
            "選択肢を読み直します",
            isPresented: Binding(get: { model.webOnlyItem != nil }, set: { if !$0 { model.webOnlyItem = nil } })
        ) {
            // Web の画面は開かない：メニュー（選択肢）を読み直して、もう一度押してもらう（2026-10-25「101% native」）
            Button("メニューを読み直す") { NativeCatalogCache.shared.refresh(storeId: model.storeId) }
            Button("閉じる", role: .cancel) {}
        } message: {
            Text("「\(model.webOnlyItem.map { $0.name } ?? "")」の選択肢がまだ読めていません。メニューを読み直してから、もう一度押してください。")
        }
    }

    /// 担当者が要る店で、まだ選んでいなければ先に選ぶ（Web のレジと同じ）
    private func requireClerk(_ then: @escaping () -> Void) {
        if model.clerkMissing {
            afterClerk = then
            pickClerk = true
        } else {
            then()
        }
    }

    /// Order（スライド）→ 送れたらテーブル一覧へ自動で戻る（2026-10-27 02:52 Ronnie「order garera slide garepaxi table ma 自動 return」）。
    /// 戻らないとき：卓の無いテイクアウト等（ここで会計するので）・見本・送れなかったとき・厨房伝票の警告が出たとき（読んでもらう）
    private func send() {
        requireClerk {
            Task {
                let ok = await model.sendToKitchen()
                guard ok, model.isLive, !model.order.takeoutLike, model.notice == nil else { return }
                // スライドの ✓ を一瞬見せてから
                try? await Task.sleep(nanoseconds: 250_000_000)
                onHome()
            }
        }
    }

    /// 会計へ：まだ送っていないカートは先に注文確定（伝票に入れて厨房へ）
    private func goCheckout() {
        requireClerk {
            Task {
                if !model.cartLines.isEmpty {
                    guard await model.sendToKitchen() else { return }
                }
                showCheckout = true
            }
        }
    }
}

// MARK: - 色（注文・会計の画面だけ）

/// 注文・会計の画面の色。2026-10-27 02:50 Ronnie「yo sabai yesari color ma milau but system ra place haru hoina」
/// → 青をやめ、ホームと同じ紫紺・うすい灰色・白に（並び・仕組み・言葉はそのまま）。
/// Order のスライドはホームの左の選んだボタンと同じ黄色（02:52「menu bar ma click garda aaune yello style」）
enum OV {
    /// 選んだタブ・カテゴリ（ホームの左のバーと同じ紫紺）
    static let primary = Color(hex: 0x37324D)
    /// 濃い字（卓名・合計・値段）
    static let ink = Color(hex: 0x2B2740)
    /// うすい灰色（チップ・数量の − ＋ の地）
    static let soft = Color(hex: 0xEFF0F4)
    /// 箱の線
    static let line = Color(hex: 0xE3E5EA)
    /// 黄色（ホームの左のバーで選んだボタン・Order のスライドのつまみ・ホームのボタン）
    static let yellow = Color(hex: 0xF2D06B)
    /// Order のスライドの下の影（紫紺を少し濃く）
    static let primaryDeep = Color(hex: 0x24203A)
}

// MARK: - 上のバー

/// 上のバーの「ホームへ」ボタン＝ホームの左のバーの「ホーム」と同じ（黄色の箱に線の家の印。ロゴは入れない）
/// （2026-10-27 02:57 Ronnie「home button yello」→ 03:24「tenpo one ko logo pardaina、home ko menu bar ma vayeko jasto home button」）
struct NativeHomeLogo: View {
    var body: some View {
        Image(systemName: "house")
            .font(.system(size: 21, weight: .regular))
            .foregroundColor(OV.ink)
            .frame(width: 46, height: 40)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(OV.yellow))
    }
}

/// 家の形（三角の屋根＋四角）
struct NativeHouseShape: Shape {
    func path(in r: CGRect) -> Path {
        let roof = r.height * 0.45
        let inset = r.width * 0.13
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY + roof))
        p.addLine(to: CGPoint(x: r.maxX - inset, y: r.minY + roof))
        p.addLine(to: CGPoint(x: r.maxX - inset, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + inset, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + inset, y: r.minY + roof))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + roof))
        p.closeSubpath()
        return p
    }
}

/// 上のバーの右に出す白いボタン
struct NativeTopBarButton {
    let icon: String
    let label: String
    let action: () -> Void
}

struct NativeTopBar: View {
    /// 店名は上のバーには出さない（ホームだけ。2026-10-24 18:55 Ronnie「店舗名は home 画面だけ、ほかはいらない」）。呼び出し側の形はそのまま
    /// 店名のあった場所（左）に画面の名前（店舗台帳・オーダー・会計・設定 …）を出す（18:56 Ronnie）
    let storeName: String
    let title: String
    let subtitle: String
    var userName: String = ""
    var onHome: () -> Void = {}
    /// 左上のボタンは字なしのアイコンだけ（2026-10-24 18:57 Ronnie「ブラウザの戻るに見える、ホームの印だけ」）。
    /// ホームへ戻る画面は家の印、設定の中の画面・詳細など1つ前へ戻る画面は ‹
    var backIcon: String = "house.fill"
    /// 今までの（Web の）画面で開く。ライブのときだけ
    var onWeb: (() -> Void)? = nil
    /// 右の白いボタン（注文・会計の「メニュー在庫管理」など。2026-10-27 01:45 Ronnie の見本）
    var accessory: NativeTopBarButton? = nil

    var body: some View {
        HStack(spacing: 10) {
            iconButton(backIcon, label: backIcon == "house.fill" ? "ホーム" : "戻る", action: onHome)
            // TENPO ONE のマークは上のバーに出さない（2026-10-24 19:04 Ronnie「ロゴは要らない」）
            // 画面の名前（店名のあった場所に、同じ丸い枠で）
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.system(size: 17, weight: NT.strong)).foregroundColor(.white)
                    if !subtitle.isEmpty {
                        // 画面の名前の英語はどの画面も同じ黄色（2026-10-27 03:19 Ronnie「menu ko name ko color sabailai same」）
                        Text(subtitle).font(.system(size: 12, weight: .bold)).foregroundColor(OV.yellow)
                    }
                }
                .fixedSize()
                Text(title).font(.system(size: 17, weight: NT.strong)).foregroundColor(.white).lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.10)))
            Spacer(minLength: 8)
            if let a = accessory {
                Button(action: a.action) {
                    HStack(spacing: 8) {
                        Image(systemName: a.icon).font(.system(size: 17, weight: .regular))
                        Text(a.label).font(.system(size: 15, weight: .medium)).lineLimit(1)
                    }
                    .foregroundColor(Color(hex: 0x2B2740))
                    .padding(.horizontal, 16).frame(height: 40)
                    .background(Capsule().fill(Color.white))
                    .overlay(Capsule().stroke(Color(hex: 0xE2E2EA), lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
            HStack(spacing: 6) {
                Image(systemName: "person")
                Text(userName).lineLimit(1)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.10)))
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(NT.topBar)
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if icon == "house.fill" {
                // ホームへ戻るボタンは TENPO ONE のロゴ（2026-10-24 19:22 Ronnie「ホームのボタンの中にロゴ」）
                NativeHomeLogo()
            } else {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 46, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.10)))
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }

}

// MARK: - 左：伝票

private struct SlipPanel: View {
    @ObservedObject var model: NativeOrderModel
    /// 卓名の左の ← （上のバーの左のボタンと同じ「戻る」。2026-10-25 19:08 Ronnie「T10 ko left ma vayeko ← button pani click hune banau」）
    var onBack: () -> Void = {}
    var onClerk: () -> Void = {}
    /// 人数・時間を押したとき（お客様情報の直し。卓のある伝票だけ）
    var onGuestInfo: () -> Void = {}
    var onPrint: () -> Void = {}
    /// 取消しようとしている品（送った品。店長以上の担当者を選んでから取消。Web のレジと同じ）
    @State private var cancelTarget: NPOrderLine?

    var body: some View {
        VStack(spacing: 0) {
            // 卓・人数・伝票番号
            HStack(spacing: 10) {
                Button(action: onBack) {
                    Image(systemName: "arrow.left").font(.system(size: 18, weight: .bold)).foregroundColor(NT.ink2)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle())
                .padding(.leading, -12)
                .padding(.trailing, -6)
                .accessibilityLabel("戻る")
                Text(model.order.tableName).font(.system(size: 32, weight: NT.strong)).foregroundColor(OV.ink)
                Button(action: onGuestInfo) {
                    HStack(spacing: 4) {
                        Image(systemName: "person.2")
                        Text(verbatim: "\(model.order.guestCount)名")
                        if canEditGuest { Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)) }
                    }
                    .lineLimit(1)
                    .fixedSize()
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(NT.ink2)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Capsule().fill(OV.soft))
                }
                .buttonStyle(PressableStyle())
                .disabled(!canEditGuest)
                .accessibilityLabel("お客様情報（人数・席の時間）を変更する")
                Spacer()
                Text(verbatim: model.order.noLabel).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)

            // 顧客・時間・担当
            VStack(alignment: .leading, spacing: 8) {
                WrapLayout(spacing: 8) {
                    chip(icon: "person", text: model.order.customerName ?? "顧客未設定")
                    if let from = model.order.seatFrom, let to = model.order.seatTo {
                        Button(action: onGuestInfo) { chip(icon: "clock", text: "\(from)〜\(to)") }
                            .buttonStyle(PressableStyle())
                            .disabled(!canEditGuest)
                    }
                    // 来店経路（booking source）
                    let source = (NPVisitSource.defaults + NPVisitSource.extras).first { $0.id == model.order.visitSourceId }
                    chip(icon: "signpost.right", text: source?.label ?? "経路なし")
                }
                Button(action: onClerk) {
                    HStack(spacing: 4) {
                        Text("担当: \(model.clerkName ?? "未設定")")
                        if !model.clerks.isEmpty { Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)) }
                    }
                    .font(.system(size: 13, weight: model.clerkMissing ? .bold : .medium))
                    .foregroundColor(model.clerkMissing ? NT.danger : NT.ink2)
                }
                .buttonStyle(.plain)
                .disabled(model.clerks.isEmpty)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider().overlay(NT.line)

            // 明細
            if model.order.lines.isEmpty {
                Spacer()
                Text("商品をタップして追加")
                    .multilineTextAlignment(.center)
                    .font(.system(size: 15)).foregroundColor(NT.ink3)
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(model.order.lines) { line in
                                LineRow(line: line, highlighted: line.id == model.lastAddedLineId,
                                        editable: model.canChange(line),
                                        onMinus: { model.change(line, by: -1) },
                                        onPlus: { model.change(line, by: 1) },
                                        onCancel: { cancel(line) })
                                    .id(line.id)
                                Divider().overlay(NT.line).padding(.leading, 16)
                            }
                        }
                    }
                    .onChange(of: model.lastAddedLineId) { id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id, anchor: .bottom) }
                    }
                }
            }

            // 合計
            VStack(spacing: 6) {
                Divider().overlay(NT.line)
                totalRow("小計", NT.yen(model.subtotal))
                totalRow("消費税", NT.yen(model.tax))
                Divider().overlay(NT.line)
                HStack(alignment: .lastTextBaseline) {
                    Text("合計（税込）").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink)
                    Spacer()
                    Text(NT.yen(model.total)).font(.system(size: 34, weight: NT.strong)).foregroundColor(OV.ink)
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.15), value: model.total)
                }
                Button(action: onPrint) {
                    Label("印刷 / Print", systemImage: "printer")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(OV.primary)
                        .frame(maxWidth: .infinity).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(OV.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy || !model.isLive)
            }
            .padding(.horizontal, 16).padding(.bottom, 14)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(OV.line, lineWidth: 1))
        // 1品の取消：理由は要らない・担当者を選ぶだけ。毎回選ぶ（2026-10-24 Ronnie「every time 取消 garda 担当選択」）。
        // 店に店長以上がいれば店長以上から（サーバーで承認を確かめる）、いなければ担当者から（「担当: 〇〇」を理由に残す）
        .confirmationDialog(
            "「\(cancelTarget?.displayName ?? "")」を取消しますか？",
            isPresented: Binding(get: { cancelTarget != nil }, set: { if !$0 { cancelTarget = nil } }),
            titleVisibility: .visible
        ) {
            if let line = cancelTarget {
                if !model.approvers.isEmpty {
                    ForEach(model.approvers, id: \.id) { a in
                        Button("担当: \(a.name)", role: .destructive) { Task { await model.cancelLine(line, approver: a.id) } }
                    }
                } else if !model.clerks.isEmpty {
                    ForEach(model.clerks, id: \.id) { c in
                        Button("担当: \(c.name)", role: .destructive) { Task { await model.cancelLine(line, approver: nil, reason: "担当: \(c.name)") } }
                    }
                } else {
                    Button("取消する", role: .destructive) { Task { await model.cancelLine(line, approver: nil) } }
                }
            }
            Button("キャンセル", role: .cancel) { cancelTarget = nil }
        } message: {
            Text(cancelMessage)
        }
    }

    private var cancelMessage: String {
        let who = !model.approvers.isEmpty ? "取消する担当者（店長以上）を選んでください" : (!model.clerks.isEmpty ? "取消する担当者を選んでください" : "")
        let sent = cancelTarget?.sent ?? false
        let paper = sent ? "厨房へ送った品は、レジと厨房に「取消」の伝票が出ます" : ""
        return [who, paper].filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// 左へスライドの「取消」：毎回、担当者を選んでから（カートの品も）
    private func cancel(_ line: NPOrderLine) {
        cancelTarget = line
    }

    /// 人数・時間を直せるか（卓のある伝票だけ。テイクアウト等は卓が無い）
    private var canEditGuest: Bool { model.isLive && !model.offline && !model.order.takeoutLike }

    private func chip(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
            Text(text)
        }
        .font(.system(size: 13, weight: .bold))
        .foregroundColor(NT.ink2)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Capsule().fill(OV.soft))
    }

    private func totalRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 15)).foregroundColor(NT.ink2)
            Spacer()
            Text(value).font(.system(size: 15, weight: .medium)).foregroundColor(NT.ink2)
        }
    }
}

private struct LineRow: View {
    let line: NPOrderLine
    let highlighted: Bool
    var editable: Bool = true
    let onMinus: () -> Void
    let onPlus: () -> Void
    /// 左へスライド →「取消」（1品の取消。送った品は担当者を選んでから。2026-10-24 Ronnie「slide left garepaxi cancel、担当選択」）
    var onCancel: () -> Void = {}

    /// 左へずらした量（0〜−revealW。指を離すと「取消」を出したまま／戻す）
    @State private var offset: CGFloat = 0
    @State private var dragging = false
    @State private var startOffset: CGFloat = 0
    private let revealW: CGFloat = 104

    var body: some View {
        ZStack(alignment: .trailing) {
            // 後ろの赤い「取消」（左へずらすと見える）
            Button {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) { offset = 0 }
                onCancel()
            } label: {
                VStack(spacing: 3) {
                    Image(systemName: "trash").font(.system(size: 17, weight: .bold))
                    Text("取消").font(.system(size: 14, weight: NT.strong))
                }
                .foregroundColor(.white)
                .frame(width: max(revealW, -offset))
                .frame(maxHeight: .infinity)
                .background(NT.danger)
            }
            .buttonStyle(.plain)
            .opacity(offset < 0 ? 1 : 0)
            .accessibilityHidden(offset == 0)

            row
                .background(NT.card)
                .contentShape(Rectangle())
                // 「取消」を出しているときに行を押したら戻す
                .onTapGesture { if offset != 0 { withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) { offset = 0 } } }
                .offset(x: offset)
        }
        .clipped()
        // 横に動かしたときだけ（縦のスクロールは邪魔しない）
        .simultaneousGesture(
            DragGesture(minimumDistance: 14)
                .onChanged { v in
                    guard editable else { return }
                    let dx = v.translation.width, dy = v.translation.height
                    guard dragging || abs(dx) > abs(dy) * 1.4 else { return }
                    if !dragging { dragging = true; startOffset = offset }
                    offset = min(0, max(-revealW * 2.2, startOffset + dx))
                }
                .onEnded { v in
                    guard dragging else { return }
                    dragging = false
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                        if offset < -revealW * 1.6 {
                            // 大きくスライド → そのまま取消（送った品は担当者を選ぶ）
                            offset = 0
                            onCancel()
                        } else if offset < -revealW * 0.45 {
                            offset = -revealW
                        } else {
                            offset = 0
                        }
                    }
                }
        )
        .accessibilityAction(named: "取消") { if editable { onCancel() } }
    }

    private var row: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(line.displayName).font(.system(size: 16, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2)
                if let jp = line.japaneseSub {
                    Text(jp).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
                }
                if let opts = line.optionLabel {
                    Text(opts).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink2).lineLimit(2)
                }
                HStack(spacing: 6) {
                    Text(NT.yen(line.unitPrice)).font(.system(size: 12)).foregroundColor(NT.ink3)
                    Text(line.sent ? "送信済" : "未送信")
                        .font(.system(size: 11, weight: .bold))
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundColor(line.sent ? NT.ok : NT.warn)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill((line.sent ? NT.ok : NT.warn).opacity(0.12)))
                }
            }
            Spacer(minLength: 6)
            if editable {
                HStack(spacing: 0) {
                    // 送った品は 1 より下にしない（0 にするのは左へスライドの「取消」）
                    stepButton("minus", action: onMinus)
                        .disabled(!line.local && line.quantity <= 1)
                        .opacity(!line.local && line.quantity <= 1 ? 0.35 : 1)
                    Text("\(line.quantity)").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink).frame(minWidth: 30)
                    stepButton("plus", action: onPlus)
                }
                .background(Capsule().fill(OV.soft))
            } else {
                Text(verbatim: "×\(line.quantity)").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2).frame(minWidth: 44)
            }
            Text(NT.yen(line.lineTotal))
                .font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                .frame(minWidth: 74, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(highlighted ? OV.soft : Color.clear)
        .animation(.easeOut(duration: 0.3), value: highlighted)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: NT.strong)).foregroundColor(OV.ink)
                .frame(width: 36, height: 34)
        }
        .buttonStyle(PressableStyle(scale: 0.9))
    }
}

// MARK: - 右の上：ページのタブ

/// 上のタブ（ページ）。番号・日本語を大きく・英語を小さく（Web のレジのタブと同じ並び）。押すとそのページの最初のカテゴリ
private struct PageTabsBar: View {
    @ObservedObject var model: NativeOrderModel
    var onEdit: () -> Void = {}

    var body: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(model.pages.enumerated()), id: \.element.id) { i, pg in
                        let on = pg.id == model.currentPage?.id && model.search.isEmpty
                        Button { model.openPage(pg) } label: {
                            HStack(spacing: 10) {
                                Text(verbatim: "\(i + 1)")
                                    .font(.system(size: 14, weight: NT.strong)).monospacedDigit()
                                    .foregroundColor(on ? .white : NT.ink3)
                                    .frame(width: 28, height: 28)
                                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(on ? Color.white.opacity(0.18) : OV.soft))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(pg.name).font(.system(size: 18, weight: NT.strong)).lineLimit(1)
                                    if let sub = pg.sub {
                                        Text(sub).font(.system(size: 11, weight: .semibold)).opacity(0.75).lineLimit(1)
                                    }
                                }
                                .foregroundColor(on ? .white : NT.ink)
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 58)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? OV.primary : Color.clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(7)
            }
            // タブの順番・名前・中身を店で変える（2026-10-02 FULL MOoN 御茶ノ水。店長以上）
            if model.canEditPages {
                Button(action: onEdit) {
                    VStack(spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil").font(.system(size: 13, weight: .bold))
                            Text("編集").font(.system(size: 14, weight: .bold))
                        }
                        Text("Edit tabs").font(.system(size: 10, weight: .semibold)).opacity(0.75)
                    }
                    .foregroundColor(NT.ink3)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 58)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OV.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .padding(.trailing, 7)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(OV.line, lineWidth: 1))
    }
}

// MARK: - 中：カテゴリ（いま開いているページの中身だけ）

private struct CategoryColumn: View {
    @ObservedObject var model: NativeOrderModel

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(model.pageCategories) { cat in
                    let selected = cat.id == model.selectedCategory && model.search.isEmpty
                    Button {
                        model.search = ""
                        model.selectedCategory = cat.id
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            // 日本語を大きく・英語を小さく下に（2026-10-24 Ronnie）
                            Text(cat.name).font(.system(size: 19, weight: NT.strong)).lineLimit(2).minimumScaleFactor(0.8)
                            if let sub = cat.sub, sub != cat.name {
                                Text(sub).font(.system(size: 12, weight: .medium)).opacity(0.75).lineLimit(1)
                            }
                        }
                        .foregroundColor(selected ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
                        .padding(.horizontal, 16)
                        .background(selected ? OV.primary : Color.clear)
                    }
                    .buttonStyle(PressableStyle(scale: 0.99))
                    Divider().overlay(NT.line)
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(OV.line, lineWidth: 1))
    }
}

// MARK: - 右：商品

private struct ItemsPanel: View {
    @ObservedObject var model: NativeOrderModel
    let onSend: () -> Void
    let onCheckout: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundColor(NT.ink3)
                TextField("検索（日本語 / カナ / English）", text: $model.search)
                    .font(.system(size: 17))
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                if !model.search.isEmpty {
                    Button { model.search = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3)
                    }
                }
            }
            .padding(.horizontal, 16).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OV.line, lineWidth: 1.5))
            .padding(14)
            Divider().overlay(NT.line)

            ScrollView {
                // 1行に4つ（2026-10-27 03:02 Ronnie「menu items haru yeuta row ma 4 ota banau」）
                let cols = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)
                LazyVGrid(columns: cols, spacing: 12) {
                    ForEach(model.visibleItems) { item in
                        ItemTile(item: item, qty: model.qtyInOrder(item)) { model.add(item) }
                    }
                    // 最後に「その他（金額入力）」。お客様が何か追加したとき金額と内容を打って入れる（Web と同じ。2026-10-07 Ronnie）
                    if let t = model.customTile {
                        Button { model.customTarget = t } label: {
                            VStack(spacing: 5) {
                                Image(systemName: "square.and.pencil").font(.system(size: 20, weight: .bold))
                                Text("Other").font(.system(size: 17, weight: NT.strong))
                                Text("その他・金額入力").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                            }
                            .foregroundColor(OV.primary)
                            .frame(maxWidth: .infinity, minHeight: 112)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(OV.soft.opacity(0.7)))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(OV.primary.opacity(0.35), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                        }
                        .buttonStyle(PressableStyle(scale: 0.95))
                        .disabled(model.busy)
                        .accessibilityLabel("\(t.label)：その他（金額を入力）")
                    }
                }
                .padding(14)
            }

            if !model.registerOpen {
                Text("レジが未開局です。会計の前に「レジクローズ」画面で釣銭準備金を数えてレジを開局してください")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(NT.dangerBg))
                    .padding(.horizontal, 14)
            }

            Divider().overlay(NT.line)
            HStack(spacing: 14) {
                // 決定はスライドで（押し間違いで注文が飛ばない。Web と同じ）
                NativeSlideToConfirm(
                    label: model.unsentCount > 0 ? "Order（\(model.unsentCount)品）" : "Order（未確定なし）",
                    hint: "スライドして注文 / Slide to order",
                    disabled: model.unsentCount == 0 || model.busy,
                    busy: model.busy,
                    onConfirm: onSend
                )
                // テーブルのある伝票は テーブルの「会計」から。卓の無いテイクアウト等はここからしか会計できないので残す（Web と同じ）
                if model.order.takeoutLike {
                    Button(action: onCheckout) {
                        VStack(spacing: 1) {
                            Text("会計へ（\(NT.yen(model.total))）").font(.system(size: 20, weight: NT.strong))
                            Text("Checkout").font(.system(size: 11, weight: .bold)).opacity(0.8)
                        }
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .foregroundColor(OV.primary)
                        .frame(maxWidth: .infinity, minHeight: 70)
                        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(OV.soft))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.total == 0 || model.busy || !model.canCheckout)
                }
            }
            .padding(14)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(OV.line, lineWidth: 1))
    }
}

private struct ItemTile: View {
    let item: NPMenuItem
    let qty: Int
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                Text(item.name)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(item.soldOut ? NT.ink3 : NT.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if let en = item.english, en != item.name {
                    Text(en).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Text(NT.yen(item.price))
                    .font(.system(size: 19, weight: NT.strong))
                    .foregroundColor(item.soldOut ? NT.ink3 : OV.ink)
                if item.hasOptions || item.openPrice {
                    Text(item.openPrice ? "金額入力" : "オプション").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 112)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(item.soldOut ? Color(hex: 0xF4F2F7) : NT.card))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(qty > 0 ? OV.primary : OV.line, lineWidth: qty > 0 ? 2 : 1))
            .overlay(alignment: .topTrailing) {
                if qty > 0 {
                    Text("\(qty)")
                        .font(.system(size: 14, weight: NT.strong)).foregroundColor(.white)
                        .frame(minWidth: 26, minHeight: 26)
                        .background(Circle().fill(OV.primary))
                        .offset(x: 6, y: -6)
                }
            }
            .overlay {
                if item.soldOut {
                    Text("売り切れ")
                        .font(.system(size: 13, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(NT.danger))
                        .rotationEffect(.degrees(-8))
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .disabled(item.soldOut)
    }
}
