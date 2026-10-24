import SwiftUI

// iPhone の店長・オーナー：お知らせ（ネイティブ）。Web の /app/announcements と同じ中身（2026-10-25 Ronnie「iPhone も native に」）
//   本社・店舗からの連絡事項（公開期間内が上位・重要は強調表示）／ 押すと詳細（開封済みにする）
//   お知らせを作成（店長・本社。全店舗あては本社だけ）／ 削除（作れる人。全店舗あては本社だけ）
// サーバーは iPad と同じ：GET part=announcements ／ POST annRead・annCreate・annDelete（app/api/app/v1/pos/route.ts・lib/native-notices-server.ts）

struct NPOAnnItem: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let body: String
    let isImportant: Bool
    let storeLabel: String
    let publishFrom: String?
    let publishTo: String?
    let createdAt: String
    var isRead: Bool
    let canDelete: Bool
}

struct NPOAnnPayload: Decodable {
    let canWrite: Bool
    let canTargetAllStores: Bool
    /// お知らせを作る店舗（作れないときは nil）
    let targetStore: NPOCOption?
    var items: [NPOAnnItem]
}

// MARK: - 読み込み・操作

@MainActor
final class NPOAnnModel: ObservableObject {
    @Published var payload: NPOAnnPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いているお知らせ
    @Published var openId: String?

    init() {
        payload = NativeModuleAPI.cached(NPOAnnPayload.self, part: "announcements")
    }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            let p = try await NativeModuleAPI.get(NPOAnnPayload.self, part: "announcements")
            payload = p
            error = nil
            // 開いていたお知らせが消えていたら（ほかの人が削除）閉じる
            if let id = openId, !p.items.contains(where: { $0.id == id }) { openId = nil }
        } catch {
            // 最初から読めない（権限・ログイン・回線）ときは Web の画面（オーナーのホームと同じ）
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    var unreadCount: Int { payload?.items.filter { !$0.isRead }.count ?? 0 }

    func item(_ id: String?) -> NPOAnnItem? {
        guard let id else { return nil }
        return payload?.items.first { $0.id == id }
    }

    /// 詳細を開く（未読なら開封済みにする。Web と同じく開いたら既読）
    func open(_ a: NPOAnnItem) {
        openId = a.id
        guard !a.isRead else { return }
        if let i = payload?.items.firstIndex(where: { $0.id == a.id }) { payload?.items[i].isRead = true }
        if NativePreview.current != nil { return }
        let id = a.id
        Task { _ = try? await NativeModuleAPI.post(["type": "annRead", "id": id]) }
    }

    func delete(_ id: String) async {
        guard !busy else { return }
        busy = true
        if NativePreview.current != nil {
            payload?.items.removeAll { $0.id == id }
            openId = nil
            toast = "お知らせを削除しました"
            busy = false
            return
        }
        do {
            try await NativeModuleAPI.post(["type": "annDelete", "id": id])
            openId = nil
            toast = "お知らせを削除しました"
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
        busy = false
    }

    /// 作成。うまくいかなければそのことば
    func create(_ body: [String: Any]) async -> String? {
        busy = true
        defer { busy = false }
        if NativePreview.current != nil { toast = "お知らせを作成しました"; return nil }
        do {
            try await NativeModuleAPI.post(body)
            toast = "お知らせを作成しました"
            await load()
            return nil
        } catch {
            return NativeModuleAPI.message(error)
        }
    }
}

// MARK: - 画面（AppState につなぐ）

struct NativePhoneAnnouncementsScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model = NPOAnnModel()

    init(route: NativeModuleRoute) {}

    var body: some View {
        NativePhoneAnnouncementsView(
            model: model,
            onBack: { state.closePhoneOwnerModule() },
            onLink: { link in NPOCLink.open(link, state: state) }
        )
        .modifier(NPOCWebFallback(key: "announcements", useWeb: model.useWeb, state: state))
    }
}

struct NativePhoneAnnouncementsView: View {
    @ObservedObject var model: NPOAnnModel
    let onBack: () -> Void
    let onLink: (String) -> Void

    @State private var showCreate = false

