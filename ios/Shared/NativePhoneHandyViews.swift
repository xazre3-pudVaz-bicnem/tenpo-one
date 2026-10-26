import SwiftUI

// iPhone のネイティブのハンディ：卓の画面・注文の画面（2026-10-25 01:38 Ronnie「iPhone も native に。デザインは iPad のネイティブ」）。
// 色は iPad のネイティブと同じ（上のバー＝ネイビー NT.topBar、主の色＝青 NT.purple、地＝うすい灰色 NT.page）。
// データと動き：NativePhoneHandyModels.swift

// MARK: - 上のバー（ネイビー）

struct NPHTopBar<Trailing: View>: View {
    let title: String
    var subtitle: String = ""
    var backLabel: String = ""
    let onBack: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 6) {
            Button(action: onBack) {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left").font(.system(size: 17, weight: .bold))
                    if !backLabel.isEmpty { Text(backLabel).font(.system(size: 14, weight: .bold)).lineLimit(1) }
                }
                .foregroundColor(.white)
                .padding(.horizontal, 10).frame(height: 40)
                .background(Capsule().fill(Color.white.opacity(0.12)))
            }
            .buttonStyle(PressableStyle())
            Spacer(minLength: 4)
            VStack(spacing: 1) {
                Text(title).font(.system(size: 17, weight: NT.strong)).foregroundColor(.white).lineLimit(1)
                if !subtitle.isEmpty { Text(subtitle).font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(0.7)).lineLimit(1) }
            }
            .layoutPriority(1)
            Spacer(minLength: 4)
            trailing()
        }
        .padding(.horizontal, 10).frame(height: 56)
        .background(NT.topBar.ignoresSafeArea(edges: .top))
    }
}

/// 下に少しだけ出す知らせ
struct NPHToast: View {
    @Binding var text: String?
    var body: some View {
        if let t = text {
            Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(Capsule().fill(NT.topBar.opacity(0.94)))
                .padding(.horizontal, 20).padding(.bottom, 110)
                .transition(.opacity)
                .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { if text == t { text = nil } } }
        }
    }
}

private func yen(_ v: Double) -> String { NT.yen(Int(v.rounded())) }

// MARK: - 卓の画面

struct NativePhoneTableView: View {
    @ObservedObject var model: NativePhoneTableModel
    let onBack: () -> Void
    let onOrder: (String) -> Void
    /// お客様情報（来店登録。伝票が無い卓）
    let onSetup: () -> Void
    @State private var extendFor: NPHSlip?
    @State private var guestsFor: NPHSlip?

