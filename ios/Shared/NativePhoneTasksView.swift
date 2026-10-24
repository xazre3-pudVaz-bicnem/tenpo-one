import SwiftUI

// iPhone の店長・オーナー：タスク・引継ぎ（ネイティブ）。Web の /app/tasks と同じ中身・同じ操作（2026-10-25 Ronnie「iPhone も native に」）
//   一覧（既定は未完了）・絞り込み（状態・店舗・優先度・担当）・タスクを作成・編集（タイトル・内容・担当・優先度・期限）
//   詳細：状態を変える（未着手→対応中→完了／取消・戻す）・コメント（引継ぎメモ）を足す
// サーバーは iPad と同じ：GET part=tasks ／ POST taskSave・taskStatus・taskComment（lib/native-modules/tasks.ts）

// MARK: - 中身（サーバーの返事。使うところだけ）

/// コメント（引継ぎメモ）。古いデータで欠けていても落ちないように全部 optional
struct NPOTaskComment: Decodable, Hashable {
    let by: String?
    let name: String?
    let at: String?
    let body: String?
}

struct NPOTask: Decodable, Identifiable, Hashable {
    let id: String
    let storeId: String
    let storeName: String?
    let title: String
    let body: String?
    var status: String
    let priority: String
    let assigneeId: String?
    /// 未割当なら nil
    let assigneeName: String?
    let dueDate: String?
    /// 期限を過ぎていて、完了・取消でない
    let overdue: Bool
    var comments: [NPOTaskComment]
}

struct NPOTasksPayload: Decodable {
    let stores: [NPOCOption]
    /// タスクを作る店舗（今の店舗か選んだ店舗。無ければ作れない）
    let selectedStoreId: String?
    let status: String?
    let priority: String?
    let assignee: String?
    /// 担当者の選択肢（選んでいる店舗の有効なメンバー）
    let staff: [NPOCOption]
    let tasks: [NPOTask]
}

/// 名前・色（Web の STATUS_LABEL・STATUS_TONE・PRIORITY_LABEL と同じ）
enum NPOTaskText {
    static let statuses: [(String, String)] = [("open", "未着手"), ("in_progress", "対応中"), ("done", "完了"), ("cancelled", "取消")]
    static let priorities: [(String, String)] = [("high", "高"), ("normal", "中"), ("low", "低")]

    static func status(_ s: String) -> String { statuses.first { $0.0 == s }?.1 ?? s }
    static func priority(_ s: String) -> String { priorities.first { $0.0 == s }?.1 ?? s }

    static func statusColor(_ s: String) -> Color {
        switch s {
        case "in_progress": return NT.warn
        case "done": return NT.ok
        case "cancelled": return NT.danger
        default: return NT.ink3
        }
    }

    static func priorityColor(_ s: String) -> Color {
        switch s {
        case "high": return NT.danger
        case "low": return NT.ink3
        default: return NT.purple
        }
    }

