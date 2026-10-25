import SwiftUI

// iPhone の店長・オーナー：設定の中の画面（メニュー）。2026-10-25 Ronnie「101% native」
//   品切れ（売切・販売再開）・メニュー／プラン（値段・表示・売切・1 品の編集）・カテゴリ（色・振り分け）・オプション（選択肢・対象の商品）・QRのサービス
// 読み込み・操作は iPad と同じモデル（NativeSettingsPages.swift の NativeSoldOutModel・NativeMenuItemsModel など）。
// コースの料理・選べるメイン・出すカテゴリの組み立て（iPad の NativeCourseBuilder）は iPad・PC で（iPhone は値段・時間・表示だけ）

// MARK: - 品切れ（/app/pos/sold-out）

struct NPSSoldOutPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeSoldOutModel

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeSoldOutModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeSoldOutModel())
    }

    var body: some View {
        NPSPageFrame(title: "品切れ", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            NPZSearchField(text: $model.query, placeholder: "商品名・フリガナで探す")
            HStack(spacing: 6) {
                NPOCChip(text: "すべて", selected: !model.onlySoldOut) { model.onlySoldOut = false }
                NPOCChip(text: "売切中 \(model.soldOutCount)", selected: model.onlySoldOut) { model.onlySoldOut = true }
                Spacer()
            }
            Text("押すと売切／販売再開。レジ・ハンディ・お客様QRにすぐ反映されます").font(.system(size: 12)).foregroundColor(NT.ink3).padding(.leading, 4)
            let secs = model.sections
            if secs.isEmpty {
                NPOCEmpty(icon: "fork.knife", title: model.onlySoldOut ? "売切中の商品はありません" : "商品がありません")
            }
            ForEach(secs) { s in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(s.name).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink)
                        let n = s.items.filter(\.isSoldOut).count
                        if n > 0 { NOSBadge(text: "売切 \(n)", color: NT.danger) }
                    }
                    .padding(.leading, 4)
                    ForEach(s.items) { it in row(it) }
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }

    private func row(_ it: NSOItem) -> some View {
        let locked = it.shared && !(model.payload?.canManageShared ?? false)
        let busy = model.busy.contains(it.id)
        return Button { Task { await model.toggle(it) } } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.name).font(.system(size: 15.5, weight: .bold)).foregroundColor(it.isSoldOut ? NT.ink3 : NT.ink).lineLimit(2)
                        .strikethrough(it.isSoldOut, color: NT.ink3).multilineTextAlignment(.leading)
                    HStack(spacing: 5) {
                        Text(NT.yen(Int(it.price))).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
                        if it.shared { NPSTag(text: "全店共通") }
                        if locked { Image(systemName: "lock").font(.system(size: 10)).foregroundColor(NT.ink3) }
                    }
                }
                Spacer(minLength: 6)
                if busy {
                    ProgressView().frame(width: 66)
                } else {
                    Text(it.isSoldOut ? "売切" : "販売中").font(.system(size: 13, weight: .heavy)).foregroundColor(it.isSoldOut ? .white : NT.ok)
                        .frame(width: 66, height: 32)
                        .background(Capsule().fill(it.isSoldOut ? NT.danger : NT.ok.opacity(0.12)))
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(it.isSoldOut ? NT.dangerBg : Color.white))
        }
        .buttonStyle(PressableStyle(scale: 0.985))
        .disabled(locked || busy)
    }
}

// MARK: - メニュー・プラン（/app/settings/menu・/app/settings/plans）

