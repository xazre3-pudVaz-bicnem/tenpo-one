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
    @State private var timed = false
    @State private var duration = 120
    @State private var warningEnabled = true
    @State private var warningMinutes = 30
    @State private var startNow = true
    @State private var startDate = Date()
    @State private var saving = false
    @State private var problem: String?

    private var payload: NFPayload? { model.payload }
    private var planItems: [NFPlanItem] { (payload?.planItems ?? []).filter { plans.contains($0.kind) } }
    private var guests: Int { male + female }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // モード
                    NFSection("モード / Mode") {
                        NFChipGrid(items: (payload?.plans ?? []).map { ($0.id, $0.name, NFColor.iris, false) }, selected: plans, columns: 5) { id in
                            togglePlan(id)
                        }
                    }
                    if !planItems.isEmpty {
                        NFSection("プラン / Plan") {
                            NFChipGrid(items: planItems.map { ($0.id, "\($0.name)  ¥\($0.price)", NFColor.iris, false) }, selected: planItemIds, columns: 3) { id in
                                if planItemIds.contains(id) { planItemIds.removeAll { $0 == id } } else { planItemIds.append(id) }
                                // コースを選んだらコースの時間を時間制の既定に
                                if let item = planItems.first(where: { $0.id == id }), item.kind == "course", let m = item.durationMinutes, m > 0, planItemIds.contains(id) {
                                    timed = true; duration = m
                                }
                            }
                        }
                    }
                    // 人数
                    NFSection("人数 / Guests　\(guests)名") {
                        HStack(spacing: 18) {
                            NFStepper(title: "男性 / Men", value: $male, max: 999)
                            NFStepper(title: "女性 / Women", value: $female, max: 999)
                        }
                    }
                    // 来店経路
                    NFSection("来店経路 / Booking source") {
                        let sources = (payload?.visitSources ?? []).map { s -> (String, String, Color, Bool) in
                            let v = NPVisitSource(id: s.id, label: s.label)
                            return (s.label, v.english, v.color, v.darkText)
                        }
                        NFChipGrid(items: sources, selected: [source], columns: 4) { label in source = (source == label) ? "" : label }
                    }
                    // 時間制
                    NFSection("時間制 / Time limit") {
                        HStack(spacing: 8) {
                            NFToggleChip("なし / None", on: !timed) { timed = false }
                            NFToggleChip("あり / Timed", on: timed) { timed = true }
                        }
                        if timed {
                            NFChipGrid(items: NF_DURATIONS.map { (String($0), nfDurationLabel($0), NFColor.iris, false) }, selected: [String(duration)], columns: 5) { v in duration = Int(v) ?? 120 }
                            HStack(spacing: 10) {
                                NFToggleChip(warningEnabled ? "終了前に声かけ ON" : "終了前に声かけ OFF", on: warningEnabled) { warningEnabled.toggle() }
                                if warningEnabled {
                                    NFChipGrid(items: [15, 30, 45, 60].map { (String($0), "\($0)分前", NFColor.iris, false) }, selected: [String(warningMinutes)], columns: 4) { v in warningMinutes = Int(v) ?? 30 }
                                }
                            }
                        }
                    }
                    // 開始時間
                    NFSection("開始時間 / Start") {
                        HStack(spacing: 10) {
                            NFToggleChip("今 / Now", on: startNow) { startNow = true }
                            NFToggleChip("時刻を選ぶ / Pick", on: !startNow) { startNow = false; startDate = Date() }
                            if !startNow {
                                DatePicker("", selection: $startDate, in: Date().addingTimeInterval(-12 * 3600)...Date(), displayedComponents: .hourAndMinute)
                                    .labelsHidden()
                                    .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                            }
                        }
                    }
                    if let p = problem {
                        Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
                    }
                }
                .padding(20)
            }
            .background(NFColor.lilacSoft)
            .navigationTitle("お客様情報 / Guest info　\(table.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "作成中…" : "注文へ / Start") { Task { await confirm() } }
                        .font(.system(size: 16, weight: .heavy))
                        .disabled(saving || guests < 1)
                }
            }
        }
        .presentationDetents([.large])
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
            "warningEnabled": warningEnabled,
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
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
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
                        .onChange(of: courseId) { _, id in
                            if let c = courses.first(where: { $0.id == id }), let m = c.durationMinutes, m > 0 { minutes = m }
                        }
                        Text("コースを選ぶと時間がコースの所要時間になります。コースの料金は今まで通り商品から伝票に入れてください。")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
                .padding(20)
            }
            .background(NFColor.lilacSoft)
            .navigationTitle("お客様情報 / Guest info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "保存する / Save") { Task { await save() } }
                        .font(.system(size: 16, weight: .heavy))
                        .disabled(saving)
                }
            }
        }
        .presentationDetents([.large])
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
                        .frame(maxWidth: .infinity, minHeight: 46)
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