    /// 今の状態から変えられる先（Web の TaskDetailDialog のボタンと同じ並び・同じ組み合わせ）
    static func moves(_ s: String) -> [(next: String, label: String, icon: String, kind: NPOCWideButton.Kind)] {
        switch s {
        case "open":
            return [("in_progress", "対応中にする", "play.fill", .primary), ("cancelled", "取消にする", "xmark", .danger)]
        case "in_progress":
            return [("done", "完了にする", "checkmark", .success), ("open", "未着手に戻す", "arrow.uturn.backward", .secondary), ("cancelled", "取消にする", "xmark", .danger)]
        case "done", "cancelled":
            return [("open", "未着手に戻す", "arrow.uturn.backward", .secondary)]
        default:
            return []
        }
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPOTasksModel: ObservableObject {
    @Published var payload: NPOTasksPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いているタスク（絞り込みで一覧から消えても、この画面は最後の中身で出しておく）
    @Published var detail: NPOTask?

    // 絞り込み（Web のフォームと同じ。サーバーが決めた値を読み込みのたびに入れ直す）
    @Published var store: String
    @Published var status: String
    @Published var priority: String
    @Published var assignee: String

    private var generation = 0

    init(route: NativeModuleRoute) {
        store = route.query("store") ?? ""
        status = route.query("status") ?? ""
        priority = route.query("priority") ?? ""
        assignee = route.query("assignee") ?? ""
        payload = NativeModuleAPI.cached(NPOTasksPayload.self, part: "tasks", query: query())
    }

    func query() -> [String: String] {
        var q: [String: String] = [:]
        if !store.isEmpty { q["store"] = store }
        if !status.isEmpty { q["status"] = status }
        if !priority.isEmpty { q["priority"] = priority }
        if !assignee.isEmpty { q["assignee"] = assignee }
        return q
    }

    func load() async {
        if NativePreview.current != nil { return }
        generation += 1
        let mine = generation
        do {
            let p = try await NativeModuleAPI.get(NPOTasksPayload.self, part: "tasks", query: query())
            guard mine == generation else { return }
            payload = p
            store = p.selectedStoreId ?? ""
            status = p.status ?? ""
            priority = p.priority ?? ""
            assignee = p.assignee ?? ""
            error = nil
            if let d = detail, let fresh = task(d.id) { detail = fresh }
        } catch {
            guard mine == generation else { return }
            // 最初から読めない（権限・ログイン・回線）ときは Web の画面（オーナーのホームと同じ）
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    func reload() { Task { await load() } }

    func task(_ id: String) -> NPOTask? { payload?.tasks.first { $0.id == id } }

    /// 状態を変える（変えられない組み合わせはサーバーが断る）
    func move(_ next: String) async {
        guard let d = detail, !busy else { return }
        busy = true
        if NativePreview.current != nil {
            detail?.status = next
            toast = "状態を更新しました"
            busy = false
            return
        }
        do {
            try await NativeModuleAPI.post(["type": "taskStatus", "id": d.id, "next": next])
            toast = "状態を更新しました"
            await load()
            // 絞り込みで一覧から消えた（完了など）。詳細は新しい状態で出しておく
            if task(d.id) == nil { detail?.status = next }
        } catch {
            toast = NativeModuleAPI.message(error)
        }
        busy = false
    }

    /// コメント（引継ぎメモ）を足す。うまくいったら true
    func addComment(_ text: String) async -> Bool {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let d = detail, !busy, !body.isEmpty else { return false }
        busy = true
        defer { busy = false }
        if NativePreview.current != nil {
            detail?.comments.append(NPOTaskComment(by: nil, name: "山田 太郎", at: NPOCFmt.nowISO(), body: body))
            return true
        }
        do {
            try await NativeModuleAPI.post(["type": "taskComment", "id": d.id, "body": body])
            toast = "コメントを追加しました"
            await load()
            if task(d.id) == nil { detail?.comments.append(NPOTaskComment(by: nil, name: nil, at: NPOCFmt.nowISO(), body: body)) }
            return true
        } catch {
            toast = NativeModuleAPI.message(error)
            return false
        }
    }
}

// MARK: - 画面（AppState につなぐ）

struct NativePhoneTasksScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPOTasksModel

    init(route: NativeModuleRoute) {
        _model = StateObject(wrappedValue: NPOTasksModel(route: route))
    }

    var body: some View {
        NativePhoneTasksView(model: model, onBack: { state.closePhoneOwnerModule() })
            .modifier(NPOCWebFallback(key: "tasks", useWeb: model.useWeb, state: state))
    }
}

/// 作成・編集のシート（task が nil なら作成）
struct NPOTaskFormRef: Identifiable {
    let task: NPOTask?
    var id: String { task?.id ?? "new" }
}

struct NativePhoneTasksView: View {
    @ObservedObject var model: NPOTasksModel
    let onBack: () -> Void
    @State private var form: NPOTaskFormRef?

    var body: some View {
        ZStack {
            NPOFrame(title: "タスク・引継ぎ", subtitle: "Tasks", onBack: onBack, trailing: {
                if model.payload?.selectedStoreId != nil {
                    NPOCBarButton(icon: "plus", label: "作成") { form = NPOTaskFormRef(task: nil) }
                }
            }) {
                NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load() }) {
                    if let p = model.payload { list(p) }
                }
            }
            if let t = model.detail {
                NPOTaskDetailView(model: model, task: t, onEdit: { form = NPOTaskFormRef(task: t) })
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.22), value: model.detail?.id)
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .sheet(item: $form) { f in
            NPOTaskForm(
                storeId: f.task?.storeId ?? model.payload?.selectedStoreId ?? "",
                task: f.task,
                staff: model.payload?.staff ?? [],
                onSaved: { message in
                    form = nil
                    model.toast = message
                    model.reload()
                },
                onClose: { form = nil }
            )
        }
    }

    // MARK: 一覧

    @ViewBuilder private func list(_ p: NPOTasksPayload) -> some View {
        if p.stores.isEmpty {
            NPOCEmpty(icon: "building.2", title: "アクセス可能な店舗がありません")
        } else {
            filters(p)
            NPOCSectionTitle(title: "タスク（\(p.tasks.count)件）", note: "店舗内の申し送り・タスクをシンプルに管理します")
            if p.tasks.isEmpty {
                NPOCEmpty(icon: "checklist", title: "該当するタスクはありません",
                          note: p.selectedStoreId != nil ? "右上の「作成」から新しいタスクを登録できます" : "")
            } else {
                ForEach(p.tasks) { t in row(t, multiStore: p.stores.count > 1) }
            }
        }
    }

    private func filters(_ p: NPOTasksPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    NPOCChip(text: "未完了", selected: model.status.isEmpty) { setStatus("") }
                    ForEach(NPOTaskText.statuses, id: \.0) { s in
                        NPOCChip(text: s.1, selected: model.status == s.0) { setStatus(s.0) }
                    }
                }
                .padding(.horizontal, 1)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if p.stores.count > 1 {
                        NPOCMenuChip(label: "店舗", options: [("", "選択してください")] + p.stores.map { ($0.id, $0.name) }, selection: model.store) { v in
                            model.store = v
                            model.assignee = ""
                            model.reload()
                        }
                    }
                    NPOCMenuChip(label: "優先度", options: [("", "すべて")] + NPOTaskText.priorities, selection: model.priority) { v in
                        model.priority = v
                        model.reload()
                    }
                    if !p.staff.isEmpty {
                        NPOCMenuChip(label: "担当", options: [("", "すべて")] + p.staff.map { ($0.id, $0.name) }, selection: model.assignee) { v in
                            model.assignee = v
                            model.reload()
                        }
                    }
                }
                .padding(.horizontal, 1)
            }
        }
    }

    private func setStatus(_ s: String) {
        model.status = s
        model.reload()
    }

    private func row(_ t: NPOTask, multiStore: Bool) -> some View {
        Button { model.detail = t } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Text(t.title).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                        .multilineTextAlignment(.leading).lineLimit(2)
                    Spacer(minLength: 6)
                    NWKBadge(text: NPOTaskText.status(t.status), color: NPOTaskText.statusColor(t.status))
                }
                if let b = t.body, !b.isEmpty {
                    Text(b).font(.system(size: 13.5)).foregroundColor(NT.ink2).lineLimit(2).multilineTextAlignment(.leading)
                }
                WrapLayout(spacing: 10) {
                    NWKBadge(text: "優先度 " + NPOTaskText.priority(t.priority), color: NPOTaskText.priorityColor(t.priority))
                    meta("person", t.assigneeName ?? "未割当")
                    if t.dueDate != nil {
                        meta("calendar", "期限 " + NWKFmt.slash(t.dueDate) + (t.overdue ? "（期限超過）" : ""), color: t.overdue ? NT.danger : NT.ink3)
                    }
                    if multiStore { meta("storefront", t.storeName ?? "—") }
                    if !t.comments.isEmpty { meta("text.bubble", "\(t.comments.count)") }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard())
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.overdue ? NT.danger.opacity(0.35) : Color.clear, lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    private func meta(_ icon: String, _ text: String, color: Color = NT.ink3) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(text).font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
        }
        .foregroundColor(color)
    }
}

