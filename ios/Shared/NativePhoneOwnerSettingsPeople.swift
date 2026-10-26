import SwiftUI

// iPhone の店長・オーナー：設定の中の画面（人）。2026-10-25 Ronnie「101% native」
//   POS担当者（/app/settings/clerks）：追加・名前・役職・非表示・削除（確認あり）
//   スタッフ管理（/app/staff）：招待（初期パスワードは一度だけ表示）・ロール・所属店舗・PIN・利用停止（確認あり）・パスワード再発行（確認あり）
// 読み込み・操作は iPad と同じモデル（NativeSettingsPages.swift の NativeClerksModel・NativeStaffModel）

// MARK: - POS担当者

struct NPSClerksPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeClerksModel
    @State private var confirmDelete: NCLRow?
    @State private var renaming: NCLRow?
    @State private var renameText = ""

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeClerksModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeClerksModel())
    }

    var body: some View {
        NPSPageFrame(title: "POS担当者", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                Text("会計・注文で選ぶ担当者の名前です（ログインのアカウントは要りません）").font(.system(size: 12.5)).foregroundColor(NT.ink2).padding(.horizontal, 4)
                if p.canEdit { addCard(p) }
                if p.rows.isEmpty { NPOCEmpty(icon: "person.2", title: "担当者がまだ登録されていません") }
                ForEach(p.rows) { r in row(r, p) }
                if p.lockOwner { NPSLockNote(text: "オーナーの担当者の削除・役職の変更は管理画面（PC）で") }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("担当者を削除しますか？", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible, presenting: confirmDelete) { r in
            Button("削除する", role: .destructive) { Task { await model.delete(r) } }
            Button("やめる", role: .cancel) {}
        } message: { r in Text("「\(r.name)」を削除します。過去の伝票の名前は残ります。退職なら「非表示」がおすすめです") }
        .alert("名前を変える", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("名前", text: $renameText)
            Button("決定") { if let r = renaming { Task { await model.rename(r, to: renameText) } }; renaming = nil }
            Button("やめる", role: .cancel) { renaming = nil }
        }
    }

    private func addCard(_ p: NCLPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("担当者を追加").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink)
            TextField("担当者の名前（例：山田・田中）", text: $model.newName).font(.system(size: 16)).npocInputBox()
                .onSubmit { Task { await model.add() } }
            HStack(spacing: 8) {
                roleMenu(selected: model.newRole, disabled: false) { model.newRole = $0 }
                NPOCWideButton(text: "追加する", icon: "plus", busy: model.busy == "add", disabled: model.newName.trimmingCharacters(in: .whitespaces).isEmpty, height: 44) {
                    Task { await model.add() }
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
    }

    private func roleMenu(selected: String, disabled: Bool, pick: @escaping (String) -> Void) -> some View {
        Menu {
            ForEach(model.payload?.roles ?? []) { r in
                Button { pick(r.id) } label: {
                    if r.id == selected { Label(r.label, systemImage: "checkmark") } else { Text(r.label) }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text(model.roleLabel(selected)).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 12).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }

    private func row(_ r: NCLRow, _ p: NCLPayload) -> some View {
        let hidden = r.status == "hidden"
        let locked = model.locked(r)
        let busy = model.busy == r.id
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "person.fill").font(.system(size: 14, weight: .semibold)).foregroundColor(hidden ? NT.ink3 : NT.purple)
                    .frame(width: 34, height: 34).background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hidden ? NT.page : NT.lilac))
                Button {
                    guard p.canEdit else { return }
                    renameText = r.name
                    renaming = r
                } label: {
                    HStack(spacing: 6) {
                        Text(r.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(hidden ? NT.ink3 : NT.ink).strikethrough(hidden, color: NT.ink3).lineLimit(1)
                        if hidden { NPSTag(text: "非表示") }
                        if p.canEdit { Image(systemName: "pencil").font(.system(size: 11)).foregroundColor(NT.ink3) }
                    }
                }
                .buttonStyle(.plain)
                Spacer(minLength: 4)
                if busy { ProgressView() }
                if !p.canEdit { Text(model.roleLabel(r.role)).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2) }
            }
            if p.canEdit {
                HStack(spacing: 8) {
                    roleMenu(selected: r.role, disabled: locked || busy) { role in Task { await model.setRole(r, role) } }
                    Button { Task { await model.toggleHidden(r) } } label: {
                        Label(hidden ? "表示に戻す" : "非表示", systemImage: hidden ? "eye" : "eye.slash")
                            .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                            .padding(.horizontal, 12).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle()).disabled(busy)
                    Spacer(minLength: 0)
                    Button { confirmDelete = r } label: {
                        Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(locked ? NT.ink3 : NT.danger)
                            .frame(width: 44, height: 44)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle()).disabled(locked || busy)
                }
            }
        }
        .padding(12).background(npocCard(14))
    }
}

// MARK: - スタッフ管理

