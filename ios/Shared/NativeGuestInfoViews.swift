import SwiftUI

// お客様情報（ネイティブ）。2026-10-24 Ronnie「レジは全部ネイティブに」
//   NativeSetupSheet     … 空席の卓に通すとき（モード・プラン・男女の人数・来店経路・時間制・開始時間）＝ Web の HandySetupScreen
//   NativeGuestInfoSheet … 着席中の卓の直し（開始・時間・人数・モード・プラン・コース）＝ Web の SeatTimeDialog

private let NF_PLAN_ORDER = ["normal", "drink", "buffet", "food", "course"]
private let NF_DURATIONS = [60, 90, 120, 150, 180]

/// 「HH:MM」（日本時間）
private func nfHm(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "ja_JP")
    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
    f.dateFormat = "HH:mm"
    return f.string(from: date)
}

private func nfDurationLabel(_ m: Int) -> String {
    let h = m / 60, r = m % 60
    if h == 0 { return "\(r)分" }
    return r == 0 ? "\(h)時間" : "\(h)時間\(r)分"
}

// MARK: - 来店登録（空席 → 注文）
// Web のハンディ・レジの「お客様情報」（components/handy/handy-setup-screen.tsx）と同じ並び：
//   テーブル／モード → タイマー設定（時間制・終了前注意・開始時間）→ 人数（男性・女性 1〜5・＋）→ 来店経路 → 確定
// 色はオーダー・会計の青と、来店経路の各社の色（2026-10-24 Ronnie「レイアウトは今の画面のまま、色を合わせて」）

struct NativeSetupSheet: View {
    @ObservedObject var model: NativeFloorModel
    let table: NFTable
    let onClose: () -> Void
    let onStarted: (String) -> Void

    @State private var plans: [String] = ["normal"]
    @State private var planItemIds: [String] = []
    @State private var male = 0
    @State private var female = 0
    @State private var source = ""
    // 時間制は最初から ON・2時間、終了前注意は ON・30分前（2026-10-24 Ronnie）
    @State private var timed = true
    @State private var duration = 120
    @State private var warningEnabled = true
    @State private var warningMinutes = 30
    @State private var startNow = true
    @State private var startDate = Date()
    @State private var saving = false
    @State private var problem: String?
    /// 小さなポップアップ（モード・プラン・時間制・終了前注意・開始時間）
    @State private var popup: NFSetupPopup?
    /// テンキー（人数の ＋・時間のカスタム）
    @State private var pad: NFPadTarget?

    private var payload: NFPayload? { model.payload }
    private var planItems: [NFPlanItem] { (payload?.planItems ?? []).filter { plans.contains($0.kind) } }
    private var guests: Int { male + female }
    private var planNames: String {
        let names = payload?.plans ?? []
        return plans.compactMap { id in names.first { $0.id == id }?.name }.joined(separator: "・")
    }
    private var pickedPlanNames: String {
        (payload?.planItems ?? []).filter { planItemIds.contains($0.id) }.map(\.name).joined(separator: "・")
    }
    private var canConfirm: Bool { guests >= 1 && !source.isEmpty && !saving }

    /// 横に広く・1画面に収まる（スクロールしない）2列（2026-10-24 Ronnie「USEN のようにコンパクトに、機能を多く。横は広げてよい」）
    ///   左：テーブル・モード・プラン／タイマー設定（時間制・終了前注意・開始時間）／人数　右：来店経路
    var body: some View {
        VStack(spacing: 0) {
            NFCardHeader(title: "お客様情報", en: "Guest info") {
                Button(action: onClose) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").font(.system(size: 16, weight: .bold))
                        VStack(alignment: .leading, spacing: 0) {
                            Text("テーブル一覧").font(.system(size: 15, weight: .bold))
                            Text("Tables").font(.system(size: 10)).opacity(0.75)
                        }
                    }
                    .foregroundColor(NFColor.iris)
                }
                .buttonStyle(.plain)
            } right: { EmptyView() }