struct NPSMenuItemsPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeMenuItemsModel

    init(mode: NMIMode, backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeMenuItemsModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeMenuItemsModel(mode: mode))
    }

    private var isPlan: Bool { model.mode == .plan }

    var body: some View {
        NPSPageFrame(title: isPlan ? "プラン" : "メニュー", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload?.canEdit == true { NPOCBarButton(icon: "plus", label: "追加") { model.startAdd() } }
        }) {
            if let p = model.payload { content(p) }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .sheet(isPresented: $model.showForm) {
            if let p = model.payload {
                NPSMenuItemForm(model: model, payload: p)
                    .presentationDetents([.large])
            }
        }
    }

    @ViewBuilder private func content(_ p: NMIPayload) -> some View {
        if !p.canEdit { NPSLockNote(text: "メニューの変更は店長以上のアカウントで") }
        if isPlan {
            NOMNote(text: "コースの料理・選べるメイン・プランで出すカテゴリの組み立ては iPad・PC で。iPhone では値段・時間・表示・売切を変えられます。")
        }
        NPZSearchField(text: $model.query, placeholder: "商品名・フリガナで探す")
        if !isPlan && !p.categories.isEmpty {
            NPZChipRow(items: [("", "すべて")] + p.categories.sorted { $0.sortOrder < $1.sortOrder }.map { ($0.id, $0.name) },
                       selection: model.categoryFilter ?? "") { v in model.categoryFilter = v.isEmpty ? nil : v }
        }
        let secs = model.sections
        if secs.isEmpty {
            NPOCEmpty(icon: isPlan ? "list.bullet.rectangle" : "fork.knife", title: isPlan ? "コース・放題プランがまだありません" : "商品が見つかりません")
        }
        ForEach(Array(secs.enumerated()), id: \.offset) { _, sec in
            VStack(alignment: .leading, spacing: 6) {
                Text(sec.0?.name ?? "カテゴリなし").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.ink).padding(.leading, 4)
                VStack(spacing: 0) {
                    ForEach(Array(sec.1.enumerated()), id: \.element.id) { i, it in
                        row(it, p)
                        if i < sec.1.count - 1 { NPZDivider(inset: 12) }
                    }
                }
                .background(npocCard())
            }
        }
    }

    private func row(_ it: NMIItem, _ p: NMIPayload) -> some View {
        let hidden = it.status == "hidden"
        return HStack(spacing: 10) {
            Button { if p.canEdit { model.startEdit(it) } } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(it.name).font(.system(size: 15, weight: .bold)).foregroundColor(hidden ? NT.ink3 : NT.ink).lineLimit(2)
                        .strikethrough(hidden, color: NT.ink3).multilineTextAlignment(.leading)
                    HStack(spacing: 4) {
                        Text(NT.yen(Int(it.price))).font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                        if let t = it.takeoutPrice { Text("TO \(NT.yen(Int(t)))").font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit() }
                        if it.shared { NPSTag(text: "全店共通") }
                        if hidden { NPSTag(text: "非表示") }
                        if it.pricePending { NPSTag(text: "価格未設定", color: NT.danger) }
                        if it.itemType == "course", let m = it.durationMinutes { NPSTag(text: "\(Int(m))分", color: NT.purple) }
                    }
                    if let s = it.sellStartTime, let e = it.sellEndTime {
                        Text("販売 \(s)〜\(e)").font(.system(size: 11)).foregroundColor(NT.ink3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                if p.canEdit {
                    Button { model.startEdit(it) } label: { Label("編集", systemImage: "pencil") }
                    Button { quickHidden(it) } label: { Label(hidden ? "表示する" : "非表示にする", systemImage: hidden ? "eye" : "eye.slash") }
                }
            }
            if model.busy == it.id {
                ProgressView().frame(width: 60)
            } else {
                Button { Task { await model.toggleSoldOut(it) } } label: {
                    Text(it.isSoldOut ? "売切" : "販売中").font(.system(size: 12, weight: .heavy)).foregroundColor(it.isSoldOut ? .white : NT.ok)
                        .frame(width: 60, height: 30)
                        .background(Capsule().fill(it.isSoldOut ? NT.danger : NT.ok.opacity(0.12)))
                }
                .buttonStyle(PressableStyle())
                .disabled(!p.canEdit || model.busy != nil)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
    }

    /// 表示／非表示だけ変える（ほかの項目は今のまま。保存は Web と同じ menuItemSave）
    private func quickHidden(_ it: NMIItem) {
        model.startEdit(it)
        model.fHidden.toggle()
        model.showForm = false
        Task { await model.save() }
    }
}

/// 1 品の追加・編集（Web の menu-item-dialog と同じ項目）
struct NPSMenuItemForm: View {
    @ObservedObject var model: NativeMenuItemsModel
    let payload: NMIPayload
    @State private var confirmDelete = false

    private var isPlan: Bool { model.mode == .plan }
    private var times: [String] { NSPApi.timeOptions(toMin: 23 * 60 + 45) }

    var body: some View {
        NPOCSheetFrame(title: model.editing == nil ? (isPlan ? "プランを追加" : "商品を追加") : (isPlan ? "プランを編集" : "商品を編集"),
                       confirmText: "保存", busy: model.busy == "save", onCancel: { model.showForm = false }, onConfirm: {
                           if model.fName.trimmingCharacters(in: .whitespaces).isEmpty { model.toast = "商品名を入力してください"; return }
                           Task { await model.save() }
                       }) {
            NPSInput(label: "商品名", text: $model.fName, placeholder: "例：生ビール", required: true)
            NPSInput(label: "英語名", text: $model.fNameEn, placeholder: "Draft beer")
            NPSInput(label: "フリガナ", text: $model.fKana, placeholder: "ナマビール")
            if !isPlan {
                NPOCField(label: "種別") { NPSChoice(options: model.typesForMode.map { ($0.id, $0.label) }, selection: model.fType) { model.fType = $0 } }
            }
            NPOCField(label: "カテゴリ") {
                Menu {
                    Button("カテゴリなし") { model.fCategory = nil }
                    ForEach(payload.categories.sorted { $0.sortOrder < $1.sortOrder }) { c in Button(c.name) { model.fCategory = c.id } }
                } label: {
                    HStack {
                        Text(model.categoryName(model.fCategory)).font(.system(size: 16, weight: .semibold)).foregroundColor(NT.ink)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .npocInputBox()
                }
            }
            HStack(spacing: 8) {
                NPSInput(label: "価格", text: $model.fPrice, placeholder: "0", keyboard: .numberPad, suffix: "円", required: true)
                NPSInput(label: "テイクアウト", text: $model.fTakeout, placeholder: "同じ", keyboard: .numberPad, suffix: "円")
            }
            NPSInput(label: "原価（手入力）", text: $model.fCost, placeholder: "—", keyboard: .numberPad, suffix: "円")
            NPOCField(label: "税率") {
                NPSChoice(options: [("", "既定")] + payload.taxRates.map { ($0.id, $0.name) }, selection: model.fTax ?? "") { model.fTax = $0.isEmpty ? nil : $0 }
            }
            if model.fType == "course" {
                NPSInput(label: "時間", text: $model.fDuration, placeholder: "120", keyboard: .numberPad, suffix: "分")
            }
            NPOCField(label: "販売時間（空なら終日）") {
                HStack(spacing: 8) {
                    NPSTimeMenu(value: model.fStart, options: times) { model.fStart = $0 }
                    Text("〜").foregroundColor(NT.ink3)
                    NPSTimeMenu(value: model.fEnd, options: times) { model.fEnd = $0 }
                    Spacer()
                }
            }
            NPSInput(label: "説明", text: $model.fDesc, placeholder: "", multiline: true)
            NPSInput(label: "並び順", text: $model.fSort, placeholder: "0", keyboard: .numberPad)
            NPSToggleRow(title: "非表示", sub: model.fHidden ? "レジ・ハンディ・お客様QRに出しません" : "表示しています", isOn: $model.fHidden)
                .padding(12).background(npocCard(14))
            if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
            if model.editing != nil {
                NPOCWideButton(text: "この商品を削除", icon: "trash", kind: .secondary, height: 46) { confirmDelete = true }
            }
        }
        .confirmationDialog("商品を削除しますか？", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("削除する", role: .destructive) { if let e = model.editing { Task { await model.delete(e) } } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「\(model.editing?.name ?? "")」を削除します。過去の伝票の名前は残ります")
        }
    }
}

// MARK: - カテゴリ（/app/settings/categories）

struct NPSCategoriesPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeCategoriesModel
    @State private var confirmDelete: NCTRow?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeCategoriesModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeCategoriesModel())
    }

    var body: some View {
        NPSPageFrame(title: "カテゴリ", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload?.canEdit == true { NPOCBarButton(icon: "plus", label: "追加") { model.startAdd() } }
        }) {
            if let p = model.payload {
                if !p.canEdit { NPSLockNote(text: "カテゴリの変更は店長以上のアカウントで") }
                Text("振り分け：注文がどの厨房プリンター（キッチン・ドリンク・焼き場など）に出るか").font(.system(size: 12)).foregroundColor(NT.ink3).padding(.leading, 4)
                if p.rows.isEmpty { NPOCEmpty(icon: "square.grid.2x2", title: "カテゴリがまだありません") }
                ForEach(p.rows) { r in row(r, p) }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("カテゴリを削除しますか？", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible, presenting: confirmDelete) { r in
            Button("削除する", role: .destructive) { Task { await model.delete(r) } }
            Button("やめる", role: .cancel) {}
        } message: { r in Text("「\(r.name)」を削除します（中の商品はカテゴリなしになります）") }
        .sheet(isPresented: $model.showForm) {
            if let p = model.payload {
                NPOCSheetFrame(title: model.editing == nil ? "カテゴリを追加" : "カテゴリを編集", confirmText: "保存", busy: model.busy == "save",
                               onCancel: { model.showForm = false }, onConfirm: {
                                   if model.name.trimmingCharacters(in: .whitespaces).isEmpty { model.toast = "カテゴリ名を入力してください"; return }
                                   Task { await model.save() }
                               }) {
                    NPSInput(label: "カテゴリ名", text: $model.name, placeholder: "例：ドリンク・前菜", required: true)
                    NPSInput(label: "英語名", text: $model.nameEn, placeholder: "Drinks")
                    NPOCField(label: "色") {
                        WrapLayout(spacing: 8) {
                            ForEach(p.colors, id: \.self) { c in
                                Button { model.color = c } label: {
                                    RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Self.color(c)).frame(width: 38, height: 38)
                                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(model.color == c ? NT.ink : Color.clear, lineWidth: 3))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                    }
                    NPSInput(label: "並び順", text: $model.sortOrder, placeholder: "0", keyboard: .numberPad)
                    if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
                }
                .presentationDetents([.large])
            }
        }
    }

    private func row(_ r: NCTRow, _ p: NCTPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Self.color(r.color)).frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Text(r.name).font(.system(size: 15.5, weight: .heavy)).foregroundColor(NT.ink)
                        if r.shared { NPSTag(text: "全店共通") }
                    }
                    Text("\(r.nameEn.isEmpty ? "" : r.nameEn + "・")並び \(r.sortOrder)").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 4)
                if model.busy == r.id { ProgressView() }
                if p.canEdit {
                    Menu {
                        Button { model.startEdit(r) } label: { Label("編集", systemImage: "pencil") }
                        Button(role: .destructive) { confirmDelete = r } label: { Label("削除", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.system(size: 20, weight: .semibold)).foregroundColor(NT.ink2).frame(width: 38, height: 38)
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(p.stations) { st in
                        let on = r.station == st.id
                        Button { Task { await model.setStation(r, st.id) } } label: {
                            Text(st.label).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NT.ink2)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(Capsule().fill(on ? NT.topBar : Color.white))
                                .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(!p.canEdit || model.busy != nil)
                    }
                }
            }
        }
        .padding(12).background(npocCard(14))
    }

    static func color(_ hex: String) -> Color { Color(hex: UInt32(hex.dropFirst(), radix: 16) ?? 0xBC5940) }
}

