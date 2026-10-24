import SwiftUI
import AudioToolbox

// キッチン（KDS）のネイティブ。Web の /app/kitchen と同じ中身・操作（lib/kds-server.ts・lib/native-modules/kitchen.ts）。
// 2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」。
//   上：持ち場（すべて・キッチン・焼き場・ドリンク・デザート）・未提供の数・平均の待ち時間・提供済を表示・品目ごと・設定
//   注文カード（古い順）：品を押すと 未着手→調理中→完成→提供済、カードの「すべて提供済」
//   品目ごと：持ち場ごとに「唐揚げ ×5」（仕込みの量を見る用）
//   10 秒ごとに読み直す。音 ON なら新しい品が来たら鳴らす

struct NKModifier: Decodable, Hashable { let name: String; let price: Double? }

struct NKItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: Int
    let memo: String?
    let modifiers: [NKModifier]
    let station: String
    let kitchenStatus: String
    let createdAt: String
}

struct NKGroup: Decodable, Identifiable, Hashable {
    let orderId: String
    let orderNo: Int
    let tableName: String?
    let orderSource: String
    let orderTime: String
    let items: [NKItem]
    var id: String { orderId }
}

struct NKSettings: Decodable, Hashable {
    var warn1: Int
    var warn2: Int
    var warn3: Int
    var aggregate: Bool
    var sound: Bool
}

struct NKPayload: Decodable {
    let ok: Bool
    let groups: [NKGroup]
    let now: Double
    let unservedCount: Int
    let avgElapsedMinutes: Int
    let kdsSettings: NKSettings
    let stations: [String: String]?
    let canManageSettings: Bool
}

@MainActor
final class NativeKitchenModel: ObservableObject {
    @Published var payload: NKPayload?
    @Published var error: String?
    @Published var busy = false
    @Published var now = Date()
    private var offset: TimeInterval = 0
    private var seenPending: Set<String>?

    func load() async {
        if payload == nil, let saved = NativeModuleAPI.cached(NKPayload.self, part: "kitchen") { payload = saved }
        do {
            let p = try await NativeModuleAPI.get(NKPayload.self, part: "kitchen")
            offset = p.now / 1000 - Date().timeIntervalSince1970
            now = Date().addingTimeInterval(offset)
            // 新しい未着手の品が来たら鳴らす（音 ON のとき。最初の読み込みは鳴らさない）
            let pending = Set(p.groups.flatMap { $0.items.filter { $0.kitchenStatus == "pending" }.map(\.id) })
            if let seen = seenPending, p.kdsSettings.sound, !pending.subtracting(seen).isEmpty { AudioServicesPlaySystemSound(1005) }
            seenPending = pending
            payload = p
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) }
        }
    }

    func tick() { now = Date().addingTimeInterval(offset) }

    func act(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        do {
            try await NativeModuleAPI.post(body)
            await load()
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
    }
}

struct NativeKitchenView: View {
    @StateObject private var model = NativeKitchenModel()
    let onHome: () -> Void

    @State private var station = "all"
    @State private var showServed = false
    @State private var aggregate: Bool?
    @State private var settingsOpen = false
    private let timer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()
    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private static let stationOrder = ["all", "kitchen", "grill", "drink", "dessert"]
    private static let stationLabel = ["all": "すべて", "kitchen": "キッチン", "grill": "焼き場", "drink": "ドリンク", "dessert": "デザート"]
    private static let statusLabel = ["pending": "未着手", "preparing": "調理中", "ready": "完成", "served": "提供済"]
    private static let nextStatus = ["pending": "preparing", "preparing": "ready", "ready": "served"]
    private static let nextLabel = ["pending": "調理開始", "preparing": "完成", "ready": "提供済"]
    private static let sourceLabel = ["pos": "POS", "qr": "QR", "online": "オンライン"]

