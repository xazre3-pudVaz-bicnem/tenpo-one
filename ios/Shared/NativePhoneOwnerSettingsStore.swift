import SwiftUI

// iPhone の店長・オーナー：設定の中の画面（店舗・会計・運用）。2026-10-25 Ronnie「101% native」
//   店舗情報・営業時間・休業日・企業情報・税率・会員・ポイント・異常検知の閾値・承認ルール・監査ログ・連携（見るだけ）
// 読み込み・操作は iPad と同じモデル（NativeSettingsPages.swift の NativeStoreModel など。GET part ／ POST type は変えない）。
// 画面は iPhone の縦 1 列（NPSPageFrame・NPOCard）。削除・取消は必ず確認を出す

// MARK: - 店舗情報（/app/settings/store）

struct NPSStorePage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    var onOpenPage: (NPSPage) -> Void = { _ in }
    @StateObject private var model: NativeStoreModel

    init(backLabel: String = "設定", onBack: @escaping () -> Void, onOpenPage: @escaping (NPSPage) -> Void = { _ in }, model: NativeStoreModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        self.onOpenPage = onOpenPage
        _model = StateObject(wrappedValue: model ?? NativeStoreModel())
    }

    var body: some View {
        NPSPageFrame(title: "店舗情報", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload { content(p) }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }

    @ViewBuilder private func content(_ p: NSTStorePayload) -> some View {
        let edit = p.canEdit
        if let url = p.bookingUrl {
            NPOCard(title: "店舗ご予約リンク") {
                Text(url).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(NT.purpleDeep).lineLimit(2).truncationMode(.middle)
                HStack(spacing: 8) {
                    NPOCWideButton(text: "コピー", icon: "doc.on.doc", kind: .secondary, height: 44) {
                        UIPasteboard.general.string = url
                        model.toast = "リンクをコピーしました"
                    }
                    if let u = URL(string: url) {
                        NPOCWideButton(text: "開く", icon: "arrow.up.right.square", kind: .secondary, height: 44) { UIApplication.shared.open(u) }
                    }
                }
            }
        }
        if !edit { NPSLockNote(text: "店舗情報は店長以上のアカウントで変えられます") }
        NPOCard(title: "基本情報") {
            NPSInput(label: "店舗名", text: $model.f.name, placeholder: "店舗名", enabled: edit, required: true)
            NPSInput(label: "フリガナ", text: $model.f.nameKana, placeholder: "テンポメイ", enabled: edit)
            NPSInput(label: "郵便番号", text: $model.f.postalCode, placeholder: "160-0022", keyboard: .numbersAndPunctuation, enabled: edit)
            NPSInput(label: "住所", text: $model.f.address, placeholder: "東京都新宿区…", enabled: edit)
            NPSInput(label: "電話番号", text: $model.f.phone, placeholder: "03-0000-0000", keyboard: .phonePad, enabled: edit)
            NPSInput(label: "メールアドレス", text: $model.f.email, placeholder: "info@example.com", keyboard: .emailAddress, enabled: edit)
            NPSInput(label: "紹介文", text: $model.f.description, placeholder: "お店の紹介（予約ページに出ます）", enabled: edit, multiline: true)
            NPSInput(label: "座席数", text: $model.seatText, placeholder: "0", keyboard: .numberPad, enabled: edit, suffix: "席")
            NPSToggleRow(title: "オンライン予約", sub: model.f.bookingEnabled ? "受付中" : "停止中", isOn: $model.f.bookingEnabled, disabled: !edit)
        }
        NPOCard(title: "レシート・インボイス") {
            let lock = !edit || p.receiptLocked
            if p.receiptLocked {
                NPSLockNote(text: "レシート・インボイスは管理画面（PC・店長以上のアカウント）で変更します")
            }
            NPSInput(label: "ヘッダー", text: $model.f.receiptHeader, placeholder: "レシートの上に印字する文", enabled: !lock, multiline: true)
            NPSInput(label: "フッター", text: $model.f.receiptFooter, placeholder: "レシートの下に印字する文", enabled: !lock, multiline: true)
            NPSInput(label: "登録番号", text: $model.f.invoiceRegistrationNumber, placeholder: "T1234567890123", enabled: !lock)
            NPSInput(label: "サービス料率", text: $model.rateText, placeholder: "0", keyboard: .decimalPad, enabled: !lock, suffix: "%")
            VStack(alignment: .leading, spacing: 6) {
                Text("端数処理").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).padding(.leading, 4)
                NPSChoice(options: p.roundings.map { ($0.id, $0.label) }, selection: model.f.rounding, disabled: lock) { model.f.rounding = $0 }
            }
        }
        NPOCard(title: "在庫") {
            NPSToggleRow(title: "在庫がマイナスでも注文を受ける", isOn: $model.f.allowNegativeStock, disabled: !edit)
        }
        Button { onOpenPage(.businessCards) } label: {
            HStack(spacing: 8) {
                Image(systemName: "person.text.rectangle").font(.system(size: 14, weight: .bold))
                Text("店舗名刺（A4 の印刷）").font(.system(size: 14, weight: .bold))
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
            }
            .foregroundColor(NT.purpleDeep).padding(.horizontal, 14).frame(height: 48).background(npocCard(14))
        }
        .buttonStyle(PressableStyle())
        if edit {
            NPOCWideButton(text: model.busy ? "保存中…" : "保存する", icon: "square.and.arrow.down", busy: model.busy, disabled: !model.changed) {
                Task { await model.save() }
            }
        }
    }
}

