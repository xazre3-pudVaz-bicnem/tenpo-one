import SwiftUI

// iPhone の店長・オーナー：給与ルール・歩合ルールの追加・編集、給与計算の新規作成（給与＝期間集計／賞与＝金額を手入力）。
// Web の PayrollRuleDialog・CommissionRuleDialog・RunDialog と同じ項目（2026-10-25 Ronnie「iPhone も native に」）。
// iPhone のアプリは暗い表示なので Form は使わず、明るい自前のシート（NPOCSheetFrame）にする
// サーバーは iPad と同じ POST payrollRuleSave・payrollCommissionSave・payrollRunCreate・payrollBonusCreate

// MARK: - 入力の部品

/// 白いカードの中の行をまとめる（行のあいだに線）
struct NPPYFormGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return VStack(spacing: 0) { inner }
            .background(npocCard(12))
    }
}

struct NPPYFormDivider: View {
    var body: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14) }
}

/// 見出し・数の入力・単位
struct NPPYNumberRow: View {
    let label: String
    @Binding var text: String
    var unit: String = ""
    var decimal = false
    var placeholder = "0"

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2)
            Spacer(minLength: 8)
            TextField(placeholder, text: $text)
                .keyboardType(decimal ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: 140)
            if !unit.isEmpty { Text(unit).font(.system(size: 14)).foregroundColor(NT.ink3) }
        }
        .npocRow()
    }
}

/// 見出し・選ぶ（メニュー）
struct NPPYPickRow: View {
    let label: String
    /// (値, 表示)
    let options: [(String, String)]
    @Binding var selection: String
    var disabled = false

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            Spacer(minLength: 8)
            Picker(label, selection: $selection) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                    Text(o.1).tag(o.0)
                }
            }
            .pickerStyle(.menu)
            .tint(NT.purple)
            .disabled(disabled)
        }
        .npocRow()
    }
}

/// 見出し・日付（yyyy-MM-dd）
struct NPPYDateRow: View {
    let label: String
    @Binding var value: String