    var body: some View {
        ZStack(alignment: .bottom) {
            NT.page.ignoresSafeArea()
            VStack(spacing: 0) {
                NPHTopBar(title: model.payload?.table?.name ?? "卓", subtitle: model.payload?.clerk.map { "担当 \($0.name)" } ?? "",
                          backLabel: "テーブル", onBack: onBack) {
                    Button { Task { await model.refresh() } } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 40)
                    }
                }
                if let p = model.payload {
                    ScrollView {
                        VStack(spacing: 12) {
                            ForEach(p.calls ?? []) { c in callRow(c) }
                            if (p.slips ?? []).isEmpty {
                                emptyCard
                            }
                            ForEach(p.slips ?? []) { s in slipCard(s, many: (p.slips ?? []).count > 1) }
                        }
                        .padding(14).padding(.bottom, 110)
                    }
                } else if let e = model.error {
                    Spacer(); Text(e).font(.system(size: 14)).foregroundColor(NT.ink3).padding(); Spacer()
                } else {
                    Spacer(); ProgressView().tint(NT.purple); Spacer()
                }
            }
            if let p = model.payload { bottomBar(p) }
            NPHToast(text: $model.toast)
        }
        .environment(\.colorScheme, .light)
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .confirmationDialog("時間延長", isPresented: Binding(get: { extendFor != nil }, set: { if !$0 { extendFor = nil } }), titleVisibility: .visible) {
            ForEach(model.payload?.extendOptions ?? [30, 60, 90, 120], id: \.self) { m in
                Button("\(m)分 延長") {
                    guard let s = extendFor else { return }
                    Task { await model.act(["type": "handyExtend", "orderId": s.id, "minutes": m], key: "extend", done: "\(m)分 延長しました") }
                }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("延長料金はメニューの「延長」で入れてください")
        }
        .sheet(item: $guestsFor) { s in
            NPHGuestSheet(initial: s.guestCount) { n in
                guestsFor = nil
                Task { await model.act(["type": "handyGuests", "orderId": s.id, "guestCount": n], key: "guests", done: "人数を \(n)名 にしました") }
            }
            .presentationDetents([.height(420)])
            .environment(\.colorScheme, .light)
        }
    }

    private var emptyCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "fork.knife").font(.system(size: 30, weight: .bold)).foregroundColor(NT.ink3)
            Text("この卓にはまだ伝票がありません").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
            Button(action: onSetup) {
                Text("お客様情報を入れて開始").font(.system(size: 16, weight: NT.strong)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
    }

    private func callRow(_ c: NPHCall) -> some View {
        let checkout = c.kind == "checkout"
        let min = max(0, Int((model.now.timeIntervalSince1970 - c.createdAt / 1000) / 60))
        return HStack(spacing: 10) {
            Image(systemName: checkout ? "yensign.circle.fill" : "bell.fill").font(.system(size: 22, weight: .bold)).foregroundColor(NFColor.callDeep)
            VStack(alignment: .leading, spacing: 2) {
                Text(checkout ? "お会計希望" : "呼び出し").font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.callInk)
                Text("\(min)分前\(c.note.map { "・\($0)" } ?? "")").font(.system(size: 12)).foregroundColor(NFColor.callInk.opacity(0.8)).lineLimit(2)
            }
            Spacer(minLength: 6)
            Button {
                Task { await model.act(["type": "handyCallDone", "callId": c.id], key: "call:\(c.id)", done: "対応済みにしました") }
            } label: {
                Text("対応済み").font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(Capsule().fill(NFColor.callDeep))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.busy != nil)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.callSoft))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.callOrange, lineWidth: 1.5))
    }

    private func elapsed(_ s: NPHSlip) -> String {
        let m = max(0, Int((model.now.timeIntervalSince1970 - s.openedAt / 1000) / 60))
        return m >= 60 ? "\(m / 60)時間\(m % 60)分" : "\(m)分"
    }

    private func remain(_ s: NPHSlip) -> (String, Color)? {
        guard let end = s.endsAt else { return nil }
        let m = Int(floor((end / 1000 - model.now.timeIntervalSince1970) / 60))
        if m < 0 { return ("\(-m)分 超過", NT.danger) }
        if m <= 30 { return ("残り \(m)分（L.O.）", NFColor.loInk) }
        return ("残り \(m)分", NT.ink2)
    }

    private func slipCard(_ s: NPHSlip, many: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                Text("伝票 #\(s.orderNo)").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Text(yen(s.total)).font(.system(size: 22, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            .padding(.horizontal, 16).padding(.top, 14)
            HStack(spacing: 8) {
                Button { guestsFor = s } label: {
                    Label("\(s.guestCount)名", systemImage: "person.2.fill").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                Label(elapsed(s), systemImage: "clock").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
                if let r = remain(s) { Text(r.0).font(.system(size: 13, weight: .bold)).foregroundColor(r.1) }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
            Rectangle().fill(NT.line).frame(height: 1)
            if s.items.isEmpty {
                Text("まだ注文がありません").font(.system(size: 14)).foregroundColor(NT.ink3).padding(16)
            } else {
                VStack(spacing: 0) {
                    ForEach(s.items.reversed()) { i in itemRow(i, slip: s) }
                }
            }
            HStack(spacing: 8) {
                smallButton("時間延長", icon: "clock.arrow.circlepath") { extendFor = s }
                smallButton("会計伝票", icon: "doc.text", busy: model.busy == "bill:\(s.id)") {
                    Task { await model.act(["type": "handyPrintBill", "orderId": s.id], key: "bill:\(s.id)", done: "会計伝票を印刷しました") }
                }
            }
            .padding(12)
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func itemRow(_ i: NPHItem, slip: NPHSlip) -> some View {
        let cancellable = model.canCancel(i)
        return HStack(alignment: .center, spacing: 10) {
            Text("\(i.quantity)").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.purpleDeep)
                .frame(minWidth: 28, minHeight: 28).background(Circle().fill(NT.lilac))
            VStack(alignment: .leading, spacing: 2) {
                Text(i.name).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2)
                HStack(spacing: 6) {
                    if let o = i.optionLabel { Text(o).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1) }
                    Text(i.sentAt == nil ? "未送信" : Self.hm.string(from: Date(timeIntervalSince1970: i.orderedAt / 1000)))
                        .font(.system(size: 12)).foregroundColor(i.sentAt == nil ? NT.warn : NT.ink3)
                }
            }
            Spacer(minLength: 4)
            Text(yen(i.lineTotal)).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
            if cancellable {
                Button {
                    Task { await model.act(["type": "handyCancelItem", "orderId": slip.id, "orderItemId": i.id], key: "cancel:\(i.id)", done: "「\(i.name)」を1つ取り消しました") }
                } label: {
                    VStack(spacing: 0) {
                        Image(systemName: "minus").font(.system(size: 13, weight: NT.strong))
                        Text("\(model.cancelLeft(i) / 60):\(String(format: "%02d", model.cancelLeft(i) % 60))").font(.system(size: 9, weight: .bold)).monospacedDigit()
                    }
                    .foregroundColor(NT.danger).frame(width: 44, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(NT.dangerBg))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy != nil)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 9)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 54) }
    }

    private func smallButton(_ label: String, icon: String, busy: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy { ProgressView().scaleEffect(0.8) } else { Image(systemName: icon) }
                Text(label)
            }
            .font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy != nil)
    }

    private func bottomBar(_ p: NPHTablePayload) -> some View {
        Button {
            if (p.slips ?? []).isEmpty { onSetup(); return }
            Task { if let id = await model.openOrder() { onOrder(id) } }
        } label: {
            HStack(spacing: 8) {
                if model.busy == "open" { ProgressView().tint(.white) } else { Image(systemName: "plus.circle.fill").font(.system(size: 20, weight: .bold)) }
                Text((p.slips ?? []).isEmpty ? "お客様情報を入れて開始" : "注文する").font(.system(size: 18, weight: NT.strong))
            }
            .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
            .shadow(color: NT.purple.opacity(0.35), radius: 10, y: 4)
        }
        .buttonStyle(PressableStyle())
        .disabled(model.busy != nil)
        .padding(.horizontal, 14).padding(.bottom, 10).padding(.top, 10)
        .background(LinearGradient(colors: [NT.page.opacity(0), NT.page], startPoint: .top, endPoint: .center).ignoresSafeArea(edges: .bottom))
    }

    static let hm: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Tokyo"); return f }()
}