// MARK: - オプション（/app/settings/options）

struct NPSOptionsPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeOptionsModel
    @State private var confirmDeleteGroup: NOGGroup?
    @State private var confirmDeleteItem: NOGItem?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeOptionsModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeOptionsModel())
    }

    var body: some View {
        NPSPageFrame(title: "オプション", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload?.canEdit == true { NPOCBarButton(icon: "plus", label: "グループ") { model.startAdd() } }
        }) {
            if let p = model.payload {
                if p.groups.isEmpty { NPOCEmpty(icon: "slider.horizontal.3", title: "選択肢のグループがまだありません", note: "例：サイズ・トッピング・辛さ") }
                ForEach(Array(p.groups.enumerated()), id: \.element.id) { idx, g in group(g, idx: idx, p) }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("グループを削除しますか？", isPresented: Binding(get: { confirmDeleteGroup != nil }, set: { if !$0 { confirmDeleteGroup = nil } }), titleVisibility: .visible, presenting: confirmDeleteGroup) { g in
            Button("削除する", role: .destructive) { Task { await model.deleteGroup(g) } }
            Button("やめる", role: .cancel) {}
        } message: { g in Text("「\(g.name)」と中の選択肢を削除します") }
        .confirmationDialog("選択肢を消しますか？", isPresented: Binding(get: { confirmDeleteItem != nil }, set: { if !$0 { confirmDeleteItem = nil } }), titleVisibility: .visible, presenting: confirmDeleteItem) { it in
            Button("消す", role: .destructive) { Task { await model.deleteItem(it) } }
            Button("やめる", role: .cancel) {}
        } message: { it in Text("「\(it.name)」を消します") }
        .sheet(isPresented: $model.showForm) {
            NPOCSheetFrame(title: model.editing == nil ? "グループを追加" : "グループを編集", confirmText: "保存", busy: model.busy == "save",
                           onCancel: { model.showForm = false }, onConfirm: {
                               if model.gName.trimmingCharacters(in: .whitespaces).isEmpty { model.toast = "グループ名を入力してください"; return }
                               Task { await model.saveGroup() }
                           }) {
                NPSInput(label: "グループ名", text: $model.gName, placeholder: "例：サイズ・トッピング", required: true)
                NPSToggleRow(title: "必須", sub: model.gRequired ? "必ず選ぶ" : "選ばなくてもよい", isOn: $model.gRequired)
                    .padding(12).background(npocCard(14))
                HStack(spacing: 8) {
                    NPSInput(label: "選ぶ数（最小）", text: $model.gMin, placeholder: "0", keyboard: .numberPad)
                    NPSInput(label: "選ぶ数（最大）", text: $model.gMax, placeholder: "1", keyboard: .numberPad)
                }
                if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
            }
            .presentationDetents([.large])
        }
        .sheet(item: $model.linking) { g in
            NPSOptionLinkSheet(model: model, group: g)
                .presentationDetents([.large])
        }
    }

    private func group(_ g: NOGGroup, idx: Int, _ p: NOGPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(g.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                NPSTag(text: g.isRequired ? "必須・\(g.minSelect)〜\(g.maxSelect)" : "任意・最大\(g.maxSelect)", color: g.isRequired ? NT.danger : NT.ink3)
                Spacer(minLength: 4)
                if p.canEdit {
                    Menu {
                        Button { model.startEdit(g) } label: { Label("編集", systemImage: "pencil") }
                        Button { model.startLink(g) } label: { Label("対象の商品（\(g.menuItemIds.count)）", systemImage: "link") }
                        if idx > 0 { Button { Task { await model.move(g, "up") } } label: { Label("上へ", systemImage: "arrow.up") } }
                        if idx < p.groups.count - 1 { Button { Task { await model.move(g, "down") } } label: { Label("下へ", systemImage: "arrow.down") } }
                        Button(role: .destructive) { confirmDeleteGroup = g } label: { Label("削除", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.system(size: 20, weight: .semibold)).foregroundColor(NT.ink2).frame(width: 38, height: 32)
                    }
                }
            }
            if g.items.isEmpty { Text("選択肢がまだありません").font(.system(size: 12.5)).foregroundColor(NT.ink3) }
            ForEach(g.items) { it in
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(it.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                        if let en = it.nameEn, !en.isEmpty { Text(en).font(.system(size: 11)).foregroundColor(NT.ink3) }
                    }
                    Spacer()
                    Text(it.price == 0 ? "±0" : "+\(NT.yen(Int(it.price)))").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purpleDeep).monospacedDigit()
                    if p.canEdit {
                        Button { confirmDeleteItem = it } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundColor(NT.ink3).frame(width: 34, height: 34)
                        }
                        .buttonStyle(.plain).disabled(model.busy == it.id)
                    }
                }
                .padding(.vertical, 2)
            }
            if p.canEdit {
                VStack(spacing: 8) {
                    HStack(spacing: 8) {
                        TextField("選択肢（例：大盛り）", text: Binding(get: { model.newItemName[g.id] ?? "" }, set: { model.newItemName[g.id] = $0 }))
                            .font(.system(size: 15)).npocInputBox()
                        TextField("0", text: Binding(get: { model.newItemPrice[g.id] ?? "" }, set: { model.newItemPrice[g.id] = $0 }))
                            .keyboardType(.numberPad).font(.system(size: 15)).multilineTextAlignment(.trailing).frame(width: 70).npocInputBox()
                        Text("円").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    HStack(spacing: 8) {
                        TextField("English（任意）", text: Binding(get: { model.newItemEn[g.id] ?? "" }, set: { model.newItemEn[g.id] = $0 }))
                            .font(.system(size: 14)).textInputAutocapitalization(.never).npocInputBox()
                        Button { Task { await model.addItem(g) } } label: {
                            HStack(spacing: 4) {
                                if model.busy == "add:\(g.id)" { ProgressView().tint(.white) } else { Image(systemName: "plus") }
                                Text("追加")
                            }
                            .font(.system(size: 14, weight: .heavy)).foregroundColor(.white)
                            .padding(.horizontal, 16).frame(height: 44)
                            .background(Capsule().fill(NT.purple))
                        }
                        .buttonStyle(PressableStyle()).disabled(model.busy != nil)
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
            } else {
                Text("対象の商品：\(g.menuItemIds.count)").font(.system(size: 12.5)).foregroundColor(NT.ink3)
            }
        }
        .padding(14).background(npocCard())
    }
}

