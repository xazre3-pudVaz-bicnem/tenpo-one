import SwiftUI

/// ネイティブの会計画面（見本）。お支払い方法 → 預り金 → おつり → 会計する → 完了（レシート）
/// いまは画面の確認用。実際の会計はサーバー（Web と同じ処理）で行うようにつなぐ。
struct NativeCheckoutView: View {
    let total: Int
    let tableName: String
    let onClose: () -> Void

    enum Method: String, CaseIterable, Identifiable {
        case cash = "現金", card = "クレジット", emoney = "電子マネー", qr = "QRコード", other = "その他"
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .cash: return "yensign.circle"
            case .card: return "creditcard"
            case .emoney: return "wave.3.right.circle"
            case .qr: return "qrcode"
            case .other: return "ellipsis.circle"
            }
        }
    }

    @State private var method: Method = .cash
    @State private var tenderedText = ""
    @State private var done = false

    private var tendered: Int { Int(tenderedText) ?? 0 }
    private var effectiveTendered: Int { method == .cash ? tendered : total }
    private var change: Int { max(0, effectiveTendered - total) }
    private var canPay: Bool { effectiveTendered >= total && total > 0 }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("お会計  \(tableName)").font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Color.white.opacity(0.12)))
                }
            }
            .padding(.horizontal, 20).frame(height: 64)
            .background(NT.header)

            if done {
                doneView
            } else {
                HStack(alignment: .top, spacing: 16) {
                    leftColumn
                    if method == .cash { keypad.frame(width: 360) }
                }
                .padding(16)
            }
        }
        .background(NT.page.ignoresSafeArea())
    }

    private var leftColumn: some View {
        VStack(spacing: 14) {
            VStack(spacing: 6) {
                Text("お支払い金額").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink2)
                Text(NT.yen(total)).font(.system(size: 54, weight: .heavy)).foregroundColor(NT.purple)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 18)
            .background(RoundedRectangle(cornerRadius: 16).fill(NT.card))

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 10)], spacing: 10) {
                ForEach(Method.allCases) { m in
                    Button { method = m } label: {
                        VStack(spacing: 6) {
                            Image(systemName: m.icon).font(.system(size: 24, weight: .semibold))
                            Text(m.rawValue).font(.system(size: 15, weight: .bold))
                        }
                        .foregroundColor(method == m ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 84)
                        .background(RoundedRectangle(cornerRadius: 14).fill(method == m ? NT.purple : NT.card))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(NT.lilacLine, lineWidth: method == m ? 0 : 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }

            VStack(spacing: 10) {
                row("お預かり", method == .cash ? (tendered > 0 ? NT.yen(tendered) : "—") : NT.yen(total), big: false)
                Divider()
                row("おつり", NT.yen(change), big: true)
            }
            .padding(18)
            .background(RoundedRectangle(cornerRadius: 16).fill(NT.card))

            Spacer(minLength: 0)
            Button { withAnimation(.easeOut(duration: 0.2)) { done = true } } label: {
                Text(canPay ? "会計する" : "お預かり金額を入れてください")
                    .font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity, minHeight: 72)
                    .background(RoundedRectangle(cornerRadius: 16).fill(canPay ? NT.purple : NT.purple.opacity(0.35)))
            }
            .buttonStyle(PressableStyle())
            .disabled(!canPay)
        }
    }

    private func row(_ label: String, _ value: String, big: Bool) -> some View {
        HStack(alignment: .lastTextBaseline) {
            Text(label).font(.system(size: big ? 19 : 16, weight: .bold)).foregroundColor(NT.ink2)
            Spacer()
            Text(value).font(.system(size: big ? 34 : 22, weight: .heavy)).foregroundColor(big ? NT.ok : NT.ink)
        }
    }

    private var keypad: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                quick("ちょうど") { tenderedText = String(total) }
                quick("¥1,000") { tenderedText = String(tendered + 1000) }
                quick("¥5,000") { tenderedText = String(tendered + 5000) }
                quick("¥10,000") { tenderedText = String(tendered + 10000) }
            }
            let keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "⌫"]
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(keys, id: \.self) { k in
                    Button { tap(k) } label: {
                        Text(k).font(.system(size: 28, weight: .bold)).foregroundColor(NT.ink)
                            .frame(maxWidth: .infinity, minHeight: 72)
                            .background(RoundedRectangle(cornerRadius: 14).fill(NT.card))
                    }
                    .buttonStyle(PressableStyle(scale: 0.93))
                }
            }
            Button { tenderedText = "" } label: {
                Text("クリア").font(.system(size: 17, weight: .bold)).foregroundColor(NT.danger)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.dangerBg))
            }
            .buttonStyle(PressableStyle())
        }
    }

    private func quick(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purple)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(RoundedRectangle(cornerRadius: 12).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
    }

    private func tap(_ k: String) {
        if k == "⌫" { tenderedText = String(tenderedText.dropLast()); return }
        if tenderedText.count >= 7 { return }
        if tenderedText.isEmpty && (k == "0" || k == "00") { return }
        tenderedText += k
    }

    private var doneView: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "checkmark.circle.fill").font(.system(size: 76)).foregroundColor(NT.ok)
            Text("会計が完了しました").font(.system(size: 28, weight: .heavy)).foregroundColor(NT.ink)
            if method == .cash {
                Text("おつり \(NT.yen(change))").font(.system(size: 44, weight: .heavy)).foregroundColor(NT.ok)
            }
            HStack(spacing: 14) {
                doneButton("printer", "レシート印刷", filled: false)
                doneButton("doc.text", "領収書", filled: false)
                Button(action: onClose) {
                    Text("閉じる").font(.system(size: 19, weight: .heavy)).foregroundColor(.white)
                        .frame(width: 200, height: 64)
                        .background(RoundedRectangle(cornerRadius: 14).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.top, 10)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func doneButton(_ icon: String, _ text: String, filled: Bool) -> some View {
        Button {} label: {
            HStack(spacing: 8) { Image(systemName: icon); Text(text) }
                .font(.system(size: 18, weight: .bold)).foregroundColor(NT.purple)
                .frame(width: 200, height: 64)
                .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
        }
        .buttonStyle(PressableStyle())
    }
}