/// 人数を変える（テンキー）
struct NPHGuestSheet: View {
    let initial: Int
    let onDone: (Int) -> Void
    @State private var text = ""

    var body: some View {
        VStack(spacing: 14) {
            Text("人数").font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).padding(.top, 18)
            Text("\(text.isEmpty ? String(initial) : text)名").font(.system(size: 40, weight: NT.strong)).foregroundColor(text.isEmpty ? NT.ink3 : NT.ink).monospacedDigit()
            NPHKeypad(text: $text, maxLength: 3)
            Button {
                let n = Int(text) ?? initial
                if n >= 1 { onDone(n) }
            } label: {
                Text("決定").font(.system(size: 17, weight: NT.strong)).foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
            .padding(.horizontal, 18)
        }
        .padding(.bottom, 12)
    }
}

/// 数字のキー（3×4）
struct NPHKeypad: View {
    @Binding var text: String
    var maxLength = 7

    var body: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"]
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(keys, id: \.self) { k in
                Button {
                    switch k {
                    case "C": text = ""
                    case "⌫": if !text.isEmpty { text.removeLast() }
                    default:
                        if text.count < maxLength { text = (text == "0" ? "" : text) + k }
                    }
                } label: {
                    Text(k).font(.system(size: 22, weight: .bold)).foregroundColor(k == "C" ? NT.danger : NT.ink)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(.horizontal, 18)
    }
}

// MARK: - 注文の画面

struct NativePhoneOrderView: View {
    @ObservedObject var model: NativePhoneOrderModel
    /// 戻る（送った点数。送らずに戻るときは nil）
    let onBack: (Int?) -> Void
    @State private var optionItem: NPHMenuItem?
    @State private var amountTarget: AmountTarget?
    @State private var confirmOpen = false