// MARK: - 詳細（Web の TaskDetailDialog）

struct NPOTaskDetailView: View {
    @ObservedObject var model: NPOTasksModel
    let task: NPOTask
    let onEdit: () -> Void
    @State private var comment = ""

    var body: some View {
        NPOCDetailFrame(title: "タスク", subtitle: task.storeName ?? "", backLabel: "一覧", onBack: { model.detail = nil }, trailing: {
            NPOCBarButton(icon: "pencil", label: "編集", action: onEdit)
        }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    moves
                    comments
                }
                .padding(14).padding(.bottom, 56)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await model.load() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                NWKBadge(text: NPOTaskText.status(task.status), color: NPOTaskText.statusColor(task.status))
                NWKBadge(text: "優先度: \(NPOTaskText.priority(task.priority))", color: NPOTaskText.priorityColor(task.priority))
                if task.overdue { NWKBadge(text: "期限超過", color: NT.danger) }
            }
            Text(task.title).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 5) {
                info("person", "担当：\(task.assigneeName ?? "未割当")")
                info("calendar", "期限：\(NWKFmt.slash(task.dueDate))", color: task.overdue ? NT.danger : NT.ink3)
                if let s = task.storeName { info("storefront", "店舗：\(s)") }
            }
            if let b = task.body, !b.isEmpty {
                Text(b).font(.system(size: 15)).foregroundColor(NT.ink2).lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
    }

    private func info(_ icon: String, _ text: String, color: Color = NT.ink3) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).frame(width: 16)
            Text(text).font(.system(size: 13.5, weight: .semibold))
        }
        .foregroundColor(color)
    }

    private var moves: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("状態を変える").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).padding(.leading, 4)
            ForEach(Array(NPOTaskText.moves(task.status).enumerated()), id: \.offset) { _, m in
                NPOCWideButton(text: m.label, icon: m.icon, kind: m.kind, disabled: model.busy, height: 48) {
                    Task { await model.move(m.next) }
                }
            }
        }
    }

    private var comments: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("コメント（引継ぎメモ）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).padding(.leading, 4)
            if task.comments.isEmpty {
                Text("まだコメントはありません").font(.system(size: 13)).foregroundColor(NT.ink3).padding(.leading, 4)
            } else {
                ForEach(Array(task.comments.enumerated()), id: \.offset) { _, c in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 6) {
                            Text(c.name ?? "—").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                            Spacer(minLength: 4)
                            Text(NPOCFmt.ago(c.at)).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                        }
                        Text(c.body ?? "").font(.system(size: 15)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(npocCard(12))
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("コメントを追加", text: $comment, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 16))
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                let empty = comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                Button {
                    let text = comment
                    Task { if await model.addComment(text) { comment = "" } }
                } label: {
                    Group {
                        if model.busy { ProgressView().tint(.white) } else { Image(systemName: "paperplane.fill").font(.system(size: 17, weight: .bold)) }
                    }
                    .foregroundColor(.white)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(empty ? NT.ink3.opacity(0.4) : NT.purple))
                }
                .buttonStyle(PressableStyle())
                .disabled(empty || model.busy)
            }
        }
    }
}

