import SwiftUI

// iPhone の店長・オーナー：年末調整（/app/payroll/nencho。2026-10-25 Ronnie「iPhone も native に」）
//   自分の申告（扶養家族・配偶者・保険料・住宅ローン・前職・メモ）の下書き保存・提出（提出は確かめてから）
//   確認する人（payroll.view_all）：提出状況（状態で絞り込み・中身）／操作は payroll.manage：確認中にする・確認済みにする・差し戻す（理由）
// サーバーは iPad と同じ GET part=payroll&view=nencho（&year=&status=）／ POST nenchoSave・nenchoSubmit・nenchoReviewing・nenchoConfirm・nenchoReject

// MARK: - 中身（サーバーの返事）

struct NPPYDependent: Decodable, Hashable {
    let name: String
    let relation: String
    let birthDate: String
}

struct NPPYNenchoData: Decodable, Hashable {
    let dependents: [NPPYDependent]
    let hasSpouse: Bool
    let spouseIncome: Double?
    let lifeInsurancePremium: Double
    let earthquakeInsurancePremium: Double
    let hasHousingLoanDeduction: Bool
    let hasPreviousEmploymentIncome: Bool
    let basicDeductionNote: String
}

struct NPPYOwnNencho: Decodable {
    let status: String
    let data: NPPYNenchoData
    let reviewNote: String?
}

struct NPPYAdminLine: Decodable, Hashable {
    let text: String
    let tone: String?
}

struct NPPYNenchoRow: Decodable, Hashable, Identifiable {
    let id: String
    let profileName: String
    let year: Int
    let status: String
    let submittedLabel: String
    let dependents: [String]
    let lines: [NPPYAdminLine]
}

struct NPPYNenchoPayload: Decodable {
    let year: Int
    let yearOptions: [Int]
    let status: String
    let canReview: Bool
    let canManage: Bool
    let own: NPPYOwnNencho
    let adminRows: [NPPYNenchoRow]
}

// MARK: - 自分の申告の入力（Web の NenchoForm と同じ項目）

struct NPPYDependentRow: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var relation: String
    var birthDate: String
}

struct NPPYNenchoForm: Equatable {
    var dependents: [NPPYDependentRow] = []
    var hasSpouse = false
    var spouseIncome = ""
    var life = "0"
    var earthquake = "0"
    var housingLoan = false
    var previousJob = false
    var note = ""

    init() {}

    init(_ d: NPPYNenchoData) {
        dependents = d.dependents.map { NPPYDependentRow(name: $0.name, relation: $0.relation, birthDate: $0.birthDate) }
        hasSpouse = d.hasSpouse
        spouseIncome = NPPYFmt.num(d.spouseIncome)
        life = NPPYFmt.num(d.lifeInsurancePremium)
        earthquake = NPPYFmt.num(d.earthquakeInsurancePremium)
        housingLoan = d.hasHousingLoanDeduction
        previousJob = d.hasPreviousEmploymentIncome
        note = d.basicDeductionNote
    }

