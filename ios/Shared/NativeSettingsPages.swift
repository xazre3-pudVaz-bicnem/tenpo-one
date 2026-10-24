import SwiftUI

// 設定の中の画面（ネイティブ。2026-10-24 Ronnie「設定の中も全部ネイティブ。テーブルQRなど何でも」）。
// Web の設定の各画面を1つずつネイティブにしていく。どの画面がネイティブかは NativeSettingsPageKey（道 → 画面）で決まり、
// 設定の一覧（NativeSettingsView）はネイティブのものをアプリの画面で、まだのものを Web で開く。
// 読み込みは GET /api/app/v1/pos?part=<画面>、操作は POST { type: ... }（中身は Web と同じ Server Action。lib/native-settings-pages.ts）

/// 設定の中のネイティブの画面。rawValue は GET ?part= の名前
enum NativeSettingsPageKey: String, CaseIterable, Identifiable {
    case soldOut = "soldout"
    case clerks = "clerks"
    var id: String { rawValue }

    /// Web の道（クエリは見ない）
    var path: String {
        switch self {
        case .soldOut: return "/app/pos/sold-out"
        case .clerks: return "/app/settings/clerks"
        }
    }
    var title: String {
        switch self {
        case .soldOut: return "品切れ"
        case .clerks: return "POS担当者"
        }
    }
    var en: String {
        switch self {
        case .soldOut: return "Sold out"
        case .clerks: return "Clerks"
        }
    }

    /// 道からネイティブの画面へ（無ければ nil＝Web のまま）
    static func from(path: String) -> NativeSettingsPageKey? {
        let p = path.hasSuffix("/") && path.count > 1 ? String(path.dropLast()) : path
        return allCases.first { $0.path == p }
    }
}

/// 設定の中の画面（AppState.nativeSettingsPage に合わせて1つ出す）
struct NativeSettingsPageScreen: View {
    let key: NativeSettingsPageKey
    var body: some View {
        switch key {
        case .soldOut: NativeSoldOutScreen()
        case .clerks: NativeClerksScreen()
        }
    }
}

// MARK: - 品切れ（Web の /app/pos/sold-out・components/pos/sold-out-board.tsx と同じ）

struct NSOCategory: Codable, Identifiable, Hashable { let id: String; let name: String; let sortOrder: Int }
struct NSOItem: Codable, Identifiable, Hashable {
    let id: String
    let categoryId: String?
    let name: String
    let nameKana: String?
    let price: Double
    let isSoldOut: Bool
    let sortOrder: Int
    let shared: Bool
}
struct NSOPayload: Codable {
    let store: NFNamed
    let canManageShared: Bool
    let categories: [NSOCategory]
    var items: [NSOItem]
}
struct NSOSection: Identifiable { let id: String; let name: String; let items: [NSOItem] }

@MainActor
final class NativeSoldOutModel: ObservableObject {
    @Published var payload: NSOPayload?
    @Published var error: String?
    @Published var toast: String?
    /// 切り替え中の商品
    @Published var busy: Set<String> = []
    @Published var query = ""
    @Published var onlySoldOut = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: NativeSettingsPageKey.soldOut.rawValue)]
            if payload == nil, let saved = NativeAPI.cached(NSOPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NSOPayload.self, from: data)
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    /// 検索と「売切中だけ」で絞って、カテゴリごとに並べる（lib/sold-out.ts の soldOutSections と同じ）
    var sections: [NSOSection] {
        guard let p = payload else { return [] }
        let q = Self.norm(query)
        func ok(_ i: NSOItem) -> Bool {
            (!onlySoldOut || i.isSoldOut) && (q.isEmpty || Self.norm(i.name).contains(q) || Self.norm(i.nameKana ?? "").contains(q))
        }
        let byOrder: (NSOItem, NSOItem) -> Bool = { a, b in a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.name < b.name }
        let known = Set(p.categories.map(\.id))
        var out: [NSOSection] = p.categories
            .sorted { $0.sortOrder != $1.sortOrder ? $0.sortOrder < $1.sortOrder : $0.name < $1.name }
            .map { c in NSOSection(id: c.id, name: c.name, items: p.items.filter { $0.categoryId == c.id && ok($0) }.sorted(by: byOrder)) }
            .filter { !$0.items.isEmpty }
        let orphans = p.items.filter { ($0.categoryId == nil || !known.contains($0.categoryId!)) && ok($0) }.sorted(by: byOrder)
        if !orphans.isEmpty { out.append(NSOSection(id: "__none__", name: "その他", items: orphans)) }
        return out
    }

    var soldOutCount: Int { payload?.items.filter(\.isSoldOut).count ?? 0 }

    /// 売切／販売再開（押した瞬間に画面を変え、失敗したら戻す）
    func toggle(_ item: NSOItem) async {
        guard var p = payload, !busy.contains(item.id) else { return }
        if item.shared && !p.canManageShared { toast = "全店共通の商品は、店長以上がメニュー編集で売切にしてください"; return }
        let next = !item.isSoldOut
        busy.insert(item.id)
        defer { busy.remove(item.id) }
        if let i = p.items.firstIndex(where: { $0.id == item.id }) {
            p.items[i] = NSOItem(id: item.id, categoryId: item.categoryId, name: item.name, nameKana: item.nameKana, price: item.price, isSoldOut: next, sortOrder: item.sortOrder, shared: item.shared)
            payload = p
        }
        let r = await act(["type": "soldOutSet", "itemId": item.id, "soldOut": next])
        if r?["ok"] as? Bool != true {
            toast = (r?["error"] as? String) ?? "切り替えできませんでした"
            if var q = payload, let i = q.items.firstIndex(where: { $0.id == item.id }) { q.items[i] = item; payload = q }
            return
        }
        toast = next ? "「\(item.name)」を売切にしました" : "「\(item.name)」の販売を再開しました"
    }

    private func act(_ body: [String: Any]) async -> [String: Any]? {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }

    /// 検索用に揃える（全角→半角・小文字・カタカナ→ひらがな・空白なし。lib/sold-out.ts の normalizeForSearch と同じ）
    static func norm(_ s: String) -> String {
        let folded = s.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? s
        let hira = folded.applyingTransform(.hiraganaToKatakana, reverse: true) ?? folded
        return hira.lowercased().replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
    }
}

