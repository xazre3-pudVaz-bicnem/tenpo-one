import SwiftUI

// 店舗台帳の予約の詳細・新規登録（ネイティブ）。Web の reservation-sheet / manual-reservation-dialog と同じ機能

/// 予約の詳細：来店・オーダー・会計（着席して伝票へ）・キャンセル・無断キャンセル・卓・時間・担当・経路・コース・メモ（退店は会計で自動）
struct NativeReservationSheet: View {
    @ObservedObject var model: NativeLedgerModel
    let reservation: NLReservation
    let onClose: () -> Void
    let onOpenOrder: (String) -> Void

    @State private var memo: String
    @State private var tablePick: [String]
    @State private var tableOpen = false
    @State private var timeOpen = false
    @State private var startDate = Date()
    @State private var stay = 120
    @State private var cancelOpen = false
    @State private var cancelReason = ""
    @State private var noShowOpen = false

    init(model: NativeLedgerModel, reservation: NLReservation, onClose: @escaping () -> Void, onOpenOrder: @escaping (String) -> Void) {
        self.model = model
        self.reservation = reservation
        self.onClose = onClose
        self.onOpenOrder = onOpenOrder
        _memo = State(initialValue: reservation.memo ?? "")
        _tablePick = State(initialValue: reservation.tableIds)
        let p = ISO8601DateFormatter()
        p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let s = p.date(from: reservation.startAt) ?? { p.formatOptions = [.withInternetDateTime]; return p.date(from: reservation.startAt) ?? Date() }()
        let e = p.date(from: reservation.endAt) ?? s.addingTimeInterval(7200)
        _startDate = State(initialValue: s)
        _stay = State(initialValue: max(15, Int(e.timeIntervalSince(s) / 60)))
    }

