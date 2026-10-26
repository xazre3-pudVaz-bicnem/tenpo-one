import SwiftUI

// iPhone の店長・オーナー：原価管理のレシピ（Web の /app/costing/<menuItemId>。2026-10-25 Ronnie「iPhone も native に」）
//   売価・原価（レシピ原価を優先、なければ手入力原価）・原価率・粗利益／食材の一覧（使用量・平均仕入単価・行の原価・メモ）
//   食材の追加・編集・削除：入れている間に「この食材の原価」「保存後のレシピ原価・原価率・粗利益」をその場で計算（Web と同じ式）
// サーバーは iPad と同じ：GET part=costingItem&id= ／ POST costingLineAdd・costingLineUpdate・costingLineDelete

struct NPZCoItemHead: Decodable, Hashable {
    let id: String
    let name: String
    let itemType: String
    let itemTypeLabel: String?
    let price: Double
    let manualCost: Double?
}

struct NPZCoLine: Decodable, Hashable, Identifiable {
    let id: String
    let inventoryItemId: String
    let ingredientName: String
    let unit: String
    let quantity: Double
    let avgCost: Double?
    let lineCost: Double?
    let note: String?
}

struct NPZCoOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let unit: String
    let avgCost: Double?
}

/// GET ?part=costingItem&id=
struct NPZCoItemPayload: Decodable {
    let item: NPZCoItemHead
    let recipeCost: Double?
    let displayCost: Double?
    let costRate: Double?
    let grossProfit: Double?
    let grossProfitRate: Double?
    let missingCostCount: Int
    let lines: [NPZCoLine]
    let ingredientOptions: [NPZCoOption]
}

/// 食材を足す・変える・消したあとのレシピ原価・原価率・粗利（Web の calcRecipeCost → resolveDisplayCost → costRate・grossProfit）
struct NPZCoPreview {
    let lineCost: Double?
    let recipeCost: Double?
    let displayCost: Double?
    let rate: Double?
    let profit: Double?
    let missing: Int

    static func make(lines: [NPZCoLine], replacing: String?, added: (Double, Double?)?, price: Double, manualCost: Double?) -> NPZCoPreview {
        var parts: [(Double, Double?)] = lines.filter { $0.id != replacing }.map { ($0.quantity, $0.avgCost) }
        if let added { parts.append(added) }
        var total: Double = 0
        var missing = 0
        for p in parts {
            if let c = NPZCoMath.lineCost(p.0, p.1) { total += c } else { missing += 1 }
        }
        let recipe: Double? = parts.isEmpty ? nil : total
        let display: Double? = recipe ?? manualCost
        let rate = display.flatMap { NPZCoMath.costRate($0, price) }
        let profit = display.map { price - $0 }
        let line = added.flatMap { NPZCoMath.lineCost($0.0, $0.1) }
        return NPZCoPreview(lineCost: line, recipeCost: recipe, displayCost: display, rate: rate, profit: profit, missing: missing)
    }
}

@MainActor
final class NPZCoItemModel: ObservableObject {
    let menuItemId: String
    @Published var payload: NPZCoItemPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    init(menuItemId: String) {
        self.menuItemId = menuItemId
        payload = NPZApi.cached(NPZCoItemPayload.self, "costingItem", ["id": menuItemId])
    }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            payload = try await NPZApi.get(NPZCoItemPayload.self, "costingItem", ["id": menuItemId])
            error = nil
        } catch {
            self.error = NPZApi.message(error)
        }
    }

    /// 食材の追加（line なし）・編集。nil＝できた、字＝エラー
    func save(line: NPZCoLine?, inventoryItemId: String, quantity: Double, note: String) async -> String? {
        var body: [String: Any] = [
            "type": line == nil ? "costingLineAdd" : "costingLineUpdate",
            "menuItemId": menuItemId,
            "inventoryItemId": inventoryItemId,
            "quantity": quantity,
            "note": note,
        ]
        if let line { body["lineId"] = line.id }
        busy = true
        defer { busy = false }
        let r = await NPZApi.post(body)
        guard r.ok else { return r.error ?? "保存できませんでした" }
        toast = line == nil ? "食材を追加しました" : "レシピを更新しました"
        await load()
        return nil
    }

    func delete(_ line: NPZCoLine) async -> String? {
        busy = true
        defer { busy = false }
        let r = await NPZApi.post(["type": "costingLineDelete", "lineId": line.id, "menuItemId": menuItemId])
        guard r.ok else { return r.error ?? "削除できませんでした" }
        toast = "食材を削除しました"
        await load()
        return nil
    }
}

