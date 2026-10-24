import SwiftUI

// iPhone ハンディの「お客様情報」（空席の卓の来店登録 → 伝票を作る → そのまま注文へ）。2026-10-25 Ronnie「iPhone も native に」
// 中身は Web の /handy/[tableId]/setup と同じ（GET part=handySetup、POST handyStartVisit → startHandyVisit）。
// 来店経路は iPad と同じく選ばなくてよい（会計で選ぶ）。

struct NPHPlanItem: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let price: Double
    let durationMinutes: Int?
    /// drink / buffet / food / course
    let kind: String
}

struct NPHPlanMode: Codable, Identifiable, Hashable { let id: String; let name: String }

struct NPHSetupPayload: Codable {
    let ok: Bool
    let hostTableId: String?
    let table: NPHTableInfo?
    let clerk: NHDNamed?
    let planItems: [NPHPlanItem]?
    let plans: [NPHPlanMode]?
    let sources: [String]?
}

@MainActor
final class NativePhoneSetupModel: ObservableObject {
    let tableId: String
    @Published var payload: NPHSetupPayload?
    @Published var error: String?
    @Published var busy = false
    @Published var redirectTableId: String?

    @Published var male = 0
    @Published var female = 0
    @Published var plans: Set<String> = ["normal"]
    @Published var planItemIds: [String] = []
    @Published var timed = false
    @Published var duration = 120
    @Published var source = ""

    init(tableId: String) {
        self.tableId = tableId
        payload = NativeAPI.cached(NPHSetupPayload.self, NPHApi.url(part: "handySetup", ["tableId": tableId]))
    }

