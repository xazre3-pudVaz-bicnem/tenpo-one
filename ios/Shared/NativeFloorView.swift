import SwiftUI
import UIKit

/// ネイティブのフロア（テーブル一覧）画面（iPad レジ）。Web の「オーダー・会計」のホームと同じ並び：
///   上＝バー（戻る・店・画面名・担当）／左＝フロアのチップ・卓の箱・色の見方／右＝本日のご予約
/// 卓を押すとポップアップ（NativeTableSheet）。注文・レジ会計は既存のネイティブのオーダー・会計画面へ。
/// Native ON の iPad では Web のテーブル一覧を出さない（2026-10-24 Ronnie「Native ON ならネイティブだけ」）
struct NativeFloorView: View {
    @ObservedObject var model: NativeFloorModel
    var onHome: () -> Void = {}
    var onLedger: () -> Void = {}
    /// 上のバーの右の「メニュー在庫管理」（本日の残り数。前はホームの「在庫設定」。nil なら出さない）
    var onStock: (() -> Void)? = nil
    /// 伝票を開く（既存のネイティブのオーダー・会計画面）
    var onOpenOrder: (_ orderId: String, _ checkout: Bool) -> Void = { _, _ in }
    /// この卓の来店登録を開いてほしい（Web の /app/floor/<卓>/setup から。AppState.floorSetupTableId）
    var setupRequest: String? = nil
    /// setupRequest を受け取ったら呼ぶ（AppState の値を消す）
    var onSetupRequestHandled: () -> Void = {}