// MARK: - 営業時間・休業日（/app/settings/hours）

struct NPSHoursPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeHoursModel
    @State private var bulkOpen: String?
    @State private var bulkClose: String?
    @State private var bulkLast: String?
    @State private var confirmDelete: NHRHoliday?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeHoursModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeHoursModel())
    }

    var body: some View {
        NPSPageFrame(title: "営業時間・休業日", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload { content(p) }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("休業日を取り消しますか？", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
                            titleVisibility: .visible, presenting: confirmDelete) { h in
            Button("取り消す", role: .destructive) { Task { await model.deleteHoliday(h) } }
            Button("やめる", role: .cancel) {}
        } message: { h in
            Text("\(Self.pretty(h.holidayDate))\(h.name.map { "（\($0)）" } ?? "") の休業日を取り消します")
        }
    }

    @ViewBuilder private func content(_ p: NHRPayload) -> some View {
        let edit = p.canEdit
        if !edit { NPSLockNote(text: "営業時間は店長以上のアカウントで変えられます") }
        NPOCard(title: "営業時間") {
            if edit {
                VStack(alignment: .leading, spacing: 8) {
                    Text("まとめて変更").font(.system(size: 12.5, weight: .heavy)).foregroundColor(NT.purpleDeep)
                    HStack(spacing: 6) {
                        timeBox("開店", bulkOpen, NativeHoursModel.openOptions) { bulkOpen = $0 }
                        timeBox("閉店", bulkClose, NativeHoursModel.closeOptions) { bulkClose = $0 }
                        timeBox("最終入店", bulkLast, NativeHoursModel.closeOptions) { bulkLast = $0 }
                    }
                    NPOCWideButton(text: "全曜日に入れる", icon: "arrow.down.to.line", kind: .secondary, disabled: bulkOpen == nil && bulkClose == nil && bulkLast == nil, height: 40) {
                        model.applyToAll(open: bulkOpen, close: bulkClose, last: bulkLast)
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
            }
            ForEach(model.hours, id: \.dayOfWeek) { h in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text("\(NativeHoursModel.dayLabels[h.dayOfWeek])曜日").font(.system(size: 15, weight: .heavy)).foregroundColor(h.isClosed ? NT.ink3 : NT.ink)
                        Spacer()
                        Button { model.update(h.dayOfWeek) { $0.isClosed.toggle() } } label: {
                            Text(h.isClosed ? "定休日" : "営業").font(.system(size: 12.5, weight: .heavy)).foregroundColor(h.isClosed ? .white : NT.ok)
                                .frame(width: 70, height: 30)
                                .background(Capsule().fill(h.isClosed ? NT.ink3 : NT.ok.opacity(0.12)))
                        }
                        .buttonStyle(PressableStyle()).disabled(!edit)
                    }
                    if !h.isClosed {
                        HStack(spacing: 6) {
                            timeBox("開店", h.openTime, NativeHoursModel.openOptions, disabled: !edit) { v in model.update(h.dayOfWeek) { $0.openTime = v } }
                            timeBox("閉店", h.closeTime, NativeHoursModel.closeOptions, disabled: !edit) { v in model.update(h.dayOfWeek) { $0.closeTime = v } }
                            timeBox("最終入店", h.lastEntryTime, NativeHoursModel.closeOptions, disabled: !edit) { v in model.update(h.dayOfWeek) { $0.lastEntryTime = v } }
                        }
                    }
                }
                .padding(.vertical, 6)
                .overlay(alignment: .bottom) { NPZDivider().offset(y: 4) }
            }
            if edit {
                NPOCWideButton(text: "営業時間を保存", icon: "square.and.arrow.down", busy: model.busy == "hours", disabled: !model.hoursChanged) {
                    Task { await model.saveHours() }
                }
            }
        }
        NPOCard(title: "ランチの終わり") {
            HStack(spacing: 10) {
                NPSTimeMenu(value: model.lunchUntil, options: NSPApi.timeOptions(toMin: 23 * 60 + 45), disabled: !edit) { if let v = $0 { model.lunchUntil = v } }
                Text("までをランチとして集計").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                Spacer()
            }
            if edit {
                NPOCWideButton(text: "保存", kind: .secondary, busy: model.busy == "lunch", disabled: model.lunchUntil == p.lunchUntil, height: 42) { Task { await model.saveLunch() } }
            }
        }
        NPOCard(title: "翌準備金") {
            NPSInput(label: "翌日の釣銭準備金", text: $model.nextFloatText, placeholder: "開局の金額と同じ", keyboard: .numberPad, enabled: edit, suffix: "円")
            if edit {
                NPOCWideButton(text: "保存", kind: .secondary, busy: model.busy == "float", disabled: model.nextFloatText == (p.nextFloat.map { String($0) } ?? ""), height: 42) {
                    Task { await model.saveNextFloat() }
                }
            }
        }
        NPOCard(title: "休業日", trailing: "\(p.holidays.count)件") {
            if edit {
                VStack(alignment: .leading, spacing: 8) {
                    DatePicker("日付", selection: $model.newHolidayDate, displayedComponents: .date)
                        .font(.system(size: 14, weight: .bold))
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    NPSInput(label: "名前（任意）", text: $model.newHolidayName, placeholder: "例：年末年始・棚卸")
                    NPSToggleRow(title: "臨時休業", isOn: $model.newHolidayTemporary)
                    NPOCWideButton(text: "休業日を追加", icon: "plus", busy: model.busy == "holiday", height: 44) { Task { await model.addHoliday() } }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
            }
            if p.holidays.isEmpty {
                Text("今日以降の休業日はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(p.holidays) { h in
                HStack(spacing: 8) {
                    Text(Self.pretty(h.holidayDate)).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).monospacedDigit()
                    if h.isTemporary { NPSTag(text: "臨時", color: NT.warn) }
                    Text(h.name ?? "").font(.system(size: 13)).foregroundColor(NT.ink2).lineLimit(1)
                    Spacer()
                    if edit {
                        Button { confirmDelete = h } label: {
                            Image(systemName: "trash").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger).frame(width: 38, height: 38)
                        }
                        .buttonStyle(PressableStyle()).disabled(model.busy == h.id)
                    }
                }
            }
        }
    }

    private func timeBox(_ label: String, _ value: String?, _ options: [String], disabled: Bool = false, pick: @escaping (String?) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10.5, weight: .bold)).foregroundColor(NT.ink3)
            NPSTimeMenu(value: value, options: options, disabled: disabled, pick: pick)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 2026-10-24 → 10/24（土）
    static func pretty(_ ymd: String) -> String { NOS.isDay(ymd) ? NOS.mdw(ymd) : ymd }
}