    struct AmountTarget: Identifiable {
        let id = UUID()
        let item: NPHMenuItem?
        let category: NPHCategory
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NT.page.ignoresSafeArea()
            VStack(spacing: 0) {
                NPHTopBar(title: model.payload.map { "\($0.order.tableName) · \($0.order.guestCount)名" } ?? "注文",
                          subtitle: model.payload.map { "伝票 #\($0.order.orderNo)\($0.clerk.map { "・担当 \($0.name)" } ?? "")" } ?? "",
                          backLabel: "卓", onBack: { onBack(nil) }) {
                    Color.clear.frame(width: 40, height: 40)
                }
                if model.payload != nil {
                    pageTabs
                    HStack(spacing: 0) {
                        categoryList
                        itemGrid
                    }
                } else if let e = model.error {
                    Spacer(); Text(e).font(.system(size: 14)).foregroundColor(NT.ink3).multilineTextAlignment(.center).padding(); Spacer()
                } else {
                    Spacer(); ProgressView().tint(NT.purple); Spacer()
                }
            }
            if model.count > 0 { cartBar }
            NPHToast(text: $model.message)
        }
        .environment(\.colorScheme, .light)
        .task { await model.load() }
        .sheet(item: $optionItem) { item in
            NPHOptionSheet(item: item, groups: model.groups(item)) { ids in
                model.add(item, options: ids)
                optionItem = nil
            }
            .presentationDetents([.medium, .large])
            .environment(\.colorScheme, .light)
        }
        .sheet(item: $amountTarget) { t in
            NPHAmountSheet(title: t.item.map { $0.name } ?? "その他 / Other（\(t.category.name)）", askMemo: t.item == nil) { amount, memo in
                if let item = t.item { model.add(item, openPrice: amount) }
                else { model.addCustom(categoryId: t.category.id, label: t.category.name, price: amount, memo: memo) }
                amountTarget = nil
            }
            .presentationDetents([.large])
            .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $confirmOpen) {
            NPHConfirmSheet(model: model, onSent: { n in confirmOpen = false; onBack(n) })
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
        }
    }

