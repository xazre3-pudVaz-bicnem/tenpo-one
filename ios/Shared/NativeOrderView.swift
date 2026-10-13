import SwiftUI

/// ネイティブのオーダー画面（iPad レジ）。Web の「オーダー・会計」と同じ並び：
///   左＝伝票（卓・人数・明細・合計・伝票の操作）／中＝カテゴリ／右＝検索・商品・注文確定・会計へ
/// タップしたらすぐ画面に出す（Web より速い）。
struct NativeOrderView: View {
    @ObservedObject var model: NativeOrderModel
    var onHome: () -> Void = {}
    @State private var showCheckout = false

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.storeName, title: "オーダー・会計", subtitle: "Order & Pay", onHome: onHome)
            GeometryReader { geo in
                let slipW = max(320, geo.size.width * 0.30)
                let catW = max(150, geo.size.width * 0.13)
                HStack(alignment: .top, spacing: 12) {
                    SlipPanel(model: model)
                        .frame(width: slipW)
                    CategoryColumn(model: model)
                        .frame(width: catW)
                    ItemsPanel(model: model, onCheckout: { showCheckout = true })
                }
                .padding(12)
            }
            .background(NT.page)
        }
        .background(NT.page.ignoresSafeArea())
        .sheet(isPresented: $showCheckout) {
            NativeCheckoutView(total: model.total, tableName: model.order.tableName, onClose: { showCheckout = false })
        }
    }
}

// MARK: - 上のバー

struct NativeTopBar: View {
    let storeName: String
    let title: String
    let subtitle: String
    var onHome: () -> Void = {}

    var body: some View {
        HStack(spacing: 10) {
            barButton(icon: "line.3.horizontal", text: "メニュー") {}
            barButton(icon: "chevron.left", text: "ホーム", action: onHome)
            Image("BrandMark")
                .resizable()
                .scaledToFit()
                .frame(width: 38, height: 38)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack(spacing: 6) {
                Image(systemName: "storefront")
                Text(storeName).lineLimit(1)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.10)))
            Spacer(minLength: 8)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.system(size: 22, weight: .heavy)).foregroundColor(.white)
                    Text(subtitle).font(.system(size: 13, weight: .bold)).foregroundColor(Color(hex: 0xC9B6F5))
                }
                .fixedSize()
                Text(title).font(.system(size: 20, weight: .heavy)).foregroundColor(.white).fixedSize()
            }
            Spacer(minLength: 8)
            Image(systemName: "magnifyingglass").foregroundColor(.white).font(.system(size: 19, weight: .semibold))
            Image(systemName: "bell").foregroundColor(.white).font(.system(size: 19, weight: .semibold)).padding(.horizontal, 6)
            HStack(spacing: 6) {
                Image(systemName: "person")
                Text("Bimal")
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.white.opacity(0.10)))
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(NT.header.ignoresSafeArea(edges: .top))
    }

    private func barButton(icon: String, text: String, action: @escaping () -> Void = {}) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.10)))
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - 左：伝票

private struct SlipPanel: View {
    @ObservedObject var model: NativeOrderModel