struct NativeSoldOutScreen: View {
    @StateObject private var model = NativeSoldOutModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NativeSoldOutView(model: model, onBack: { state.goNativeSettings() })
    }
}

struct NativeSoldOutView: View {
    @ObservedObject var model: NativeSoldOutModel
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "品切れ", subtitle: "Sold out", userName: "", onHome: onBack)
            if model.payload != nil {
                VStack(spacing: 0) {
                    toolbar
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            let secs = model.sections
                            if secs.isEmpty {
                                Text(model.onlySoldOut ? "売切中の商品はありません" : "商品がありません").font(.system(size: 15)).foregroundColor(NFColor.ink3).padding(.top, 20)
                            }
                            ForEach(secs) { s in
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text(s.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NFColor.navy)
                                        let n = s.items.filter(\.isSoldOut).count
                                        if n > 0 { Text("売切 \(n)").font(.system(size: 12, weight: .heavy)).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(NFColor.danger)) }
                                    }
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 10)], spacing: 10) {
                                        ForEach(s.items) { it in itemCard(it) }
                                    }
                                }
                            }
                        }
                        .padding(16).frame(maxWidth: 1100).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 24)
                    }
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        Button("もう一度") { Task { await model.refresh() } }
                    }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(Color.white.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22).fill(NFColor.navy.opacity(0.92)))
                    .padding(.horizontal, 40).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .task { await model.refresh() }
    }

    /// 上：検索・売切中だけ・売切の数
    private var toolbar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundColor(NFColor.ink3)
                TextField("商品名・フリガナで探す", text: $model.query).font(.system(size: 16)).textInputAutocapitalization(.never).autocorrectionDisabled()
                if !model.query.isEmpty {
                    Button { model.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundColor(NFColor.ink3) }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).frame(height: 46).frame(maxWidth: 420)
            .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
            HStack(spacing: 0) {
                chip("すべて", on: !model.onlySoldOut) { model.onlySoldOut = false }
                chip("売切中 \(model.soldOutCount)", on: model.onlySoldOut) { model.onlySoldOut = true }
            }
            .padding(3)
            .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
            Spacer()
            Text("売切にした商品は、レジ・ハンディ・お客様QRで注文できなくなります").font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 14).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? NFColor.navy : Color.clear))
        }
        .buttonStyle(PressableStyle())
    }

    /// 商品：名前・値段・（全店共通）・売切スイッチ
    private func itemCard(_ it: NSOItem) -> some View {
        let locked = it.shared && !(model.payload?.canManageShared ?? false)
        let busy = model.busy.contains(it.id)
        return Button { Task { await model.toggle(it) } } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.name).font(.system(size: 16, weight: .bold)).foregroundColor(it.isSoldOut ? NFColor.ink3 : NFColor.ink).lineLimit(2).multilineTextAlignment(.leading)
                        .strikethrough(it.isSoldOut, color: NFColor.ink3)
                    HStack(spacing: 6) {
                        Text(NT.yen(Int(it.price))).font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.ink3).monospacedDigit()
                        if it.shared { Text("全店共通").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.lilac)) }
                        if locked { Image(systemName: "lock").font(.system(size: 11)).foregroundColor(NFColor.ink3) }
                    }
                }
                Spacer(minLength: 6)
                if busy {
                    ProgressView().frame(width: 64)
                } else {
                    Text(it.isSoldOut ? "売切" : "販売中")
                        .font(.system(size: 13, weight: .heavy)).foregroundColor(it.isSoldOut ? .white : NFColor.success)
                        .frame(width: 64, height: 32)
                        .background(Capsule().fill(it.isSoldOut ? NFColor.danger : NFColor.successSoft))
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 64)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(it.isSoldOut ? NFColor.dangerSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(it.isSoldOut ? NFColor.danger.opacity(0.4) : NFColor.line, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.04), radius: 4, y: 2)
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .disabled(locked || busy)
    }
}

