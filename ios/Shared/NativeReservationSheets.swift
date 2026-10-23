import SwiftUI

// 店舗台帳の予約の詳細・新規登録（ネイティブ）。Web の reservation-sheet / manual-reservation-dialog と同じ機能

/// 予約の詳細：来店・着席（注文へ）・退店・キャンセル・無断キャンセル・卓・時間・担当・経路・コース・メモ
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
                        if allowed.contains("seated") || r.status == "arrived" || r.status == "seated" {
                            bigButton(r.status == "seated" ? "伝票を開く" : "着席して注文へ", en: "Seat & order", fill: NLColor.blue) {
                                Task {
                                    if let res = await model.act(["type": "ledgerSeat", "reservationId": r.id]), let id = res.orderId {
                                        onOpenOrder(id)
                                    }
                                }
                            }
                        }
                        if allowed.contains("completed") {
                            bigButton("退店", en: "Left", fill: NLColor.navy2) { Task { await status("completed") } }
                        }
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
                        infoRow("人数", "\(r.partySize)名（大人 \(r.adults)・子供 \(r.children)）") { EmptyView() }
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
                        if let t = r.tags, !t.isEmpty { divider; infoRow("キーワード", t.joined(separator: "、")) { EmptyView() } }
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
                    Text("\(r.partySize)名").font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.ink)
                    Text("\(nlHm(nlJstMinutes(r.startAt, dayStart: r.reservedDate)))〜\(nlHm(nlJstMinutes(r.endAt, dayStart: r.reservedDate)))").font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NLColor.ink)
                    if let s = r.sourceName { Text(s).font(.system(size: 13)).foregroundColor(NLColor.muted) }
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

/// 予約登録（電話予約の手動登録）。Web の manual-reservation-dialog と同じ項目
/// キャンセル待ちから「予約へ変換」するときの初期値
struct NLReservationPrefill {
    let waitlistEntryId: String
    let date: String
    let time: String
    let adults: Int
    let name: String
    let phone: String
    let note: String
}

struct NativeNewReservationSheet: View {
    @ObservedObject var model: NativeLedgerModel
    var prefill: NLReservationPrefill? = nil
    let onClose: () -> Void

    @State private var date = Date()
    @State private var adults = 2
    @State private var children = 0
    @State private var name = ""
    @State private var kana = ""
    @State private var phone = ""
    @State private var note = ""
    @State private var sourceCode = "phone"
    @State private var courseId = ""
    @State private var tableIds: [String] = []
    @State private var stay: Int? = nil
    @State private var pending = false
    @State private var clerkId = ""
    @State private var saving = false
    @State private var problem: String?

