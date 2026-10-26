import SwiftUI

/// 卓を押したときのポップアップ（Web の components/floor/table-sheet.tsx と同じ並び・色。2026-10-24）
///   空席   → 注文 ／ テーブルブロック ／ テーブルグループ設定
///   着席中 → まとめ・注文・レジ会計（緑）・会計伝票を出す（黒・横いっぱい）・テーブル・お客様情報・印刷・支払メモ・テーブルクリア
/// 押した卓の上に出す。上に入らないときは卓に重ねて下へ
struct NativeTableSheet: View {
    @ObservedObject var model: NativeFloorModel
    let table: NFTable
    let anchor: CGRect?
    let onClose: () -> Void
    let onOpenOrder: (_ orderId: String, _ checkout: Bool) -> Void
    /// 空席の「注文」→ 来店登録（お客様情報）。ポップアップは閉じて、フロア側がカードを出す（2026-10-24 Ronnie「注文を押したら次が出て、これは消える」）
    var onSetup: (_ table: NFTable) -> Void = { _ in }
    /// 着席中の「お客様情報」→ 席の時間・人数・モードの直し。同じくポップアップは閉じる
    var onGuestInfo: (_ order: NFOrder, _ slip: NFSlip) -> Void = { _, _ in }

    private enum Panel { case merge, move, print, guest, memo }
    @State private var panel: Panel?
    @State private var groupOpen = false
    @State private var groupPick: [String] = []
    @State private var printPick: [String] = []
    @State private var guestEdit = 1
    @State private var memoText = ""
    @State private var clearConfirm = false
    @State private var approverPick = false

    // 少し広く・ボタンを大きく（2026-10-24 Ronnie「横と縦をちょっと広く、ボタンを見やすく押しやすく」）
    private static let width: CGFloat = 420