    // 上：メニューブックのページ（ドリンク・フード・コース…）
    private var pageTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.pages) { p in
                    let on = p.key == model.page?.key
                    Button { model.pageKey = p.key } label: {
                        Text(p.name ?? p.label).font(.system(size: 15, weight: .bold)).lineLimit(1)
                            .foregroundColor(on ? .white : NT.ink2)
                            .padding(.horizontal, 16).frame(height: 38)
                            .background(Capsule().fill(on ? NT.purple : Color.white))
                            .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }

    // 左：カテゴリ
    private var categoryList: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(model.page?.categories ?? []) { c in
                    let on = c.id == model.category?.id
                    let n = model.qty(category: c)
                    Button {
                        if let k = model.page?.key { model.catByPage[k] = c.id }
                    } label: {
                        HStack(spacing: 0) {
                            Rectangle().fill(on ? NT.purple : Color.clear).frame(width: 4)
                            Text(c.name).font(.system(size: 13.5, weight: on ? NT.strong : .semibold)).foregroundColor(on ? NT.purpleDeep : NT.ink2)
                                .multilineTextAlignment(.leading).lineLimit(3)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 9).padding(.vertical, 14)
                            if n > 0 {
                                Text("\(n)").font(.system(size: 11, weight: NT.strong)).foregroundColor(.white)
                                    .frame(minWidth: 20, minHeight: 20).background(Circle().fill(NT.purple)).padding(.trailing, 6)
                            }
                        }
                        .background(on ? Color.white : Color.clear)
                    }
                    .buttonStyle(.plain)
                    Rectangle().fill(NT.line).frame(height: 1)
                }
            }
            .padding(.bottom, 100)
        }
        .frame(width: 104)
        .background(NT.page)
    }

    // 右：商品（2 列）
    private var itemGrid: some View {
        ScrollView {
            if let c = model.category {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(c.items) { i in tile(i, in: c) }
                    if c.tabId == "alacarte" {
                        Button { amountTarget = AmountTarget(item: nil, category: c) } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "square.and.pencil").font(.system(size: 18, weight: .bold))
                                Text("その他").font(.system(size: 14, weight: NT.strong))
                                Text("金額入力").font(.system(size: 10.5)).foregroundColor(NT.ink3)
                            }
                            .foregroundColor(NT.purpleDeep).frame(maxWidth: .infinity).frame(height: 92)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.lilacLine, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                        }
                        .buttonStyle(PressableStyle(scale: 0.96))
                    }
                }
                .padding(10).padding(.bottom, 100)
            }
        }
        .background(Color(hex: 0xEEF0F5))
    }

    private func tile(_ i: NPHMenuItem, in c: NPHCategory) -> some View {
        let n = model.qty(item: i.id)
        let disabled = i.isSoldOut || (i.offHours ?? false)
        return Button {
            guard !disabled else { return }
            if model.isOpenPrice(i, in: c) { amountTarget = AmountTarget(item: i, category: c); return }
            if !model.groups(i).isEmpty { optionItem = i; return }
            model.add(i)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(i.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(disabled ? NT.ink3 : NT.ink)
                    .multilineTextAlignment(.leading).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
                HStack {
                    if i.isSoldOut { Text("売切").font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.danger) }
                    else if i.offHours ?? false { Text("時間外").font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.warn) }
                    else if model.isOpenPrice(i, in: c) { Text("金額入力").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3) }
                    else { Text(yen(i.price)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit() }
                    Spacer(minLength: 0)
                    if !model.groups(i).isEmpty { Image(systemName: "slider.horizontal.3").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3) }
                }
            }
            .padding(10).frame(height: 92)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(n > 0 ? NT.lilac : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(n > 0 ? NT.purple : NT.line, lineWidth: n > 0 ? 1.5 : 1))
            .overlay(alignment: .topTrailing) {
                if n > 0 {
                    Text("\(n)").font(.system(size: 12, weight: NT.strong)).foregroundColor(.white)
                        .frame(minWidth: 24, minHeight: 24).background(Circle().fill(NT.purple)).offset(x: 6, y: -6)
                }
            }
            .opacity(disabled ? 0.55 : 1)
        }
        .buttonStyle(PressableStyle(scale: 0.96))
    }

    private var cartBar: some View {
        Button { confirmOpen = true } label: {
            HStack(spacing: 10) {
                Text("\(model.count)").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.purple)
                    .frame(minWidth: 30, minHeight: 30).background(Circle().fill(Color.white))
                Text("注文を確認").font(.system(size: 18, weight: NT.strong))
                Spacer()
                Text(NT.yen(model.total)).font(.system(size: 18, weight: NT.strong)).monospacedDigit()
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold))
            }
            .foregroundColor(.white).padding(.horizontal, 16).frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
            .shadow(color: NT.purple.opacity(0.35), radius: 10, y: 4)
        }
        .buttonStyle(PressableStyle())
        .padding(.horizontal, 12).padding(.bottom, 10)
    }
}

// MARK: - 選択肢（サイズ・トッピング・選べるメイン）

struct NPHOptionSheet: View {
    let item: NPHMenuItem
    let groups: [NPHOptionGroup]
    let onDone: ([String]) -> Void
    @State private var picked: [String: Set<String>] = [:]