// MARK: - 企業情報（/app/settings/company）

struct NPSCompanyPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model = NativeCompanyModel()

    var body: some View {
        NPSPageFrame(title: "企業情報", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                if !edit { NPSLockNote(text: "企業情報は本部（org.settings）のアカウントで変えられます") }
                NPOCard(title: "基本情報") {
                    NPSInput(label: "会社名", text: $model.f.name, placeholder: "株式会社○○", enabled: edit, required: true)
                    NPSInput(label: "会社名（カナ）", text: $model.f.nameKana, placeholder: "カブシキガイシャ○○", enabled: edit)
                    NPSInput(label: "郵便番号", text: $model.f.postalCode, placeholder: "123-4567", keyboard: .numbersAndPunctuation, enabled: edit)
                    NPSInput(label: "住所", text: $model.f.address, placeholder: "東京都…", enabled: edit)
                    NPSInput(label: "電話番号", text: $model.f.phone, placeholder: "03-1234-5678", keyboard: .phonePad, enabled: edit)
                }
                NPOCard(title: "請求情報") {
                    NPSInput(label: "請求先名", text: $model.f.billingName, placeholder: "経理部 御中 など", enabled: edit)
                    NPSInput(label: "請求先メール", text: $model.f.billingEmail, placeholder: "billing@example.com", keyboard: .emailAddress, enabled: edit)
                    NPSInput(label: "備考", text: $model.f.billingNote, placeholder: "請求書送付先や支払条件など", enabled: edit, multiline: true)
                    if edit {
                        NPOCWideButton(text: "保存する", icon: "square.and.arrow.down", busy: model.busy == "save",
                                       disabled: !model.dirty || model.f.name.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.save() } }
                    }
                }
                NPOCard(title: "KPI設定") {
                    NPSToggleRow(title: "テイクアウト・デリバリーの客数を客数KPIに含める",
                                 sub: "オフにすると、ダッシュボード・レポート・予算・日報の客数・客単価は店内飲食だけで算出",
                                 isOn: Binding(get: { p.includeTakeoutGuests }, set: { v in Task { await model.setKpi(v) } }),
                                 disabled: !edit || model.busy != nil)
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }
}