    var body: some View {
        ZStack {
            NPOFrame(title: "お知らせ", subtitle: "Announcements", onBack: onBack, trailing: {
                if let p = model.payload, p.canWrite, p.targetStore != nil {
                    NPOCBarButton(icon: "plus", label: "作成") { showCreate = true }
                }
            }) {
                NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load() }) {
                    if let p = model.payload { list(p) }
                }
            }
            if let a = model.item(model.openId) {
                NPOAnnDetailView(model: model, item: a)
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.22), value: model.openId)
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .sheet(isPresented: $showCreate) {
            if let p = model.payload, let s = p.targetStore {
                NPOAnnForm(storeName: s.name, canTargetAllStores: p.canTargetAllStores, model: model) { showCreate = false }
            }
        }
    }

    @ViewBuilder private func list(_ p: NPOAnnPayload) -> some View {
        let unread = model.unreadCount
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("本社・店舗からの連絡事項").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                Text(unread > 0 ? "未読 \(unread)件" : "すべて開封済み").font(.system(size: 12, weight: .semibold))
                    .foregroundColor(unread > 0 ? NT.purpleDeep : NT.ink3)
            }
            Spacer(minLength: 6)
            Button { onLink("/app/notifications") } label: {
                HStack(spacing: 5) {
                    Image(systemName: "bell")
                    Text("通知")
                }
                .font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink2)
                .padding(.horizontal, 13).frame(height: 36)
                .background(Capsule().fill(Color.white))
                .overlay(Capsule().stroke(NT.line, lineWidth: 1))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, 2)
        if p.items.isEmpty {
            NPOCEmpty(icon: "megaphone", title: "お知らせはありません")
        } else {
            ForEach(p.items) { a in row(a) }
        }
    }

    private func row(_ a: NPOAnnItem) -> some View {
        Button { model.open(a) } label: {
            VStack(alignment: .leading, spacing: 7) {
                if a.isImportant || !a.isRead {
                    HStack(spacing: 6) {
                        if a.isImportant { NWKBadge(text: "⚠︎ 重要", color: NT.danger) }
                        if !a.isRead { NWKBadge(text: "未読", color: NT.purple) }
                    }
                }
                HStack(alignment: .top, spacing: 8) {
                    Text(a.title).font(.system(size: 16, weight: a.isRead ? .bold : .heavy)).foregroundColor(NT.ink)
                        .multilineTextAlignment(.leading).lineLimit(2)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).padding(.top, 4)
                }
                Text(a.body).font(.system(size: 13.5)).foregroundColor(NT.ink2).lineLimit(2).multilineTextAlignment(.leading)
                Text(NPOAnnText.meta(a)).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(2)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(a.isImportant ? NPOAnnText.importantBg : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(a.isImportant ? NT.danger.opacity(0.25) : Color.clear, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }
}

enum NPOAnnText {
    static let importantBg = Color(hex: 0xFFF8EC)

    /// 新宿店｜2026/10/25（｜公開: 2026/10/25 〜 2026/10/31）
    static func meta(_ a: NPOAnnItem) -> String {
        var s = "\(a.storeLabel)｜\(NPOCFmt.day(a.createdAt))"
        if let p = period(a) { s += "｜公開: \(p)" }
        return s
    }

    static func period(_ a: NPOAnnItem) -> String? {
        guard a.publishFrom != nil || a.publishTo != nil else { return nil }
        return "\(a.publishFrom.map(NPDate.slash) ?? "—") 〜 \(a.publishTo.map(NPDate.slash) ?? "—")"
    }
}

// MARK: - 詳細

struct NPOAnnDetailView: View {
    @ObservedObject var model: NPOAnnModel
    let item: NPOAnnItem
    @State private var confirmDelete = false

    var body: some View {
        NPOCDetailFrame(title: "お知らせ", subtitle: item.storeLabel, backLabel: "一覧", onBack: { model.openId = nil }, trailing: { EmptyView() }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 10) {
                        if item.isImportant { NWKBadge(text: "⚠︎ 重要", color: NT.danger) }
                        Text(item.title).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        VStack(alignment: .leading, spacing: 4) {
                            metaLine("building.2", "対象：\(item.storeLabel)")
                            metaLine("calendar", "作成：\(NPOCFmt.dateTime(item.createdAt))")
                            if let p = NPOAnnText.period(item) { metaLine("clock", "公開：\(p)") }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(item.isImportant ? NPOAnnText.importantBg : Color.white))
                    Text(item.body).font(.system(size: 16)).foregroundColor(NT.ink).lineSpacing(4)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(npocCard())
                    if item.canDelete {
                        NPOCWideButton(text: "このお知らせを削除する", icon: "trash", kind: .danger, busy: model.busy) { confirmDelete = true }
                            .padding(.top, 8)
                    }
                }
                .padding(14).padding(.bottom, 40)
            }
        }
        .confirmationDialog("お知らせを削除", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("削除する", role: .destructive) { Task { await model.delete(item.id) } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("このお知らせを削除します。よろしいですか？")
        }
    }

    private func metaLine(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).frame(width: 16)
            Text(text).font(.system(size: 13))
        }
        .foregroundColor(NT.ink3)
    }
}