            HStack(alignment: .top, spacing: 16) {
                AnyView(leftColumn).frame(maxWidth: .infinity)
                AnyView(rightColumn).frame(width: 380)
            }
            .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 8)

            // 下：キャンセル・確定（USEN と同じく横並び）
            VStack(spacing: 6) {
                Text(problem ?? (guests < 1 ? "合計人数を1〜999名で入力してください" : (source.isEmpty ? "来店経路を選択してください" : " ")))
                    .font(.system(size: 13)).foregroundColor(problem == nil ? NFColor.ink3 : NFColor.danger)
                    .lineLimit(1)
                HStack(spacing: 12) {
                    Button(action: onClose) {
                        Text("キャンセル").font(.system(size: 18, weight: .bold)).foregroundColor(NFColor.iris)
                            .frame(maxWidth: .infinity).frame(height: 56)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.iris.opacity(0.4), lineWidth: 1.2))
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                    Button { Task { await confirm() } } label: {
                        VStack(spacing: 0) {
                            Text(saving ? "作成中…" : "確定").font(.system(size: 20, weight: .heavy))
                            Text("Start order").font(.system(size: 11, weight: .bold)).opacity(0.8)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 56)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(canConfirm ? NFColor.iris : NFColor.iris.opacity(0.35)))
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                    .disabled(!canConfirm)
                }
            }
            .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 14)
            .background(NFColor.lilacSoft)
        }
        .overlay {
            if let pp = popup {
                ZStack {
                    Color.black.opacity(0.18).ignoresSafeArea().onTapGesture { popup = nil }
                    AnyView(popupCard(pp))
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: popup)
        .overlay {
            if let t = pad {
                NFNumberPad(title: t.title, unit: t.unit, initial: padInitial(t)) { v in
                    if let v {
                        switch t {
                        case .male: male = min(999, v)
                        case .female: female = min(999, v)
                        case .duration: duration = min(600, max(15, v))
                        case .warning: warningMinutes = min(180, max(5, v))
                        }
                    }
                    pad = nil
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: pad)
    }

    // MARK: 左の列

    private var leftColumn: some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("モード", en: "Mode")
            card {
                row("テーブル", en: "Table") { Text(table.name).font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.ink) }
                rowDivider
                row("モード", en: "Mode") {
                    valueText(planNames, on: true)
                    setButton { popup = .mode }
                }
                if plans.contains(where: { $0 != "normal" }) {
                    rowDivider
                    row("プラン", en: "Plan") {
                        valueText(pickedPlanNames.isEmpty ? "未設定" : pickedPlanNames, on: !pickedPlanNames.isEmpty)
                        setButton { popup = .plan }
                    }
                }
            }
            heading("タイマー設定", en: "Timer")
            card {
                row("時間制", en: "Time limit") {
                    Toggle("", isOn: $timed).labelsHidden().tint(NFColor.iris)
                    valueText(timed ? nfDurationLabel(duration) : "設定なし", on: timed)
                    setButton(enabled: timed) { popup = .duration }
                }
                rowDivider
                row("終了前注意", en: "Last call") {
                    Toggle("", isOn: $warningEnabled).labelsHidden().tint(NFColor.iris).disabled(!timed)
                    valueText(timed && warningEnabled ? "\(warningMinutes)分前" : "設定なし", on: timed && warningEnabled)
                    setButton(enabled: timed && warningEnabled) { popup = .warning }
                }
                rowDivider
                row("開始時間", en: "Start time") {
                    valueText("\(nfHm(startNow ? model.nowDate : startDate))〜", on: true)
                    setButton { popup = .start }
                }
            }
            HStack {
                heading("人数", en: "Guests", required: true)
                Spacer()
                Text("合計：\(guests)人").font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NFColor.ink2)
            }
            card {
                VStack(spacing: 8) {
                    countRow("男性", en: "Male", value: $male, target: .male)
                    countRow("女性", en: "Female", value: $female, target: .female)
                }
                .padding(12)
            }
        }
    }

    // MARK: 右の列（来店経路）

    private var rightColumn: some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("来店経路", en: "Source", required: true)
            card {
                let sources = (payload?.visitSources ?? []).map { s -> (String, String, Color, Bool) in
                    let v = NPVisitSource(id: s.id, label: s.label)
                    return (s.label, s.label, v.color, v.darkText)
                }
                NFChipGrid(items: sources, selected: [source], columns: 3, height: 46) { label in source = (source == label) ? "" : label }
                    .padding(12)
            }
        }
    }

    // MARK: ポップアップ（USEN の「設定」と同じく、押すと小さなカードで選ぶ。色・形はうちの）

    @ViewBuilder private func popupCard(_ pp: NFSetupPopup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(pp.title).font(.system(size: 18, weight: .bold)).foregroundColor(NFColor.ink)
                Spacer()
                Button { popup = nil } label: {
                    Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).font(.system(size: 26)).foregroundColor(.secondary)
                }.buttonStyle(.plain)
            }
            switch pp {
            case .mode:
                NFChipGrid(items: (payload?.plans ?? []).map { ($0.id, $0.name, NFColor.iris, false) }, selected: plans, columns: 3, height: 50) { id in togglePlan(id) }
                Text("何個でも選べます（例：アラカルト＋飲み放題）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            case .plan:
                if planItems.isEmpty {
                    Text("メニューにコース・飲み放題・食べ放題の商品がありません（設定 → メニュー で商品の種別を「コース」「飲み放題」「食べ放題」にすると、ここに出ます）。プラン無しで続けられます。")
                        .font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("\(planNames)のプラン（何個でも。選ぶと伝票に入ります）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    NFChipGrid(items: planItems.map { ($0.id, "\($0.name)  ¥\($0.price)", NFColor.iris, false) }, selected: planItemIds, columns: 2, height: 50) { id in
                        if planItemIds.contains(id) { planItemIds.removeAll { $0 == id } } else { planItemIds.append(id) }
                        if let item = planItems.first(where: { $0.id == id }), item.kind == "course", let m = item.durationMinutes, m > 0, planItemIds.contains(id) {
                            timed = true; duration = m
                        }
                    }
                    if !planItemIds.isEmpty {
                        Button("プランを全部外す") { planItemIds = [] }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
                    }
                }
            case .duration:
                Text(nfDurationLabel(duration)).font(.system(size: 28, weight: .heavy, design: .rounded)).monospacedDigit().foregroundColor(NFColor.iris)
                    .frame(maxWidth: .infinity)
                pickerLabel("時間 / Hours")
                HStack(spacing: 8) {
                    ForEach(0...3, id: \.self) { hh in timeChip("\(hh)時間", on: duration / 60 == hh) { duration = max(15, hh * 60 + duration % 60) } }
                }
                pickerLabel("分 / Minutes")
                HStack(spacing: 8) {
                    ForEach([0, 15, 30, 45], id: \.self) { mm in timeChip("\(mm)分", on: duration % 60 == mm) { duration = max(15, (duration / 60) * 60 + mm) } }
                }
                HStack(spacing: 8) {
                    timeChip("−30分", on: false) { duration = max(15, duration - 30) }
                    timeChip("＋30分", on: false) { duration = min(600, duration + 30) }
                    timeChip("カスタム", on: false) { pad = .duration }
                }
            case .warning:
                Text("\(warningMinutes)分前").font(.system(size: 28, weight: .heavy, design: .rounded)).monospacedDigit().foregroundColor(NFColor.iris)
                    .frame(maxWidth: .infinity)
                HStack(spacing: 8) {
                    ForEach([10, 15, 30], id: \.self) { mm in timeChip("\(mm)分前", on: warningMinutes == mm) { warningMinutes = mm } }
                }
                HStack(spacing: 8) {
                    ForEach([45, 60], id: \.self) { mm in timeChip("\(mm)分前", on: warningMinutes == mm) { warningMinutes = mm } }
                    timeChip("カスタム", on: false) { pad = .warning }
                }
            case .start:
                HStack(spacing: 8) {
                    timeChip("今 / Now", on: startNow) { startNow = true }
                    timeChip("時刻を選ぶ / Pick", on: !startNow) {
                        if startNow {
                            startNow = false
                            let c = nfJstCalendar
                            setStart(hour: c.component(.hour, from: Date()), minute: (c.component(.minute, from: Date()) / 5) * 5)
                        }
                    }
                }
                if !startNow {
                    let cal = nfJstCalendar
                    let h = cal.component(.hour, from: startDate)
                    let m = cal.component(.minute, from: startDate)
                    HStack(spacing: 0) {
                        Picker("時", selection: Binding(get: { h }, set: { setStart(hour: $0, minute: m) })) {
                            ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                        }
                        .pickerStyle(.wheel).frame(width: 110, height: 140).clipped()
                        Text(":").font(.system(size: 24, weight: .bold))
                        Picker("分", selection: Binding(get: { (m / 5) * 5 }, set: { setStart(hour: h, minute: $0) })) {
                            ForEach(Array(stride(from: 0, to: 60, by: 5)), id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                        }
                        .pickerStyle(.wheel).frame(width: 110, height: 140).clipped()
                    }
                    .frame(maxWidth: .infinity)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.7)))
                    HStack(spacing: 8) {
                        ForEach([0, 15, 30, 45], id: \.self) { mm in timeChip(String(format: ":%02d", mm), on: m == mm) { setStart(hour: h, minute: mm) } }
                    }
                }
            }
            Button { popup = nil } label: {
                Text("設定").font(.system(size: 18, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.iris))
            }
            .buttonStyle(PressableStyle(scale: 0.98))
        }
        .padding(18)
        .frame(width: 440)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 28, y: 12)
    }

    private func togglePlan(_ id: String) {
        if plans.contains(id) {
            if plans.count > 1 { plans.removeAll { $0 == id } }
        } else {
            plans.append(id)
        }
        planItemIds.removeAll { pid in !(planItems.contains { $0.id == pid }) }
    }

    private func confirm() async {
        guard guests >= 1 else { problem = "人数を入れてください"; return }
        guard !source.isEmpty else { problem = "来店経路を選択してください"; return }
        saving = true
        defer { saving = false }
        var draft: [String: Any] = [
            "plans": plans.sorted { (NF_PLAN_ORDER.firstIndex(of: $0) ?? 9) < (NF_PLAN_ORDER.firstIndex(of: $1) ?? 9) },
            "planItemIds": planItemIds,
            "male": male,
            "female": female,
            "source": source,
            "timed": timed,
            "duration": duration,
            "warningEnabled": timed && warningEnabled,
            "warningMinutes": warningMinutes,
        ]
        draft["startTime"] = startNow ? NSNull() : nfHm(startDate)
        if let r = await model.act(["type": "floorStart", "tableId": table.id, "draft": draft]), let id = r.orderId {
            if let e = r.planItemError, !e.isEmpty { model.show(toast: e) }
            onStarted(id)
        } else {
            problem = model.error
        }
    }

    // MARK: 部品

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private var rowDivider: some View { Rectangle().fill(NFColor.line).frame(height: 1).padding(.leading, 14) }

    private func heading(_ ja: String, en: String, required: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(ja).font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.ink)
            Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            if required { Text("＊").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger) }
        }
    }

    private func row<Right: View>(_ ja: String, en: String, @ViewBuilder right: () -> Right) -> some View {
        HStack(spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(ja).font(.system(size: 16)).foregroundColor(NFColor.ink2)
                Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
            .frame(width: 150, alignment: .leading)
            Spacer(minLength: 4)
            right()
        }
        .padding(.horizontal, 14)
        .frame(height: 50)
    }

    private func valueText(_ t: String, on: Bool) -> some View {
        Text(t).font(.system(size: 16, weight: on ? .bold : .regular)).monospacedDigit()
            .foregroundColor(on ? NFColor.iris : NFColor.ink3).lineLimit(1)
    }

    private func setButton(enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("設定").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .frame(width: 76, height: 38)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NFColor.iris))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }

    private func padInitial(_ t: NFPadTarget) -> Int {
        switch t {
        case .male: return male
        case .female: return female
        case .duration: return duration
        case .warning: return warningMinutes
        }
    }

    private func pickerLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
    }

    private func timeChip(_ t: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 16, weight: .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                .foregroundColor(on ? .white : NFColor.iris)
                .frame(maxWidth: .infinity).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NFColor.iris : Color.white.opacity(0.85)))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.iris.opacity(on ? 0 : 0.3), lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    /// 開始時間を「時・分」で決める。いまより先になるときは前の日（夜中をまたいだ来店）
    private func setStart(hour: Int, minute: Int) {
        let cal = nfJstCalendar
        var c = cal.dateComponents([.year, .month, .day], from: Date())
        c.hour = hour; c.minute = minute; c.second = 0
        var d = cal.date(from: c) ?? Date()
        if d > Date().addingTimeInterval(60) { d = cal.date(byAdding: .day, value: -1, to: d) ?? d }
        startDate = d
    }

    /// 1〜5 と ＋（＋はテンキー）。6 名以上は ＋ に数を出す
    private func countRow(_ ja: String, en: String, value: Binding<Int>, target: NFPadTarget) -> some View {
        HStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(ja).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2)
                Text(en).font(.system(size: 10)).foregroundColor(NFColor.ink3)
            }
            .frame(width: 84, alignment: .leading)
            ForEach(1...5, id: \.self) { n in
                let on = value.wrappedValue == n
                Button { value.wrappedValue = on ? 0 : n } label: {
                    Text("\(n)").font(.system(size: 22, weight: .bold))
                        .foregroundColor(on ? .white : NFColor.iris)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NFColor.iris : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.iris, lineWidth: 1.4))
                }
                .buttonStyle(PressableStyle())
            }
            let more = value.wrappedValue > 5
            Button { pad = target } label: {
                Text(more ? "\(value.wrappedValue)" : "＋").font(.system(size: 22, weight: .bold))
                    .foregroundColor(more ? .white : NFColor.iris)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(more ? NFColor.iris : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.iris, lineWidth: 1.4))
            }
            .buttonStyle(PressableStyle())
        }
    }
}