// MARK: - 税率（/app/settings/tax）

struct NPSTaxPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeTaxModel
    @State private var confirmDelete: NTXRow?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeTaxModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeTaxModel())
    }

    var body: some View {
        NPSPageFrame(title: "税率", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload?.canEdit == true { NPOCBarButton(icon: "plus", label: "追加") { model.startAdd() } }
        }) {
            if let p = model.payload {
                if !p.canEdit { NPSLockNote(text: "税率は店長以上のアカウントで変えられます") }
                if p.rows.isEmpty { NPOCEmpty(icon: "percent", title: "税率がまだ登録されていません") }
                ForEach(p.rows) { r in
                    HStack(spacing: 12) {
                        Text(r.rate == r.rate.rounded() ? "\(Int(r.rate))%" : "\(r.rate)%").font(.system(size: 22, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                            .frame(minWidth: 58, alignment: .leading)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                            HStack(spacing: 4) {
                                if r.isDefault { NPSTag(text: "既定", color: NT.purple) }
                                if r.isReduced { NPSTag(text: "軽減税率", color: NT.warn) }
                                NPSTag(text: r.isInclusive ? "内税" : "外税")
                            }
                        }
                        Spacer(minLength: 4)
                        if p.canEdit {
                            Menu {
                                Button { model.startEdit(r) } label: { Label("編集", systemImage: "pencil") }
                                if !r.isDefault { Button(role: .destructive) { confirmDelete = r } label: { Label("削除", systemImage: "trash") } }
                            } label: {
                                Image(systemName: "ellipsis.circle").font(.system(size: 20, weight: .semibold)).foregroundColor(NT.ink2).frame(width: 40, height: 40)
                            }
                        }
                    }
                    .padding(12).background(npocCard(14))
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("税率を削除しますか？", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible, presenting: confirmDelete) { r in
            Button("削除する", role: .destructive) { Task { await model.delete(r) } }
            Button("やめる", role: .cancel) {}
        } message: { r in Text("「\(r.name)」を削除します") }
        .sheet(isPresented: $model.showForm) {
            NPOCSheetFrame(title: model.editingId == nil ? "税率を追加" : "税率を編集", confirmText: "保存", busy: model.busy == "save",
                           onCancel: { model.showForm = false }, onConfirm: {
                               if model.name.trimmingCharacters(in: .whitespaces).isEmpty { model.toast = "税率名を入力してください"; return }
                               Task { await model.save() }
                           }) {
                NPSInput(label: "税率名", text: $model.name, placeholder: "標準税率・軽減税率 など", required: true)
                NPSInput(label: "税率", text: $model.rate, placeholder: "10", keyboard: .decimalPad, suffix: "%")
                VStack(spacing: 4) {
                    NPSToggleRow(title: "軽減税率", isOn: $model.isReduced)
                    NPSToggleRow(title: "内税", sub: model.isInclusive ? "内税（価格に含む）" : "外税（価格に足す）", isOn: $model.isInclusive)
                    NPSToggleRow(title: "既定にする", isOn: $model.isDefault)
                }
                .padding(12).background(npocCard(14))
                if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
            }
            .presentationDetents([.large])
        }
    }
}

// MARK: - 会員・ポイント（/app/settings/loyalty）

struct NPSLoyaltyPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model = NativeLoyaltyModel()

    var body: some View {
        NPSPageFrame(title: "会員・ポイント", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                if !edit { NPSLockNote(text: "ポイント設定は本部（org.settings）のアカウントで変えられます") }
                NPOCard(title: "ポイント機能") {
                    NPSToggleRow(title: "ポイント機能", sub: model.enabled ? "有効" : "無効", isOn: $model.enabled, disabled: !edit)
                    NPSInput(label: "付与レート（会計金額をこの円数で割った数を付与・切り捨て）", text: $model.yenPerPoint, placeholder: "100", keyboard: .numberPad, enabled: edit, suffix: "円で 1pt")
                    NPSInput(label: "利用レート（ポイント払いの 1pt の円換算）", text: $model.pointValue, placeholder: "1", keyboard: .numberPad, enabled: edit, suffix: "円 / 1pt")
                    NPSInput(label: "失効（空欄なら無期限）", text: $model.expiry, placeholder: "無期限", keyboard: .numberPad, enabled: edit, suffix: "か月")
                    if edit {
                        NPOCWideButton(text: "保存する", icon: "square.and.arrow.down", busy: model.busy, disabled: !model.changed) { Task { await model.save() } }
                    }
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }
}

// MARK: - 異常検知の閾値（/app/settings/alerts）

struct NPSAlertsPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeAlertsModel
    @State private var confirmReset: NALItem?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeAlertsModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeAlertsModel())
    }

    var body: some View {
        NPSPageFrame(title: "異常検知の閾値", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                Text("現金差異・値引率・原価率・人件費率などがこの値を超えると、通知とホームのアラートに出ます。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink2).padding(.horizontal, 4)
                if !p.canEditStore { NPSLockNote(text: "閾値は店長以上のアカウントで変えられます") }
                ForEach(p.items) { it in card(it, p) }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("企業既定に戻しますか？", isPresented: Binding(get: { confirmReset != nil }, set: { if !$0 { confirmReset = nil } }), titleVisibility: .visible, presenting: confirmReset) { it in
            Button("企業既定に戻す", role: .destructive) { Task { await model.reset(it) } }
            Button("やめる", role: .cancel) {}
        } message: { it in Text("「\(it.label)」のこの店の値を消して、企業既定の値を使います") }
    }

    private func card(_ it: NALItem, _ p: NALPayload) -> some View {
        let busy = model.busy == it.ruleKey
        let off = (it.effectiveSource == "store" && !it.storeEnabled) || (it.effectiveSource == "org" && !it.orgEnabled)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(it.label).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                if off { NPSTag(text: "無効", color: NT.ink3) }
            }
            HStack(spacing: 6) {
                Text("いま \(NPS.num(it.effectiveValue))\(it.unit)").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep)
                Text(it.effectiveSource == "store" ? "（この店）" : it.effectiveSource == "org" ? "（企業既定）" : "（標準）").font(.system(size: 12)).foregroundColor(NT.ink3)
            }
            if p.canEditStore {
                NPSInput(label: "この店の値", text: Binding(get: { model.text[it.ruleKey] ?? "" }, set: { model.text[it.ruleKey] = $0 }),
                         placeholder: NPS.num(it.defaultValue), keyboard: .decimalPad, suffix: it.unit)
                HStack(spacing: 8) {
                    NPOCWideButton(text: "この店で保存", busy: busy, height: 42) { Task { await model.save(it, scope: "store") } }
                    if p.canEditOrg {
                        NPOCWideButton(text: "企業既定に", kind: .secondary, busy: busy, height: 42) { Task { await model.save(it, scope: "org") } }
                    }
                }
                if it.storeValue != nil {
                    HStack(spacing: 8) {
                        NPOCWideButton(text: it.storeEnabled ? "無効にする" : "有効にする", icon: it.storeEnabled ? "bell.slash" : "bell.fill", kind: .secondary, busy: busy, height: 40) {
                            Task { await model.toggle(it, scope: "store") }
                        }
                        NPOCWideButton(text: "既定に戻す", icon: "arrow.uturn.backward", kind: .secondary, busy: busy, height: 40) { confirmReset = it }
                    }
                }
            }
        }
        .padding(14).background(npocCard())
    }
}

