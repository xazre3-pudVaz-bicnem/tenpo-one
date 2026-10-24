import SwiftUI

// iPhone の店長・オーナー：通知（ネイティブ）。Web の /app/notifications と同じ中身（2026-10-25 Ronnie「iPhone も native に」）
//   あなた宛の通知（新しい順・最新100件）／ 状態（すべて・未読・既読）・種別・店舗で絞り込み ／ すべて既読にする
//   行を押すと既読にして、リンクがあればその画面へ（ネイティブがあればネイティブ）／ 長押しで「既読にする」
//   表示設定（種別ごとに隠す。この端末のみ。iPad・Web と同じ考え方）
// サーバーは iPad と同じ：GET part=notices ／ POST noticeRead・noticeReadAll（app/api/app/v1/pos/route.ts・lib/native-notices-server.ts）

private let npoNoticeHiddenKey = "tenpo_notification_hidden_types_v1"

struct NPONotice: Decodable, Identifiable, Hashable {
    let id: String
    let type: String
    let typeLabel: String?
    let title: String
    let body: String?
    let link: String?
    /// nil＝未読
    var readAt: String?
    let createdAt: String
}

struct NPONoticesPayload: Decodable {
    let stores: [NPOCOption]?
    let typeOptions: [NPOCKeyLabel]?
    var items: [NPONotice]
}

// MARK: - 読み込み・操作

@MainActor
final class NPONoticesModel: ObservableObject {
    @Published var payload: NPONoticesPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    /// サーバーが「Web で開いて」と言った（権限・機能が無いなど）→ Web の画面のまま見せる
    @Published var useWeb = false

    // 絞り込み（Web のフォームと同じ。空＝すべて）
    @Published var type: String
    @Published var store: String
    @Published var status: String

    private var generation = 0

    init(route: NativeModuleRoute) {
        type = route.query("type") ?? ""
        store = route.query("store") ?? ""
        let s = route.query("status") ?? ""
        status = (s == "unread" || s == "read") ? s : ""
        // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す）
        payload = NativeModuleAPI.cached(NPONoticesPayload.self, part: "notices", query: query())
    }

    func query() -> [String: String] {
        ["type": type, "store": store, "status": status]
    }

    func load() async {
        if NativePreview.current != nil { return }
        generation += 1
        let mine = generation
        do {
            let p = try await NativeModuleAPI.get(NPONoticesPayload.self, part: "notices", query: query())
            guard mine == generation else { return }
            payload = p
            error = nil
        } catch {
            guard mine == generation else { return }
            // 最初から読めない（権限・ログイン・回線）ときは Web の画面（オーナーのホームと同じ）
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    func setFilter(type: String? = nil, store: String? = nil, status: String? = nil) {
        if let type { self.type = type }
        if let store { self.store = store }
        if let status { self.status = status }
        Task { await load() }
    }

    var unreadCount: Int { payload?.items.filter { $0.readAt == nil }.count ?? 0 }

    /// 既読にする（先に画面を既読にしてから送る）
    func markRead(_ id: String) async {
        guard let i = payload?.items.firstIndex(where: { $0.id == id }), payload?.items[i].readAt == nil else { return }
        payload?.items[i].readAt = NPOCFmt.nowISO()
        if NativePreview.current != nil { return }
        do {
            try await NativeModuleAPI.post(["type": "noticeRead", "id": id])
            // 「未読」で絞っているときは一覧から外す
            if status == "unread" { await load() }
        } catch {
            toast = NativeModuleAPI.message(error)
            await load()
        }
    }

    func markAllRead() async {
        guard !busy, var p = payload else { return }
        busy = true
        let now = NPOCFmt.nowISO()
        for i in p.items.indices where p.items[i].readAt == nil { p.items[i].readAt = now }
        payload = p
        if NativePreview.current != nil {
            toast = "すべて既読にしました"
            busy = false
            return
        }
        do {
            try await NativeModuleAPI.post(["type": "noticeReadAll"])
            toast = "すべて既読にしました"
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
            await load()
        }
        busy = false
    }
}

// MARK: - 画面（AppState につなぐ）

struct NativePhoneNotificationsScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPONoticesModel

    init(route: NativeModuleRoute) {
        _model = StateObject(wrappedValue: NPONoticesModel(route: route))
    }

    var body: some View {
        NativePhoneNotificationsView(
            model: model,
            onBack: { state.closePhoneOwnerModule() },
            onLink: { link in NPOCLink.open(link, state: state) }
        )
        .modifier(NPOCWebFallback(key: "notifications", useWeb: model.useWeb, state: state))
    }
}

struct NativePhoneNotificationsView: View {
    @ObservedObject var model: NPONoticesModel
    let onBack: () -> Void
    let onLink: (String) -> Void

    @State private var hidden: Set<String> = Set(UserDefaults.standard.stringArray(forKey: npoNoticeHiddenKey) ?? [])
    @State private var showSettings = false

