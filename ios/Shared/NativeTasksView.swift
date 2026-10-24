import SwiftUI

// タスク・引継ぎのネイティブ。Web の /app/tasks と同じ中身・同じ操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   一覧（既定は未完了）・絞り込み（店舗・状態・優先度・担当）・タスクを作成・編集（タイトル・内容・担当・優先度・期限）
//   詳細：状態を変える（未着手→対応中→完了／取消・戻す）・コメント（引継ぎメモ）を足す
// サーバーは lib/native-modules/tasks.ts（読み込みは Web と同じ lib/tasks-server.ts、操作は Web と同じ Server Action）。

// MARK: - 中身（サーバーの返事）

struct NTKOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

/// コメント（引継ぎメモ）。古いデータで欠けていても画面ごと落ちないように全部 optional
struct NTKComment: Decodable, Hashable {
    let by: String?
    let name: String?
    let at: String?
    let body: String?
}

struct NTKTask: Decodable, Hashable, Identifiable {
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
    var comments: [NTKComment]
}

struct NTKPayload: Decodable {
    let ok: Bool
    let today: String
    let stores: [NTKOption]
    /// タスクを作る店舗（今の店舗か選んだ店舗。無ければ作れない）
    let selectedStoreId: String?
    let status: String?
    let priority: String?
    let assignee: String?
    /// 担当者の選択肢（選んでいる店舗の有効なメンバー）
    let staff: [NTKOption]
    let tasks: [NTKTask]
}

/// 名前・色（Web の STATUS_LABEL・STATUS_TONE・PRIORITY_LABEL と同じ）
enum NTKText {
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
    static func moves(_ s: String) -> [(next: String, label: String, kind: NWKButton.Kind)] {
        switch s {
        case "open":
            return [("in_progress", "対応中にする", .primary), ("cancelled", "取消にする", .danger)]
        case "in_progress":
            return [("done", "完了にする", .success), ("open", "未着手に戻す", .secondary), ("cancelled", "取消にする", .danger)]
        case "done", "cancelled":
            return [("open", "未着手に戻す", .secondary)]
        default:
            return []
        }
    }
}

// MARK: - 読み込み

@MainActor
final class NTKModel: ObservableObject {
    @Published var payload: NTKPayload?
    @Published var error: String?
    @Published var toast: String?

    // 絞り込み（Web のフォームと同じ。サーバーが決めた値を読み込みのたびに入れ直す）
    @Published var store: String
    @Published var status: String
    @Published var priority: String
    @Published var assignee: String

