import SwiftUI

// iPhone の店長・オーナー：会計の入力のシート（Web の journal-entry-dialog・bank-account-form・bank-manual-tx-form・fixed-assets-panel と同じ中身）。
//   仕訳の作成・編集（下書き。借方合計＝貸方合計のときだけ保存）・勘定科目を探して選ぶ・銀行口座の登録・編集・取引の手入力・
//   固定資産の登録・編集・除却／売却
// iPhone のアプリは暗い表示なので Form は使わず、明るい自前のシート（NPOCSheetFrame）にする。POST は iPad と同じ type。

// MARK: - 部品

/// 選ぶ（Web の <select>。白い入力欄の形）
struct NPACSelect: View {
    let options: [(String, String)]
    let selection: String
    var placeholder = "選択してください"
    let onSelect: (String) -> Void

    private var current: String? { options.first { $0.0 == selection }?.1 }

    var body: some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                Button { onSelect(o.0) } label: {
                    if o.0 == selection { Label(o.1, systemImage: "checkmark") } else { Text(o.1) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(current ?? placeholder).foregroundColor(current == nil ? NT.ink3 : NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .font(.system(size: 15.5, weight: .semibold))
            .npocInputBox()
        }
    }
}

/// 赤いエラーの箱
struct NPACProblem: View {
    let text: String

    var body: some View {
        Text(text).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
    }
}

/// 日付の 1 行（白いカード）
struct NPACDateRow: View {
    let label: String
    @Binding var date: Date

    var body: some View {
        HStack {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            Spacer(minLength: 8)
            DatePicker(label, selection: $date, displayedComponents: .date).labelsHidden()
        }
        .npocRow()
        .background(npocCard(12))
    }
}

/// 一覧から探して 1 つ選ぶ（勘定科目など。数が多くても探せる）
struct NPACPickItem: Identifiable, Hashable {
    let id: String
    let name: String
    let sub: String
}

struct NPACPickSheet: View {
    let title: String
    let items: [NPACPickItem]
    let selected: String?
    var noneLabel = ""
    let onPick: (String) -> Void
    let onClose: () -> Void

    @State private var search = ""

    private var shown: [NPACPickItem] {
        let q = NPACText.trimmed(search).lowercased()
        if q.isEmpty { return items }
        return items.filter { $0.name.lowercased().contains(q) || $0.sub.lowercased().contains(q) }
    }

    var body: some View {
        NPOCSheetFrame(title: title, cancelText: "閉じる", onCancel: onClose) {
            NPZSearchField(text: $search, placeholder: "コード・名前で探す")
            VStack(spacing: 0) {
                if !noneLabel.isEmpty && search.isEmpty { row(NPACPickItem(id: "", name: noneLabel, sub: "")) }
                ForEach(shown) { it in row(it) }
            }
            .background(npocCard(14))
            if shown.isEmpty {
                Text("見つかりません").font(.system(size: 13.5)).foregroundColor(NT.ink3).frame(maxWidth: .infinity)
            }
        }
    }

    private func row(_ it: NPACPickItem) -> some View {
        Button { onPick(it.id) } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(it.name).font(.system(size: 15.5, weight: .semibold)).foregroundColor(NT.ink).multilineTextAlignment(.leading)
                    if !it.sub.isEmpty { Text(it.sub).font(.system(size: 12)).foregroundColor(NT.ink3) }
                }
                Spacer(minLength: 6)
                if selected == it.id {
                    Image(systemName: "checkmark").font(.system(size: 14, weight: .heavy)).foregroundColor(NT.purple)
                }
            }
            .padding(.horizontal, 14).frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { NPACDivider().padding(.leading, 14) }
    }
}

// MARK: - 仕訳を作成・編集（下書き。借方合計＝貸方合計のときだけ保存できる）

struct NPACLineDraft: Identifiable, Hashable {
    var id = UUID()
    var accountId = ""
    var side = "debit"
    var amount = ""
    var tax = "out_of_scope"
    var memo = ""
}

