import SwiftUI

// iPhone の店長・オーナー：在庫の店舗間移動の申請・即時移動・取消（Web の /app/inventory?tab=transfers の RequestTransferForm・TransferForm・
// 取消と同じ。2026-10-25 Ronnie「101% native」）。前は「Web の画面で」（?tab=transfers&web=1）だったもの。
// サーバーは iPad と同じ POST invTransferRequest（toStoreId・note・lines）・invTransferDirect（fromItemId・toStoreId・quantity・reason）・
// invTransferCancel（id・reason）。品目の選択肢は GET part=inventory&tab=transfers の transferItems（iPad と同じ）

/// 移動できる品目（transferItems の 1 つ）
struct NPZInvTransferItem: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let unit: String
    let currentQuantity: Double
}

/// 移動のタブの下：申請・即時移動のボタン（移動先の店舗が無いときは出さない）
struct NPZTransferActions: View {
    @ObservedObject var model: NPZInventoryModel
    let p: NPZInvPayload
    @State private var open: Mode?

    enum Mode: String, Identifiable { case request, direct; var id: String { rawValue } }

    var body: some View {
        let stores = p.otherStores ?? []
        return Group {
            if p.canTransfer && !stores.isEmpty {
                HStack(spacing: 8) {
                    NPOCWideButton(text: "移動を申請", icon: "arrow.left.arrow.right", kind: .primary, height: 46) { open = .request }
                    NPOCWideButton(text: "即時移動", icon: "bolt.horizontal", kind: .secondary, height: 46) { open = .direct }
                }
                Text("申請：相手の店が「受け取る」まで記録が続きます。即時移動：発送と受取を同時に記録します（承認や追跡が要らないとき）")
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
            }
        }
        .sheet(item: $open) { m in
            NPZTransferSheet(model: model, mode: m, stores: stores, items: p.transferItems ?? [], onClose: { open = nil })
                .presentationDetents([.large])
        }
    }
}

/// 店舗間移動の申請・即時移動のシート
struct NPZTransferSheet: View {
    @ObservedObject var model: NPZInventoryModel
    let mode: NPZTransferActions.Mode
    let stores: [NPZNamed]
    let items: [NPZInvTransferItem]
    let onClose: () -> Void

    struct Line: Identifiable { let id = UUID(); var itemId = ""; var qty = "1" }
    @State private var toStore = ""
    @State private var note = ""
    @State private var lines = [Line()]
    @State private var picking: UUID?
    @State private var error: String?
    @State private var confirm = false

    private var isDirect: Bool { mode == .direct }

