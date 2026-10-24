import SwiftUI

// 従業員台帳（/app/employees・/app/employees/<id>）のネイティブ。Web と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   一覧 … 氏名・社員番号で検索・雇用区分で絞り込み・詳細へ／従業員情報を登録（まだ台帳に無いスタッフから。登録したら詳細へ）
//   詳細 … 基本情報（社員番号・状態・戸籍名・カナ・郵便番号・住所・生年月日・役職・入社日・退職日・雇用区分・所属店舗）
//          機密情報（銀行振込・緊急連絡先）・社会保険（健保・年金・雇用・介護・標準報酬月額・都道府県・資格取得日／喪失日・メモ）
//   見る：一覧は staff.manage、詳細は staff.manage か本人、機密・社会保険は payroll.view_all。直す：payroll.manage
//   （Web と同じ。サーバー lib/native-modules/employees.ts と Server Action でももう一度見る）
// 個人情報なので iPad に残さない：読み込みも POST（GET の返事は iPad に保存されるため。lib/native-employees.ts）。
// 共通の部品（NHXPage・NHXCard・NHXButton・NHXApi …）は NativeShiftsView.swift。

// MARK: - 中身（サーバーの返事）

struct NEMOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NEMType: Decodable, Hashable, Identifiable {
    let id: String
    let label: String
}

struct NEMRow: Decodable, Hashable, Identifiable {
    let id: String
    let employeeNo: String?
    let legalName: String?
    let displayName: String?
    let employmentType: String
    let employmentTypeLabel: String
    let storeName: String?
    let position: String?
    let hiredOn: String?
    let hiredOnLabel: String
    let status: String
    let statusLabel: String

    /// Web と同じ：戸籍名 → 表示名
    var name: String {
        if let n = legalName, !n.isEmpty { return n }
        if let n = displayName, !n.isEmpty { return n }
        return "—"
    }
}

struct NEMListPayload: Decodable {
    let ok: Bool
    let canWrite: Bool
    let rows: [NEMRow]
    let staffOptions: [NEMOption]
    let stores: [NEMOption]
    let employmentTypes: [NEMType]
}

struct NEMBasic: Decodable, Hashable {
    var id: String
    var employeeNo: String
    var legalName: String
    var legalNameKana: String
    var postalCode: String
    var address: String
    var birthDate: String
    var hiredOn: String
    var terminatedOn: String
    var employmentType: String
    var position: String
    var primaryStoreId: String
    var status: String
}

struct NEMBank: Decodable, Hashable {
    var bank: String
    var branch: String
    var type: String
    var last4: String
    var holder: String
}

struct NEMEmergency: Decodable, Hashable {
    var name: String
    var relation: String
    var phone: String
}

struct NEMConfidential: Decodable, Hashable {
    let employeeId: String
    let bank: NEMBank
    let emergency: NEMEmergency
}

struct NEMInsurance: Decodable, Hashable {
    var employeeId: String
    var healthInsurance: Bool
    var pension: Bool
    var employmentInsurance: Bool
    var careInsurance: Bool
    var standardMonthlyRemuneration: String
    var acquiredOn: String
    var lostOn: String
    var region: String
    var note: String
}

struct NEMDetailPayload: Decodable {
    let ok: Bool
    /// ok ／ notFound ／ forbidden
    let state: String
    let canViewList: Bool
    let canEdit: Bool?
    let displayName: String?
    let employmentType: String?
    let employmentTypeLabel: String?
    let storeName: String?
    let hiredOn: String?
    let hiredOnLabel: String?
    let basic: NEMBasic?
    let confidential: NEMConfidential?
    let insurance: NEMInsurance?
    let stores: [NEMOption]?
    let employmentTypes: [NEMType]?
}

enum NEMFmt {
    static let statusOptions = [NEMType(id: "active", label: "在籍中"), NEMType(id: "retired", label: "退職")]

    static func statusColor(_ s: String) -> Color {
        switch s {
        case "active": return NT.ok
        case "deleted": return NT.danger
        default: return NT.ink3
        }
    }

    static func digits(_ s: String) -> String { s.filter { "0123456789".contains($0) } }
}

// MARK: - 入口（Web の道 → 画面）