    /// サーバー（saveNenchoDraft の zod）に渡す形。金額は数字だけ拾う（Web と同じ）
    var json: [String: Any] {
        let deps: [[String: Any]] = dependents.map { d in
            let row: [String: Any] = ["name": d.name, "relation": d.relation, "birthDate": d.birthDate]
            return row
        }
        var d: [String: Any] = [:]
        d["dependents"] = deps
        d["hasSpouse"] = hasSpouse
        d["lifeInsurancePremium"] = Int(NPPYFmt.digits(life).prefix(12)) ?? 0
        d["earthquakeInsurancePremium"] = Int(NPPYFmt.digits(earthquake).prefix(12)) ?? 0
        d["hasHousingLoanDeduction"] = housingLoan
        d["hasPreviousEmploymentIncome"] = previousJob
        d["basicDeductionNote"] = note
        let income = NPPYFmt.digits(spouseIncome)
        if income.isEmpty {
            d["spouseIncome"] = NSNull()
        } else {
            d["spouseIncome"] = Int(income.prefix(12)) ?? 0
        }
        return d
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPPYNenchoModel: ObservableObject {
    @Published var year: Int?
    @Published var status: String
    @Published var payload: NPPYNenchoPayload?
    @Published var form = NPPYNenchoForm()
    @Published var error: String?
    @Published var formError: String?
    @Published var toast: String?
    @Published var busy = false

    init(year: Int?, status: String?) {
        self.year = year
        self.status = status ?? ""
    }

    var editable: Bool { ["new", "draft", "needs_fix"].contains(payload?.own.status ?? "") }

    /// resetForm: 自分の申告の入力も読み直す（年を変えた・保存したとき）。確認する人の操作では入力中のものを残す
    func load(resetForm: Bool = true) async {
        if NativePreview.current != nil { return }
        var q = ["view": "nencho"]
        if let year { q["year"] = String(year) }
        if !status.isEmpty { q["status"] = status }
        do {
            let p = try await NPPYApi.get(NPPYNenchoPayload.self, q)
            if resetForm || payload == nil { form = NPPYNenchoForm(p.own.data) }
            payload = p
            year = p.year
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    /// 下書き保存（submit: true は保存してから提出。Web と同じ順）
    func save(submit: Bool) async {
        guard let y = payload?.year, !busy else { return }
        formError = nil
        if NativePreview.current != nil {
            toast = submit ? "提出しました（見本）" : "下書きを保存しました（見本）"
            return
        }
        busy = true
        let saved = await NPPYApi.post(["type": "nenchoSave", "year": y, "data": form.json])
        if !saved.ok {
            busy = false
            formError = saved.error
            toast = saved.error
            return
        }
        if submit {
            let r = await NPPYApi.post(["type": "nenchoSubmit", "year": y])
            toast = r.ok ? (r.message ?? "提出しました") : r.error
            if !r.ok { formError = r.error }
        } else {
            toast = saved.message ?? "下書きを保存しました"
        }
        busy = false
        await load(resetForm: true)
    }

    func act(_ body: [String: Any]) async {
        guard !busy else { return }
        if NativePreview.current != nil {
            toast = "見本のため保存していません"
            return
        }
        busy = true
        let r = await NPPYApi.post(body)
        busy = false
        toast = r.ok ? (r.message ?? "できました") : (r.error ?? "できませんでした")
        await load(resetForm: false)
    }

    func setYear(_ y: Int) {
        year = y
        status = ""
        Task { await load(resetForm: true) }
    }

    func setStatus(_ s: String) {
        status = s
        Task { await load(resetForm: false) }
    }
}

/// 差し戻しの理由を入れる
struct NPPYReasonRef: Identifiable {
    let id = UUID()
    let rowId: String
    let name: String
}

// MARK: - 画面

struct NPPYNenchoScreen: View {
    let onBack: () -> Void
    @StateObject private var model: NPPYNenchoModel

    init(year: Int?, status: String?, onBack: @escaping () -> Void) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: NPPYNenchoModel(year: year, status: status))
    }

    var body: some View {
        NPPYNenchoView(model: model, onBack: onBack)
    }
}

struct NPPYNenchoView: View {
    @ObservedObject var model: NPPYNenchoModel
    let onBack: () -> Void
    /// own（自分の申告）／admin（提出状況の確認）
    @State private var section = "own"
    @State private var expanded: Set<String> = []
    @State private var confirmSubmit = false
    @State private var confirmDone: NPPYNenchoRow?
    @State private var reason: NPPYReasonRef?

    var body: some View {
        NPOCDetailFrame(title: "年末調整", subtitle: model.payload.map { "\($0.year)年分" } ?? "", backLabel: "給与", onBack: onBack, trailing: {
            Color.clear.frame(width: 40, height: 40)
        }) {
            NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load(resetForm: false) }) {
                if let p = model.payload { content(p) }
            }
        }
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .confirmationDialog("申告を提出しますか？", isPresented: $confirmSubmit, titleVisibility: .visible) {
            Button("提出する") { Task { await model.save(submit: true) } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("入力した内容を保存してから提出します。提出後は確認が終わるまで直せません（差し戻されたら直せます）。")
        }
        .alert("確認済みにする", isPresented: Binding(get: { confirmDone != nil }, set: { if !$0 { confirmDone = nil } }), presenting: confirmDone) { r in
            Button("キャンセル", role: .cancel) {}
            Button("確認済みにする") { Task { await model.act(["type": "nenchoConfirm", "id": r.id]) } }
        } message: { r in
            Text("\(r.profileName) さんの申告を確認済みにします。")
        }
        .sheet(item: $reason) { r in
            NPPYReasonSheet(
                title: "申告を差し戻す",
                message: "\(r.name) さんの申告を差し戻します。理由を入れてください。本人が直して、もう一度出せるようになります。",
                confirm: "差し戻す",
                onSubmit: { text in
                    reason = nil
                    Task { await model.act(["type": "nenchoReject", "id": r.rowId, "note": text]) }
                },
                onClose: { reason = nil }
            )
            .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder private func content(_ p: NPPYNenchoPayload) -> some View {
        yearChips(p)
        if p.canReview {
            NOSSegment(items: [(key: "own", label: "自分の申告"), (key: "admin", label: "提出状況（管理）")], selection: section) { section = $0 }
        }
        if p.canReview && section == "admin" {
            adminSection(p)
        } else {
            ownSection(p)
        }
    }

    private func yearChips(_ p: NPPYNenchoPayload) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text("対象年").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                ForEach(p.yearOptions, id: \.self) { y in
                    NPOCChip(text: "\(String(y))年", selected: y == p.year) { model.setYear(y) }
                }
            }
            .padding(.horizontal, 1)
        }
    }

