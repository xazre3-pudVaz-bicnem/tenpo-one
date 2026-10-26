import SwiftUI
import UIKit
import PhotosUI

// 請求書・書類のネイティブのシート（Web の components/invoices/invoice-detail.tsx・invoice-form.tsx・triage-dialog.tsx と同じ中身）。
//   詳細：状態・金額・項目・添付（画像はその場で、PDF は開く）・コメント・状態の変更（確認待ちへ／承認へ回す／承認／支払予定／支払済み（支払日）／差戻し（理由））・編集（OCR）
//   登録：添付（ファイル・写真・撮影）・店舗（本部だけ）・取引先（登録済み／自由入力）・番号・支払方法・発行日・支払期限・金額・税額・登録番号・費目
//   仕分け：OCR・種別・店舗・取引先・日付・金額・税額・メモ

// MARK: - 共通

/// 色のついたボタン（承認・支払済みは緑、差戻しは赤。Web の success・danger）
struct NInvSolidButton: View {
    let text: String
    var color: Color = NT.purple
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy { ProgressView().scaleEffect(0.8).tint(Color.white) }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold)).foregroundColor(Color.white)
            .padding(.horizontal, 16).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }
}

/// フォームの文字の1行（名前は左、入力は右）
struct NInvTextRow: View {
    let label: String
    @Binding var text: String
    var placeholder = ""

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
            Spacer(minLength: 8)
            TextField(placeholder, text: $text).multilineTextAlignment(.trailing)
        }
    }
}

/// 金額の入力が正しいか（空は 0。Web の Number() と同じく数でなければだめ）
private func nInvYen(_ s: String) -> Int? {
    guard let v = NInvText.amount(s) else { return 0 }
    return v >= 0 ? v : nil
}

// MARK: - 詳細

@MainActor
final class NInvDetailModel: ObservableObject {
    let invoiceId: String
    @Published var detail: NInvDetail?
    @Published var error: String?
    @Published var actionError: String?
    @Published var info: String?
    @Published var busy = false
    @Published var imageURL: URL?

    init(invoiceId: String) {
        self.invoiceId = invoiceId
        detail = NativeModuleAPI.cached(NInvDetailPayload.self, part: "invoices", query: ["invoice": invoiceId])?.detail
    }

    func load() async {
        do {
            let r = try await NInvAPI.get(NInvDetailPayload.self, ["invoice": invoiceId])
            detail = r.detail
            error = nil
            if let a = r.detail.attachment, a.mimeType.hasPrefix("image/"), imageURL == nil {
                let q = ["file": a.documentId]
                if let f = try? await NInvAPI.get(NInvFilePayload.self, q) { imageURL = URL(string: f.url) }
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
        info = nil
        defer { busy = false }
        do {
            info = try await NInvAPI.act(body)
            await load()
            return true
        } catch {
            actionError = NativeModuleAPI.message(error)
            return false
        }
    }
}

struct NInvDetailSheet: View {
    let invoiceId: String
    let accounts: [NInvOption]
    let paymentMethods: [NInvChoice]
    let onChanged: () -> Void
    let onClose: () -> Void

    @StateObject private var model: NInvDetailModel
    @State private var editing = false
    @State private var showPay = false
    @State private var paidAt = NPDate.str(Date())
    @State private var showReject = false
    @State private var rejectReason = ""
    @State private var commentBody = ""
    @State private var openError: String?

    // 編集
    @State private var eVendor = ""
    @State private var eInvoiceNo = ""
    @State private var eIssue = ""
    @State private var eDue = ""
    @State private var eAmount = "0"
    @State private var eTax = "0"
    @State private var eReg = ""
    @State private var eMethod = ""
    @State private var eAccount = ""
    @State private var eNote = ""
    @State private var ocrBusy = false
    @State private var ocrNote: String?

    init(invoiceId: String, accounts: [NInvOption], paymentMethods: [NInvChoice], onChanged: @escaping () -> Void, onClose: @escaping () -> Void) {
        self.invoiceId = invoiceId
        self.accounts = accounts
        self.paymentMethods = paymentMethods
        self.onChanged = onChanged
        self.onClose = onClose
        _model = StateObject(wrappedValue: NInvDetailModel(invoiceId: invoiceId))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(editing ? "請求書の編集" : "請求書の詳細")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(editing ? "キャンセル" : "閉じる") {
                            if editing { editing = false; model.actionError = nil } else { onClose() }
                        }
                        .disabled(model.busy)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if editing {
                            Button(model.busy ? "保存中…" : "保存する") { save() }.disabled(model.busy)
                        }
                    }
                }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        if let d = model.detail {
            if editing { editForm(d) } else { viewBody(d) }
        } else if let e = model.error {
            VStack(spacing: 10) {
                Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                Button("もう一度") { Task { await model.load() } }
            }
            .padding(40)
        } else {
            ProgressView("読み込み中…").tint(NT.purple)
        }
    }

