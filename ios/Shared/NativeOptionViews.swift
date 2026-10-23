import SwiftUI

/// 選択肢・金額を選ぶパネル（オーダー画面の上に重ねる）。Web のレジの選択ダイアログ・金額入力と同じ決まり。
/// 金額・選択肢の正しさ（必須・最小/最大・¥0 の商品か・上限）はサーバー（addItem）がもう一度確かめる。
struct NativePendingItemPanel: View {
    @ObservedObject var model: NativeOrderModel
    let pending: NPPendingItem

    var body: some View {
        ZStack {
            Color.black.opacity(0.38).ignoresSafeArea()
                .onTapGesture { model.pending = nil }
            Group {
                if pending.askingPrice {
                    NativeOpenPricePad(
                        item: pending.item, extra: pending.extra, optionNames: pending.chosenNamesEn,
                        onCancel: { model.pending = nil },
                        onDone: { model.choosePrice($0) }
                    )
                    .frame(maxWidth: 460)
                } else {
                    NativeOptionPicker(
                        item: pending.item, groups: pending.groups,
                        onCancel: { model.pending = nil },
                        onDone: { ids, names, namesEn, extra in model.chooseOptions(ids, names: names, namesEn: namesEn, extra: extra) }
                    )
                    .frame(maxWidth: 780)
                }
            }
            .padding(28)
        }
    }
}

// MARK: - 選択肢

struct NativeOptionPicker: View {
    let item: NPMenuItem
    let groups: [NPOptionGroup]
    let onCancel: () -> Void
    let onDone: (_ ids: [String], _ names: [String], _ namesEn: [String], _ extra: Int) -> Void
    /// グループ → 選んだ選択肢（選んだ順）
    @State private var chosen: [String: [String]] = [:]

    private func count(_ g: NPOptionGroup) -> Int { (chosen[g.id] ?? []).count }
    private func ok(_ g: NPOptionGroup) -> Bool { count(g) >= g.minimum && count(g) <= g.maxSelect }
    private var allOk: Bool { groups.allSatisfy(ok) }
    private var picked: [NPOptionGroup.Option] {
        groups.flatMap { g in (chosen[g.id] ?? []).compactMap { id in g.items.first { $0.id == id } } }
    }
    private var extra: Int { picked.reduce(0) { $0 + $1.price } }