enum NEMScreen: Hashable {
    case list
    case detail(String)

    /// /app/employees・/app/employees/<id>
    static func from(_ route: NativeModuleRoute) -> NEMScreen {
        let first = route.rest.split(separator: "/").first.map(String.init) ?? ""
        return first.isEmpty ? .list : .detail(first)
    }
}

struct NativeEmployeesView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    @State private var screen: NEMScreen

    init(route: NativeModuleRoute, onHome: @escaping () -> Void) {
        self.route = route
        self.onHome = onHome
        _screen = State(initialValue: NEMScreen.from(route))
    }

    var body: some View {
        content
            .id(screen)
            .onChange(of: route) { r in screen = NEMScreen.from(r) }
    }

    @ViewBuilder private var content: some View {
        switch screen {
        case .list:
            NEMListScreen(onHome: onHome, open: { screen = .detail($0) })
        case .detail(let id):
            // 一覧を見られない人（本人だけ）はホームへ戻る（Web も「従業員台帳へ戻る」を出さない）
            NEMDetailScreen(employeeId: id, onBack: { canList in
                if canList { screen = .list } else { onHome() }
            })
        }
    }
}

// MARK: - 一覧（/app/employees）

@MainActor
final class NEMListModel: ObservableObject {
    @Published var payload: NEMListPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var query = ""
    @Published var type = ""

