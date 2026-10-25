import SwiftUI

// iPhone の店長・オーナー：在庫の「移動」「発注提案」「予測」タブ（Web の /app/inventory?tab=transfers|reorder|forecast。2026-10-25）
//   移動：一覧（番号・状態・From→To・品目）・発送・受取（確認あり）・申請・即時移動・取消（NativePhoneOwnerTransfers.swift）
//   発注提案：推奨発注数・根拠。選んだ品目で発注書を作る（ネイティブの「発注」へ ?items=id:数量）。自動では発注しない
//   予測：品目を選ぶと明日・今週残り・来週の見込みと曜日別の平均。売れ筋上位10品目の明日見込み

// MARK: - 移動

struct NPZTransfersList: View {
    @ObservedObject var model: NPZInventoryModel
    let p: NPZInvPayload
    let onOpen: (String) -> Void

    @State private var expanded = Set<String>()
    @State private var confirm: Pending?

    struct Pending: Identifiable {
        let row: NPZInvTransfer
        let ship: Bool
        var id: String { row.id + (ship ? "-ship" : "-receive") }
    }

    var body: some View {
        let rows = p.transfers ?? []
        return VStack(alignment: .leading, spacing: 10) {
            if rows.isEmpty {
                NPOCEmpty(icon: "arrow.left.arrow.right", title: "店舗間移動の記録がありません")
            } else {
                ForEach(rows) { r in card(r) }
            }
            // 移動の申請・即時移動・取消もネイティブで（NativePhoneOwnerTransfers.swift。2026-10-25「101% native」）
            NPZTransferActions(model: model, p: p)
        }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { c in
            Button(c.ship ? "発送する" : "受け取る") { Task { await run(c) } }
            Button("やめる", role: .cancel) {}
        } message: { c in
            Text(c.ship ? "在庫から \(c.row.items.count)品目を減らして、\(c.row.toStoreName) へ発送済みにします。" : "\(c.row.fromStoreName) から届いた \(c.row.items.count)品目を在庫に足します。")
        }
    }

    private var confirmTitle: String {
        guard let c = confirm else { return "" }
        return "#\(c.row.transferNo) を\(c.ship ? "発送" : "受取")しますか？"
    }

    private func card(_ r: NPZInvTransfer) -> some View {
        let st = NPZInv.transferStatus(r.status)
        let isFrom = r.fromStoreId == p.store.id
        let isTo = r.toStoreId == p.store.id
        let canShip = isFrom && r.status == "requested" && p.canTransfer
        let canReceive = isTo && r.status == "shipped" && p.canTransfer
        let open = expanded.contains(r.id)
        return VStack(alignment: .leading, spacing: 9) {
            Button {
                if open { expanded.remove(r.id) } else { expanded.insert(r.id) }
            } label: {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 8) {
                        Text("#\(r.transferNo)").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                        NOSBadge(text: st.0, color: st.1)
                        Spacer(minLength: 4)
                        Text(NPZ.dateTime(r.createdAt)).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                    }
                    HStack(spacing: 6) {
                        Text(r.fromStoreName).font(.system(size: 14.5, weight: .bold)).foregroundColor(isFrom ? NT.purpleDeep : NT.ink).lineLimit(1)
                        Image(systemName: "arrow.right").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink3)
                        Text(r.toStoreName).font(.system(size: 14.5, weight: .bold)).foregroundColor(isTo ? NT.purpleDeep : NT.ink).lineLimit(1)
                        Spacer(minLength: 4)
                        Text("\(r.items.count)品目").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(r.items) { it in
                        HStack {
                            Text(it.name).font(.system(size: 14)).foregroundColor(NT.ink)
                            Spacer()
                            Text(NPZ.q(it.quantity) + it.unit).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                        }
                    }
                    if let n = r.note, !n.isEmpty { Text("メモ：\(n)").font(.system(size: 12)).foregroundColor(NT.ink3) }
                    Text("申請 \(r.requestedByName ?? "—")／発送 \(r.shippedByName ?? "—")／受取 \(r.receivedByName ?? "—")")
                        .font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            }
            if canShip {
                NPOCWideButton(text: "発送する", icon: "shippingbox", kind: .primary, busy: model.busy, height: 46) { confirm = Pending(row: r, ship: true) }
            }
            if canReceive {
                NPOCWideButton(text: "受け取る", icon: "tray.and.arrow.down", kind: .success, busy: model.busy, height: 46) { confirm = Pending(row: r, ship: false) }
            }
            if isFrom && r.status == "requested" && p.canTransfer {
                NPZTransferCancelButton(model: model, row: r)
            }
        }
        .padding(12)
        .background(npocCard(14))
    }

    private func run(_ c: Pending) async {
        let res = await model.act(["type": c.ship ? "invTransferShip" : "invTransferReceive", "id": c.row.id])
        if res.ok {
            model.toast = c.ship ? "発送を登録しました" : "受取を登録しました"
            await model.refresh()
        } else {
            model.error = res.error ?? (c.ship ? "発送の登録に失敗しました" : "受取の登録に失敗しました")
        }
    }
}

// MARK: - 発注提案

struct NPZReorderList: View {
    let rows: [NPZInvReorder]
    let onOpen: (String) -> Void
    /// 選んだ品目（nil の間は「要発注」の品目）
    @State private var checked: Set<String>?