    private var p: NLPayload? { model.payload }
    private var canSave: Bool { !saving && !name.trimmingCharacters(in: .whitespaces).isEmpty && phone.filter(\.isNumber).count >= 10 && adults + children >= 1 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    field("日時 / Date & time") {
                        DatePicker("", selection: $date, displayedComponents: [.date, .hourAndMinute])
                            .labelsHidden()
                            .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                            .environment(\.locale, Locale(identifier: "ja_JP"))
                    }
                    HStack(spacing: 24) {
                        field("大人 / Adults") { NFStepper(title: nil, value: $adults, min: 0, max: 999) }
                        field("子供 / Children") { NFStepper(title: nil, value: $children, min: 0, max: 999) }
                    }
                    HStack(spacing: 14) {
                        field("お名前 / Name ＊") { textField("山田 太郎", text: $name) }
                        field("ふりがな / Kana") { textField("やまだ たろう", text: $kana) }
                    }
                    field("電話番号 / Phone ＊") { textField("090-0000-0000", text: $phone).keyboardType(.phonePad) }
                    field("予約経路 / Source") {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
                            ForEach(p?.sources ?? [], id: \.code) { s in
                                let v = NPVisitSource(id: s.code, label: s.name)
                                chip(s.name, on: sourceCode == s.code, color: v.color, darkText: v.darkText) { sourceCode = s.code }
                            }
                        }
                    }
                    field("コース / Course") {
                        Menu {
                            Button("なし（アラカルト）") { courseId = "" }
                            ForEach(p?.courses ?? []) { c in Button(c.name) { courseId = c.id } }
                        } label: {
                            HStack {
                                Text((p?.courses ?? []).first { $0.id == courseId }?.name ?? "なし（アラカルト）").font(.system(size: 15, weight: .semibold)).foregroundColor(NLColor.ink)
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                            }
                            .padding(.horizontal, 12).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.card))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NLColor.line, lineWidth: 1))
                        }
                    }
                    field("滞在時間 / Stay") {
                        HStack(spacing: 8) {
                            chip("店の既定", on: stay == nil, color: NLColor.blue, darkText: false) { stay = nil }
                            ForEach([60, 90, 120, 150, 180], id: \.self) { m in
                                chip("\(m / 60)時間\(m % 60 == 0 ? "" : "30分")", on: stay == m, color: NLColor.blue, darkText: false) { stay = m }
                            }
                        }
                    }
                    field("テーブル / Table") {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
                            ForEach(p?.tables ?? []) { t in
                                let on = tableIds.contains(t.id)
                                chip("\(t.name)（\(t.capacityMax)）", on: on, color: NLColor.blue, darkText: false) {
                                    if on { tableIds.removeAll { $0 == t.id } } else { tableIds.append(t.id) }
                                }
                            }
                        }
                    }
                    if !(p?.staffOptions ?? []).isEmpty {
                        field("担当 / Staff") {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
                                ForEach(p?.staffOptions ?? []) { s in
                                    chip(s.name, on: clerkId == s.id, color: NLColor.navy2, darkText: false) { clerkId = clerkId == s.id ? "" : s.id }
                                }
                            }
                        }
                    }
                    field("メモ / Note") { textField("ご要望・アレルギーなど", text: $note) }
                    HStack(spacing: 8) {
                        chip("予約確定（来店待ち）", on: !pending, color: NLColor.blue, darkText: false) { pending = false }
                        chip("仮予約", on: pending, color: NLColor.yellow, darkText: true) { pending = true }
                    }
                    if let pr = problem { Text(pr).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red) }
                }
                .padding(20)
            }
            .background(NLColor.page)
            .navigationTitle("予約登録 / New reservation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "登録中…" : "登録する") { Task { await save() } }
                        .font(.system(size: 16, weight: .heavy))
                        .disabled(!canSave)
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            if let pf = prefill {
                let f = DateFormatter()
                f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                f.dateFormat = "yyyy-MM-dd HH:mm"
                if let dt = f.date(from: "\(pf.date) \(pf.time)") { date = dt }
                adults = pf.adults; name = pf.name; phone = pf.phone; note = pf.note
                return
            }
            // 台帳の日の 18:00 を初期値に
            if let d = p?.date {
                let f = DateFormatter()
                f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                f.dateFormat = "yyyy-MM-dd HH:mm"
                if let dt = f.date(from: "\(d) 18:00") { date = dt }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy-MM-dd"
        let t = DateFormatter()
        t.timeZone = TimeZone(identifier: "Asia/Tokyo")
        t.dateFormat = "HH:mm"
        var input: [String: Any] = [
            "date": f.string(from: date),
            "time": t.string(from: date),
            "adults": adults,
            "children": children,
            "name": name,
            "kana": kana,
            "phone": phone,
            "note": note,
            "sourceCode": sourceCode,
            "courseId": courseId.isEmpty ? NSNull() : courseId,
            "tableIds": tableIds,
            "stayMinutes": stay ?? NSNull(),
            "status": pending ? "pending" : "confirmed",
            "clerkId": clerkId.isEmpty ? NSNull() : clerkId,
        ]
        if let pf = prefill { input["waitlistEntryId"] = pf.waitlistEntryId }
        if let _ = await model.act(["type": "ledgerCreate", "input": input]) {
            model.date = f.string(from: date)
            await model.refresh(silent: true)
            model.show(toast: prefill == nil ? "予約を登録しました" : "予約へ変換しました")
            onClose()
        } else {
            problem = model.error
        }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
            content()
        }
    }

    private func textField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(.system(size: 16)).foregroundColor(NLColor.ink)
            .padding(.horizontal, 12).frame(height: 46)
            .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.card))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NLColor.line, lineWidth: 1))
    }

    private func chip(_ text: String, on: Bool, color: Color, darkText: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
                .foregroundColor(on ? (darkText ? NLColor.navy : .white) : color)
                .frame(maxWidth: .infinity).frame(height: 42)
                .padding(.horizontal, 4)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? color : color.opacity(0.1)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(on ? 0 : 0.35), lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}