    func load() async {
        do {
            payload = try await NHXApi.load(NEMListPayload.self, ["type": "employeesLoad"])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
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

struct NEMListScreen: View {
    let onHome: () -> Void
    let open: (String) -> Void
    @StateObject private var model = NEMListModel()
    @State private var creating = false

    init(onHome: @escaping () -> Void, open: @escaping (String) -> Void) {
        self.onHome = onHome
        self.open = open
    }

    var body: some View {
        NHXPage(title: "従業員台帳", onBack: onHome, loaded: model.payload != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload { listBody(p) }
        }
        .task { await model.load() }
        .sheet(isPresented: $creating) {
            if let p = model.payload {
                NEMCreateSheet(payload: p, onCreated: { id in
                    creating = false
                    if id.isEmpty { Task { await model.load() } } else { open(id) }
                }, onClose: { creating = false })
            }
        }
    }

    @ViewBuilder private func listBody(_ p: NEMListPayload) -> some View {
        Text("従業員の基本情報・雇用区分・所属店舗を管理します").font(.system(size: 14)).foregroundColor(NT.ink2)
        HStack(spacing: 10) {
            NSPInput(text: $model.query, placeholder: "氏名・社員番号で検索", width: 320)
            typeMenu(p)
            Spacer(minLength: 8)
            if p.canWrite {
                NHXButton(text: "従業員情報を登録", icon: "person.badge.plus", kind: .primary, disabled: p.staffOptions.isEmpty) { creating = true }
            }
        }
        let rows = model.rows
        if rows.isEmpty {
            NHXCard(title: "従業員", trailing: { EmptyView() }) {
                NHXEmpty(title: "登録されている従業員がいません", message: p.canWrite ? "「従業員情報を登録」からスタッフを選択して登録してください" : nil)
            }
        } else {
            table(rows)
        }
    }

    private func typeMenu(_ p: NEMListPayload) -> some View {
        Menu {
            Button("すべての雇用区分") { model.type = "" }
            ForEach(p.employmentTypes) { t in
                Button(t.label) { model.type = t.id }
            }
        } label: {
            HStack(spacing: 6) {
                Text(p.employmentTypes.first { $0.id == model.type }?.label ?? "すべての雇用区分")
                    .font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 13).frame(height: 46)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    private func table(_ rows: [NEMRow]) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("氏名・社員番号").frame(maxWidth: .infinity, alignment: .leading)
                Text("雇用区分").frame(width: 120, alignment: .leading)
                Text("所属店舗").frame(width: 130, alignment: .leading)
                Text("入社日").frame(width: 100, alignment: .leading)
                Text("状態").frame(width: 70, alignment: .leading)
                Color.clear.frame(width: 12, height: 1)
            }
            .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
            .padding(.horizontal, 18).padding(.vertical, 10)
            ForEach(rows) { r in
                Rectangle().fill(NT.line).frame(height: 1)
                Button { open(r.id) } label: { rowView(r) }
                    .buttonStyle(.plain)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func rowView(_ r: NEMRow) -> some View {
        let no: String? = (r.employeeNo ?? "").isEmpty ? nil : "社員番号 \(r.employeeNo ?? "")"
        let pos: String? = (r.position ?? "").isEmpty ? nil : r.position
        let sub = [no, pos].compactMap { $0 }.joined(separator: " ・ ")
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Text(sub.isEmpty ? "—" : sub).font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(r.employmentTypeLabel).font(.system(size: 14)).foregroundColor(NT.ink).lineLimit(1).frame(width: 120, alignment: .leading)
            Text(r.storeName ?? "—").font(.system(size: 14)).foregroundColor(NT.ink).lineLimit(1).frame(width: 130, alignment: .leading)
            Text(r.hiredOnLabel).font(.system(size: 14)).monospacedDigit().foregroundColor(NT.ink).lineLimit(1).frame(width: 100, alignment: .leading)
            NPBadge(text: r.statusLabel, color: NEMFmt.statusColor(r.status)).frame(width: 70, alignment: .leading)
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).frame(width: 12)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - 従業員情報を登録（Web の CreateEmployeeDialog）

struct NEMCreateSheet: View {
    let payload: NEMListPayload
    /// 登録した従業員の id（詳細を開く）
    let onCreated: (String) -> Void
    let onClose: () -> Void

    @State private var profileId = ""
    @State private var employeeNo = ""
    @State private var hiredOn = ""
    @State private var employmentType = "part_time"
    @State private var primaryStoreId = ""
    @State private var error: String?
    @State private var busy = false

    init(payload: NEMListPayload, onCreated: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.payload = payload
        self.onCreated = onCreated
        self.onClose = onClose
    }

    var body: some View {
        NavigationStack {
            Form {
                if payload.staffOptions.isEmpty {
                    Section { Text("登録可能なスタッフがいません（すべてのスタッフが登録済みです）").foregroundColor(NT.ink3) }
                } else {
                    Section {
                        Picker("対象スタッフ", selection: $profileId) {
                            Text("選択してください").tag("")
                            ForEach(payload.staffOptions) { s in Text(s.name).tag(s.id) }
                        }
                    }
                }
                Section {
                    HStack {
                        Text("社員番号")
                        Spacer()
                        TextField("", text: $employeeNo).multilineTextAlignment(.trailing).frame(maxWidth: 260)
                    }
                    NHXDateRow(label: "入社日", value: $hiredOn)
                    Picker("雇用区分", selection: $employmentType) {
                        ForEach(payload.employmentTypes) { t in Text(t.label).tag(t.id) }
                    }
                    Picker("所属店舗", selection: $primaryStoreId) {
                        Text("未設定").tag("")
                        ForEach(payload.stores) { s in Text(s.name).tag(s.id) }
                    }
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("従業員情報を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "登録中…" : "登録する") { submit() }.disabled(busy || payload.staffOptions.isEmpty)
                }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func submit() {
        if profileId.isEmpty { error = "対象スタッフを選択してください"; return }
        error = nil
        busy = true
        let req: [String: Any] = [
            "type": "employeeCreate",
            "profileId": profileId,
            "employeeNo": employeeNo,
            "employmentType": employmentType,
            "primaryStoreId": primaryStoreId,
            "hiredOn": hiredOn,
        ]
        Task {
            let r = await NHXApi.post(req)
            busy = false
            if r.ok { onCreated(r.id ?? "") } else { error = r.error ?? "登録できませんでした" }
        }
    }
}

// MARK: - 詳細（/app/employees/<id>）

@MainActor
final class NEMDetailModel: ObservableObject {
    @Published var payload: NEMDetailPayload?
    @Published var error: String?
    @Published var toast: String?
    let id: String

    init(id: String) { self.id = id }

    func load() async {
        do {
            payload = try await NHXApi.load(NEMDetailPayload.self, ["type": "employeeLoad", "id": id])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }
}

struct NEMDetailScreen: View {
    let employeeId: String
    /// 戻る（一覧を見られるか）
    let onBack: (Bool) -> Void
    @StateObject private var model: NEMDetailModel

    init(employeeId: String, onBack: @escaping (Bool) -> Void) {
        self.employeeId = employeeId
        self.onBack = onBack
        _model = StateObject(wrappedValue: NEMDetailModel(id: employeeId))
    }

    private var canList: Bool { model.payload?.canViewList ?? true }

    var body: some View {
        NHXPage(
            title: model.payload?.displayName ?? "従業員詳細",
            backIcon: canList ? "chevron.left" : "house.fill",
            onBack: { onBack(canList) },
            loaded: model.payload != nil,
            error: model.error,
            toast: $model.toast,
            retry: { await model.load() }
        ) {
            if let p = model.payload { detailBody(p) }
        }
        .task { await model.load() }
    }

    @ViewBuilder private func detailBody(_ p: NEMDetailPayload) -> some View {
        if p.state == "notFound" {
            NHXCard(title: "従業員詳細", trailing: { EmptyView() }) {
                NHXEmpty(title: "従業員情報が見つかりません")
            }
        } else if p.state == "forbidden" {
            NHXCard(title: "従業員詳細", trailing: { EmptyView() }) {
                NHXEmpty(title: "閲覧権限がありません", message: "この従業員情報の閲覧には権限が必要です。管理者にお問い合わせください。")
            }
        } else if let b = p.basic {
            Text("\(p.employmentTypeLabel ?? "")｜所属店舗: \(p.storeName ?? "未設定")｜入社日: \(p.hiredOnLabel ?? "—")")
                .font(.system(size: 14)).foregroundColor(NT.ink2)
            NEMBasicCard(
                basic: b,
                stores: p.stores ?? [],
                types: p.employmentTypes ?? [],
                canEdit: p.canEdit == true,
                onSaved: { msg in
                    model.toast = msg
                    Task { await model.load() }
                }
            )
            if let c = p.confidential {
                NEMConfidentialCard(data: c, canEdit: p.canEdit == true, onSaved: { msg in model.toast = msg })
            }
            if let i = p.insurance {
                NEMInsuranceCard(data: i, canEdit: p.canEdit == true, onSaved: { msg in model.toast = msg })
            }
        }
    }
}

// MARK: - 基本情報（Web の BasicInfoForm）

struct NEMBasicCard: View {
    let stores: [NEMOption]
    let types: [NEMType]
    let canEdit: Bool
    let onSaved: (String) -> Void
    @State private var f: NEMBasic
    @State private var error: String?
    @State private var busy = false

    init(basic: NEMBasic, stores: [NEMOption], types: [NEMType], canEdit: Bool, onSaved: @escaping (String) -> Void) {
        self.stores = stores
        self.types = types
        self.canEdit = canEdit
        self.onSaved = onSaved
        _f = State(initialValue: basic)
    }

    private var storeOptions: [NEMType] {
        [NEMType(id: "", label: "未設定")] + stores.map { NEMType(id: $0.id, label: $0.name) }
    }

    var body: some View {
        NHXCard(title: "基本情報", trailing: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "社員番号") { NSPInput(text: $f.employeeNo, enabled: canEdit) }
                    NEMField(label: "状態") { NEMMenu(selection: f.status, options: NEMFmt.statusOptions, enabled: canEdit) { f.status = $0 } }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "戸籍名") { NSPInput(text: $f.legalName, enabled: canEdit) }
                    NEMField(label: "戸籍名（カナ）") { NSPInput(text: $f.legalNameKana, enabled: canEdit) }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "郵便番号") { NSPInput(text: $f.postalCode, placeholder: "123-4567", enabled: canEdit, keyboard: .numbersAndPunctuation) }
                        .frame(maxWidth: 220)
                    NEMField(label: "住所") { NSPInput(text: $f.address, enabled: canEdit, width: 760) }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "生年月日") { NHXDateField(value: $f.birthDate, enabled: canEdit, defaultValue: "1990-01-01") }
                    NEMField(label: "役職") { NSPInput(text: $f.position, enabled: canEdit) }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "入社日") { NHXDateField(value: $f.hiredOn, enabled: canEdit) }
                    NEMField(label: "退職日") { NHXDateField(value: $f.terminatedOn, enabled: canEdit) }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "雇用区分") { NEMMenu(selection: f.employmentType, options: types, enabled: canEdit) { f.employmentType = $0 } }
                    NEMField(label: "所属店舗") { NEMMenu(selection: f.primaryStoreId, options: storeOptions, enabled: canEdit) { f.primaryStoreId = $0 } }
                }
                if canEdit {
                    NEMSaveRow(error: error, text: "基本情報を保存", busy: busy) { save() }
                }
            }
            .padding(18)
        }
    }

    private func save() {
        error = nil
        busy = true
        // 日付・店舗の空は null（サーバーの parseNativeEmployeeAction）。中身の確かめは Web と同じ Server Action
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

// MARK: - 機密情報（Web の ConfidentialForm）

struct NEMConfidentialCard: View {
    let employeeId: String
    let canEdit: Bool
    let onSaved: (String) -> Void
    @State private var bank: NEMBank
    @State private var emergency: NEMEmergency
    @State private var error: String?
    @State private var busy = false

    init(data: NEMConfidential, canEdit: Bool, onSaved: @escaping (String) -> Void) {
        self.employeeId = data.employeeId
        self.canEdit = canEdit
        self.onSaved = onSaved
        _bank = State(initialValue: data.bank)
        _emergency = State(initialValue: data.emergency)
    }

    /// 口座番号は数字だけ・4桁まで（Web の入力欄と同じ）
    private var last4: Binding<String> {
        Binding(get: { bank.last4 }, set: { bank.last4 = String(NEMFmt.digits($0).prefix(4)) })
    }

    var body: some View {
        NHXCard(title: "機密情報", trailing: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 14) {
                NHXNotice(title: "この情報は給与閲覧権限を持つロールにのみ表示されます。口座番号は全桁を保存せず末尾4桁のみ保存します。", icon: "lock.shield.fill") {
                    EmptyView()
                }
                Text("銀行振込情報").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "銀行名") { NSPInput(text: $bank.bank, enabled: canEdit) }
                    NEMField(label: "支店名") { NSPInput(text: $bank.branch, enabled: canEdit) }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "種別") { NSPInput(text: $bank.type, placeholder: "普通・当座 など", enabled: canEdit) }
                    NEMField(label: "口座番号（末尾4桁のみ）") { NSPInput(text: last4, placeholder: "1234", enabled: canEdit, keyboard: .numberPad) }
                }
                NEMField(label: "口座名義") { NSPInput(text: $bank.holder, enabled: canEdit) }
                Text("緊急連絡先").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).padding(.top, 4)
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "氏名") { NSPInput(text: $emergency.name, enabled: canEdit) }
                    NEMField(label: "続柄") { NSPInput(text: $emergency.relation, enabled: canEdit) }
                    NEMField(label: "電話番号") { NSPInput(text: $emergency.phone, enabled: canEdit, keyboard: .phonePad) }
                }
                if canEdit {
                    NEMSaveRow(error: error, text: "機密情報を保存", busy: busy) { save() }
                }
            }
            .padding(18)
        }
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