// MARK: - 作成（Web の AnnouncementForm）

struct NPOAnnForm: View {
    let storeName: String
    let canTargetAllStores: Bool
    @ObservedObject var model: NPOAnnModel
    let onClose: () -> Void

    @State private var title = ""
    @State private var bodyText = ""
    @State private var useFrom = false
    @State private var useTo = false
    @State private var from = Date()
    @State private var to = Date()
    @State private var allStores = false
    @State private var important = false
    @State private var localError: String?

    var body: some View {
        NPOCSheetFrame(title: "お知らせを作成", confirmText: model.busy ? "作成中…" : "作成する", busy: model.busy,
                       onCancel: onClose, onConfirm: { Task { await submit() } }) {
            NPOCField(label: "タイトル") {
                TextField("例：年末年始の営業時間について", text: $title).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "本文") {
                TextField("連絡事項を入力", text: $bodyText, axis: .vertical).lineLimit(5...14).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "公開期間（任意）") {
                VStack(spacing: 0) {
                    toggleRow("公開開始日を決める", isOn: $useFrom)
                    if useFrom { dateRow("公開開始日", selection: $from) }
                    Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
                    toggleRow("公開終了日を決める", isOn: $useTo)
                    if useTo { dateRow("公開終了日", selection: $to) }
                }
                .background(npocCard(12))
            }
            NPOCField(label: "対象・表示") {
                VStack(spacing: 0) {
                    HStack {
                        Text("対象").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                        Spacer(minLength: 8)
                        if canTargetAllStores {
                            Picker("対象", selection: $allStores) {
                                Text("\(storeName)のみ").tag(false)
                                Text("全店舗").tag(true)
                            }
                            .pickerStyle(.menu)
                            .tint(NT.purple)
                        } else {
                            Text("\(storeName)のみ").font(.system(size: 15)).foregroundColor(NT.ink3)
                        }
                    }
                    .npocRow()
                    Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
                    toggleRow("重要（強調表示）", isOn: $important)
                }
                .background(npocCard(12))
            }
            if let localError {
                Text(localError).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).padding(.horizontal, 4)
            }
        }
    }

    private func toggleRow(_ text: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            Text(text).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
        }
        .tint(NT.purple)
        .npocRow()
    }

    private func dateRow(_ text: String, selection: Binding<Date>) -> some View {
        DatePicker(text, selection: selection, displayedComponents: .date)
            .font(.system(size: 15))
            .foregroundColor(NT.ink2)
            .npocRow()
    }

    @MainActor private func submit() async {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = bodyText.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { localError = "タイトルを入力してください"; return }
        if b.isEmpty { localError = "本文を入力してください"; return }
        if useFrom && useTo && NPDate.str(to) < NPDate.str(from) { localError = "公開終了日は公開開始日以降にしてください"; return }
        localError = nil
        let payload: [String: Any] = [
            "type": "annCreate",
            "title": t,
            "body": b,
            "isImportant": important,
            "publishFrom": NWKFmt.orNull(useFrom ? NPDate.str(from) : nil),
            "publishTo": NWKFmt.orNull(useTo ? NPDate.str(to) : nil),
            "allStores": canTargetAllStores && allStores,
        ]
        if let e = await model.create(payload) { localError = e } else { onClose() }
    }
}