    @State private var tileRect: CGRect?
    /// 来店登録（空席の「注文」）のカード。ポップアップを閉じてから出す（2026-10-24 Ronnie「注文を押したら次が出て、ポップアップは消える」）
    @State private var setupTable: NFTable?
    /// 着席中の「お客様情報」のカード
    @State private var guestInfo: NFGuestInfoTarget?

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(
                storeName: model.store?.name ?? "",
                title: "注文・会計",
                subtitle: "Order & Pay",
                userName: "",
                onHome: onHome,
                // 2026-10-27 01:45 Ronnie「メニュー在庫管理 name change garera 注文・会計 click garda top menu bar ma aaune banau right patti」
                accessory: onStock.map { NativeTopBarButton(icon: "shippingbox", label: "メニュー在庫管理", action: $0) }
            )
            GeometryReader { geo in
                let panelW: CGFloat = geo.size.width >= 1000 ? 300 : 270
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 12) {
                        if model.showFloorChips { floorChips }
                        GeometryReader { area in
                            // 影が切れないよう、スクロールの枠だけ左右に 10 広げる（箱の位置は変わらない）
                            ScrollView {
                                tableGrid(width: area.size.width, height: area.size.height - 8)
                                    .padding(.horizontal, 10)
                            }
                            .padding(.horizontal, -10)
                            // 横にスライドすると隣のフロア（2026-10-27 01:54 Ronnie「table body panel slide garna pani milne banau」）
                            .simultaneousGesture(
                                DragGesture(minimumDistance: 30).onEnded { v in
                                    let dx = v.translation.width, dy = v.translation.height
                                    guard model.showFloorChips, abs(dx) > 80, abs(dx) > abs(dy) * 1.5 else { return }
                                    withAnimation(.easeOut(duration: 0.2)) { model.stepFloor(dx < 0 ? 1 : -1) }
                                }
                            )
                        }
                        // 色と印の見方はここに出さない（設定 › 使い方 へ。2026-10-24 22:35 Ronnie「ここはいらない」）
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    NativeReservationPanel(model: model, onLedger: onLedger)
                        .frame(width: panelW)
                }
                .padding(14)
            }
            .background(NFColor.floorBg)
        }
        .background(NFColor.floorBg.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let e = model.error {
                Button { model.error = nil } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text(e).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Image(systemName: "xmark")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.danger.opacity(0.3), lineWidth: 1))
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
                    .background(Capsule().fill(NFColor.navy.opacity(0.92)))
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.toast)
        .overlay {
            if model.loading && model.payload == nil {
                ZStack {
                    NFColor.lilac.opacity(0.85).ignoresSafeArea()
                    ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(NFColor.iris)
                }
            }
        }
        // レジとして使えない（この iPad が未登録など）：理由と「この iPad を登録」（2026-10-26。前は前の店の一覧のまま）
        .overlay {
            if let b = model.blocked, !model.loading {
                ZStack {
                    NFColor.floorBg.opacity(0.96).ignoresSafeArea()
                    VStack(spacing: 18) {
                        Image(systemName: b.canRegister ? "ipad.landscape" : "exclamationmark.triangle.fill")
                            .font(.system(size: 44, weight: .semibold))
                            .foregroundColor(b.canRegister ? NFColor.iris : NFColor.danger)
                        Text(b.message)
                            .font(.system(size: 19, weight: .bold)).foregroundColor(NFColor.navy)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if b.canRegister {
                            Text("登録すると、この iPad でテーブル一覧・注文・会計が使えます（店舗の契約の台数まで）")
                                .font(.system(size: 14, weight: .medium)).foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        HStack(spacing: 12) {
                            Button { Task { await model.refresh(silent: false) } } label: {
                                Text("読み直す")
                                    .font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.navy)
                                    .frame(width: 180, height: 56)
                                    .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.navy.opacity(0.2), lineWidth: 1))
                            }
                            if b.canRegister {
                                Button { Task { await model.registerDevice() } } label: {
                                    Text(model.busy ? "登録中…" : "この iPad を登録")
                                        .font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                                        .frame(width: 240, height: 56)
                                        .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.iris))
                                }
                                .disabled(model.busy)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(36)
                    .frame(maxWidth: 620)
                    .background(RoundedRectangle(cornerRadius: 22).fill(Color.white))
                    .shadow(color: .black.opacity(0.08), radius: 18, y: 6)
                }
            }
        }
        // 卓のポップアップ（押した卓の近くに出す。Web と同じ）
        .overlay {
            if let t = model.selectedTable {
                NativeTableSheet(
                    model: model,
                    table: t,
                    anchor: tileRect,
                    onClose: { model.selectedTableId = nil; tileRect = nil },
                    onOpenOrder: onOpenOrder,
                    onSetup: { table in setupTable = table },
                    onGuestInfo: { order, slip in guestInfo = NFGuestInfoTarget(order: order, slip: slip) }
                )
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.selectedTableId)
        // 来店登録（お客様情報）。Web の /app/floor/[tableId]/setup と同じ並び。大きめのカードで、中身が入る高さ
        .overlay {
            if let t = setupTable {
                NativeModalCard(width: 760) {
                    NativeSetupSheet(
                        model: model,
                        table: t,
                        onClose: { setupTable = nil },
                        onStarted: { id in
                            setupTable = nil
                            onOpenOrder(id, false)
                        }
                    )
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: setupTable?.id)
        // 着席中の直し（開始・時間・人数・モード・コース）
        // 着席中の「お客様情報」は来店登録と同じ画面で直す（2026-10-24 Ronnie「same popup」）
        .overlay {
            if let g = guestInfo, let t = model.tables.first(where: { $0.order?.slips.contains(where: { $0.id == g.slip.id }) == true }) {
                NativeModalCard(width: 760) {
                    NativeSetupSheet(model: model, table: t, edit: NFVisitEdit(order: g.order, slip: g.slip),
                                     onClose: { guestInfo = nil }, onStarted: { _ in guestInfo = nil })
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: guestInfo?.slip.id)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .coordinateSpace(name: "floor")
        // Web の /app/floor/<卓>/setup から来たとき（テーブルを読み込めたら開く）
        .onAppear { applySetupRequest() }
        .onChange(of: setupRequest) { _ in applySetupRequest() }
        .onChange(of: model.payload?.serverNow) { _ in applySetupRequest() }
    }

    /// Web の app/app/floor/[tableId]/setup/page.tsx と同じ決め方：着席中ならその伝票（いちばん新しい）、空席・清掃中なら来店登録、
    /// 予約あり・使用不可・別の店の卓はエラー
    private func applySetupRequest() {
        guard let id = setupRequest, let p = model.payload else { return }
        // 読み込んだばかりの一覧で決める（iPad に保存してあった古い一覧では決めない。Web はその場で DB を見る）。古ければ次の読み込みで
        guard model.now - p.serverNow < 45_000 else { return }
        onSetupRequestHandled()
        model.selectedTableId = nil
        guard p.canOperate else {
            model.error = "この画面は利用できません。店舗の割り当てと注文権限を確認してください。"
            return
        }
        guard let t = model.tables.first(where: { $0.id == id }) else {
            model.error = "このテーブルは存在しないか、現在の店舗からアクセスできません。"
            return
        }
        if let slip = t.order?.slips.max(by: { $0.openedAtMs < $1.openedAtMs }) {
            onOpenOrder(slip.id, false)
            return
        }
        switch t.currentStatus {
        case "unavailable":
            model.error = "この卓は現在「使用不可」のため着席できません。テーブル一覧で状態を変更してください。"
        case "reserved", "seated", "ordering", "billing":
            model.error = "この卓は現在「予約あり」のため着席できません。テーブル一覧で状態を変更してください。"
        default:
            // 空席・キャンセル待ち・清掃中（会計が終わった卓へすぐ次のお客様を通す。2026-09-24 店舗要望）
            setupTable = t
        }
    }

    // MARK: フロアの切り替え（1F ／ 2F ／ … ／ 未分類）。灰色の枠に、選んだフロアだけ白
    // 2026-10-27 01:54 Ronnie の見本「1F 2F 3F テラス」。ALL は出さない（受付のフロア＝最初に出すフロアから）

    private var floorChips: some View {
        HStack(spacing: 0) {
            ForEach(model.floors) { f in
                segment(f.name, on: model.activeFloor == f.id) { model.floorFilter = f.id }
            }
            if !model.unassigned.isEmpty {
                segment("未分類", on: model.activeFloor == "_none") { model.floorFilter = "_none" }
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(hex: 0xEEEEEF)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xE2E2E4), lineWidth: 1))
        .animation(.easeOut(duration: 0.15), value: model.activeFloor)
    }

    private func segment(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button {
            model.selectedTableId = nil
            action()
        } label: {
            Text(text)
                .font(.system(size: 16, weight: on ? .medium : .semibold))
                .foregroundColor(on ? Color(hex: 0x1F2329) : Color(hex: 0x8E8E93))
                .lineLimit(1)
                .padding(.horizontal, 22)
                .frame(minWidth: 64).frame(height: 40)
                .background {
                    if on {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white)
                            .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
                    }
                }
        }
        .buttonStyle(.plain)
    }

    // MARK: 卓の箱

    private func tableGrid(width: CGFloat, height: CGFloat) -> some View {
        // 1 行に 4 卓（5 だと印が入りきらない。2026-10-24 21:50 Ronnie「4 つで良い」）。高さ 220。間は 28 で、
        // 左の端・箱と箱の間・右の予約の欄との間が全部同じ（21:20「正方形でなくていい」。間・大きさの話は 20:36〜20:57）
        let gapS: CGFloat = 28
        let outer: CGFloat = 14
        let total = width + outer * 2
        let cols = 4
        let side = max(120, (total - gapS * CGFloat(cols + 1)) / CGFloat(cols))
        let space = gapS
        let inset = max(0, space - outer)
        let tileH: CGFloat = 220
        let columns = Array(repeating: GridItem(.fixed(side), spacing: space), count: cols)
        return Group {
            if model.visibleTables.isEmpty {
                Text("このフロアにテーブルはありません")
                    .font(.system(size: 14)).foregroundColor(NFColor.ink3)
                    .frame(maxWidth: .infinity).padding(.vertical, 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5])).foregroundColor(NFColor.wisteria))
            } else {
                LazyVGrid(columns: columns, alignment: .center, spacing: space) {
                    ForEach(model.visibleTables) { t in
                        NativeTableCard(table: t, now: model.now, height: tileH) { rect in
                            tileRect = rect
                            model.selectedTableId = t.id
                        }
                    }
                }
                .padding(.horizontal, inset)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 14).padding(.bottom, 16)
            }
        }
    }

    // MARK: 色の見方

}