    private var sorted: [NPZInvReorder] {
        rows.sorted { a, b in
            if a.needed != b.needed { return a.needed && !b.needed }
            if a.suggestedQuantity != b.suggestedQuantity { return a.suggestedQuantity > b.suggestedQuantity }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    var body: some View {
        let ck = checked ?? Set(rows.filter(\.needed).map(\.id))
        let list = sorted
        let selected = list.filter { ck.contains($0.id) && $0.suggestedQuantity > 0 }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "info.circle").font(.system(size: 13, weight: .bold))
                Text("自動では発注しません。内容を見てから発注書を作ってください（過去30日の販売・入荷待ち・リードタイム3日）")
                    .font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundColor(NT.ink2)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
            if rows.isEmpty {
                NPOCEmpty(icon: "cart", title: "対象の品目がありません", note: "在庫品目を登録すると発注提案が出ます")
            } else {
                ForEach(list) { r in
                    Button {
                        var s = ck
                        if s.contains(r.id) { s.remove(r.id) } else { s.insert(r.id) }
                        checked = s
                    } label: { row(r, on: ck.contains(r.id)) }
                        .buttonStyle(PressableStyle(scale: 0.985))
                }
                NPOCWideButton(text: "選んだ \(selected.count)品目で発注書を作成", icon: "doc.badge.plus", kind: .primary, disabled: selected.isEmpty) {
                    onOpen(NPZInventoryModel.newPoPath(items: selected.map { ($0.id, $0.suggestedQuantity) }))
                }
            }
        }
    }

    private func row(_ r: NPZInvReorder, on: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.system(size: 24)).foregroundColor(on ? NT.purple : NT.ink3)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(r.name).font(.system(size: 15.5, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                    if r.needed { NOSBadge(text: "要発注", color: NT.warn) }
                    Spacer(minLength: 4)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("推奨").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
                        Text(NPZ.q(r.suggestedQuantity) + r.unit).font(.system(size: 18, weight: .heavy)).foregroundColor(r.suggestedQuantity > 0 ? NT.purpleDeep : NT.ink3).monospacedDigit()
                    }
                }
                HStack(spacing: 10) {
                    Text("現在庫 \(NPZ.q(r.currentQuantity))\(r.unit)")
                    Text("日販 \(NPZ.q(r.avgDailySales))")
                    if r.incomingQuantity > 0 { Text("入荷待ち \(NPZ.q(r.incomingQuantity))") }
                }
                .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                if let b = r.basis, !b.isEmpty {
                    Text(b).font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard(14))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(on ? NT.purple.opacity(0.5) : Color.clear, lineWidth: 1.5))
    }
}

// MARK: - 予測

struct NPZForecastView: View {
    @ObservedObject var model: NPZInventoryModel
    let f: NPZInvForecast?
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NPZPickButton(label: "品目", value: f?.itemOptions.first(where: { $0.id == model.forecastItem })?.name, placeholder: "品目を選ぶ") { picking = true }
            if let f, let r = f.result {
                if r.lowConfidence {
                    Text("データが少ないため参考値です").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.warn)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.warn.opacity(0.1)))
                }
                HStack(spacing: 8) {
                    NPZTile(label: "明日", value: NPZ.q(r.tomorrow) + f.unit, tone: NT.purpleDeep)
                    NPZTile(label: "今週の残り", value: NPZ.q(r.thisWeekRemaining) + f.unit)
                    NPZTile(label: "来週", value: NPZ.q(r.nextWeek) + f.unit)
                }
                weekdayChart(f)
            } else {
                NPOCEmpty(icon: "chart.bar.xaxis", title: "品目を選んでください", note: "過去8週間の販売から使用量を予測します")
            }
            NPOCSectionTitle(title: "売れ筋上位10品目の明日見込み")
            if (f?.top ?? []).isEmpty {
                NPOCEmpty(icon: "chart.line.uptrend.xyaxis", title: "販売実績がありません", note: "過去8週間の販売実績がたまると出ます")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array((f?.top ?? []).enumerated()), id: \.offset) { i, t in
                        Button { select(t.id) } label: {
                            HStack(spacing: 10) {
                                Text("\(i + 1)").font(.system(size: 11, weight: .heavy)).foregroundColor(i < 3 ? .white : NT.ink3)
                                    .frame(width: 22, height: 22).background(Circle().fill(i < 3 ? NT.purple : NT.page))
                                Text(t.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                                Spacer()
                                Text(NPZ.q(t.tomorrow) + t.unit).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                            }
                            .padding(.horizontal, 14).frame(minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if i < (f?.top.count ?? 0) - 1 { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
        }
        .sheet(isPresented: $picking) {
            NPZPickSheet(title: "品目を選ぶ", options: (f?.itemOptions ?? []).map { NPZPickOption(id: $0.id, title: $0.name) }, selected: model.forecastItem, onPick: { id in
                picking = false
                select(id)
            }, onClose: { picking = false })
        }
    }

    private func select(_ id: String) {
        model.forecastItem = id
        Task { await model.refresh() }
    }

    /// 曜日別の平均使用量（棒）
    private func weekdayChart(_ f: NPZInvForecast) -> some View {
        let maxV = max(f.weekdayChart.map(\.avg).max() ?? 0, 0.0001)
        return VStack(alignment: .leading, spacing: 10) {
            NPZCardHead(title: "\(f.selectedName)：曜日別の平均", trailing: "単位 \(f.unit)")
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(f.weekdayChart, id: \.weekday) { w in
                    VStack(spacing: 5) {
                        Text(NPZ.q((w.avg * 10).rounded() / 10)).font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
                            .lineLimit(1).minimumScaleFactor(0.6)
                        RoundedRectangle(cornerRadius: 5, style: .continuous).fill(NT.purple.opacity(0.85))
                            .frame(height: max(4, CGFloat(w.avg / maxV) * 120))
                        Text(w.weekday).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 170, alignment: .bottom)
        }
        .padding(14)
        .background(npocCard())
    }
}