/// 来店登録の小さなポップアップ
enum NFSetupPopup: Equatable {
    case mode, plan, duration, warning, start
    var title: String {
        switch self {
        case .mode: return "モード"
        case .plan: return "プラン"
        case .duration: return "時間制"
        case .warning: return "終了前注意"
        case .start: return "開始時間"
        }
    }
}

// MARK: - 着席中の直し（席の時間・コース・人数・モード）

struct NativeGuestInfoSheet: View {
    @ObservedObject var model: NativeFloorModel
    let order: NFOrder
    let slip: NFSlip
    let onClose: () -> Void

    @State private var startDate: Date
    @State private var startChanged = false
    @State private var minutes: Int?
    @State private var courseId: String
    @State private var guests: Int
    @State private var plans: [String]
    @State private var planPick: [String] = []
    @State private var saving = false
    @State private var problem: String?

    init(model: NativeFloorModel, order: NFOrder, slip: NFSlip, onClose: @escaping () -> Void) {
        self.model = model
        self.order = order
        self.slip = slip
        self.onClose = onClose
        _startDate = State(initialValue: Date(timeIntervalSince1970: order.openedAtMs / 1000))
        let dur = Int(((order.endAtMs - order.openedAtMs) / 60_000).rounded())
        _minutes = State(initialValue: dur > 0 ? dur : nil)
        _courseId = State(initialValue: order.courseId ?? "")
        _guests = State(initialValue: slip.guestCount)
        _plans = State(initialValue: order.plansOrDefault)
    }