    private var p: NKPayload? { model.payload }
    private var isAggregate: Bool { aggregate ?? p?.kdsSettings.aggregate ?? false }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "キッチン", subtitle: "Kitchen (KDS)", onHome: onHome)
            if let p {
                toolbar(p)
                if isAggregate { aggregateBoard(p) } else { cardsBoard(p) }
            } else if let e = model.error {
                Spacer()
                VStack(spacing: 10) {
                    Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.red)
                    Button("もう一度") { Task { await model.load() } }
                }
                Spacer()
            } else {
                Spacer(); ProgressView("読み込み中…"); Spacer()
            }
        }
        .background(NT.page.ignoresSafeArea())
        .task { await model.load() }
        .onReceive(timer) { _ in Task { await model.load() } }
        .onReceive(clock) { _ in model.tick() }
        .sheet(isPresented: $settingsOpen) {
            if let s = p?.kdsSettings { NativeKitchenSettings(model: model, initial: s, onClose: { settingsOpen = false }) }
        }
        .overlay(alignment: .bottom) {
            if let e = model.error, p != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e); Image(systemName: "xmark") }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Capsule().fill(NLColor.red))
                }
                .buttonStyle(.plain).padding(.bottom, 20)
            }
        }
    }

    // MARK: 上の列

    private func toolbar(_ p: NKPayload) -> some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(Self.stationOrder, id: \.self) { st in
                    let n = st == "all" ? unserved(p.groups).count : unserved(p.groups).filter { $0.station == st }.count
                    Button { station = st } label: {
                        HStack(spacing: 6) {
                            Text(Self.stationLabel[st] ?? st).font(.system(size: 15, weight: .heavy))
                            if n > 0 {
                                Text("\(n)").font(.system(size: 12, weight: .heavy)).monospacedDigit()
                                    .padding(.horizontal, 6).frame(height: 20)
                                    .background(Capsule().fill(station == st ? Color.white.opacity(0.25) : NT.lilac))
                            }
                        }
                        .foregroundColor(station == st ? .white : NT.ink)
                        .padding(.horizontal, 14).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(station == st ? NT.purple : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(station == st ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            Spacer(minLength: 8)
            stat("未提供", "\(p.unservedCount)", "品")
            stat("平均待ち", "\(p.avgElapsedMinutes)", "分")
            toggle("提供済を表示", on: showServed) { showServed.toggle() }
            toggle("品目ごと", on: isAggregate) { aggregate = !isAggregate }
            if p.canManageSettings {
                Button { settingsOpen = true } label: {
                    Image(systemName: "gearshape").font(.system(size: 18, weight: .semibold)).foregroundColor(NT.ink2)
                        .frame(width: 44, height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("キッチンの設定")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private func stat(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                Text(unit).font(.system(size: 11)).foregroundColor(NT.ink3)
            }
        }
        .padding(.horizontal, 12).frame(height: 46)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func toggle(_ t: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: on ? "checkmark.square.fill" : "square").font(.system(size: 16, weight: .semibold))
                Text(t).font(.system(size: 14, weight: .bold))
            }
            .foregroundColor(on ? NT.purple : NT.ink2)
            .padding(.horizontal, 12).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? NT.purple : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 注文カード

    private func unserved(_ groups: [NKGroup]) -> [NKItem] { groups.flatMap { $0.items.filter { $0.kitchenStatus != "served" } } }

    private func visibleItems(_ g: NKGroup) -> [NKItem] {
        g.items.filter { (station == "all" || $0.station == station) && (showServed || $0.kitchenStatus != "served") }
    }

    private func cardsBoard(_ p: NKPayload) -> some View {
        let groups = p.groups.filter { !visibleItems($0).isEmpty }
        return Group {
            if groups.isEmpty {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "checkmark.circle").font(.system(size: 40)).foregroundColor(NLColor.green)
                    Text("いま作る品はありません").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    Text("新しい注文が入るとここに出ます").font(.system(size: 13)).foregroundColor(NT.ink3)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 14, alignment: .top)], spacing: 14) {
                        ForEach(groups) { g in card(g, p: p) }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 24)
                }
            }
        }
    }

    private func minutes(since iso: String) -> Int {
        guard let ms = NFTime.ms(iso: iso) else { return 0 }
        return max(0, Int((model.now.timeIntervalSince1970 * 1000 - ms) / 60_000))
    }

    private func tone(_ m: Int, _ s: NKSettings) -> Color {
        if m >= s.warn3 { return NLColor.red }
        if m >= s.warn2 { return Color(hex: 0xF59E0B) }
        if m >= s.warn1 { return NT.purple }
        return NT.ink3
    }

    private func card(_ g: NKGroup, p: NKPayload) -> some View {
        let m = minutes(since: g.orderTime)
        let c = tone(m, p.kdsSettings)
        let items = visibleItems(g)
        let open = items.filter { $0.kitchenStatus != "served" }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(g.tableName ?? "#\(g.orderNo)").font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                Text(Self.sourceLabel[g.orderSource] ?? g.orderSource).font(.system(size: 11, weight: .heavy)).foregroundColor(NT.ink2)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(NT.lilac))
                if g.tableName != nil { Text("#\(g.orderNo)").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3) }
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(m)").font(.system(size: 24, weight: .heavy)).monospacedDigit()
                    Text("分").font(.system(size: 12, weight: .bold))
                }
                .foregroundColor(c)
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            Rectangle().fill(NT.line).frame(height: 1)
            ForEach(items) { it in itemRow(it) }
            if !open.isEmpty {
                Button {
                    Task { await model.act(["type": "kdsOrderServed", "orderId": g.orderId, "itemIds": station == "all" ? [] : open.map(\.id)]) }
                } label: {
                    Text(station == "all" ? "すべて提供済" : "\(Self.stationLabel[station] ?? "") をすべて提供済")
                        .font(.system(size: 15, weight: .heavy)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.pay))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy)
                .padding(12)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(c == NT.ink3 ? NT.line : c, lineWidth: c == NT.ink3 ? 1 : 2.5))
        .shadow(color: Color.black.opacity(0.05), radius: 8, y: 3)
    }

    private func itemRow(_ it: NKItem) -> some View {
        let next = Self.nextStatus[it.kitchenStatus]
        let chip: (Color, Color) = {
            switch it.kitchenStatus {
            case "preparing": return (Color(hex: 0xFEF3C7), Color(hex: 0x92400E))
            case "ready": return (NLColor.greenSoft, Color(hex: 0x036B4A))
            case "served": return (NT.lilac, NT.ink3)
            default: return (Color(hex: 0xF1F1F5), NT.ink2)
            }
        }()
        return Button {
            if let next { Task { await model.act(["type": "kdsItemStatus", "itemId": it.id, "next": next]) } }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("\(it.quantity)").font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink).frame(minWidth: 26, alignment: .trailing)
                VStack(alignment: .leading, spacing: 2) {
                    Text(it.name).font(.system(size: 17, weight: .bold)).foregroundColor(it.kitchenStatus == "served" ? NT.ink3 : NT.ink)
                        .strikethrough(it.kitchenStatus == "served")
                    if !it.modifiers.isEmpty {
                        Text(it.modifiers.map(\.name).joined(separator: "・")).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.purple)
                    }
                    if let memo = it.memo, !memo.isEmpty {
                        Text(memo).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red)
                    }
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(Self.statusLabel[it.kitchenStatus] ?? it.kitchenStatus).font(.system(size: 12, weight: .heavy)).foregroundColor(chip.1)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(chip.0))
                    if next != nil, let label = Self.nextLabel[it.kitchenStatus] {
                        Text("押して\(label)").font(.system(size: 10, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
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
                if map[key] == nil { map[key] = AggRow(id: key, name: it.name, mods: mods, quantity: 0, station: it.station, pending: 0, preparing: 0, ready: 0); order.append(key) }
                map[key]!.quantity += it.quantity
                if it.kitchenStatus == "pending" { map[key]!.pending += it.quantity }
                if it.kitchenStatus == "preparing" { map[key]!.preparing += it.quantity }
                if it.kitchenStatus == "ready" { map[key]!.ready += it.quantity }
            }
        }
        return order.compactMap { map[$0] }
    }

    private func aggregateBoard(_ p: NKPayload) -> some View {
        let rows = aggregateRows(p)
        let stations = Self.stationOrder.dropFirst().filter { st in rows.contains { $0.station == st } }
        return ScrollView {
            if rows.isEmpty {
                Text("いま作る品はありません").font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink3).padding(.top, 60)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14, alignment: .top)], spacing: 14) {
                ForEach(Array(stations), id: \.self) { st in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Self.stationLabel[st] ?? st).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                        ForEach(rows.filter { $0.station == st }) { r in
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("\(r.name) × \(r.quantity)").font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                                    if !r.mods.isEmpty { Text(r.mods).font(.system(size: 12)).foregroundColor(NT.ink3) }
                                }
                                Spacer(minLength: 4)
                                if r.pending > 0 { badge("未着手\(r.pending)", Color(hex: 0xF1F1F5), NT.ink2) }
                                if r.preparing > 0 { badge("調理中\(r.preparing)", Color(hex: 0xFEF3C7), Color(hex: 0x92400E)) }
                                if r.ready > 0 { badge("完成\(r.ready)", NLColor.greenSoft, Color(hex: 0x036B4A)) }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                        }
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
    }

    private func badge(_ t: String, _ bg: Color, _ fg: Color) -> some View {
        Text(t).font(.system(size: 12, weight: .heavy)).monospacedDigit().foregroundColor(fg)
            .padding(.horizontal, 7).padding(.vertical, 3).background(Capsule().fill(bg))
    }
}