    var body: some View {
        DatePicker(selection: Binding(get: { NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .npocRow()
    }
}

/// エラーのことば（シートの下）
struct NPPYFormError: View {
    let error: String?

    var body: some View {
        if let error {
            Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).padding(.horizontal, 4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - 給与ルールの追加・編集（Web の PayrollRuleDialog）

struct NPPYAllowanceRow: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var amount: String
    var per: String
}

struct NPPYRuleSheet: View {
    let rule: NPPYRule?
    let staff: [NPOCOption]
    let stores: [NPOCOption]
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var profileId: String
    @State private var storeId: String
    @State private var payType: String
    @State private var base: String
    @State private var commute: String
    @State private var effectiveFrom: String
    @State private var overtime: String
    @State private var night: String
    @State private var holiday: String
    @State private var closingDay: Int
    @State private var paymentDay: Int
    @State private var allowances: [NPPYAllowanceRow]
    @State private var error: String?
    @State private var saving = false

    init(rule: NPPYRule?, staff: [NPOCOption], stores: [NPOCOption], today: String, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.rule = rule
        self.staff = staff
        self.stores = stores
        self.onSaved = onSaved
        self.onClose = onClose
        _profileId = State(initialValue: rule?.profileId ?? "")
        _storeId = State(initialValue: rule?.storeId ?? "")
        _payType = State(initialValue: rule?.payType ?? "hourly")
        _base = State(initialValue: NPPYFmt.num(rule?.baseAmount ?? 0))
        _commute = State(initialValue: NPPYFmt.num(rule?.commuteAllowance ?? 0))
        _effectiveFrom = State(initialValue: rule?.effectiveFrom ?? today)
        _overtime = State(initialValue: NPPYFmt.num(rule?.overtimeRate ?? 1.25))
        _night = State(initialValue: NPPYFmt.num(rule?.nightRate ?? 0.25))
        _holiday = State(initialValue: NPPYFmt.num(rule?.holidayRate ?? 1.35))
        _closingDay = State(initialValue: Int(rule?.closingDay ?? 31))
        _paymentDay = State(initialValue: Int(rule?.paymentDay ?? 25))
        _allowances = State(initialValue: (rule?.allowances ?? []).map { NPPYAllowanceRow(name: $0.name, amount: NPPYFmt.num($0.amount), per: $0.per) })
    }

    /// スタッフの選択肢（今のスタッフが選択肢に無ければ先頭に足す）
    private var staffOptions: [(String, String)] {
        var list: [(String, String)] = [("", "選んでください")] + staff.map { ($0.id, $0.name) }
        if let r = rule, !staff.contains(where: { $0.id == r.profileId }) { list.insert((r.profileId, r.profileName), at: 1) }
        return list
    }

    var body: some View {
        NPOCSheetFrame(title: rule == nil ? "給与ルールを追加" : "給与ルールを編集", confirmText: saving ? "保存中…" : "保存", busy: saving,
                       onCancel: onClose, onConfirm: { save() }) {
            NPOCField(label: "対象") {
                NPPYFormGroup {
                    NPPYPickRow(label: "スタッフ", options: staffOptions, selection: $profileId, disabled: rule != nil)
                    NPPYFormDivider()
                    NPPYPickRow(label: "店舗", options: [("", "全店舗共通")] + stores.map { ($0.id, $0.name) }, selection: $storeId)
                }
            }
            NPOCField(label: "給与") {
                VStack(spacing: 10) {
                    Picker("給与形態", selection: $payType) {
                        Text("時給").tag("hourly")
                        Text("月給").tag("monthly")
                        Text("日給").tag("daily")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    NPPYFormGroup {
                        NPPYNumberRow(label: payType == "hourly" ? "時給" : payType == "daily" ? "日給" : "月給", text: $base, unit: "円")
                        NPPYFormDivider()
                        NPPYNumberRow(label: "交通費／日", text: $commute, unit: "円")
                        NPPYFormDivider()
                        NPPYDateRow(label: "適用開始日", value: $effectiveFrom)
                    }
                }
            }
            NPOCField(label: "割増") {
                NPPYFormGroup {
                    NPPYNumberRow(label: "残業倍率", text: $overtime, unit: "倍", decimal: true)
                    NPPYFormDivider()
                    NPPYNumberRow(label: "深夜加算", text: $night, unit: "", decimal: true)
                    NPPYFormDivider()
                    NPPYNumberRow(label: "休日倍率", text: $holiday, unit: "倍", decimal: true)
                }
            }
            NPOCField(label: "締め・支払") {
                NPPYFormGroup {
                    Stepper(value: $closingDay, in: 1...31) {
                        Text("締め日：\(String(closingDay))日").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                    }
                    .npocRow()
                    NPPYFormDivider()
                    Stepper(value: $paymentDay, in: 1...31) {
                        Text("支払日：\(String(paymentDay))日").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                    }
                    .npocRow()
                }
            }
            NPOCField(label: "手当") {
                VStack(spacing: 8) {
                    if allowances.isEmpty {
                        Text("手当はありません").font(.system(size: 13.5)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 4)
                    }
                    ForEach($allowances) { $a in
                        VStack(spacing: 8) {
                            HStack(spacing: 8) {
                                TextField("手当名（例：役職手当）", text: $a.name).font(.system(size: 16)).npocInputBox()
                                Button { allowances.removeAll { $0.id == a.id } } label: {
                                    Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.danger)
                                        .frame(width: 44, height: 44)
                                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
                                }
                                .buttonStyle(PressableStyle())
                                .accessibilityLabel("この手当を削除")
                            }
                            HStack(spacing: 8) {
                                TextField("金額", text: $a.amount).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                                    .font(.system(size: 16, weight: .semibold)).npocInputBox()
                                Text("円").font(.system(size: 14)).foregroundColor(NT.ink3)
                                Picker("", selection: $a.per) {
                                    Text("月額").tag("month")
                                    Text("日額").tag("day")
                                }
                                .pickerStyle(.segmented)
                                .labelsHidden()
                                .frame(width: 130)
                            }
                        }
                        .padding(10)
                        .background(npocCard(12))
                    }
                    Button { allowances.append(NPPYAllowanceRow(name: "", amount: "0", per: "month")) } label: {
                        Label("手当を追加", systemImage: "plus").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purpleDeep)
                            .frame(maxWidth: .infinity).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            NPPYFormError(error: error)
        }
    }

    private func save() {
        if profileId.isEmpty {
            error = "対象スタッフを選択してください"
            return
        }
        error = nil
        let allowanceList: [[String: Any]] = allowances.map { a in
            let amount: Double = NPPYFmt.double(a.amount) ?? 0
            let row: [String: Any] = ["name": a.name, "amount": amount, "per": a.per]
            return row
        }
        var ruleBody: [String: Any] = [:]
        ruleBody["id"] = NPPYFmt.orNull(rule?.id)
        ruleBody["profileId"] = profileId
        ruleBody["storeId"] = NPPYFmt.orNull(storeId.isEmpty ? nil : storeId)
        ruleBody["payType"] = payType
        ruleBody["baseAmount"] = NPPYFmt.double(base) ?? Double(0)
        ruleBody["overtimeRate"] = NPPYFmt.double(overtime) ?? Double(0)
        ruleBody["nightRate"] = NPPYFmt.double(night) ?? Double(0)
        ruleBody["holidayRate"] = NPPYFmt.double(holiday) ?? Double(0)
        ruleBody["commuteAllowance"] = NPPYFmt.double(commute) ?? Double(0)
        ruleBody["allowances"] = allowanceList
        ruleBody["closingDay"] = closingDay
        ruleBody["paymentDay"] = paymentDay
        ruleBody["effectiveFrom"] = effectiveFrom
        if NativePreview.current != nil {
            onSaved("給与ルールを保存しました（見本）")
            return
        }
        saving = true
        let request: [String: Any] = ["type": "payrollRuleSave", "rule": ruleBody]
        Task {
            let r = await NPPYApi.post(request)
            saving = false
            if r.ok { onSaved(r.message ?? "給与ルールを保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 歩合ルールの追加・編集（Web の CommissionRuleDialog）

struct NPPYTierRow: Identifiable, Hashable {
    let id = UUID()
    var from: String
    var to: String
    var rate: String
}

struct NPPYCommissionSheet: View {
    let rule: NPPYCommissionRule?
    let staff: [NPOCOption]
    let stores: [NPOCOption]
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var name: String
    @State private var targetType: String
    @State private var profileId: String
    @State private var storeId: String
    @State private var method: String
    @State private var basis: String
    @State private var rate: String
    @State private var fixed: String
    @State private var tiers: [NPPYTierRow]
    @State private var minAmount: String
    @State private var maxAmount: String
    @State private var effectiveFrom: String
    @State private var previewSales = ""
    @State private var error: String?
    @State private var saving = false

    init(rule: NPPYCommissionRule?, staff: [NPOCOption], stores: [NPOCOption], today: String, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.rule = rule
        self.staff = staff
        self.stores = stores
        self.onSaved = onSaved
        self.onClose = onClose
        _name = State(initialValue: rule?.name ?? "")
        _targetType = State(initialValue: rule?.targetType ?? "personal_sales")
        _profileId = State(initialValue: rule?.profileId ?? "")
        _storeId = State(initialValue: rule?.storeId ?? "")
        _method = State(initialValue: rule?.method ?? "rate")
        _basis = State(initialValue: rule?.basis ?? "tax_excluded")
        _rate = State(initialValue: rule == nil ? "2" : NPPYFmt.num(rule?.rate))
        _fixed = State(initialValue: NPPYFmt.num(rule?.fixedAmount))
        _tiers = State(initialValue: (rule?.tiers ?? []).map { NPPYTierRow(from: NPPYFmt.num($0.from), to: NPPYFmt.num($0.to), rate: NPPYFmt.num($0.rate)) })
        _minAmount = State(initialValue: NPPYFmt.num(rule?.minAmount))
        _maxAmount = State(initialValue: NPPYFmt.num(rule?.maxAmount))
        _effectiveFrom = State(initialValue: rule?.effectiveFrom ?? today)
    }

    private var isStoreTarget: Bool { targetType == "store_target" }

    /// 店舗目標達成は固定額だけ（Web と同じく、切り替えたら計算方法を固定額に）
    private var targetBinding: Binding<String> {
        Binding(get: { targetType }, set: { v in
            targetType = v
            if v == "store_target" { method = "fixed" }
        })
    }

    private var tierValues: [NPPYTier] {
        tiers.map { NPPYTier(from: NPPYFmt.double($0.from) ?? 0, to: NPPYFmt.double($0.to), rate: NPPYFmt.double($0.rate) ?? 0) }
    }

    private var previewAmount: Double {
        let sales = NPPYFmt.double(previewSales) ?? 0
        if isStoreTarget {
            // 店舗売上 >= 目標額 なら支給額、未満なら 0 円（給与計算と同じ）
            return sales >= (NPPYFmt.double(minAmount) ?? 0) ? (NPPYFmt.double(fixed) ?? 0) : 0
        }
        return NPPYFmt.commission(method: method, rate: NPPYFmt.double(rate), fixed: NPPYFmt.double(fixed), tiers: tierValues,
                                  lo: NPPYFmt.double(minAmount), hi: NPPYFmt.double(maxAmount), sales: sales)
    }

    var body: some View {
        NPOCSheetFrame(title: rule == nil ? "歩合ルールを追加" : "歩合ルールを編集", confirmText: saving ? "保存中…" : "保存", busy: saving,
                       onCancel: onClose, onConfirm: { save() }) {
            NPOCField(label: "ルール名") {
                TextField("例：個人売上歩合", text: $name).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "対象タイプ") {
                Picker("対象タイプ", selection: targetBinding) {
                    Text("個人売上").tag("personal_sales")
                    Text("店舗目標達成").tag("store_target")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            NPOCField(label: "対象") {
                NPPYFormGroup {
                    NPPYPickRow(label: "スタッフ", options: [("", "全スタッフ")] + staff.map { ($0.id, $0.name) }, selection: $profileId)
                    NPPYFormDivider()
                    NPPYPickRow(label: "店舗", options: [("", "全店舗")] + stores.map { ($0.id, $0.name) }, selection: $storeId)
                }
            }
            if isStoreTarget { storeTargetFields } else { personalFields }
            NPOCField(label: "適用") {
                NPPYFormGroup {
                    NPPYDateRow(label: "適用開始日", value: $effectiveFrom)
                }
            }
            NPOCField(label: "試算") {
                NPPYFormGroup {
                    NPPYNumberRow(label: isStoreTarget ? "店舗売上" : "売上", text: $previewSales, unit: "円")
                    NPPYFormDivider()
                    HStack {
                        Text("支給額").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                        Spacer()
                        Text(NPPYFmt.yen(previewAmount)).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.purpleDeep).monospacedDigit()
                    }
                    .npocRow()
                }
            }
            NPPYFormError(error: error)
        }
    }

    private var storeTargetFields: some View {
        NPOCField(label: "店舗目標達成") {
            VStack(alignment: .leading, spacing: 6) {
                NPPYFormGroup {
                    NPPYNumberRow(label: "支給額", text: $fixed, unit: "円")
                    NPPYFormDivider()
                    NPPYNumberRow(label: "目標額（必須）", text: $minAmount, unit: "円")
                }
                Text("店舗売上が目標額以上の月に固定額を払います。目標に届かない月は払いません。")
                    .font(.system(size: 12)).foregroundColor(NT.ink3).padding(.horizontal, 4).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private var personalFields: some View {
        NPOCField(label: "計算") {
            VStack(spacing: 10) {
                Picker("計算方法", selection: $method) {
                    Text("料率（%）").tag("rate")
                    Text("固定額").tag("fixed")
                    Text("段階料率").tag("tiered")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Picker("売上基準", selection: $basis) {
                    Text("税抜売上").tag("tax_excluded")
                    Text("税込売上").tag("tax_included")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                if method == "rate" {
                    NPPYFormGroup { NPPYNumberRow(label: "料率", text: $rate, unit: "%", decimal: true) }
                }
                if method == "fixed" {
                    NPPYFormGroup { NPPYNumberRow(label: "固定額", text: $fixed, unit: "円") }
                }
            }
        }
        if method == "tiered" { tiersField }
        NPOCField(label: "下限・上限（任意）") {
            NPPYFormGroup {
                NPPYNumberRow(label: "下限額", text: $minAmount, unit: "円", placeholder: "なし")
                NPPYFormDivider()
                NPPYNumberRow(label: "上限額", text: $maxAmount, unit: "円", placeholder: "なし")
            }
        }
    }

    private var tiersField: some View {
        NPOCField(label: "段階（売上の帯ごとの料率）") {
            VStack(alignment: .leading, spacing: 8) {
                if tiers.isEmpty {
                    Text("段階がありません").font(.system(size: 13.5)).foregroundColor(NT.ink3).padding(.leading, 4)
                }
                ForEach($tiers) { $t in
                    VStack(spacing: 8) {
                        HStack(spacing: 6) {
                            TextField("下限", text: $t.from).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                                .font(.system(size: 15, weight: .semibold)).npocInputBox()
                            Text("〜").foregroundColor(NT.ink3)
                            TextField("上限（空＝なし）", text: $t.to).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                                .font(.system(size: 15, weight: .semibold)).npocInputBox()
                            Text("円").font(.system(size: 13)).foregroundColor(NT.ink3)
                        }
                        HStack(spacing: 6) {
                            Text("料率").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2)
                            TextField("0", text: $t.rate).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                .font(.system(size: 15, weight: .semibold)).frame(width: 70).npocInputBox()
                            Text("%").font(.system(size: 13)).foregroundColor(NT.ink3)
                            Spacer(minLength: 4)
                            Button { tiers.removeAll { $0.id == t.id } } label: {
                                Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.danger)
                                    .frame(width: 44, height: 42)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
                            }
                            .buttonStyle(PressableStyle())
                            .accessibilityLabel("この段階を削除")
                        }
                    }
                    .padding(10)
                    .background(npocCard(12))
                }
                Button { tiers.append(NPPYTierRow(from: tiers.last.map { $0.to } ?? "0", to: "", rate: "0")) } label: {
                    Label("段階を追加", systemImage: "plus").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                Text("例：0〜30万円 0%／30〜50万円 3%／50〜80万円 5%／80万円〜 8%").font(.system(size: 12)).foregroundColor(NT.ink3).padding(.horizontal, 4)
            }
        }
    }

    private func save() {
        if name.trimmingCharacters(in: .whitespaces).isEmpty {
            error = "ルール名を入力してください"
            return
        }
        error = nil
        let tierList: [[String: Any]] = tiers.map { t in
            let from: Double = NPPYFmt.double(t.from) ?? 0
            let tierRate: Double = NPPYFmt.double(t.rate) ?? 0
            let row: [String: Any] = ["from": from, "to": NPPYFmt.orNull(NPPYFmt.double(t.to)), "rate": tierRate]
            return row
        }
        var ruleBody: [String: Any] = [:]
        ruleBody["id"] = NPPYFmt.orNull(rule?.id)
        ruleBody["name"] = name
        ruleBody["targetType"] = targetType
        ruleBody["profileId"] = NPPYFmt.orNull(profileId.isEmpty ? nil : profileId)
        ruleBody["storeId"] = NPPYFmt.orNull(storeId.isEmpty ? nil : storeId)
        ruleBody["method"] = method
        ruleBody["rate"] = NPPYFmt.orNull(NPPYFmt.double(rate))
        ruleBody["fixedAmount"] = NPPYFmt.orNull(NPPYFmt.double(fixed))
        ruleBody["tiers"] = NPPYFmt.orNull(tierList.isEmpty ? nil : tierList)
        ruleBody["basis"] = basis
        ruleBody["minAmount"] = NPPYFmt.orNull(NPPYFmt.double(minAmount))
        ruleBody["maxAmount"] = NPPYFmt.orNull(NPPYFmt.double(maxAmount))
        ruleBody["effectiveFrom"] = effectiveFrom
        if NativePreview.current != nil {
            onSaved("歩合ルールを保存しました（見本）")
            return
        }
        saving = true
        let request: [String: Any] = ["type": "payrollCommissionSave", "rule": ruleBody]
        Task {
            let r = await NPPYApi.post(request)
            saving = false
            if r.ok { onSaved(r.message ?? "歩合ルールを保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 給与計算の新規作成（Web の RunDialog：給与＝期間集計／賞与＝金額を手入力）

struct NPPYBonusRow: Identifiable, Hashable {
    let id = UUID()
    var profileId: String
    var amount: String
}

struct NPPYRunCreateSheet: View {
    let defaults: NPPYDefaults
    let staff: [NPOCOption]
    let stores: [NPOCOption]
    let onCreated: (String) -> Void
    let onClose: () -> Void

    @State private var runType = "salary"
    @State private var title: String
    @State private var periodStart: String
    @State private var periodEnd: String
    @State private var paymentDate: String
    @State private var storeId = ""
    @State private var bonusRows = [NPPYBonusRow(profileId: "", amount: "")]
    @State private var error: String?
    @State private var saving = false

    init(defaults: NPPYDefaults?, staff: [NPOCOption], stores: [NPOCOption], onCreated: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        let today = NPDate.str(Date())
        let d = defaults ?? NPPYDefaults(periodStart: today, periodEnd: today, salaryTitle: "", bonusTitle: "", today: today)
        self.defaults = d
        self.staff = staff
        self.stores = stores
        self.onCreated = onCreated
        self.onClose = onClose
        _title = State(initialValue: d.salaryTitle)
        _periodStart = State(initialValue: d.periodStart)
        _periodEnd = State(initialValue: d.periodEnd)
        _paymentDate = State(initialValue: d.today)
    }

    private var typeBinding: Binding<String> {
        Binding(get: { runType }, set: { v in
            runType = v
            error = nil
            title = v == "bonus" ? defaults.bonusTitle : defaults.salaryTitle
        })
    }

    private var bonusTotal: Double { bonusRows.reduce(0) { $0 + (NPPYFmt.double($1.amount) ?? 0) } }

    var body: some View {
        NPOCSheetFrame(title: "給与計算を作成", confirmText: saving ? "作成中…" : "作成する", busy: saving, onCancel: onClose, onConfirm: { submit() }) {
            NPOCField(label: "種別") {
                Picker("種別", selection: typeBinding) {
                    Text("給与（期間集計）").tag("salary")
                    Text("賞与（金額を手入力）").tag("bonus")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            NPOCField(label: "タイトル") {
                TextField("例：2026年10月分", text: $title).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: runType == "salary" ? "期間・対象" : "支給日・対象") {
                NPPYFormGroup {
                    if runType == "salary" {
                        NPPYDateRow(label: "期間の始め", value: $periodStart)
                        NPPYFormDivider()
                        NPPYDateRow(label: "期間の終わり", value: $periodEnd)
                    } else {
                        NPPYDateRow(label: "支給日", value: $paymentDate)
                    }
                    NPPYFormDivider()
                    NPPYPickRow(label: "対象店舗", options: [("", "全社（全店舗）")] + stores.map { ($0.id, $0.name) }, selection: $storeId)
                }
            }
            if runType == "salary" {
                Text("期間中の勤怠と給与ルール・歩合ルールから計算します。作成後に明細を確かめてから「確定」→「承認」してください。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink3).padding(.horizontal, 4).fixedSize(horizontal: false, vertical: true)
            } else {
                bonusFields
            }
            NPPYFormError(error: error)
        }
    }

    private var bonusFields: some View {
        NPOCField(label: "対象スタッフ・支給額") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach($bonusRows) { $row in
                    HStack(spacing: 8) {
                        Picker("", selection: $row.profileId) {
                            Text("スタッフを選択").tag("")
                            ForEach(staff) { s in Text(s.name).tag(s.id) }
                        }
                        .pickerStyle(.menu)
                        .tint(NT.purple)
                        .labelsHidden()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        TextField("支給額", text: $row.amount).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                            .font(.system(size: 16, weight: .semibold)).frame(width: 110).npocInputBox()
                        Button { bonusRows.removeAll { $0.id == row.id } } label: {
                            Image(systemName: "trash").font(.system(size: 15, weight: .semibold))
                                .foregroundColor(bonusRows.count == 1 ? NT.ink3 : NT.danger)
                                .frame(width: 40, height: 44)
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(bonusRows.count == 1)
                        .accessibilityLabel("この行を削除")
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(npocCard(12))
                }
                Button { bonusRows.append(NPPYBonusRow(profileId: "", amount: "")) } label: {
                    Label("行を追加", systemImage: "plus").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
                HStack {
                    Spacer()
                    Text("合計 \(NPPYFmt.yen(bonusTotal))").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                }
                Text("勤怠・手当・歩合は入りません。税・社会保険を引く前の総支給額を入れてください。")
                    .font(.system(size: 12)).foregroundColor(NT.ink3).padding(.horizontal, 4).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func submit() {
        let cleanTitle = title.trimmingCharacters(in: .whitespaces)
        if cleanTitle.isEmpty {
            error = "タイトルを入力してください"
            return
        }
        error = nil
        let store = NPPYFmt.orNull(storeId.isEmpty ? nil : storeId)
        var body: [String: Any] = [:]
        if runType == "salary" {
            if periodStart > periodEnd {
                error = "期間の指定が正しくありません"
                return
            }
            body["type"] = "payrollRunCreate"
            body["title"] = cleanTitle
            body["periodStart"] = periodStart
            body["periodEnd"] = periodEnd
            body["storeId"] = store
        } else {
            let items: [[String: Any]] = bonusRows
                .filter { !$0.profileId.isEmpty && !$0.amount.trimmingCharacters(in: .whitespaces).isEmpty }
                .map { row in
                    let amount: Double = NPPYFmt.double(row.amount) ?? 0
                    let item: [String: Any] = ["profileId": row.profileId, "amount": amount]
                    return item
                }
            if items.isEmpty {
                error = "対象スタッフと支給額を1件以上入力してください"
                return
            }
            body["type"] = "payrollBonusCreate"
            body["title"] = cleanTitle
            body["paymentDate"] = paymentDate
            body["storeId"] = store
            body["items"] = items
        }
        if NativePreview.current != nil {
            onClose()
            return
        }
        saving = true
        let request = body
        Task {
            let r = await NPPYApi.post(request)
            saving = false
            if r.ok, let id = r.id { onCreated(id) } else { error = r.error ?? "作成できませんでした" }
        }
    }
}