    private var now: Double { model.now }
    private var slips: [NFSlip] { table.order?.slips ?? [] }
    /// 会計する伝票（1枚ならそれ。2枚以上は古い順の先頭。Web と同じ）
    private var selected: NFSlip? { slips.first }
    private var seated: Bool { !slips.isEmpty || ["seated", "ordering", "billing"].contains(table.currentStatus) }
    private var guests: Int { selected?.guestCount ?? table.order?.guestCount ?? 0 }
    private var total: Int { selected?.total ?? table.order?.total ?? 0 }
    private var perGuest: Int { guests > 0 ? Int((Double(total) / Double(guests)).rounded()) : 0 }
    private var canOperate: Bool { model.payload?.canOperate ?? false }
    private var pending: Bool { model.busy }
    private var state: NFTileState { table.state(now: now) }
    /// テーブル合算で選べる卓＝この卓以外で、未会計の伝票がある卓
    private var mergeCandidates: [NFTable] { model.tables.filter { $0.id != table.id && !($0.order?.slips.isEmpty ?? true) } }
    /// 移動先＝空席（伝票が無くて空いている卓。オーダー画面の「卓を移動」と同じ）
    private var moveCandidates: [NFTable] { model.tables.filter { $0.id != table.id && $0.order == nil && $0.currentStatus == "available" } }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // 外を押したときだけ閉じる（iPad のポップオーバーと同じく、外は少しだけ暗く）
            Color.black.opacity(0.08).ignoresSafeArea()
                .onTapGesture { onClose() }
            // 押した卓のところに、矢印つきで出す（下 → 上 → 横の順に入る所。iPad のポップオーバーと同じ。2026-10-24 Ronnie）
            // 高さは Layout で測る（preference で測る方式は実機で 0 のままになり潰れた）
            // どの卓を押しても画面の真ん中に出す（上下左右の真ん中。2026-10-24 Ronnie）→ 矢印は出さない
            // 上の端はいつも同じ高さ（中身の高さで出る場所が変わらないように。2026-10-24 21:44 Ronnie「いつも同じ場所に」）
            NFPopoverLayout(width: Self.width, maxHeight: 760, anchor: nil, fixedTop: 150) {
                popup
                NFPopoverArrow().fill(Self.sheetBg).frame(width: 26, height: 12)
                NFPopoverArrow().fill(Self.sheetBg).frame(width: 26, height: 12).rotationEffect(.degrees(180))
                NFPopoverArrow().fill(Self.sheetBg).frame(width: 26, height: 12).rotationEffect(.degrees(-90)).frame(width: 12, height: 26)
                NFPopoverArrow().fill(Self.sheetBg).frame(width: 26, height: 12).rotationEffect(.degrees(90)).frame(width: 12, height: 26)
            }
        }
        .alert("テーブルをクリアしますか / Clear this table?", isPresented: $clearConfirm) {
            Button("テーブルをクリアする / Clear table", role: .destructive) {
                if (model.payload?.approvers ?? []).isEmpty { Task { await clearTable(approver: nil) } } else { approverPick = true }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("\(table.name) の伝票\(selected.map { " #\($0.orderNo)" } ?? "")（\(NT.yen(table.order?.total ?? 0))）の品目をすべて取消し、空席に戻します。売上には入りません。支払済みの伝票はクリアできません。\((model.payload?.approvers ?? []).isEmpty ? "" : "このあと担当者（店長以上）を選んでください。")")
        }
        .confirmationDialog("承認する担当者（店長以上）を選ぶ", isPresented: $approverPick, titleVisibility: .visible) {
            ForEach(model.payload?.approvers ?? []) { a in
                Button(a.name) { Task { await clearTable(approver: a.id) } }
            }
            Button("キャンセル", role: .cancel) {}
        }
    }

    // MARK: ポップアップの中身

    private var popup: some View {
        // 入るならそのまま（中身の高さ）、入らなければスクロール（NFCardLayout が高さを決める）
        // AnyView で型を切る：中身をそのまま 2 回入れると View の型が深くなりすぎて、
        // 実機（Debug）で型の展開がスタックを使い切って落ちた（2026-10-24 Ronnie「卓で注文しようとするとアプリが閉じる」）
        ViewThatFits(in: .vertical) {
            AnyView(popupInner)
            ScrollView(showsIndicators: false) { AnyView(popupInner) }
        }
        // すりガラスにしない（うすい灰色の地・細い線。2026-10-27 02:48 Ronnie「background blur hunu pardaina」）
        .background(Self.sheetBg, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: 0xE3E5EA), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.16), radius: 28, y: 12)
        .disabled(pending)
    }

    private var popupInner: some View {
            VStack(alignment: .leading, spacing: 10) {
                ZStack {
                    Text(table.name)
                        .font(.system(size: 20, weight: .bold, design: .rounded)).foregroundColor(.primary)
                        .frame(maxWidth: .infinity)
                    HStack {
                        Spacer()
                        Button(action: onClose) {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.hierarchical)
                                .font(.system(size: 26)).foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 4)

                if !table.calls.isEmpty { callsBox }

                if table.groupTableIds.count > 1 {
                    Text("グループ " + table.groupTableIds.compactMap { id in model.tables.first { $0.id == id }?.name }.joined(separator: " + "))
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.royal)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(NFColor.royal.opacity(0.1)))
                }
                if let next = table.nextReservation(now: now) {
                    Text("次の予約 \(next.time)　\(stripSama(next.name)) 様（\(next.partySize)名）")
                        .font(.system(size: 12)).monospacedDigit().foregroundColor(NFColor.royal)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(NFColor.irisSoft))
                }

                if !seated && state != .cleaning && state != .unavailable { emptyBody }
                if seated { seatedBody }
                if groupOpen { groupPanel }
                if state == .cleaning && slips.isEmpty {
                    bigButton("清掃完了", en: "Cleaned", fill: Self.primary) { Task { await model.act(["type": "floorCleaned", "tableId": table.id]); onClose() } }
                }
                if canOperate && slips.isEmpty && state == .unavailable {
                    secondaryButton(icon: "lock.open", "ブロック解除", en: "Unblock") {
                        Task { await model.act(["type": "floorBlock", "tableId": table.id, "unavailable": false]); onClose() }
                    }
                }
            }
            .padding(16)
    }

    // お客様QRからの呼び出し
    private var callsBox: some View {
        VStack(spacing: 4) {
            ForEach(table.calls) { c in
                HStack(spacing: 8) {
                    Image(systemName: "bell.fill").foregroundColor(NFColor.callDeep)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(c.kind == "checkout" ? "お会計希望" : "スタッフ呼び出し").font(.system(size: 13, weight: .bold))
                            Text(NFTime.hm(iso: c.createdAt)).font(.system(size: 11, weight: .medium)).foregroundColor(Color(hex: 0x9B3A2A))
                        }
                        if let n = c.note { Text(n).font(.system(size: 15, weight: NT.strong)) }
                    }
                    .foregroundColor(NFColor.callInk)
                    Spacer(minLength: 4)
                    Button {
                        Task {
                            if let r = await model.act(["type": "floorCall", "callId": c.id]) {
                                model.show(toast: (r.alreadyResolved ?? false) ? "別の端末で対応済みでした" : "対応済みにしました")
                            }
                        }
                    } label: {
                        Text("対応済み").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(RoundedRectangle(cornerRadius: 8).fill(NFColor.callDeep))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.callSoft))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.callOrange, lineWidth: 1))
    }

    // 空席
    @ViewBuilder private var emptyBody: some View {
        bigButton("注文", en: "Order", fill: Self.primary, height: 64, size: 20) { onClose(); onSetup(table) }
        divider
        section("テーブル", en: "Table")
        HStack(spacing: 8) {
            secondaryButton(icon: "lock", "テーブルブロック", en: "Block", enabled: canOperate) {
                Task { await model.act(["type": "floorBlock", "tableId": table.id, "unavailable": true]); onClose() }
            }
            secondaryButton(icon: nil, "テーブルグループ設定", en: "Table group", on: groupOpen, enabled: canOperate) {
                groupPick = table.groupTableIds.isEmpty ? [table.id] : table.groupTableIds
                groupOpen.toggle()
            }
        }
    }

    // 着席中
    @ViewBuilder private var seatedBody: some View {
        // 人数・顧客・来店・金額のまとめは出さない（卓の箱に出ている。2026-10-24 Ronnie「ポップアップに金額などの詳細は要らない」）
        HStack(spacing: 8) {
            bigButton("注文", en: "Order", fill: Self.primary, height: 64, size: 20) {
                Task {
                    if let s = selected {
                        onClose(); onOpenOrder(s.id, false)
                    } else if let r = await model.act(["type": "floorOrder", "tableId": table.id], refreshAfter: false), let id = r.orderId {
                        onClose(); onOpenOrder(id, false)
                    }
                }
            }
            // レジ会計は緑（2026-10-24 Ronnie「緑はレジ会計、会計伝票は黒」）
            // 注文＝紫紺、レジ会計・会計伝票＝白い箱（黒・緑にしない。2026-10-27 02:48 Ronnie「会計伝票 black ma pani pardaina」）
            bigButton("レジ会計", en: "Checkout", fill: .white, textColor: Self.ink, border: Self.line, height: 64, size: 20, enabled: selected != nil) {
                if let s = selected { onClose(); onOpenOrder(s.id, true) }
            }
        }
        // 会計伝票をその場で出す（レジ画面へ行かない）。注文・レジ会計のすぐ下に横いっぱい・黒
        bigButton("会計伝票", en: "Print bill", fill: .white, textColor: Self.ink, border: Self.line, height: 62, size: 19, enabled: selected != nil) {
            Task {
                guard let s = selected else { return }
                // ネットあり：どのフロアの卓でもこの iPad のレシートプリンターで（いつも。2026-10-26 Ronnie「default always on」）。
                // この iPad にレシートプリンターが無いときだけ、今まで通りその卓のフロアのプリンター（floorBill）
                if NativeNet.shared.online {
                    switch await NativeRegisterBill.print(orderId: s.id, clerkName: nil) {
                    case .printed:
                        model.show(toast: "お会計伝票を印刷します")
                        return
                    case .failed(let err):
                        model.show(toast: "お会計伝票：\(err)")
                        return
                    case .noPrinter:
                        break
                    }
                }
                if let _ = await model.act(["type": "floorBill", "orderId": s.id], refreshAfter: false) {
                    model.show(toast: "お会計伝票を印刷します")
                }
            }
        }

        divider
        section("テーブル", en: "Table")
        HStack(spacing: 8) {
            // 卓の移動はこのポップアップで（オーダー画面には伝票の操作を出さない。2026-10-24 Ronnie「order vitra yo pardaina」）
            popBtn("テーブル移動", en: "Move", on: panel == .move, enabled: selected != nil) { panel = panel == .move ? nil : .move }
            popBtn("テーブル合算", en: "Merge", on: panel == .merge, enabled: selected != nil) { panel = panel == .merge ? nil : .merge }
            popBtn("グループ設定", en: "Group", on: groupOpen, enabled: canOperate) {
                groupPick = table.groupTableIds.isEmpty ? [table.id] : table.groupTableIds
                groupOpen.toggle()
            }
        }
        if let o = table.order {
            popBtn("お客様情報　\(NFTime.hm(o.openedAtMs))〜\(NFTime.hm(o.endAtMs))", en: "Guest info / time", enabled: selected != nil) {
                if let s = selected { onClose(); onGuestInfo(o, s) }
            }
        }
        if panel == .merge { mergePanel }
        if panel == .move { movePanel }

        // 会計伝票は上の黒いボタンへ移した。ここは品を選んで出す印刷だけ
        section("印刷", en: "Print")
        HStack(spacing: 8) {
            popBtn("選択印刷", en: "Selected", on: panel == .print, enabled: selected != nil && !(selected?.lines.isEmpty ?? true)) {
                printPick = []
                panel = panel == .print ? nil : .print
            }
            popBtn("デシャップ伝票", en: "Expo", enabled: selected != nil) {
                Task {
                    if let s = selected, let _ = await model.act(["type": "floorExpo", "orderId": s.id], refreshAfter: false) {
                        model.show(toast: "デシャップ伝票を印刷します")
                    }
                }
            }
        }
        if panel == .print { printPanel }

        divider
        // 下の「お客様情報」は出さない（上の「お客様情報 10:21〜」と重なる。2026-10-24 Ronnie「ここに要らない」）
        HStack(spacing: 8) {
            popBtn("支払メモ", en: "Payment note", on: panel == .memo, enabled: selected != nil) {
                memoText = ""
                panel = panel == .memo ? nil : .memo
            }
        }
        if panel == .memo { memoPanel }

        // テーブルクリア：¥0 の卓（まだ何も注文していない）にだけ出す。店長の承認も必要
        if table.order != nil && total == 0 {
            VStack(alignment: .leading, spacing: 6) {
                Text("注文のない卓を空席に戻します（売上には入りません。担当者（店長以上）を選ぶだけで、理由は要りません）。")
                    .font(.system(size: 10)).foregroundColor(NFColor.ink2)
                popBtn("テーブルクリア", en: "Clear table", danger: true, enabled: selected != nil) { clearConfirm = true }
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.dangerSoft.opacity(0.4)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.danger.opacity(0.3), lineWidth: 1))
        }
    }

    private func clearTable(approver: String?) async {
        guard let s = selected else { return }
        var body: [String: Any] = ["type": "floorClear", "orderId": s.id, "reason": ""]
        if let approver { body["approvedByClerkId"] = approver }
        if let r = await model.act(body) {
            let n = r.cancelledItems ?? 0
            model.show(toast: n > 0 ? "テーブルをクリアしました（\(n)品を取消）" : "テーブルをクリアしました")
            onClose()
        }
    }

    // MARK: 小さなパネル

    private var mergePanel: some View {
        panelBox {
            Text("どの卓をまとめますか / Merge which table").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2)
            if mergeCandidates.isEmpty {
                Text("ほかにお客様が入っている卓がありません").font(.system(size: 11)).foregroundColor(NFColor.ink3)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
                    ForEach(mergeCandidates) { t in
                        Button {
                            Task {
                                guard let s = selected, let src = t.order?.slips.first else { return }
                                if let _ = await model.act(["type": "floorMerge", "targetOrderId": s.id, "sourceOrderId": src.id]) {
                                    panel = nil
                                    model.show(toast: "\(t.name) の伝票を \(table.name) にまとめました")
                                }
                            }
                        } label: {
                            Text(t.name).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.navy)
                                .frame(maxWidth: .infinity).frame(height: 40)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
        }
    }

    private var movePanel: some View {
        panelBox {
            Text("移動先の空席を選ぶ / Choose an empty table").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2)
            if moveCandidates.isEmpty {
                Text("空席がありません").font(.system(size: 11)).foregroundColor(NFColor.ink3)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
                    ForEach(moveCandidates) { t in
                        Button {
                            Task {
                                guard let s = selected else { return }
                                if let _ = await model.act(["type": "floorMove", "orderId": s.id, "tableId": t.id]) {
                                    panel = nil
                                    model.show(toast: "\(table.name) の伝票を \(t.name) に移動しました")
                                    onClose()
                                }
                            }
                        } label: {
                            Text(t.name).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.navy)
                                .frame(maxWidth: .infinity).frame(height: 40)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(model.busy)
                    }
                }
            }
        }
    }

    private var printPanel: some View {
        panelBox {
            Text("印刷する品を選ぶ / Pick items").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2)
            ScrollView {
                VStack(spacing: 4) {
                    ForEach(selected?.lines ?? []) { l in
                        let on = printPick.contains(l.id)
                        Button {
                            if on { printPick.removeAll { $0 == l.id } } else { printPick.append(l.id) }
                        } label: {
                            HStack {
                                Text(l.name).lineLimit(1)
                                Spacer()
                                Text("x\(l.quantity)").monospacedDigit().foregroundColor(NFColor.ink3)
                            }
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(on ? NFColor.royal : NFColor.navy)
                            .padding(.horizontal, 8).padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 8).fill(on ? NFColor.irisSoft : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? NFColor.royal : NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxHeight: 160)
            bigButton("この\(printPick.count)品を印刷 / Print", en: nil, fill: NFColor.iris, height: 46, size: 15, enabled: !printPick.isEmpty) {
                Task {
                    guard let s = selected else { return }
                    if let _ = await model.act(["type": "floorPrintSelected", "orderId": s.id, "itemIds": printPick], refreshAfter: false) {
                        panel = nil
                        model.show(toast: "\(printPick.count)品を印刷します")
                    }
                }
            }
        }
    }

    private var guestPanel: some View {
        panelBox {
            Text("人数 / Guests").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2)
            HStack(spacing: 8) {
                stepButton("−", enabled: guestEdit > 1) { guestEdit = max(1, guestEdit - 1) }
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(guestEdit)").font(.system(size: 24, weight: NT.strong)).monospacedDigit().foregroundColor(NFColor.navy)
                    Text("名").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                }
                .frame(maxWidth: .infinity).frame(height: 44)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                stepButton("＋", enabled: guestEdit < 99) { guestEdit = min(99, guestEdit + 1) }
            }
            bigButton("保存 / Save", en: nil, fill: NFColor.iris, height: 46, size: 15, enabled: selected != nil) {
                Task {
                    guard let s = selected else { return }
                    if let _ = await model.act(["type": "floorGuests", "orderId": s.id, "guestCount": guestEdit]) {
                        panel = nil
                        model.show(toast: "人数を変えました")
                    }
                }
            }
        }
    }

    private var memoPanel: some View {
        panelBox {
            Text("支払メモ / Payment note").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2)
            TextField("例）カード決済のつもりが現金で受領", text: $memoText)
                .font(.system(size: 13)).foregroundColor(NFColor.navy)
                .padding(.horizontal, 12).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
            bigButton("保存 / Save", en: nil, fill: NFColor.iris, height: 46, size: 15, enabled: selected != nil) {
                Task {
                    guard let s = selected else { return }
                    if let _ = await model.act(["type": "floorMemo", "orderId": s.id, "memo": memoText]) {
                        panel = nil
                        model.show(toast: "支払メモを保存しました")
                    }
                }
            }
        }
    }

    // まとめる卓を選ぶ
    private var groupPanel: some View {
        panelBox {
            Text("同じ組にする卓を選ぶ / Tables in this group").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink2)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
                    ForEach(model.tables.filter { $0.floorId == table.floorId }) { t in
                        let on = groupPick.contains(t.id)
                        let me = t.id == table.id
                        Button {
                            if on { groupPick.removeAll { $0 == t.id } } else { groupPick.append(t.id) }
                        } label: {
                            Text(t.name).font(.system(size: 12, weight: .bold))
                                .foregroundColor(on ? .white : NFColor.navy)
                                .frame(maxWidth: .infinity).frame(height: 36)
                                .background(RoundedRectangle(cornerRadius: 8).fill(on ? NFColor.iris : Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(me)
                    }
                }
            }
            .frame(maxHeight: 180)
            HStack(spacing: 8) {
                bigButton("解除 / Clear", en: nil, fill: NFColor.irisSoft, textColor: NFColor.royal, height: 46, size: 15) {
                    Task {
                        // 1卓だけ渡す＝その卓が入っているグループをまるごと解除
                        if let _ = await model.act(["type": "floorGroup", "tableIds": [table.id]]) {
                            groupOpen = false
                            model.show(toast: "グループを解除しました")
                        }
                    }
                }
                bigButton("保存 / Save", en: nil, fill: NFColor.iris, height: 46, size: 15) {
                    Task {
                        if let _ = await model.act(["type": "floorGroup", "tableIds": groupPick.isEmpty ? [table.id] : groupPick]) {
                            groupOpen = false
                            model.show(toast: "テーブルグループを保存しました")
                        }
                    }
                }
            }
        }
    }

    // MARK: 部品

    private var divider: some View { Rectangle().fill(NFColor.line).frame(height: 1).padding(.vertical, 2) }

    private func section(_ ja: String, en: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(ja).font(.system(size: 14, weight: .bold))
            Text(en).font(.system(size: 11, weight: .semibold)).opacity(0.7)
        }
        .foregroundColor(NFColor.ink3)
        .padding(.horizontal, 2)
    }

    private func summaryRow(_ k: String, _ v: String) -> some View {
        HStack(spacing: 6) {
            Text(k).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 46, alignment: .leading)
            Text(v).font(.system(size: 12)).monospacedDigit().foregroundColor(NFColor.navy).lineLimit(1)
        }
    }

    private func panelBox<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6, content: content)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
    }

    /// ポップアップの色（ホームの左のメニューの紫紺・白い箱・うすい灰色の地。2026-10-27 02:48 Ronnie の見本）
    static let sheetBg = Color(hex: 0xF4F5F7)
    static let primary = Color(hex: 0x37324D)
    static let ink = Color(hex: 0x2B2740)
    static let line = Color(hex: 0xE3E5EA)

    private func bigButton(_ ja: String, en: String?, fill: Color, textColor: Color = .white, border: Color? = nil, height: CGFloat = 60, size: CGFloat = 18, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Text(ja).font(.system(size: size, weight: NT.strong))
                if let en { Text(en).font(.system(size: 12, weight: .semibold)).opacity(0.8) }
            }
            .foregroundColor(textColor)
            .frame(maxWidth: .infinity).frame(height: height)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fill))
            .overlay { if let border { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(border, lineWidth: 1) } }
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }

    private func secondaryButton(icon: String?, _ ja: String, en: String, on: Bool = false, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    if let icon { Image(systemName: icon).font(.system(size: 14, weight: .bold)) }
                    Text(ja)
                }
                .font(.system(size: 16, weight: .bold))
                Text(en).font(.system(size: 11, weight: .semibold)).opacity(0.8)
            }
            .foregroundColor(on ? .white : NFColor.royal)
            .frame(maxWidth: .infinity).frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NFColor.iris : NFColor.irisSoft))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    /// Web の PopBtn（白地・罫線。選択中は青、取消系は赤）
    private func popBtn(_ ja: String, en: String, on: Bool = false, danger: Bool = false, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Text(ja).font(.system(size: 16, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
                Text(en).font(.system(size: 11, weight: .semibold)).foregroundColor(on ? .white.opacity(0.8) : NFColor.ink3)
            }
            .foregroundColor(on ? .white : (danger ? NFColor.danger : NFColor.navy))
            .frame(maxWidth: .infinity).frame(height: 58)
            .padding(.horizontal, 4)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? Self.primary : (danger ? NFColor.danger.opacity(0.08) : Color.white)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Color.clear : (danger ? NFColor.danger.opacity(0.25) : Self.line), lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    private func stepButton(_ text: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 20, weight: .bold)).foregroundColor(NFColor.royal)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }
}

