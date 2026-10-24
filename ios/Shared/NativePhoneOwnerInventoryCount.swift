import SwiftUI

// iPhone の店長・オーナー：棚卸の入力（Web の /app/inventory/counts/<id> と同じ。2026-10-25 Ronnie「iPhone も native に」）
//   1 品目 1 行：理論在庫・大きい − 実数 ＋（数を押すとテンキー）・「＝理論」（理論在庫どおり）・差異
//   上：入力済みの数・絞り込み（すべて・未入力・差異あり）・名前で探す ／ 下：一時保存・棚卸を確定（確認あり。取り消せない）
// サーバーは iPad と同じ：GET part=inventoryCount&id= ／ POST invCountSave（finalize で確定）

/// GET ?part=inventoryCount&id=
struct NPZInvCountItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let expectedQuantity: Double
    let countedQuantity: Double?
}

struct NPZInvCountDetail: Decodable {
    let id: String
    let countDate: String
    let status: String
    let storeName: String?
    let canWrite: Bool
    let items: [NPZInvCountItem]
}

@MainActor
final class NPZCountModel: ObservableObject {
    let countId: String
    @Published var detail: NPZInvCountDetail?
    /// 入力（棚卸の行 id → 字）。空＝未入力
    @Published var values: [String: String] = [:]
    /// サーバーに保存されている値
    @Published var saved: [String: String] = [:]
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    /// all ／ todo（未入力）／ diff（差異あり）
    @Published var filter = "all"
    @Published var query = ""

    init(id: String) {
        countId = id
        if let c = NPZApi.cached(NPZInvCountDetail.self, "inventoryCount", ["id": id]) { apply(c, keepInput: false) }
    }

    /// 入力できる（入力中で、権限がある）
    var editable: Bool { detail?.status == "draft" && detail?.canWrite == true }
    /// 保存していない入力がある
    var dirty: Bool { values.contains { saved[$0.key, default: ""] != $0.value } }
    func isDirty(_ id: String) -> Bool { (values[id] ?? "") != (saved[id] ?? "") }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            let d = try await NPZApi.get(NPZInvCountDetail.self, "inventoryCount", ["id": countId])
            apply(d, keepInput: true)
            error = nil
        } catch {
            self.error = NPZApi.message(error)
        }
    }

    /// サーバーの中身を入れる。keepInput なら保存していない入力は残す
    func apply(_ d: NPZInvCountDetail, keepInput: Bool) {
        var server: [String: String] = [:]
        for it in d.items { server[it.id] = it.countedQuantity.map { NPZ.q($0) } ?? "" }
        var next = server
        if keepInput {
            for (k, v) in values where (saved[k] ?? "") != v && server[k] != nil { next[k] = v }
        }
        detail = d
        saved = server
        values = next
    }

    func value(_ id: String) -> Double? { NPZ.num(values[id] ?? "") }

    func set(_ id: String, _ v: Double?) {
        values[id] = v.map { NPZ.q(max(0, ($0 * 1000).rounded() / 1000)) } ?? ""
    }

    /// − ＋：未入力なら理論在庫から動かす
    func step(_ item: NPZInvCountItem, _ d: Double) {
        let base = value(item.id) ?? item.expectedQuantity
        set(item.id, max(0, base + d))
    }

    var enteredCount: Int { (detail?.items ?? []).filter { value($0.id) != nil }.count }

    /// 絞り込み・探すを当てた行
    var shown: [NPZInvCountItem] {
        let items = detail?.items ?? []
        let t = NPZ.trimmed(query)
        return items.filter { it in
            if !t.isEmpty && !it.name.localizedCaseInsensitiveContains(t) { return false }
            switch filter {
            case "todo": return value(it.id) == nil
            case "diff":
                if editable { return value(it.id).map { $0 != it.expectedQuantity } ?? false }
                return it.countedQuantity.map { $0 != it.expectedQuantity } ?? false
            default: return true
            }
        }
    }

    /// 保存（finalize で確定）。できたら true
    func save(finalize: Bool) async -> Bool {
        busy = true
        defer { busy = false }
        let entries: [[String: Any]] = values.compactMap { id, v in
            guard let n = NPZ.num(v), n >= 0 else { return nil }
            return ["id": id, "countedQuantity": n]
        }
        let r = await NPZApi.post(["type": "invCountSave", "countId": countId, "entries": entries, "finalize": finalize])
        guard r.ok else {
            error = r.error ?? (finalize ? "確定に失敗しました" : "保存に失敗しました")
            return false
        }
        toast = finalize ? "棚卸を確定しました" : "実数を保存しました"
        if NativePreview.current != nil {
            saved = values
            return true
        }
        do {
            let d = try await NPZApi.get(NPZInvCountDetail.self, "inventoryCount", ["id": countId])
            apply(d, keepInput: false)
        } catch {
            saved = values
        }
        return true
    }
}

