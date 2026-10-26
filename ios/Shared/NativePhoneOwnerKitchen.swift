import SwiftUI

// iPhone の店長・オーナー：キッチン（KDS。Web の /app/kitchen。2026-10-25 Ronnie「101% native」）
//   上：持ち場（すべて・キッチン・焼き場・ドリンク・デザート）と残りの数・未提供・平均の待ち時間・提供済を表示・品目ごと・設定
//   注文の伝票（古い順・縦 1 列）：品を押すと 未着手→調理中→完成→提供済、伝票の「すべて提供済」
//   品目ごと：持ち場ごとに「唐揚げ ×5」。10 秒ごとに読み直す（音 ON なら新しい品で鳴る）
// 読み込み・操作は iPad と同じ NativeKitchenModel（GET part=kitchen ／ POST kdsItemStatus・kdsOrderServed・kdsSettings）

/// key "kitchen" の画面（NativePhoneOwnerScreen から）
struct NativePhoneOwnerKitchenScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model = NativeKitchenModel()

    var body: some View {
        NativePhoneOwnerKitchenView(model: model, onBack: { state.closePhoneOwnerModule() })
    }
}

struct NativePhoneOwnerKitchenView: View {
    @ObservedObject var model: NativeKitchenModel
    let onBack: () -> Void

    @State private var station = "all"
    @State private var showServed = false
    @State private var aggregate: Bool?
    @State private var settingsOpen = false
    private let timer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()
    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    static let stationOrder = ["all", "kitchen", "grill", "drink", "dessert"]
    static let stationLabel = ["all": "すべて", "kitchen": "キッチン", "grill": "焼き場", "drink": "ドリンク", "dessert": "デザート"]
    static let statusLabel = ["pending": "未着手", "preparing": "調理中", "ready": "完成", "served": "提供済"]
    static let nextStatus = ["pending": "preparing", "preparing": "ready", "ready": "served"]
    static let nextLabel = ["pending": "調理開始", "preparing": "完成", "ready": "提供済"]
    static let sourceLabel = ["pos": "POS", "qr": "QR", "online": "オンライン"]