    private func problem(_ g: NPHOptionGroup) -> String? {
        let n = picked[g.id]?.count ?? 0
        let min = max(g.isRequired ? 1 : 0, g.minSelect)
        if n < min { return min == 1 ? "1つ選んでください" : "\(min)つ以上選んでください" }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(item.name).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).padding(.top, 20).padding(.horizontal, 18).lineLimit(2)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(groups) { g in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Text(g.name).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                                if g.isRequired || g.minSelect > 0 {
                                    Text("必須").font(.system(size: 11, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Capsule().fill(NT.danger))
                                }
                                if g.maxSelect > 1 { Text("\(g.maxSelect)つまで").font(.system(size: 12)).foregroundColor(NT.ink3) }
                                Spacer()
                            }
                            ForEach(g.items) { o in
                                let on = picked[g.id]?.contains(o.id) ?? false
                                Button { toggle(g, o.id) } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: on ? (g.maxSelect == 1 ? "largecircle.fill.circle" : "checkmark.square.fill") : (g.maxSelect == 1 ? "circle" : "square"))
                                            .font(.system(size: 20, weight: .semibold)).foregroundColor(on ? NT.purple : NT.ink3)
                                        Text(o.name).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                                        Spacer()
                                        if o.price != 0 { Text("+\(NT.yen(Int(o.price)))").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2) }
                                    }
                                    .padding(.horizontal, 14).frame(height: 50)
                                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NT.lilac : NT.page))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                    }
                }
                .padding(18)
            }
            let firstProblem = groups.compactMap { problem($0) }.first
            Button {
                guard firstProblem == nil else { return }
                onDone(groups.flatMap { g in g.items.filter { picked[g.id]?.contains($0.id) ?? false }.map(\.id) })
            } label: {
                Text(firstProblem ?? "カートに入れる").font(.system(size: 17, weight: NT.strong)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(firstProblem == nil ? NT.purple : NT.ink3))
            }
            .buttonStyle(PressableStyle())
            .padding(.horizontal, 18).padding(.bottom, 14)
        }
    }

    private func toggle(_ g: NPHOptionGroup, _ id: String) {
        var s = picked[g.id] ?? []
        if s.contains(id) { s.remove(id) }
        else if g.maxSelect <= 1 { s = [id] }
        else if s.count < g.maxSelect { s.insert(id) }
        picked[g.id] = s
    }
}

// MARK: - 金額入力（¥0 の商品・その他）

struct NPHAmountSheet: View {
    let title: String
    let askMemo: Bool
    let onDone: (Int, String) -> Void
    @State private var text = ""
    @State private var memo = ""

    var body: some View {
        VStack(spacing: 14) {
            Text(title).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(2).padding(.top, 20).padding(.horizontal, 18)
            Text(NT.yen(Int(text) ?? 0)).font(.system(size: 40, weight: NT.strong)).foregroundColor(text.isEmpty ? NT.ink3 : NT.ink).monospacedDigit()
            if askMemo {
                TextField("内容（例：持ち込み料）", text: $memo)
                    .font(.system(size: 16)).padding(.horizontal, 14).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
                    .padding(.horizontal, 18)
            }
            NPHKeypad(text: $text, maxLength: 7)
            Button {
                guard let n = Int(text), n >= 0 else { return }
                onDone(n, memo)
            } label: {
                Text("カートに入れる").font(.system(size: 17, weight: NT.strong)).foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(text.isEmpty ? NT.ink3 : NT.purple))
            }
            .buttonStyle(PressableStyle())
            .disabled(text.isEmpty)
            .padding(.horizontal, 18)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - 注文の確認 → 送信

struct NPHConfirmSheet: View {
    @ObservedObject var model: NativePhoneOrderModel
    let onSent: (Int) -> Void
    @State private var memoKey: String?
    @State private var memoDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("注文の確認").font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer()
                Text("\(model.count)点 \(NT.yen(model.total))").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2).monospacedDigit()
            }
            .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 10)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(model.cart) { l in line(l) }
                }
                .padding(.horizontal, 14)
            }
            if let m = model.message {
                Text(m).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger).padding(.horizontal, 18).padding(.top, 6)
            }
            Button {
                Task {
                    if let n = await model.submit() {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        onSent(n)
                    } else {
                        UINotificationFeedbackGenerator().notificationOccurred(.error)
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    if model.sending { ProgressView().tint(.white) } else { Image(systemName: "paperplane.fill") }
                    Text(model.sending ? "送信中…" : "注文を送信（厨房へ）")
                }
                .font(.system(size: 18, weight: NT.strong)).foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 58)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(model.cart.isEmpty ? NT.ink3 : NT.purple))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.sending || model.cart.isEmpty)
            .padding(14)
        }
        .alert("メモ（厨房へ）", isPresented: Binding(get: { memoKey != nil }, set: { if !$0 { memoKey = nil } })) {
            TextField("例：辛さ控えめ", text: $memoDraft)
            Button("保存") { if let k = memoKey { model.setMemo(k, memoDraft) }; memoKey = nil }
            Button("やめる", role: .cancel) { memoKey = nil }
        }
    }

    private func line(_ l: NPHCartLine) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
                    if !l.optionLabel.isEmpty { Text(l.optionLabel).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(2) }
                    if let m = l.memo { Text("※ \(m)").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.warn).lineLimit(2) }
                }
                Spacer(minLength: 4)
                Text(NT.yen(l.unitPrice * l.quantity)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            HStack(spacing: 8) {
                if l.custom == nil {
                    Button { memoDraft = l.memo ?? ""; memoKey = l.key } label: {
                        Label("メモ", systemImage: "square.and.pencil").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                            .padding(.horizontal, 10).frame(height: 34).background(Capsule().fill(NT.page))
                    }
                    .buttonStyle(PressableStyle())
                }
                Spacer()
                stepper(l)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func stepper(_ l: NPHCartLine) -> some View {
        HStack(spacing: 0) {
            Button { model.change(l.key, by: -1) } label: {
                Image(systemName: l.quantity == 1 ? "trash" : "minus").font(.system(size: 14, weight: .bold))
                    .foregroundColor(l.quantity == 1 ? NT.danger : NT.ink).frame(width: 42, height: 36)
            }
            Text("\(l.quantity)").font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).frame(minWidth: 30).monospacedDigit()
            Button { model.change(l.key, by: 1) } label: {
                Image(systemName: "plus").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).frame(width: 42, height: 36)
            }
            .disabled(l.quantity >= 20)
        }
        .background(Capsule().fill(NT.page))
        .buttonStyle(PressableStyle())
    }
}