// MARK: - 作成・編集（Web の TaskForm）

struct NPOTaskForm: View {
    let storeId: String
    let task: NPOTask?
    let staff: [NPOCOption]
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var title: String
    @State private var bodyText: String
    @State private var assigneeId: String
    @State private var priority: String
    @State private var hasDue: Bool
    @State private var due: String
    @State private var saving = false
    @State private var error: String?

    init(storeId: String, task: NPOTask?, staff: [NPOCOption], onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.storeId = storeId
        self.task = task
        self.staff = staff
        self.onSaved = onSaved
        self.onClose = onClose
        _title = State(initialValue: task?.title ?? "")
        _bodyText = State(initialValue: task?.body ?? "")
        _assigneeId = State(initialValue: task?.assigneeId ?? "")
        _priority = State(initialValue: task?.priority ?? "normal")
        _hasDue = State(initialValue: task?.dueDate != nil)
        _due = State(initialValue: task?.dueDate ?? NPDate.str(Date()))
    }

    /// 担当の選択肢（今の担当が選択肢に無ければ先頭に足す。消えて見えないように）
    private var staffOptions: [NPOCOption] {
        var list = staff
        if let t = task, let a = t.assigneeId, !list.contains(where: { $0.id == a }) {
            list.insert(NPOCOption(id: a, name: t.assigneeName ?? "不明"), at: 0)
        }
        return list
    }