struct NPACLineRef: Identifiable {
    let id: UUID
}

struct NPACEntryEditor: View {
    let payload: NPACJournalPayload
    let entry: NPACJournalEntry?
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var date: Date
    @State private var desc: String
    @State private var storeId: String
    @State private var lines: [NPACLineDraft]
    @State private var saving = false
    @State private var problem: String?
    @State private var picking: NPACLineRef?

    init(payload: NPACJournalPayload, entry: NPACJournalEntry?, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.payload = payload
        self.entry = entry
        self.onClose = onClose
        self.onSaved = onSaved
        _date = State(initialValue: NOS.date(entry?.entryDate ?? payload.today) ?? Date())
        _desc = State(initialValue: entry?.description ?? "")
        _storeId = State(initialValue: entry?.storeId ?? "")
        let start: [NPACLineDraft]
        if let e = entry, !e.lines.isEmpty {
            start = e.lines.map { l in
                NPACLineDraft(accountId: l.accountId, side: l.side, amount: String(l.amount), tax: l.taxTreatment, memo: l.memo ?? "")
            }
        } else {
            start = [NPACLineDraft(side: "debit"), NPACLineDraft(side: "credit")]
        }
        _lines = State(initialValue: start)
    }

    private var withAccount: [NPACLineDraft] { lines.filter { !$0.accountId.isEmpty } }
    private var debit: Int { withAccount.filter { $0.side == "debit" }.reduce(0) { $0 + NPACText.amount($1.amount) } }
    private var credit: Int { withAccount.filter { $0.side == "credit" }.reduce(0) { $0 + NPACText.amount($1.amount) } }
    /// Web の validateJournalBalance と同じ（科目のある行は全部 1 円以上・借方＝貸方＞0）
    private var balanced: Bool { debit == credit && debit > 0 && withAccount.allSatisfy { NPACText.amount($0.amount) > 0 } }
    private var validCount: Int { lines.filter { !$0.accountId.isEmpty && NPACText.amount($0.amount) > 0 }.count }
    private var canSave: Bool { balanced && validCount >= 2 && !NPACText.trimmed(desc).isEmpty }

    private func binding(_ id: UUID) -> Binding<NPACLineDraft> {
        Binding(
            get: { lines.first { $0.id == id } ?? NPACLineDraft() },
            set: { v in if let i = lines.firstIndex(where: { $0.id == id }) { lines[i] = v } }
        )
    }

    private func setAccount(_ lineId: UUID, _ accountId: String) {
        guard let i = lines.firstIndex(where: { $0.id == lineId }) else { return }
        lines[i].accountId = accountId
        lines[i].tax = payload.accounts.first { $0.id == accountId }?.defaultTaxTreatment ?? "out_of_scope"
    }

    var body: some View {
        NPOCSheetFrame(title: entry == nil ? "仕訳を作成（下書き）" : "仕訳を編集（下書き）", confirmText: saving ? "保存中…" : "下書き保存",
                       busy: saving, onCancel: onClose, onConfirm: { Task { await save() } }) {
            if let problem { NPACProblem(text: problem) }
            basics
            linesSection
            totals
        }
        .sheet(item: $picking) { ref in
            NPACPickSheet(title: "勘定科目",
                          items: payload.accounts.map { NPACPickItem(id: $0.id, name: "\($0.code) \($0.name)", sub: "") },
                          selected: lines.first { $0.id == ref.id }?.accountId,
                          onPick: { id in
                              setAccount(ref.id, id)
                              picking = nil
                          },
                          onClose: { picking = nil })
        }
    }

    private var basics: some View {
        VStack(alignment: .leading, spacing: 12) {
            NPACDateRow(label: "日付", date: $date)
            if !payload.stores.isEmpty {
                NPOCField(label: "店舗（任意）") {
                    NPACSelect(options: [("", "全社（店舗指定なし）")] + payload.stores.map { ($0.id, $0.name) }, selection: storeId) { storeId = $0 }
                }
            }
            NPOCField(label: "摘要") {
                TextField("例：4月分家賃支払い", text: $desc).font(.system(size: 16)).npocInputBox()
            }
        }
    }