// MARK: - 卓の箱（Web の TableCard と同じ中身）

struct NativeTableCard: View {
    let table: NFTable
    let now: Double
    /// 箱の高さ（幅は列の幅いっぱい）
    var height: CGFloat = 200
    let onTap: (CGRect) -> Void

    @State private var rect: CGRect = .zero

    var body: some View {
        let state = table.state(now: now)
        let next = table.nextReservation(now: now)
        let order = table.order
        let empty = order == nil && state != .seated && state != .pay
        let linked = table.linkedNames
        let hasCall = !table.calls.isEmpty
        // 平らな箱（立体・影・光る縁なし）。地は状態の色をうすく、縁は細いうすい線
        // （2026-10-27 02:28 Ronnie「table haru yesto banau 3d wala pardaina ra border pani testo pardaina」）
        let band = Self.band(state)
        let fill = Self.flatFill(state, band: band)
        let line = Self.flatLine(state, band: band)

        Button {
            onTap(rect)
        } label: {
            // 字の大きさは 3 つだけ（見出し 15・本文 15/12・小さい字 11）、行の間は 6 でそろえる（2026-10-24 21:13 Ronnie「字の間と大きさがそろっていない」）
            // 中身は右にそろえる（番号の行だけ左右。2026-10-24 21:55 Ronnie「全部、箱の右から並べて」）
            VStack(alignment: .trailing, spacing: 6) {
                // 1行目: テーブル名（状態の色の札）・人数。2行目: 席の印（席の数だけ。座っている人数ぶん色がつく）
                // （2026-10-24 20:36 Ronnie「unique な形に」）
                HStack(spacing: 6) {
                    // 卓の番号は少し大きく（人数も同じ大きさ。2026-10-24 21:48 Ronnie）
                    Text(table.name)
                        .font(.system(size: 23, weight: .heavy)).monospacedDigit()
                        // 札と席の印は色をつけない（色は下の帯だけ。2026-10-24 21:09 Ronnie「ここは色いらない」）
                        .foregroundColor(empty ? NFColor.ink2 : NFColor.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.horizontal, 10).frame(height: 36)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.black.opacity(0.10), lineWidth: 1))
                    // プランと予約の印（飲み放題＝ビールのグラス・誕生日＝ケーキ…。2026-10-24 21:18 Ronnie）
                    let marks = Self.marks(order)
                    if !marks.isEmpty {
                        HStack(spacing: 4) {
                            // 印は光るように（色つき・うすい光）。プランを使っているとき・予約のタグがあるときだけ出る
                            // （2026-10-24 21:31 Ronnie「飲み放題の印は光るように。呼ばれたとき・プランを使うときだけ」）
                            ForEach(marks.prefix(3), id: \.self) { ic in
                                let c = Self.markColor(ic)
                                Image(systemName: ic).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                    .frame(width: 24, height: 24)
                                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(c))
                                    .shadow(color: c.opacity(0.55), radius: 5, y: 1)
                            }
                        }
                    }
                    Spacer(minLength: 4)
                    // 人の印と人数は卓の番号と同じ大きさ。「名」は書かず数字だけ。
                    // お客様が来店（着席）してから印も数字も出す（2026-10-24 22:19「お客様が来てから書く」・2026-10-25 00:10 Ronnie「人の印も来店してから」）
                    if let o = order {
                        HStack(spacing: 2) {
                            Image(systemName: "person.2.fill").font(.system(size: 20, weight: .semibold)).foregroundColor(NFColor.ink3)
                            Text("\(o.guestCount)")
                        }
                        .font(.system(size: 23, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
                        .lineLimit(1).fixedSize()
                    }
                }
                // 席の印（○○○○）は出さない（2026-10-24 21:36 Ronnie「番号の下の ○○○○ はいらない」）
                // 呼び出しの中身（お会計希望・お水×2…）
                if hasCall {
                    let info = Self.callInfo(table.calls, now: now)
                    HStack(spacing: 4) {
                        Image(systemName: info.checkout ? Self.walletSymbol : "bell.fill").font(.system(size: 11, weight: .bold))
                        Text(info.label).lineLimit(1)
                    }
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundColor(Self.callColor(info, border: false))
                }
                if let linked {
                    HStack(spacing: 4) {
                        Image(systemName: "link").font(.system(size: 10, weight: .bold))
                        Text("連携 \(linked.joined(separator: "+"))").lineLimit(1)
                    }
                    .font(.system(size: 10, weight: .heavy)).foregroundColor(.white)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().fill(NFColor.royal))
                }
                if let o = order {
                    occupied(o, state: state, next: next)
                } else {
                    VStack(spacing: 6) {
                        // 空席は「＋」を出さない（2026-10-24 20:44 Ronnie）。まん中にうすく小さく「4名席 空」（座ると消える。22:19 Ronnie）
                        if state == .free {
                            Text("\(table.capacityMax)名席 空").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink3.opacity(0.7))
                        } else {
                            HStack(spacing: 4) {
                                if state == .unavailable { Image(systemName: "lock.fill").font(.system(size: 11)) }
                                if state == .cleaning { Image(systemName: "sparkles").font(.system(size: 11)) }
                                Text(state == .seated || state == .pay ? "注文なし / No order" : state.label)
                            }
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink3)
                        }
                        if table.isPrivateRoom || table.isCounter {
                            Text(table.isPrivateRoom ? "個室" : "カウンター").font(.system(size: 10.5)).foregroundColor(NFColor.ink3)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.vertical, 8)
                    if let next { nextLine(next, danger: false) }
                }
                Spacer(minLength: 0)
                // 下段: 1 人あたり（左）・合計（右）を 1 行に（状態は下の帯に）
                if let o = order {
                    VStack(spacing: 8) {
                        // お客様の名前と来店経路はお金の線のすぐ上（2026-10-24 21:54 Ronnie）。
                        // 名前が出れば顧客台帳とつながっている、出なければつながっていない（「顧客 未登録」は書かない）
                        HStack(spacing: 6) {
                            Spacer(minLength: 0)
                            // 来店の区分：初回（グレー）・リピ N回（青）・常連 N回（黄）。顧客台帳につながっているときだけ
                            if let v = o.visitCount {
                                let chip: (String, Color, Color) = v >= 3 ? ("常連 \(v)回", NLColor.navy, NLColor.yellow) : v == 2 ? ("リピ 2回", .white, NLColor.blue) : ("初回", NFColor.ink2, Color(hex: 0xE9E9EF))
                                Text(chip.0).font(.system(size: 11, weight: .heavy)).foregroundColor(chip.1)
                                    .padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(chip.2))
                            }
                            if let n = o.customerName ?? o.guestName {
                                Text("\(stripSama(n)) 様").font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink2)
                            }
                            Text(o.sourceLabel).font(.system(size: 12, weight: .regular)).foregroundColor(NFColor.ink3)
                        }
                        .lineLimit(1)
                        // お金は下の色の帯の上に書く（2026-10-24 22:23 Ronnie「帯をお金の上の線まで。お金は色の上に」）
                    }
                } else if state == .cleaning || state == .unavailable {
                    Text(state.label)
                        .font(.system(size: 10.5, weight: .heavy)).foregroundColor(NFColor.label(state))
                        .padding(.top, 6)
                        .overlay(alignment: .top) { dashedLine }
                        .frame(minHeight: 26, alignment: .leading)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, order != nil && band != nil ? Self.bandH + 4 : 12)
            // 横は列の幅いっぱい、高さはそろえる（2026-10-24 20:42 Ronnie「右の空きを全部の箱で分けて」）
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .frame(height: height, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous).fill(Color.white)
                    .overlay(RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous).fill(fill))
            )
            // 下：1 人あたり・合計（字は濃い色）。その上に残り時間の細い線（状態の色）
            .overlay {
                if let b = band, let o = order {
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                        ZStack(alignment: .top) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Spacer(minLength: 4)
                                Text(o.guestCount > 0 ? "\(NT.yen(Int((Double(o.total) / Double(o.guestCount)).rounded())))/人" : "—/人")
                                    .font(.system(size: 13, weight: .medium)).monospacedDigit().foregroundColor(NFColor.ink2)
                                Text(NT.yen(o.total)).font(.system(size: 22, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink)
                            }
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .padding(.horizontal, 14)
                            .frame(maxHeight: .infinity)
                            GeometryReader { g in
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(b.color.opacity(0.18))
                                    Rectangle().fill(b.color.opacity(0.85))
                                        .frame(width: max(4, g.size.width * o.tileTime(now: now).frac))
                                }
                            }
                            .frame(height: 3)
                            .padding(.horizontal, 14)
                        }
                        .frame(height: Self.bandH)
                    }
                    .allowsHitTesting(false)
                }
            }
            // 縁は細いうすい線だけ（連携・予約は少し青い線）
            .overlay(
                RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous)
                    .strokeBorder(linked != nil ? NFColor.royal.opacity(0.5) : line, lineWidth: linked != nil ? 1.5 : 1)
            )
            // お客様の呼び出し：右上にベルと回数・何分前か。5 分過ぎたら赤（2026-10-24 21:22 Ronnie「ベル・何回・5 分過ぎの印」）
            .overlay {
                if hasCall {
                    RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous)
                        .strokeBorder(Self.callColor(Self.callInfo(table.calls, now: now), border: true), lineWidth: 4)
                        .opacity(pulse ? 1 : 0.35)
                }
            }
            .overlay(alignment: .topTrailing) {
                if hasCall {
                    let info = Self.callInfo(table.calls, now: now)
                    HStack(spacing: 4) {
                        Image(systemName: info.checkout ? Self.walletSymbol : "bell.fill").font(.system(size: 12, weight: .bold))
                        Text("\(info.count)回").font(.system(size: 12, weight: .heavy)).monospacedDigit()
                        Text("\(info.minutes)分").font(.system(size: 11, weight: .bold)).monospacedDigit().opacity(0.9)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 9).frame(height: 26)
                    .background(Capsule().fill(Self.callColor(info, border: false)))
                    .overlay(Capsule().stroke(Color.white, lineWidth: 2))
                    // 光る（点滅に合わせて光の強さが変わる）
                    .shadow(color: Self.callColor(info, border: false).opacity(pulse ? 0.8 : 0.3), radius: pulse ? 10 : 4, y: 1)
                    .offset(x: 8, y: -12)
                }
            }
            .opacity(state == .unavailable ? 0.7 : 1)
            // 押した卓の位置（ポップアップを卓のところに出す）。preference は LazyVGrid の中だと更新されない卓があり、
            // ポップアップが左上に出た（2026-10-24 Ronnie「T4 を押しても左上に出る」）→ GeometryReader で直接持つ
            .background(GeometryReader { g in
                Color.clear
                    .onAppear { rect = g.frame(in: .named("floor")) }
                    .onChange(of: g.frame(in: .named("floor"))) { rect = $0 }
            })
        }
        .buttonStyle(PressableStyle())
        .onAppear { if hasCall { withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true } } }
        // あとから呼ばれたときも点滅させる
        .onChange(of: table.calls.count) { n in
            if n > 0 && !pulse { withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true } }
        }
    }

    @State private var pulse = false

    static let bandH: CGFloat = 50
    static let callRed = Color(hex: 0xE53935)
    /// QR からのお会計の依頼は緑の財布（お金＝緑。2026-10-24 21:23 Ronnie「財布か緑の ¥」→21:31「財布」）
    /// 色はポップアップの「レジ会計」のボタンと同じ緑（NFColor.success。2026-10-24 21:36 Ronnie）
    static let callGreen = NFColor.success
    static let walletSymbol: String = ["wallet.bifold.fill", "wallet.pass.fill", "yensign.circle.fill"].first { UIImage(systemName: $0) != nil } ?? "yensign.circle.fill"

    /// 印の色（飲み放題＝琥珀・食べ放題＝橙・コース＝藍・誕生日＝ピンク・記念日＝赤・子連れ＝青緑…）
    static func markColor(_ symbol: String) -> Color {
        if symbol.hasPrefix("mug") { return Color(hex: 0xF59E0B) }
        if symbol.hasPrefix("frying") || symbol.hasPrefix("flame") { return Color(hex: 0xEA580C) }
        if symbol.hasPrefix("fork.knife") || symbol.hasPrefix("menucard") || symbol.hasPrefix("list.bullet") { return Color(hex: 0x4F46E5) }
        if symbol.hasPrefix("birthday") || symbol.hasPrefix("gift") || symbol.hasPrefix("party") { return Color(hex: 0xEC4899) }
        if symbol.hasPrefix("heart") { return Color(hex: 0xE11D48) }
        if symbol.hasPrefix("figure") || symbol.hasPrefix("person") || symbol.hasPrefix("stroller") { return Color(hex: 0x0D9488) }
        if symbol.hasPrefix("crown") || symbol.hasPrefix("star") { return Color(hex: 0xCA8A04) }
        if symbol.hasPrefix("exclamationmark") { return Color(hex: 0xDC2626) }
        return Color(hex: 0x6B7280)
    }

    /// 呼び出しの色：5 分過ぎ＝赤、お会計の依頼＝緑、スタッフ呼び出し＝橙
    static func callColor(_ info: (count: Int, minutes: Int, late: Bool, checkout: Bool, label: String), border: Bool) -> Color {
        if info.late { return callRed }
        if info.checkout { return callGreen }
        return border ? NFColor.callOrange : NFColor.callDeep
    }

    /// 呼び出しの回数・最初の呼び出しから何分・お会計か・中身。5 分過ぎたら late
    static func callInfo(_ calls: [NFCall], now: Double) -> (count: Int, minutes: Int, late: Bool, checkout: Bool, label: String) {
        let first = calls.compactMap { NFTime.ms(iso: $0.createdAt) }.min() ?? now
        let minutes = max(0, Int((now - first) / 60_000))
        let checkout = calls.contains { $0.kind == "checkout" }
        let label = checkout ? "お会計希望" : (calls.last { ($0.note ?? "").isEmpty == false }?.note ?? "スタッフ呼び出し")
        return (calls.count, minutes, minutes >= 5, checkout, label)
    }

    /// 卓の箱の上に出す印：プラン（伝票のモード）＋予約のタグ（誕生日・記念日…）。同じ印は 1 つ
    static func marks(_ order: NFOrder?) -> [String] {
        guard let o = order else { return [] }
        var out = NRWKeywordIcon.planSymbols(o.plans ?? [])
        for t in o.tags ?? [] { if let ic = NRWKeywordIcon.symbol(for: t) { out.append(ic) } }
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    /// 下の帯の字と色（2026-10-24 21:05 Ronnie：注文前＝台帳の「来店済み」と同じ緑、注文を始めた＝オーダー会計のボタンと同じ青、
    /// ラストオーダーの時間＝黄、時間切れ＝赤）。空席・予約・清掃・使用不可は帯なし
    static func band(_ s: NFTileState) -> (jp: String, en: String, color: Color, ink: Color)? {
        switch s {
        case .seated: return ("着席中", "Seated", NLColor.green, .white)
        case .ordered: return ("注文済", "Ordered", Color(hex: 0x2A6FE6), .white)
        case .lo: return ("L.O.済", "Last order", NLColor.yellow, NLColor.navy)
        case .over: return ("時間超過", "Over time", Color(hex: 0xE53935), .white)
        case .pay: return ("会計待ち", "Checkout", NFColor.saffron, .white)
        default: return nil
        }
    }

    /// 平らな箱の地：状態の色をうすく（空席は白、予約はうすい青、清掃・使用不可はうすい灰色）
    static func flatFill(_ s: NFTileState, band: (jp: String, en: String, color: Color, ink: Color)?) -> Color {
        if let b = band { return b.color.opacity(0.10) }
        switch s {
        case .reserved: return Color(hex: 0xEEF4FD)
        case .cleaning, .unavailable: return Color(hex: 0xF1F1F4)
        default: return .white
        }
    }

    /// 平らな箱の縁（細いうすい線）
    static func flatLine(_ s: NFTileState, band: (jp: String, en: String, color: Color, ink: Color)?) -> Color {
        if let b = band { return b.color.opacity(0.30) }
        switch s {
        case .reserved: return Color(hex: 0xCFE0F7)
        default: return Color(hex: 0xE3E5EA)
        }
    }

    private var dashedLine: some View {
        Rectangle().fill(Color.clear).frame(height: 1)
            .overlay(Rectangle().fill(Color.black.opacity(0.07)).frame(height: 1))
    }

    @ViewBuilder
    private func occupied(_ o: NFOrder, state: NFTileState, next: NFUpcoming?) -> some View {
        let tt = o.tileTime(now: now)
        // 入店時刻と、時間制なら残り（無ければ経過）を「H:MM」で（USEN の卓と同じ情報を、うちの形で。2026-10-24 Ronnie）
        // 入店時刻と「残り時間」だけ（経過時間は出さない。2026-10-24 21:57 Ronnie）。残りはコース → 予約の終わり → 店の滞在時間まで
        let mins = tt.left
        let clock = String(format: "%@%d:%02d", mins < 0 ? "−" : "", abs(mins) / 60, abs(mins) % 60)
        // 入店時刻（左）と残り時間（右）を行いっぱいに、大きく（2026-10-24 22:06 Ronnie「時間をもっと大きく、行いっぱいに」）
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: "arrow.right.to.line").font(.system(size: 15, weight: .semibold))
                Text(NFTime.hm(o.openedAtMs)).font(.system(size: 22, weight: .semibold)).monospacedDigit()
            }
            .foregroundColor(NFColor.ink2)
            Spacer(minLength: 4)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: "hourglass").font(.system(size: 15, weight: .semibold))
                Text(clock).font(.system(size: 24, weight: .heavy)).monospacedDigit()
            }
            .foregroundColor(mins < 0 ? NFColor.danger : NFColor.royal)
        }
        .frame(maxWidth: .infinity)
        .lineLimit(1).minimumScaleFactor(0.7)
        if let c = o.course {
            // コースの名前と時間だけ（残りは上の行に）
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Text("\(c.label) \(c.minutes)分")
            }
            .font(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundColor(NFColor.ink3)
        }
        // 最終注文から何分（卓へ行く目安。30 分を過ぎたら赤。2026-10-24 22:00 Ronnie）
        if let last = o.lastOrderAtMs {
            let since = max(0, Int((now - last) / 60_000))
            let alert = since >= 30
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("最終注文から").font(.system(size: 11, weight: .semibold))
                Text("\(since)").font(.system(size: 16, weight: .heavy)).monospacedDigit()
                Text("分").font(.system(size: 11, weight: .bold))
            }
            .foregroundColor(alert ? Self.callRed : NFColor.ink2)
            .padding(.horizontal, 8).frame(height: 24)
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(alert ? Color(hex: 0xFDECEC) : Color(hex: 0xF1F1F5)))
        }
        if let next { nextLine(next, danger: true) }
    }

    private func nextLine(_ r: NFUpcoming, danger: Bool) -> some View {
        HStack(spacing: 3) {
            Text("次 \(r.time) \(stripSama(r.name)) \(r.partySize)名")
            Text(r.sourceLabel).fontWeight(.medium).opacity(0.75)
        }
        .font(.system(size: 12, weight: .semibold)).monospacedDigit()
        .foregroundColor(danger ? NFColor.danger : NFColor.royal)
        .lineLimit(1)
    }
}