    private func toggle(_ g: NPOptionGroup, _ o: NPOptionGroup.Option) {
        var cur = chosen[g.id] ?? []
        if let i = cur.firstIndex(of: o.id) {
            cur.remove(at: i)
        } else if g.maxSelect == 1 {
            cur = [o.id]
        } else if cur.count < g.maxSelect {
            cur.append(o.id)
        }
        chosen[g.id] = cur
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name).font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2)
                    Text(item.english.map { "\($0) · オプションを選ぶ" } ?? "オプションを選ぶ").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    if item.openPrice {
                        Text("次に価格").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
                    } else {
                        Text(NT.yen(item.price + extra)).font(.system(size: 26, weight: .heavy)).foregroundColor(NT.purple)
                    }
                    if extra > 0 {
                        Text("オプション +\(NT.yen(extra))").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    }
                }
            }
            .padding(.horizontal, 22).padding(.vertical, 18)

            Divider().overlay(NT.line)

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ForEach(groups) { g in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 8) {
                                Text(g.name).font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink)
                                if let en = g.english, en != g.name {
                                    Text(en).font(.system(size: 12)).foregroundColor(NT.ink3)
                                }
                                Text(g.minimum >= 1 ? "必須" : "任意")
                                    .font(.system(size: 11, weight: .heavy))
                                    .foregroundColor(g.minimum >= 1 ? NT.danger : NT.ink2)
                                    .padding(.horizontal, 7).padding(.vertical, 2)
                                    .background(Capsule().fill(g.minimum >= 1 ? NT.dangerBg : NT.lilac))
                                Text(g.rule).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                                Spacer(minLength: 4)
                                if g.minimum >= 1 && ok(g) {
                                    Image(systemName: "checkmark.circle.fill").foregroundColor(NT.ok)
                                }
                            }
                            WrapLayout(spacing: 10) {
                                ForEach(g.items) { o in
                                    chip(g, o)
                                }
                            }
                        }
                    }
                }
                .padding(22)
            }
            .frame(maxHeight: 470)

            Divider().overlay(NT.line)

            HStack(spacing: 12) {
                Button(action: onCancel) {
                    Text("キャンセル").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2)
                        .frame(minWidth: 140, minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                Spacer(minLength: 8)
                Button {
                    onDone(picked.map(\.id), picked.map(\.name), picked.map(\.title), extra)
                } label: {
                    Text(item.openPrice ? "次に価格" : "注文に追加")
                        .font(.system(size: 18, weight: .heavy)).foregroundColor(.white)
                        .frame(minWidth: 240, minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 14).fill(allOk ? NT.purple : NT.ink3.opacity(0.5)))
                }
                .buttonStyle(PressableStyle())
                .disabled(!allOk)
            }
            .padding(16)
        }
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(NT.card))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
    }

    private func chip(_ g: NPOptionGroup, _ o: NPOptionGroup.Option) -> some View {
        let on = (chosen[g.id] ?? []).contains(o.id)
        let full = !on && g.maxSelect > 1 && count(g) >= g.maxSelect
        return Button { toggle(g, o) } label: {
            HStack(spacing: 8) {
                Image(systemName: on ? (g.maxSelect == 1 ? "largecircle.fill.circle" : "checkmark.square.fill") : (g.maxSelect == 1 ? "circle" : "square"))
                    .font(.system(size: 18, weight: .semibold))
                VStack(alignment: .leading, spacing: 1) {
                    Text(o.name).font(.system(size: 16, weight: .bold)).lineLimit(1)
                    if let en = o.english, en != o.name {
                        Text(en).font(.system(size: 11)).opacity(0.7).lineLimit(1)
                    }
                    if o.price != 0 {
                        Text(verbatim: (o.price > 0 ? "+" : "") + NT.yen(o.price)).font(.system(size: 12, weight: .bold)).opacity(0.8)
                    }
                }
            }
            .foregroundColor(on ? .white : (full ? NT.ink3 : NT.ink))
            .padding(.horizontal, 14)
            .frame(minHeight: 54)
            .background(RoundedRectangle(cornerRadius: 12).fill(on ? NT.purple : (full ? Color(hex: 0xF4F2F7) : Color.white)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? NT.purple : NT.lilacLine, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .disabled(full)
    }
}

// MARK: - 金額入力（¥0 の商品＝キャンセル料・時価など）

struct NativeOpenPricePad: View {
    let item: NPMenuItem
    let extra: Int
    let optionNames: [String]
    let onCancel: () -> Void
    let onDone: (Int) -> Void
    @State private var digits = ""

    /// サーバーの上限（app/app/pos/actions.ts の OPEN_PRICE_MAX）
    private static let maxYen = 9_999_999
    private var yen: Int { Int(digits) ?? 0 }

    private func key(_ k: String) {
        switch k {
        case "⌫": digits = String(digits.dropLast())
        case "C": digits = ""
        default:
            let next = (digits + k).replacingOccurrences(of: "^0+", with: "", options: .regularExpression)
            if let v = Int(next), v <= Self.maxYen { digits = next } else if next.isEmpty { digits = "" }
        }
    }

    var body: some View {
        VStack(spacing: 14) {
            VStack(spacing: 4) {
                Text(item.name).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.center)
                Text(optionNames.isEmpty ? "価格を入力" : optionNames.joined(separator: ", "))
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(2)
            }
            HStack(alignment: .firstTextBaseline) {
                Text("価格").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
                Spacer()
                Text(NT.yen(yen)).font(.system(size: 36, weight: .heavy)).foregroundColor(yen > 0 ? NT.ink : NT.ink3)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
            if extra > 0 {
                Text("オプション +\(NT.yen(extra))（合計 \(NT.yen(yen + extra))）")
                    .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            }
            let keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "⌫"]
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(keys, id: \.self) { k in
                    Button { key(k) } label: {
                        Group {
                            if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) }
                        }
                        .font(.system(size: 24, weight: .bold)).foregroundColor(NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0xFBF9F5)))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.lilacLine, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle(scale: 0.93))
                }
            }
            HStack(spacing: 10) {
                Button(action: onCancel) {
                    Text("キャンセル").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                Button { onDone(yen) } label: {
                    Text("注文に追加").font(.system(size: 18, weight: .heavy)).foregroundColor(.white)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 14).fill(yen > 0 ? NT.purple : NT.ink3.opacity(0.5)))
                }
                .buttonStyle(PressableStyle())
                .disabled(yen <= 0)
            }
        }
        .padding(22)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(NT.card))
        .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
    }
}
