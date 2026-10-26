import SwiftUI

// お知らせ（ネイティブ）。Web の /app/announcements と同じ（2026-10-24）
//   本社・店舗からの連絡事項（公開期間内が上位・重要は強調表示）／ 開くと開封済み ／ お知らせを作成・削除する（店長・本社）

struct NAItem: Codable, Identifiable {
    let id: String; let title: String; let body: String; let isImportant: Bool; let storeLabel: String
    let publishFrom: String?; let publishTo: String?; let createdAt: String; let isRead: Bool; let canDelete: Bool
}
struct NAPayload: Codable { let canWrite: Bool; let canTargetAllStores: Bool; let targetStore: NFNamed?; let items: [NAItem] }

@MainActor
final class NativeAnnouncementsModel: ObservableObject {
    @Published var payload: NAPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "announcements")]
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NAPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NAPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    @discardableResult
    func act(_ body: [String: Any], ok: String?, reload: Bool = true) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return false }
            if let ok { toast = ok }
            if reload { await refresh() }
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativeAnnouncementsView: View {
    @ObservedObject var model: NativeAnnouncementsModel
    let onHome: () -> Void
    let onNotifications: () -> Void

    @State private var expanded: Set<String> = []
    @State private var readLocal: Set<String> = []
    @State private var deleting: NAItem?
    @State private var showCreate = false

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "お知らせ", subtitle: "Announcements", onHome: onHome)
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .center) {
                            Text("本社・店舗からの連絡事項です（公開期間内が上位・重要は強調表示）").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            Spacer()
                            Button { onNotifications() } label: {
                                HStack(spacing: 5) { Image(systemName: "bell"); Text("通知") }
                                    .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                                    .padding(.horizontal, 12).frame(height: 36)
                                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
                            }.buttonStyle(PressableStyle())
                            if p.canWrite && p.targetStore != nil {
                                Button { showCreate = true } label: {
                                    HStack(spacing: 5) { Image(systemName: "plus"); Text("お知らせを作成") }
                                        .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                                        .padding(.horizontal, 14).frame(height: 38)
                                        .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.iris))
                                }.buttonStyle(PressableStyle())
                            }
                        }
                        if p.items.isEmpty {
                            Text("お知らせはありません").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                                .frame(maxWidth: .infinity).padding(36)
                                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                        } else {
                            VStack(spacing: 0) { ForEach(p.items) { a in row(a) } }
                                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
                        }
                    }
                    .padding(16).frame(maxWidth: 960).frame(maxWidth: .infinity)
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await model.refresh() } } }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task { await model.refresh() }
        .confirmationDialog("お知らせを削除", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("削除する", role: .destructive) {
                if let a = deleting { Task { await model.act(["type": "annDelete", "id": a.id], ok: "お知らせを削除しました") } }
            }
        } message: { Text("このお知らせを削除します。よろしいですか？") }
        .sheet(isPresented: $showCreate) {
            if let p = model.payload, let s = p.targetStore {
                NAAnnouncementForm(storeName: s.name, canTargetAllStores: p.canTargetAllStores, model: model) { showCreate = false }
            }
        }
    }

    private func row(_ a: NAItem) -> some View {
        let read = a.isRead || readLocal.contains(a.id)
        let open = expanded.contains(a.id)
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                if open { expanded.remove(a.id) } else { expanded.insert(a.id) }
                if !read {
                    readLocal.insert(a.id)
                    Task { await model.act(["type": "annRead", "id": a.id], ok: nil, reload: false) }
                }
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            if a.isImportant { NPBadge(text: "⚠︎ 重要", color: NFColor.danger) }
                            if !read { NPBadge(text: "未読", color: NFColor.iris) }
                            Text(a.title).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy).lineLimit(1)
                        }
                        Text(meta(a)).font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    Spacer()
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Text(a.body).font(.system(size: 14)).foregroundColor(NFColor.ink).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xF6F6F9)))
                if a.canDelete {
                    HStack {
                        Spacer()
                        Button { deleting = a } label: {
                            HStack(spacing: 5) { Image(systemName: "trash"); Text("削除する") }
                                .font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(RoundedRectangle(cornerRadius: 8).fill(NFColor.danger))
                        }.buttonStyle(PressableStyle()).disabled(model.busy)
                    }
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(a.isImportant ? Color(hex: 0xFFF6E5).opacity(0.6) : Color.white)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func meta(_ a: NAItem) -> String {
        var s = "\(a.storeLabel)｜\(NPDate.slash(String(NNDateOnly.jst(a.createdAt))))"
        if a.publishFrom != nil || a.publishTo != nil {
            s += " ｜公開: \(a.publishFrom.map(NPDate.slash) ?? "—") 〜 \(a.publishTo.map(NPDate.slash) ?? "—")"
        }
        return s
    }
}

