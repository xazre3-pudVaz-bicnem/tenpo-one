import SwiftUI

// iPhone の店長・オーナー：従業員（/app/employees・/app/employees/<id>）のネイティブ（2026-10-25 Ronnie「iPhone も native に」）。
//   一覧 … 氏名・社員番号で検索・雇用区分で絞る・詳細へ／従業員情報を登録（まだ台帳に無いスタッフから。登録したら詳細へ）
//   詳細 … 基本情報（社員番号・状態・戸籍名・カナ・郵便番号・住所・生年月日・役職・入社日・退職日・雇用区分・所属店舗）・
//          機密情報（銀行振込・緊急連絡先）・社会保険。見るのが中心で、直すのは iPad と同じ 3 つ（基本情報・機密情報・社会保険）をフォームで
//   見る：一覧は staff.manage、詳細は staff.manage か本人、機密・社会保険は payroll.view_all。直す：payroll.manage（サーバーが見る）
// サーバーは iPad と同じ POST employeesLoad・employeeLoad・employeeCreate・employeeBasic・employeeConfidential・employeeInsurance
// （lib/native-modules/employees.ts）。個人情報なので読み込みも POST（iPhone にも残さない）。
// iPad の中身の形（NEMListPayload …）・登録のシート（NEMCreateSheet）・NHXApi をそのまま使う（iPad は変えない）。

// MARK: - 一覧の持ち主

@MainActor
final class NPEMListModel: ObservableObject {
    @Published var payload: NEMListPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    @Published var query = ""
    @Published var type = ""

    func load() async {
        // 見本（-tenpoNativePreview phoneEmployees）は読み込まない
        if NativePreview.current != nil { return }
        do {
            payload = try await NHXApi.load(NEMListPayload.self, ["type": "employeesLoad"])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
    }

    /// Web の絞り込みと同じ（戸籍名・表示名・社員番号に含む／雇用区分）
    var rows: [NEMRow] {
        guard let p = payload else { return [] }
        let q = query.trimmingCharacters(in: .whitespaces)
        return p.rows.filter { r in
            let hit = q.isEmpty || (r.legalName ?? "").contains(q) || (r.displayName ?? "").contains(q) || (r.employeeNo ?? "").contains(q)
            return hit && (type.isEmpty || r.employmentType == type)
        }
    }
}

// MARK: - 詳細の持ち主

@MainActor
final class NPEMDetailModel: ObservableObject {
    @Published var payload: NEMDetailPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    let id: String

    init(id: String) { self.id = id }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            payload = try await NHXApi.load(NEMDetailPayload.self, ["type": "employeeLoad", "id": id])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
    }

    func saved(_ msg: String) {
        toast = NATToast(text: msg)
        Task { await load() }
    }
}

// MARK: - 入口（Web の道 → 一覧／詳細）

enum NPEMPage: Hashable {
    case list
    case detail(String)

    /// /app/employees → 一覧、/app/employees/<id> → 詳細
    static func from(_ route: NativeModuleRoute) -> NPEMPage {
        let first = route.rest.split(separator: "/").first.map(String.init) ?? ""
        return first.isEmpty ? .list : .detail(first)
    }
}

struct NativePhoneEmployeesScreen: View {
    let onBack: () -> Void
    @State private var page: NPEMPage
    /// 一覧の中身（詳細から戻ったときに読み直しを待たずに出す）
    @StateObject private var list = NPEMListModel()

    init(route: NativeModuleRoute, onBack: @escaping () -> Void) {
        self.onBack = onBack
        _page = State(initialValue: NPEMPage.from(route))
    }

    var body: some View {
        switch page {
        case .list:
            NativePhoneEmployeeListView(model: list, onBack: onBack, open: { id in page = .detail(id) })
        case .detail(let id):
            NativePhoneEmployeeDetailScreen(employeeId: id, onBack: { canList in
                // 一覧を見られない人（本人だけ）はホームへ（Web も「従業員台帳へ戻る」を出さない）
                if canList { page = .list } else { onBack() }
            })
            .id(id)
        }
    }
}

// MARK: - 一覧

struct NativePhoneEmployeeListView: View {
    @ObservedObject var model: NPEMListModel
    let onBack: () -> Void
    let open: (String) -> Void
    @State private var creating = false