    /// 最新（読み直し後）の予約
    private var r: NLReservation { model.payload?.reservations.first { $0.id == reservation.id } ?? reservation }
    private var p: NLPayload? { model.payload }
    private var canWrite: Bool { p?.canWrite ?? false }
    private var allowed: [String] { p?.transitions[r.status] ?? [] }
    private var late: Bool { model.isLate(r) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    // 主な操作（状態に合わせて）
                    HStack(spacing: 10) {
                        if allowed.contains("arrived") {
                            bigButton("来店済み", en: "Arrived", fill: NLColor.green) { Task { await status("arrived") } }
                        }
                        // 「オーダー・会計」（着席して伝票を開く。色はオーダー・会計のボタンと同じ青）。2026-10-24 21:30 Ronnie「Seat & order ではなく オーダー・会計」
                        if allowed.contains("seated") || r.status == "arrived" || r.status == "seated" {
                            bigButton("注文・会計", en: "Order & Pay", fill: Color(hex: 0x2A6FE6)) {
                                Task {
                                    if let res = await model.act(["type": "ledgerSeat", "reservationId": r.id]), let id = res.orderId {
                                        onOpenOrder(id)
                                    }
                                }
                            }
                        }
                        // 「退店」のボタンは出さない。会計が済むと自動で退店になる（DB の会計の処理が予約を completed にする。2026-10-24 21:30 Ronnie）
                        if allowed.contains("confirmed") && r.status == "pending" {
                            bigButton("予約確定", en: "Confirm", fill: NLColor.blue) { Task { await status("confirmed") } }
                        }
                    }
                    .disabled(!canWrite || model.busy)

                    // 内容
                    card {
                        infoRow("日時", "\(r.reservedDate.replacingOccurrences(of: "-", with: "/"))　\(nlHm(nlJstMinutes(r.startAt, dayStart: r.reservedDate)))〜\(nlHm(nlJstMinutes(r.endAt, dayStart: r.reservedDate)))") {
                            if canWrite { smallButton(timeOpen ? "閉じる" : "変更") { withAnimation { timeOpen.toggle() } } }
                        }
                        if timeOpen {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 14) {
                                    DatePicker("開始", selection: $startDate, displayedComponents: [.date, .hourAndMinute])
                                        .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                                        .environment(\.locale, Locale(identifier: "ja_JP"))
                                }
                                HStack(spacing: 8) {
                                    Text("滞在").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
                                    ForEach([60, 90, 120, 150, 180], id: \.self) { m in
                                        chip("\(m / 60)時間\(m % 60 == 0 ? "" : "30分")", on: stay == m, color: NLColor.blue) { stay = m }
                                    }
                                }
                                bigButton("日時を保存", en: "Save", fill: NLColor.blue) {
                                    let f = DateFormatter()
                                    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                                    f.dateFormat = "yyyy-MM-dd"
                                    let t = DateFormatter()
                                    t.timeZone = TimeZone(identifier: "Asia/Tokyo")
                                    t.dateFormat = "HH:mm"
                                    Task {
                                        if let _ = await model.act(["type": "ledgerMove", "reservationId": r.id, "date": f.string(from: startDate), "time": t.string(from: startDate), "stayMinutes": stay]) {
                                            timeOpen = false
                                            model.show(toast: "日時を変更しました")
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 16).padding(.bottom, 12)
                        }
                        divider
                        infoRow("人数", r.partySizeMin != nil ? "\(r.partyLabel)（席は \(r.partySize)名・うち子供 \(r.children)）" : "\(r.partySize)名（大人 \(r.adults)・子供 \(r.children)）") { EmptyView() }
                        divider
                        infoRow("テーブル", r.tableNames.isEmpty ? "席未定" : r.tableNames.joined(separator: " + ")) {
                            if canWrite { smallButton(tableOpen ? "閉じる" : "変更") { withAnimation { tableOpen.toggle() } } }
                        }
                        if tableOpen, let p {
                            VStack(alignment: .leading, spacing: 10) {
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
                                    ForEach(p.tables) { t in
                                        let on = tablePick.contains(t.id)
                                        chip("\(t.name)（\(t.capacityMax)）", on: on, color: NLColor.blue) {
                                            if on { tablePick.removeAll { $0 == t.id } } else { tablePick.append(t.id) }
                                        }
                                    }
                                }
                                bigButton("テーブルを保存", en: "Save", fill: NLColor.blue) {
                                    Task {
                                        if let _ = await model.act(["type": "ledgerTables", "reservationId": r.id, "tableIds": tablePick]) {
                                            tableOpen = false
                                            model.show(toast: "テーブルを変更しました")
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 16).padding(.bottom, 12)
                        }
                        divider
                        infoRow("電話", r.guestPhone) { EmptyView() }
                        if let e = r.guestEmail, !e.isEmpty { divider; infoRow("メール", e) { EmptyView() } }
                        divider
                        pickerRow("経路", current: r.sourceId ?? "", options: (p?.sourceRows ?? []).map { ($0.id, $0.name) }, none: "未設定") { id in
                            Task { if let _ = await model.act(["type": "ledgerSource", "reservationId": r.id, "sourceId": id ?? NSNull()]) { model.show(toast: "経路を変更しました") } }
                        }
                        divider
                        pickerRow("コース", current: r.courseId ?? "", options: (p?.courses ?? []).map { ($0.id, $0.name) }, none: "なし（アラカルト）") { id in
                            Task { if let _ = await model.act(["type": "ledgerCourse", "reservationId": r.id, "courseId": id ?? NSNull()]) { model.show(toast: "コースを変更しました") } }
                        }
                        divider
                        pickerRow("担当", current: r.staffId ?? "", options: (p?.staffOptions ?? []).map { ($0.id, $0.name) }, none: "担当なし") { id in
                            Task { if let _ = await model.act(["type": "ledgerClerk", "reservationId": r.id, "clerkId": id ?? NSNull()]) { model.show(toast: "担当を変更しました") } }
                        }
                        if let t = r.tags, !t.isEmpty {
                            divider
                            // キーワード・お客様／予約のタグ（区分のタグは小さいアイコンつき）
                            HStack(alignment: .top, spacing: 12) {
                                Text("タグ").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted).frame(width: 76, alignment: .leading).padding(.top, 6)
                                NRWFlow(spacing: 6, lineSpacing: 6) {
                                    ForEach(t, id: \.self) { tag in
                                        HStack(spacing: 4) {
                                            Image(systemName: NRWTagIcon.symbol(p?.tagIcons?[tag] ?? "tag")).font(.system(size: 10, weight: .semibold))
                                            Text(tag).font(.system(size: 13, weight: .bold))
                                        }
                                        .foregroundColor(tag == "要連絡" ? NLColor.red : NLColor.navy)
                                        .padding(.horizontal, 10).frame(height: 28)
                                        .background(Capsule().fill(tag == "要連絡" ? NLColor.redSoft : NLColor.page))
                                        .overlay(Capsule().stroke(NLColor.line, lineWidth: 1))
                                    }
                                }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                        }
                        if let n = r.requestNote, !n.isEmpty { divider; infoRow("ご要望", n) { EmptyView() } }
                        if let a = r.allergyNote, !a.isEmpty { divider; infoRow("アレルギー", a) { EmptyView() } }
                        if let pu = r.purpose, !pu.isEmpty { divider; infoRow("目的", pu) { EmptyView() } }
                        divider
                        VStack(alignment: .leading, spacing: 8) {
                            Text("メモ / Memo").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
                            TextField("メモ", text: $memo, axis: .vertical)
                                .lineLimit(2...5)
                                .font(.system(size: 15)).foregroundColor(NLColor.ink)
                                .padding(10)
                                .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.page))
                            if memo != (r.memo ?? "") {
                                bigButton("メモを保存", en: "Save memo", fill: NLColor.blue) {
                                    Task { if let _ = await model.act(["type": "ledgerMemo", "reservationId": r.id, "memo": memo]) { model.show(toast: "メモを保存しました") } }
                                }
                            }
                        }
                        .padding(16)
                    }

                    // 取消
                    if canWrite && (allowed.contains("cancelled") || allowed.contains("no_show")) {
                        HStack(spacing: 10) {
                            if allowed.contains("cancelled") {
                                outlineButton("キャンセル", en: "Cancel", color: NLColor.red) { cancelOpen = true }
                            }
                            if allowed.contains("no_show") {
                                outlineButton("無断キャンセル", en: "No show", color: NLColor.red) { noShowOpen = true }
                            }
                            Spacer()
                        }
                    }
                }
                .padding(20)
            }
            .background(NLColor.page)
            .navigationTitle("予約の詳細 / Reservation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
        }
        .presentationDetents([.large])
        .alert("キャンセルしますか / Cancel?", isPresented: $cancelOpen) {
            TextField("理由（必須）", text: $cancelReason)
            Button("キャンセルする", role: .destructive) {
                Task { if let _ = await model.act(["type": "ledgerCancel", "reservationId": r.id, "reason": cancelReason]) { model.show(toast: "キャンセルしました"); onClose() } }
            }
            Button("戻る", role: .cancel) {}
        } message: { Text("\(stripSama(r.guestName)) 様 \(r.partySize)名 の予約を取り消します。") }
        .alert("無断キャンセルにしますか / No show?", isPresented: $noShowOpen) {
            Button("無断キャンセルにする", role: .destructive) {
                Task { if let _ = await model.act(["type": "ledgerNoShow", "reservationId": r.id, "reason": ""]) { model.show(toast: "無断キャンセルにしました"); onClose() } }
            }
            Button("戻る", role: .cancel) {}
        }
    }

    private func status(_ to: String) async {
        if let _ = await model.act(["type": "ledgerStatus", "reservationId": r.id, "toStatus": to]) {
            model.show(toast: "\(p?.statusLabels[to] ?? to) にしました")
        }
    }

    private var header: some View {
        let tone = NLColor.tone(r.status, late: late)
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("\(stripSama(r.guestName)) 様").font(.system(size: 26, weight: .heavy)).foregroundColor(NLColor.ink)
                    if let k = r.guestNameKana, !k.isEmpty { Text(k).font(.system(size: 13)).foregroundColor(NLColor.muted) }
                    if let v = r.visitCount, v >= 2 {
                        Text("\(v)回目").font(.system(size: 11, weight: .heavy)).foregroundColor(NLColor.blue)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NLColor.blueSoft))
                    }
                }
                HStack(spacing: 8) {
                    Text(r.partyLabel).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.ink)
                    Text("\(nlHm(nlJstMinutes(r.startAt, dayStart: r.reservedDate)))〜\(nlHm(nlJstMinutes(r.endAt, dayStart: r.reservedDate)))").font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NLColor.ink)
                    if let p, let st = NLSource.style(for: r, in: p) {
                        NLSourceChip(style: st, auto: r.createdVia == "gourmet_mail", size: 11)
                    } else if let s = r.sourceName { Text(s).font(.system(size: 13)).foregroundColor(NLColor.muted) }
                    if r.createdVia == "gourmet_mail" { Text("自動取込").font(.system(size: 12)).foregroundColor(NLColor.muted) }
                    if let c = r.courseName { Text(c).font(.system(size: 13)).foregroundColor(NLColor.muted) }
                    Text("#\(r.code)").font(.system(size: 12)).foregroundColor(NLColor.muted)
                }
            }
            Spacer()
            Text(late ? "未連絡" : (p?.statusLabels[r.status] ?? r.status))
                .font(.system(size: 14, weight: .heavy)).foregroundColor(tone.1)
                .padding(.horizontal, 14).padding(.vertical, 8).background(Capsule().fill(tone.0))
        }
    }

    // MARK: 部品

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NLColor.card))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NLColor.line, lineWidth: 1))
    }

    private var divider: some View { Rectangle().fill(NLColor.line).frame(height: 1) }

    private func infoRow<Right: View>(_ label: String, _ value: String, @ViewBuilder right: () -> Right) -> some View {
        HStack(spacing: 12) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted).frame(width: 76, alignment: .leading)
            Text(value).font(.system(size: 15, weight: .semibold)).foregroundColor(NLColor.ink)
            Spacer()
            right()
        }
        .padding(.horizontal, 16).frame(minHeight: 52)
    }

    private func pickerRow(_ label: String, current: String, options: [(String, String)], none: String, onPick: @escaping (String?) -> Void) -> some View {
        HStack(spacing: 12) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted).frame(width: 76, alignment: .leading)
            Menu {
                Button(none) { onPick(nil) }
                ForEach(options, id: \.0) { o in Button(o.1) { onPick(o.0) } }
            } label: {
                HStack(spacing: 6) {
                    Text(options.first { $0.0 == current }?.1 ?? none).font(.system(size: 15, weight: .semibold)).foregroundColor(NLColor.ink)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                }
            }
            .disabled(!canWrite)
            Spacer()
        }
        .padding(.horizontal, 16).frame(minHeight: 52)
    }

    private func smallButton(_ text: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.blue)
                .padding(.horizontal, 12).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(NLColor.blueSoft))
        }
        .buttonStyle(PressableStyle())
    }

    private func chip(_ text: String, on: Bool, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                .foregroundColor(on ? .white : color)
                .frame(maxWidth: .infinity).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? color : color.opacity(0.1)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(on ? 0 : 0.35), lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func bigButton(_ ja: String, en: String, fill: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(ja).font(.system(size: 17, weight: .heavy))
                Text(en).font(.system(size: 11, weight: .bold)).opacity(0.8)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity).frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(fill))
        }
        .buttonStyle(PressableStyle())
    }

    private func outlineButton(_ ja: String, en: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(ja).font(.system(size: 15, weight: .heavy))
                Text(en).font(.system(size: 10, weight: .bold)).opacity(0.8)
            }
            .foregroundColor(color)
            .padding(.horizontal, 18).frame(height: 52)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(color.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(color.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

/// キャンセル待ちから「予約へ変換」するときの初期値（予約登録は NativeReservationEntry.swift）
struct NLReservationPrefill {
    /// キャンセル待ちから「予約へ変換」するとき（スケジュールの空いたマスから開くときは nil）
    var waitlistEntryId: String? = nil
    let date: String
    let time: String
    let adults: Int
    var name: String = ""
    var phone: String = ""
    var note: String = ""
    /// スケジュールの空いたマスを押したとき：その卓・人数の範囲（最大）・キーワード
    var tableIds: [String] = []
    var partyMax: Int? = nil
    var children: Int = 0
    var tags: [String] = []
}

