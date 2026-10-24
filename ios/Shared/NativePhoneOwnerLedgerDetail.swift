import SwiftUI

// iPhone の店長・オーナー：店舗台帳の予約の詳細と予約登録（2026-10-25 Ronnie「iPhone も native に」）。
// 中身・操作は iPad の店舗台帳の詳細（NativeReservationSheet）と同じ POST（ledgerStatus・ledgerTables・ledgerMove・ledgerCourse・
// ledgerSource・ledgerClerk・ledgerMemo・ledgerCancel・ledgerNoShow）。予約登録は ledgerCreate（Web の予約登録と同じ項目）。
// キャンセルの種類・理由の文は lib/reservation-cancel.ts と同じ（お客様キャンセル／店舗キャンセル＝担当を選ぶ／無断キャンセル）。
// iPad のファイルは変えない。iPhone の幅に合わせて、ハンディの予約の詳細（NPHRDetailSheet）と同じ形にした。

/// 値が無いときは JSON の null（経路・コース・担当を外すとき）
private func npoNullable(_ s: String?) -> Any {
    if let s { return s }
    return NSNull()
}

// MARK: - 予約の詳細

struct NPOLedgerDetail: View {
    @ObservedObject var model: NPOLedgerModel
    let reservation: NLReservation
    let onClose: () -> Void

    enum Edit { case time, tables, cancel, storeCancel }
    @State private var edit: Edit? = nil
    @State private var problem: String? = nil
    @State private var memo: String
    @State private var startDate: Date
    @State private var stay: Int
    @State private var entry: NRWEntry? = nil
    @State private var entryError: String? = nil
    @State private var picked: [String]
    @State private var now = Date()

    init(model: NPOLedgerModel, reservation: NLReservation, onClose: @escaping () -> Void) {
        self.model = model
        self.reservation = reservation
        self.onClose = onClose
        _memo = State(initialValue: reservation.memo ?? "")
        _picked = State(initialValue: reservation.tableIds)
        let s = NRWMath.iso(reservation.startAt) ?? Date()
        let e = NRWMath.iso(reservation.endAt) ?? s.addingTimeInterval(7200)
        _startDate = State(initialValue: s)
        _stay = State(initialValue: max(15, Int(e.timeIntervalSince(s) / 60)))
    }