// MARK: - 承認ルール（/app/settings/approvals）

struct NPSApprovalsPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model = NativeApprovalsModel()
    @State private var confirmDelete: NAPRow?

    var body: some View {
        NPSPageFrame(title: "承認ルール", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload?.canEdit == true { NPOCBarButton(icon: "plus", label: "追加") { model.startAdd() } }
        }) {
            if let p = model.payload {
                if !p.canEdit { NPSLockNote(text: "承認ルールは本部（org.settings）のアカウントで変えられます") }
                if p.rows.isEmpty { NPOCEmpty(icon: "checkmark.seal", title: "ルールがまだありません", note: "承認なしで通ります") }
                ForEach(p.rows) { r in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            NOSBadge(text: model.label(p.targets, r.target), color: NT.purpleDeep)
                            Spacer()
                            if p.canEdit {
                                Menu {
                                    Button { model.startEdit(r) } label: { Label("編集", systemImage: "pencil") }
                                    Button(role: .destructive) { confirmDelete = r } label: { Label("削除", systemImage: "trash") }
                                } label: {
                                    Image(systemName: "ellipsis.circle").font(.system(size: 20, weight: .semibold)).foregroundColor(NT.ink2).frame(width: 36, height: 32)
                                }
                            }
                        }
                        Text("\(NT.yen(r.minAmount)) 〜 \(r.maxAmount.map { NT.yen($0) } ?? "上限なし")").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                        HStack(spacing: 6) {
                            Text("承認：\(model.label(p.roles, r.approverRole))").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                            if r.allowSelfApprove { NPSTag(text: "自己承認可", color: NT.warn) }
                        }
                    }
                    .padding(12).background(npocCard(14))
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("ルールを削除しますか？", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible, presenting: confirmDelete) { r in
            Button("削除する", role: .destructive) { Task { await model.delete(r) } }
            Button("やめる", role: .cancel) {}
        } message: { _ in Text("この承認ルールを削除します") }
        .sheet(isPresented: $model.showForm) {
            if let p = model.payload {
                NPOCSheetFrame(title: model.editingId == nil ? "ルールを追加" : "ルールを編集", confirmText: "保存", busy: model.busy == "save",
                               onCancel: { model.showForm = false }, onConfirm: { Task { await model.save() } }) {
                    NPOCField(label: "対象") { NPSChoice(options: p.targets.map { ($0.id, $0.label) }, selection: model.target) { model.target = $0 } }
                    NPSInput(label: "下限金額", text: $model.minAmount, placeholder: "0", keyboard: .numberPad, suffix: "円")
                    NPSInput(label: "上限金額（空欄＝上限なし）", text: $model.maxAmount, placeholder: "上限なし", keyboard: .numberPad, suffix: "円")
                    NPOCField(label: "必要承認ロール") { NPSChoice(options: p.roles.map { ($0.id, $0.label) }, selection: model.role) { model.role = $0 } }
                    NPSToggleRow(title: "自己承認", sub: model.allowSelf ? "申請した本人も承認できる" : "本人は承認できない", isOn: $model.allowSelf)
                        .padding(12).background(npocCard(14))
                    if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
                }
                .presentationDetents([.large])
            }
        }
    }
}