    private var payload: NFPayload? { model.payload }
    private var courses: [NFSeatCourse] { payload?.seatCourses ?? [] }
    private var planItems: [NFPlanItem] { (payload?.planItems ?? []).filter { $0.kind != "normal" && plans.contains($0.kind) } }
    private var orderMenuItemIds: [String] { slip.lines.compactMap { $0.menuItemId } }
    private var endLabel: String {
        guard let m = minutes else { return "—" }
        return nfHm(startDate.addingTimeInterval(Double(m) * 60))
    }

    var body: some View {
        VStack(spacing: 0) {
            NFCardHeader(title: "お客様情報", en: "Guest info") {
                Button(action: onClose) {
                    VStack(spacing: 0) {
                        Text("キャンセル").font(.system(size: 15, weight: .bold))
                        Text("Cancel").font(.system(size: 10)).opacity(0.75)
                    }
                    .foregroundColor(NFColor.ink2)
                }
                .buttonStyle(.plain)
            } right: {
                Button { Task { await save() } } label: {
                    VStack(spacing: 0) {
                        Text(saving ? "保存中…" : "保存する").font(.system(size: 16, weight: .heavy))
                        Text("Save").font(.system(size: 10, weight: .bold)).opacity(0.8)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 18).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
                }
                .buttonStyle(PressableStyle())
                .disabled(saving)
            }
            // AnyView で型を切る（中身を 2 回入れると View の型が深くなりすぎて実機で落ちる。2026-10-24）
            ViewThatFits(in: .vertical) {
                AnyView(main)
                ScrollView(showsIndicators: true) { AnyView(main) }
            }
        }
    }