    var body: some View {
        NPOCSheetFrame(title: isDirect ? "即時移動" : "店舗間移動を申請", confirmText: isDirect ? "移動する" : "申請する", busy: model.busy, onCancel: onClose, onConfirm: {
            if let e = check() { error = e; return }
            confirm = true
        }) {
            if isDirect {
                NOMNote(text: "発送と受取を同時に記録します。承認や追跡が必要な移動は「移動を申請」を使ってください。")
            }
            NPOCField(label: "移動先店舗") { NPSChoice(options: stores.map { ($0.id, $0.name) }, selection: toStore) { toStore = $0 } }
            if isDirect {
                lineRow($lines[0], removable: false)
                NPSInput(label: "理由（任意）", text: $note, placeholder: "例：応援・欠品の補充")
            } else {
                NPSInput(label: "メモ（任意）", text: $note, placeholder: "例：週末の仕込み分")
                HStack {
                    Text("品目").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                    Spacer()
                    Button { lines.append(Line()) } label: { Label("行を追加", systemImage: "plus").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep) }
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, 4)
                ForEach($lines) { $l in lineRow($l, removable: lines.count > 1) }
            }
            if let error { Text(error).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
        }
        .sheet(item: Binding(get: { picking.map { NPZPickRef(id: $0) } }, set: { picking = $0?.id })) { ref in
            NPZPickSheet(title: "品目を選ぶ", options: items.map { NPZPickOption(id: $0.id, title: $0.name, sub: "現在庫 \(NPZ.q($0.currentQuantity))\($0.unit)") },
                         selected: lines.first { $0.id == ref.id }?.itemId, onPick: { id in
                             if let i = lines.firstIndex(where: { $0.id == ref.id }) { lines[i].itemId = id }
                             picking = nil
                         }, onClose: { picking = nil })
        }
        .confirmationDialog(isDirect ? "在庫を移動しますか？" : "移動を申請しますか？", isPresented: $confirm, titleVisibility: .visible) {
            Button(isDirect ? "移動する" : "申請する") { Task { await save() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("\(stores.first { $0.id == toStore }?.name ?? "") へ \(validLines.count)品目")
        }
    }

    private func lineRow(_ l: Binding<Line>, removable: Bool) -> some View {
        let sel = items.first { $0.id == l.wrappedValue.itemId }
        return HStack(alignment: .bottom, spacing: 8) {
            NPZPickButton(label: "品目", value: sel.map { "\($0.name)（\(NPZ.q($0.currentQuantity))\($0.unit)）" }, placeholder: "選んでください") { picking = l.wrappedValue.id }
            NPSInput(label: "数量" + (sel.map { "（\($0.unit)）" } ?? ""), text: l.qty, placeholder: "1", keyboard: .decimalPad)
                .frame(width: 104)
            if removable {
                Button { lines.removeAll { $0.id == l.wrappedValue.id } } label: {
                    Image(systemName: "trash").foregroundColor(NT.danger).frame(width: 34, height: 46)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var validLines: [(String, Double)] {
        lines.compactMap { l in
            guard !l.itemId.isEmpty, let q = NPZ.num(l.qty), q > 0 else { return nil }
            return (l.itemId, q)
        }
    }

    private func check() -> String? {
        if toStore.isEmpty { return "移動先店舗を選択してください" }
        if validLines.isEmpty { return isDirect ? "品目と数量を入れてください" : "品目を1件以上選択してください" }
        if isDirect, let first = validLines.first, let it = items.first(where: { $0.id == first.0 }), first.1 > it.currentQuantity {
            return "現在庫を超える数量は移動できません"
        }
        return nil
    }

    private func save() async {
        error = nil
        let r: NPZResult
        if isDirect {
            guard let first = validLines.first else { return }
            r = await model.act(["type": "invTransferDirect", "fromItemId": first.0, "toStoreId": toStore, "quantity": first.1, "reason": NPZ.trimmed(note)])
        } else {
            r = await model.act(["type": "invTransferRequest", "toStoreId": toStore, "note": NPZ.trimmed(note),
                                 "lines": validLines.map { ["inventoryItemId": $0.0, "quantity": $0.1] as [String: Any] }])
        }
        if r.ok {
            model.toast = isDirect ? "店舗間移動を登録しました" : "移動を申請しました"
            onClose()
            await model.refresh()
        } else {
            error = r.error ?? (isDirect ? "移動の登録に失敗しました" : "申請に失敗しました")
        }
    }
}

/// 品目を選ぶシートの行 id（UUID を Identifiable に）
struct NPZPickRef: Identifiable { let id: UUID }

/// 申請中の移動の取消（理由は必須。Web と同じ）
struct NPZTransferCancelButton: View {
    @ObservedObject var model: NPZInventoryModel
    let row: NPZInvTransfer
    @State private var open = false

    var body: some View {
        NPOCWideButton(text: "取消", icon: "xmark.circle", kind: .secondary, busy: model.busy, height: 44) { open = true }
            .sheet(isPresented: $open) {
                NPZReasonSheet(title: "移動を取消", message: "#\(row.transferNo)（\(row.fromStoreName) → \(row.toStoreName)）を取消します。",
                               okText: "取消する", busy: model.busy, send: { reason in
                                   let r = await model.act(["type": "invTransferCancel", "id": row.id, "reason": reason])
                                   guard r.ok else { return r.error ?? "取消に失敗しました" }
                                   model.toast = "移動を取消しました"
                                   await model.refresh()
                                   return nil
                               }, onClose: { open = false })
            }
    }
}