func stripSama(_ name: String) -> String {
    var s = name
    if s.hasSuffix(" 様") { s.removeLast(2) } else if s.hasSuffix("様") { s.removeLast() }
    return s
}

/// 「お客様情報」のカードに渡すもの（伝票と注文のスナップショット）
struct NFGuestInfoTarget: Hashable {
    let order: NFOrder
    let slip: NFSlip
}

struct NFRectKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { value = nextValue() }
}

struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}

// MARK: - 右パネル「本日のご予約」（Web の ReservationPanel と同じ）

struct NativeReservationPanel: View {
    @ObservedObject var model: NativeFloorModel
    var onLedger: () -> Void

    private static let notArrived: Set<String> = ["pending", "confirmed", "waiting"]
    /// 開始時刻からこの時間を過ぎても来店がなければ「未連絡」
    private static let lateMs: Double = 15 * 60_000

    private var rows: [NFReservation] { model.payload?.reservations ?? [] }

    var body: some View {
        // 来店待ちのお客様だけを出す。集計のタイルは出さず、黄色の「来店待ち」だけ
        // （2026-10-24 20:50 Ronnie「来店待ちのお客様だけ出るので、ほかは書かなくていい。黄色に 来店待ち だけ」）
        let waiting = rows.filter { Self.notArrived.contains($0.status) }
        let remaining = waiting.count
        let waitingPeople = waiting.reduce(0) { $0 + $1.partySize }

        VStack(spacing: 10) {
            // 上の「本日のご予約一覧」の見出しは出さない（2026-10-24 20:51 Ronnie）
            // 色は店舗台帳と同じ（ネイビー・黄色・状態の色の帯。2026-10-24 20:35 Ronnie「ご予約台帳の色と合わせて」）
            Button(action: onLedger) {
                HStack(spacing: 10) {
                    // 「ご予約台帳」の下に「Reservation」（2026-10-24 20:56 Ronnie「こう書いて」）。
                    // 印の高さは 2 行の字の上から下までと同じ（20:59「印を字の上と下の線に合わせて」）
                    let lineTop: CGFloat = 20, lineBottom: CGFloat = 14
                    Image(systemName: "calendar")
                        .resizable().scaledToFit()
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(NLColor.yellow)
                        .frame(height: lineTop + lineBottom)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("ご予約台帳").font(.system(size: 17, weight: .heavy)).foregroundColor(.white).frame(height: lineTop)
                        Text("Reservation").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.yellow).frame(height: lineBottom)
                    }
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .heavy)).foregroundColor(.white.opacity(0.6))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 60)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.navy))
            }
            .buttonStyle(PressableStyle())
            .padding(.horizontal, 12)
            .padding(.top, 12)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("来店待ち").font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.navy)
                Spacer(minLength: 4)
                Text("\(remaining)").font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.navy)
                Text("組").font(.system(size: 11, weight: .bold)).foregroundColor(NLColor.navy.opacity(0.7))
                if waitingPeople > 0 {
                    Text("\(waitingPeople)").font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.navy).padding(.leading, 4)
                    Text("名").font(.system(size: 11, weight: .bold)).foregroundColor(NLColor.navy.opacity(0.7))
                }
            }
            .padding(.horizontal, 14).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.yellow))
            .padding(.horizontal, 12)
            ScrollView {
                LazyVStack(spacing: 0) {
                    if waiting.isEmpty {
                        Text("来店待ちのお客様はいません").font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(.vertical, 24)
                    }
                    ForEach(waiting) { r in
                        row(r)
                        Divider().overlay(NFColor.line.opacity(0.7))
                    }
                }
            }
            if !waiting.isEmpty {
                HStack {
                    Text("残り \(remaining)組（\(waiting.first?.time ?? "")〜\(waiting.last?.time ?? "")）")
                        .font(.system(size: 12, weight: .medium)).foregroundColor(NFColor.ink2)
                    Spacer()
                    Button(action: onLedger) {
                        Text("すべて表示 ›").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.blue)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous).fill(Color.white)
                .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 4)
        )
        .overlay(RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous).stroke(Color.black.opacity(0.06), lineWidth: 1))
    }

    private func chip(_ r: NFReservation) -> (String, Color, Color) {
        // 店舗台帳の状態の色（来店待ち＝黄・来店済み＝緑・未連絡＝赤・退店＝グレー）
        if Self.notArrived.contains(r.status) {
            return model.now > r.startMs + Self.lateMs
                ? ("未連絡", NLColor.red, NLColor.redSoft)
                : ("来店待ち", NLColor.navy, NLColor.yellowSoft)
        }
        switch r.status {
        case "arrived", "seated": return ("来店済み", Color(hex: 0x036B4A), NLColor.greenSoft)
        case "billing": return ("会計待ち", NLColor.blue, NLColor.blueSoft)
        case "completed": return ("退店", NLColor.muted, NLColor.graySoft)
        case "no_show": return ("無断キャンセル", NLColor.muted, NLColor.graySoft)
        default: return (r.status, NLColor.muted, NLColor.graySoft)
        }
    }

    private func row(_ r: NFReservation) -> some View {
        let c = chip(r)
        return HStack(alignment: .center, spacing: 10) {
            Text(r.time).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.navy)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(stripSama(r.name)) 様").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                Text("\(r.partySize)名・\(r.tableLabel)").font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            // 全部 来店待ち なので、印は「未連絡」（時間を過ぎた）のときだけ
            if c.0 != "来店待ち" {
                Text(c.0).font(.system(size: 11, weight: .bold)).foregroundColor(c.1)
                    .padding(.horizontal, 8).padding(.vertical, 4).background(Capsule().fill(c.2))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .opacity(r.status == "completed" ? 0.5 : 1)
    }
}


