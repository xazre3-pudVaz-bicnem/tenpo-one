import SwiftUI

// iPhone の店長・オーナー：発注書の作成・入荷登録（検品）（2026-10-25 Ronnie「iPhone も native に」）
//   作成（Web の /app/purchases/new・PoForm と同じ）：仕入先・入荷予定日・メモ・明細（品目を選ぶか自由入力・数量・単位・単価・税率）
//     在庫の「要発注」「発注提案」から来たら ?item= ?items=id:数量、仕入先から来たら ?vendor= を最初から入れる
//   入荷登録（Web の ReceiveForm と同じ）：明細ごとに今回の入荷数（大きい − ＋・残り全部）・単価（変えられる）・変換の見本
// サーバーは iPad と同じ：GET part=poNew ／ POST poCreate・poReceive

/// GET ?part=poNew
struct NPZPoItemOption: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let avgCost: Double?
    let purchaseUnit: String?

    /// 発注・単価は仕入単位あたり（仕入単位があればそれ。Web と同じ）
    var orderUnit: String { (purchaseUnit ?? "").isEmpty ? unit : (purchaseUnit ?? unit) }
}

struct NPZPoNewPayload: Decodable {
    let store: NPZNamed
    let vendors: [NPZNamed]
    let items: [NPZPoItemOption]
}

// MARK: - 発注書を作成

struct NPZPoNewSheet: View {
    let start: NPZPoNewRef
    let onClose: () -> Void
    let onCreated: (String) -> Void
    /// 見本（-tenpoNativePreview）の中身
    var sample: NPZPoNewPayload? = nil

    struct Line: Identifiable, Equatable {
        let id = UUID()
        var itemId = ""
        var name = ""
        var qty = "1"
        var unit = "個"
        var cost = "0"
        var tax = "10"
    }

    enum PickTarget: Identifiable, Hashable {
        case vendor
        case item(UUID)

        var id: String {
            switch self {
            case .vendor: return "vendor"
            case .item(let u): return u.uuidString
            }
        }
    }

    @State private var data: NPZPoNewPayload?
    @State private var loadError: String?
    @State private var vendorId = ""
    @State private var expectedAt = ""
    @State private var note = ""
    @State private var lines: [Line] = []
    @State private var picking: PickTarget?
    @State private var busy = false
    @State private var error: String?
    @State private var started = false

    var body: some View {
        NPOCSheetFrame(title: "発注書を作成", confirmText: busy ? "作成中…" : "作成する", busy: busy, onCancel: onClose, onConfirm: { Task { await create() } }) {
            if let d = data {
                form(d)
            } else if let e = loadError {
                VStack(spacing: 12) {
                    Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                    NPOCWideButton(text: "もう一度", kind: .secondary) {
                        started = false
                        loadError = nil
                        Task { await load() }
                    }
                }
                .padding(.top, 30)
            } else {
                ProgressView("読み込み中…").tint(NT.purple).frame(maxWidth: .infinity).padding(.top, 40)
            }
        }
        .task { await load() }
        .sheet(item: $picking) { t in pickSheet(t) }
    }

    // MARK: 入力