/// オプションの対象の商品を選ぶ
struct NPSOptionLinkSheet: View {
    @ObservedObject var model: NativeOptionsModel
    let group: NOGGroup

    var body: some View {
        let q = NativeSoldOutModel.norm(model.linkQuery)
        let list = (model.payload?.menuItems ?? []).filter { q.isEmpty || NativeSoldOutModel.norm($0.name).contains(q) }
        return NPOCSheetFrame(title: "対象の商品（\(model.linkIds.count)）", confirmText: "保存", busy: model.busy == "link",
                              onCancel: { model.linking = nil }, onConfirm: { Task { await model.saveLink() } }) {
            Text("「\(group.name)」を付ける商品を選んでください").font(.system(size: 13)).foregroundColor(NT.ink2)
            NPZSearchField(text: $model.linkQuery, placeholder: "商品名で探す")
            HStack(spacing: 8) {
                NPOCWideButton(text: "すべて選ぶ", kind: .secondary, height: 40) { model.linkIds = model.linkIds.union(list.map(\.id)) }
                NPOCWideButton(text: "すべて外す", kind: .secondary, height: 40) { model.linkIds = model.linkIds.subtracting(list.map(\.id)) }
            }
            LazyVStack(spacing: 0) {
                ForEach(list) { m in
                    let on = model.linkIds.contains(m.id)
                    Button { if on { model.linkIds.remove(m.id) } else { model.linkIds.insert(m.id) } } label: {
                        HStack(spacing: 10) {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.system(size: 20)).foregroundColor(on ? NT.purple : NT.ink3)
                            Text(m.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            Spacer()
                        }
                        .padding(.horizontal, 14).frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    NPZDivider(inset: 44)
                }
            }
            .background(npocCard())
        }
    }
}

// MARK: - QRのサービス（/app/settings/qr-service）

struct NPSQrServicePage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model = NativeQrServiceModel()