enum NNDateOnly {
    /// ISO の日時 → 日本時間の yyyy-MM-dd（Web の formatDate と同じ日付）
    static func jst(_ iso: String) -> String {
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = a.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return String(iso.prefix(10)) }
        return NPDate.str(d)
    }
}

/// お知らせを作成（Web の AnnouncementForm）
struct NAAnnouncementForm: View {
    let storeName: String
    let canTargetAllStores: Bool
    @ObservedObject var model: NativeAnnouncementsModel
    let onDone: () -> Void

    @State private var title = ""
    @State private var bodyText = ""
    @State private var useFrom = false
    @State private var useTo = false
    @State private var from = Date()
    @State private var to = Date()
    @State private var target = "store"
    @State private var important = false
    @State private var localError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("お知らせを作成").font(.system(size: 19, weight: NT.strong)).foregroundColor(NFColor.navy)
                Spacer()
                Button { onDone() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 36, height: 36) }
            }
            label("タイトル")
            TextField("", text: $title).font(.system(size: 16)).padding(.horizontal, 12).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            label("本文")
            TextField("", text: $bodyText, axis: .vertical).lineLimit(5...10).font(.system(size: 15)).padding(12)
                .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Toggle(isOn: $useFrom) { label("公開開始日") }.tint(NFColor.iris)
                    if useFrom { DatePicker("", selection: $from, displayedComponents: .date).labelsHidden() }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Toggle(isOn: $useTo) { label("公開終了日") }.tint(NFColor.iris)
                    if useTo { DatePicker("", selection: $to, displayedComponents: .date).labelsHidden() }
                }
            }
            .environment(\.locale, Locale(identifier: "ja_JP"))
            HStack(spacing: 16) {
                label("対象")
                Picker("", selection: $target) {
                    Text("\(storeName)のみ").tag("store")
                    if canTargetAllStores { Text("全店舗").tag("all") }
                }
                .pickerStyle(.menu)
                Spacer()
                Toggle(isOn: $important) { Text("重要（強調表示）").font(.system(size: 14)) }.tint(NFColor.iris).frame(width: 220)
            }
            if let localError { Text(localError).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
            HStack {
                Spacer()
                Button("キャンセル") { onDone() }.font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2).padding(.horizontal, 10)
                Button {
                    Task { await submit() }
                } label: {
                    Text(model.busy ? "作成中…" : "作成する").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 18).frame(height: 42).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.iris))
                }
                .buttonStyle(PressableStyle()).disabled(model.busy)
            }
        }
        .padding(22).frame(minWidth: 620)
    }

    private func label(_ t: String) -> some View { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2) }

    private func submit() async {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { localError = "タイトルを入力してください"; return }
        if bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { localError = "本文を入力してください"; return }
        localError = nil
        let body: [String: Any] = [
            "type": "annCreate", "title": title, "body": bodyText, "isImportant": important,
            "publishFrom": useFrom ? NPDate.str(from) : NSNull(), "publishTo": useTo ? NPDate.str(to) : NSNull(),
            "allStores": target == "all",
        ]
        if await model.act(body, ok: "お知らせを作成しました") { onDone() }
    }
}