// MARK: - 使い方（テーブル一覧の色と印の見方。設定 › 使い方 で見る。2026-10-24 22:35 Ronnie「設定の中の 使い方 に」）

struct NativeFloorGuide: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            section("卓の下の帯の色") {
                ForEach([NFTileState.seated, .ordered, .lo, .over, .pay], id: \.self) { st in
                    if let b = NativeTableCard.band(st) {
                        row(AnyView(RoundedRectangle(cornerRadius: 4).fill(b.color).frame(width: 34, height: 14)), b.jp, desc(st))
                    }
                }
                row(AnyView(RoundedRectangle(cornerRadius: 4).fill(Color.white).overlay(RoundedRectangle(cornerRadius: 4).stroke(NFColor.line)).frame(width: 34, height: 14)), "空席", "帯なし。まん中にうすく「4名席 空」")
            }
            section("右上の印（お客様から）") {
                row(icon(NativeTableCard.walletSymbol, NativeTableCard.callGreen), "お会計希望", "QR からお会計を頼まれた（回数・何分前）")
                row(icon("bell.fill", NFColor.callDeep), "呼び出し", "ベルで呼ばれた（回数・何分前）")
                row(icon("bell.fill", NativeTableCard.callRed), "5分すぎ", "5 分たっても行っていないと赤")
            }
            section("番号の横の印（プラン・予約）") {
                ForEach(["飲み放題", "食べ放題", "コース", "誕生日", "記念日", "子連れ"], id: \.self) { k in
                    if let ic = NRWKeywordIcon.symbol(for: k) { row(icon(ic, NativeTableCard.markColor(ic)), k, "伝票のモード・予約のタグから") }
                }
            }
            section("そのほか") {
                row(AnyView(Text("リピ 2回").font(.system(size: 11, weight: .heavy)).foregroundColor(.white).padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(NLColor.blue))), "初回・リピ・常連", "顧客台帳とつながっているお客様の来店回数")
                row(AnyView(Text("最終注文から 45分").font(.system(size: 11, weight: .semibold)).foregroundColor(NativeTableCard.callRed)), "最終注文から", "最後の注文から何分。30 分で赤（卓へ行く目安）")
                row(AnyView(Image(systemName: "hourglass").foregroundColor(NFColor.royal)), "残り時間", "→ 入店時刻、⏳ 残り時間（コース → 予約の終わり → 店の滞在時間）")
            }
        }
    }

    private func desc(_ st: NFTileState) -> String {
        switch st {
        case .seated: return "お客様が座って、まだ注文なし（店舗台帳の「来店済み」と同じ緑）"
        case .ordered: return "注文が入った（オーダー・会計のボタンと同じ青）"
        case .lo: return "ラストオーダーの時間"
        case .over: return "時間を過ぎた"
        case .pay: return "会計待ち"
        default: return ""
        }
    }

    private func icon(_ symbol: String, _ color: Color) -> AnyView {
        AnyView(Image(systemName: symbol).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
            .frame(width: 26, height: 26).background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(color)))
    }

    private func row(_ mark: AnyView, _ title: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            mark.frame(width: 90, alignment: .leading)
            Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.ink).frame(width: 120, alignment: .leading)
            Text(text).font(.system(size: 13)).foregroundColor(NFColor.ink2)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 16, weight: .heavy)).foregroundColor(NFColor.ink)
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}
