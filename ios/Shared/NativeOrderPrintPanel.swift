import SwiftUI

/// Printing lives at the bottom of the order, and never sends the cart to the kitchen.
struct NativeOrderPrintPanel: View {
    @ObservedObject var model: NativeOrderModel
    let onClose: () -> Void
    @State private var picked: Set<String> = []
    @State private var sending = false
    @State private var error: String?

    private var lines: [NPOrderLine] { model.order.lines.filter { !$0.local && $0.sent } }

    var body: some View {
        NativeModalCard(width: 620) {
            VStack(spacing: 14) {
                HStack {
                    Label("印刷", systemImage: "printer").font(.system(size: 20, weight: .semibold))
                    Spacer()
                    Button(action: onClose) { Image(systemName: "xmark.circle.fill").font(.system(size: 26)) }
                        .foregroundColor(NT.ink3).buttonStyle(.plain).accessibilityLabel("閉じる")
                }
                HStack(spacing: 10) {
                    action("会計伝票") {
                        await model.printBill()
                        if let notice = model.notice { error = notice } else { onClose() }
                    }
                    action("デシャップ伝票", enabled: !model.offline) { await printRequest(type: "floorExpo") }
                }
                HStack {
                    Text("印刷する商品を選択").font(.system(size: 14, weight: .medium))
                    Spacer()
                    Button(picked.count == lines.count && !lines.isEmpty ? "選択解除" : "すべて選択") {
                        picked = picked.count == lines.count ? [] : Set(lines.map(\.id))
                    }
                    .font(.system(size: 13)).disabled(lines.isEmpty || model.offline)
                }
                ScrollView {
                    VStack(spacing: 6) {
                        if lines.isEmpty {
                            Text("注文送信済みの商品がありません").font(.system(size: 14)).foregroundColor(NT.ink3).padding(20)
                        }
                        ForEach(lines) { line in
                            Button {
                                if picked.contains(line.id) { picked.remove(line.id) } else { picked.insert(line.id) }
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: picked.contains(line.id) ? "checkmark.circle.fill" : "circle")
                                    Text(line.displayName).multilineTextAlignment(.leading)
                                    Spacer()
                                    Text("×\(line.quantity)").monospacedDigit()
                                }
                                .font(.system(size: 15, weight: .medium)).foregroundColor(NT.ink)
                                .padding(12).background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(picked.contains(line.id) ? NT.purple : NT.line, lineWidth: 1))
                            }
                            .buttonStyle(.plain).disabled(model.offline)
                        }
                    }
                }
                .frame(maxHeight: 330)
                if model.offline { Text("選択印刷はネット接続後に利用できます").font(.system(size: 12)).foregroundColor(NT.ink3) }
                if let error { Text(error).font(.system(size: 13)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true) }
                action("選択した\(picked.count)品を印刷", enabled: !picked.isEmpty && !model.offline) {
                    await printRequest(type: "floorPrintSelected")
                }
            }
            .padding(20).background(NT.page)
            .disabled(sending)
        }
    }

    private func action(_ title: String, enabled: Bool = true, run: @escaping () async -> Void) -> some View {
        Button {
            sending = true; error = nil
            Task { await run(); sending = false }
        } label: {
            Text(sending ? "処理中…" : title).font(.system(size: 15, weight: .medium))
                .foregroundColor(NT.purple).frame(maxWidth: .infinity).frame(height: 44)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle()).disabled(!enabled || sending)
    }

    private func printRequest(type: String) async {
        guard let id = model.orderId, !model.offline else { return }
        var body: [String: Any] = ["type": type, "orderId": id]
        if type == "floorPrintSelected" {
            let valid = Set(lines.map(\.id)).intersection(picked)
            guard !valid.isEmpty else { error = "印刷する商品を選んでください"; return }
            body["itemIds"] = Array(valid)
        }
        do {
            let result = try await NativeAPI.shared.floorAct(body)
            guard result.ok else { error = result.error ?? "印刷できませんでした"; return }
            model.toast = "印刷を受け付けました"
            onClose()
        } catch {
            // A lost reply can follow a successful physical print. Ask the user to check before retrying.
            self.error = "印刷結果を確認できませんでした。プリンターを確認してから再操作してください"
        }
    }
}