    var body: some View {
        let p = model.payload
        return NPWPage(
            title: "従業員",
            subtitle: "従業員台帳",
            onBack: onBack,
            trailing: (p?.canWrite ?? false) ? NPWBarButton(icon: "person.badge.plus", label: "登録", action: { creating = true }) : nil,
            loaded: p != nil,
            error: model.error,
            toast: $model.toast,
            retry: { await model.load() },
            header: { header },
            content: { content }
        )
        .task { await model.load() }
        .sheet(isPresented: $creating) {
            if let p = model.payload {
                NEMCreateSheet(payload: p, onCreated: { id in
                    creating = false
                    if id.isEmpty { Task { await model.load() } } else { open(id) }
                }, onClose: { creating = false })
                .environment(\.colorScheme, .light)
            }
        }
    }

    @ViewBuilder private var header: some View {
        if let p = model.payload {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink3)
                    TextField("氏名・社員番号で検索", text: $model.query)
                        .font(.system(size: 16))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if !model.query.isEmpty {
                        Button { model.query = "" } label: {
                            Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("検索を消す")
                    }
                }
                .padding(.horizontal, 12).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        chip("すべて", on: model.type.isEmpty) { model.type = "" }
                        ForEach(p.employmentTypes) { t in
                            chip(t.label, on: model.type == t.id) { model.type = t.id }
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(NT.page)
            .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
        }
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .heavy)).foregroundColor(on ? Color.white : NT.ink2).lineLimit(1)
                .padding(.horizontal, 13).frame(height: 34)
                .background(Capsule().fill(on ? NT.purple : Color.white))
                .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    @ViewBuilder private var content: some View {
        if let p = model.payload {
            let rows = model.rows
            if rows.isEmpty {
                if p.rows.isEmpty {
                    NPWEmpty(icon: "person.2", title: "登録されている従業員がいません",
                             message: p.canWrite ? "右上の「登録」からスタッフを選んで登録してください" : nil)
                } else {
                    NPWEmpty(icon: "magnifyingglass", title: "条件に合う従業員がいません")
                }
            } else {
                NPWSectionTitle(title: "従業員", count: "\(rows.count)名")
                LazyVStack(spacing: 0) {
                    ForEach(rows) { r in
                        if r.id != rows.first?.id { NPWDivider(inset: 64) }
                        Button { open(r.id) } label: { row(r) }
                            .buttonStyle(.plain)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            }
        }
    }

    private func row(_ r: NEMRow) -> some View {
        let no: String? = (r.employeeNo ?? "").isEmpty ? nil : "No. \(r.employeeNo ?? "")"
        let pos: String? = (r.position ?? "").isEmpty ? nil : r.position
        let sub = [no, pos].compactMap { $0 }.joined(separator: " ・ ")
        let detail = [r.employmentTypeLabel, r.storeName ?? "", r.hiredOn == nil ? "" : "入社 \(r.hiredOnLabel)"].filter { !$0.isEmpty }.joined(separator: " ・ ")
        return HStack(spacing: 12) {
            NPWAvatar(name: r.name, size: 40, color: r.status == "active" ? NT.purple : NT.ink3)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(r.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1)
                    if r.status != "active" { NPBadge(text: r.statusLabel, color: NEMFmt.statusColor(r.status)) }
                }
                if !sub.isEmpty { Text(sub).font(.system(size: 12)).foregroundColor(NT.ink2).lineLimit(1) }
                Text(detail).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}

// MARK: - 詳細

/// 直すフォーム
enum NPEMEdit: String, Identifiable {
    case basic, confidential, insurance
    var id: String { rawValue }
}

struct NativePhoneEmployeeDetailScreen: View {
    let onBack: (Bool) -> Void
    @StateObject private var model: NPEMDetailModel

    init(employeeId: String, onBack: @escaping (Bool) -> Void) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: NPEMDetailModel(id: employeeId))
    }

    var body: some View {
        NativePhoneEmployeeDetailView(model: model, onBack: onBack)
    }
}

struct NativePhoneEmployeeDetailView: View {
    @ObservedObject var model: NPEMDetailModel
    /// 戻る（一覧を見られるか）
    let onBack: (Bool) -> Void
    @State private var editing: NPEMEdit?