    private var main: some View {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 24) {
                        NFSection("開始時間 / Start") {
                            DatePicker("", selection: Binding(get: { startDate }, set: { startDate = $0; startChanged = true }), in: Date().addingTimeInterval(-12 * 3600)...Date().addingTimeInterval(300), displayedComponents: .hourAndMinute)
                                .labelsHidden()
                                .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                        }
                        NFSection("終了予定 / End") {
                            Text(endLabel).font(.system(size: 26, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy)
                        }
                    }
                    NFSection("人数 / Guests") {
                        NFStepper(title: nil, value: $guests, min: 1, max: 999)
                    }
                    NFSection("モード / Mode") {
                        NFChipGrid(items: (payload?.plans ?? []).map { ($0.id, $0.name, NFColor.iris, false) }, selected: plans, columns: 5) { id in
                            if plans.contains(id) { if plans.count > 1 { plans.removeAll { $0 == id } } } else { plans.append(id) }
                            planPick.removeAll { pid in !(planItems.contains { $0.id == pid }) }
                        }
                        if !planItems.isEmpty {
                            Text("プラン / Plan（選ぶと伝票に入ります。注文確定で厨房へ）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            NFChipGrid(
                                items: planItems.map { ($0.id, orderMenuItemIds.contains($0.id) ? "\($0.name)（伝票にあり）" : "\($0.name)  ¥\($0.price)", NFColor.iris, false) },
                                selected: planPick + orderMenuItemIds,
                                columns: 3
                            ) { id in
                                guard !orderMenuItemIds.contains(id) else { return }
                                if planPick.contains(id) { planPick.removeAll { $0 == id } } else {
                                    planPick.append(id)
                                    // コースのプラン商品を選んだら、席のコース・時間もそれに合わせる
                                    if let c = courses.first(where: { $0.id == id }) { courseId = c.id; if let m = c.durationMinutes, m > 0 { minutes = m } }
                                }
                            }
                        }
                    }
                    NFSection("時間 / Duration") {
                        NFChipGrid(items: NF_DURATIONS.map { (String($0), nfDurationLabel($0), NFColor.iris, false) } + [("none", "制限なし", NFColor.iris, false)], selected: [minutes.map(String.init) ?? "none"], columns: 6) { v in
                            minutes = v == "none" ? nil : Int(v)
                        }
                    }
                    NFSection("コース / Course") {
                        Picker("コース", selection: $courseId) {
                            Text("なし（アラカルト） / None").tag("")
                            ForEach(courses) { c in
                                Text(c.name + (c.durationMinutes.map { "（\(nfDurationLabel($0))）" } ?? "")).tag(c.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(NFColor.navy)
                        .onChange(of: courseId) { id in
                            if let c = courses.first(where: { $0.id == id }), let m = c.durationMinutes, m > 0 { minutes = m }
                        }
                        Text("コースを選ぶと時間がコースの所要時間になります。コースの料金は今まで通り商品から伝票に入れてください。")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func save() async {
        if let m = minutes, !(15...480).contains(m) { problem = "時間は15分〜8時間で入れてください"; return }
        saving = true
        defer { saving = false }
        let initialPlans = order.plansOrDefault
        var input: [String: Any] = [
            "startTime": startChanged ? nfHm(startDate) : NSNull(),
            "durationMinutes": minutes ?? NSNull(),
            "courseId": courseId.isEmpty ? NSNull() : courseId,
            "guestCount": guests != slip.guestCount ? guests : NSNull(),
            "planItemIds": planPick,
        ]
        input["plans"] = plans == initialPlans ? NSNull() : plans
        if let _ = await model.act(["type": "floorSeatTime", "orderId": slip.id, "input": input]) {
            model.show(toast: planPick.isEmpty ? "お客様情報を変更しました" : "お客様情報を変更し、\(planPick.count)品を伝票に入れました")
            onClose()
        } else {
            problem = model.error
        }
    }
}

// MARK: - 部品

/// カードの上のバー（左＝戻る／真ん中＝題（日本語大・英語小）／右＝保存など）
struct NFCardHeader<Left: View, Right: View>: View {
    let title: String
    let en: String
    @ViewBuilder let left: () -> Left
    @ViewBuilder let right: () -> Right

    init(title: String, en: String, @ViewBuilder left: @escaping () -> Left, @ViewBuilder right: @escaping () -> Right) {
        self.title = title; self.en = en; self.left = left; self.right = right
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                Text(title).font(.system(size: 18, weight: .heavy)).foregroundColor(NFColor.ink)
                Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
            HStack {
                left()
                Spacer(minLength: 8)
                right()
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 58)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }
}

struct NFSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
            content()
        }
    }
}

/// チップの格子（id, 表示, 色, 選択中は文字を黒に）
struct NFChipGrid: View {
    let items: [(String, String, Color, Bool)]
    let selected: [String]
    var columns: Int = 4
    var height: CGFloat = 46
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                let on = selected.contains(it.0)
                Button { onTap(it.0) } label: {
                    Text(it.1)
                        .font(.system(size: 14, weight: .bold))
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .foregroundColor(on ? (it.3 ? NFColor.ink : .white) : it.2)
                        .frame(maxWidth: .infinity, minHeight: height)
                        .padding(.horizontal, 6)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? it.2 : it.2.opacity(0.1)))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(it.2.opacity(on ? 0 : 0.35), lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

struct NFToggleChip: View {
    let text: String
    let on: Bool
    let action: () -> Void
    init(_ text: String, on: Bool, action: @escaping () -> Void) {
        self.text = text; self.on = on; self.action = action
    }
    var body: some View {
        Button(action: action) {
            Text(text).font(.system(size: 14, weight: .bold))
                .foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 16).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NFColor.iris : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

struct NFStepper: View {
    let title: String?
    @Binding var value: Int
    var min: Int = 0
    var max: Int = 999

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title { Text(title).font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink3) }
            HStack(spacing: 8) {
                step("−", enabled: value > min) { value = Swift.max(min, value - 1) }
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(value)").font(.system(size: 26, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy)
                    Text("名").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                }
                .frame(width: 96, height: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                step("＋", enabled: value < max) { value = Swift.min(max, value + 1) }
            }
        }
    }

    private func step(_ t: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 22, weight: .bold)).foregroundColor(NFColor.royal)
                .frame(width: 48, height: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.irisSoft))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }
}