    // MARK: 自分の申告

    @ViewBuilder private func ownSection(_ p: NPPYNenchoPayload) -> some View {
        statusCard(p)
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle").font(.system(size: 13, weight: .bold))
            Text("年末調整の計算は、税理士などの確認が終わってから対応します。いまは申告の集めと確認だけです。")
                .font(.system(size: 12.5)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundColor(NT.warn)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.warn.opacity(0.09)))
        dependentsCard
        spouseCard
        insuranceCard
        otherCard
        if model.editable { ownButtons }
    }

    private func statusCard(_ p: NPPYNenchoPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("\(String(p.year))年分の申告").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer(minLength: 4)
                NWKBadge(text: NPPYFmt.nenchoStatus[p.own.status] ?? p.own.status, color: NPPYFmt.nenchoColor(p.own.status))
            }
            if p.own.status == "needs_fix", let note = p.own.reviewNote, !note.isEmpty {
                Text("差戻し理由：\(note)").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !model.editable {
                Text("提出済みのため、いまは直せません。差し戻されたら直して出し直せます。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
    }

    private var dependentsCard: some View {
        let editable = model.editable
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("扶養家族").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer()
                if editable {
                    Button { model.form.dependents.append(NPPYDependentRow(name: "", relation: "", birthDate: "")) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus").font(.system(size: 12, weight: NT.strong))
                            Text("追加").font(.system(size: 13.5, weight: .bold))
                        }
                        .foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 13).frame(height: 36)
                        .background(Capsule().fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            if model.form.dependents.isEmpty {
                Text(editable ? "扶養家族がいるときは「追加」を押してください" : "なし").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach($model.form.dependents) { $d in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        TextField("氏名", text: $d.name).font(.system(size: 16)).npocInputBox().disabled(!editable)
                        TextField("続柄", text: $d.relation).font(.system(size: 16)).frame(width: 96).npocInputBox().disabled(!editable)
                    }
                    HStack(spacing: 8) {
                        birthField($d.birthDate, editable: editable)
                        Spacer(minLength: 4)
                        if editable {
                            Button { model.form.dependents.removeAll { $0.id == d.id } } label: {
                                Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.danger)
                                    .frame(width: 44, height: 40)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.dangerBg))
                            }
                            .buttonStyle(PressableStyle())
                            .accessibilityLabel("この人を削除")
                        }
                    }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
    }

    @ViewBuilder private func birthField(_ date: Binding<String>, editable: Bool) -> some View {
        if date.wrappedValue.isEmpty {
            Button { date.wrappedValue = "2000-01-01" } label: {
                Label("生年月日を入れる", systemImage: "calendar").font(.system(size: 14, weight: .semibold))
                    .foregroundColor(editable ? NT.purple : NT.ink3)
                    .padding(.horizontal, 12).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(!editable)
        } else {
            HStack(spacing: 6) {
                Text("生年月日").font(.system(size: 13)).foregroundColor(NT.ink3)
                DatePicker("", selection: Binding(get: { NPDate.date(date.wrappedValue) }, set: { date.wrappedValue = NPDate.str($0) }), displayedComponents: .date)
                    .labelsHidden()
                    .disabled(!editable)
                    .environment(\.locale, Locale(identifier: "ja_JP"))
            }
        }
    }

    private var spouseCard: some View {
        let editable = model.editable
        return VStack(alignment: .leading, spacing: 0) {
            Text("配偶者").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 4)
            Toggle(isOn: $model.form.hasSpouse) {
                Text("配偶者がいる").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            }
            .tint(NT.purple)
            .disabled(!editable)
            .npocRow()
            if model.form.hasSpouse {
                Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
                amountRow("配偶者の年間所得（概算）", text: $model.form.spouseIncome, editable: editable)
            }
        }
        .padding(.bottom, 4)
        .background(npocCard())
    }

    private var insuranceCard: some View {
        let editable = model.editable
        return VStack(alignment: .leading, spacing: 0) {
            Text("保険料控除").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 4)
            amountRow("生命保険料（年間合計）", text: $model.form.life, editable: editable)
            Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
            amountRow("地震保険料（年間合計）", text: $model.form.earthquake, editable: editable)
        }
        .padding(.bottom, 4)
        .background(npocCard())
    }

    private var otherCard: some View {
        let editable = model.editable
        return VStack(alignment: .leading, spacing: 0) {
            Text("その他の申告").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 4)
            Toggle(isOn: $model.form.housingLoan) {
                Text("住宅ローン控除がある").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            }
            .tint(NT.purple)
            .disabled(!editable)
            .npocRow()
            Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
            Toggle(isOn: $model.form.previousJob) {
                Text("今年、前の仕事の給与がある").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            }
            .tint(NT.purple)
            .disabled(!editable)
            .npocRow()
            if model.form.previousJob {
                Text("前の仕事の源泉徴収票を出してください").font(.system(size: 12.5)).foregroundColor(NT.ink3).padding(.horizontal, 14).padding(.bottom, 6)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("基礎控除のメモ").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                TextField("所得の見込み額や、伝えたいことがあれば", text: $model.form.note, axis: .vertical)
                    .lineLimit(3...8)
                    .font(.system(size: 16))
                    .disabled(!editable)
                    .npocInputBox()
            }
            .padding(14)
        }
        .background(npocCard())
    }

    private func amountRow(_ label: String, text: Binding<String>, editable: Bool) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 14.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(2)
            Spacer(minLength: 6)
            TextField("0", text: text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: 130)
                .disabled(!editable)
            Text("円").font(.system(size: 14)).foregroundColor(NT.ink3)
        }
        .npocRow()
    }

    private var ownButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let e = model.formError {
                Text(e).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
            }
            NPOCWideButton(text: "提出する", icon: "paperplane.fill", kind: .primary, disabled: model.busy) { confirmSubmit = true }
            NPOCWideButton(text: "下書き保存", icon: "square.and.arrow.down", kind: .secondary, busy: model.busy, height: 46) {
                Task { await model.save(submit: false) }
            }
        }
    }

    // MARK: 提出状況の確認（payroll.view_all。操作は payroll.manage）

    @ViewBuilder private func adminSection(_ p: NPPYNenchoPayload) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.statusOptions, id: \.0) { o in
                    NPOCChip(text: o.1, selected: p.status == o.0) { model.setStatus(o.0) }
                }
            }
            .padding(.horizontal, 1)
        }
        NPOCSectionTitle(title: "申告（\(p.adminRows.count)件）", note: p.canManage ? "押すと中身が出ます。確認中・確認済み・差し戻しができます" : "押すと中身が出ます")
        if p.adminRows.isEmpty {
            NPOCEmpty(icon: "tray", title: "該当する申告はありません")
        } else {
            ForEach(p.adminRows) { r in adminRow(r, canManage: p.canManage) }
        }
    }

    private static let statusOptions: [(String, String)] = [("", "すべて"), ("submitted", "提出済み"), ("reviewing", "確認中"), ("needs_fix", "要修正"), ("confirmed", "確認済み")]

    private func adminRow(_ r: NPPYNenchoRow, canManage: Bool) -> some View {
        let open = expanded.contains(r.id)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                if open { expanded.remove(r.id) } else { expanded.insert(r.id) }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).frame(width: 14)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(r.profileName).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        Text("\(String(r.year))年・提出 \(r.submittedLabel)").font(.system(size: 12)).foregroundColor(NT.ink3)
                    }
                    Spacer(minLength: 6)
                    NWKBadge(text: NPPYFmt.nenchoStatus[r.status] ?? r.status, color: NPPYFmt.nenchoColor(r.status))
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Rectangle().fill(NT.line).frame(height: 1)
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("扶養家族").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                        if r.dependents.isEmpty { Text("なし").font(.system(size: 13.5)).foregroundColor(NT.ink3) }
                        ForEach(Array(r.dependents.enumerated()), id: \.offset) { _, d in
                            Text(d).font(.system(size: 13.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(r.lines.enumerated()), id: \.offset) { _, l in
                            Text(l.text)
                                .font(.system(size: l.tone == "muted" ? 12 : 13.5))
                                .foregroundColor(l.tone == "danger" ? NT.danger : l.tone == "muted" ? NT.ink3 : NT.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if canManage { adminButtons(r) }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(NT.page.opacity(0.6))
            }
        }
        .background(npocCard())
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder private func adminButtons(_ r: NPPYNenchoRow) -> some View {
        if r.status == "submitted" || r.status == "reviewing" {
            VStack(spacing: 8) {
                if r.status == "submitted" {
                    NPOCWideButton(text: "確認中にする", icon: "eye", kind: .secondary, disabled: model.busy, height: 46) {
                        Task { await model.act(["type": "nenchoReviewing", "id": r.id]) }
                    }
                }
                if r.status == "reviewing" {
                    NPOCWideButton(text: "確認済みにする", icon: "checkmark.seal", kind: .success, disabled: model.busy, height: 46) { confirmDone = r }
                }
                NPOCWideButton(text: "差し戻す", icon: "arrow.uturn.backward", kind: .danger, disabled: model.busy, height: 46) {
                    reason = NPPYReasonRef(rowId: r.id, name: r.profileName)
                }
            }
        }
    }
}

/// 理由を入れるシート（差し戻し。明るい画面）
struct NPPYReasonSheet: View {
    let title: String
    let message: String
    let confirm: String
    let onSubmit: (String) -> Void
    let onClose: () -> Void
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NPOCSheetFrame(title: title, confirmText: confirm, onCancel: onClose, onConfirm: {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty {
                error = "理由を入力してください"
            } else {
                onSubmit(t)
            }
        }) {
            Text(message).font(.system(size: 14)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            NPOCField(label: "理由") {
                TextField("理由を入力", text: $text, axis: .vertical).lineLimit(3...8).font(.system(size: 16)).npocInputBox()
            }
            if let error {
                Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger)
            }
        }
    }
}