// MARK: - 監査ログ（/app/settings/audit。見るだけ）

struct NPSAuditPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model = NativeAuditModel()

    var body: some View {
        NPSPageFrame(title: "監査ログ", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if model.payload != nil {
                NPZSearchField(text: $model.query, placeholder: "アクション・操作者で探す")
                NPZSearchField(text: $model.table, placeholder: "対象テーブル（memberships 等）")
                let rows = model.filtered
                Text("\(rows.count)件（新しい順・最大200件）").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).padding(.leading, 4)
                if rows.isEmpty { NPOCEmpty(icon: "doc.text.magnifyingglass", title: "該当する操作履歴がありません") }
                ForEach(rows) { r in row(r) }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }

    private func row(_ r: NAULog) -> some View {
        let open = model.open == r.id
        return VStack(alignment: .leading, spacing: 6) {
            Button { if r.hasDetail { model.open = open ? nil : r.id } } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(r.action).font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundColor(NT.purpleDeep)
                            .padding(.horizontal, 7).padding(.vertical, 3).background(Capsule().fill(NT.lilac)).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(r.createdLabel).font(.system(size: 11.5)).foregroundColor(NT.ink3).monospacedDigit()
                        if r.hasDetail { Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3) }
                    }
                    HStack(spacing: 6) {
                        Text(r.actorName).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        if let role = r.actorRole { Text(role).font(.system(size: 11)).foregroundColor(NT.ink3) }
                        Spacer(minLength: 4)
                        Text(r.targetTable ?? "—").font(.system(size: 12)).foregroundColor(NT.ink2).lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                if let n = r.note, !n.isEmpty { Text("メモ：\(n)").font(.system(size: 12.5)).foregroundColor(NT.ink2) }
                jsonBox("変更前", r.before)
                jsonBox("変更後", r.after)
            }
        }
        .padding(12).background(npocCard(14))
    }

    private func jsonBox(_ title: String, _ body: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3)
            ScrollView { Text(body ?? "—").font(.system(size: 11, design: .monospaced)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading).padding(8) }
                .frame(maxHeight: 180)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
        }
    }
}