    /// 最新（読み直し後）の予約
    private var r: NLReservation { model.payload?.reservations.first(where: { $0.id == reservation.id }) ?? reservation }
    private var p: NLPayload? { model.payload }
    private var canWrite: Bool { p?.canWrite ?? false }
    private var allowed: [String] { p?.transitions[r.status] ?? [] }
    private var startMin: Int { nlJstMinutes(r.startAt, dayStart: r.reservedDate) }
    private var endMin: Int { nlJstMinutes(r.endAt, dayStart: r.reservedDate) }
    private var stayNow: Int { max(15, endMin - startMin) }
    private var canConfirm: Bool { r.status == "pending" && allowed.contains("confirmed") }
    private var canArrive: Bool { allowed.contains("arrived") }
    private var canCancel: Bool { allowed.contains("cancelled") || allowed.contains("no_show") }

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                header
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            nameBlock
                            if canWrite && (canConfirm || canArrive) { primaryActions }
                            infoCard
                            if canWrite && edit == .time { timeEditor.id("edit") }
                            if canWrite && edit == .tables { tablesEditor.id("edit") }
                            memoCard
                            if canWrite && canCancel { cancelCard.id("cancel") }
                        }
                        .padding(16).padding(.bottom, 20)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: edit) { e in
                        guard let e else { return }
                        let target = e == .cancel || e == .storeCancel ? "cancel" : "edit"
                        withAnimation { proxy.scrollTo(target, anchor: .top) }
                    }
                }
                if let problem {
                    Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.vertical, 8).background(NT.dangerBg)
                }
                bottomBar
            }
            NPHToast(text: $model.toast)
        }
        .background(Color.white.ignoresSafeArea())
        .animation(.easeOut(duration: 0.18), value: model.toast)
    }

    // MARK: 上：状態・予約番号・閉じる

    private var header: some View {
        HStack(spacing: 8) {
            NPHRStatusBadge(status: r.status, label: model.label(r.status), size: 12)
            Text("予約番号 \(r.code)").font(.system(size: 11.5)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                    .frame(width: 36, height: 36).background(Circle().fill(NT.page))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("閉じる")
        }
        .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    // MARK: お名前・時間・人数

    private var nameBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(stripSama(r.guestName)) 様").font(.system(size: 21, weight: .heavy)).foregroundColor(NT.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let v = r.visitCount, v >= 2 {
                        Text("\(v)回目").font(.system(size: 11, weight: .heavy)).foregroundColor(NT.purpleDeep)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NT.lilac))
                    }
                    if r.isPrivateHire {
                        Text("貸切").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NT.topBar))
                    }
                }
                if let k = r.guestNameKana, !k.isEmpty { Text(k).font(.system(size: 12)).foregroundColor(NT.ink3) }
            }
            HStack(spacing: 8) {
                box(icon: "clock", title: NPHRDate.dayLabel(r.reservedDate), value: "\(nlHm(startMin))〜\(nlHm(endMin))", sub: nil, tint: NT.lilac, titleColor: NT.purpleDeep)
                box(icon: "person.2.fill", title: "人数", value: r.partyLabel, sub: guestsSub, tint: NT.page, titleColor: NT.ink2)
            }
        }
    }

    /// 「T1 + T2（希望：個室）」
    private var tableText: String {
        let tables = r.tableNames.isEmpty ? "席未定" : r.tableNames.joined(separator: " + ")
        guard let seat = r.seatType?.nilIfEmpty else { return tables }
        return tables + "（希望：" + seat + "）"
    }

    /// 「（大人 3・子ども 1）」
    private var guestsSub: String? {
        var parts: [String] = []
        if r.adults > 0 { parts.append("大人 \(r.adults)") }
        if r.children > 0 { parts.append("子ども \(r.children)") }
        return parts.isEmpty ? nil : "（\(parts.joined(separator: "・"))）"
    }

    private func box(icon: String, title: String, value: String, sub: String?, tint: Color, titleColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold))
                Text(title).font(.system(size: 11, weight: .heavy)).lineLimit(1)
            }
            .foregroundColor(titleColor)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                if let sub { Text(sub).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.7) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tint))
    }

    // MARK: 主な操作（状態に合わせて：予約確定・来店）

    private var primaryActions: some View {
        HStack(spacing: 8) {
            if canConfirm {
                actionButton("予約確定", en: "Confirm", fill: NT.purple, key: "confirmed") {
                    await run(["type": "ledgerStatus", "reservationId": r.id, "toStatus": "confirmed"], key: "confirmed", done: "予約を確定しました")
                }
            }
            if canArrive {
                actionButton("来店", en: "Arrived", fill: NT.ok, key: "arrived") {
                    await run(["type": "ledgerStatus", "reservationId": r.id, "toStatus": "arrived"], key: "arrived", done: "\(stripSama(r.guestName)) 様を来店にしました")
                }
            }
        }
    }

    private func actionButton(_ ja: String, en: String, fill: Color, key: String, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            VStack(spacing: 1) {
                HStack(spacing: 5) {
                    if model.busy == key { ProgressView().tint(.white).scaleEffect(0.8) }
                    Text(ja).font(.system(size: 16, weight: .heavy))
                }
                Text(en).font(.system(size: 10.5, weight: .bold)).opacity(0.8)
            }
            .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fill))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy != nil)
    }

    // MARK: 中身（変更できるところは右に「変更」・メニュー）

    private var infoCard: some View {
        VStack(spacing: 0) {
            infoRow("rectangle.split.3x3", "席", editing: NPOLedgerText.open.contains(r.status) ? .tables : nil) {
                Text(tableText)
            }
            infoRow("calendar", "日時", editing: NPOLedgerText.open.contains(r.status) ? .time : nil) {
                Text("\(NPHRDate.dayLabel(r.reservedDate)) \(nlHm(startMin))〜\(nlHm(endMin))・\(NRWMath.stayLabel(stayNow))").monospacedDigit()
            }
            pickerRow("fork.knife", "コース", current: r.courseId, fallback: r.courseName,
                      options: (p?.courses ?? []).map { (id: $0.id, name: $0.name) }, none: "なし（アラカルト）", enabled: canWrite) { id in
                Task { await run(["type": "ledgerCourse", "reservationId": r.id, "courseId": npoNullable(id)], key: "course", done: "コースを変更しました") }
            }
            pickerRow("tag", "経路", current: r.sourceId, fallback: NPOLedgerText.source(r),
                      options: (p?.sourceRows ?? []).map { (id: $0.id, name: $0.name) }, none: "未設定", enabled: canWrite && NPOLedgerText.canChangeSource(r)) { id in
                Task { await run(["type": "ledgerSource", "reservationId": r.id, "sourceId": npoNullable(id)], key: "source", done: "経路を変更しました") }
            }
            pickerRow("person.crop.circle", "担当", current: r.staffId, fallback: r.staffName,
                      options: (p?.staffOptions ?? []).map { (id: $0.id, name: $0.name) }, none: "担当なし", enabled: canWrite) { id in
                Task { await run(["type": "ledgerClerk", "reservationId": r.id, "clerkId": npoNullable(id)], key: "clerk", done: "担当を変更しました") }
            }
            if let tags = r.tags, !tags.isEmpty {
                infoRow("tag", "キーワード") { NPHRTagChips(tags: tags) }
            }
            infoRow("phone.fill", "電話") {
                if let url = NPHRDetailSheet.telURL(r.guestPhone) {
                    Link(destination: url) { Text(r.guestPhone).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purple).monospacedDigit() }
                } else {
                    Text(r.guestPhone.isEmpty ? "-" : r.guestPhone)
                }
            }
            if let email = r.guestEmail, !email.isEmpty, let url = URL(string: "mailto:\(email)") {
                infoRow("envelope", "メール") {
                    Link(destination: url) { Text(email).font(.system(size: 13.5)).foregroundColor(NT.purple).multilineTextAlignment(.leading) }
                }
            }
            if let allergy = r.allergyNote, !allergy.isEmpty {
                infoRow("exclamationmark.triangle.fill", "アレルギー", strong: true) { Text(allergy).fixedSize(horizontal: false, vertical: true) }
            }
            if let request = r.requestNote, !request.isEmpty {
                infoRow("text.bubble", "要望") { Text(request).fixedSize(horizontal: false, vertical: true) }
            }
            if let purpose = r.purpose, !purpose.isEmpty {
                infoRow("list.bullet", "利用目的") { Text(purpose) }
            }
            if let inAt = NPOLedgerText.hm(iso: r.arrivedAt) {
                infoRow("door.right.hand.open", "入店・退店") {
                    Text("\(inAt) 入店" + (NPOLedgerText.hm(iso: r.leftAt).map { "　\($0) 退店" } ?? "")).monospacedDigit()
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
        .overlay(alignment: .bottomTrailing) {
            if let at = r.createdAt, !at.isEmpty {
                Text("受付 \(NPHRDate.stamp(at))").font(.system(size: 10.5)).foregroundColor(NT.ink3).monospacedDigit()
                    .padding(.trailing, 4).offset(y: 18)
            }
        }
        .padding(.bottom, r.createdAt == nil ? 0 : 14)
    }

    private func infoRow<Content: View>(_ icon: String, _ label: String, strong: Bool = false, editing: Edit? = nil, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return HStack(alignment: .center, spacing: 10) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold)).frame(width: 14)
                Text(label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            }
            .foregroundColor(NT.ink3)
            .frame(width: 84, alignment: .leading)
            inner
                .font(.system(size: 14, weight: strong ? .heavy : .regular))
                .foregroundColor(strong ? NT.danger : NT.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let e = editing, canWrite {
                Button { toggle(e) } label: {
                    Text(edit == e ? "閉じる" : "変更").font(.system(size: 12.5, weight: .heavy)).foregroundColor(NT.purple)
                        .padding(.horizontal, 10).frame(height: 30)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy != nil)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(minHeight: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1) }
    }

    /// メニューで選ぶ行（コース・経路・担当。iPad の詳細と同じ「なし」も選べる）
    private func pickerRow(_ icon: String, _ label: String, current: String?, fallback: String?, options: [(id: String, name: String)],
                           none: String, enabled: Bool, onPick: @escaping (String?) -> Void) -> some View {
        let name = options.first(where: { $0.id == current })?.name ?? fallback ?? none
        return HStack(alignment: .center, spacing: 10) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold)).frame(width: 14)
                Text(label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            }
            .foregroundColor(NT.ink3)
            .frame(width: 84, alignment: .leading)
            if enabled {
                Menu {
                    Button(none) { onPick(nil) }
                    ForEach(options, id: \.id) { o in
                        Button(o.name) { onPick(o.id) }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Text(name).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.purple)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .disabled(model.busy != nil)
            } else {
                Text(name).font(.system(size: 14)).foregroundColor(NT.ink).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(minHeight: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1) }
    }

    private func toggle(_ e: Edit) {
        problem = nil
        if edit == e {
            edit = nil
            return
        }
        edit = e
        switch e {
        case .tables:
            picked = r.tableIds
            now = Date()
            if entry == nil { Task { await loadEntry() } }
        case .time:
            startDate = NRWMath.iso(r.startAt) ?? startDate
            stay = stayNow
        case .cancel, .storeCancel:
            break
        }
    }

    // MARK: 日時の変更（Web の予約の詳細の「日時を変更」と同じ。確保時間も）

    private var timeEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("日時を変更").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2)
            DatePicker("開始", selection: $startDate, displayedComponents: [.date, .hourAndMinute])
                .font(.system(size: 15, weight: .semibold))
                .environment(\.timeZone, NPHRDate.jst)
                .environment(\.locale, Locale(identifier: "ja_JP"))
            HStack(spacing: 8) {
                Text("確保時間").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
                Spacer()
                stepButton("minus", disabled: stay <= 15) { stay = max(15, stay - 15) }
                Text(NRWMath.stayLabel(stay)).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().frame(minWidth: 86)
                stepButton("plus", disabled: stay >= 720) { stay = min(720, stay + 15) }
            }
            HStack(spacing: 6) {
                ForEach([60, 90, 120, 150, 180], id: \.self) { m in
                    let on = stay == m
                    Button { stay = m } label: {
                        Text(NRWMath.stayLabel(m)).font(.system(size: 12, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundColor(on ? .white : NT.ink2)
                            .frame(maxWidth: .infinity).frame(height: 36)
                            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(on ? NT.purple : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(on ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            HStack(spacing: 8) {
                panelButton("やめる", color: NT.ink2) { edit = nil }
                fillButton("日時を保存", key: "move") {
                    let ok = await run(["type": "ledgerMove", "reservationId": r.id, "date": NPHRDate.string(startDate),
                                        "time": NPOLedgerText.hm(startDate), "stayMinutes": stay], key: "move", done: "日時を変更しました")
                    if ok { edit = nil }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
    }

    private func stepButton(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2)
                .frame(width: 40, height: 36)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    // MARK: テーブル変更（その時間に空いている卓・ピッタリ。この予約自身は数えない）

    private var tablesEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let e = entry {
                if e.tables.isEmpty {
                    Text("テーブルが登録されていません").font(.system(size: 13)).foregroundColor(NT.ink3)
                } else {
                    NPHRTablePicker(entry: e, date: r.reservedDate, time: nlHm(startMin), stay: stayNow, party: r.partySize,
                                    today: model.today, now: now, selected: picked, showLater: false) { ids, _ in picked = ids }
                }
                HStack(spacing: 8) {
                    panelButton("やめる", color: NT.ink2) {
                        edit = nil
                        picked = r.tableIds
                    }
                    fillButton(picked.isEmpty ? "席未定にする" : "このテーブルにする", key: "tables") {
                        let ok = await run(["type": "ledgerTables", "reservationId": r.id, "tableIds": picked], key: "tables", done: "テーブルを変更しました")
                        if ok { edit = nil }
                    }
                }
            } else if let err = entryError {
                Text(err).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                Button { Task { await loadEntry() } } label: {
                    Text("もう一度読む").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.purple)
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("空いているテーブルを確かめています…").font(.system(size: 13)).foregroundColor(NT.ink3)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
    }

    private func loadEntry() async {
        entryError = nil
        do {
            entry = try await model.entry(date: r.reservedDate, exclude: r.id)
        } catch {
            entryError = (error as? NativeAPIError)?.message ?? "テーブルを読めませんでした"
        }
    }

    // MARK: メモ（お店だけが見る。iPad の詳細と同じ ledgerMemo）

    private var memoCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: "note.text").font(.system(size: 11, weight: .bold))
                Text("メモ").font(.system(size: 12, weight: .heavy))
                Text("お店だけが見ます").font(.system(size: 10.5))
            }
            .foregroundColor(NT.ink3)
            TextField("メモ", text: Binding(get: { memo }, set: { memo = String($0.prefix(500)) }), axis: .vertical)
                .lineLimit(2...6)
                .font(.system(size: 15)).foregroundColor(NT.ink)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                .disabled(!canWrite)
            if canWrite && memo != (r.memo ?? "") {
                HStack(spacing: 8) {
                    panelButton("元に戻す", color: NT.ink2) { memo = r.memo ?? "" }
                    fillButton("メモを保存", key: "memo") {
                        await run(["type": "ledgerMemo", "reservationId": r.id, "memo": memo], key: "memo", done: "メモを保存しました")
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    // MARK: キャンセル（お客様キャンセル・店舗キャンセル＝担当を選ぶ・無断キャンセル。lib/reservation-cancel.ts と同じ文）

    @ViewBuilder private var cancelCard: some View {
        switch edit {
        case .some(.storeCancel):
            storeStaffPicker
        case .some(.cancel):
            cancelKinds
        default:
            Button { toggle(.cancel) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "xmark.circle")
                    Text(r.status == "completed" ? "この予約を取り消す（訂正）" : "予約をキャンセルする")
                }
                .font(.system(size: 14, weight: .heavy)).foregroundColor(NT.danger)
                .frame(maxWidth: .infinity).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.dangerBg))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.busy != nil)
        }
    }

    private var cancelKinds: some View {
        let kinds: [(key: String, label: String, hint: String)] = [
            ("guest", "お客様キャンセル", "連絡ありのキャンセル"),
            ("store", "店舗キャンセル", "担当を選んでください"),
            ("no_show", "無断キャンセル", "連絡なし・連絡が取れない"),
        ]
        return VStack(spacing: 8) {
            Text("キャンセルの種類を選んでください").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading)
            ForEach(kinds, id: \.key) { k in
                let ok = k.key == "no_show" ? allowed.contains("no_show") : allowed.contains("cancelled")
                Button {
                    if k.key == "store" {
                        edit = .storeCancel
                        return
                    }
                    Task {
                        if k.key == "no_show" {
                            await run(["type": "ledgerNoShow", "reservationId": r.id, "reason": "無断キャンセル（連絡なし）"],
                                      key: "cancel", done: "無断キャンセルにしました", close: true)
                        } else {
                            await run(["type": "ledgerCancel", "reservationId": r.id, "reason": "お客様キャンセル（連絡あり）"],
                                      key: "cancel", done: "お客様キャンセルにしました", close: true)
                        }
                    }
                } label: {
                    VStack(spacing: 1) {
                        Text(k.label).font(.system(size: 15, weight: .heavy))
                        Text(k.hint).font(.system(size: 10.5, weight: .semibold)).opacity(0.75)
                    }
                    .foregroundColor(k.key == "no_show" ? NT.danger : NT.ink)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Capsule().fill(k.key == "no_show" ? NT.dangerBg : Color.white))
                    .overlay(Capsule().stroke(k.key == "no_show" ? Color.clear : NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(!ok || model.busy != nil)
                .opacity(ok ? 1 : 0.4)
            }
            Button { edit = nil } label: {
                Text("やめる").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).frame(height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
    }

    /// 店舗キャンセル：担当（レジの担当名）を選ぶ（2026-10-20 Ronnie「担当選択必ず」）
    private var storeStaffPicker: some View {
        let staff = p?.staffOptions ?? []
        return VStack(spacing: 8) {
            Text("店舗キャンセル：担当を選んでください").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading)
            if staff.isEmpty {
                Text("担当がいません。レジの設定で担当を入れてください").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(staff) { s in
                        Button {
                            Task {
                                await run(["type": "ledgerCancel", "reservationId": r.id, "reason": "店舗キャンセル（担当: \(s.name)）"],
                                          key: "cancel", done: "店舗キャンセルにしました（担当: \(s.name)）", close: true)
                            }
                        } label: {
                            Text(s.name).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1).minimumScaleFactor(0.75)
                                .frame(maxWidth: .infinity).frame(height: 46)
                                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(model.busy != nil)
                    }
                }
            }
            Button { edit = .cancel } label: {
                Text("もどる").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).frame(height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
    }

    // MARK: 部品

    private func panelButton(_ title: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .heavy)).foregroundColor(color).lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy != nil)
    }

    private func fillButton(_ title: String, key: String, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            HStack(spacing: 5) {
                if model.busy == key { ProgressView().tint(.white).scaleEffect(0.8) }
                Text(title).font(.system(size: 14, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 46)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.purple))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy != nil)
        .layoutPriority(1)
    }

    /// 操作して、うまくいかなければ下に赤で出す。close なら閉じる
    @discardableResult
    private func run(_ body: [String: Any], key: String, done: String, close: Bool = false) async -> Bool {
        problem = nil
        if let e = await model.perform(body, key: key, done: done) {
            problem = e
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return false
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if close { onClose() }
        return true
    }

    // MARK: 下：電話する・閉じる

    private var bottomBar: some View {
        HStack(spacing: 8) {
            if let url = NPHRDetailSheet.telURL(r.guestPhone) {
                Link(destination: url) {
                    HStack(spacing: 5) { Image(systemName: "phone.fill"); Text("電話する") }
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
            Button(action: onClose) {
                Text("閉じる").font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.topBar))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

// MARK: - 予約登録（Web の予約登録と同じ項目の 2 ステップ。POST ledgerCreate）

struct NPOLedgerNewReservation: View {
    @ObservedObject var model: NPOLedgerModel
    let onClose: () -> Void
    /// 登録できた（その日の一覧へ）
    let onSaved: (String) -> Void

    enum CountField: String, Identifiable {
        case adults, children
        var id: String { rawValue }
    }

    @State private var step = 1
    @State private var date: String
    @State private var time = "18:00"
    @State private var adults = 2
    @State private var children = 0
    @State private var tableIds: [String] = []
    @State private var name = ""
    @State private var kana = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var sourceCode = ""
    @State private var courseId = ""
    @State private var tags: [String] = []
    @State private var stayCustom: Int? = nil
    @State private var status: NRWStatus = .confirmed
    @State private var clerkId = ""
    @State private var note = ""
    @State private var entry: NRWEntry? = nil
    @State private var loadError: String? = nil
    @State private var loading = false
    @State private var saving = false
    @State private var problem: String? = nil
    @State private var countField: CountField? = nil
    @State private var now = Date()

    init(model: NPOLedgerModel, date: String, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.model = model
        self.onClose = onClose
        self.onSaved = onSaved
        _date = State(initialValue: date)
    }

    private var today: String { model.today }
    private var party: Int { adults + children }
    private var defaultStay: Int {
        if !courseId.isEmpty, let d = entry?.courseDurations[courseId], d > 0 { return d }
        return entry?.defaultStay ?? 120
    }
    private var stay: Int { stayCustom ?? defaultStay }
    private var phoneDigits: Int { phone.filter { ("0"..."9").contains($0) }.count }
    private var step1Ready: Bool { NPHRDate.parse(date) != nil && time.count == 5 && party >= 1 }
    private var ready: Bool { step1Ready && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && phoneDigits >= 10 }
    private var pickedTables: [NRWTable] { (entry?.tables ?? []).filter { tableIds.contains($0.id) } }

    /// 予約経路（web・ウォークインは自動で付くので選ばない。予約台帳と同じ）
    private var sources: [NPHROption] {
        (model.payload?.sources ?? []).filter { $0.code != "web" && $0.code != "walk_in" }.map { NPHROption(value: $0.code, label: $0.name) }
    }
    private var courses: [NPHROption] { (model.payload?.courses ?? []).map { NPHROption(value: $0.id, label: $0.name) } }
    private var clerks: [NFNamed] {
        if let c = entry?.clerks, !c.isEmpty { return c }
        return model.payload?.staffOptions ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            NPHTopBar(title: "予約登録", subtitle: model.payload?.store.name ?? "", backLabel: "台帳", onBack: onClose) {
                Color.clear.frame(width: 40, height: 40)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if step == 1 { step1 } else { step2 }
                }
                .padding(14).padding(.bottom, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            footer
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .task(id: date) { await load() }
        .onAppear {
            if sourceCode.isEmpty { sourceCode = sources.contains(where: { $0.value == "phone" }) ? "phone" : (sources.first?.value ?? "phone") }
        }
        .sheet(item: $countField) { f in
            NPHRCountSheet(label: f == .adults ? "大人" : "子ども", initial: f == .adults ? adults : children, allowZero: f == .children) { n in
                if f == .adults { adults = n } else { children = n }
                countField = nil
            }
            .presentationDetents([.height(440)])
            .environment(\.colorScheme, .light)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let e = try await model.entry(date: date)
            entry = e
            now = Date()
            loadError = nil
        } catch {
            // 日を変えて読み直したとき（前の読み込みは止まる）は何も出さない
            if Task.isCancelled { return }
            loadError = (error as? NativeAPIError)?.message ?? "読み込めませんでした"
        }
    }

    // MARK: ① 日時・人数・テーブル

    private var step1: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("日時・人数を入れて、テーブルを選んでください").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
            if let e = loadError {
                Text(e).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.dangerBg))
            }
            card {
                HStack(alignment: .top, spacing: 10) {
                    field("来店日", required: true) {
                        DatePicker("来店日", selection: dateBinding, displayedComponents: .date)
                            .labelsHidden()
                            .datePickerStyle(.compact)
                            .environment(\.timeZone, NPHRDate.jst)
                            .environment(\.locale, Locale(identifier: "ja_JP"))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    field("時間", required: true) {
                        HStack(spacing: 4) {
                            menuPicker(hourBinding, options: (0..<24).map { String(format: "%02d", $0) }, suffix: "時")
                            menuPicker(minuteBinding, options: minuteOptions, suffix: "分")
                        }
                    }
                }
                HStack(spacing: 10) {
                    countControl("大人", value: adults, min: 0, field: .adults) { adults = $0 }
                    countControl("子ども", value: children, min: 0, field: .children) { children = $0 }
                }
            }
            card {
                if let e = entry, e.date == date, !e.tables.isEmpty {
                    NPHRTablePicker(entry: e, date: date, time: time, stay: stay, party: party, today: today, now: now, selected: tableIds) { ids, t in
                        tableIds = ids
                        time = t
                    }
                } else if loading || entry == nil || entry?.date != date {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("空いているテーブルを確かめています…").font(.system(size: 13)).foregroundColor(NT.ink3)
                    }
                } else {
                    Text("テーブルが登録されていません（テーブル未定で登録できます）").font(.system(size: 13)).foregroundColor(NT.ink3)
                }
            }
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { NPHRDate.parse(date) ?? Date() }, set: { d in
            let s = NPHRDate.string(d)
            if s != date {
                date = s
                tableIds = []
            }
        })
    }

    private var hourBinding: Binding<String> {
        Binding(get: { String(time.prefix(2)) }, set: { h in setTime("\(h):\(time.suffix(2))") })
    }

    private var minuteBinding: Binding<String> {
        Binding(get: { String(time.suffix(2)) }, set: { m in setTime("\(time.prefix(2)):\(m)") })
    }

    /// 分は 5 分ごと（いまの値が 5 分ごとでなければそれも入れる）
    private var minuteOptions: [String] {
        var list = stride(from: 0, to: 60, by: 5).map { String(format: "%02d", $0) }
        let cur = String(time.suffix(2))
        if !list.contains(cur) {
            list.append(cur)
            list.sort()
        }
        return list
    }

    private func setTime(_ t: String) {
        guard t != time else { return }
        time = t
        tableIds = []
    }

    private func menuPicker(_ selection: Binding<String>, options: [String], suffix: String) -> some View {
        Menu {
            Picker(suffix, selection: selection) {
                ForEach(options, id: \.self) { o in Text("\(o)\(suffix)").tag(o) }
            }
        } label: {
            HStack(spacing: 2) {
                Text("\(selection.wrappedValue)\(suffix)").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundColor(NT.purple)
            }
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    /// 人数（− 数字 ＋。数字を押すとテンキー）
    private func countControl(_ label: String, value: Int, min: Int, field f: CountField, set: @escaping (Int) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
            HStack(spacing: 5) {
                stepButton("minus", disabled: value <= min) { set(Swift.max(min, value - 1)) }
                Button { countField = f } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text("\(value)").font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                        Text("名").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                    .frame(maxWidth: .infinity).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.lilacLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(label)をテンキーで入れる（いま \(value)名）")
                stepButton("plus", disabled: value >= 999) { set(Swift.min(999, value + 1)) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func stepButton(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                .frame(width: 40, height: 44)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    // MARK: ② お名前・電話番号・メール・コース・キーワード・確保時間・ステータス・ご要望・経路・担当者

    private var step2: some View {
        VStack(alignment: .leading, spacing: 16) {
            card {
                field("お名前", required: true) { input("山田 太郎", text: $name) }
                field("フリガナ") { input("ヤマダ タロウ", text: $kana) }
                field("電話番号", required: true) {
                    VStack(alignment: .leading, spacing: 4) {
                        input("09012345678", text: $phone).keyboardType(.phonePad)
                        if !phone.isEmpty && phoneDigits < 10 {
                            Text("電話番号は10桁以上で入れてください").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.danger)
                        }
                    }
                }
                field("メール") {
                    input("taro@example.com", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                }
                if !courses.isEmpty {
                    field("コース") {
                        optionMenu(selection: $courseId, options: [NPHROption(value: "", label: "なし（席のみ）")] + courses)
                    }
                }
            }
            if let keywords = entry?.keywords, !keywords.isEmpty {
                card {
                    HStack(spacing: 4) {
                        Image(systemName: "tag").font(.system(size: 12, weight: .bold))
                        Text("キーワード").font(.system(size: 12, weight: .heavy))
                        Text("（複数選択可）").font(.system(size: 10.5))
                    }
                    .foregroundColor(NT.ink2)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                        ForEach(keywords, id: \.self) { k in
                            let on = tags.contains(k)
                            Button {
                                if on { tags.removeAll { $0 == k } } else { tags.append(k) }
                            } label: {
                                Text(k).font(.system(size: 12.5, weight: .heavy)).foregroundColor(on ? .white : NT.ink)
                                    .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
                                    .padding(.horizontal, 4).frame(maxWidth: .infinity).frame(minHeight: 44)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NT.purple : Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Color.clear : NT.line, lineWidth: 1))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            }
            card { stayControl }
            card { statusPicker }
            card {
                field("ご要望・メモ") {
                    VStack(alignment: .trailing, spacing: 3) {
                        ZStack(alignment: .topLeading) {
                            if note.isEmpty {
                                Text("アレルギー・記念日など").font(.system(size: 16)).foregroundColor(NT.ink3).padding(.horizontal, 14).padding(.vertical, 12)
                            }
                            TextEditor(text: Binding(get: { note }, set: { note = String($0.prefix(500)) }))
                                .font(.system(size: 16)).foregroundColor(NT.ink)
                                .scrollContentBackground(.hidden)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .frame(minHeight: 88)
                        }
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                        Text("残り \(500 - note.count) 文字").font(.system(size: 10.5)).foregroundColor(NT.ink3)
                    }
                }
                if !sources.isEmpty {
                    field("予約経路") { optionMenu(selection: $sourceCode, options: sources) }
                }
                if !clerks.isEmpty {
                    field("担当者") {
                        optionMenu(selection: $clerkId, options: [NPHROption(value: "", label: "選ばない")] + clerks.map { NPHROption(value: $0.id, label: $0.name) })
                    }
                }
            }
        }
    }

    /// 確保時間（−30・−5・＋5・＋30。15 分〜12 時間）
    private var stayControl: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 12, weight: .bold))
                    Text("確保時間").font(.system(size: 12, weight: .heavy))
                }
                .foregroundColor(NT.ink2)
                Spacer()
                if stay != defaultStay {
                    Button { stayCustom = nil } label: {
                        Text("元に戻す（\(NRWMath.stayLabel(defaultStay))）").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.purple)
                    }
                    .buttonStyle(.plain)
                }
            }
            Text(NRWMath.stayLabel(stay)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().frame(maxWidth: .infinity)
            HStack(spacing: 6) {
                ForEach([-30, -5, 5, 30], id: \.self) { d in
                    let disabled = (d < 0 && stay <= 15) || (d > 0 && stay >= 720)
                    Button {
                        let next = Swift.min(720, Swift.max(15, stay + d))
                        stayCustom = next == defaultStay ? nil : next
                    } label: {
                        Text(d > 0 ? "+\(d)分" : "\(d)分").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                            .frame(maxWidth: .infinity).frame(height: 42)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(disabled)
                    .opacity(disabled ? 0.4 : 1)
                }
            }
        }
    }

    /// 予約ステータス（来店待ち・仮予約・要連絡。Web の StatusPicker と同じ）
    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("予約ステータス").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
            HStack(spacing: 6) {
                ForEach(NRWStatus.allCases, id: \.self) { s in
                    let on = status == s
                    let tone = statusTone(s)
                    Button { status = s } label: {
                        VStack(spacing: 1) {
                            Text(s.label).font(.system(size: 14, weight: .heavy))
                            Text(s.hint).font(.system(size: 9.5, weight: .semibold)).opacity(0.8).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        .foregroundColor(on ? tone.fg : NT.ink3)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? tone.bg : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? tone.border : NT.line, lineWidth: on ? 2 : 1))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }

    private func statusTone(_ s: NRWStatus) -> (fg: Color, bg: Color, border: Color) {
        switch s {
        case .confirmed: return (NT.purpleDeep, NT.lilac, NT.purple)
        case .pending: return (NT.warn, Color(hex: 0xFBF1D9), NT.warn)
        case .needsContact: return (Color.white, NT.danger, NT.danger)
        }
    }

    private func optionMenu(selection: Binding<String>, options: [NPHROption]) -> some View {
        Menu {
            Picker("", selection: selection) {
                ForEach(options) { o in Text(o.label).tag(o.value) }
            }
        } label: {
            HStack {
                Text(options.first(where: { $0.value == selection.wrappedValue })?.label ?? options.first?.label ?? "").font(.system(size: 16, weight: .semibold))
                    .foregroundColor(NT.ink).lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NT.purple)
            }
            .padding(.horizontal, 14).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    private func input(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(.system(size: 16)).foregroundColor(NT.ink)
            .autocorrectionDisabled()
            .padding(.horizontal, 14).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func field<Content: View>(_ label: String, required: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label).font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink2)
                if required { Text("*").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.danger) }
            }
            inner
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 14) { inner }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    // MARK: 下：いま入れた内容と、次へ・登録

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                summary(step1Ready, "\(NPHRDate.dayLabel(date)) \(time)　\(party)名（\(NRWMath.stayLabel(stay))）")
                summary(!pickedTables.isEmpty, pickedTables.isEmpty ? "テーブル未定" : pickedTables.map(\.name).joined(separator: " + "))
                if step == 2 {
                    HStack(spacing: 10) {
                        let n = name.trimmingCharacters(in: .whitespaces)
                        summary(!n.isEmpty, n.isEmpty ? "お名前" : n)
                        summary(phoneDigits >= 10, phone.isEmpty ? "電話番号" : phone)
                    }
                }
            }
            if let problem {
                Text(problem).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
            }
            HStack(spacing: 8) {
                Button {
                    if step == 2 {
                        step = 1
                        problem = nil
                    } else {
                        onClose()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text(step == 2 ? "前に戻る" : "やめる")
                    }
                    .font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink2)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                Button {
                    if step == 1 {
                        if step1Ready { step = 2 }
                    } else {
                        Task { await submit() }
                    }
                } label: {
                    HStack(spacing: 6) {
                        if saving { ProgressView().tint(.white) }
                        Text(step == 1 ? "詳細を入力する" : "この内容で登録する").lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .font(.system(size: 15, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill((step == 1 ? step1Ready : ready && !saving) ? NT.purple : NT.ink3))
                }
                .buttonStyle(PressableStyle())
                .disabled(step == 1 ? !step1Ready : !ready || saving)
                .layoutPriority(1)
            }
        }
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 10)
        .background(Color.white.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    private func summary(_ on: Bool, _ text: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(on ? NT.purple : NT.line).frame(width: 8, height: 8)
            Text(text).font(.system(size: 13, weight: .heavy)).foregroundColor(on ? NT.ink : NT.ink3).monospacedDigit().lineLimit(1)
        }
    }

    private func submit() async {
        guard ready, !saving else { return }
        problem = nil
        if model.isSample {
            onSaved(date)
            return
        }
        saving = true
        defer { saving = false }
        var input: [String: Any] = [
            "date": date,
            "time": time,
            "adults": adults,
            "children": children,
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "kana": kana.trimmingCharacters(in: .whitespacesAndNewlines),
            "phone": phone.trimmingCharacters(in: .whitespacesAndNewlines),
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
            "sourceCode": sourceCode.isEmpty ? "phone" : sourceCode,
            "tableIds": tableIds,
            "stayMinutes": stay,
            "status": status.rawValue,
            "tags": tags,
        ]
        if !courseId.isEmpty { input["courseId"] = courseId }
        if !clerkId.isEmpty { input["clerkId"] = clerkId }
        let r = await NSPApi.postJSON(["type": "ledgerCreate", "input": input])
        if r.ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            model.toast = "予約を登録しました"
            onSaved(date)
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            problem = r.error ?? "予約を登録できませんでした"
        }
    }
}
