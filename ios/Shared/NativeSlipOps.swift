import SwiftUI

/// オーダー画面の「伝票の操作」をネイティブで（2026-10-24 Ronnie「会計のとき Web に飛ばない。全部ネイティブで」）
///   新しい伝票 ／ 伝票をまとめる ／ 卓を移動 ／ 会計伝票 ／ 注文取消
/// 卓の一覧は /api/app/v1/pos?part=floor（フロアと同じ）から取る
enum NativeSlipOp: String, Identifiable {
    case newSlip, merge, move, cancel
    var id: String { rawValue }
}

struct NativeSlipOpsSheet: View {
    @ObservedObject var model: NativeOrderModel
    let op: NativeSlipOp
    let onClose: () -> Void
    /// 新しい伝票を作ったとき（その伝票をネイティブで開く）
    let onOpenOrder: (String) -> Void
    /// 伝票を取消したとき（オーダー画面を閉じてフロアへ）
    let onCancelled: () -> Void

    @State private var floor: NFPayload?
    @State private var loading = true
    @State private var busy = false
    @State private var problem: String?
    @State private var reason = ""
    @State private var approverPick = false

    private var orderId: String? { model.orderId }

    var body: some View {
        NavigationStack {
            Group {
                switch op {
                case .newSlip: newSlipBody
                case .merge: mergeBody
                case .move: moveBody
                case .cancel: cancelBody
                }
            }
            .background(NFColor.lilacSoft)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await loadFloor() }
    }

    private var title: String {
        switch op {
        case .newSlip: return "新しい伝票 / New slip"
        case .merge: return "伝票をまとめる / Merge"
        case .move: return "卓を移動 / Move table"
        case .cancel: return "注文取消 / Cancel slip"
        }
    }

    private func loadFloor() async {
        guard op == .merge || op == .move || op == .cancel else { loading = false; return }
        loading = true
        floor = try? await NativeAPI.shared.loadFloor(storeId: nil)
        loading = false
    }

    @discardableResult
    private func act(_ body: [String: Any]) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { problem = r.error ?? "うまくいきませんでした"; return nil }
            return r
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }

    // MARK: 新しい伝票

    private var newSlipBody: some View {
        VStack(spacing: 18) {
            Text("同じ卓に、空の伝票をもう1枚作ります（相席・別会計など）。今の伝票はそのまま残ります。")
                .font(.system(size: 15)).foregroundColor(NFColor.ink2).multilineTextAlignment(.center)
            if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
            bigButton("新しい伝票を作る", en: "Create new slip", fill: NFColor.iris, enabled: !busy) {
                Task {
                    guard let orderId else { return }
                    if let r = await act(["type": "floorNewSlip", "orderId": orderId]), let id = r.orderId {
                        onClose()
                        onOpenOrder(id)
                    }
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: 伝票をまとめる

    private var mergeBody: some View {
        let candidates = (floor?.tables ?? []).filter { t in
            t.order != nil && !(t.order!.slips.isEmpty) && !(t.order!.slips.contains { $0.id == orderId })
        }
        return VStack(alignment: .leading, spacing: 12) {
            Text("どの卓の伝票をこの伝票にまとめますか / Merge which table into this slip")
                .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
            if loading { ProgressView().frame(maxWidth: .infinity) }
            else if candidates.isEmpty {
                Text("ほかにお客様が入っている卓がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3)
            } else {
                tableGrid(candidates) { t in
                    Task {
                        guard let orderId, let src = t.order?.slips.first else { return }
                        if let _ = await act(["type": "floorMerge", "targetOrderId": orderId, "sourceOrderId": src.id]) {
                            await model.load()
                            model.notice = nil
                            onClose()
                        }
                    }
                }
            }
            if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
            Spacer()
        }
        .padding(20)
    }

    // MARK: 卓を移動

    private var moveBody: some View {
        let free = (floor?.tables ?? []).filter { $0.order == nil && $0.currentStatus == "available" }
        return VStack(alignment: .leading, spacing: 12) {
            Text("移動先の空席を選ぶ / Choose an empty table")
                .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
            if loading { ProgressView().frame(maxWidth: .infinity) }
            else if free.isEmpty {
                Text("空席がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3)
            } else {
                tableGrid(free) { t in
                    Task {
                        guard let orderId else { return }
                        if let _ = await act(["type": "floorMove", "orderId": orderId, "tableId": t.id]) {
                            await model.load()
                            model.notice = nil
                            onClose()
                        }
                    }
                }
            }
            if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
            Spacer()
        }
        .padding(20)
    }

    // MARK: 注文取消（品目のない伝票だけ）

    private var cancelBody: some View {
        let hasLines = !model.order.lines.isEmpty || !model.cartLines.isEmpty
        let approvers = floor?.approvers ?? []
        return VStack(alignment: .leading, spacing: 14) {
            if hasLines {
                Text("品目が残っている伝票は取消できません。先に品目を取消するか、会計してください。")
                    .font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.danger)
            } else {
                Text("この伝票（¥0・品目なし）を取消して、卓を空席に戻します。売上には入りません。")
                    .font(.system(size: 15)).foregroundColor(NFColor.ink2)
                Text("取消理由 / Reason").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                TextField("例）誤って着席", text: $reason)
                    .font(.system(size: 16)).foregroundColor(NFColor.navy)
                    .padding(.horizontal, 12).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                if !approvers.isEmpty {
                    Text("このあと担当者（店長以上）を選びます").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                }
                if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                bigButton("この伝票を取消", en: "Cancel slip", fill: NFColor.danger, enabled: !busy && !reason.trimmingCharacters(in: .whitespaces).isEmpty) {
                    if approvers.isEmpty { Task { await cancel(approver: nil) } } else { approverPick = true }
                }
                .confirmationDialog("承認する担当者（店長以上）を選ぶ", isPresented: $approverPick, titleVisibility: .visible) {
                    ForEach(approvers) { a in Button(a.name) { Task { await cancel(approver: a.id) } } }
                    Button("キャンセル", role: .cancel) {}
                }
            }
            Spacer()
        }
        .padding(20)
    }

    private func cancel(approver: String?) async {
        guard let orderId else { return }
        var body: [String: Any] = ["type": "floorCancelEmpty", "orderId": orderId, "reason": reason]
        if let approver { body["approvedByClerkId"] = approver }
        if let _ = await act(body) {
            onClose()
            onCancelled()
        }
    }

    // MARK: 部品

    private func tableGrid(_ tables: [NFTable], onPick: @escaping (NFTable) -> Void) -> some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                ForEach(tables) { t in
                    Button { onPick(t) } label: {
                        VStack(spacing: 4) {
                            Text(t.name).font(.system(size: 18, weight: .heavy)).foregroundColor(NFColor.navy)
                            if let o = t.order {
                                Text("\(o.guestCount)名・\(NT.yen(o.total))").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3)
                            } else {
                                Text("\(t.capacityMax)名席").font(.system(size: 11, weight: .semibold)).foregroundColor(NFColor.ink3)
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 68)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(busy)
                }
            }
        }
    }

    private func bigButton(_ ja: String, en: String, fill: Color, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(ja).font(.system(size: 17, weight: .heavy))
                Text(en).font(.system(size: 11, weight: .bold)).opacity(0.8)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity).frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(fill))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }
}