// MARK: - 連携（/app/settings/integrations。見るだけ）

struct NPSIntegrationsPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    var onOpenPage: (NPSPage) -> Void = { _ in }
    var onOpenPath: (String) -> Void = { _ in }
    @StateObject private var model: NativeIntegrationsModel

    init(backLabel: String = "設定", onBack: @escaping () -> Void, onOpenPage: @escaping (NPSPage) -> Void = { _ in }, onOpenPath: @escaping (String) -> Void = { _ in }, model: NativeIntegrationsModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        self.onOpenPage = onOpenPage
        self.onOpenPath = onOpenPath
        _model = StateObject(wrappedValue: model ?? NativeIntegrationsModel())
    }

    var body: some View {
        NPSPageFrame(title: "連携", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                NPOCSectionTitle(title: "連携の状態", note: "虚偽の「接続済み」表示は行いません")
                ForEach(p.rows) { r in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Circle().fill(tone(r.tone)).frame(width: 9, height: 9)
                            Text(r.name).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                            Spacer(minLength: 4)
                            NOSBadge(text: r.status, color: tone(r.tone))
                        }
                        Text(r.note).font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                        if let href = r.href, let label = r.hrefLabel, let go = destination(href) {
                            Button(action: go) {
                                HStack(spacing: 4) { Text(label); Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)) }
                                    .font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(12).background(npocCard(14))
                }
                NPOCSectionTitle(title: "会計・勤怠ソフトからの移行・互換", note: "既に使っている店舗が乗り換える・併用するときのデータ移行の現状")
                VStack(spacing: 0) {
                    ForEach(Array(p.migration.enumerated()), id: \.element.id) { i, m in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(m.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                            Text(m.note).font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        if i < p.migration.count - 1 { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
    }

    /// リンクの先：設定の中の画面か、iPhone のネイティブの画面だけ（Web には行かない）
    private func destination(_ href: String) -> (() -> Void)? {
        let path = String(href.split(separator: "?", maxSplits: 1).first ?? Substring(href))
        if let page = NPSPage.from(path: path) { return { onOpenPage(page) } }
        if let url = URL(string: href, relativeTo: AppConfig.url("/"))?.absoluteURL, NativePhoneOwnerRegistry.route(for: url) != nil {
            return { onOpenPath(href) }
        }
        return nil
    }

    private func tone(_ t: String) -> Color {
        switch t {
        case "success": return NT.ok
        case "warning": return NT.warn
        case "danger": return NT.danger
        case "primary": return NT.purple
        default: return NT.ink3
        }
    }
}