// MARK: - POS担当者（Web の /app/settings/clerks・components/settings/clerks-panel.tsx と同じ）

struct NCLRole: Codable, Identifiable, Hashable { let id: String; let label: String; let en: String }
struct NCLRow: Codable, Identifiable, Hashable { let id: String; let name: String; let status: String; let role: String }
struct NCLPayload: Codable {
    let store: NFNamed
    let lockOwner: Bool
    let canEdit: Bool
    let roles: [NCLRole]
    var rows: [NCLRow]
}

@MainActor
final class NativeClerksModel: ObservableObject {
    @Published var payload: NCLPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy: String?
    @Published var newName = ""
    @Published var newRole = "staff"

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: NativeSettingsPageKey.clerks.rawValue)]
            if payload == nil, let saved = NativeAPI.cached(NCLPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NCLPayload.self, from: data)
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }

    func roleLabel(_ id: String) -> String { payload?.roles.first { $0.id == id }?.label ?? id }
    func roleEn(_ id: String) -> String { payload?.roles.first { $0.id == id }?.en ?? "" }
    /// レジ端末ではオーナーの担当者を消せない・役職を変えられない
    func locked(_ r: NCLRow) -> Bool { (payload?.lockOwner ?? false) && r.role == "owner" }

    func add() async {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { toast = "担当者名を入力してください"; return }
        guard await run("add", ["type": "clerkAdd", "name": name, "role": newRole]) else { return }
        newName = ""
        toast = "「\(name)」を追加しました"
    }
    func rename(_ r: NCLRow, to name: String) async {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, n != r.name else { return }
        if await run(r.id, ["type": "clerkRename", "id": r.id, "name": n]) { toast = "名前を変えました" }
    }
    func toggleHidden(_ r: NCLRow) async {
        let next = r.status == "hidden" ? "active" : "hidden"
        if await run(r.id, ["type": "clerkStatus", "id": r.id, "status": next]) { toast = next == "hidden" ? "選択肢から外しました" : "選択肢に表示しました" }
    }
    func setRole(_ r: NCLRow, _ role: String) async {
        guard role != r.role else { return }
        if await run(r.id, ["type": "clerkRole", "id": r.id, "role": role]) { toast = "役職を「\(roleLabel(role))」にしました" }
    }
    func delete(_ r: NCLRow) async {
        if await run(r.id, ["type": "clerkDelete", "id": r.id]) { toast = "「\(r.name)」を削除しました" }
    }

    /// 操作して読み直す。失敗したら toast
    private func run(_ key: String, _ body: [String: Any]) async -> Bool {
        guard busy == nil else { return false }
        busy = key
        defer { busy = nil }
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            let r = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            guard r?["ok"] as? Bool == true else { toast = (r?["error"] as? String) ?? "うまくいきませんでした"; return false }
            await refresh()
            return true
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativeClerksScreen: View {
    @StateObject private var model = NativeClerksModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeClerksView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeClerksView: View {
    @ObservedObject var model: NativeClerksModel
    let onBack: () -> Void
    @State private var editing: String?
    @State private var editName = ""
    @State private var confirmDelete: NCLRow?

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "POS担当者", subtitle: "Clerks", userName: "", onHome: onBack)
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("会計のときに選ぶ担当者の名前です（アカウントは要りません）。退職した人は「非表示」に（過去の伝票の名前は残ります）")
                            .font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        if p.canEdit { addCard(p) }
                        VStack(spacing: 0) {
                            if p.rows.isEmpty {
                                Text("担当者がまだ登録されていません").font(.system(size: 15)).foregroundColor(NFColor.ink3).padding(20)
                            }
                            ForEach(Array(p.rows.enumerated()), id: \.element.id) { i, r in
                                row(r, p: p)
                                if i < p.rows.count - 1 { Rectangle().fill(NFColor.line).frame(height: 1).padding(.leading, 16) }
                            }
                        }
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                        .shadow(color: Color.black.opacity(0.05), radius: 6, y: 2)
                        if p.lockOwner {
                            Text("オーナーの担当者の削除・役職の変更は管理画面（パソコン）で").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                    }
                    .padding(20).frame(maxWidth: 900).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 24)
                }
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        Button("もう一度") { Task { await model.refresh() } }
                    }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(Color.white.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22).fill(NFColor.navy.opacity(0.92)))
                    .padding(.horizontal, 40).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .alert("担当者を削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let r = confirmDelete { Task { await model.delete(r) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: {
            Text("「\(confirmDelete?.name ?? "")」を削除します。過去の伝票の名前は残ります。退職なら「非表示」がおすすめです")
        }
        .task { await model.refresh() }
    }

    /// 追加：名前＋役職＋追加する
    private func addCard(_ p: NCLPayload) -> some View {
        HStack(spacing: 10) {
            TextField("担当者の名前（例：Ronnie・田中）", text: $model.newName)
                .font(.system(size: 16)).padding(.horizontal, 14).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                .onSubmit { Task { await model.add() } }
            roleMenu(selected: model.newRole, disabled: false) { model.newRole = $0 }
            Button { Task { await model.add() } } label: {
                HStack(spacing: 6) {
                    if model.busy == "add" { ProgressView().tint(.white).scaleEffect(0.8) } else { Image(systemName: "plus") }
                    Text("追加する")
                }
                .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 18).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.iris))
            }
            .buttonStyle(PressableStyle())
            .disabled(model.busy != nil || model.newName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private func roleMenu(selected: String, disabled: Bool, pick: @escaping (String) -> Void) -> some View {
        Menu {
            ForEach(model.payload?.roles ?? []) { r in
                Button { pick(r.id) } label: { Text("\(r.label)（\(r.en)）") }
            }
        } label: {
            HStack(spacing: 6) {
                Text(model.roleLabel(selected)).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 14).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
        }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }

    /// 1人：名前（押すと名前を変える）・役職・非表示／表示に戻す・削除
    private func row(_ r: NCLRow, p: NCLPayload) -> some View {
        let hidden = r.status == "hidden"
        let locked = model.locked(r)
        let busy = model.busy == r.id
        return HStack(spacing: 12) {
            Image(systemName: "person.fill").font(.system(size: 15, weight: .semibold)).foregroundColor(hidden ? NFColor.ink3 : NFColor.iris)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hidden ? NFColor.lilacSoft : NFColor.irisSoft))
            if editing == r.id {
                TextField("名前", text: $editName)
                    .font(.system(size: 16, weight: .bold)).padding(.horizontal, 12).frame(height: 42).frame(maxWidth: 320)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.iris, lineWidth: 1.5))
                    .onSubmit { Task { await model.rename(r, to: editName) }; editing = nil }
                Button("決定") { Task { await model.rename(r, to: editName) }; editing = nil }.font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.iris)
                Button("やめる") { editing = nil }.font(.system(size: 14)).foregroundColor(NFColor.ink3)
            } else {
                Button { guard p.canEdit else { return }; editing = r.id; editName = r.name } label: {
                    HStack(spacing: 8) {
                        Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(hidden ? NFColor.ink3 : NFColor.ink).strikethrough(hidden, color: NFColor.ink3)
                        if hidden { Text("非表示").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac)) }
                        if p.canEdit { Image(systemName: "pencil").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 8)
            if busy { ProgressView() }
            if p.canEdit {
                roleMenu(selected: r.role, disabled: locked || busy) { Task { await model.setRole(r, $0) } }
                Button { Task { await model.toggleHidden(r) } } label: {
                    HStack(spacing: 5) {
                        Image(systemName: hidden ? "eye" : "eye.slash")
                        Text(hidden ? "表示に戻す" : "非表示")
                    }
                    .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
                    .padding(.horizontal, 12).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle()).disabled(busy)
                Button { confirmDelete = r } label: {
                    Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(locked ? NFColor.ink3 : NFColor.danger)
                        .frame(width: 40, height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle()).disabled(locked || busy)
            } else {
                Text(model.roleLabel(r.role)).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
            }
        }
        .padding(.horizontal, 16).frame(minHeight: 64)
    }
}