    var body: some View {
        VStack(spacing: 0) {
            // 卓・人数・伝票番号
            HStack(spacing: 10) {
                Image(systemName: "arrow.left").font(.system(size: 18, weight: .bold)).foregroundColor(NT.ink2)
                Text(model.order.tableName).font(.system(size: 32, weight: .heavy)).foregroundColor(NT.purple)
                HStack(spacing: 4) {
                    Image(systemName: "person.2")
                    Text(verbatim: "\(model.order.guestCount)名")
                }
                .lineLimit(1)
                .fixedSize()
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(NT.ink2)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Capsule().fill(NT.lilac))
                Spacer()
                Text(verbatim: "#\(model.order.orderNo)").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider().overlay(NT.line)

            // 顧客・時間・担当
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    chip(icon: "person", text: model.order.customerName.map { "\($0) 様" } ?? "顧客 未設定")
                    if let from = model.order.seatFrom, let to = model.order.seatTo {
                        chip(icon: "clock", text: "\(from)〜\(to)")
                    }
                }
                Text("担当 \(model.order.clerkName ?? "未設定")")
                    .font(.system(size: 13, weight: .medium)).foregroundColor(NT.ink2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider().overlay(NT.line)

            // 明細
            if model.order.lines.isEmpty {
                Spacer()
                Text("商品をタップして追加してください\nTap an item to add")
                    .multilineTextAlignment(.center)
                    .font(.system(size: 15)).foregroundColor(NT.ink3)
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(model.order.lines) { line in
                                LineRow(line: line, highlighted: line.id == model.lastAddedLineId,
                                        onMinus: { model.change(line, by: -1) },
                                        onPlus: { model.change(line, by: 1) })
                                    .id(line.id)
                                Divider().overlay(NT.line).padding(.leading, 16)
                            }
                        }
                    }
                    .onChange(of: model.lastAddedLineId) { id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id, anchor: .bottom) }
                    }
                }
            }

            // 合計
            VStack(spacing: 6) {
                Divider().overlay(NT.line)
                totalRow("小計", NT.yen(model.subtotal))
                totalRow("消費税", NT.yen(model.tax))
                Divider().overlay(NT.line)
                HStack(alignment: .lastTextBaseline) {
                    Text("合計（税込）").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink)
                    Spacer()
                    Text(NT.yen(model.total)).font(.system(size: 34, weight: .heavy)).foregroundColor(NT.purple)
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.15), value: model.total)
                }
                // 伝票の操作
                FlowChips(items: [
                    ("arrow.triangle.branch", "伝票分割", false),
                    ("doc.badge.plus", "伝票追加", false),
                    ("square.on.square", "伝票統合", false),
                    ("arrow.left.arrow.right", "テーブル移動", false),
                    ("printer", "お会計伝票", false),
                    ("xmark.circle", "この注文を取消", true),
                ])
                .padding(.top, 4)
            }
            .padding(.horizontal, 16).padding(.bottom, 14)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    private func chip(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
            Text(text)
        }
        .font(.system(size: 13, weight: .bold))
        .foregroundColor(NT.ink2)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Capsule().fill(NT.lilac))
    }

    private func totalRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 15)).foregroundColor(NT.ink2)
            Spacer()
            Text(value).font(.system(size: 15, weight: .medium)).foregroundColor(NT.ink2)
        }
    }
}

private struct LineRow: View {
    let line: NPOrderLine
    let highlighted: Bool
    let onMinus: () -> Void
    let onPlus: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(line.name).font(.system(size: 16, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2)
                HStack(spacing: 6) {
                    Text(NT.yen(line.unitPrice)).font(.system(size: 12)).foregroundColor(NT.ink3)
                    Text(line.sent ? "送信済み" : "未送信")
                        .font(.system(size: 11, weight: .bold))
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundColor(line.sent ? NT.ok : NT.warn)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill((line.sent ? NT.ok : NT.warn).opacity(0.12)))
                }
            }
            Spacer(minLength: 6)
            HStack(spacing: 0) {
                stepButton("minus", action: onMinus)
                Text("\(line.quantity)").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink).frame(minWidth: 30)
                stepButton("plus", action: onPlus)
            }
            .background(Capsule().fill(NT.lilac))
            Text(NT.yen(line.lineTotal))
                .font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                .frame(minWidth: 74, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(highlighted ? NT.lilac.opacity(0.7) : Color.clear)
        .animation(.easeOut(duration: 0.3), value: highlighted)
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purple)
                .frame(width: 36, height: 34)
        }
        .buttonStyle(PressableStyle(scale: 0.9))
    }
}

private struct FlowChips: View {
    let items: [(String, String, Bool)]