    init(route: NativeModuleRoute) {
        store = route.query("store") ?? ""
        status = route.query("status") ?? ""
        priority = route.query("priority") ?? ""
        assignee = route.query("assignee") ?? ""
        payload = NativeModuleAPI.cached(NTKPayload.self, part: "tasks", query: query())
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
        do {
            let p = try await NativeModuleAPI.get(NTKPayload.self, part: "tasks", query: query())
            payload = p
            store = p.selectedStoreId ?? ""
            status = p.status ?? ""
            priority = p.priority ?? ""
            assignee = p.assignee ?? ""
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func task(_ id: String) -> NTKTask? { payload?.tasks.first { $0.id == id } }
}

/// 出しているシート（詳細／作成・編集）
enum NTKSheet: Identifiable {
    case detail(NTKTask)
    case form(NTKTask?)

    var id: String {
        switch self {
        case .detail(let t): return "detail-" + t.id
        case .form(let t): return "form-" + (t?.id ?? "new")
        }
    }
}

// MARK: - 画面

struct NativeTasksView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    @StateObject private var model: NTKModel
    @State private var sheet: NTKSheet?

    init(route: NativeModuleRoute, onHome: @escaping () -> Void) {
        self.route = route
        self.onHome = onHome
        _model = StateObject(wrappedValue: NTKModel(route: route))
    }

    var body: some View {
        NWKPage(title: "タスク・引継ぎ", onHome: onHome, loaded: model.payload != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload {
                if p.stores.isEmpty {
                    NWKCard(title: "タスク・引継ぎ") { NWKEmpty(title: "アクセス可能な店舗がありません") }
                } else {
                    filters(p)
                    listCard(p)
                }
            }
        }
        .task { await model.load() }
        .sheet(item: $sheet) { s in sheetView(s) }
    }

    @ViewBuilder private func sheetView(_ s: NTKSheet) -> some View {
        switch s {
        case .detail(let t):
            NTKDetailSheet(model: model, task: t) { sheet = nil }
        case .form(let t):
            NTKFormSheet(
                storeId: t?.storeId ?? model.payload?.selectedStoreId ?? "",
                task: t,
                staff: model.payload?.staff ?? [],
                onSaved: { message in
                    sheet = nil
                    model.toast = message
                    Task { await model.load() }
                },
                onClose: { sheet = nil }
            )
        }
    }

    private func reload() {
        Task { await model.load() }
    }

    // MARK: 絞り込み・作成

    private func filters(_ p: NTKPayload) -> some View {
        HStack(alignment: .top, spacing: 12) {
            WrapLayout(spacing: 10) {
                if p.stores.count > 1 {
                    NWKMenu(label: "店舗", options: [("", "選択してください")] + p.stores.map { ($0.id, $0.name) }, selection: model.store) {
                        model.store = $0
                        model.assignee = ""
                        reload()
                    }
                }
                NWKMenu(label: "状態", options: [("", "未完了（既定）")] + NTKText.statuses, selection: model.status) {
                    model.status = $0
                    reload()
                }
                NWKMenu(label: "優先度", options: [("", "すべて")] + NTKText.priorities, selection: model.priority) {
                    model.priority = $0
                    reload()
                }
                if !p.staff.isEmpty {
                    NWKMenu(label: "担当", options: [("", "すべて")] + p.staff.map { ($0.id, $0.name) }, selection: model.assignee) {
                        model.assignee = $0
                        reload()
                    }
                }
            }
            Spacer(minLength: 8)
            if p.selectedStoreId != nil {
                NWKButton(text: "タスクを作成", icon: "plus", kind: .primary, height: 44) { sheet = .form(nil) }
            }
        }
    }

    // MARK: 一覧

    private func listCard(_ p: NTKPayload) -> some View {
        NWKCard(title: "タスク（\(p.tasks.count)件）", note: "店舗内の申し送り・タスクをシンプルに管理します") {
            if p.tasks.isEmpty {
                NWKEmpty(title: "該当するタスクはありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(p.tasks) { t in
                        if t.id != p.tasks.first?.id { NWKDivider() }
                        row(t, multiStore: p.stores.count > 1)
                    }
                }
            }
        }
    }

    private func row(_ t: NTKTask, multiStore: Bool) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Button { sheet = .detail(t) } label: {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t.title).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        HStack(spacing: 12) {
                            if multiStore { Text(t.storeName ?? "—") }
                            Text("担当 " + (t.assigneeName ?? "未割当"))
                            dueText(t)
                            if !t.comments.isEmpty {
                                HStack(spacing: 3) {
                                    Image(systemName: "text.bubble")
                                    Text("\(t.comments.count)")
                                }
                            }
                        }
                        .font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    NWKBadge(text: NTKText.priority(t.priority), color: NTKText.priorityColor(t.priority))
                    NWKBadge(text: NTKText.status(t.status), color: NTKText.statusColor(t.status))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.99))
            NWKButton(text: "詳細", icon: "text.bubble") { sheet = .detail(t) }
            NWKButton(text: "編集", icon: "pencil") { sheet = .form(t) }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
    }

    @ViewBuilder private func dueText(_ t: NTKTask) -> some View {
        if t.overdue {
            Text("期限 \(NWKFmt.slash(t.dueDate)) 期限超過").fontWeight(.bold).foregroundColor(NT.danger)
        } else {
            Text("期限 \(NWKFmt.slash(t.dueDate))")
        }
    }
}

// MARK: - 詳細（Web の TaskDetailDialog）

struct NTKDetailSheet: View {
    @ObservedObject var model: NTKModel
    let onClose: () -> Void
    @State private var task: NTKTask
    @State private var comment = ""
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?