    @ViewBuilder private func form(_ d: NPZPoNewPayload) -> some View {
        Text("店舗：\(d.store.name)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
        NPZPickButton(label: "仕入先（必須）", value: d.vendors.first(where: { $0.id == vendorId })?.name,
                      placeholder: d.vendors.isEmpty ? "取引中の仕入先がありません" : "選んでください") { picking = .vendor }
        NPZDateField(label: "入荷予定日（任意）", value: $expectedAt)
        NPZTextField(label: "メモ（任意）", text: $note)
        NPOCSectionTitle(title: "明細", note: "単価は仕入単位あたり・税抜。品目を選ぶと入荷時に在庫へ反映されます")
        ForEach($lines) { $l in lineCard($l, items: d.items) }
        Button { lines.append(Line()) } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus.circle.fill").font(.system(size: 16, weight: .bold))
                Text("明細を追加").font(.system(size: 15, weight: .heavy))
            }
            .foregroundColor(NT.purpleDeep).frame(maxWidth: .infinity).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
        totals
        if let error {
            Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
        }
        Text("作成すると「下書き」になります。申請・承認・発注確定は発注書の画面で。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
    }

    private func lineCard(_ l: Binding<Line>, items: [NPZPoItemOption]) -> some View {
        let line = l.wrappedValue
        let sel = items.first(where: { $0.id == line.itemId })
        let index = (lines.firstIndex(where: { $0.id == line.id }) ?? 0) + 1
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("明細 \(index)").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3)
                Spacer()
                Button {
                    lines.removeAll { $0.id == line.id }
                } label: {
                    Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(lines.count <= 1 ? NT.ink3 : NT.danger)
                        .frame(width: 40, height: 32)
                }
                .buttonStyle(.plain)
                .disabled(lines.count <= 1)
            }
            NPZPickButton(label: "品目", value: sel?.name ?? (line.itemId.isEmpty ? "自由入力" : nil)) { picking = .item(line.id) }
            if line.itemId.isEmpty {
                NPZTextField(label: "品目名", text: l.name, placeholder: "例：玉ねぎ")
            }
            HStack(alignment: .top, spacing: 10) {
                NPZTextField(label: "数量", text: l.qty, number: true)
                NPZTextField(label: "単位", text: l.unit).frame(width: 96)
            }
            HStack(alignment: .bottom, spacing: 10) {
                NPZTextField(label: "単価（税抜）", text: l.cost, number: true, suffix: "円")
                NPOCField(label: "税率") {
                    NOSSegment(items: [(key: "10", label: "10%"), (key: "8", label: "8%")], selection: line.tax) { l.wrappedValue.tax = $0 }
                }
                .frame(width: 130)
            }
            HStack {
                Spacer()
                Text("小計 \(NPZ.yen(sub(line)))（税 \(NPZ.yen(tax(line)))）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
            }
        }
        .padding(12)
        .background(npocCard(14))
    }

    private var totals: some View {
        let s = lines.reduce(0.0) { $0 + sub($1) }
        let t = lines.reduce(0.0) { $0 + tax($1) }
        return NPOCard {
            NPZInfoRow(label: "小計（税抜）", value: NPZ.yen(s))
            NPZInfoRow(label: "消費税", value: NPZ.yen(t))
            NPZDivider()
            HStack(alignment: .firstTextBaseline) {
                Text("合計（税込）").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text(NPZ.yen(s + t)).font(.system(size: 24, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
        }
    }

    /// 明細の税抜金額（Web と同じ：数量 × 単価（円に丸め）を四捨五入）
    private func sub(_ l: Line) -> Double { ((NPZ.num(l.qty) ?? 0) * (NPZ.num(l.cost) ?? 0).rounded()).rounded() }
    private func tax(_ l: Line) -> Double { (sub(l) * (NPZ.num(l.tax) ?? 0) / 100).rounded() }

    // MARK: 選ぶ

    @ViewBuilder private func pickSheet(_ t: PickTarget) -> some View {
        if let d = data {
            switch t {
            case .vendor:
                NPZPickSheet(title: "仕入先を選ぶ", options: d.vendors.map { NPZPickOption(id: $0.id, title: $0.name) }, selected: vendorId, onPick: { id in
                    vendorId = id
                    picking = nil
                }, onClose: { picking = nil })
            case .item(let lineId):
                NPZPickSheet(title: "品目を選ぶ", options: itemOptions(d.items), selected: lines.first(where: { $0.id == lineId })?.itemId, onPick: { id in
                    applyItem(lineId, id, d.items)
                    picking = nil
                }, onClose: { picking = nil })
            }
        }
    }

    private func itemOptions(_ items: [NPZPoItemOption]) -> [NPZPickOption] {
        [NPZPickOption(id: "", title: "自由入力（在庫に連動しない）")] + items.map { it in
            NPZPickOption(id: it.id, title: it.name, sub: "単位 \(it.orderUnit)・平均単価 \(NPZ.yen(it.avgCost))")
        }
    }

    private func applyItem(_ lineId: UUID, _ itemId: String, _ items: [NPZPoItemOption]) {
        guard let i = lines.firstIndex(where: { $0.id == lineId }) else { return }
        lines[i].itemId = itemId
        guard let it = items.first(where: { $0.id == itemId }) else { return }
        lines[i].name = it.name
        lines[i].unit = it.orderUnit
        if let c = it.avgCost { lines[i].cost = NPZ.q(c) }
    }

    // MARK: 読み込み・作成

    private func load() async {
        guard !started else { return }
        started = true
        if let s = sample {
            apply(s)
            return
        }
        if data == nil, let saved = NPZApi.cached(NPZPoNewPayload.self, "poNew") { apply(saved) }
        do {
            let d = try await NPZApi.get(NPZPoNewPayload.self, "poNew")
            if data == nil { apply(d) } else { data = d }
        } catch {
            if data == nil { loadError = NPZApi.message(error) }
        }
    }

    private func apply(_ d: NPZPoNewPayload) {
        data = d
        lines = startLines(d.items)
        if let v = start.vendor, d.vendors.contains(where: { $0.id == v }) { vendorId = v }
    }

    /// 発注提案（?items=id:数量,…）や要発注（?item=）から引き継ぐ。仕入単位・平均単価を入れる（Web と同じ）
    private func startLines(_ items: [NPZPoItemOption]) -> [Line] {
        func make(_ it: NPZPoItemOption, _ qty: Double) -> Line {
            var l = Line()
            l.itemId = it.id
            l.name = it.name
            l.qty = NPZ.q(qty)
            l.unit = it.orderUnit
            l.cost = it.avgCost.map { NPZ.q($0) } ?? "0"
            return l
        }
        var built: [Line] = []
        for x in start.items {
            if let it = items.first(where: { $0.id == x.0 }) { built.append(make(it, x.1)) }
        }
        if !built.isEmpty { return built }
        if let id = start.item, let it = items.first(where: { $0.id == id }) { return [make(it, 1)] }
        return [Line()]
    }

    private func create() async {
        error = nil
        guard !vendorId.isEmpty else { error = "仕入先を選択してください"; return }
        let valid = lines.filter { !NPZ.trimmed($0.name).isEmpty && (NPZ.num($0.qty) ?? 0) > 0 }
        guard !valid.isEmpty else { error = "明細を1件以上入力してください（品目名と数量）"; return }
        for l in valid where (NPZ.num(l.cost) ?? -1) < 0 {
            error = "「\(NPZ.trimmed(l.name))」の単価を正しく入力してください"
            return
        }
        var payloadLines: [[String: Any]] = []
        for l in valid {
            let u = NPZ.trimmed(l.unit)
            payloadLines.append([
                "inventoryItemId": l.itemId.isEmpty ? (NSNull() as Any) : (l.itemId as Any),
                "name": NPZ.trimmed(l.name),
                "quantity": NPZ.num(l.qty) ?? 0,
                "unit": u.isEmpty ? "個" : u,
                "unitCost": (NPZ.num(l.cost) ?? 0).rounded(),
                "taxRate": l.tax == "8" ? 8 : 10,
            ])
        }
        let body: [String: Any] = [
            "type": "poCreate",
            "vendorId": vendorId,
            "expectedAt": expectedAt.isEmpty ? (NSNull() as Any) : (expectedAt as Any),
            "note": note,
            "lines": payloadLines,
        ]
        busy = true
        defer { busy = false }
        let r = await NPZApi.post(body)
        if r.ok, let id = r.id {
            onCreated(id)
        } else if r.ok {
            onClose()
        } else {
            error = r.error ?? "作成に失敗しました"
        }
    }
}

// MARK: - 入荷登録（検品）

struct NPZPoReceiveSheet: View {
    let po: NPZPo
    let busy: Bool
    let onClose: () -> Void
    /// 入荷（itemId・quantity・unitCost）を送る。nil＝できた、字＝エラー
    let send: ([[String: Any]]) async -> String?

    @State private var qty: [String: Double] = [:]
    @State private var cost: [String: String] = [:]
    @State private var editing: NPZPoItem?
    @State private var error: String?

    private var openItems: [NPZPoItem] { po.items.filter { $0.remaining > 0 } }
    private var count: Int { qty.values.filter { $0 > 0 }.count }

    var body: some View {
        NPOCSheetFrame(title: "入荷登録", confirmText: busy ? "登録中…" : "登録する（\(count)品）", busy: busy, onCancel: onClose, onConfirm: { Task { await save() } }) {
            HStack(alignment: .firstTextBaseline) {
                Text("発注書 #\(po.poNo)・\(po.vendorName)").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                Spacer()
            }
            if !openItems.isEmpty {
                NPOCWideButton(text: "残りを全部入れる（全量入荷）", icon: "checkmark.circle", kind: .secondary, height: 46) {
                    for i in openItems { qty[i.id] = i.remaining }
                }
            }
            ForEach(po.items) { i in card(i) }
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            }
            Text("届いた数を入れて「登録する」。在庫に連動する明細は在庫数と平均仕入単価が更新されます。全部入荷すると「入荷済み」になります。")
                .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
        .onAppear {
            if cost.isEmpty { for i in po.items { cost[i.id] = NPZ.q(i.unitCost) } }
        }
        .sheet(item: $editing) { i in
            NPZNumberSheet(title: i.name, caption: "残り \(NPZ.q(i.remaining))\(i.unit)", unit: i.unit, initial: qty[i.id], decimal: true,
                           shortcuts: [("残り全部", i.remaining)], okLabel: "決定",
                           onDone: { v in
                               qty[i.id] = min(i.remaining, max(0, v ?? 0))
                               editing = nil
                           },
                           onCancel: { editing = nil })
                .presentationDetents([.large])
        }
    }

    private func card(_ i: NPZPoItem) -> some View {
        let q = qty[i.id] ?? 0
        let c = NPZ.num(cost[i.id] ?? "")
        let done = i.remaining <= 0
        return VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(i.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2)
                Spacer(minLength: 6)
                if done { NOSBadge(text: "入荷済み", color: NT.ok) }
            }
            Text("発注 \(NPZ.q(i.quantity))\(i.unit)／入荷済み \(NPZ.q(i.receivedQuantity))\(i.unit)／残り \(NPZ.q(i.remaining))\(i.unit)")
                .font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
            if !done {
                HStack(spacing: 8) {
                    NPZBigStepper(value: NPZ.q(q), unit: i.unit, placeholder: q == 0, tint: q >= i.remaining ? NT.ok : NT.ink,
                                  minusEnabled: q > 0, plusEnabled: q < i.remaining,
                                  onMinus: { qty[i.id] = max(0, q - 1) },
                                  onPlus: { qty[i.id] = min(i.remaining, q + 1) },
                                  onTap: { editing = i })
                    Button { qty[i.id] = i.remaining } label: {
                        VStack(spacing: 1) {
                            Image(systemName: "checkmark").font(.system(size: 15, weight: .heavy))
                            Text("残り全部").font(.system(size: 9.5, weight: .heavy))
                        }
                        .foregroundColor(q >= i.remaining ? .white : NT.ok)
                        .frame(width: 58, height: 52)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(q >= i.remaining ? NT.ok : NT.ok.opacity(0.12)))
                    }
                    .buttonStyle(PressableStyle())
                }
                NPZTextField(label: "単価（円/\(i.unit)・変えられる）", text: Binding(get: { cost[i.id] ?? "" }, set: { cost[i.id] = $0 }), number: true, suffix: "円")
                if i.conv != 1, q > 0, let c, c >= 0 {
                    let su = i.stockUnit ?? i.unit
                    VStack(alignment: .leading, spacing: 3) {
                        Text("在庫へ：\(NPZ.q(q))\(i.unit) → \(NPZ.q(q * i.conv))\(su)／\(NPZ.yen(c))/\(i.unit) → \(NPZ.yen((c / i.conv).rounded()))/\(su)")
                            .font(.system(size: 12)).foregroundColor(NT.ink2)
                        if NPZInv.costRisk(c, i.conv) {
                            Text("変換後の在庫単価の丸め誤差が大きくなります").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.warn)
                        }
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.lilac))
                }
            }
        }
        .padding(12)
        .background(npocCard(14))
        .opacity(done ? 0.7 : 1)
    }

    private func save() async {
        error = nil
        var receipts: [[String: Any]] = []
        for i in po.items {
            guard let q = qty[i.id], q > 0 else { continue }
            guard let c = NPZ.num(cost[i.id] ?? ""), c >= 0 else {
                error = "「\(i.name)」の単価を正しく入力してください"
                return
            }
            if q > i.remaining + 0.0001 {
                error = "「\(i.name)」の入荷数量が残りを超えています"
                return
            }
            receipts.append(["itemId": i.id, "quantity": q, "unitCost": c])
        }
        guard !receipts.isEmpty else { error = "入荷数量を入力してください"; return }
        if let e = await send(receipts) { error = e } else { onClose() }
    }
}
