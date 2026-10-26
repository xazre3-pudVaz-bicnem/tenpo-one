import SwiftUI

// iPhone の店長・オーナー：決済・端末（Web の /app/settings/payments。2026-10-25 Ronnie「101% native」）
//   会計の選択肢（値引き・ポイント・クレジット／QR／電子マネー／外部端末の種類）・stera 連携（追加・停止・コードの作り直し・削除）・
//   決済端末（Stripe Terminal）・予約の決済（現地払い・全額決済・予約金）
// 読み込み・操作は iPad と同じ NativePaymentsModel（GET part=payments ／ POST checkoutPresetsSave・steraAdd・steraUpdate・steraRegen・steraDelete・
// readerAdd・readerDelete・bookingPaymentSave）。作り直し・削除は必ず確認を出す

struct NPSPaymentsPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativePaymentsModel
    @State private var confirm: Confirm?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativePaymentsModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativePaymentsModel())
    }

    enum Confirm: Identifiable {
        case steraRegen(NPYStera), steraDelete(NPYStera), readerDelete(NPYReader)
        var id: String { switch self { case .steraRegen(let t): return "r" + t.id; case .steraDelete(let t): return "d" + t.id; case .readerDelete(let r): return "x" + r.id } }
        var title: String { switch self { case .steraRegen: return "リンクコードを作り直しますか？"; case .steraDelete: return "stera 端末を削除しますか？"; case .readerDelete: return "決済端末を削除しますか？" } }
        var message: String {
            switch self {
            case .steraRegen(let t): return "「\(t.name)」の今のコードは使えなくなります。端末のアプリにもう一度新しいコードを入れてください"
            case .steraDelete(let t): return "「\(t.name)」を一覧から消します。決済の記録は残ります"
            case .readerDelete(let r): return "「\(r.label)」を削除します。この操作は取り消せません"
            }
        }
        var ok: String { switch self { case .steraRegen: return "作り直す"; default: return "削除する" } }
        var done: String { switch self { case .steraRegen: return "作り直しました"; default: return "削除しました" } }
        var body: [String: Any] {
            switch self {
            case .steraRegen(let t): return ["type": "steraRegen", "id": t.id]
            case .steraDelete(let t): return ["type": "steraDelete", "id": t.id]
            case .readerDelete(let r): return ["type": "readerDelete", "id": r.id]
            }
        }
    }

    var body: some View {
        NPSPageFrame(title: "決済・端末", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                status(p)
                NPZChipRow(items: NativePaymentsModel.Tab.allCases.map { ($0.rawValue, $0.label) }, selection: model.tab.rawValue) { v in
                    if let t = NativePaymentsModel.Tab(rawValue: v) { model.tab = t }
                }
                switch model.tab {
                case .presets: presetsTab(p)
                case .stera: steraTab(p)
                case .readers: readersTab(p)
                case .booking: bookingTab(p)
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { c in
            Button(c.ok, role: .destructive) { Task { _ = await model.run(c.id, c.body, done: c.done) } }
            Button("やめる", role: .cancel) {}
        } message: { c in Text(c.message) }
    }

    // MARK: 上：Stripe と stera のつながり

    private func status(_ p: NPYPayload) -> some View {
        let steraOn = p.stera.terminals.contains { $0.online }
        return HStack(spacing: 8) {
            chip("Stripe", p.stripe.configured ? (p.stripe.testMode ? "テストモード" : "本番") : "未接続", p.stripe.configured ? (p.stripe.testMode ? NT.warn : NT.ok) : NT.ink3)
            chip("stera", steraOn ? "接続済み" : (p.stera.terminals.isEmpty ? "手動運用" : "未接続"), steraOn ? NT.ok : NT.ink3)
            Spacer(minLength: 0)
        }
    }

    private func chip(_ name: String, _ st: String, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(name).font(.system(size: 12.5, weight: NT.strong)).foregroundColor(NT.ink)
            Text(st).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2)
        }
        .padding(.horizontal, 11).frame(height: 32)
        .background(Capsule().fill(Color.white))
    }

    // MARK: 会計の選択肢

    @ViewBuilder private func presetsTab(_ p: NPYPayload) -> some View {
        let edit = p.canEdit
        if !edit { NPSLockNote(text: "会計の選択肢は店長以上のアカウントで変えられます") }
        NPOCard(title: "値引きの選択肢", trailing: "会計画面のボタン") {
            ForEach(Array(model.discounts.enumerated()), id: \.element.key) { i, d in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        TextField("例：幹事様無料", text: Binding(get: { i < model.discounts.count ? model.discounts[i].name : "" },
                                                            set: { if i < model.discounts.count { model.discounts[i].name = $0 } }))
                            .font(.system(size: 15)).disabled(!edit).npocInputBox()
                        if edit {
                            Button { if i < model.discounts.count { model.discounts.remove(at: i) } } label: {
                                Image(systemName: "trash").foregroundColor(NT.danger).frame(width: 36, height: 44)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    HStack(spacing: 8) {
                        NPSChoice(options: p.discountKinds.map { ($0.id, $0.label) }, selection: d.kind, disabled: !edit) { model.setDiscountKind(i, $0) }
                        if d.kind != "manual" {
                            HStack(spacing: 4) {
                                TextField(d.kind == "percent" ? "10" : "500", text: Binding(get: { d.value > 0 ? String(Int(d.value)) : "" },
                                                                                       set: { v in if i < model.discounts.count { model.discounts[i].value = Double(Int(v.filter(\.isNumber)) ?? 0) } }))
                                    .keyboardType(.numberPad).multilineTextAlignment(.trailing).disabled(!edit)
                                Text(d.kind == "percent" ? "%" : "円").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                            }
                            .font(.system(size: 15)).frame(width: 90).npocInputBox()
                        }
                    }
                }
                .padding(.vertical, 4)
                .overlay(alignment: .bottom) { NPZDivider().offset(y: 4) }
            }
            if edit {
                NPOCWideButton(text: "値引きを足す", icon: "plus", kind: .secondary, disabled: model.discounts.count >= 20, height: 40) {
                    model.discounts.append(NPYDiscount(key: NativePaymentsModel.nextKey(model.discounts.map(\.key), prefix: "disc"), name: "", kind: "manual", value: 0))
                }
            }
        }
        NPOCard(title: "ポイントの選択肢", trailing: "ホットペッパー・ぐるなび など") {
            brandList(Binding(get: { model.brands }, set: { model.brands = $0 }), prefix: "pt", placeholder: "例：ホットペッパー", edit: edit)
        }
        ForEach(p.methods) { m in
            NPOCard(title: m.id == "external" ? "外部端末（決済端末）" : "\(m.label)の種類") {
                Text(m.id == "external" ? "stera はつなぐと自動で出ます。ほかの端末はここで選びます" : "使うものを押して選ぶ（選んだものだけ会計画面に出ます）")
                    .font(.system(size: 12)).foregroundColor(NT.ink3)
                brandPicker(m.id, edit: edit)
            }
        }
        if edit {
            NPOCWideButton(text: "保存する", icon: "square.and.arrow.down", busy: model.busy == "presets", disabled: !model.presetsDirty) { Task { await model.savePresets() } }
        }
    }

    /// 一覧から「使うもの」を選ぶ（順番は一覧の順、自分で足したものは後ろ。iPad と同じ決まり）
    private func brandPicker(_ methodId: String, edit: Bool) -> some View {
        let catalog = NPBrands.catalog(methodId)
        let keys = Set(catalog.map(\.id))
        let current = model.methods[methodId] ?? []
        let chosen = Set(current.map(\.key))
        return VStack(alignment: .leading, spacing: 8) {
            WrapLayout(spacing: 6) {
                ForEach(catalog) { b in
                    let on = chosen.contains(b.id)
                    Button {
                        var picked = chosen
                        if picked.contains(b.id) { picked.remove(b.id) } else { picked.insert(b.id) }
                        let custom = current.filter { !keys.contains($0.key) }
                        let named = Dictionary(current.map { ($0.key, $0.name) }, uniquingKeysWith: { a, _ in a })
                        model.methods[methodId] = catalog.filter { picked.contains($0.id) }.map { NPYBrand(key: $0.id, name: named[$0.id] ?? $0.name) } + custom
                    } label: {
                        HStack(spacing: 4) {
                            if on { Image(systemName: "checkmark").font(.system(size: 11, weight: NT.strong)) }
                            Text(current.first { $0.key == b.id }?.name ?? b.name).font(.system(size: 13.5, weight: .bold)).lineLimit(1)
                        }
                        .foregroundColor(on ? .white : NT.ink2)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(Capsule().fill(on ? NT.purple : Color.white))
                        .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(!edit)
                }
            }
            Text("一覧に無いものは下で足せます").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            brandList(Binding(get: { (model.methods[methodId] ?? []).filter { !keys.contains($0.key) } },
                              set: { custom in model.methods[methodId] = (model.methods[methodId] ?? []).filter { keys.contains($0.key) } + custom }),
                      prefix: methodId, placeholder: methodId == "external" ? "例：楽天ペイ端末" : "例：\(catalog.first?.name ?? "")", edit: edit)
        }
    }

    private func brandList(_ list: Binding<[NPYBrand]>, prefix: String, placeholder: String, edit: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(list.wrappedValue.enumerated()), id: \.element.key) { i, _ in
                HStack(spacing: 6) {
                    TextField(placeholder, text: Binding(get: { i < list.wrappedValue.count ? list.wrappedValue[i].name : "" },
                                                         set: { if i < list.wrappedValue.count { list.wrappedValue[i].name = $0 } }))
                        .font(.system(size: 15)).disabled(!edit).npocInputBox()
                    if edit {
                        Button {
                            var l = list.wrappedValue
                            if i < l.count { l.remove(at: i) }
                            list.wrappedValue = l
                        } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundColor(NT.ink3).frame(width: 36, height: 44) }
                            .buttonStyle(.plain)
                    }
                }
            }
            if edit {
                Button {
                    var l = list.wrappedValue
                    l.append(NPYBrand(key: NativePaymentsModel.nextKey(l.map(\.key), prefix: prefix), name: ""))
                    list.wrappedValue = l
                } label: {
                    Label("足す", systemImage: "plus").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
                .buttonStyle(.plain)
                .disabled(list.wrappedValue.count >= 20)
            }
        }
    }

    // MARK: stera 連携

    @ViewBuilder private func steraTab(_ p: NPYPayload) -> some View {
        if !p.canEditStera { NPSLockNote(text: "stera 端末の追加・変更は店長以上のアカウントで行ってください") }
        if p.stera.terminals.isEmpty { NPOCEmpty(icon: "creditcard.and.123", title: "まだ stera 端末がありません") }
        ForEach(p.stera.terminals) { t in
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: t.online ? "wifi" : "wifi.slash").font(.system(size: 15, weight: .bold)).foregroundColor(t.online ? NT.ok : NT.ink3)
                    Text(t.name).font(.system(size: 15.5, weight: NT.strong)).foregroundColor(NT.ink)
                    if !t.active { NPSTag(text: "停止中") }
                    Spacer()
                }
                Text([t.terminalNo.map { "端末番号 \($0)" }, t.online ? "つながっています" : (t.lastSeenLabel.map { "最後の接続 \($0)" } ?? "まだ接続がありません"), t.appVersion.map { "アプリ \($0)" }]
                        .compactMap { $0 }.joined(separator: "・"))
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3)
                HStack(spacing: 6) {
                    Image(systemName: "key").font(.system(size: 13, weight: .bold))
                    Text(Self.linkCode(t.linkCode)).font(.system(size: 17, weight: NT.strong, design: .monospaced)).tracking(1.5)
                }
                .foregroundColor(NT.purpleDeep)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.lilac))
                if p.canEditStera {
                    HStack(spacing: 6) {
                        NPOCWideButton(text: t.active ? "停止" : "再開", kind: .secondary, disabled: model.busy != nil, height: 38) {
                            Task { _ = await model.run("stera" + t.id, ["type": "steraUpdate", "id": t.id, "active": !t.active], done: t.active ? "停止しました" : "再開しました") }
                        }
                        NPOCWideButton(text: "コード作り直し", kind: .secondary, disabled: model.busy != nil, height: 38) { confirm = .steraRegen(t) }
                        NPOCWideButton(text: "削除", kind: .secondary, disabled: model.busy != nil, height: 38) { confirm = .steraDelete(t) }
                    }
                }
            }
            .padding(12).background(npocCard(14))
        }
        if p.canEditStera {
            NPOCard(title: "stera 端末を追加") {
                TextField("例：レジ横 stera", text: $model.steraName).font(.system(size: 15)).npocInputBox()
                TextField("端末番号（任意）", text: $model.steraNo).font(.system(size: 15)).npocInputBox()
                NPOCWideButton(text: "追加する", icon: "plus", busy: model.busy == "steraAdd", disabled: model.steraName.trimmingCharacters(in: .whitespaces).isEmpty, height: 44) {
                    Task { await model.addStera() }
                }
            }
        }
        Text("端末の「TENPO ONE 連携」アプリにリンクコードを入れます（サーバー：\(p.stera.serverUrl)）").font(.system(size: 11.5)).foregroundColor(NT.ink3).padding(.horizontal, 4)
    }

    static func linkCode(_ code: String) -> String {
        stride(from: 0, to: code.count, by: 4).map { i in String(code.dropFirst(i).prefix(4)) }.joined(separator: "-")
    }

    // MARK: 決済端末（Stripe Terminal）

    @ViewBuilder private func readersTab(_ p: NPYPayload) -> some View {
        if !p.stripe.testMode {
            NOMNote(text: p.stripe.configured ? "本番キーのため、シミュレーション端末は登録できません" : "Stripe が未接続です")
        }
        if p.readers.isEmpty { NPOCEmpty(icon: "wave.3.right", title: "決済端末がありません") }
        ForEach(p.readers) { r in
            HStack(spacing: 10) {
                Circle().fill(r.status == "online" ? NT.ok : (r.status == "offline" ? NT.ink3 : NT.warn)).frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Text(r.label).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                        if r.isSimulated { NPSTag(text: "シミュレーション") }
                    }
                    Text("\(r.statusLabel)・\(r.deviceType ?? "種別不明")・最終接続 \(NPS.mdhm(r.lastSeenAt))").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 4)
                if p.canEdit {
                    Button { confirm = .readerDelete(r) } label: { Image(systemName: "trash").foregroundColor(NT.danger).frame(width: 38, height: 38) }
                        .buttonStyle(.plain).disabled(model.busy != nil)
                }
            }
            .padding(12).background(npocCard(14))
        }
        if p.canEdit && p.stripe.testMode {
            NPOCard(title: "シミュレーション端末を登録") {
                TextField("端末名（例：レジ1台目）", text: $model.readerLabel).font(.system(size: 15)).npocInputBox()
                NPOCWideButton(text: "登録する", icon: "plus", busy: model.busy == "readerAdd", disabled: model.readerLabel.trimmingCharacters(in: .whitespaces).isEmpty, height: 44) {
                    Task { await model.addReader() }
                }
            }
        }
    }

    // MARK: 予約の決済

    private func bookingTab(_ p: NPYPayload) -> some View {
        NPOCard(title: "予約の決済", trailing: "現地払い・全額決済・予約金") {
            NPSChoice(options: p.booking.modes.map { ($0.id, $0.label) }, selection: model.bookingMode, disabled: !p.canEdit) { model.bookingMode = $0 }
            if model.bookingMode == "deposit" {
                NPSInput(label: "予約金（1名あたり）", text: $model.depositText, placeholder: "0", keyboard: .numberPad, enabled: p.canEdit, suffix: "円")
            }
            if p.canEdit {
                NPOCWideButton(text: "保存する", icon: "square.and.arrow.down", busy: model.busy == "booking",
                               disabled: model.bookingMode == p.booking.mode && Int(model.depositText) == p.booking.depositAmount, height: 46) {
                    Task { await model.saveBooking() }
                }
            }
        }
    }
}