    func load() async {
        // 見本（シミュレーターで形を確かめる・App Store の写真）では読みに行かない
        if NativePreview.current != nil { return }
        do {
            let p = try await NPHApi.get(NPHSetupPayload.self, part: "handySetup", ["tableId": tableId])
            if let host = p.hostTableId { redirectTableId = host; return }
            payload = p
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    var guests: Int { male + female }

    /// 選んだモードに合うプラン商品（アラカルトだけのときは出さない）
    var shownPlanItems: [NPHPlanItem] {
        (payload?.planItems ?? []).filter { plans.contains($0.kind) }
    }

    func toggleMode(_ id: String) {
        if id == "normal" {
            plans = ["normal"]
        } else {
            if plans.contains(id) { plans.remove(id) } else { plans.insert(id) }
            if plans.isEmpty { plans = ["normal"] }
        }
        // 外したモードのプラン商品は外す
        let kinds = plans
        planItemIds = planItemIds.filter { id in payload?.planItems?.first { $0.id == id }.map { kinds.contains($0.kind) } ?? false }
    }

    func togglePlanItem(_ item: NPHPlanItem) {
        if let i = planItemIds.firstIndex(of: item.id) { planItemIds.remove(at: i); return }
        planItemIds.append(item.id)
        // コース・放題の時間があれば時間制に（Web と同じ）
        if let d = item.durationMinutes, d > 0 { timed = true; duration = min(480, max(15, d)) }
    }

    var problem: String? {
        if guests < 1 { return "人数を入れてください" }
        return nil
    }

    /// 伝票を作る。できたら伝票 id
    func start() async -> String? {
        guard !busy, problem == nil else { return nil }
        busy = true
        defer { busy = false }
        let order = ["normal", "drink", "buffet", "food", "course"].filter { plans.contains($0) }
        let draft: [String: Any] = [
            "plans": order, "planItemIds": planItemIds, "male": male, "female": female, "source": source,
            "timed": timed, "duration": duration, "warningEnabled": true, "warningMinutes": min(30, max(0, duration - 15)), "startTime": NSNull(),
        ]
        let r = await NSPApi.postJSON(["type": "handyStartVisit", "tableId": tableId, "draft": draft])
        guard r.ok, let id = r.json?["orderId"] as? String else { error = r.error ?? "開始できませんでした"; return nil }
        if let warn = r.json?["planItemError"] as? String, !warn.isEmpty { error = warn }
        return id
    }
}

struct NativePhoneSetupView: View {
    @ObservedObject var model: NativePhoneSetupModel
    let onBack: () -> Void
    let onStarted: (String) -> Void
    /// もう伝票がある卓・まとめた卓のほかの卓で始まっているとき
    var onRedirect: (String) -> Void = { _ in }

    var body: some View {
        ZStack(alignment: .bottom) {
            NT.page.ignoresSafeArea()
            VStack(spacing: 0) {
                NPHTopBar(title: "お客様情報", subtitle: model.payload?.table.map { "\($0.name)\(model.payload?.clerk.map { "・担当 \($0.name)" } ?? "")" } ?? "",
                          backLabel: "戻る", onBack: onBack) { Color.clear.frame(width: 40, height: 40) }
                if let p = model.payload {
                    ScrollView {
                        VStack(spacing: 12) {
                            guestsCard
                            modeCard(p)
                            if !model.shownPlanItems.isEmpty { planCard }
                            timeCard
                            if let s = p.sources, !s.isEmpty { sourceCard(s) }
                        }
                        .padding(14).padding(.bottom, 110)
                    }
                } else if let e = model.error {
                    Spacer(); Text(e).font(.system(size: 14)).foregroundColor(NT.ink3).multilineTextAlignment(.center).padding(); Spacer()
                } else {
                    Spacer(); ProgressView().tint(NT.purple); Spacer()
                }
            }
            if model.payload != nil { startBar }
            NPHToast(text: Binding(get: { model.payload == nil ? nil : model.error }, set: { model.error = $0 }))
        }
        .environment(\.colorScheme, .light)
        .task { await model.load() }
        .onChange(of: model.redirectTableId) { id in if let id { onRedirect(id) } }
    }

    private func card<C: View>(_ title: String, note: String = "", @ViewBuilder _ content: () -> C) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                if !note.isEmpty { Text(note).font(.system(size: 12)).foregroundColor(NT.ink3) }
                Spacer()
            }
            inner
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private var guestsCard: some View {
        card("人数", note: "合計 \(model.guests)名") {
            HStack(spacing: 10) {
                stepper("男性", value: $model.male)
                stepper("女性", value: $model.female)
            }
            // よく使う人数（全部 男性に入れる。内訳はあとで直せる）
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(1...8, id: \.self) { n in
                        chip("\(n)名", on: model.guests == n && model.female == 0) { model.male = n; model.female = 0 }
                    }
                }
            }
        }
    }

    private func stepper(_ label: String, value: Binding<Int>) -> some View {
        VStack(spacing: 6) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            HStack(spacing: 0) {
                Button { if value.wrappedValue > 0 { value.wrappedValue -= 1 } } label: {
                    Image(systemName: "minus").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink).frame(width: 44, height: 44)
                }
                Text("\(value.wrappedValue)").font(.system(size: 24, weight: .heavy)).foregroundColor(NT.ink).frame(minWidth: 44).monospacedDigit()
                Button { if value.wrappedValue < 99 { value.wrappedValue += 1 } } label: {
                    Image(systemName: "plus").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink).frame(width: 44, height: 44)
                }
            }
            .background(Capsule().fill(NT.page))
            .buttonStyle(PressableStyle())
        }
        .frame(maxWidth: .infinity)
    }

    private func modeCard(_ p: NPHSetupPayload) -> some View {
        card("モード", note: "いくつでも") {
            WrapLayout(spacing: 8) {
                ForEach(p.plans ?? []) { m in chip(m.name, on: model.plans.contains(m.id)) { model.toggleMode(m.id) } }
            }
        }
    }

    private var planCard: some View {
        card("プラン", note: "選ぶと伝票に入ります") {
            VStack(spacing: 8) {
                ForEach(model.shownPlanItems) { item in
                    let on = model.planItemIds.contains(item.id)
                    Button { model.togglePlanItem(item) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.system(size: 20, weight: .semibold)).foregroundColor(on ? NT.purple : NT.ink3)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
                                if let d = item.durationMinutes { Text("\(d)分").font(.system(size: 12)).foregroundColor(NT.ink3) }
                            }
                            Spacer()
                            Text(NT.yen(Int(item.price))).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                        }
                        .padding(.horizontal, 12).frame(minHeight: 52)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NT.lilac : NT.page))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
    }

    private var timeCard: some View {
        card("時間制") {
            HStack {
                Text(model.timed ? "あり（\(model.duration)分・終了30分前に L.O.）" : "なし").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2)
                Spacer()
                Toggle("", isOn: $model.timed).labelsHidden().tint(NT.purple)
            }
            if model.timed {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach([60, 90, 120, 150, 180, 240], id: \.self) { m in chip("\(m)分", on: model.duration == m) { model.duration = m } }
                    }
                }
            }
        }
    }

    private func sourceCard(_ sources: [String]) -> some View {
        card("来店経路", note: "選ばなくても OK（会計で選べます）") {
            WrapLayout(spacing: 8) {
                ForEach(sources, id: \.self) { s in chip(s, on: model.source == s) { model.source = model.source == s ? "" : s } }
            }
        }
    }

    private func chip(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NT.ink2).lineLimit(1)
                .padding(.horizontal, 14).frame(height: 38)
                .background(Capsule().fill(on ? NT.purple : NT.page))
                .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private var startBar: some View {
        let problem = model.problem
        return Button {
            Task { if let id = await model.start() { onStarted(id) } }
        } label: {
            HStack(spacing: 8) {
                if model.busy { ProgressView().tint(.white) } else { Image(systemName: "checkmark.circle.fill").font(.system(size: 20, weight: .bold)) }
                Text(problem ?? "\(model.guests)名で開始して注文へ").font(.system(size: 18, weight: .heavy))
            }
            .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(problem == nil ? NT.purple : NT.ink3))
            .shadow(color: NT.purple.opacity(problem == nil ? 0.35 : 0), radius: 10, y: 4)
        }
        .buttonStyle(PressableStyle())
        .disabled(problem != nil || model.busy)
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(LinearGradient(colors: [NT.page.opacity(0), NT.page], startPoint: .top, endPoint: .center).ignoresSafeArea(edges: .bottom))
    }
}