/// ポップアップ／カードを 1 つ置く Layout。中身の高さに合わせ（入らないときは maxHeight で止めて中をスクロール）、
/// anchor（押した卓）があればその「上」、上に入らなければ卓に重ねて下へ（Web の卓のポップアップと同じ）。anchor が無ければ画面の真ん中。
/// 高さは subview の sizeThatFits で測る（preference で測る方式は実機で 0 のままになることがあった。2026-10-24）
struct NFCardLayout: Layout {
    var width: CGFloat
    var maxHeight: CGFloat
    var anchor: CGRect? = nil
    var margin: CGFloat = 8
    /// 上のバーの高さ（これより上には出さない）
    var topInset: CGFloat = 64

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let sub = subviews.first else { return }
        let w = min(width, max(200, bounds.width - margin * 2))
        let cap = min(maxHeight, max(120, bounds.height - margin * 2))
        let h = min(sub.sizeThatFits(ProposedViewSize(width: w, height: cap)).height, cap)
        let x: CGFloat
        let y: CGFloat
        if let a = anchor {
            x = min(max(margin, a.midX - w / 2), max(margin, bounds.width - w - margin))
            let above = a.minY - h - 8
            y = above >= topInset ? above : min(max(topInset, a.minY), max(topInset, bounds.height - h - margin))
        } else {
            x = max(margin, (bounds.width - w) / 2)
            y = max(margin, (bounds.height - h) / 2)
        }
        sub.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: h))
    }
}

