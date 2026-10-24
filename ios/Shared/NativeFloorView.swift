import SwiftUI

/// ネイティブのフロア（テーブル一覧）画面（iPad レジ）。Web の「オーダー・会計」のホームと同じ並び：
///   上＝バー（戻る・店・画面名・担当）／左＝フロアのチップ・卓の箱・色の見方／右＝本日のご予約
/// 卓を押すとポップアップ（NativeTableSheet）。注文・レジ会計は既存のネイティブのオーダー・会計画面へ。
/// Native ON の iPad では Web のテーブル一覧を出さない（2026-10-24 Ronnie「Native ON ならネイティブだけ」）
struct NativeFloorView: View {
    @ObservedObject var model: NativeFloorModel
    var onHome: () -> Void = {}
    var onLedger: () -> Void = {}
    /// 伝票を開く（既存のネイティブのオーダー・会計画面）
    var onOpenOrder: (_ orderId: String, _ checkout: Bool) -> Void = { _, _ in }

    @State private var tileRect: CGRect?
    /// 来店登録（空席の「注文」）のカード。ポップアップを閉じてから出す（2026-10-24 Ronnie「注文を押したら次が出て、ポップアップは消える」）
    @State private var setupTable: NFTable?
    /// 着席中の「お客様情報」のカード
    @State private var guestInfo: NFGuestInfoTarget?

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(
                storeName: model.store?.name ?? "",
                title: "オーダー・会計",
                subtitle: "Order & Pay",
                userName: "",
                onHome: onHome
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
                        }
                        legend
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
    }

    // MARK: フロアのチップ（ALL ／ フロア名 ／ 未分類）

    private var floorChips: some View {
        HStack(spacing: 6) {
            Spacer(minLength: 0)
            chip("ALL", on: model.floorFilter == "all") { model.floorFilter = "all" }
            ForEach(model.floors) { f in
                chip(f.name, on: model.floorFilter == f.id) { model.floorFilter = f.id }
            }
            if !model.unassigned.isEmpty {
                chip("未分類", on: model.floorFilter == "_none") { model.floorFilter = "_none" }
            }
            Spacer(minLength: 0)
        }
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NFColor.iris : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 卓の箱

    private func tableGrid(width: CGFloat, height: CGFloat) -> some View {
        // 間は 28 で固定（左の端・箱と箱の間・右の予約の欄との間が全部同じ）。箱は残りの幅を等分した正方形
        // （2026-10-24 Ronnie 20:36「少し小さく・間をそろえて」→20:42「右の空きを箱で分けて」→20:45「0.5cm 小さく」
        //  →20:47「小さすぎ」→20:57「間がまだ広い、箱を少し大きく」）。箱は 180〜240pt、列は 180pt 以上になる数まで
        let gapS: CGFloat = 28
        let outer: CGFloat = 14
        let total = width + outer * 2
        func sideFor(_ n: Int) -> CGFloat { (total - gapS * CGFloat(n + 1)) / CGFloat(n) }
        var fit = 1
        while sideFor(fit + 1) >= 180 { fit += 1 }
        let cols = max(1, min(fit, max(model.visibleTables.count, min(fit, 3))))
        let side = max(120, min(240, sideFor(cols)))
        let space = max(gapS, (total - side * CGFloat(cols)) / CGFloat(cols + 1))
        let inset = max(0, space - outer)
        let tileH = side
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
                .padding(.top, 2).padding(.bottom, 16)
            }
        }
    }

    // MARK: 色の見方

    private var legend: some View {
        HStack(spacing: 12) {
            legendDot(NFColor.irisSoft, border: NFColor.wisteria, "着席中")
            legendDot(NFColor.iris, border: nil, "注文済")
            legendDot(NFColor.lo, border: nil, "L.O.済")
            legendDot(NFColor.danger, border: nil, "時間超過")
            legendDot(NFColor.saffron, border: nil, "会計待ち")
            legendDot(NFColor.tileSurface(.free), border: Color.black.opacity(0.15), "空席")
            Text("下の線＝残り時間").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            Spacer()
        }
        .padding(.top, 2)
    }

    private func legendDot(_ color: Color, border: Color?, _ label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 9, height: 9)
                .overlay(Circle().stroke(border ?? .clear, lineWidth: 1))
            Text(label).font(.system(size: 12, weight: .medium)).foregroundColor(NFColor.ink2)
        }
    }
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

        Button {
            onTap(rect)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                // 1行目: テーブル名（状態の色の札）・人数。2行目: 席の印（席の数だけ。座っている人数ぶん色がつく）
                // （2026-10-24 20:36 Ronnie「unique な形に」）
                HStack(spacing: 6) {
                    Text(table.name)
                        .font(.system(size: 15, weight: .heavy)).monospacedDigit()
                        .foregroundColor(empty ? NFColor.ink2 : .white)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.horizontal, 9).frame(height: 26)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(empty ? Color.white : NFColor.label(state)))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(empty ? Color.black.opacity(0.08) : Color.clear, lineWidth: 1))
                        .shadow(color: empty ? .clear : NFColor.label(state).opacity(0.3), radius: 3, y: 2)
                    Spacer(minLength: 4)
                    HStack(spacing: 2) {
                        Image(systemName: "person.2").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                        Text(order.map { "\($0.guestCount)名" } ?? "\(table.capacityMax)名席")
                    }
                    .font(.system(size: 12, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink2)
                }
                seatMarks(used: order?.guestCount ?? 0, state: state)
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
                        // 空席は「＋」も「空席」の字も出さない（グレーの箱と白い札で分かる。2026-10-24 20:44 Ronnie「卓の ＋ はいらない」）
                        if state != .free {
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
                // 下段: 状態・金額
                if let o = order {
                    HStack(alignment: .center, spacing: 6) {
                        Text(state.label)
                            .font(.system(size: 10.5, weight: .heavy)).foregroundColor(NFColor.label(state))
                            .lineLimit(1).minimumScaleFactor(0.7)
                        Spacer(minLength: 2)
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(NT.yen(o.total)).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.ink)
                            Text(o.guestCount > 0 ? "\(NT.yen(Int((Double(o.total) / Double(o.guestCount)).rounded())))/人" : "—/人")
                                .font(.system(size: 10, weight: .semibold)).monospacedDigit().foregroundColor(NFColor.ink3)
                        }
                    }
                    .padding(.top, 6)
                    .overlay(alignment: .top) { dashedLine }
                    .frame(minHeight: 30)
                } else if state == .seated || state == .pay || state == .cleaning || state == .unavailable {
                    Text(state.label)
                        .font(.system(size: 10.5, weight: .heavy)).foregroundColor(NFColor.label(state))
                        .padding(.top, 6)
                        .overlay(alignment: .top) { dashedLine }
                        .frame(minHeight: 26, alignment: .leading)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, order != nil ? 20 : 12)
            // 横は列の幅いっぱい、高さはそろえる（2026-10-24 20:42 Ronnie「右の空きを全部の箱で分けて」）
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .frame(height: height, alignment: .topLeading)
            // Apple 風：白い地の上に、角の丸いカードを浮かせる（空席は薄いグレー、使用中は白＋影）
            // 3D：下に一段濃い「台」を敷き、その上に上が明るいカードを乗せる（キーのような立体。2026-10-24 Ronnie「3D・見えやすく」）
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous)
                        .fill(NFColor.tileEdge(state))
                        .offset(y: 5)
                        .shadow(color: .black.opacity(0.18), radius: 10, x: 0, y: 9)
                        .shadow(color: .black.opacity(0.10), radius: 2, x: 0, y: 6)
                    RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous)
                        .fill(LinearGradient(colors: [NFColor.tileFaceTop(state), NFColor.tileSurface(state)], startPoint: .top, endPoint: .bottom))
                }
            )
            .overlay(alignment: .bottom) {
                // 残り時間の線（カードの中の細いバー）
                if let o = order {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NFColor.ink.opacity(0.08))
                            Capsule().fill(NFColor.bar(state))
                                .frame(width: max(5, g.size.width * o.tileTime(now: now).frac))
                        }
                    }
                    .frame(height: 5)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 9)
                }
            }
            // 縁：上は白く光り、下は濃い（面取りの見え方）。連携・予約は色の縁
            .overlay(
                RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(colors: [Color.white.opacity(0.95), NFColor.tileEdge(state).opacity(0.9)], startPoint: .top, endPoint: .bottom),
                        lineWidth: 2
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous)
                    .strokeBorder(linked != nil ? NFColor.royal : (state == .reserved ? NFColor.royal.opacity(0.6) : Color.black.opacity(0.10)), lineWidth: linked != nil || state == .reserved ? 2 : 0.75)
            )
            .overlay {
                if hasCall {
                    RoundedRectangle(cornerRadius: NFColor.tileRadius, style: .continuous).strokeBorder(NFColor.callOrange, lineWidth: 4)
                        .opacity(pulse ? 1 : 0.35)
                }
            }
            .overlay(alignment: .topTrailing) {
                if hasCall {
                    HStack(spacing: 4) {
                        Image(systemName: "bell.fill").font(.system(size: 11))
                        Text(table.calls.contains { $0.kind == "checkout" } ? "お会計希望" : (table.calls.first { $0.note != nil }?.note ?? "スタッフ呼び出し"))
                            .lineLimit(1)
                    }
                    .font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(NFColor.callDeep))
                    .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
                    .padding(6)
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
    }

    @State private var pulse = false

    /// 席の印（席の数だけ小さな棒。座っている人数ぶん状態の色。席が多い卓は 12 まで＋数）
    @ViewBuilder
    private func seatMarks(used: Int, state: NFTileState) -> some View {
        let cap = table.capacityMax
        if cap >= 1 {
            HStack(spacing: 4) {
                ForEach(0..<min(cap, 12), id: \.self) { i in
                    Circle().fill(i < used ? NFColor.label(state) : NFColor.ink.opacity(0.12)).frame(width: 7, height: 7)
                }
            }
            .padding(.top, 3).padding(.bottom, 2)
        }
    }

    private var dashedLine: some View {
        Rectangle().fill(Color.clear).frame(height: 1)
            .overlay(Rectangle().fill(Color.black.opacity(0.07)).frame(height: 1))
    }

    @ViewBuilder
    private func occupied(_ o: NFOrder, state: NFTileState, next: NFUpcoming?) -> some View {
        let tt = o.tileTime(now: now)
        let visits = o.visitCount
        let isNew = visits != nil && (visits ?? 0) <= 1
        let name = o.customerName ?? o.guestName
        // 入店時刻と、時間制なら残り（無ければ経過）を「H:MM」で（USEN の卓と同じ情報を、うちの形で。2026-10-24 Ronnie）
        let hasLimit = o.course != nil
        let mins = hasLimit ? tt.left : tt.elapsed
        let clock = String(format: "%@%d:%02d", mins < 0 ? "−" : "", abs(mins) / 60, abs(mins) % 60)
        HStack(spacing: 8) {
            HStack(spacing: 3) {
                Image(systemName: "arrow.right.to.line").font(.system(size: 11, weight: .bold))
                Text(NFTime.hm(o.openedAtMs)).font(.system(size: 13, weight: .bold)).monospacedDigit()
            }
            .foregroundColor(NFColor.ink2)
            HStack(spacing: 3) {
                Image(systemName: hasLimit ? "hourglass" : "clock").font(.system(size: 11, weight: .bold))
                Text(clock).font(.system(size: 15, weight: .heavy)).monospacedDigit()
            }
            .foregroundColor(hasLimit && mins < 0 ? NFColor.danger : NFColor.royal)
            if let v = visits, v >= 2 {
                Text("\(v)回").font(.system(size: 10, weight: .heavy)).foregroundColor(NFColor.royal)
                    .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.irisSoft))
            }
            if isNew {
                Text("新規").font(.system(size: 10, weight: .heavy)).foregroundColor(NFColor.success)
                    .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.successSoft))
            }
            Spacer(minLength: 0)
        }
        if let c = o.course {
            HStack {
                Text("\(c.label) \(c.minutes)分")
                Spacer(minLength: 4)
                Text(tt.left > 0 ? "残 \(tt.left)分" : "超過 \(-tt.left)分")
                    .fontWeight(.heavy)
                    .foregroundColor(state == .over ? NFColor.danger : (state == .lo ? NFColor.loInk : NFColor.royal))
            }
            .font(.system(size: 10.5, weight: .semibold)).monospacedDigit().foregroundColor(NFColor.ink3)
        }
        HStack(spacing: 6) {
            Text(name.map { "\(stripSama($0)) 様" } ?? (isNew ? "新規のお客様" : "顧客 未登録"))
                .font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2).lineLimit(1)
            Text(o.sourceLabel).font(.system(size: 10.5, weight: .medium)).foregroundColor(NFColor.ink3).lineLimit(1)
        }
        if let next { nextLine(next, danger: true) }
    }

    private func nextLine(_ r: NFUpcoming, danger: Bool) -> some View {
        HStack(spacing: 3) {
            Text("次 \(r.time) \(stripSama(r.name)) \(r.partySize)名")
            Text(r.sourceLabel).fontWeight(.medium).opacity(0.75)
        }
        .font(.system(size: 11, weight: .bold)).monospacedDigit()
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