    private var linesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            NPOCSectionTitle(title: "明細", note: "勘定科目・借方／貸方・金額を入れます。2行以上で、借方合計と貸方合計を同じにします。")
            ForEach(Array(lines.enumerated()), id: \.element.id) { i, l in
                lineCard(l.id, index: i)
            }
            Button { lines.append(NPACLineDraft()) } label: {
                Label("行を追加", systemImage: "plus").font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                    .frame(maxWidth: .infinity).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
            }
            .buttonStyle(PressableStyle())
        }
    }

    private func lineCard(_ id: UUID, index: Int) -> some View {
        let b = binding(id)
        let account = payload.accounts.first { $0.id == b.wrappedValue.accountId }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(index + 1)行目").font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink2)
                Spacer()
                Button(role: .destructive) {
                    lines.removeAll { $0.id == id }
                } label: {
                    Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(lines.count <= 2 ? NT.line : NT.danger)
                        .frame(width: 36, height: 32)
                }
                .buttonStyle(.plain)
                .disabled(lines.count <= 2)
                .accessibilityLabel("この行を消す")
            }
            Button { picking = NPACLineRef(id: id) } label: {
                HStack(spacing: 6) {
                    Text(account.map { "\($0.code) \($0.name)" } ?? "勘定科目を選ぶ")
                        .font(.system(size: 15.5, weight: .semibold)).foregroundColor(account == nil ? NT.ink3 : NT.ink).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
                .npocInputBox()
            }
            .buttonStyle(.plain)
            Picker("借方／貸方", selection: b.side) {
                Text("借方").tag("debit")
                Text("貸方").tag("credit")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    TextField("金額", text: b.amount).keyboardType(.numberPad).font(.system(size: 17, weight: .bold)).monospacedDigit()
                        .multilineTextAlignment(.trailing)
                    Text("円").font(.system(size: 13)).foregroundColor(NT.ink3)
                }
                .npocInputBox()
                NPACSelect(options: payload.taxOptions.map { ($0.value, $0.label) }, selection: b.wrappedValue.tax) { v in b.wrappedValue.tax = v }
            }
            TextField("メモ（任意）", text: b.memo).font(.system(size: 15)).npocInputBox()
        }
        .padding(12)
        .background(npocCard(14))
    }

    private var totals: some View {
        VStack(alignment: .leading, spacing: 4) {
            NPACMoneyRow(label: "借方合計", value: debit)
            NPACMoneyRow(label: "貸方合計", value: credit)
            NPACDivider()
            NPACMoneyRow(label: "差額", value: abs(debit - credit), bold: true, tone: balanced ? NT.ok : NT.danger)
            if !canSave {
                Text("明細を2行以上入力し、借方合計と貸方合計を一致させると保存できます。").font(.system(size: 12)).foregroundColor(NT.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(npocCard(14))
    }

    private func save() async {
        problem = nil
        if NPACText.trimmed(desc).isEmpty { problem = "摘要を入力してください"; return }
        guard canSave else { problem = "借方合計と貸方合計を一致させてください（差額0で保存できます）"; return }
        saving = true
        defer { saving = false }
        let body: [String: Any] = [
            "type": "accJournalSave",
            "id": entry?.id ?? "",
            "entryDate": NOS.str(date),
            "description": NPACText.trimmed(desc),
            "storeId": storeId,
            "lines": lines
                .filter { !$0.accountId.isEmpty && NPACText.amount($0.amount) > 0 }
                .map { l -> [String: Any] in
                    ["accountId": l.accountId, "side": l.side, "amount": NPACText.amount(l.amount), "taxTreatment": l.tax, "memo": NPACText.trimmed(l.memo)]
                },
        ]
        do {
            try await NPACApi.send(body)
            onSaved(entry == nil ? "仕訳を下書き保存しました" : "仕訳（下書き）を更新しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 銀行口座の登録・編集（Web の BankAccountForm）

struct NPACBankForm: View {
    let bank: NPACBank?
    let stores: [NPACStore]
    let accountOptions: [NPACAccountRef]
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var storeId: String
    @State private var bankName: String
    @State private var branchName: String
    @State private var accountType: String
    @State private var last4: String
    @State private var holder: String
    @State private var accountId: String
    @State private var saving = false
    @State private var problem: String?

    init(bank: NPACBank?, stores: [NPACStore], accountOptions: [NPACAccountRef], onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.bank = bank
        self.stores = stores
        self.accountOptions = accountOptions
        self.onClose = onClose
        self.onSaved = onSaved
        _storeId = State(initialValue: bank?.storeId ?? "")
        _bankName = State(initialValue: bank?.bankName ?? "")
        _branchName = State(initialValue: bank?.branchName ?? "")
        _accountType = State(initialValue: bank?.accountType ?? "ordinary")
        _last4 = State(initialValue: bank?.accountLast4 ?? "")
        _holder = State(initialValue: bank?.holderName ?? "")
        _accountId = State(initialValue: bank == nil ? (accountOptions.first?.id ?? "") : (bank?.accountId ?? ""))
    }

    var body: some View {
        NPOCSheetFrame(title: bank == nil ? "銀行口座を登録" : "銀行口座を編集", confirmText: saving ? "保存中…" : "保存",
                       busy: saving, onCancel: onClose, onConfirm: { Task { await save() } }) {
            if let problem { NPACProblem(text: problem) }
            if !stores.isEmpty {
                NPOCField(label: "店舗（任意・全社共通なら未選択）") {
                    NPACSelect(options: [("", "全社共通")] + stores.map { ($0.id, $0.name) }, selection: storeId) { storeId = $0 }
                }
            }
            NPOCField(label: "銀行名") { TextField("例：〇〇銀行", text: $bankName).font(.system(size: 16)).npocInputBox() }
            NPOCField(label: "支店名") { TextField("例：本店", text: $branchName).font(.system(size: 16)).npocInputBox() }
            NPOCField(label: "種別") {
                Picker("種別", selection: $accountType) {
                    Text("普通").tag("ordinary")
                    Text("当座").tag("checking")
                    Text("貯蓄").tag("savings")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            NPOCField(label: "口座番号（末尾4桁のみ）") {
                TextField("1234", text: Binding(get: { last4 }, set: { v in last4 = String(v.filter { $0.isASCII && $0.isNumber }.prefix(4)) }))
                    .keyboardType(.numberPad).font(.system(size: 16)).monospacedDigit().npocInputBox()
            }
            NPOCField(label: "名義") { TextField("例：カ）テンポワン", text: $holder).font(.system(size: 16)).npocInputBox() }
            NPOCField(label: "対応する勘定科目") {
                if accountOptions.isEmpty {
                    Text("普通預金等（sub_type=bank）の勘定科目が見つかりません。自動仕訳から標準科目（普通預金 110）を導入するか、勘定科目を登録してください。")
                        .font(.system(size: 12.5)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true)
                } else {
                    NPACSelect(options: [("", "選択してください")] + accountOptions.map { ($0.id, "\($0.code) \($0.name)") }, selection: accountId) { accountId = $0 }
                }
            }
        }
    }

    private func save() async {
        problem = nil
        if NPACText.trimmed(bankName).isEmpty { problem = "銀行名を入力してください"; return }
        saving = true
        defer { saving = false }
        let body: [String: Any] = [
            "type": "accBankSave",
            "id": bank?.id ?? "",
            "storeId": storeId,
            "bankName": bankName,
            "branchName": branchName,
            "accountType": accountType,
            "accountLast4": last4,
            "holderName": holder,
            "accountId": accountId,
        ]
        do {
            try await NPACApi.send(body)
            onSaved(bank == nil ? "銀行口座を登録しました" : "更新しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 取引を手入力（Web の BankManualTxForm）

struct NPACBankTxSheet: View {
    let bankId: String
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var date = Date()
    @State private var desc = ""
    @State private var direction = "deposit"
    @State private var amount = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NPOCSheetFrame(title: "取引を手入力", confirmText: saving ? "登録中…" : "登録", busy: saving, onCancel: onClose, onConfirm: { Task { await save() } }) {
            if let problem { NPACProblem(text: problem) }
            NPACDateRow(label: "日付", date: $date)
            NPOCField(label: "摘要") { TextField("例：家賃振込", text: $desc).font(.system(size: 16)).npocInputBox() }
            NPOCField(label: "区分") {
                Picker("区分", selection: $direction) {
                    Text("入金").tag("deposit")
                    Text("出金").tag("withdrawal")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            NPOCField(label: "金額") {
                HStack(spacing: 4) {
                    TextField("例：10000", text: $amount).keyboardType(.numberPad).font(.system(size: 18, weight: .bold)).monospacedDigit()
                        .multilineTextAlignment(.trailing)
                    Text("円").foregroundColor(NT.ink3)
                }
                .npocInputBox()
            }
        }
    }

    private func save() async {
        problem = nil
        let value = NPACText.amount(amount)
        guard value > 0 else { problem = "金額は1円以上の整数で入力してください"; return }
        guard !NPACText.trimmed(desc).isEmpty else { problem = "摘要を入力してください"; return }
        saving = true
        defer { saving = false }
        do {
            try await NPACApi.send([
                "type": "accBankTxAdd",
                "bankAccountId": bankId,
                "date": NOS.str(date),
                "description": NPACText.trimmed(desc),
                "deposit": direction == "deposit" ? value : 0,
                "withdrawal": direction == "withdrawal" ? value : 0,
            ])
            onSaved("取引を登録しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 固定資産の登録・編集（Web の FixedAssetsPanel のダイアログ）

struct NPACAssetEditor: View {
    let payload: NPACAssetsPayload
    let asset: NPACAsset?
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var name: String
    @State private var acquiredOn: Date
    @State private var cost: String
    @State private var life: String
    @State private var method: String
    @State private var storeId: String
    @State private var note: String
    @State private var saving = false
    @State private var problem: String?

    init(payload: NPACAssetsPayload, asset: NPACAsset?, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.payload = payload
        self.asset = asset
        self.onClose = onClose
        self.onSaved = onSaved
        _name = State(initialValue: asset?.name ?? "")
        _acquiredOn = State(initialValue: NOS.date(asset?.acquiredOn ?? payload.today) ?? Date())
        _cost = State(initialValue: String(asset?.acquisitionCost ?? 0))
        _life = State(initialValue: asset?.usefulLifeYears.map { String($0) } ?? "")
        _method = State(initialValue: asset?.depreciationMethod ?? "straight_line")
        _storeId = State(initialValue: asset?.storeId ?? "")
        _note = State(initialValue: asset?.note ?? "")
    }

    var body: some View {
        NPOCSheetFrame(title: asset == nil ? "固定資産を登録" : "固定資産を編集", confirmText: saving ? "保存中…" : "保存",
                       busy: saving, onCancel: onClose, onConfirm: { Task { await save() } }) {
            if let problem { NPACProblem(text: problem) }
            NPOCField(label: "名称") { TextField("例：厨房機器一式", text: $name).font(.system(size: 16)).npocInputBox() }
            NPACDateRow(label: "取得日", date: $acquiredOn)
            NPOCField(label: "取得価額") {
                HStack(spacing: 4) {
                    TextField("0", text: $cost).keyboardType(.numberPad).font(.system(size: 18, weight: .bold)).monospacedDigit().multilineTextAlignment(.trailing)
                    Text("円").foregroundColor(NT.ink3)
                }
                .npocInputBox()
            }
            NPOCField(label: "耐用年数（任意）") {
                HStack(spacing: 4) {
                    TextField("例：8", text: $life).keyboardType(.numberPad).font(.system(size: 16)).monospacedDigit().multilineTextAlignment(.trailing)
                    Text("年").foregroundColor(NT.ink3)
                }
                .npocInputBox()
            }
            NPOCField(label: "償却方法") {
                NPACSelect(options: payload.methods.map { ($0.value, $0.label) }, selection: method) { method = $0 }
            }
            NPOCField(label: "店舗（任意）") {
                NPACSelect(options: [("", "全社（店舗指定なし）")] + payload.stores.map { ($0.id, $0.name) }, selection: storeId) { storeId = $0 }
            }
            NPOCField(label: "メモ") {
                TextField("メモ", text: $note, axis: .vertical).lineLimit(2...5).font(.system(size: 15)).npocInputBox()
            }
            Text("減価償却の自動計算は償却ルールの専門家確認後に対応予定です（ルールversion方式で設計済み）。現時点では台帳としての登録・管理のみ行えます。")
                .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func save() async {
        problem = nil
        guard !NPACText.trimmed(name).isEmpty else { problem = "名称を入力してください"; return }
        saving = true
        defer { saving = false }
        var body: [String: Any] = [
            "type": "accAssetSave",
            "id": asset?.id ?? "",
            "name": NPACText.trimmed(name),
            "acquiredOn": NOS.str(acquiredOn),
            "depreciationMethod": method,
            "storeId": storeId,
            "note": note,
        ]
        // 取得価額：空なら 0（Web の number 入力と同じ）、読めなければサーバーが「取得価額を正しく入力してください」
        let costText = NPACText.trimmed(cost)
        if costText.isEmpty {
            body["acquisitionCost"] = 0
        } else if let n = NOS.num(costText) {
            body["acquisitionCost"] = n
        } else {
            body["acquisitionCost"] = NSNull()
        }
        if let years = Int(NPACText.trimmed(life)) {
            body["usefulLifeYears"] = years
        } else {
            body["usefulLifeYears"] = NSNull()
        }
        do {
            try await NPACApi.send(body)
            onSaved(asset == nil ? "固定資産を登録しました" : "固定資産を更新しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}

/// 除却・売却の登録（戻すときは「使用中に戻す」）
struct NPACDisposeSheet: View {
    let asset: NPACAsset
    let today: String
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var status = "disposed"
    @State private var date: Date
    @State private var saving = false
    @State private var problem: String?
    @State private var confirm = false

    init(asset: NPACAsset, today: String, onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.asset = asset
        self.today = today
        self.onClose = onClose
        self.onSaved = onSaved
        _date = State(initialValue: NOS.date(today) ?? Date())
    }

    var body: some View {
        NPOCSheetFrame(title: "除却・売却の登録", confirmText: saving ? "登録中…" : "登録", busy: saving, onCancel: onClose, onConfirm: { confirm = true }) {
            if let problem { NPACProblem(text: problem) }
            Text("「\(asset.name)」の状態を変更します。").font(.system(size: 14)).foregroundColor(NT.ink2)
            NPOCField(label: "区分") {
                Picker("区分", selection: $status) {
                    Text("除却").tag("disposed")
                    Text("売却").tag("sold")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            NPACDateRow(label: status == "sold" ? "売却日" : "除却日", date: $date)
        }
        .confirmationDialog(status == "sold" ? "売却を登録しますか？" : "除却を登録しますか？", isPresented: $confirm, titleVisibility: .visible) {
            Button(status == "sold" ? "売却を登録する" : "除却を登録する", role: .destructive) { Task { await save() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「\(asset.name)」\(NOS.str(date).replacingOccurrences(of: "-", with: "/"))")
        }
    }

    private func save() async {
        problem = nil
        saving = true
        defer { saving = false }
        let sold = status == "sold"
        do {
            try await NPACApi.send(["type": "accAssetStatus", "id": asset.id, "status": status, "disposedOn": NOS.str(date)])
            onSaved(sold ? "売却を登録しました" : "除却を登録しました")
        } catch {
            problem = NativeModuleAPI.message(error)
        }
    }
}
