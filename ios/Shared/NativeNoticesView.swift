import SwiftUI

// 通知（ネイティブ）。Web の /app/notifications と同じ（2026-10-24）
//   あなた宛の通知（新しい順・最新100件）／ 種別・店舗・状態で絞込 ／ すべて既読にする ／ 表示設定（この端末のみ）
//   行を押すと既読にして、リンクがあればその画面へ

struct NNItem: Codable, Identifiable { let id: String; let type: String; let typeLabel: String; let title: String; let body: String?; let link: String?; let readAt: String?; let createdAt: String }
struct NNType: Codable, Hashable { let key: String; let label: String }
struct NNPayload: Codable { let stores: [NFNamed]; let typeOptions: [NNType]; let type: String; let store: String; let status: String; let items: [NNItem] }

@MainActor
final class NativeNoticesModel: ObservableObject {
    @Published var payload: NNPayload?
    @Published var type = ""
    @Published var store = ""
    @Published var status = ""
    @Published var error: String?
    @Published var busy = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "notices"), URLQueryItem(name: "type", value: type), URLQueryItem(name: "store", value: store), URLQueryItem(name: "status", value: status)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NNPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func post(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        _ = try? await NativeAPI.shared.floorAct(body)
        await refresh()
    }
}

struct NativeNoticesView: View {
    @ObservedObject var model: NativeNoticesModel
    let onHome: () -> Void
    let onLink: (String) -> Void

    private static let hiddenKey = "tenpo_notification_hidden_types_v1"
    @State private var hidden: Set<String> = Set(UserDefaults.standard.stringArray(forKey: NativeNoticesView.hiddenKey) ?? [])
    @State private var showSettings = false

    private var p: NNPayload? { model.payload }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "通知", subtitle: "Notifications", onHome: onHome)
            if let p {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("あなた宛の通知です（新しい順・最新100件）").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            Spacer()
                            if p.items.contains(where: { $0.readAt == nil }) {
                                Button { Task { await model.post(["type": "noticeReadAll"]) } } label: {
                                    HStack(spacing: 6) { Image(systemName: "checkmark.circle"); Text("すべて既読にする") }
                                        .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.royal)
                                        .padding(.horizontal, 14).frame(height: 38)
                                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                                }.buttonStyle(PressableStyle()).disabled(model.busy)
                            }
                        }
                        filters(p)
                        let visible = p.items.filter { !hidden.contains($0.type) }
                        if visible.isEmpty {
                            VStack(spacing: 6) {
                                Text("表示する通知がありません").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                                if !hidden.isEmpty { Text("表示設定で一部の種別が非表示になっています").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                            }
                            .frame(maxWidth: .infinity).padding(36)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                        } else {
                            VStack(spacing: 0) { ForEach(visible) { n in row(n) } }
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
        .task { await model.refresh() }
        .onChange(of: model.type) { _ in Task { await model.refresh() } }
        .onChange(of: model.store) { _ in Task { await model.refresh() } }
        .onChange(of: model.status) { _ in Task { await model.refresh() } }
        .sheet(isPresented: $showSettings) { settings }
    }

    private func filters(_ p: NNPayload) -> some View {
        HStack(spacing: 12) {
            if p.typeOptions.count > 1 {
                menu("種別", selection: $model.type, options: [("", "すべて")] + p.typeOptions.map { ($0.key, $0.label) })
            }
            if p.stores.count > 1 {
                menu("店舗", selection: $model.store, options: [("", "すべて")] + p.stores.map { ($0.id, $0.name) })
            }
            Text("状態").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            Picker("", selection: $model.status) { Text("すべて").tag(""); Text("未読").tag("unread"); Text("既読").tag("read") }
                .pickerStyle(.segmented).frame(width: 220)
            Spacer()
            if !p.typeOptions.isEmpty {
                Button { showSettings = true } label: {
                    HStack(spacing: 5) { Image(systemName: "slider.horizontal.3"); Text("表示設定") }
                        .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
                }.buttonStyle(PressableStyle())
            }
        }
    }

    private func menu(_ label: String, selection: Binding<String>, options: [(String, String)]) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            Picker("", selection: selection) { ForEach(options, id: \.0) { k, v in Text(v).tag(k) } }
                .pickerStyle(.menu).padding(.horizontal, 4).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private func row(_ n: NNItem) -> some View {
        let unread = n.readAt == nil
        return Button {
            if unread { Task { await model.post(["type": "noticeRead", "id": n.id]) } }
            if let link = n.link, !link.isEmpty { onLink(link) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "bell.fill").font(.system(size: 14)).foregroundColor(unread ? NFColor.iris : NFColor.line).padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(n.title).font(.system(size: 15, weight: unread ? .bold : .regular)).foregroundColor(unread ? NFColor.navy : NFColor.ink).multilineTextAlignment(.leading)
                    if let b = n.body, !b.isEmpty { Text(b).font(.system(size: 13)).foregroundColor(NFColor.ink3).lineLimit(2).multilineTextAlignment(.leading) }
                    HStack(spacing: 8) {
                        Text(Self.dateTime(n.createdAt)).font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                        Text(n.typeLabel).font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                            .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.lilacSoft))
                    }
                }
                Spacer(minLength: 0)
                if unread { Circle().fill(NFColor.iris).frame(width: 8, height: 8).padding(.top, 6) }
                if n.link != nil { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.top, 4) }
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(unread ? NFColor.lilacSoft : Color.white)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("通知の表示設定").font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
            Text("この端末でのみ有効な表示設定です。種別ごとに通知の受信自体をON/OFFする配信設定は今後対応予定です。").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(p?.typeOptions ?? [], id: \.key) { t in
                        Toggle(isOn: Binding(get: { !hidden.contains(t.key) }, set: { on in
                            if on { hidden.remove(t.key) } else { hidden.insert(t.key) }
                            UserDefaults.standard.set(Array(hidden), forKey: Self.hiddenKey)
                        })) { Text(t.label).font(.system(size: 15)) }
                        .tint(NFColor.iris)
                        .padding(.horizontal, 14).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                    }
                }
            }
            HStack { Spacer(); Button("閉じる") { showSettings = false }.font(.system(size: 15, weight: .bold)) }
        }
        .padding(24).frame(minWidth: 460, minHeight: 420)
    }

    private static let isoFrac: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let iso = ISO8601DateFormatter()
    private static let out: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy/MM/dd HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Tokyo"); return f }()
    static func dateTime(_ s: String) -> String {
        guard let d = isoFrac.date(from: s) ?? iso.date(from: s) else { return s }
        return out.string(from: d)
    }
}
