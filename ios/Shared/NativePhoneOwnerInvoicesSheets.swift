import SwiftUI
import UIKit
import PhotosUI

// iPhone の店長・オーナー：請求書・書類の詳細と入力のシート（Web の invoice-detail・invoice-form・triage-dialog と同じ中身）。
//   詳細：状態・金額・項目・添付（画像はその場で、PDF は開く）・コメント・状態の変更（どれも確認してから。支払済みは支払日、差戻しは理由）・編集（OCR）
//   登録：添付（ファイル・写真・撮影）・店舗（本部だけ）・取引先（登録済み／自由入力）・番号・支払方法・発行日・支払期限・金額・税額・登録番号・費目
//   仕分け：OCR・種別・店舗・取引先・日付・金額・税額・メモ
// POST は iPad と同じ type（invoiceStatus・invoiceUpdate・invoiceCreate・invoiceTriage・invoiceOcr・invoiceComment）。

// MARK: - 部品

/// 日付（空＝未設定）。白いカードの 1 行
struct NPIVOptionalDate: View {
    let label: String
    @Binding var value: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            Spacer(minLength: 8)
            if value.isEmpty {
                Button { value = NOS.today } label: {
                    Text("未設定（押して入れる）").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.purple)
                }
                .buttonStyle(.plain)
            } else {
                DatePicker(label, selection: Binding(get: { NOS.date(value) ?? Date() }, set: { value = NOS.str($0) }), displayedComponents: .date)
                    .labelsHidden()
                Button { value = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("消す")
            }
        }
        .npocRow()
        .background(npocCard(12))
    }
}

/// 金額の入力欄
struct NPIVAmountField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        NPOCField(label: label) {
            HStack(spacing: 4) {
                TextField("0", text: $text).keyboardType(.numberPad).font(.system(size: 17, weight: .bold)).monospacedDigit().multilineTextAlignment(.trailing)
                Text("円").foregroundColor(NT.ink3)
            }
            .npocInputBox()
        }
    }
}

/// 文字の入力欄
struct NPIVTextField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""

    var body: some View {
        NPOCField(label: label) {
            TextField(placeholder, text: $text).font(.system(size: 16)).npocInputBox()
        }
    }
}

/// 金額の入力が正しいか（空は 0。Web の Number() と同じく数でなければだめ）
private func npivYen(_ s: String) -> Int? {
    guard let v = NPIVText.amount(s) else { return 0 }
    return v >= 0 ? v : nil
}

// MARK: - 詳細

@MainActor
final class NPIVDetailModel: ObservableObject {
    let invoiceId: String
    @Published var detail: NPIVDetail?
    @Published var error: String?
    @Published var actionError: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var imageURL: URL?

    init(invoiceId: String) {
        self.invoiceId = invoiceId
        detail = NativeModuleAPI.cached(NPIVDetailPayload.self, part: "invoices", query: ["invoice": invoiceId])?.detail
    }

    func load() async {
        if NativePreview.current != nil {
            if let o = NPACSamples.object("invoices", ["invoice": invoiceId]), let p = NOS.decode(NPIVDetailPayload.self, o) { detail = p.detail }
            return
        }
        do {
            let r = try await NPIVApi.get(NPIVDetailPayload.self, ["invoice": invoiceId])
            detail = r.detail
            error = nil
            if let a = r.detail.attachment, a.mimeType.hasPrefix("image/"), imageURL == nil {
                let q = ["file": a.documentId]
                if let f = try? await NPIVApi.get(NPIVFilePayload.self, q) { imageURL = URL(string: f.url) }
                NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url("invoices", q)))
            }
        } catch {
            if detail == nil { self.error = NativeModuleAPI.message(error) } else { actionError = NativeModuleAPI.message(error) }
        }
    }

    /// 操作して読み直す（成功なら true）
    func act(_ body: [String: Any]) async -> Bool {
        busy = true
        actionError = nil
        defer { busy = false }
        do {
            toast = try await NPIVApi.act(body)
            await load()
            return true
        } catch {
            actionError = NativeModuleAPI.message(error)
            return false
        }
    }
}