// MARK: - 社会保険（Web の InsuranceForm。構造のみ・保険料の自動計算はしない）

struct NEMInsuranceCard: View {
    let canEdit: Bool
    let onSaved: (String) -> Void
    @State private var f: NEMInsurance
    @State private var error: String?
    @State private var busy = false

    init(data: NEMInsurance, canEdit: Bool, onSaved: @escaping (String) -> Void) {
        self.canEdit = canEdit
        self.onSaved = onSaved
        _f = State(initialValue: data)
    }

    private var remuneration: Binding<String> {
        Binding(get: { f.standardMonthlyRemuneration }, set: { f.standardMonthlyRemuneration = NEMFmt.digits($0) })
    }

    var body: some View {
        NHXCard(title: "社会保険", trailing: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 14) {
                NHXNotice(title: "保険料率は法定ルール（専門家確認後に投入）を参照します。現時点で保険料の自動計算は行いません。", icon: "info.circle.fill") {
                    EmptyView()
                }
                WrapLayout(spacing: 8) {
                    NEMCheck(label: "健康保険", on: f.healthInsurance, enabled: canEdit) { f.healthInsurance.toggle() }
                    NEMCheck(label: "厚生年金", on: f.pension, enabled: canEdit) { f.pension.toggle() }
                    NEMCheck(label: "雇用保険", on: f.employmentInsurance, enabled: canEdit) { f.employmentInsurance.toggle() }
                    NEMCheck(label: "介護保険", on: f.careInsurance, enabled: canEdit) { f.careInsurance.toggle() }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "標準報酬月額（円）") { NSPInput(text: remuneration, enabled: canEdit, keyboard: .numberPad) }
                    NEMField(label: "都道府県（健保料率の地域差用）") { NSPInput(text: $f.region, enabled: canEdit) }
                }
                HStack(alignment: .top, spacing: 14) {
                    NEMField(label: "資格取得日") { NHXDateField(value: $f.acquiredOn, enabled: canEdit) }
                    NEMField(label: "資格喪失日") { NHXDateField(value: $f.lostOn, enabled: canEdit) }
                }
                NEMField(label: "メモ") {
                    TextField("", text: $f.note, axis: .vertical)
                        .lineLimit(3...8)
                        .font(.system(size: 16))
                        .disabled(!canEdit)
                        .padding(.horizontal, 13).padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(canEdit ? Color.white : NFColor.lilacSoft))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                }
                if canEdit {
                    NEMSaveRow(error: error, text: "社会保険情報を保存", busy: busy) { save() }
                }
            }
            .padding(18)
        }
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