/// キッチンの設定（警告の分 3 段階・品目ごとにまとめる・音）。店舗の設定の権限がある人だけ
struct NativeKitchenSettings: View {
    @ObservedObject var model: NativeKitchenModel
    let initial: NKSettings
    let onClose: () -> Void
    @State private var s: NKSettings
    @State private var saving = false

    init(model: NativeKitchenModel, initial: NKSettings, onClose: @escaping () -> Void) {
        self.model = model
        self.initial = initial
        self.onClose = onClose
        _s = State(initialValue: initial)
    }

    private var valid: Bool { s.warn1 > 0 && s.warn1 < s.warn2 && s.warn2 < s.warn3 }

    var body: some View {
        NavigationStack {
            Form {
                Section("待ち時間の警告（分）") {
                    Stepper("段階1（青）：\(s.warn1) 分", value: $s.warn1, in: 1...120)
                    Stepper("段階2（黄）：\(s.warn2) 分", value: $s.warn2, in: 1...120)
                    Stepper("段階3（赤）：\(s.warn3) 分", value: $s.warn3, in: 1...180)
                    if !valid { Text("段階1 < 段階2 < 段階3 にしてください").foregroundColor(NLColor.red) }
                }
                Section("表示") {
                    Toggle("品目ごとにまとめて出す", isOn: $s.aggregate)
                    Toggle("新しい品が来たら音を鳴らす", isOn: $s.sound)
                }
            }
            .navigationTitle("キッチンの設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : "保存") {
                        saving = true
                        Task {
                            await model.act(["type": "kdsSettings", "settings": ["warn1": s.warn1, "warn2": s.warn2, "warn3": s.warn3, "aggregate": s.aggregate, "sound": s.sound]])
                            saving = false
                            if model.error == nil { onClose() }
                        }
                    }
                    .disabled(!valid || saving)
                }
            }
        }
    }
}
