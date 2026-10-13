import SwiftUI

/// ネイティブのオーダー画面（iPad レジ）。Web の「オーダー・会計」と同じ並び：
///   左＝伝票（卓・人数・明細・合計・伝票の操作）／中＝カテゴリ／右＝検索・商品・注文確定・会計へ
/// タップしたらすぐ画面に出す（Web より速い）。
struct NativeOrderView: View {
    @ObservedObject var model: NativeOrderModel
    var onHome: () -> Void = {}
    @State private var showCheckout = false
    @State private var pickClerk = false
    /// 担当者を選んだあとにすること（注文確定・会計へ）
    @State private var afterClerk: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(
                storeName: model.storeName, title: "オーダー・会計", subtitle: "Order & Pay",
                userName: model.clerkName ?? "担当 未設定",
                onHome: onHome,
                onWeb: model.isLive ? { model.openInWeb() } : nil
            )
            GeometryReader { geo in
                let slipW = max(320, geo.size.width * 0.30)
                let catW = max(150, geo.size.width * 0.13)
                HStack(alignment: .top, spacing: 12) {
                    SlipPanel(model: model, onClerk: { pickClerk = true })
                        .frame(width: slipW)
                    CategoryColumn(model: model)
                        .frame(width: catW)
                    ItemsPanel(model: model, onSend: send, onCheckout: goCheckout)
                }
                .padding(12)
            }
            .background(NT.page)
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let n = model.notice {
                Button { model.notice = nil } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text(n).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Image(systemName: "xmark")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.dangerBg))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NT.danger.opacity(0.3), lineWidth: 1))
                    .frame(maxWidth: 720)
                }
                .buttonStyle(.plain)
                .padding(.top, 74)
            }
        }
        .overlay {
            if model.loading {
                ZStack {
                    NT.page.opacity(0.85).ignoresSafeArea()
                    ProgressView("読み込み中…").font(.system(size: 16, weight: .bold)).tint(NT.purple)
                }
            }
        }
        // 会計は同じ画面の上に重ねる（fullScreenCover にすると、下の Web が止まって Bluetooth の印刷・ドロアが出ない）
        .overlay {
            if showCheckout {
                NativeCheckoutView(model: model, onClose: { showCheckout = false }, onFinished: {
                    showCheckout = false
                    if model.isLive { AppState.shared.closeNativePos(openWebPath: nil) }
                })
                .transition(.move(edge: .trailing))
            }
        }
        .animation(.easeOut(duration: 0.22), value: showCheckout)
        .confirmationDialog("担当者を選んでください", isPresented: $pickClerk, titleVisibility: .visible) {
            ForEach(model.clerks, id: \.id) { c in
                Button(c.name) {
                    let then = afterClerk
                    afterClerk = nil
                    Task {
                        await model.setClerk(c.id)
                        then?()
                    }
                }
            }
            Button("キャンセル", role: .cancel) { afterClerk = nil }
        }
        .alert(
            "今までの画面で入れてください",
            isPresented: Binding(get: { model.webOnlyItem != nil }, set: { if !$0 { model.webOnlyItem = nil } })
        ) {
            Button("今までの画面で開く") { model.openInWeb() }
            Button("閉じる", role: .cancel) {}
        } message: {
            Text("「\(model.webOnlyItem?.name ?? "")」は選択肢（または金額の入力）がある商品です。最初の版では今までの画面で入れます。")
        }
    }

    /// 担当者が要る店で、まだ選んでいなければ先に選ぶ（Web のレジと同じ）
    private func requireClerk(_ then: @escaping () -> Void) {
        if model.clerkMissing {
            afterClerk = then
            pickClerk = true
        } else {
            then()
        }
    }

    private func send() {
        requireClerk { Task { await model.sendToKitchen() } }
    }

    /// 会計へ：まだ送っていないカートは先に注文確定（伝票に入れて厨房へ）
    private func goCheckout() {
        requireClerk {
            Task {
                if !model.cartLines.isEmpty {
                    guard await model.sendToKitchen() else { return }
                }
                showCheckout = true
            }
        }
    }
}

// MARK: - 上のバー

struct NativeTopBar: View {
    let storeName: String
    let title: String
    let subtitle: String
    var userName: String = ""
    var onHome: () -> Void = {}
    /// 今までの（Web の）画面で開く。ライブのときだけ
    var onWeb: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            barButton(icon: "chevron.left", text: "戻る", action: onHome)
            if let onWeb {
                barButton(icon: "safari", text: "今までの画面", action: onWeb)
            }
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
            HStack(spacing: 6) {
                Image(systemName: "person")
                Text(userName).lineLimit(1)
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
    var onClerk: () -> Void = {}

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
                WrapLayout(spacing: 8) {
                    chip(icon: "person", text: model.order.customerName.map { "\($0) 様" } ?? "顧客 未設定")
                    if let from = model.order.seatFrom, let to = model.order.seatTo {
                        chip(icon: "clock", text: "\(from)〜\(to)")
                    }
                    // 来店経路（booking source）
                    let source = (NPVisitSource.defaults + NPVisitSource.extras).first { $0.id == model.order.visitSourceId }
                    chip(icon: "signpost.right", text: source?.label ?? "経路 未設定")
                }
                Button(action: onClerk) {
                    HStack(spacing: 4) {
                        Text("担当 \(model.clerkName ?? "未設定")")
                        if !model.clerks.isEmpty { Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)) }
                    }
                    .font(.system(size: 13, weight: model.clerkMissing ? .bold : .medium))
                    .foregroundColor(model.clerkMissing ? NT.danger : NT.ink2)
                }
                .buttonStyle(.plain)
                .disabled(model.clerks.isEmpty)
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
                                        editable: model.canChange(line),
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
                FlowChips(onTap: { model.openInWeb() }, items: [
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
    var editable: Bool = true
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
            if editable {
                HStack(spacing: 0) {
                    stepButton("minus", action: onMinus)
                    Text("\(line.quantity)").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink).frame(minWidth: 30)
                    stepButton("plus", action: onPlus)
                }
                .background(Capsule().fill(NT.lilac))
            } else {
                Text(verbatim: "×\(line.quantity)").font(.system(size: 17, weight: .bold)).foregroundColor(NT.ink2).frame(minWidth: 44)
            }
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
    var onTap: () -> Void = {}
    let items: [(String, String, Bool)]

    var body: some View {
        let cols = [GridItem(.adaptive(minimum: 128), spacing: 8, alignment: .leading)]
        LazyVGrid(columns: cols, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.1) { icon, text, danger in
                Button(action: onTap) {
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
    let onSend: () -> Void
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
                Button(action: onSend) {
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
                .disabled(model.unsentCount == 0 || model.busy)

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
                .disabled(model.total == 0 || model.busy || !model.canCheckout)
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