/// 画面の真ん中に出すカード（来店登録・お客様情報）。外（暗い所）を押しても閉じない（入力途中を守る）
struct NativeModalCard<Content: View>: View {
    var width: CGFloat = 760
    var maxHeight: CGFloat = 1200
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            Color.black.opacity(0.28).ignoresSafeArea()
            NFCardLayout(width: width, maxHeight: maxHeight, anchor: nil, margin: 16) {
                content()
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(NFColor.lilacSoft))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    .shadow(color: Color(hex: 0x292725).opacity(0.3), radius: 30, y: 20)
            }
        }
    }
}


/// ポップオーバーの矢印（上向きの三角。向きは rotationEffect で変える）
struct NFPopoverArrow: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.midX, y: r.minY), control: CGPoint(x: r.midX - r.width * 0.12, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.maxY), control: CGPoint(x: r.midX + r.width * 0.12, y: r.minY))
        p.closeSubpath()
        return p
    }
}

/// 卓のポップアップを、押した卓のところに矢印つきで置く Layout（subviews = 中身・上矢印・下矢印・左矢印・右矢印）。
/// 卓の下に入ればその下（矢印は上）、だめなら上（矢印は下）、だめなら右か左（矢印は横）。どこにも入らなければ卓に重ねる（矢印なし）。
struct NFPopoverLayout: Layout {
    var width: CGFloat
    var maxHeight: CGFloat
    var anchor: CGRect?
    var margin: CGFloat = 10
    var topInset: CGFloat = 64
    /// anchor が無いとき、上の端をこの高さにそろえる（nil なら上下の真ん中）
    var fixedTop: CGFloat? = nil
    private let gap: CGFloat = 12

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let card = subviews.first else { return }
        let W = bounds.width, H = bounds.height
        let w = min(width, max(200, W - margin * 2))
        let cap = min(maxHeight, max(120, H - margin * 2))
        let h = min(card.sizeThatFits(ProposedViewSize(width: w, height: cap)).height, cap)
        let hide = CGPoint(x: bounds.minX - 5000, y: bounds.minY - 5000)
        func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat { min(max(v, lo), max(lo, hi)) }

