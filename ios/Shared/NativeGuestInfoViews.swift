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
    @State private var modeOpen = false
    @State private var male = 0
    @State private var female = 0
    @State private var source = ""
    @State private var timed = false
    @State private var duration = 120
    @State private var durationOpen = false
    @State private var warningEnabled = false
    @State private var warningMinutes = 30
    @State private var warningOpen = false
    @State private var startNow = true
    @State private var startDate = Date()
    @State private var startOpen = false
    @State private var saving = false
    @State private var problem: String?

    private var payload: NFPayload? { model.payload }
    private var planItems: [NFPlanItem] { (payload?.planItems ?? []).filter { plans.contains($0.kind) } }
    private var guests: Int { male + female }
    private var planNames: String {
        let names = payload?.plans ?? []
        return plans.compactMap { id in names.first { $0.id == id }?.name }.joined(separator: "・")
    }
    private var canConfirm: Bool { guests >= 1 && !source.isEmpty && !saving }

    /// カード＝上のバー（テーブル一覧へ戻る・お客様情報）／中身（入るならそのまま、入らなければスクロール）／下に固定の確定（Web と同じ）
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

            ViewThatFits(in: .vertical) {
                main
                ScrollView(showsIndicators: true) { main }
            }

            // 下に固定（Web の HandyFooterButton と同じ）
            VStack(spacing: 8) {
                Text(problem ?? (guests < 1 ? "合計人数を1〜999名で入力してください" : (source.isEmpty ? "来店経路を選択してください" : " ")))
                    .font(.system(size: 13)).foregroundColor(problem == nil ? NFColor.ink3 : NFColor.danger)
                    .lineLimit(2)
                Button { Task { await confirm() } } label: {
                    VStack(spacing: 0) {
                        Text(saving ? "作成中…" : "確定").font(.system(size: 21, weight: .heavy))
                        Text("Start order").font(.system(size: 11, weight: .bold)).opacity(0.8)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 62)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(canConfirm ? NFColor.iris : NFColor.iris.opacity(0.35)))
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .disabled(!canConfirm)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
            .background(NFColor.lilacSoft)
        }
    }

    private var main: some View {
                VStack(alignment: .leading, spacing: 10) {
                    // テーブル・モード
                    card {
                        row("テーブル", en: "Table") { Text(table.name).font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.ink) }
                        rowDivider
                        Button { withAnimation(.easeOut(duration: 0.15)) { modeOpen.toggle() } } label: {
                            row("モード", en: "Mode") {
                                HStack(spacing: 6) {
                                    Text(planNames).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.iris)
                                    Image(systemName: modeOpen ? "chevron.down" : "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink3)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        if modeOpen {
                            VStack(alignment: .leading, spacing: 10) {
                                NFChipGrid(items: (payload?.plans ?? []).map { ($0.id, $0.name, NFColor.iris, false) }, selected: plans, columns: 5) { id in togglePlan(id) }
                                if !planItems.isEmpty {
                                    Text("プラン / Plan（選ぶと伝票に入ります）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                    NFChipGrid(items: planItems.map { ($0.id, "\($0.name)  ¥\($0.price)", NFColor.iris, false) }, selected: planItemIds, columns: 3) { id in
                                        if planItemIds.contains(id) { planItemIds.removeAll { $0 == id } } else { planItemIds.append(id) }
                                        if let item = planItems.first(where: { $0.id == id }), item.kind == "course", let m = item.durationMinutes, m > 0, planItemIds.contains(id) {
                                            timed = true; duration = m
                                        }
                                    }
                                } else if plans.contains(where: { $0 != "normal" }) {
                                    // プラン商品が無い店（2026-10-24 Ronnie「モードは出たがプランが出ない」→ 理由を出す）
                                    Text("この店にはプラン商品（飲み放題・食べ放題・コースの商品）がまだありません。設定 > メニュー で商品の種別を「飲み放題」「食べ放題」「コース」にすると、ここに出ます。")
                                        .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                }
                            }
                            .padding(.horizontal, 16).padding(.bottom, 14)
                        }
                    }

                    // タイマー設定
                    heading("タイマー設定", en: "Timer")
                    card {
                        row("時間制", en: "Time limit") {
                            HStack(spacing: 10) {
                                Toggle("", isOn: $timed).labelsHidden().tint(NFColor.iris)
                                Button { if timed { withAnimation(.easeOut(duration: 0.15)) { durationOpen.toggle() } } } label: {
                                    HStack(spacing: 6) {
                                        Text(timed ? nfDurationLabel(duration) : "設定なし").font(.system(size: 17, weight: timed ? .bold : .regular)).foregroundColor(timed ? NFColor.iris : NFColor.ink3)
                                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink3)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        if timed && durationOpen {
                            NFChipGrid(items: NF_DURATIONS.map { (String($0), nfDurationLabel($0), NFColor.iris, false) }, selected: [String(duration)], columns: 5) { v in duration = Int(v) ?? 120 }
                                .padding(.horizontal, 16).padding(.bottom, 14)
                        }
                        rowDivider
                        row("終了前注意", en: "Last call") {
                            HStack(spacing: 10) {
                                Toggle("", isOn: $warningEnabled).labelsHidden().tint(NFColor.iris).disabled(!timed)
                                Button { if warningEnabled { withAnimation(.easeOut(duration: 0.15)) { warningOpen.toggle() } } } label: {
                                    HStack(spacing: 6) {
                                        Text(timed && warningEnabled ? "\(warningMinutes)分前" : "設定なし").font(.system(size: 17, weight: warningEnabled ? .bold : .regular)).foregroundColor(timed && warningEnabled ? NFColor.iris : NFColor.ink3)
                                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink3)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        if timed && warningEnabled && warningOpen {
                            NFChipGrid(items: [15, 30, 45, 60].map { (String($0), "\($0)分前", NFColor.iris, false) }, selected: [String(warningMinutes)], columns: 4) { v in warningMinutes = Int(v) ?? 30 }
                                .padding(.horizontal, 16).padding(.bottom, 14)
                        }
                        rowDivider
                        Button { withAnimation(.easeOut(duration: 0.15)) { startOpen.toggle() } } label: {
                            row("開始時間", en: "Start time") {
                                HStack(spacing: 6) {
                                    Text("\(nfHm(startNow ? model.nowDate : startDate))〜").font(.system(size: 17, weight: .bold)).monospacedDigit().foregroundColor(NFColor.iris)
                                    Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink3)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        if startOpen {
                            HStack(spacing: 10) {
                                NFToggleChip("今 / Now", on: startNow) { startNow = true }
                                NFToggleChip("時刻を選ぶ / Pick", on: !startNow) { startNow = false; startDate = Date() }
                                if !startNow {
                                    DatePicker("", selection: $startDate, in: Date().addingTimeInterval(-12 * 3600)...Date(), displayedComponents: .hourAndMinute)
                                        .labelsHidden()
                                        .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 16).padding(.bottom, 14)
                        }
                    }

                    // 人数
                    HStack {
                        heading("人数", en: "Guests", required: true)
                        Spacer()
                        Text("合計：\(guests)人").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                    }
                    card {
                        VStack(alignment: .leading, spacing: 10) {
                            countRow("男性", en: "Male", value: $male)
                            countRow("女性", en: "Female", value: $female)
                        }
                        .padding(14)
                    }

                    // 来店経路
                    heading("来店経路", en: "Source", required: true)
                    card {
                        let sources = (payload?.visitSources ?? []).map { s -> (String, String, Color, Bool) in
                            let v = NPVisitSource(id: s.id, label: s.label)
                            return (s.label, s.label, v.color, v.darkText)
                        }
                        NFChipGrid(items: sources, selected: [source], columns: 6, height: 42) { label in source = (source == label) ? "" : label }
                            .padding(14)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
                .frame(maxWidth: .infinity)
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

    // MARK: 部品（Web のハンディの画面と同じ形）

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private var rowDivider: some View { Rectangle().fill(NFColor.line).frame(height: 1) }

    private func heading(_ ja: String, en: String, required: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(ja).font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.ink)
            Text(en).font(.system(size: 12)).foregroundColor(NFColor.ink3)
            if required { Text("＊").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger) }
        }
    }

    private func row<Right: View>(_ ja: String, en: String, @ViewBuilder right: () -> Right) -> some View {
        HStack {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(ja).font(.system(size: 17)).foregroundColor(NFColor.ink2)
                Text(en).font(.system(size: 13)).foregroundColor(NFColor.ink3)
            }
            Spacer()
            right()
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
    }

    /// 1〜5 のボタンと ＋（Web と同じ）。5 より多いときは ＋ に数を出す
    private func countRow(_ ja: String, en: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(ja).font(.system(size: 15)).foregroundColor(NFColor.ink2)
                Text(en).font(.system(size: 12)).foregroundColor(NFColor.ink3)
            }
            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { n in
                    let on = value.wrappedValue == n
                    Button { value.wrappedValue = on ? 0 : n } label: {
                        Text("\(n)").font(.system(size: 24, weight: .bold))
                            .foregroundColor(on ? .white : NFColor.iris)
                            .frame(maxWidth: .infinity).frame(height: 50)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NFColor.iris : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.iris, lineWidth: 1.5))
                    }
                    .buttonStyle(PressableStyle())
                }
                let more = value.wrappedValue > 5
                Button { value.wrappedValue = min(999, value.wrappedValue + 1) } label: {
                    Text(more ? "\(value.wrappedValue)" : "＋").font(.system(size: 24, weight: .bold))
                        .foregroundColor(more ? .white : NFColor.iris)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(more ? NFColor.iris : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.iris, lineWidth: 1.5))
                }
                .buttonStyle(PressableStyle())
            }
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
            ViewThatFits(in: .vertical) {
                main
                ScrollView(showsIndicators: true) { main }
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