/// 食材の追加（line なし）・編集のシート
struct NPZCoEditRef: Identifiable {
    let line: NPZCoLine?
    var id: String { line?.id ?? "new" }
}

struct NPZCoItemView: View {
    @StateObject private var model: NPZCoItemModel
    let onBack: () -> Void
    @State private var edit: NPZCoEditRef?

    init(menuItemId: String, sample: NPZCoItemModel? = nil, onBack: @escaping () -> Void) {
        _model = StateObject(wrappedValue: sample ?? NPZCoItemModel(menuItemId: menuItemId))
        self.onBack = onBack
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOCDetailFrame(title: model.payload?.item.name ?? "レシピ", subtitle: model.payload?.item.itemTypeLabel ?? "Recipe", backLabel: "原価管理", onBack: onBack, trailing: {
                if model.payload != nil {
                    NPOCBarButton(icon: "plus", label: "食材") { edit = NPZCoEditRef(line: nil) }
                }
            }) {
                Group {
                    if let p = model.payload {
                        content(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.load() } }
                    }
                }
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.load() }
        .sheet(item: $edit) { e in
            if let p = model.payload {
                NPZCoLineSheet(model: model, payload: p, line: e.line, onClose: { edit = nil })
            }
        }
    }

    private func content(_ p: NPZCoItemPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let e = model.error {
                    Text(e).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                }
                header(p)
                linesCard(p)
                NPOCWideButton(text: "食材を追加", icon: "plus", kind: .primary) { edit = NPZCoEditRef(line: nil) }
                Text("行の原価＝使用量×平均仕入単価（切り上げ）。売価・手入力原価の変更はメニュー管理（Web の画面）で。")
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 50)
        }
        .refreshable { await model.load() }
    }

    private func header(_ p: NPZCoItemPayload) -> some View {
        let tone = NPZCoMath.tone(p.costRate)
        let source = p.recipeCost != nil ? "レシピ原価" : (p.item.manualCost != nil ? "手入力の原価" : "原価なし")
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("原価率").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NPZCoMath.pct(p.costRate)).font(.system(size: 36, weight: NT.strong)).foregroundColor(tone).monospacedDigit()
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("粗利益").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NPZ.yen(p.grossProfit)).font(.system(size: 22, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    Text("粗利率 \(NPZCoMath.pct(p.grossProfitRate))").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                }
            }
            NPZDivider()
            NPZInfoRow(label: "売価", value: NPZ.yen(p.item.price))
            NPZInfoRow(label: "原価（\(source)）", value: NPZ.yen(p.displayCost))
            if p.recipeCost != nil, let m = p.item.manualCost {
                NPZInfoRow(label: "手入力の原価（参考）", value: NPZ.yen(m), tone: NT.ink3)
            }
            if p.missingCostCount > 0 {
                Text("平均仕入単価が無い食材が \(p.missingCostCount) 件あります（原価に入っていません）")
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NT.warn)
            }
        }
        .padding(14)
        .background(npocCard())
    }

    private func linesCard(_ p: NPZCoItemPayload) -> some View {
        NPOCard(title: "レシピ（食材）", trailing: "\(p.lines.count)件・押すと編集") {
            if p.lines.isEmpty {
                Text("食材がまだありません。「＋ 食材」から足すとレシピ原価が出ます。").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(p.lines) { l in
                Button { edit = NPZCoEditRef(line: l) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.ingredientName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                            Text("\(NPZ.q(l.quantity))\(l.unit) × \(l.avgCost.map { NPZ.q($0) + "円" } ?? "単価なし")")
                                .font(.system(size: 11.5, weight: .semibold)).foregroundColor(l.avgCost == nil ? NT.warn : NT.ink3).monospacedDigit()
                            if let n = l.note, !n.isEmpty { Text(n).font(.system(size: 11.5)).foregroundColor(NT.ink2).lineLimit(2) }
                        }
                        Spacer(minLength: 6)
                        Text(NPZ.yen(l.lineCost)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3).padding(.top, 3)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if l.id != p.lines.last?.id { NPZDivider() }
            }
            if !p.lines.isEmpty {
                NPZDivider()
                NPZInfoRow(label: "レシピ原価", value: NPZ.yen(p.recipeCost), tone: NT.purpleDeep)
            }
        }
    }
}

// MARK: - 食材の追加・編集（Web の RecipeLineForm と同じ）