// MARK: - 画面の切り替え（卓 ↔ 注文）

/// iPhone ハンディの卓・お客様情報・注文（Web の /handy/<卓>・/setup・/order の代わり）
struct NativePhoneHandyScreen: View {
    @EnvironmentObject var state: AppState
    let route: AppState.PhoneHandyRoute
    @StateObject private var table: NativePhoneTableModel
    @State private var order: NativePhoneOrderModel?
    @State private var setup: NativePhoneSetupModel?

    init(route: AppState.PhoneHandyRoute) {
        self.route = route
        _table = StateObject(wrappedValue: NativePhoneTableModel(tableId: route.tableId))
        _order = State(initialValue: route.orderId.map { NativePhoneOrderModel(orderId: $0) })
        _setup = State(initialValue: route.setup && route.orderId == nil ? NativePhoneSetupModel(tableId: route.tableId) : nil)
    }

    var body: some View {
        ZStack {
            NativePhoneTableView(model: table,
                                 onBack: { state.closePhoneHandy() },
                                 onOrder: { id in withAnimation(.easeOut(duration: 0.18)) { order = NativePhoneOrderModel(orderId: id) } },
                                 onSetup: { withAnimation(.easeOut(duration: 0.18)) { setup = NativePhoneSetupModel(tableId: route.tableId) } })
            if let s = setup {
                NativePhoneSetupView(model: s, onBack: {
                    // テーブル一覧から来たときは一覧へ、卓の画面から来たときは卓へ
                    if route.setup { state.closePhoneHandy() } else { withAnimation(.easeOut(duration: 0.18)) { setup = nil } }
                }, onStarted: { id in
                    withAnimation(.easeOut(duration: 0.18)) { setup = nil; order = NativePhoneOrderModel(orderId: id) }
                    Task { await table.refresh() }
                }, onRedirect: { id in state.openPhoneHandy(tableId: id) })
                .transition(.move(edge: .trailing))
                .zIndex(1)
            }
            if let o = order {
                NativePhoneOrderView(model: o, onBack: { sent in
                    withAnimation(.easeOut(duration: 0.18)) { order = nil }
                    if let n = sent, n > 0 { table.toast = "\(n)点 送信しました" }
                    Task { await table.refresh() }
                })
                .transition(.move(edge: .trailing))
                .zIndex(2)
            }
        }
        .onChange(of: table.redirectTableId) { id in
            if let id { state.openPhoneHandy(tableId: id) }
        }
    }
}