        var x: CGFloat, y: CGFloat
        var arrow = -1 // 1=上 2=下 3=左 4=右
        var arrowPt = CGPoint.zero
        if let a = anchor, a != .zero {
            if a.maxY + gap + h <= H - margin {
                x = clamp(a.midX - w / 2, margin, W - w - margin); y = a.maxY + gap
                arrow = 1; arrowPt = CGPoint(x: clamp(a.midX, x + 28, x + w - 28) - 13, y: y - 12)
            } else if a.minY - gap - h >= topInset {
                x = clamp(a.midX - w / 2, margin, W - w - margin); y = a.minY - gap - h
                arrow = 2; arrowPt = CGPoint(x: clamp(a.midX, x + 28, x + w - 28) - 13, y: y + h)
            } else if a.maxX + gap + w <= W - margin {
                x = a.maxX + gap; y = clamp(a.midY - h / 2, topInset, H - h - margin)
                arrow = 3; arrowPt = CGPoint(x: x - 12, y: clamp(a.midY, y + 28, y + h - 28) - 13)
            } else if a.minX - gap - w >= margin {
                x = a.minX - gap - w; y = clamp(a.midY - h / 2, topInset, H - h - margin)
                arrow = 4; arrowPt = CGPoint(x: x + w, y: clamp(a.midY, y + 28, y + h - 28) - 13)
            } else {
                x = clamp(a.midX - w / 2, margin, W - w - margin); y = clamp(a.minY, topInset, H - h - margin)
            }
        } else if let top = fixedTop {
            x = max(margin, (W - w) / 2); y = max(topInset, min(top, H - h - margin))
        } else {
            x = max(margin, (W - w) / 2); y = max(margin, (H - h) / 2)
        }
        card.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: h))
        for i in 1..<subviews.count {
            let size = i <= 2 ? ProposedViewSize(width: 26, height: 12) : ProposedViewSize(width: 12, height: 26)
            if i == arrow {
                subviews[i].place(at: CGPoint(x: bounds.minX + arrowPt.x, y: bounds.minY + arrowPt.y), anchor: .topLeading, proposal: size)
            } else {
                subviews[i].place(at: hide, anchor: .topLeading, proposal: size)
            }
        }
    }
}