struct NPZCoLineSheet: View {
    @ObservedObject var model: NPZCoItemModel
    let payload: NPZCoItemPayload
    let line: NPZCoLine?
    let onClose: () -> Void

    @State private var ingredientId = ""
    @State private var quantity = ""
    @State private var note = ""
    @State private var error: String?
    @State private var picking = false
    @State private var confirmDelete = false
    @State private var loaded = false

    private var option: NPZCoOption? { payload.ingredientOptions.first(where: { $0.id == ingredientId }) }

    /// 選んだ食材の単位・単価（選択肢に無い＝別の店の品目なら、今の行の値）
    private var unit: String { option?.unit ?? line?.unit ?? "" }
    private var avgCost: Double? { option?.avgCost ?? (ingredientId == line?.inventoryItemId ? line?.avgCost : nil) }

    var body: some View {
        NPOCSheetFrame(title: line == nil ? "食材を追加" : "食材を編集", confirmText: model.busy ? "保存中…" : (line == nil ? "追加する" : "更新する"), busy: model.busy,
                       onCancel: onClose, onConfirm: { Task { await save() } }) {
            Text(payload.item.name).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink2)
            NPZPickButton(label: "食材", value: option?.name ?? (ingredientId == line?.inventoryItemId ? line?.ingredientName : nil), placeholder: "食材を選ぶ") { picking = true }
            NPZTextField(label: "使用量（在庫単位）", text: $quantity, placeholder: "例：120", number: true, suffix: unit)
            NPOCField(label: "メモ（任意）") {
                TextField("例：下味用", text: $note).font(.system(size: 16)).npocInputBox()
            }
            previewCard
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            }
            if line != nil {
                NPOCWideButton(text: "この食材をレシピから外す", icon: "trash", kind: .secondary, disabled: model.busy) { confirmDelete = true }
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let l = line {
                ingredientId = l.inventoryItemId
                quantity = NPZ.q(l.quantity)
                note = l.note ?? ""
            }
        }
        .sheet(isPresented: $picking) {
            NPZPickSheet(title: "食材を選ぶ", options: payload.ingredientOptions.map { o in
                NPZPickOption(id: o.id, title: o.name, sub: "単位 \(o.unit)・平均単価 \(o.avgCost.map { NPZ.q($0) + "円" } ?? "未設定")")
            }, selected: ingredientId, onPick: { id in
                ingredientId = id
                picking = false
            }, onClose: { picking = false })
        }
        .confirmationDialog("「\(line?.ingredientName ?? "")」をレシピから外しますか？", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("外す", role: .destructive) {
                Task {
                    guard let l = line else { return }
                    if let e = await model.delete(l) { error = e } else { onClose() }
                }
            }
            Button("やめる", role: .cancel) {}
        }
    }

    /// 入れている間の計算（保存後のレシピ原価・原価率・粗利益）
    private var previewCard: some View {
        let q = NPZ.num(quantity)
        let added: (Double, Double?)? = (q ?? 0) > 0 && !ingredientId.isEmpty ? ((q ?? 0), avgCost) : nil
        let pv = NPZCoPreview.make(lines: payload.lines, replacing: line?.id, added: added, price: payload.item.price, manualCost: payload.item.manualCost)
        return NPOCard(title: "保存すると") {
            NPZInfoRow(label: "この食材の原価", value: added == nil ? "—" : (pv.lineCost.map { NPZ.yen($0) } ?? "単価なし"))
            NPZInfoRow(label: "レシピ原価", value: NPZ.yen(pv.recipeCost))
            HStack(alignment: .firstTextBaseline) {
                Text("原価率").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                Spacer()
                Text(NPZCoMath.pct(pv.rate)).font(.system(size: 22, weight: NT.strong)).foregroundColor(NPZCoMath.tone(pv.rate)).monospacedDigit()
            }
            NPZInfoRow(label: "粗利益", value: NPZ.yen(pv.profit))
            if pv.missing > 0 {
                Text("単価の無い食材 \(pv.missing) 件は原価に入りません").font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.warn)
            }
        }
    }

    private func save() async {
        error = nil
        guard !ingredientId.isEmpty else { error = "食材を選択してください"; return }
        guard let q = NPZ.num(quantity), q > 0 else { error = "使用量は0より大きい値で入力してください"; return }
        if let e = await model.save(line: line, inventoryItemId: ingredientId, quantity: q, note: NPZ.trimmed(note)) {
            error = e
        } else {
            onClose()
        }
    }
}
