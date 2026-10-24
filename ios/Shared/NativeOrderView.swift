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
                storeName: model.storeName, title: "オーダー・会計", subtitle: "オーダー・会計",
                userName: model.clerkName ?? "担当なし",
                onHome: onHome
            )
            GeometryReader { geo in
                let slipW = max(320, geo.size.width * 0.30)
                let catW = max(150, geo.size.width * 0.13)
                HStack(alignment: .top, spacing: 12) {
                    SlipPanel(model: model, onClerk: { pickClerk = true }, onGuestInfo: { guestInfoOpen = true })
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
                    ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(NT.purple)
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
                            ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(NT.purple)
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
            "今までの画面で",
            isPresented: Binding(get: { model.webOnlyItem != nil }, set: { if !$0 { model.webOnlyItem = nil } })
        ) {
            Button("今までの画面を開く") { model.openInWeb() }
            Button("閉じる", role: .cancel) {}
        } message: {
            Text("「\(model.webOnlyItem.map { $0.name } ?? "")」は選択肢があります。今までの画面で追加してください。")
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

    private func send() {
        requireClerk { Task { await model.sendToKitchen() } }
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

// MARK: - 上のバー

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

    var body: some View {
        HStack(spacing: 10) {
            iconButton(backIcon, label: backIcon == "house.fill" ? "ホーム" : "戻る", action: onHome)
            Image("BrandMark")
                .resizable()
                .scaledToFit()
                .frame(width: 38, height: 38)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            // 画面の名前（店名のあった場所に、同じ丸い枠で）
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                    Text(subtitle).font(.system(size: 12, weight: .bold)).foregroundColor(Color(hex: 0xC9B6F5))
                }
                .fixedSize()
                Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(.white).lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.10)))
            Spacer(minLength: 8)
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
        .background(NT.header)
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 46, height: 40)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.10)))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }

}

// MARK: - 左：伝票

private struct SlipPanel: View {
    @ObservedObject var model: NativeOrderModel
    var onClerk: () -> Void = {}
    /// 人数・時間を押したとき（お客様情報の直し。卓のある伝票だけ）
    var onGuestInfo: () -> Void = {}
    /// 取消しようとしている品（送った品。店長以上の担当者を選んでから取消。Web のレジと同じ）
    @State private var cancelTarget: NPOrderLine?

    var body: some View {
        VStack(spacing: 0) {
            // 卓・人数・伝票番号
            HStack(spacing: 10) {
                Image(systemName: "arrow.left").font(.system(size: 18, weight: .bold)).foregroundColor(NT.ink2)
                Text(model.order.tableName).font(.system(size: 32, weight: .heavy)).foregroundColor(NT.purple)
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
                    .background(Capsule().fill(NT.lilac))
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
                    Text(NT.yen(model.total)).font(.system(size: 34, weight: .heavy)).foregroundColor(NT.purple)
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.15), value: model.total)
                }
                // 伝票の操作（新しい伝票・まとめる・卓を移動・会計伝票・注文取消）はオーダー画面に出さない。
                // テーブルのポップアップから（2026-10-24 Ronnie「order vitra yo pardaina」）
            }
            .padding(.horizontal, 16).padding(.bottom, 14)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
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
        .background(Capsule().fill(NT.lilac))
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
                    Text("取消").font(.system(size: 14, weight: .heavy))
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
                .background(Capsule().fill(NT.lilac))
            } else {
                Text(verbatim: "×\(line.quantity)").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2).frame(minWidth: 44)
            }
            Text(NT.yen(line.lineTotal))
                .font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                .frame(minWidth: 74, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(highlighted ? NT.lilac.opacity(0.7) : Color.clear)
        .animation(.easeOut(duration: 0.3), value: highlighted)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purple)
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
                                    .font(.system(size: 14, weight: .heavy)).monospacedDigit()
                                    .foregroundColor(on ? .white : NT.ink3)
                                    .frame(width: 28, height: 28)
                                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(on ? Color.white.opacity(0.22) : NT.lilac))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(pg.name).font(.system(size: 18, weight: .heavy)).lineLimit(1)
                                    if let sub = pg.sub {
                                        Text(sub).font(.system(size: 11, weight: .semibold)).opacity(0.75).lineLimit(1)
                                    }
                                }
                                .foregroundColor(on ? .white : NT.ink)
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 58)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? NT.purple : Color.clear))
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
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .padding(.trailing, 7)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
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
                            Text(cat.name).font(.system(size: 19, weight: .heavy)).lineLimit(2).minimumScaleFactor(0.8)
                            if let sub = cat.sub, sub != cat.name {
                                Text(sub).font(.system(size: 12, weight: .medium)).opacity(0.75).lineLimit(1)
                            }
                        }
                        .foregroundColor(selected ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
                        .padding(.horizontal, 16)
                        .background(selected ? NT.purple : Color.clear)
                    }
                    .buttonStyle(PressableStyle(scale: 0.99))
                    Divider().overlay(NT.line)
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
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
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.lilacLine, lineWidth: 1.5))
            .padding(14)
            Divider().overlay(NT.line)

            ScrollView {
                let cols = [GridItem(.adaptive(minimum: 170, maximum: 260), spacing: 12)]
                LazyVGrid(columns: cols, spacing: 12) {
                    ForEach(model.visibleItems) { item in
                        ItemTile(item: item, qty: model.qtyInOrder(item)) { model.add(item) }
                    }
                    // 最後に「その他（金額入力）」。お客様が何か追加したとき金額と内容を打って入れる（Web と同じ。2026-10-07 Ronnie）
                    if let t = model.customTile {
                        Button { model.customTarget = t } label: {
                            VStack(spacing: 5) {
                                Image(systemName: "square.and.pencil").font(.system(size: 20, weight: .bold))
                                Text("Other").font(.system(size: 17, weight: .heavy))
                                Text("その他・金額入力").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                            }
                            .foregroundColor(NT.purple)
                            .frame(maxWidth: .infinity, minHeight: 112)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac.opacity(0.55)))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.purple.opacity(0.45), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
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
                            Text("会計へ（\(NT.yen(model.total))）").font(.system(size: 20, weight: .heavy))
                            Text("Checkout").font(.system(size: 11, weight: .bold)).opacity(0.8)
                        }
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .foregroundColor(NT.purple)
                        .frame(maxWidth: .infinity, minHeight: 70)
                        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(model.total == 0 || model.busy || !model.canCheckout)
                }
            }
            .padding(14)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
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
                    .font(.system(size: 19, weight: .heavy))
                    .foregroundColor(item.soldOut ? NT.ink3 : NT.purple)
                if item.hasOptions || item.openPrice {
                    Text(item.openPrice ? "金額入力" : "オプション").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 112)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(item.soldOut ? Color(hex: 0xF4F2F7) : NT.card))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(qty > 0 ? NT.purple : NT.lilacLine, lineWidth: qty > 0 ? 2 : 1))
            .overlay(alignment: .topTrailing) {
                if qty > 0 {
                    Text("\(qty)")
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                        .frame(minWidth: 26, minHeight: 26)
                        .background(Circle().fill(NT.purple))
                        .offset(x: 6, y: -6)
                }
            }
            .overlay {
                if item.soldOut {
                    Text("売り切れ")
                        .font(.system(size: 13, weight: .heavy)).foregroundColor(.white)
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