struct NPZCountView: View {
    @StateObject private var model: NPZCountModel
    let storeName: String
    /// 戻る（何か保存・確定したか）
    let onClose: (Bool) -> Void

    @State private var editing: NPZInvCountItem?
    @State private var confirmFinalize = false
    @State private var confirmLeave = false
    @State private var changed = false

    init(countId: String, storeName: String, sample: NPZCountModel? = nil, onClose: @escaping (Bool) -> Void) {
        _model = StateObject(wrappedValue: sample ?? NPZCountModel(id: countId))
        self.storeName = storeName
        self.onClose = onClose
    }

    private var subtitle: String {
        guard let d = model.detail else { return storeName }
        return "\(NPZ.date(d.countDate))・\(d.storeName ?? storeName)"
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOCDetailFrame(title: "棚卸", subtitle: subtitle, backLabel: "在庫", onBack: back, trailing: { EmptyView() }) {
                VStack(spacing: 0) {
                    if model.detail != nil { NOSErrorBar(error: $model.error) }
                    if let d = model.detail {
                        content(d)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.load() } }
                    }
                }
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.load() }
        .sheet(item: $editing) { it in numberSheet(it) }
        .confirmationDialog("棚卸を確定しますか？", isPresented: $confirmFinalize, titleVisibility: .visible) {
            Button("確定する（在庫数を更新）", role: .destructive) {
                Task {
                    if await model.save(finalize: true) { changed = true }
                }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("入力した実数で在庫数を更新します。この操作は取り消せません。未入力の品目は変わりません。")
        }
        .confirmationDialog("保存していない入力があります", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("一時保存して戻る") {
                Task {
                    if await model.save(finalize: false) { onClose(true) }
                }
            }
            Button("保存しないで戻る", role: .destructive) { onClose(changed) }
            Button("入力を続ける", role: .cancel) {}
        }
    }

    private func back() {
        if model.editable && model.dirty { confirmLeave = true } else { onClose(changed) }
    }

    // MARK: 中身

    private func content(_ d: NPZInvCountDetail) -> some View {
        let editable = model.editable
        let rows = model.shown
        return VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    header(d)
                    filters
                    if d.items.isEmpty {
                        NPOCEmpty(icon: "shippingbox", title: "品目がありません", note: "在庫の品目を登録すると棚卸に出ます")
                    } else if rows.isEmpty {
                        NPOCEmpty(icon: "line.3.horizontal.decrease.circle", title: "該当する品目がありません")
                    } else {
                        ForEach(rows) { it in row(it, editable: editable) }
                    }
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, editable ? 110 : 40)
            }
            .refreshable { await model.load() }
            .scrollDismissesKeyboard(.interactively)
            if editable { footer }
        }
    }

    private func header(_ d: NPZInvCountDetail) -> some View {
        let st = NPZInv.countStatus(d.status)
        let total = d.items.count
        let entered = model.enteredCount
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                Text(NPZ.date(d.countDate)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                NOSBadge(text: st.0, color: st.1)
                Spacer()
                Text("\(entered)/\(total)品 入力").font(.system(size: 13, weight: .heavy)).foregroundColor(entered == total ? NT.ok : NT.ink2).monospacedDigit()
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(NT.page)
                    Capsule().fill(entered == total ? NT.ok : NT.purple)
                        .frame(width: total == 0 ? 0 : max(6, g.size.width * CGFloat(entered) / CGFloat(total)))
                }
            }
            .frame(height: 8)
            if model.editable {
                Text("数えた数（実数）を入れてください。− ＋ は理論在庫から動きます。数を押すとテンキー、「＝理論」は理論在庫どおり。")
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            } else if d.status == "draft" {
                Text("入力の権限がありません（見るだけ）").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            }
        }
        .padding(14)
        .background(npocCard())
    }

    private var filters: some View {
        VStack(spacing: 8) {
            NPZSearchField(text: $model.query, placeholder: "品目名で探す")
            NPZChipRow(items: [("all", "すべて"), ("todo", "未入力"), ("diff", "差異あり")], selection: model.filter) { model.filter = $0 }
        }
    }

    // MARK: 1 品目の行

    private func row(_ it: NPZInvCountItem, editable: Bool) -> some View {
        let v = editable ? model.value(it.id) : it.countedQuantity
        let diff = v.map { $0 - it.expectedQuantity }
        return VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(it.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2)
                Spacer(minLength: 6)
                Text("理論 \(NPZ.q(it.expectedQuantity))\(it.unit)").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit()
                    .lineLimit(1)
            }
            if editable {
                HStack(spacing: 8) {
                    NPZBigStepper(value: v.map { NPZ.q($0) } ?? "未入力", unit: v == nil ? "" : it.unit, placeholder: v == nil,
                                  tint: diff.map { $0 == 0 ? NT.ink : ($0 > 0 ? NT.ok : NT.danger) } ?? NT.ink,
                                  minusEnabled: (v ?? it.expectedQuantity) > 0,
                                  onMinus: { model.step(it, -1) }, onPlus: { model.step(it, 1) }, onTap: { editing = it })
                    Button { model.set(it.id, it.expectedQuantity) } label: {
                        VStack(spacing: 1) {
                            Image(systemName: "equal").font(.system(size: 15, weight: .heavy))
                            Text("理論").font(.system(size: 10, weight: .heavy))
                        }
                        .foregroundColor(v == it.expectedQuantity ? .white : NT.ok)
                        .frame(width: 50, height: 52)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(v == it.expectedQuantity ? NT.ok : NT.ok.opacity(0.12)))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("理論在庫どおり")
                }
            } else {
                HStack(spacing: 8) {
                    cell("実数", v.map { NPZ.q($0) + it.unit } ?? "—", NT.ink)
                    cell("差異", diff.map { NPZ.signed($0) + it.unit } ?? "—", diff.map { $0 == 0 ? NT.ink : ($0 > 0 ? NT.ok : NT.danger) } ?? NT.ink3)
                }
            }
            if editable, let diff, diff != 0 {
                Text("差異 \(NPZ.signed(diff))\(it.unit)").font(.system(size: 12, weight: .heavy)).foregroundColor(diff > 0 ? NT.ok : NT.danger).monospacedDigit()
            }
        }
        .padding(12)
        .background(npocCard(14))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(editable && model.isDirty(it.id) ? NT.purple.opacity(0.55) : Color.clear, lineWidth: 1.5))
    }

    private func cell(_ label: String, _ value: String, _ tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 18, weight: .heavy)).foregroundColor(tone).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
    }

    // MARK: テンキー

    private func numberSheet(_ it: NPZInvCountItem) -> some View {
        let list = model.shown
        let nextItem: NPZInvCountItem? = list.firstIndex(where: { $0.id == it.id }).flatMap { i in i + 1 < list.count ? list[i + 1] : nil }
        var onNext: ((Double?) -> Void)? = nil
        if let n = nextItem {
            onNext = { v in
                model.set(it.id, v)
                editing = n
            }
        }
        return NPZNumberSheet(title: it.name, caption: "理論在庫 \(NPZ.q(it.expectedQuantity))\(it.unit)", unit: it.unit, initial: model.value(it.id),
                              decimal: true, shortcuts: [("理論在庫と同じ", it.expectedQuantity)], allowClear: true, okLabel: "決定",
                              onNext: onNext,
                              onDone: { v in
                                  model.set(it.id, v)
                                  editing = nil
                              },
                              onCancel: { editing = nil })
            .presentationDetents([.large])
    }

    // MARK: 下のボタン（一時保存・確定）

    private var footer: some View {
        VStack(spacing: 6) {
            if model.dirty {
                Text("保存していない入力があります").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.purpleDeep)
            }
            HStack(spacing: 8) {
                NPOCWideButton(text: "一時保存", icon: "tray.and.arrow.down", kind: .secondary, busy: model.busy, disabled: !model.dirty) {
                    Task {
                        if await model.save(finalize: false) { changed = true }
                    }
                }
                NPOCWideButton(text: "棚卸を確定", icon: "checkmark.seal", kind: .primary, disabled: model.busy || model.enteredCount == 0) {
                    confirmFinalize = true
                }
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 12)
        .background(Color.white.ignoresSafeArea(edges: .bottom).shadow(color: .black.opacity(0.06), radius: 6, y: -2))
    }
}