    private var canList: Bool { model.payload?.canViewList ?? true }
    private var canEdit: Bool { model.payload?.canEdit == true && model.payload?.state == "ok" }

    var body: some View {
        NPWPage(
            title: model.payload?.displayName ?? "従業員",
            subtitle: "従業員詳細",
            backLabel: canList ? "一覧" : "ホーム",
            onBack: { onBack(canList) },
            trailing: canEdit ? NPWBarButton(icon: "square.and.pencil", label: "編集", action: { editing = .basic }) : nil,
            loaded: model.payload != nil,
            error: model.error,
            toast: $model.toast,
            retry: { await model.load() },
            content: { content }
        )
        .task { await model.load() }
        .sheet(item: $editing) { e in sheetView(e) }
    }

    @ViewBuilder private var content: some View {
        if let p = model.payload {
            if p.state == "notFound" {
                NPWEmpty(icon: "person.crop.circle.badge.questionmark", title: "従業員情報が見つかりません")
            } else if p.state == "forbidden" {
                NPWEmpty(icon: "lock", title: "閲覧権限がありません", message: "この従業員情報の閲覧には権限が必要です。管理者にお問い合わせください。")
            } else if let b = p.basic {
                profileCard(p, b)
                basicCard(p, b)
                if let c = p.confidential { confidentialCard(c) }
                if let i = p.insurance { insuranceCard(i) }
                if !canEdit {
                    Text("内容を直すには、給与の管理の権限が必要です。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
            }
        }
    }

    private func storeName(_ p: NEMDetailPayload, _ id: String) -> String {
        if id.isEmpty { return "未設定" }
        return (p.stores ?? []).first { $0.id == id }?.name ?? p.storeName ?? "—"
    }

    private func typeLabel(_ p: NEMDetailPayload, _ id: String) -> String {
        (p.employmentTypes ?? []).first { $0.id == id }?.label ?? p.employmentTypeLabel ?? id
    }

    private func statusLabel(_ s: String) -> String {
        NEMFmt.statusOptions.first { $0.id == s }?.label ?? (s == "deleted" ? "削除済み" : s)
    }

    private func date(_ s: String) -> String { s.isEmpty ? "" : NPDate.slash(s) }

    // MARK: 上のカード

    private func profileCard(_ p: NEMDetailPayload, _ b: NEMBasic) -> some View {
        let name = b.legalName.isEmpty ? (p.displayName ?? "—") : b.legalName
        return NPOCard {
            HStack(spacing: 14) {
                NPWAvatar(name: name, size: 54, color: b.status == "active" ? NT.purple : NT.ink3)
                VStack(alignment: .leading, spacing: 4) {
                    Text(name).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2)
                    if !b.legalNameKana.isEmpty {
                        Text(b.legalNameKana).font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
                    }
                    WrapLayout(spacing: 5) {
                        NPBadge(text: statusLabel(b.status), color: NEMFmt.statusColor(b.status))
                        NPBadge(text: typeLabel(p, b.employmentType), color: NT.purple)
                        if !b.position.isEmpty { NPBadge(text: b.position, color: NT.ink2) }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: 基本情報

    private func basicCard(_ p: NEMDetailPayload, _ b: NEMBasic) -> some View {
        card("基本情報", edit: canEdit ? .basic : nil) {
            infoRows([
                ("社員番号", b.employeeNo),
                ("所属店舗", storeName(p, b.primaryStoreId)),
                ("雇用区分", typeLabel(p, b.employmentType)),
                ("役職", b.position),
                ("入社日", date(b.hiredOn)),
                ("退職日", date(b.terminatedOn)),
                ("生年月日", date(b.birthDate)),
                ("郵便番号", b.postalCode),
                ("住所", b.address),
            ])
        }
    }

    /// 見出し：値 の行を線で区切って並べる（ViewBuilder の 10 個までに収める）
    private func infoRows(_ items: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                if i > 0 { NPWDivider() }
                NPWInfoRow(label: item.0, value: item.1)
            }
        }
    }

    // MARK: 機密情報

    private func confidentialCard(_ c: NEMConfidential) -> some View {
        card("機密情報", note: "給与閲覧権限を持つロールにだけ出ます。口座番号は末尾4桁だけ保存します。", edit: canEdit ? .confidential : nil) {
            Text("銀行振込").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink3).padding(.top, 4)
            infoRows([
                ("銀行・支店", [c.bank.bank, c.bank.branch].filter { !$0.isEmpty }.joined(separator: " ")),
                ("種別・口座", [c.bank.type, c.bank.last4.isEmpty ? "" : "末尾 \(c.bank.last4)"].filter { !$0.isEmpty }.joined(separator: " ・ ")),
                ("口座名義", c.bank.holder),
            ])
            Text("緊急連絡先").font(.system(size: 12, weight: .heavy)).foregroundColor(NT.ink3).padding(.top, 10)
            NPWInfoRow(label: "氏名・続柄", value: [c.emergency.name, c.emergency.relation.isEmpty ? "" : "（\(c.emergency.relation)）"].joined())
            NPWDivider()
            phoneRow(c.emergency.phone)
        }
    }

    @ViewBuilder private func phoneRow(_ phone: String) -> some View {
        let digits = phone.filter { "0123456789+".contains($0) }
        if !digits.isEmpty, let url = URL(string: "tel:\(digits)") {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("電話番号").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3).frame(width: 104, alignment: .leading)
                Link(destination: url) {
                    HStack(spacing: 5) {
                        Image(systemName: "phone.fill").font(.system(size: 12, weight: .bold))
                        Text(phone).font(.system(size: 15, weight: .bold)).monospacedDigit()
                    }
                    .foregroundColor(NT.purple)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 9)
        } else {
            NPWInfoRow(label: "電話番号", value: phone)
        }
    }

    // MARK: 社会保険

    private func insuranceCard(_ i: NEMInsurance) -> some View {
        let joined = [(i.healthInsurance, "健康保険"), (i.pension, "厚生年金"), (i.employmentInsurance, "雇用保険"), (i.careInsurance, "介護保険")]
        return card("社会保険", note: "保険料の自動計算はしません（構造のみ）。", edit: canEdit ? .insurance : nil) {
            WrapLayout(spacing: 6) {
                ForEach(Array(joined.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 4) {
                        Image(systemName: item.0 ? "checkmark.circle.fill" : "circle").font(.system(size: 12, weight: .bold))
                        Text(item.1).font(.system(size: 12.5, weight: .bold))
                    }
                    .foregroundColor(item.0 ? NT.ok : NT.ink3)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().fill(item.0 ? NFColor.successSoft : NT.page))
                }
            }
            .padding(.vertical, 6)
            infoRows([
                ("標準報酬月額", Int(i.standardMonthlyRemuneration).map { NT.yen($0) } ?? i.standardMonthlyRemuneration),
                ("都道府県", i.region),
                ("資格取得日", date(i.acquiredOn)),
                ("資格喪失日", date(i.lostOn)),
                ("メモ", i.note),
            ])
        }
    }

    /// 見出し（＋「編集」）と中身のカード
    private func card<Content: View>(_ title: String, note: String? = nil, edit: NPEMEdit?, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
                Spacer(minLength: 6)
                if let edit {
                    Button { editing = edit } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil").font(.system(size: 12, weight: .bold))
                            Text("編集").font(.system(size: 13, weight: .heavy))
                        }
                        .foregroundColor(NT.purple)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Capsule().fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            if let note {
                Text(note).font(.system(size: 11.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
            }
            VStack(alignment: .leading, spacing: 0) { inner }.padding(.top, 6)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    // MARK: 直すフォーム

    @ViewBuilder private func sheetView(_ e: NPEMEdit) -> some View {
        if let p = model.payload {
            switch e {
            case .basic:
                if let b = p.basic {
                    NPEMBasicSheet(basic: b, stores: p.stores ?? [], types: p.employmentTypes ?? [],
                                   onSaved: { msg in editing = nil; model.saved(msg) }, onClose: { editing = nil })
                        .environment(\.colorScheme, .light)
                }
            case .confidential:
                if let c = p.confidential {
                    NPEMConfidentialSheet(data: c, onSaved: { msg in editing = nil; model.saved(msg) }, onClose: { editing = nil })
                        .environment(\.colorScheme, .light)
                }
            case .insurance:
                if let i = p.insurance {
                    NPEMInsuranceSheet(data: i, onSaved: { msg in editing = nil; model.saved(msg) }, onClose: { editing = nil })
                        .environment(\.colorScheme, .light)
                }
            }
        }
    }
}

// MARK: - 基本情報を直す（Web の BasicInfoForm と同じ項目・同じ POST employeeBasic）

struct NPEMBasicSheet: View {
    let stores: [NEMOption]
    let types: [NEMType]
    let onSaved: (String) -> Void
    let onClose: () -> Void
    @State private var f: NEMBasic
    @State private var error: String?
    @State private var busy = false

    init(basic: NEMBasic, stores: [NEMOption], types: [NEMType], onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.stores = stores
        self.types = types
        self.onSaved = onSaved
        self.onClose = onClose
        _f = State(initialValue: basic)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NPEMTextRow(label: "社員番号", text: $f.employeeNo)
                    Picker("状態", selection: $f.status) {
                        ForEach(NEMFmt.statusOptions) { o in Text(o.label).tag(o.id) }
                        if !NEMFmt.statusOptions.contains(where: { $0.id == f.status }) { Text(f.status).tag(f.status) }
                    }
                }
                Section("氏名") {
                    NPEMTextRow(label: "戸籍名", text: $f.legalName)
                    NPEMTextRow(label: "カナ", text: $f.legalNameKana)
                }
                Section("勤務") {
                    Picker("雇用区分", selection: $f.employmentType) {
                        ForEach(types) { t in Text(t.label).tag(t.id) }
                    }
                    Picker("所属店舗", selection: $f.primaryStoreId) {
                        Text("未設定").tag("")
                        ForEach(stores) { s in Text(s.name).tag(s.id) }
                    }
                    NPEMTextRow(label: "役職", text: $f.position)
                    NHXDateRow(label: "入社日", value: $f.hiredOn)
                    NHXDateRow(label: "退職日", value: $f.terminatedOn)
                }
                Section("個人") {
                    NHXDateRow(label: "生年月日", value: $f.birthDate)
                    NPEMTextRow(label: "郵便番号", text: $f.postalCode, placeholder: "123-4567", keyboard: .numbersAndPunctuation)
                    TextField("住所", text: $f.address, axis: .vertical).lineLimit(1...4)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("基本情報を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? "保存中…" : "保存") { save() }.disabled(busy) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func save() {
        error = nil
        busy = true
        // 日付・店舗の空は空のまま送る（サーバーの parseNativeEmployeeAction が null に。中身の確かめは Web と同じ Server Action）
        let req: [String: Any] = [
            "type": "employeeBasic",
            "id": f.id,
            "employeeNo": f.employeeNo,
            "legalName": f.legalName,
            "legalNameKana": f.legalNameKana,
            "postalCode": f.postalCode,
            "address": f.address,
            "birthDate": f.birthDate,
            "hiredOn": f.hiredOn,
            "terminatedOn": f.terminatedOn,
            "employmentType": f.employmentType,
            "position": f.position,
            "primaryStoreId": f.primaryStoreId,
            "status": f.status,
        ]
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onSaved(r.message ?? "基本情報を保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 機密情報を直す（Web の ConfidentialForm と同じ・POST employeeConfidential）

struct NPEMConfidentialSheet: View {
    let employeeId: String
    let onSaved: (String) -> Void
    let onClose: () -> Void
    @State private var bank: NEMBank
    @State private var emergency: NEMEmergency
    @State private var error: String?
    @State private var busy = false

    init(data: NEMConfidential, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.employeeId = data.employeeId
        self.onSaved = onSaved
        self.onClose = onClose
        _bank = State(initialValue: data.bank)
        _emergency = State(initialValue: data.emergency)
    }

    /// 口座番号は数字だけ・4桁まで（Web の入力欄と同じ）
    private var last4: Binding<String> {
        Binding(get: { bank.last4 }, set: { bank.last4 = String(NEMFmt.digits($0).prefix(4)) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NPEMTextRow(label: "銀行名", text: $bank.bank)
                    NPEMTextRow(label: "支店名", text: $bank.branch)
                    NPEMTextRow(label: "種別", text: $bank.type, placeholder: "普通・当座 など")
                    NPEMTextRow(label: "口座番号（末尾4桁）", text: last4, placeholder: "1234", keyboard: .numberPad)
                    NPEMTextRow(label: "口座名義", text: $bank.holder)
                } header: {
                    Text("銀行振込")
                } footer: {
                    Text("口座番号は全桁を保存せず、末尾4桁だけ保存します。")
                }
                Section("緊急連絡先") {
                    NPEMTextRow(label: "氏名", text: $emergency.name)
                    NPEMTextRow(label: "続柄", text: $emergency.relation)
                    NPEMTextRow(label: "電話番号", text: $emergency.phone, keyboard: .phonePad)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("機密情報を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? "保存中…" : "保存") { save() }.disabled(busy) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func save() {
        if !bank.last4.isEmpty && bank.last4.count != 4 {
            error = "口座番号末尾は4桁の数字で入力してください"
            return
        }
        error = nil
        busy = true
        let bankBody: [String: Any] = ["bank": bank.bank, "branch": bank.branch, "type": bank.type, "last4": bank.last4, "holder": bank.holder]
        let emergencyBody: [String: Any] = ["name": emergency.name, "relation": emergency.relation, "phone": emergency.phone]
        let req: [String: Any] = ["type": "employeeConfidential", "id": employeeId, "bank": bankBody, "emergency": emergencyBody]
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onSaved(r.message ?? "機密情報を保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 社会保険を直す（Web の InsuranceForm と同じ・POST employeeInsurance）

struct NPEMInsuranceSheet: View {
    let onSaved: (String) -> Void
    let onClose: () -> Void
    @State private var f: NEMInsurance
    @State private var error: String?
    @State private var busy = false

    init(data: NEMInsurance, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.onSaved = onSaved
        self.onClose = onClose
        _f = State(initialValue: data)
    }

    private var remuneration: Binding<String> {
        Binding(get: { f.standardMonthlyRemuneration }, set: { f.standardMonthlyRemuneration = NEMFmt.digits($0) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("健康保険", isOn: $f.healthInsurance)
                    Toggle("厚生年金", isOn: $f.pension)
                    Toggle("雇用保険", isOn: $f.employmentInsurance)
                    Toggle("介護保険", isOn: $f.careInsurance)
                } header: {
                    Text("加入")
                } footer: {
                    Text("保険料率は法定ルール（専門家確認後に投入）を参照します。現時点で保険料の自動計算は行いません。")
                }
                Section {
                    NPEMTextRow(label: "標準報酬月額（円）", text: remuneration, keyboard: .numberPad)
                    NPEMTextRow(label: "都道府県", text: $f.region)
                    NHXDateRow(label: "資格取得日", value: $f.acquiredOn)
                    NHXDateRow(label: "資格喪失日", value: $f.lostOn)
                }
                Section("メモ") {
                    TextField("任意", text: $f.note, axis: .vertical).lineLimit(2...6)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("社会保険を編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? "保存中…" : "保存") { save() }.disabled(busy) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func save() {
        let amount = f.standardMonthlyRemuneration.trimmingCharacters(in: .whitespaces)
        if !amount.isEmpty && Int(amount) == nil {
            error = "標準報酬月額は0以上の数値で入力してください"
            return
        }
        error = nil
        busy = true
        let req: [String: Any] = [
            "type": "employeeInsurance",
            "employeeId": f.employeeId,
            "healthInsurance": f.healthInsurance,
            "pension": f.pension,
            "employmentInsurance": f.employmentInsurance,
            "careInsurance": f.careInsurance,
            "standardMonthlyRemuneration": amount,
            "acquiredOn": f.acquiredOn,
            "lostOn": f.lostOn,
            "region": f.region,
            "note": f.note,
        ]
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onSaved(r.message ?? "社会保険情報を保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

/// フォームの 1 行（見出し・右寄せの入力）
struct NPEMTextRow: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default

    var body: some View {
        HStack(spacing: 10) {
            Text(label).lineLimit(1).layoutPriority(1)
            Spacer(minLength: 6)
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
                .foregroundColor(NT.ink)
        }
    }
}