/// 日本時間のカレンダー（開始時間の「時・分」選び）
let nfJstCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    return c
}()


/// テンキーで入れるもの
enum NFPadTarget: Equatable {
    case male, female, duration, warning
    var title: String {
        switch self {
        case .male: return "男性の人数"
        case .female: return "女性の人数"
        case .duration: return "時間制（分）"
        case .warning: return "終了前注意（何分前）"
        }
    }
    var unit: String { self == .male || self == .female ? "名" : "分" }
}

/// 数を入れるテンキーのカード（C・7〜0・00・←・OK）。外を押すと閉じる
struct NFNumberPad: View {
    let title: String
    let unit: String
    let initial: Int
    let onDone: (Int?) -> Void
    @State private var text = ""

    var body: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea().onTapGesture { onDone(nil) }
            VStack(spacing: 12) {
                HStack {
                    Text(title).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink)
                    Spacer()
                    Button { onDone(nil) } label: {
                        Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).font(.system(size: 26)).foregroundColor(.secondary)
                    }.buttonStyle(.plain)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Spacer()
                    Text(text.isEmpty ? "0" : text).font(.system(size: 40, weight: .heavy, design: .rounded)).monospacedDigit().foregroundColor(NFColor.navy)
                    Text(unit).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink3)
                }
                .padding(.horizontal, 16).frame(height: 70)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.lilacSoft))
                key("C", fg: NFColor.danger, wide: true) { text = "" }
                ForEach([["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"]], id: \.self) { row in
                    HStack(spacing: 10) { ForEach(row, id: \.self) { k in key(k) { add(k) } } }
                }
                HStack(spacing: 10) { key("0") { add("0") }; key("00") { add("00") } }
                HStack(spacing: 10) {
                    key("←", fg: NFColor.ink2) { text = String(text.dropLast()) }
                    Button { onDone(Int(text) ?? 0) } label: {
                        Text("OK").font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 58)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.iris))
                    }.buttonStyle(PressableStyle())
                }
            }
            .padding(18).frame(width: 340)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: .black.opacity(0.18), radius: 28, y: 12)
        }
        .onAppear { text = initial > 0 ? String(initial) : "" }
    }

    private func add(_ k: String) {
        var t = text + k
        while t.count > 1 && t.hasPrefix("0") { t.removeFirst() }
        if t.count <= 3 { text = t }
    }

    private func key(_ t: String, fg: Color = NFColor.ink, wide: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundColor(fg)
                .frame(maxWidth: .infinity).frame(height: wide ? 50 : 58)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.85)))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.black.opacity(0.06), lineWidth: 0.8))
        }
        .buttonStyle(PressableStyle())
    }
}