    // MARK: 見る

    private func viewBody(_ d: NInvDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 12) {
                    NPBadge(text: d.statusLabel, color: NInvText.statusColor(d.status))
                    Spacer(minLength: 8)
                    Text(NInvText.yen(d.amount)).font(.system(size: 28, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink)
                    if d.canEdit {
                        NPRButton(text: "編集する", disabled: model.busy) { startEdit(d) }
                    }
                }
                fields(d)
                attachment(d)
                if let docId = d.documentId { comments(d, documentId: docId) }
                messages
                statusSection(d)
            }
            .padding(20)
        }
        .background(NT.page.ignoresSafeArea())
    }

    private func fields(_ d: NInvDetail) -> some View {
        let cols = [GridItem(.flexible(), spacing: 16, alignment: .topLeading), GridItem(.flexible(), spacing: 16, alignment: .topLeading)]
        return VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: cols, alignment: .leading, spacing: 12) {
                field("取引先", d.vendorName, strong: true)
                field("店舗", d.storeLabel)
                field("請求書番号", d.invoiceNo ?? "—")
                field("支払方法", d.paymentMethodLabel ?? "—")
                field("発行日", d.issueLabel)
                field("支払期限", d.dueLabel)
                field("税額", NInvText.yen(d.taxAmount))
                field("支払日", d.paidLabel)
                field("費目", d.expenseLabel)
                field("インボイス登録番号", d.registrationNumber ?? "—")
            }
            if let note = d.note, !note.isEmpty {
                field("メモ", note)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func field(_ label: String, _ value: String, strong: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 15, weight: strong ? .bold : .regular)).foregroundColor(NT.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func attachment(_ d: NInvDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("添付ファイル").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                if let a = d.attachment {
                    NPBadge(text: "OCR: \(a.ocrLabel ?? "未実行")", color: NInvText.ocrColor(a.ocrStatus))
                }
            }
            if let a = d.attachment {
                if a.mimeType.hasPrefix("image/"), let u = model.imageURL {
                    Button { open(a.documentId) } label: {
                        AsyncImage(url: u) { img in
                            img.resizable().scaledToFit()
                        } placeholder: {
                            ProgressView().frame(width: 120, height: 120)
                        }
                        .frame(maxHeight: 260)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
                Button { open(a.documentId) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: a.mimeType == "application/pdf" ? "doc.richtext" : "photo")
                        Text("\(a.fileName) を開く").lineLimit(1)
                    }
                    .font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.purple)
                }
                .buttonStyle(PressableStyle())
                if let openError { Text(openError).font(.system(size: 12.5)).foregroundColor(NT.danger) }
            } else {
                Text("添付なし").font(.system(size: 14)).foregroundColor(NT.ink3)
            }
        }
    }

    private func comments(_ d: NInvDetail, documentId: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("コメント").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
            if d.comments.isEmpty {
                Text("コメントはまだありません").font(.system(size: 14)).foregroundColor(NT.ink3)
            }
            ForEach(d.comments) { c in
                VStack(alignment: .leading, spacing: 4) {
                    Text(c.body).font(.system(size: 14)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    Text("\(c.author)・\(c.createdLabel)").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            }
            if d.canComment {
                TextField("コメントを入力", text: $commentBody, axis: .vertical)
                    .lineLimit(2...5)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                HStack {
                    Spacer()
                    NPRButton(text: "コメントを追加", busy: model.busy, disabled: NInvText.trimmed(commentBody).isEmpty) {
                        let text = NInvText.trimmed(commentBody)
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

    @ViewBuilder private var messages: some View {
        if let e = model.actionError {
            Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
        }
        if let i = model.info {
            Text(i).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ok)
        }
    }

    private func statusSection(_ d: NInvDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(NT.line).frame(height: 1)
            Text("状態を変更").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
            if let role = d.requiredApprovalRoleLabel {
                Text("この金額の承認には「\(role)」以上のロールが必要です").font(.system(size: 12.5)).foregroundColor(NFColor.royal)
            }
            WrapLayout(spacing: 8) {
                ForEach(d.actions) { a in actionButton(a, d) }
                if d.noPermission {
                    Text("状態を変更する権限がありません").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                }
            }
            if showPay { payBox(d) }
            if showReject { rejectBox(d) }
        }
    }

    @ViewBuilder private func actionButton(_ a: NInvActionItem, _ d: NInvDetail) -> some View {
        switch a.action {
        case "pay":
            if !showPay {
                NInvSolidButton(text: a.label, color: NT.pay, disabled: model.busy) { showPay = true }
            }
        case "reject":
            if !showReject {
                NInvSolidButton(text: a.label, color: NT.danger, disabled: model.busy) { showReject = true }
            }
        case "approve":
            NInvSolidButton(text: a.label, color: NT.pay, busy: model.busy) { run(["action": a.action], d) }
        default:
            NInvSolidButton(text: a.label, busy: model.busy) { run(["action": a.action], d) }
        }
    }

    private func payBox(_ d: NInvDetail) -> some View {
        HStack(spacing: 12) {
            Text("支払日").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2)
            DatePicker("", selection: Binding(get: { NPDate.date(paidAt) }, set: { paidAt = NPDate.str($0) }), displayedComponents: .date)
                .labelsHidden()
            Spacer(minLength: 8)
            NInvSolidButton(text: "確定する", color: NT.pay, busy: model.busy) {
                run(["action": "pay", "paidAt": paidAt], d) { showPay = false }
            }
            NPRButton(text: "キャンセル", disabled: model.busy) { showPay = false }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
    }

    private func rejectBox(_ d: NInvDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("差戻し理由（必須）").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
            TextField("差戻す理由を入力してください", text: $rejectReason, axis: .vertical)
                .lineLimit(2...5)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            HStack(spacing: 8) {
                Spacer()
                NPRButton(text: "キャンセル", disabled: model.busy) { showReject = false }
                NInvSolidButton(text: "差戻す", color: NT.danger, busy: model.busy, disabled: NInvText.trimmed(rejectReason).isEmpty) {
                    run(["action": "reject", "reason": NInvText.trimmed(rejectReason)], d) {
                        showReject = false
                        rejectReason = ""
                    }
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
    }

    private func run(_ extra: [String: Any], _ d: NInvDetail, then: (() -> Void)? = nil) {
        var req: [String: Any] = ["type": "invoiceStatus", "invoiceId": d.id]
        for (k, v) in extra { req[k] = v }
        Task {
            if await model.act(req) {
                then?()
                onChanged()
            }
        }
    }

    private func open(_ documentId: String) {
        openError = nil
        Task { await NInvFiles.open(documentId: documentId) { openError = $0 } }
    }

    // MARK: 編集

    private func startEdit(_ d: NInvDetail) {
        ocrNote = nil
        eVendor = d.vendorName
        eInvoiceNo = d.invoiceNo ?? ""
        eIssue = d.issueDate ?? ""
        eDue = d.dueDate ?? ""
        eAmount = NInvText.num(d.amount)
        eTax = NInvText.num(d.taxAmount)
        eReg = d.registrationNumber ?? ""
        eMethod = d.paymentMethod ?? ""
        eAccount = d.expenseAccountId ?? ""
        eNote = d.note ?? ""
        model.actionError = nil
        model.info = nil
        editing = true
    }

    private func editForm(_ d: NInvDetail) -> some View {
        Form {
            if let docId = d.documentId {
                Section {
                    Button(ocrBusy ? "読み取り中…" : "OCRで読み取り（未接続）") { runOcr(docId) }
                        .disabled(ocrBusy)
                    if let ocrNote { Text(ocrNote).font(.system(size: 12.5)).foregroundColor(NT.warn) }
                }
            }
            Section {
                NInvTextRow(label: "取引先", text: $eVendor)
                NInvTextRow(label: "請求書番号", text: $eInvoiceNo)
                Picker("支払方法", selection: $eMethod) {
                    Text("未設定").tag("")
                    ForEach(paymentMethods) { m in Text(m.label).tag(m.value) }
                }
                NInvOptionalDate(label: "発行日", value: $eIssue)
                NInvOptionalDate(label: "支払期限", value: $eDue)
                NInvAmountRow(label: "金額", text: $eAmount)
                NInvAmountRow(label: "税額", text: $eTax)
                NInvTextRow(label: "インボイス登録番号", text: $eReg)
                Picker("費目", selection: $eAccount) {
                    Text("未設定").tag("")
                    ForEach(accounts) { a in Text(a.name).tag(a.id) }
                }
            }
            Section("メモ") {
                TextField("メモ", text: $eNote, axis: .vertical).lineLimit(2...6)
            }
            if let e = model.actionError {
                Section { Text(e).foregroundColor(NT.danger) }
            }
        }
    }

    private func runOcr(_ documentId: String) {
        ocrBusy = true
        Task {
            do {
                let r = try await NInvAPI.post(["type": "invoiceOcr", "documentId": documentId], as: NInvOcrResult.self)
                if let x = r.extraction {
                    if let v = x.issuedDate { eIssue = v }
                    if let v = x.dueDate { eDue = v }
                    if let v = x.total { eAmount = NInvText.num(v) }
                    if let v = x.tax { eTax = NInvText.num(v) }
                    if let v = x.registrationNumber { eReg = v }
                    if let v = x.vendor { eVendor = v }
                }
                ocrNote = r.note
            } catch {
                model.actionError = NativeModuleAPI.message(error)
            }
            ocrBusy = false
        }
    }

    private func save() {
        guard let d = model.detail else { return }
        let vendor = NInvText.trimmed(eVendor)
        if vendor.isEmpty { model.actionError = "取引先を入力してください"; return }
        guard let amount = nInvYen(eAmount) else { model.actionError = "金額を正しく入力してください"; return }
        let tax = nInvYen(eTax) ?? 0
        let req: [String: Any] = [
            "type": "invoiceUpdate",
            "invoiceId": d.id,
            "vendorName": vendor,
            "invoiceNo": NInvText.orNull(NInvText.trimmed(eInvoiceNo)),
            "issueDate": NInvText.orNull(eIssue),
            "dueDate": NInvText.orNull(eDue),
            "amount": amount,
            "taxAmount": tax,
            "registrationNumber": NInvText.orNull(NInvText.trimmed(eReg)),
            "paymentMethod": NInvText.orNull(eMethod),
            "expenseAccountId": NInvText.orNull(eAccount),
            "note": NInvText.orNull(NInvText.trimmed(eNote)),
        ]
        Task {
            if await model.act(req) {
                editing = false
                onChanged()
            }
        }
    }
}

// MARK: - 請求書を登録

struct NInvCreateSheet: View {
    let payload: NInvListPayload
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var file: NInvPickedFile?
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
    @State private var error: String?
    @State private var saving = false

    init(payload: NInvListPayload, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.payload = payload
        self.onSaved = onSaved
        self.onClose = onClose
        _storeId = State(initialValue: payload.currentStoreId ?? "")
        _vendorMode = State(initialValue: payload.vendors.isEmpty ? "free" : "select")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("添付ファイル（任意）") {
                    NInvAttachRow(file: $file, photoItems: $photoItems, onFiles: { picking = true }, onCamera: { camera = true })
                }
                if !payload.formStores.isEmpty {
                    Section {
                        Picker("店舗", selection: $storeId) {
                            Text("全店舗（本社共通）").tag("")
                            ForEach(payload.formStores) { s in Text(s.name).tag(s.id) }
                        }
                    }
                }
                Section("取引先") {
                    if !payload.vendors.isEmpty {
                        Picker("", selection: $vendorMode) {
                            Text("登録済みから選択").tag("select")
                            Text("自由入力").tag("free")
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    if vendorMode == "select" && !payload.vendors.isEmpty {
                        Picker("取引先", selection: $vendorId) {
                            Text("選択してください").tag("")
                            ForEach(payload.vendors) { v in Text(v.name).tag(v.id) }
                        }
                    } else {
                        TextField("取引先名を入力", text: $vendorName)
                    }
                }
                Section {
                    NInvTextRow(label: "請求書番号", text: $invoiceNo)
                    Picker("支払方法", selection: $paymentMethod) {
                        Text("未設定").tag("")
                        ForEach(payload.paymentMethodOptions) { m in Text(m.label).tag(m.value) }
                    }
                    NInvOptionalDate(label: "発行日", value: $issueDate)
                    NInvOptionalDate(label: "支払期限", value: $dueDate)
                    NInvAmountRow(label: "金額", text: $amount)
                    NInvAmountRow(label: "税額", text: $taxAmount)
                    NInvTextRow(label: "インボイス登録番号", text: $registrationNumber, placeholder: "T1234567890123")
                    Picker("費目", selection: $expenseAccountId) {
                        Text("未設定").tag("")
                        ForEach(payload.accounts) { a in Text(a.name).tag(a.id) }
                    }
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("請求書を登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "登録中…" : "登録する") { save() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .fileImporter(isPresented: $picking, allowedContentTypes: NInvFiles.pickerTypes, allowsMultipleSelection: false) { res in
            if case .success(let urls) = res, let url = urls.first {
                if let f = NInvFiles.read(url) { take(f) } else { error = "ファイルの読み込みに失敗しました" }
            }
        }
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            Task {
                let files = await NInvFiles.photos(items)
                photoItems = []
                if let f = files.first { take(f) } else { error = "写真を読み込めませんでした" }
            }
        }
        .fullScreenCover(isPresented: $camera) {
            SCNCameraPicker { img in
                camera = false
                if let img, let f = NInvFiles.photo(img) { take(f) }
            }
            .ignoresSafeArea()
        }
    }

    private func take(_ f: NInvPickedFile) {
        if let problem = NInvFiles.problem(f, maxSize: payload.maxFileSize) {
            error = problem
            return
        }
        error = nil
        file = f
    }

    private func save() {
        error = nil
        let resolved = vendorMode == "select" && !payload.vendors.isEmpty
            ? (payload.vendors.first(where: { $0.id == vendorId })?.name ?? "")
            : NInvText.trimmed(vendorName)
        if resolved.isEmpty { error = "取引先を選択または入力してください"; return }
        guard let amt = nInvYen(amount) else { error = "金額を正しく入力してください"; return }
        guard let tax = nInvYen(taxAmount) else { error = "税額を正しく入力してください"; return }
        let picked = file
        let store: String? = storeId.isEmpty ? nil : storeId
        let vendorRef: Any = vendorMode == "select" && !vendorId.isEmpty ? vendorId : NSNull()
        saving = true
        Task {
            do {
                var fileRef: Any = NSNull()
                if let picked {
                    fileRef = try await NInvAPI.upload(picked, storeId: store, inlineMax: payload.inlineMax)
                }
                let req: [String: Any] = [
                    "type": "invoiceCreate",
                    "storeId": NInvText.orNull(store),
                    "vendorId": vendorRef,
                    "vendorName": resolved,
                    "invoiceNo": NInvText.orNull(NInvText.trimmed(invoiceNo)),
                    "issueDate": NInvText.orNull(issueDate),
                    "dueDate": NInvText.orNull(dueDate),
                    "amount": amt,
                    "taxAmount": tax,
                    "registrationNumber": NInvText.orNull(NInvText.trimmed(registrationNumber)),
                    "paymentMethod": NInvText.orNull(paymentMethod),
                    "expenseAccountId": NInvText.orNull(expenseAccountId),
                    "note": NSNull(),
                    "file": fileRef,
                ]
                let msg = try await NInvAPI.act(req)
                saving = false
                onSaved(msg ?? "請求書を登録しました")
            } catch {
                self.error = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}

// MARK: - 仕分け

struct NInvTriageSheet: View {
    let doc: NInvInboxDoc
    let stores: [NInvOption]
    let vendors: [NInvOption]
    let docTypes: [NInvChoice]
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
    @State private var info: String?
    @State private var error: String?

    init(doc: NInvInboxDoc, stores: [NInvOption], vendors: [NInvOption], docTypes: [NInvChoice], currentStoreId: String?, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
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
        NavigationStack {
            Form {
                Section {
                    Button(ocrBusy ? "読み取り中…" : "OCRで読み取り（未接続）") { runOcr() }
                        .disabled(ocrBusy)
                    if let ocrNote { Text(ocrNote).font(.system(size: 12.5)).foregroundColor(NT.warn) }
                    if let info { Text(info).font(.system(size: 12.5)).foregroundColor(NT.ok) }
                }
                Section {
                    Picker("種別", selection: $docType) {
                        ForEach(docTypes) { t in Text(t.label).tag(t.value) }
                    }
                    Picker("店舗", selection: $storeId) {
                        Text("全店舗（本社共通）").tag("")
                        ForEach(stores) { s in Text(s.name).tag(s.id) }
                    }
                }
                Section("取引先") {
                    Picker("登録済み", selection: $vendorId) {
                        Text("（登録済みから選択しない）").tag("")
                        ForEach(vendors) { v in Text(v.name).tag(v.id) }
                    }
                    TextField("自由入力（任意）", text: $vendorName)
                        .disabled(!vendorId.isEmpty)
                        .foregroundColor(vendorId.isEmpty ? NT.ink : NT.ink3)
                }
                Section {
                    NInvOptionalDate(label: "日付", value: $docDate)
                    NInvAmountRow(label: "金額", text: $amount)
                    NInvAmountRow(label: "税額", text: $taxAmount)
                    NInvTextRow(label: "メモ", text: $memo)
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("仕分け：\(doc.fileName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "保存中…" : "この内容で仕分ける") { save() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func runOcr() {
        ocrBusy = true
        error = nil
        Task {
            do {
                let r = try await NInvAPI.post(["type": "invoiceOcr", "documentId": doc.id], as: NInvOcrResult.self)
                if let x = r.extraction {
                    if let v = x.issuedDate { docDate = v }
                    if let v = x.total { amount = NInvText.num(v) }
                    if let v = x.tax { taxAmount = NInvText.num(v) }
                    if let v = x.vendor { vendorName = v }
                }
                ocrNote = r.note
                info = r.message
            } catch {
                self.error = NativeModuleAPI.message(error)
            }
            ocrBusy = false
        }
    }

    private func save() {
        error = nil
        let amt = NInvText.amount(amount)
        let tax = NInvText.amount(taxAmount)
        if let amt, amt < 0 { error = "金額を正しく入力してください"; return }
        if let tax, tax < 0 { error = "税額を正しく入力してください"; return }
        let name: String? = vendorId.isEmpty ? NInvText.trimmed(vendorName) : vendors.first(where: { $0.id == vendorId })?.name
        let req: [String: Any] = [
            "type": "invoiceTriage",
            "documentId": doc.id,
            "docType": docType,
            "storeId": NInvText.orNull(storeId),
            "vendorId": NInvText.orNull(vendorId),
            "vendorName": NInvText.orNull(name),
            "docDate": NInvText.orNull(docDate),
            "amount": amt.map { $0 as Any } ?? NSNull(),
            "taxAmount": tax.map { $0 as Any } ?? NSNull(),
            "memo": NInvText.orNull(NInvText.trimmed(memo)),
        ]
        saving = true
        Task {
            do {
                let msg = try await NInvAPI.act(req)
                saving = false
                onSaved(msg ?? "仕分けしました")
            } catch {
                self.error = NativeModuleAPI.message(error)
                saving = false
            }
        }
    }
}