    var body: some View {
        NPOFrame(title: "通知", subtitle: "Notifications", onBack: onBack, trailing: {
            if !(model.payload?.typeOptions ?? []).isEmpty {
                NPOCBarButton(icon: "slider.horizontal.3") { showSettings = true }
            }
        }) {
            NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load() }) {
                if let p = model.payload { list(p) }
            }
        }
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .sheet(isPresented: $showSettings) { settingsSheet }
    }

    // MARK: 一覧

    @ViewBuilder private func list(_ p: NPONoticesPayload) -> some View {
        let visible = p.items.filter { !hidden.contains($0.type) }
        let unread = model.unreadCount
        filters(p)
        HStack(alignment: .center, spacing: 8) {
            Text(unread > 0 ? "未読 \(unread)件" : "あなた宛の通知（新しい順・最新100件）")
                .font(.system(size: 13, weight: unread > 0 ? .bold : .regular))
                .foregroundColor(unread > 0 ? NT.purpleDeep : NT.ink3)
            Spacer(minLength: 6)
            if unread > 0 {
                Button { Task { await model.markAllRead() } } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "checkmark.circle")
                        Text("すべて既読にする")
                    }
                    .font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.purple)
                    .padding(.horizontal, 13).frame(height: 36)
                    .background(Capsule().fill(Color.white))
                    .overlay(Capsule().stroke(NT.lilacLine, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(model.busy)
            }
        }
        .padding(.horizontal, 2)
        if visible.isEmpty {
            NPOCEmpty(icon: "bell.slash", title: "表示する通知がありません",
                      note: hidden.isEmpty ? "" : "表示設定で一部の種別が非表示になっています")
        } else {
            VStack(spacing: 0) {
                ForEach(visible) { n in
                    if n.id != visible.first?.id { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 62) }
                    row(n)
                }
            }
            .background(npocCard())
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func filters(_ p: NPONoticesPayload) -> some View {
        let types = p.typeOptions ?? []
        let stores = p.stores ?? []
        return VStack(alignment: .leading, spacing: 10) {
            Picker("状態", selection: Binding(get: { model.status }, set: { model.setFilter(status: $0) })) {
                Text("すべて").tag("")
                Text("未読").tag("unread")
                Text("既読").tag("read")
            }
            .pickerStyle(.segmented)
            if types.count > 1 || stores.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if types.count > 1 {
                            NPOCMenuChip(label: "種別", options: [("", "すべて")] + types.map { ($0.key, $0.label) }, selection: model.type) { model.setFilter(type: $0) }
                        }
                        if stores.count > 1 {
                            NPOCMenuChip(label: "店舗", options: [("", "すべて")] + stores.map { ($0.id, $0.name) }, selection: model.store) { model.setFilter(store: $0) }
                        }
                    }
                    .padding(.horizontal, 1)
                }
            }
        }
    }

    private func row(_ n: NPONotice) -> some View {
        let unread = n.readAt == nil
        let link = (n.link ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return Button {
            Task { await model.markRead(n.id) }
            if !link.isEmpty { onLink(link) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().fill(unread ? NT.lilac : NT.page).frame(width: 36, height: 36)
                    Image(systemName: unread ? "bell.badge.fill" : "bell")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(unread ? NT.purple : NT.ink3)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(n.title)
                        .font(.system(size: 15.5, weight: unread ? .heavy : .semibold))
                        .foregroundColor(unread ? NT.ink : NT.ink2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if let b = n.body, !b.isEmpty {
                        Text(b).font(.system(size: 13.5)).foregroundColor(NT.ink2).lineLimit(3).multilineTextAlignment(.leading)
                    }
                    HStack(spacing: 8) {
                        Text(NPOCFmt.ago(n.createdAt)).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                        if let t = n.typeLabel, !t.isEmpty { NWKBadge(text: t, color: NT.ink3) }
                    }
                }
                Spacer(minLength: 4)
                VStack(spacing: 10) {
                    if unread { Circle().fill(NT.purple).frame(width: 9, height: 9) }
                    if !link.isEmpty { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3) }
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(unread ? NT.lilac.opacity(0.45) : Color.white)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.99))
        .contextMenu {
            if unread {
                Button { Task { await model.markRead(n.id) } } label: { Label("既読にする", systemImage: "checkmark.circle") }
            }
            if !link.isEmpty {
                Button { onLink(link) } label: { Label("開く", systemImage: "arrow.up.forward.app") }
            }
        }
    }

    // MARK: 表示設定（この端末のみ）

    private var settingsSheet: some View {
        let types = model.payload?.typeOptions ?? []
        return NPOCSheetFrame(title: "通知の表示設定", cancelText: "閉じる", onCancel: { showSettings = false }, onConfirm: nil) {
            VStack(spacing: 0) {
                ForEach(types, id: \.key) { t in
                    if t.key != types.first?.key { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14) }
                    Toggle(isOn: Binding(get: { !hidden.contains(t.key) }, set: { on in
                        if on { hidden.remove(t.key) } else { hidden.insert(t.key) }
                        UserDefaults.standard.set(Array(hidden), forKey: npoNoticeHiddenKey)
                    })) {
                        Text(t.label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                    }
                    .tint(NT.purple)
                    .npocRow()
                }
            }
            .background(npocCard())
            Text("この端末でのみ有効な表示設定です。種別ごとに通知の受信自体をON/OFFする配信設定は今後対応予定です。")
                .font(.system(size: 12)).foregroundColor(NT.ink3).padding(.horizontal, 4)
        }
        .presentationDetents([.medium, .large])
    }
}