    var body: some View {
        NPOCSheetFrame(title: task == nil ? "タスクを作成" : "タスクを編集",
                       confirmText: saving ? "保存中…" : (task == nil ? "作成する" : "更新する"), busy: saving,
                       onCancel: onClose, onConfirm: { save() }) {
            NPOCField(label: "タイトル") {
                TextField("例：冷蔵庫の温度チェック", text: $title).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "内容") {
                TextField("内容・申し送り", text: $bodyText, axis: .vertical).lineLimit(4...10).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "優先度") {
                Picker("優先度", selection: $priority) {
                    Text("低").tag("low")
                    Text("中").tag("normal")
                    Text("高").tag("high")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            NPOCField(label: "担当・期限") {
                VStack(spacing: 0) {
                    HStack {
                        Text("担当").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                        Spacer(minLength: 8)
                        Picker("担当", selection: $assigneeId) {
                            Text("未割当").tag("")
                            ForEach(staffOptions) { s in Text(s.name).tag(s.id) }
                        }
                        .pickerStyle(.menu)
                        .tint(NT.purple)
                    }
                    .npocRow()
                    Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
                    Toggle(isOn: $hasDue) {
                        Text("期限を付ける").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                    }
                    .tint(NT.purple)
                    .npocRow()
                    if hasDue {
                        DatePicker("期限", selection: Binding(get: { NPDate.date(due) }, set: { due = NPDate.str($0) }), displayedComponents: .date)
                            .font(.system(size: 15))
                            .foregroundColor(NT.ink2)
                            .npocRow()
                    }
                }
                .background(npocCard(12))
            }
            if let error {
                Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).padding(.horizontal, 4)
            }
        }
    }

    private func save() {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "タイトルを入力してください"
            return
        }
        guard !storeId.isEmpty else {
            error = "店舗を選んでください"
            return
        }
        var payload: [String: Any] = [
            "type": "taskSave",
            "storeId": storeId,
            "title": title,
            "body": bodyText,
            "assigneeId": NWKFmt.orNull(assigneeId),
            "dueDate": NWKFmt.orNull(hasDue ? due : nil),
            "priority": priority,
        ]
        if let task { payload["id"] = task.id }
        let isNew = task == nil
        if NativePreview.current != nil {
            onSaved(isNew ? "タスクを作成しました" : "タスクを更新しました")
            return
        }
        saving = true
        error = nil
        Task {
            do {
                try await NativeModuleAPI.post(payload)
                saving = false
                onSaved(isNew ? "タスクを作成しました" : "タスクを更新しました")
            } catch {
                saving = false
                self.error = NativeModuleAPI.message(error)
            }
        }
    }
}