    var body: some View {
        let cols = [GridItem(.adaptive(minimum: 128), spacing: 8, alignment: .leading)]
        LazyVGrid(columns: cols, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.1) { icon, text, danger in
                Button {} label: {
                    HStack(spacing: 5) {
                        Image(systemName: icon)
                        Text(text).lineLimit(1)
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(danger ? NT.danger : NT.ink2)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Capsule().fill(danger ? NT.dangerBg : NT.lilac))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

// MARK: - 中：カテゴリ

private struct CategoryColumn: View {
    @ObservedObject var model: NativeOrderModel

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(model.categories) { cat in
                    let selected = cat.id == model.selectedCategory && model.search.isEmpty
                    Button {
                        model.search = ""
                        model.selectedCategory = cat.id
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(cat.name).font(.system(size: 19, weight: .heavy))
                            if let sub = cat.sub {
                                Text(sub).font(.system(size: 12, weight: .medium)).opacity(0.75)
                            }
                        }
                        .foregroundColor(selected ? .white : NT.ink)
                        .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
                        .padding(.horizontal, 16)
                        .background(selected ? NT.purple : Color.clear)
                    }
                    .buttonStyle(PressableStyle(scale: 0.99))
                    Divider().overlay(NT.line)
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }
}

// MARK: - 右：商品

private struct ItemsPanel: View {
    @ObservedObject var model: NativeOrderModel
    let onCheckout: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundColor(NT.ink3)
                TextField("商品名・カナ・英語で検索 / Search", text: $model.search)
                    .font(.system(size: 17))
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                if !model.search.isEmpty {
                    Button { model.search = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3)
                    }
                }
            }
            .padding(.horizontal, 16).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.lilacLine, lineWidth: 1.5))
            .padding(14)
            Divider().overlay(NT.line)

            ScrollView {
                let cols = [GridItem(.adaptive(minimum: 170, maximum: 260), spacing: 12)]
                LazyVGrid(columns: cols, spacing: 12) {
                    ForEach(model.visibleItems) { item in
                        ItemTile(item: item, qty: model.qtyInOrder(item)) { model.add(item) }
                    }
                }
                .padding(14)
            }

            if !model.registerOpen {
                Text("レジが未開局です。会計の前に「レジクローズ」画面で釣銭準備金を数えてレジを開局してください")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(NT.dangerBg))
                    .padding(.horizontal, 14)
            }

            Divider().overlay(NT.line)
            HStack(spacing: 14) {
                Button(action: { model.sendToKitchen() }) {
                    HStack(spacing: 8) {
                        Image(systemName: "bell")
                        Text(model.unsentCount > 0 ? "注文確定（\(model.unsentCount)品を送信）" : "注文確定（未送信なし）")
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    .font(.system(size: 19, weight: .heavy))
                    .foregroundColor(model.unsentCount > 0 ? NT.purple : NT.ink3)
                    .frame(maxWidth: .infinity, minHeight: 66)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.unsentCount == 0)

                Button(action: onCheckout) {
                    Text("会計へ（\(NT.yen(model.total))）")
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .font(.system(size: 21, weight: .heavy))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity, minHeight: 66)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(model.total > 0 ? NT.purple : NT.purple.opacity(0.4)))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.total == 0)
            }
            .padding(14)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }
}

private struct ItemTile: View {
    let item: NPMenuItem
    let qty: Int
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                Text(item.name)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(item.soldOut ? NT.ink3 : NT.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(NT.yen(item.price))
                    .font(.system(size: 19, weight: .heavy))
                    .foregroundColor(item.soldOut ? NT.ink3 : NT.purple)
                if item.hasOptions {
                    Text("選択あり").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 112)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(item.soldOut ? Color(hex: 0xF4F2F7) : NT.card))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(qty > 0 ? NT.purple : NT.lilacLine, lineWidth: qty > 0 ? 2 : 1))
            .overlay(alignment: .topTrailing) {
                if qty > 0 {
                    Text("\(qty)")
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                        .frame(minWidth: 26, minHeight: 26)
                        .background(Circle().fill(NT.purple))
                        .offset(x: 6, y: -6)
                }
            }
            .overlay {
                if item.soldOut {
                    Text("売り切れ")
                        .font(.system(size: 13, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(NT.danger))
                        .rotationEffect(.degrees(-8))
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.95))
        .disabled(item.soldOut)
    }
}