    private var isAggregate: Bool { aggregate ?? model.payload?.kdsSettings.aggregate ?? false }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "キッチン", subtitle: subtitle, onBack: onBack, trailing: {
                HStack(spacing: 0) {
                    if model.payload?.canManageSettings == true {
                        Button { settingsOpen = true } label: {
                            Image(systemName: "gearshape").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 38, height: 40)
                        }
                        .accessibilityLabel("キッチンの設定")
                    }
                    NPZRefreshButton(loading: model.busy) { Task { await model.load() } }
                }
            }, content: {
                VStack(spacing: 0) {
                    if let p = model.payload {
                        toolbar(p)
                        if isAggregate { aggregateList(p) } else { tickets(p) }
                    } else {
                        NOSStateView(error: model.error) { Task { await model.load() } }
                    }
                }
            })
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack(spacing: 6) { Image(systemName: "exclamationmark.triangle.fill"); Text(e).lineLimit(2); Image(systemName: "xmark") }
                        .font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Capsule().fill(NT.danger))
                }
                .buttonStyle(.plain).padding(.bottom, 24).padding(.horizontal, 16)
            }
        }
        .task { if !NPS.preview { await model.load() } }
        .onReceive(timer) { _ in if !NPS.preview { Task { await model.load() } } }
        .onReceive(clock) { _ in model.tick() }
        .sheet(isPresented: $settingsOpen) {
            if let s = model.payload?.kdsSettings {
                NPKitchenSettingsSheet(model: model, initial: s, onClose: { settingsOpen = false })
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private var subtitle: String {
        guard let p = model.payload else { return "Kitchen (KDS)" }
        return "未提供 \(p.unservedCount)品・平均 \(p.avgElapsedMinutes)分"
    }

    // MARK: 上の列

    private func unserved(_ groups: [NKGroup]) -> [NKItem] { groups.flatMap { $0.items.filter { $0.kitchenStatus != "served" } } }

    private func toolbar(_ p: NKPayload) -> some View {
        let open = unserved(p.groups)
        return VStack(alignment: .leading, spacing: 8) {
            NPZChipRow(items: Self.stationOrder.map { st -> (String, String) in
                let n = st == "all" ? open.count : open.filter { $0.station == st }.count
                return (st, (Self.stationLabel[st] ?? st) + (n > 0 ? " \(n)" : ""))
            }, selection: station) { station = $0 }
            HStack(spacing: 6) {
                NPOCChip(text: "提供済を表示", selected: showServed) { showServed.toggle() }
                NPOCChip(text: "品目ごと", selected: isAggregate) { aggregate = !isAggregate }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 6)
    }

    // MARK: 伝票

    private func visibleItems(_ g: NKGroup) -> [NKItem] {
        g.items.filter { (station == "all" || $0.station == station) && (showServed || $0.kitchenStatus != "served") }
    }

    private func tickets(_ p: NKPayload) -> some View {
        let groups = p.groups.filter { !visibleItems($0).isEmpty }
        return ScrollView {
            LazyVStack(spacing: 10) {
                if groups.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle").font(.system(size: 38)).foregroundColor(NT.ok)
                        Text("いま作る品はありません").font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
                        Text("新しい注文が入るとここに出ます").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 50)
                }
                ForEach(groups) { g in ticket(g, p) }
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 40)
        }
        .refreshable { await model.load() }
    }

    private func minutes(since iso: String) -> Int {
        guard let ms = NFTime.ms(iso: iso) else { return 0 }
        return max(0, Int((model.now.timeIntervalSince1970 * 1000 - ms) / 60_000))
    }

    private func tone(_ m: Int, _ s: NKSettings) -> Color {
        if m >= s.warn3 { return NT.danger }
        if m >= s.warn2 { return Color(hex: 0xF59E0B) }
        if m >= s.warn1 { return NT.purple }
        return NT.ink3
    }

    private func ticket(_ g: NKGroup, _ p: NKPayload) -> some View {
        let m = minutes(since: g.orderTime)
        let c = tone(m, p.kdsSettings)
        let items = visibleItems(g)
        let open = items.filter { $0.kitchenStatus != "served" }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(g.tableName ?? "#\(g.orderNo)").font(.system(size: 20, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                Text(Self.sourceLabel[g.orderSource] ?? g.orderSource).font(.system(size: 10.5, weight: NT.strong)).foregroundColor(NT.ink2)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(NT.lilac))
                if g.tableName != nil { Text("#\(g.orderNo)").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3) }
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(m)").font(.system(size: 22, weight: NT.strong)).monospacedDigit()
                    Text("分").font(.system(size: 11, weight: .bold))
                }
                .foregroundColor(c)
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 6)
            NPZDivider()
            ForEach(items) { it in itemRow(it) }
            if !open.isEmpty {
                Button {
                    Task { await model.act(["type": "kdsOrderServed", "orderId": g.orderId, "itemIds": station == "all" ? [] : open.map(\.id)]) }
                } label: {
                    Text(station == "all" ? "すべて提供済" : "\(Self.stationLabel[station] ?? "") をすべて提供済")
                        .font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.pay))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy)
                .padding(10)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(c == NT.ink3 ? Color.clear : c, lineWidth: 2.5))
    }

    private func itemRow(_ it: NKItem) -> some View {
        let next = Self.nextStatus[it.kitchenStatus]
        let chip: (Color, Color) = {
            switch it.kitchenStatus {
            case "preparing": return (Color(hex: 0xFEF3C7), Color(hex: 0x92400E))
            case "ready": return (NT.ok.opacity(0.14), NT.ok)
            case "served": return (NT.lilac, NT.ink3)
            default: return (NT.page, NT.ink2)
            }
        }()
        return Button {
            if let next { Task { await model.act(["type": "kdsItemStatus", "itemId": it.id, "next": next]) } }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("\(it.quantity)").font(.system(size: 19, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink).frame(minWidth: 24, alignment: .trailing)
                VStack(alignment: .leading, spacing: 2) {
                    Text(it.name).font(.system(size: 16, weight: .bold)).foregroundColor(it.kitchenStatus == "served" ? NT.ink3 : NT.ink)
                        .strikethrough(it.kitchenStatus == "served").multilineTextAlignment(.leading)
                    if !it.modifiers.isEmpty {
                        Text(it.modifiers.map(\.name).joined(separator: "・")).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.purple)
                    }
                    if let memo = it.memo, !memo.isEmpty {
                        Text(memo).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger)
                    }
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(Self.statusLabel[it.kitchenStatus] ?? it.kitchenStatus).font(.system(size: 11.5, weight: NT.strong)).foregroundColor(chip.1)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(chip.0))
                    if next != nil, let label = Self.nextLabel[it.kitchenStatus] {
                        Text("押して\(label)").font(.system(size: 10, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(next == nil || model.busy)
    }

    // MARK: 品目ごと

    private struct AggRow: Identifiable {
        let id: String
        let name: String
        let mods: String
        var quantity: Int
        let station: String
        var pending: Int
        var preparing: Int
        var ready: Int
    }

    private func aggregateRows(_ p: NKPayload) -> [AggRow] {
        var map: [String: AggRow] = [:]
        var order: [String] = []
        for g in p.groups {
            for it in g.items where it.kitchenStatus != "served" && (station == "all" || it.station == station) {
                let mods = it.modifiers.map(\.name).sorted().joined(separator: "・")
                let key = "\(it.station)::\(it.name)::\(mods)"
                if map[key] == nil {
                    map[key] = AggRow(id: key, name: it.name, mods: mods, quantity: 0, station: it.station, pending: 0, preparing: 0, ready: 0)
                    order.append(key)
                }
                map[key]?.quantity += it.quantity
                if it.kitchenStatus == "pending" { map[key]?.pending += it.quantity }
                if it.kitchenStatus == "preparing" { map[key]?.preparing += it.quantity }
                if it.kitchenStatus == "ready" { map[key]?.ready += it.quantity }
            }
        }
        return order.compactMap { map[$0] }
    }

    private func aggregateList(_ p: NKPayload) -> some View {
        let rows = aggregateRows(p)
        let stations = Self.stationOrder.dropFirst().filter { st in rows.contains { $0.station == st } }
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if rows.isEmpty { NPOCEmpty(icon: "checkmark.circle", title: "いま作る品はありません") }
                ForEach(Array(stations), id: \.self) { st in
                    NPOCard(title: Self.stationLabel[st] ?? st) {
                        ForEach(rows.filter { $0.station == st }) { r in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(r.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
                                    Spacer()
                                    Text("× \(r.quantity)").font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                                }
                                if !r.mods.isEmpty { Text(r.mods).font(.system(size: 12)).foregroundColor(NT.ink3) }
                                HStack(spacing: 5) {
                                    if r.pending > 0 { NOSBadge(text: "未着手\(r.pending)", color: NT.ink2) }
                                    if r.preparing > 0 { NOSBadge(text: "調理中\(r.preparing)", color: Color(hex: 0x92400E)) }
                                    if r.ready > 0 { NOSBadge(text: "完成\(r.ready)", color: NT.ok) }
                                }
                            }
                            .padding(10)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 40)
        }
        .refreshable { await model.load() }
    }
}

/// キッチンの設定（警告の分 3 段階・品目ごとにまとめる・音）。店舗の設定の権限がある人だけ
struct NPKitchenSettingsSheet: View {
    @ObservedObject var model: NativeKitchenModel
    let onClose: () -> Void
    @State private var s: NKSettings
    @State private var saving = false

    init(model: NativeKitchenModel, initial: NKSettings, onClose: @escaping () -> Void) {
        self.model = model
        self.onClose = onClose
        _s = State(initialValue: initial)
    }

    private var valid: Bool { s.warn1 > 0 && s.warn1 < s.warn2 && s.warn2 < s.warn3 }

    var body: some View {
        NPOCSheetFrame(title: "キッチンの設定", confirmText: "保存", busy: saving, onCancel: onClose, onConfirm: {
            guard valid else { return }
            saving = true
            Task {
                await model.act(["type": "kdsSettings", "settings": ["warn1": s.warn1, "warn2": s.warn2, "warn3": s.warn3, "aggregate": s.aggregate, "sound": s.sound]])
                saving = false
                if model.error == nil { onClose() }
            }
        }) {
            NPOCard(title: "待ち時間の警告（分）") {
                Stepper("段階1（青）：\(s.warn1) 分", value: $s.warn1, in: 1...120).font(.system(size: 15, weight: .bold))
                Stepper("段階2（黄）：\(s.warn2) 分", value: $s.warn2, in: 1...120).font(.system(size: 15, weight: .bold))
                Stepper("段階3（赤）：\(s.warn3) 分", value: $s.warn3, in: 1...180).font(.system(size: 15, weight: .bold))
                if !valid { Text("段階1 < 段階2 < 段階3 にしてください").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger) }
            }
            NPOCard(title: "表示") {
                NPSToggleRow(title: "品目ごとにまとめて出す", isOn: $s.aggregate)
                NPSToggleRow(title: "新しい品が来たら音を鳴らす", isOn: $s.sound)
            }
        }
    }
}