    init(model: NTKModel, task: NTKTask, onClose: @escaping () -> Void) {
        _model = ObservedObject(wrappedValue: model)
        self.onClose = onClose
        _task = State(initialValue: task)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    WrapLayout(spacing: 8) {
                        NWKBadge(text: NTKText.status(task.status), color: NTKText.statusColor(task.status))
                        NWKBadge(text: "優先度: \(NTKText.priority(task.priority))", color: task.priority == "high" ? NT.danger : NT.ink3)
                        if let d = task.dueDate {
                            Text("期限: \(NWKFmt.slash(d))").font(.system(size: 13, weight: .semibold)).foregroundColor(task.overdue ? NT.danger : NT.ink3)
                        }
                        if let a = task.assigneeName {
                            Text("担当: \(a)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                        }
                    }
                    if let b = task.body, !b.isEmpty {
                        Text(b).font(.system(size: 15)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    }
                    moves
                    comments
                    if let notice {
                        Text(notice).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ok)
                    }
                    if let error {
                        Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(20)
            }
            .background(NT.page.ignoresSafeArea())
            .navigationTitle(task.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose).disabled(busy) }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private var moves: some View {
        WrapLayout(spacing: 10) {
            ForEach(Array(NTKText.moves(task.status).enumerated()), id: \.offset) { _, m in
                NWKButton(text: m.label, kind: m.kind, disabled: busy, height: 46) {
                    Task { await move(m.next) }
                }
            }
        }
    }

    private var comments: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("コメント（引継ぎメモ）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            if task.comments.isEmpty {
                Text("まだコメントはありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(task.comments.enumerated()), id: \.offset) { _, c in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(c.body ?? "").font(.system(size: 15)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                            Text("\(c.name ?? "")　\(NWKFmt.dateTime(c.at))").font(.system(size: 12)).foregroundColor(NT.ink3)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    }
                }
            }
            TextField("コメントを追加", text: $comment, axis: .vertical)
                .lineLimit(2...6)
                .font(.system(size: 16))
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
            HStack {
                Spacer()
                NWKButton(
                    text: "コメントする", icon: "paperplane", kind: .primary,
                    busy: busy,
                    disabled: comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    height: 46
                ) {
                    Task { await sendComment() }
                }
            }
        }
    }

    /// 状態を変える（変えられない組み合わせはサーバーが断る）
    @MainActor private func move(_ next: String) async {
        busy = true
        error = nil
        notice = nil
        do {
            try await NativeModuleAPI.post(["type": "taskStatus", "id": task.id, "next": next])
            await model.load()
            if let fresh = model.task(task.id) {
                task = fresh
            } else {
                // 絞り込みで一覧から消えた（完了など）。この画面は新しい状態で出しておく
                var changed = task
                changed.status = next
                task = changed
            }
            notice = "状態を更新しました"
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
        busy = false
    }

    @MainActor private func sendComment() async {
        guard !comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        busy = true
        error = nil
        notice = nil
        do {
            try await NativeModuleAPI.post(["type": "taskComment", "id": task.id, "body": comment])
            comment = ""
            await model.load()
            if let fresh = model.task(task.id) { task = fresh }
            notice = "コメントを追加しました"
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
        busy = false
    }
}

// MARK: - 作成・編集（Web の TaskForm）

struct NTKFormSheet: View {
    let storeId: String
    let task: NTKTask?
    let staff: [NTKOption]
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

    init(storeId: String, task: NTKTask?, staff: [NTKOption], onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
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
    private var staffOptions: [NTKOption] {
        var list = staff
        if let t = task, let a = t.assigneeId, !list.contains(where: { $0.id == a }) {
            list.insert(NTKOption(id: a, name: t.assigneeName ?? "不明"), at: 0)
        }
        return list
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("タイトル") {
                    TextField("タイトル", text: $title)
                }
                Section("内容") {
                    TextField("内容", text: $bodyText, axis: .vertical).lineLimit(4...10)
                }
                Section {
                    Picker("担当", selection: $assigneeId) {
                        Text("未割当").tag("")
                        ForEach(staffOptions) { s in Text(s.name).tag(s.id) }
                    }
                    HStack(spacing: 16) {
                        Text("優先度")
                        Picker("優先度", selection: $priority) {
                            Text("低").tag("low")
                            Text("中").tag("normal")
                            Text("高").tag("high")
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    Toggle("期限を付ける", isOn: $hasDue)
                    if hasDue {
                        DatePicker("期限", selection: Binding(get: { NPDate.date(due) }, set: { due = NPDate.str($0) }), displayedComponents: .date)
                    }
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle(task == nil ? "タスクを作成" : "タスクを編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中…" : (task == nil ? "作成する" : "更新する")) { save() }.disabled(saving)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .environment(\.locale, Locale(identifier: "ja_JP"))
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