struct NPSStaffPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeStaffModel

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeStaffModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeStaffModel())
    }

    private var editing: Binding<NSFRow?> {
        Binding(get: {
            if case .edit(let id) = model.panel { return model.row(id) }
            return nil
        }, set: { v in if v == nil, case .edit = model.panel { model.panel = .none } })
    }

    var body: some View {
        NPSPageFrame(title: "スタッフ管理", subtitle: model.payload?.organizationName ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload != nil { NPOCBarButton(icon: "person.badge.plus", label: "招待") { model.startInvite() } }
        }) {
            if let p = model.payload {
                if let sec = model.secret { secretCard(sec) }
                NPZSearchField(text: $model.query, placeholder: "名前・ロール・店舗で探す")
                NPZChipRow(items: [("", "すべて")] + p.statuses.map { ($0.id, $0.label) }, selection: model.statusFilter ?? "") { v in
                    model.statusFilter = v.isEmpty ? nil : v
                }
                let rows = model.filtered
                Text("\(rows.count)人・押すとロール・所属店舗・PIN・利用停止").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).padding(.leading, 4)
                if rows.isEmpty { NPOCEmpty(icon: "person.3", title: "該当するスタッフがいません") }
                ForEach(rows) { r in rowView(p, r) }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .sheet(isPresented: Binding(get: { model.panel == .invite }, set: { if !$0 && model.panel == .invite { model.panel = .none } })) {
            if let p = model.payload {
                NPSStaffInviteSheet(model: model, payload: p).presentationDetents([.large])
            }
        }
        .sheet(item: editing) { r in
            if let p = model.payload {
                NPSStaffEditSheet(model: model, payload: p, row: r).presentationDetents([.large])
            }
        }
    }

    private func rowView(_ p: NSFPayload, _ r: NSFRow) -> some View {
        Button {
            if !r.canEdit { model.toast = r.profileId == p.selfProfileId ? "自分の設定はプロフィールから変えてください" : "自分より上のロールのスタッフは変えられません"; return }
            model.startEdit(r)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().fill(r.status == "active" ? NT.lilac : NT.page).frame(width: 40, height: 40)
                    Text(String(r.displayName.prefix(1))).font(.system(size: 16, weight: NT.strong)).foregroundColor(r.status == "active" ? NT.purpleDeep : NT.ink3)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(r.displayName).font(.system(size: 15.5, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                        if r.profileId == p.selfProfileId { NPSTag(text: "自分") }
                    }
                    if let k = r.displayNameKana, !k.isEmpty { Text(k).font(.system(size: 11)).foregroundColor(NT.ink3) }
                    Text(r.roleLabel).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                    Text(model.isHq(r.role) ? "全店舗" : (r.storeNames.isEmpty ? "店舗 未設定" : r.storeNames.joined(separator: "、")))
                        .font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(2).multilineTextAlignment(.leading)
                    HStack(spacing: 5) {
                        NOSBadge(text: p.statuses.first { $0.id == r.status }?.label ?? r.status,
                                 color: r.status == "active" ? NT.ok : (r.status == "invited" ? NT.purple : NT.ink3))
                        NPSTag(text: r.hasPin ? "PIN 設定済" : "PIN 未設定", color: r.hasPin ? NT.ok : NT.ink3)
                    }
                }
                Spacer(minLength: 4)
                if r.canEdit { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).padding(.top, 12) }
            }
            .padding(12)
            .background(npocCard(14))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    /// 招待・再発行のパスワード（一度だけ）
    private func secretCard(_ sec: (title: String, who: String, value: String)) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "key.fill").font(.system(size: 16, weight: .bold)).foregroundColor(NT.purple)
                Text(sec.title).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer()
                Button { model.secret = nil } label: { Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).frame(width: 32, height: 32) }
                    .buttonStyle(.plain)
            }
            Text("\(sec.who) さんの初期パスワード。本人に安全な方法で伝えてください（閉じると見られません）").font(.system(size: 12)).foregroundColor(NT.ink2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(sec.value).font(.system(size: 20, weight: NT.strong, design: .monospaced)).foregroundColor(NT.ink).textSelection(.enabled)
                    .padding(.horizontal, 12).frame(height: 44).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                Button {
                    UIPasteboard.general.string = sec.value
                    model.toast = "パスワードをコピーしました"
                } label: {
                    Label("コピー", systemImage: "doc.on.doc").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 14).frame(height: 44).background(Capsule().fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.purple.opacity(0.4), lineWidth: 1))
    }
}