struct NPIVDetailView: View {
    let invoiceId: String
    let accounts: [NPIVOption]
    let paymentMethods: [NPIVChoice]
    let onBack: () -> Void
    let onChanged: () -> Void
    let onLeave: (String) -> Void

    @StateObject private var model: NPIVDetailModel
    @State private var editing = false
    @State private var paying = false
    @State private var confirmAction: NPIVActionItem?
    @State private var rejectPrompt: NOMReasonPrompt?
    @State private var commentBody = ""

    init(invoiceId: String, accounts: [NPIVOption], paymentMethods: [NPIVChoice], onBack: @escaping () -> Void, onChanged: @escaping () -> Void, onLeave: @escaping (String) -> Void) {
        self.invoiceId = invoiceId
        self.accounts = accounts
        self.paymentMethods = paymentMethods
        self.onBack = onBack
        self.onChanged = onChanged
        self.onLeave = onLeave
        _model = StateObject(wrappedValue: NPIVDetailModel(invoiceId: invoiceId))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOCDetailFrame(title: "請求書", subtitle: model.detail?.vendorName ?? "", backLabel: "請求書", onBack: onBack, trailing: {
                if model.detail?.canEdit == true {
                    NPOCBarButton(icon: "pencil", label: "編集") { editing = true }
                }
            }) {
                Group {
                    if let d = model.detail {
                        content(d)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.load() } }
                    }
                }
            }
            NPHToast(text: $model.toast).zIndex(3)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.load() }
        .sheet(isPresented: $editing) {
            if let d = model.detail {
                NPIVEditSheet(detail: d, accounts: accounts, paymentMethods: paymentMethods, onClose: { editing = false }, onSaved: { msg in
                    editing = false
                    model.toast = msg
                    onChanged()
                    Task { await model.load() }
                })
            }
        }
        .sheet(isPresented: $paying) {
            if let d = model.detail {
                NPIVPaySheet(detail: d, busy: model.busy, error: model.actionError, onClose: { paying = false }, onPay: { paidAt in
                    Task {
                        if await model.act(["type": "invoiceStatus", "invoiceId": d.id, "action": "pay", "paidAt": paidAt]) {
                            paying = false
                            onChanged()
                        }
                    }
                })
            }
        }
        .sheet(item: $rejectPrompt) { pr in
            NOMReasonSheet(prompt: pr, onDone: { rejectPrompt = nil })
                .environment(\.colorScheme, .light)
        }
        .confirmationDialog(confirmAction.map { "「\($0.label)」にしますか？" } ?? "", isPresented: Binding(get: { confirmAction != nil }, set: { if !$0 { confirmAction = nil } }), titleVisibility: .visible, presenting: confirmAction) { a in
            Button(a.label) { run(a.action) }
            Button("やめる", role: .cancel) {}
        } message: { a in
            Text(confirmMessage(a))
        }
    }

    private func confirmMessage(_ a: NPIVActionItem) -> String {
        guard let d = model.detail else { return "" }
        let head = "\(d.vendorName)・\(NPIVText.yen(d.amount))"
        switch a.action {
        case "approve": return "\(head)\n承認すると支払予定・支払済みへ進められます。"
        case "schedule": return "\(head)\n支払予定にします。"
        case "submit": return "\(head)\n承認者に回します。"
        default: return head
        }
    }

    private func run(_ action: String) {
        Task {
            if await model.act(["type": "invoiceStatus", "invoiceId": invoiceId, "action": action]) { onChanged() }
        }
    }

    private func content(_ d: NPIVDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let e = model.actionError { NPACProblem(text: e) }
                header(d)
                statusSection(d)
                fields(d)
                attachment(d)
                if let docId = d.documentId { comments(d, documentId: docId) }
            }
            .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 60)
        }
        .refreshable { await model.load() }
    }

    private func header(_ d: NPIVDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(d.vendorName).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(2)
                Spacer(minLength: 6)
                NOSBadge(text: d.statusLabel, color: NPIVText.statusColor(d.status))
            }
            Text(d.storeLabel).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
            HStack(alignment: .firstTextBaseline) {
                Text("金額").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Spacer()
                Text(NPIVText.yen(d.amount)).font(.system(size: 30, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
            }
            NPZInfoRow(label: "税額", value: NPIVText.yen(d.taxAmount))
            NPZInfoRow(label: "支払期限", value: d.dueLabel)
        }
        .padding(14)
        .background(npocCard())
    }

    private func statusSection(_ d: NPIVDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let role = d.requiredApprovalRoleLabel {
                Text("この金額の承認には「\(role)」以上のロールが必要です").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.purpleDeep)
                    .padding(.horizontal, 4)
            }
            ForEach(d.actions) { a in actionButton(a, d) }
            if d.noPermission {
                Text("状態を変更する権限がありません").font(.system(size: 12.5)).foregroundColor(NT.ink3).padding(.horizontal, 4)
            }
        }
    }

    @ViewBuilder private func actionButton(_ a: NPIVActionItem, _ d: NPIVDetail) -> some View {
        switch a.action {
        case "pay":
            NPOCWideButton(text: a.label, icon: "yensign.circle", kind: .success, busy: model.busy) {
                model.actionError = nil
                paying = true
            }
        case "reject":
            NPOCWideButton(text: a.label, icon: "arrow.uturn.backward", kind: .secondary, disabled: model.busy) {
                let id = d.id
                rejectPrompt = NOMReasonPrompt(
                    title: "請求書を差戻す",
                    message: "\(d.vendorName)・\(NPIVText.yen(d.amount)) を差し戻します。理由は相手に見えます。",
                    confirm: "差戻す",
                    placeholder: "差戻す理由を入力してください",
                    run: { reason in
                        if await model.act(["type": "invoiceStatus", "invoiceId": id, "action": "reject", "reason": reason]) {
                            onChanged()
                            return nil
                        }
                        return model.actionError ?? "差戻せませんでした"
                    }
                )
            }
        case "approve":
            NPOCWideButton(text: a.label, icon: "checkmark.seal", kind: .success, busy: model.busy) { confirmAction = a }
        default:
            NPOCWideButton(text: a.label, icon: "arrow.right.circle", kind: .primary, busy: model.busy) { confirmAction = a }
        }
    }

    private func fields(_ d: NPIVDetail) -> some View {
        NPOCard(title: "内容") {
            NPZInfoRow(label: "請求書番号", value: d.invoiceNo ?? "—")
            NPZInfoRow(label: "支払方法", value: d.paymentMethodLabel ?? "—")
            NPZInfoRow(label: "発行日", value: d.issueLabel)
            NPZInfoRow(label: "支払日", value: d.paidLabel)
            NPZInfoRow(label: "費目", value: d.expenseLabel)
            NPZInfoRow(label: "インボイス登録番号", value: d.registrationNumber ?? "—")
            if let note = d.note, !note.isEmpty {
                NPACDivider()
                Text(note).font(.system(size: 13.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func attachment(_ d: NPIVDetail) -> some View {
        NPOCard(title: "添付ファイル", trailing: d.attachment.map { "OCR: \($0.ocrLabel ?? "未実行")" } ?? "") {
            if let a = d.attachment {
                if a.mimeType.hasPrefix("image/"), let u = model.imageURL {
                    Button { open(a.documentId) } label: {
                        AsyncImage(url: u) { img in
                            img.resizable().scaledToFit()
                        } placeholder: {
                            ProgressView().frame(maxWidth: .infinity).frame(height: 160)
                        }
                        .frame(maxWidth: .infinity, maxHeight: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(PressableStyle())
                }
                Button { open(a.documentId) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: a.mimeType == "application/pdf" ? "doc.richtext" : "photo")
                        Text("\(a.fileName) を開く").lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right.square")
                    }
                    .font(.system(size: 14, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
                .buttonStyle(.plain)
            } else {
                Text("添付なし").font(.system(size: 13.5)).foregroundColor(NT.ink3)
            }
        }
    }

    private func comments(_ d: NPIVDetail, documentId: String) -> some View {
        NPOCard(title: "コメント", trailing: "\(d.comments.count)件") {
            if d.comments.isEmpty {
                Text("コメントはまだありません").font(.system(size: 13.5)).foregroundColor(NT.ink3)
            }
            ForEach(d.comments) { c in
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.body).font(.system(size: 14)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    Text("\(c.author)・\(c.createdLabel)").font(.system(size: 11)).foregroundColor(NT.ink3)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            }
            if d.canComment {
                TextField("コメントを入力", text: $commentBody, axis: .vertical)
                    .lineLimit(2...5)
                    .font(.system(size: 15))
                    .npocInputBox()
                HStack {
                    Spacer()
                    NPACPill(title: model.busy ? "送信中…" : "コメントを追加", icon: "paperplane", filled: true, enabled: !model.busy && !NPIVText.trimmed(commentBody).isEmpty) {
                        let text = NPIVText.trimmed(commentBody)
                        Task {
                            if await model.act(["type": "invoiceComment", "documentId": documentId, "body": text]) {
                                commentBody = ""
                            }
                        }
                    }
                }
            }
        }
    }

    private func open(_ documentId: String) {
        Task { await NPIVFiles.open(documentId: documentId) { model.actionError = $0 } }
    }
}

// MARK: - 支払済みにする（支払日を選んで確定）

struct NPIVPaySheet: View {
    let detail: NPIVDetail
    let busy: Bool
    let error: String?
    let onClose: () -> Void
    let onPay: (String) -> Void

    @State private var paidAt = Date()

    var body: some View {
        NPOCSheetFrame(title: "支払済みにする", confirmText: busy ? "記録中…" : "支払済みにする", busy: busy, onCancel: onClose, onConfirm: { onPay(NOS.str(paidAt)) }) {
            if let error { NPACProblem(text: error) }
            VStack(alignment: .leading, spacing: 6) {
                Text(detail.vendorName).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink)
                Text(NPIVText.yen(detail.amount)).font(.system(size: 28, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                Text("支払期限 \(detail.dueLabel)").font(.system(size: 12.5)).foregroundColor(NT.ink3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard())
            NPACDateRow(label: "支払日", date: $paidAt)
            NOMNote(text: "支払済みにすると、この請求書は編集できなくなります。支払った日と金額を確かめてから押してください。", tint: NT.warn)
        }
    }
}

// MARK: - 請求書の編集（OCR つき）

struct NPIVEditSheet: View {
    let detail: NPIVDetail
    let accounts: [NPIVOption]
    let paymentMethods: [NPIVChoice]
    let onClose: () -> Void
    let onSaved: (String) -> Void

    @State private var vendor: String
    @State private var invoiceNo: String
    @State private var issue: String
    @State private var due: String
    @State private var amount: String
    @State private var tax: String
    @State private var reg: String
    @State private var method: String
    @State private var account: String
    @State private var note: String
    @State private var saving = false
    @State private var ocrBusy = false
    @State private var ocrNote: String?
    @State private var problem: String?

    init(detail: NPIVDetail, accounts: [NPIVOption], paymentMethods: [NPIVChoice], onClose: @escaping () -> Void, onSaved: @escaping (String) -> Void) {
        self.detail = detail
        self.accounts = accounts
        self.paymentMethods = paymentMethods
        self.onClose = onClose
        self.onSaved = onSaved
        _vendor = State(initialValue: detail.vendorName)
        _invoiceNo = State(initialValue: detail.invoiceNo ?? "")
        _issue = State(initialValue: detail.issueDate ?? "")
        _due = State(initialValue: detail.dueDate ?? "")
        _amount = State(initialValue: NPIVText.num(detail.amount))
        _tax = State(initialValue: NPIVText.num(detail.taxAmount))
        _reg = State(initialValue: detail.registrationNumber ?? "")
        _method = State(initialValue: detail.paymentMethod ?? "")
        _account = State(initialValue: detail.expenseAccountId ?? "")
        _note = State(initialValue: detail.note ?? "")
    }

    var body: some View {
        NPOCSheetFrame(title: "請求書の編集", confirmText: saving ? "保存中…" : "保存", busy: saving, onCancel: onClose, onConfirm: save) {
            if let problem { NPACProblem(text: problem) }
            if let docId = detail.documentId {
                VStack(alignment: .leading, spacing: 6) {
                    NOMButton(title: ocrBusy ? "読み取り中…" : "OCRで読み取り（未接続）", icon: "text.viewfinder", filled: false, height: 44, enabled: !ocrBusy) { runOcr(docId) }
                    if let ocrNote { Text(ocrNote).font(.system(size: 11.5)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true) }
                }
            }
            VStack(alignment: .leading, spacing: 16) {
                NPIVTextField(label: "取引先", text: $vendor)
                NPIVTextField(label: "請求書番号", text: $invoiceNo)
            }
            NPOCField(label: "支払方法") {
                NPACSelect(options: [("", "未設定")] + paymentMethods.map { ($0.value, $0.label) }, selection: method) { method = $0 }
            }
            VStack(spacing: 8) {
                NPIVOptionalDate(label: "発行日", value: $issue)
                NPIVOptionalDate(label: "支払期限", value: $due)
            }
            HStack(spacing: 8) {
                NPIVAmountField(label: "金額", text: $amount)
                NPIVAmountField(label: "税額", text: $tax)
            }
            NPIVTextField(label: "インボイス登録番号", text: $reg, placeholder: "T1234567890123")
            NPOCField(label: "費目") {
                NPACSelect(options: [("", "未設定")] + accounts.map { ($0.id, $0.name) }, selection: account) { account = $0 }
            }
            NPOCField(label: "メモ") {
                TextField("メモ", text: $note, axis: .vertical).lineLimit(2...6).font(.system(size: 15)).npocInputBox()
            }
        }
    }

    private func runOcr(_ documentId: String) {
        if NativePreview.current != nil { ocrNote = "見本では読み取りません"; return }
        ocrBusy = true
        Task {
            do {
                let r = try await NPIVApi.post(["type": "invoiceOcr", "documentId": documentId], as: NPIVOcrResult.self)
                if let x = r.extraction {
                    if let v = x.issuedDate { issue = v }
                    if let v = x.dueDate { due = v }
                    if let v = x.total { amount = NPIVText.num(v) }
                    if let v = x.tax { tax = NPIVText.num(v) }
                    if let v = x.registrationNumber { reg = v }
                    if let v = x.vendor { vendor = v }
                }
                ocrNote = r.note
            } catch {
                problem = NativeModuleAPI.message(error)
            }
            ocrBusy = false
        }
    }

    private func save() {
        problem = nil
        let v = NPIVText.trimmed(vendor)
        if v.isEmpty { problem = "取引先を入力してください"; return }
        guard let amt = npivYen(amount) else { problem = "金額を正しく入力してください"; return }
        let taxValue = npivYen(tax) ?? 0
        let req: [String: Any] = [
            "type": "invoiceUpdate",
            "invoiceId": detail.id,
            "vendorName": v,
            "invoiceNo": NPIVText.orNull(NPIVText.trimmed(invoiceNo)),
            "issueDate": NPIVText.orNull(issue),
            "dueDate": NPIVText.orNull(due),
            "amount": amt,
            "taxAmount": taxValue,
            "registrationNumber": NPIVText.orNull(NPIVText.trimmed(reg)),
            "paymentMethod": NPIVText.orNull(method),
            "expenseAccountId": NPIVText.orNull(account),
            "note": NPIVText.orNull(NPIVText.trimmed(note)),
        ]
        saving = true
        Task {
            do {
                let msg = try await NPIVApi.act(req)
                saving = false
                onSaved(msg ?? "請求書を更新しました")
            } catch {
                problem = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}

// MARK: - 添付ファイルを選ぶ（ファイル・写真・撮影）

struct NPIVAttachBox: View {
    let file: NPIVPicked?
    @Binding var photoItems: [PhotosPickerItem]
    let onFiles: () -> Void
    let onCamera: () -> Void
    let onRemove: () -> Void

    var body: some View {
        if let f = file {
            HStack(spacing: 10) {
                Image(systemName: f.mimeType == "application/pdf" ? "doc.richtext" : "photo").font(.system(size: 20)).foregroundColor(NT.ink3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                    Text("\(f.data.count / 1024)KB").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 6)
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("外す")
            }
            .padding(12)
            .background(npocCard(12))
        } else {
            HStack(spacing: 8) {
                NOMButton(title: "ファイル", icon: "folder", filled: false, height: 46, action: onFiles)
                PhotosPicker(selection: $photoItems, maxSelectionCount: 1, matching: .images) {
                    HStack(spacing: 6) {
                        Image(systemName: "photo.on.rectangle").font(.system(size: 15, weight: .bold))
                        Text("写真").font(.system(size: 15.5, weight: NT.strong))
                    }
                    .foregroundColor(NT.purpleDeep)
                    .frame(maxWidth: .infinity).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
                }
                NOMButton(title: "撮影", icon: "camera", filled: false, height: 46, action: onCamera)
            }
        }
    }
}

// MARK: - 請求書を登録

struct NPIVCreateSheet: View {
    let payload: NPIVListPayload
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var file: NPIVPicked?
    @State private var picking = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var storeId: String
    @State private var vendorMode: String
    @State private var vendorId = ""
    @State private var vendorName = ""
    @State private var invoiceNo = ""
    @State private var paymentMethod = ""
    @State private var issueDate = ""
    @State private var dueDate = ""
    @State private var amount = "0"
    @State private var taxAmount = "0"
    @State private var registrationNumber = ""
    @State private var expenseAccountId = ""
    @State private var problem: String?
    @State private var saving = false

    init(payload: NPIVListPayload, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.payload = payload
        self.onSaved = onSaved
        self.onClose = onClose
        _storeId = State(initialValue: payload.currentStoreId ?? "")
        _vendorMode = State(initialValue: payload.vendors.isEmpty ? "free" : "select")
    }

    var body: some View {
        NPOCSheetFrame(title: "請求書を登録", confirmText: saving ? "登録中…" : "登録", busy: saving, onCancel: onClose, onConfirm: save) {
            if let problem { NPACProblem(text: problem) }
            NPOCField(label: "添付ファイル（任意）") {
                NPIVAttachBox(file: file, photoItems: $photoItems, onFiles: { picking = true }, onCamera: { camera = true }, onRemove: { file = nil })
            }
            if !payload.formStores.isEmpty {
                NPOCField(label: "店舗") {
                    NPACSelect(options: [("", "全店舗（本社共通）")] + payload.formStores.map { ($0.id, $0.name) }, selection: storeId) { storeId = $0 }
                }
            }
            VStack(alignment: .leading, spacing: 16) {
                vendorField
                NPIVTextField(label: "請求書番号", text: $invoiceNo)
            }
            NPOCField(label: "支払方法") {
                NPACSelect(options: [("", "未設定")] + payload.paymentMethodOptions.map { ($0.value, $0.label) }, selection: paymentMethod) { paymentMethod = $0 }
            }
            VStack(spacing: 8) {
                NPIVOptionalDate(label: "発行日", value: $issueDate)
                NPIVOptionalDate(label: "支払期限", value: $dueDate)
            }
            HStack(spacing: 8) {
                NPIVAmountField(label: "金額", text: $amount)
                NPIVAmountField(label: "税額", text: $taxAmount)
            }
            NPIVTextField(label: "インボイス登録番号", text: $registrationNumber, placeholder: "T1234567890123")
            NPOCField(label: "費目") {
                NPACSelect(options: [("", "未設定")] + payload.accounts.map { ($0.id, $0.name) }, selection: expenseAccountId) { expenseAccountId = $0 }
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: NPIVFiles.pickerTypes, allowsMultipleSelection: false) { res in
            if case .success(let urls) = res, let url = urls.first {
                if let f = NPIVFiles.read(url) { take(f) } else { problem = "ファイルの読み込みに失敗しました" }
            }
        }
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            Task {
                let files = await NPIVFiles.photos(items)
                photoItems = []
                if let f = files.first { take(f) } else { problem = "写真を読み込めませんでした" }
            }
        }
        .fullScreenCover(isPresented: $camera) {
            NOMCameraPicker { img in
                camera = false
                if let img, let f = NPIVFiles.photo(img) { take(f) }
            }
            .ignoresSafeArea()
        }
    }

    private var vendorField: some View {
        NPOCField(label: "取引先") {
            VStack(alignment: .leading, spacing: 8) {
                if !payload.vendors.isEmpty {
                    Picker("取引先の入れ方", selection: $vendorMode) {
                        Text("登録済みから選ぶ").tag("select")
                        Text("自由入力").tag("free")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                if vendorMode == "select" && !payload.vendors.isEmpty {
                    NPACSelect(options: payload.vendors.map { ($0.id, $0.name) }, selection: vendorId) { vendorId = $0 }
                } else {
                    TextField("取引先名を入力", text: $vendorName).font(.system(size: 16)).npocInputBox()
                }
            }
        }
    }

    private func take(_ f: NPIVPicked) {
        if let p = NPIVFiles.problem(f, maxSize: payload.maxFileSize) {
            problem = p
            return
        }
        problem = nil
        file = f
    }

    private func save() {
        problem = nil
        let resolved = vendorMode == "select" && !payload.vendors.isEmpty
            ? (payload.vendors.first(where: { $0.id == vendorId })?.name ?? "")
            : NPIVText.trimmed(vendorName)
        if resolved.isEmpty { problem = "取引先を選択または入力してください"; return }
        guard let amt = npivYen(amount) else { problem = "金額を正しく入力してください"; return }
        guard let tax = npivYen(taxAmount) else { problem = "税額を正しく入力してください"; return }
        let picked = file
        let store: String? = storeId.isEmpty ? nil : storeId
        let vendorRef: Any = vendorMode == "select" && !vendorId.isEmpty ? vendorId : NSNull()
        if NativePreview.current != nil { onSaved("見本のため保存していません"); return }
        saving = true
        Task {
            do {
                var fileRef: Any = NSNull()
                if let picked {
                    fileRef = try await NPIVApi.upload(picked, storeId: store, inlineMax: payload.inlineMax)
                }
                let req: [String: Any] = [
                    "type": "invoiceCreate",
                    "storeId": NPIVText.orNull(store),
                    "vendorId": vendorRef,
                    "vendorName": resolved,
                    "invoiceNo": NPIVText.orNull(NPIVText.trimmed(invoiceNo)),
                    "issueDate": NPIVText.orNull(issueDate),
                    "dueDate": NPIVText.orNull(dueDate),
                    "amount": amt,
                    "taxAmount": tax,
                    "registrationNumber": NPIVText.orNull(NPIVText.trimmed(registrationNumber)),
                    "paymentMethod": NPIVText.orNull(paymentMethod),
                    "expenseAccountId": NPIVText.orNull(expenseAccountId),
                    "note": NSNull(),
                    "file": fileRef,
                ]
                let msg = try await NPIVApi.act(req)
                saving = false
                onSaved(msg ?? "請求書を登録しました")
            } catch {
                problem = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}

// MARK: - 仕分け（保存ボックスの書類 → 種別・取引先・金額）

struct NPIVTriageSheet: View {
    let doc: NPIVInboxDoc
    let stores: [NPIVOption]
    let vendors: [NPIVOption]
    let docTypes: [NPIVChoice]
    let currentStoreId: String?
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var docType = "invoice"
    @State private var storeId: String
    @State private var vendorId = ""
    @State private var vendorName = ""
    @State private var docDate = ""
    @State private var amount = ""
    @State private var taxAmount = ""
    @State private var memo = ""
    @State private var saving = false
    @State private var ocrBusy = false
    @State private var ocrNote: String?
    @State private var problem: String?

    init(doc: NPIVInboxDoc, stores: [NPIVOption], vendors: [NPIVOption], docTypes: [NPIVChoice], currentStoreId: String?, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.doc = doc
        self.stores = stores
        self.vendors = vendors
        self.docTypes = docTypes
        self.currentStoreId = currentStoreId
        self.onSaved = onSaved
        self.onClose = onClose
        _storeId = State(initialValue: currentStoreId ?? "")
    }

    var body: some View {
        NPOCSheetFrame(title: "仕分け", confirmText: saving ? "保存中…" : "仕分ける", busy: saving, onCancel: onClose, onConfirm: save) {
            if let problem { NPACProblem(text: problem) }
            HStack(spacing: 8) {
                Image(systemName: doc.mimeType == "application/pdf" ? "doc.richtext" : "photo").foregroundColor(NT.ink3)
                Text(doc.fileName).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                NPACPill(title: "見る", icon: "eye") {
                    Task { await NPIVFiles.open(documentId: doc.id) { problem = $0 } }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                NOMButton(title: ocrBusy ? "読み取り中…" : "OCRで読み取り（未接続）", icon: "text.viewfinder", filled: false, height: 44, enabled: !ocrBusy) { runOcr() }
                if let ocrNote { Text(ocrNote).font(.system(size: 11.5)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true) }
            }
            NPOCField(label: "種別") {
                NPACSelect(options: docTypes.map { ($0.value, $0.label) }, selection: docType) { docType = $0 }
            }
            NPOCField(label: "店舗") {
                NPACSelect(options: [("", "全店舗（本社共通）")] + stores.map { ($0.id, $0.name) }, selection: storeId) { storeId = $0 }
            }
            NPOCField(label: "取引先") {
                VStack(alignment: .leading, spacing: 8) {
                    NPACSelect(options: [("", "（登録済みから選ばない）")] + vendors.map { ($0.id, $0.name) }, selection: vendorId) { vendorId = $0 }
                    if vendorId.isEmpty {
                        TextField("自由入力（任意）", text: $vendorName).font(.system(size: 16)).npocInputBox()
                    }
                }
            }
            NPIVOptionalDate(label: "日付", value: $docDate)
            HStack(spacing: 8) {
                NPIVAmountField(label: "金額", text: $amount)
                NPIVAmountField(label: "税額", text: $taxAmount)
            }
            NPIVTextField(label: "メモ", text: $memo)
        }
    }

    private func runOcr() {
        if NativePreview.current != nil { ocrNote = "見本では読み取りません"; return }
        ocrBusy = true
        problem = nil
        Task {
            do {
                let r = try await NPIVApi.post(["type": "invoiceOcr", "documentId": doc.id], as: NPIVOcrResult.self)
                if let x = r.extraction {
                    if let v = x.issuedDate { docDate = v }
                    if let v = x.total { amount = NPIVText.num(v) }
                    if let v = x.tax { taxAmount = NPIVText.num(v) }
                    if let v = x.vendor { vendorName = v }
                }
                ocrNote = [r.message, r.note].compactMap { $0 }.joined(separator: "\n")
            } catch {
                problem = NativeModuleAPI.message(error)
            }
            ocrBusy = false
        }
    }

    private func save() {
        problem = nil
        let amt = NPIVText.amount(amount)
        let tax = NPIVText.amount(taxAmount)
        if let amt, amt < 0 { problem = "金額を正しく入力してください"; return }
        if let tax, tax < 0 { problem = "税額を正しく入力してください"; return }
        let name: String? = vendorId.isEmpty ? NPIVText.trimmed(vendorName) : vendors.first(where: { $0.id == vendorId })?.name
        let req: [String: Any] = [
            "type": "invoiceTriage",
            "documentId": doc.id,
            "docType": docType,
            "storeId": NPIVText.orNull(storeId),
            "vendorId": NPIVText.orNull(vendorId),
            "vendorName": NPIVText.orNull(name),
            "docDate": NPIVText.orNull(docDate),
            "amount": amt.map { $0 as Any } ?? NSNull(),
            "taxAmount": tax.map { $0 as Any } ?? NSNull(),
            "memo": NPIVText.orNull(NPIVText.trimmed(memo)),
        ]
        saving = true
        Task {
            do {
                let msg = try await NPIVApi.act(req)
                saving = false
                onSaved(msg ?? "仕分けしました")
            } catch {
                problem = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}