// MARK: - 部品

/// 見出し＋入力欄
struct NEMField<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 選ぶ欄（Web の select）
struct NEMMenu: View {
    let selection: String
    let options: [NEMType]
    var enabled = true
    let pick: (String) -> Void

    var body: some View {
        Menu {
            ForEach(options) { o in
                Button(o.label) { pick(o.id) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.id == selection }?.label ?? "—").font(.system(size: 16)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 6)
                if enabled {
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            .padding(.horizontal, 13).frame(height: 46).frame(maxWidth: 520)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(enabled ? Color.white : NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
        .disabled(!enabled)
    }
}

/// チェック（Web の checkbox）
struct NEMCheck: View {
    let label: String
    let on: Bool
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: on ? "checkmark.square.fill" : "square").font(.system(size: 19)).foregroundColor(on ? NT.purple : NT.ink3)
                Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            }
            .padding(.horizontal, 14).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.6)
    }
}

/// エラー＋保存ボタン（右寄せ）
struct NEMSaveRow: View {
    let error: String?
    let text: String
    let busy: Bool
    let action: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let error {
                Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                Spacer()
                NHXButton(text: busy ? "保存中…" : text, kind: .primary, busy: busy, action: action)
            }
        }
    }
}

/// 日付の欄（空＝未設定。Web の input type=date と同じく消せる）
struct NHXDateField: View {
    @Binding var value: String
    var enabled = true
    /// 未設定から入れるときの最初の日（なければ今日）
    var defaultValue: String? = nil