/// 所属店舗を選ぶ（チェックの札）
struct NPSStorePicker: View {
    let stores: [NFNamed]
    @Binding var selection: Set<String>

    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(stores) { st in
                let on = selection.contains(st.id)
                Button { if on { selection.remove(st.id) } else { selection.insert(st.id) } } label: {
                    HStack(spacing: 5) {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundColor(on ? NT.purple : NT.ink3)
                        Text(st.name).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                    }
                    .padding(.horizontal, 12).frame(height: 38)
                    .background(Capsule().fill(on ? NT.lilac : Color.white))
                    .overlay(Capsule().stroke(on ? NT.purple.opacity(0.5) : NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

/// スタッフを招待
struct NPSStaffInviteSheet: View {
    @ObservedObject var model: NativeStaffModel
    let payload: NSFPayload

    private var canSend: Bool {
        !model.invEmail.trimmingCharacters(in: .whitespaces).isEmpty && !model.invName.trimmingCharacters(in: .whitespaces).isEmpty
            && (model.isHq(model.invRole) || !model.invStores.isEmpty)
    }

    var body: some View {
        NPOCSheetFrame(title: "スタッフを招待", confirmText: "招待する", busy: model.busy == "invite", onCancel: { model.panel = .none }, onConfirm: {
            guard canSend else { model.toast = "メールアドレス・氏名・所属店舗を入れてください"; return }
            Task { await model.invite() }
        }) {
            Text("初期パスワードは招待のあと一度だけ表示されます").font(.system(size: 12.5)).foregroundColor(NT.ink2)
            NPSInput(label: "メールアドレス", text: $model.invEmail, placeholder: "staff@example.com", keyboard: .emailAddress, required: true)
            NPSInput(label: "氏名", text: $model.invName, placeholder: "山田 太郎", required: true)
            NPSInput(label: "ふりがな", text: $model.invKana, placeholder: "やまだ たろう")
            NPOCField(label: "ロール") {
                NPSChoice(options: payload.roles.filter(\.assignable).map { ($0.id, $0.label) }, selection: model.invRole) { model.invRole = $0 }
            }
            if !model.isHq(model.invRole) {
                NPOCField(label: "所属店舗（1つ以上）") { NPSStorePicker(stores: payload.stores, selection: $model.invStores) }
            }
            if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
        }
    }
}

/// スタッフの変更（ロール・所属店舗・PIN・利用停止・パスワード再発行）
struct NPSStaffEditSheet: View {
    @ObservedObject var model: NativeStaffModel
    let payload: NSFPayload
    let row: NSFRow
    @State private var confirmSuspend = false
    @State private var confirmReset = false

    var body: some View {
        NPOCSheetFrame(title: row.displayName, cancelText: "閉じる", onCancel: { model.panel = .none }, onConfirm: nil) {
            HStack(spacing: 6) {
                NOSBadge(text: payload.statuses.first { $0.id == row.status }?.label ?? row.status, color: row.status == "active" ? NT.ok : NT.ink3)
                Text(row.roleLabel).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            }
            NPOCard(title: "ロール") {
                NPSChoice(options: payload.roles.filter(\.assignable).map { ($0.id, $0.label) }, selection: model.edRole) { model.edRole = $0 }
                NPOCWideButton(text: "ロールを変更", busy: model.busy == "role",
                               disabled: model.edRole == row.role || (!model.isHq(model.edRole) && model.edStores.isEmpty), height: 44) {
                    Task { await model.saveRole(row) }
                }
            }
            if !model.isHq(model.edRole) {
                NPOCard(title: "所属店舗", trailing: "1つ以上") {
                    NPSStorePicker(stores: payload.stores, selection: $model.edStores)
                    if model.edRole == row.role {
                        NPOCWideButton(text: "所属店舗を変更", busy: model.busy == "stores", disabled: model.edStores == Set(row.storeIds) || model.edStores.isEmpty, height: 44) {
                            Task { await model.saveStores(row) }
                        }
                    }
                }
            }
            NPOCard(title: "PIN", trailing: "4〜6桁") {
                NPSInput(label: row.hasPin ? "新しいPIN（今の PIN を変える）" : "PIN", text: $model.edPin, placeholder: "1234", keyboard: .numberPad)
                NPOCWideButton(text: row.hasPin ? "PINを変える" : "PINを設定", busy: model.busy == "pin",
                               disabled: !(4...6).contains(model.edPin.count) || !model.edPin.allSatisfy(\.isNumber), height: 44) {
                    Task { await model.savePin(row) }
                }
            }
            NPOCard(title: "アカウント") {
                if row.status == "suspended" {
                    NPOCWideButton(text: "利用を再開", icon: "play.circle", kind: .success, busy: model.busy == "status", height: 46) {
                        Task { await model.setStatus(row, "active") }
                    }
                } else {
                    NPOCWideButton(text: "利用を停止", icon: "pause.circle", kind: .danger, busy: model.busy == "status", height: 46) { confirmSuspend = true }
                }
                NPOCWideButton(text: "パスワードを再発行", icon: "key", kind: .secondary, busy: model.busy == "pw", height: 46) { confirmReset = true }
            }
            if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2) }
        }
        .confirmationDialog("利用を停止しますか？", isPresented: $confirmSuspend, titleVisibility: .visible) {
            Button("停止する", role: .destructive) { Task { await model.setStatus(row, "suspended") } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「\(row.displayName)」はログインできなくなります。あとで再開できます")
        }
        .confirmationDialog("パスワードを再発行しますか？", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("再発行する", role: .destructive) {
                Task {
                    await model.resetPassword(row)
                    // 新しいパスワードは一覧の上のカードに一度だけ出す
                    if model.secret != nil { model.panel = .none }
                }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「\(row.displayName)」の今のパスワードは使えなくなります。新しいパスワードは一度だけ表示されます")
        }
    }
}