    var body: some View {
        NPSPageFrame(title: "QRのサービス", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                Text("お水・お箸など、お客様がQRから無料で頼めるもの（スタッフ呼び出しで届きます）").font(.system(size: 12.5)).foregroundColor(NT.ink2).padding(.horizontal, 4)
                NPOCard {
                    NPSToggleRow(title: "お客様QRに出す", sub: model.enabled ? "出す" : "出さない", isOn: $model.enabled, disabled: !edit)
                }
                ForEach(model.rows.indices, id: \.self) { i in
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            Text("\(i + 1)").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3).frame(width: 20)
                            TextField("お水", text: Binding(get: { i < model.rows.count ? model.rows[i].name : "" }, set: { if i < model.rows.count { model.rows[i].name = $0 } }))
                                .font(.system(size: 15)).disabled(!edit).npocInputBox()
                        }
                        HStack(spacing: 8) {
                            Color.clear.frame(width: 20, height: 1)
                            TextField("Water", text: Binding(get: { i < model.rows.count ? model.rows[i].en : "" }, set: { if i < model.rows.count { model.rows[i].en = $0 } }))
                                .font(.system(size: 14)).textInputAutocapitalization(.never).disabled(!edit).npocInputBox()
                            if edit {
                                Button { if i > 0 { model.rows.swapAt(i, i - 1) } } label: { Image(systemName: "arrow.up").frame(width: 32, height: 40) }.disabled(i == 0)
                                Button { if i < model.rows.count - 1 { model.rows.swapAt(i, i + 1) } } label: { Image(systemName: "arrow.down").frame(width: 32, height: 40) }.disabled(i >= model.rows.count - 1)
                                Button { if i < model.rows.count { model.rows.remove(at: i) } } label: { Image(systemName: "trash").foregroundColor(NT.danger).frame(width: 32, height: 40) }
                            }
                        }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
                    }
                    .padding(12).background(npocCard(14))
                }
                if edit {
                    NPOCWideButton(text: "追加", icon: "plus", kind: .secondary, disabled: model.rows.count >= p.maxItems, height: 44) { model.rows.append(("", "")) }
                    NPOCWideButton(text: "保存する", icon: "square.and.arrow.down", busy: model.busy == "save", disabled: !model.changed) { Task { await model.save() } }
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }
}