    var body: some View {
        HStack(spacing: 8) {
            if value.isEmpty {
                Button { value = defaultValue ?? NPDate.str(Date()) } label: {
                    HStack {
                        Text("未設定").font(.system(size: 16)).foregroundColor(NT.ink3)
                        Spacer(minLength: 6)
                        if enabled { Image(systemName: "calendar.badge.plus").foregroundColor(NT.purple) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
            } else {
                DatePicker("", selection: Binding(get: { NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date)
                    .labelsHidden()
                    .disabled(!enabled)
                Spacer(minLength: 6)
                if enabled {
                    Button { value = "" } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundColor(NT.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("消す")
                }
            }
        }
        .padding(.horizontal, 13).frame(height: 46).frame(maxWidth: 520)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(enabled ? Color.white : NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo") ?? .current)
    }
}

/// フォームの中の日付の行（空＝未設定）
struct NHXDateRow: View {
    let label: String
    @Binding var value: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            if value.isEmpty {
                Button("未設定 ＋") { value = NPDate.str(Date()) }.buttonStyle(.borderless)
            } else {
                DatePicker("", selection: Binding(get: { NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo") ?? .current)
                Button { value = "" } label: { Image(systemName: "xmark.circle.fill").foregroundColor(NT.ink3) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("消す")
            }
        }
    }
}
