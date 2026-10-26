import SwiftUI

// iPhone の店長・オーナー：品切れ・残り数（在庫設定。Web の /app/inventory/menu-stock と /app/inventory?tab=menu。2026-10-25 Ronnie「iPhone も native に」）
//   商品ごとに「残りを管理する」スイッチ・大きい − 残り ＋（数を押すとテンキー）・「品切れにする」
//   残りを入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRが自動で売切になる（Web と同じ）
//   下：変更した数・在庫を印刷（確認あり）・登録。登録するまではサーバーに送らない（戻るときは確認）
// サーバーは iPad と同じ：GET part=stock ／ POST stockSave（entries: itemId・limit）・stockPrint

/// GET ?part=stock
struct NPZStockPayload: Decodable {
    struct Group: Decodable, Identifiable, Hashable {
        let key: String
        let name: String
        let categories: [NPZNamed]
        var id: String { key }
    }
    struct Item: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let categoryId: String?
        let limit: Int?
        let sold: Int
    }
    let store: NPZNamed
    let groups: [Group]
    let items: [Item]
}

/// 1 品の下書き（管理する・残り）
struct NPZStockDraft: Equatable {
    var on: Bool
    var remaining: Int
}

@MainActor
final class NPZStockModel: ObservableObject {
    @Published var payload: NPZStockPayload?
    @Published var drafts: [String: NPZStockDraft] = [:]
    @Published var category = ""
    @Published var query = ""
    @Published var managedOnly = false
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false

    init() {
        payload = NPZApi.cached(NPZStockPayload.self, "stock")
        if category.isEmpty { category = payload?.groups.first?.categories.first?.id ?? "" }
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        loading = true
        defer { loading = false }
        do {
            let p = try await NPZApi.get(NPZStockPayload.self, "stock")
            payload = p
            if category.isEmpty || !p.groups.contains(where: { g in g.categories.contains { $0.id == category } }) {
                category = p.groups.first?.categories.first?.id ?? ""
            }
            error = nil
        } catch {
            if NPZApi.useWeb(error) { useWeb = true; return }
            self.error = NPZApi.message(error)
        }
    }

    func initial(_ i: NPZStockPayload.Item) -> NPZStockDraft {
        NPZStockDraft(on: i.limit != nil, remaining: i.limit.map { max(0, $0 - i.sold) } ?? 0)
    }

    func draft(_ i: NPZStockPayload.Item) -> NPZStockDraft { drafts[i.id] ?? initial(i) }

    func set(_ i: NPZStockPayload.Item, _ d: NPZStockDraft) {
        var v = d
        v.remaining = max(0, min(9999, v.remaining))
        drafts[i.id] = v == initial(i) ? nil : v
    }

    var changed: [NPZStockPayload.Item] {
        (payload?.items ?? []).filter { i in
            let a = draft(i)
            let b = initial(i)
            return a.on != b.on || (a.on && a.remaining != b.remaining)
        }
    }

    /// 今見せる商品（探しているときは全カテゴリから）
    var shown: [NPZStockPayload.Item] {
        let items = payload?.items ?? []
        let t = NPZ.trimmed(query)
        var list = t.isEmpty ? items.filter { $0.categoryId == category } : items.filter { $0.name.localizedCaseInsensitiveContains(t) }
        if managedOnly { list = list.filter { draft($0).on } }
        return list
    }

    var managedCount: Int { (payload?.items ?? []).filter { draft($0).on }.count }
    var soldOutCount: Int { (payload?.items ?? []).filter { let d = draft($0); return d.on && d.remaining == 0 }.count }

    func save() async {
        let list = changed
        if list.isEmpty { toast = "変更はありません"; return }
        let entries: [[String: Any]] = list.map { i in
            let d = draft(i)
            return ["itemId": i.id, "limit": d.on ? (i.sold + d.remaining) as Any : NSNull()]
        }
        busy = true
        defer { busy = false }
        let r = await NPZApi.post(["type": "stockSave", "entries": entries])
        if r.ok {
            let n = (r.json?["queued"] as? Int) ?? entries.count
            toast = "\(n)品を登録しました"
            if NativePreview.current == nil {
                drafts = [:]
                await refresh()
            }
        } else {
            error = r.error ?? "登録できませんでした"
        }
    }

    func printList() async {
        let lines: [[String: Any]] = (payload?.items ?? []).filter { draft($0).on }.map { ["name": $0.name, "remaining": draft($0).remaining] }
        if lines.isEmpty { error = "残りを管理している商品がありません"; return }
        busy = true
        defer { busy = false }
        let r = await NPZApi.post(["type": "stockPrint", "lines": lines])
        if r.ok { toast = "在庫を印刷します" } else { error = r.error ?? "在庫の印刷に失敗しました" }
    }
}

/// key "stock" の画面（NativePhoneOwnerScreen から。/app/inventory?tab=menu もここ）
struct NativePhoneStockScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model = NPZStockModel()

    var body: some View {
        NativePhoneStockView(model: model, onBack: { state.closePhoneOwnerModule() }, onOpen: { state.leaveNativePhone(to: $0) })
            .modifier(NPOCWebFallback(key: "stock", useWeb: model.useWeb, state: state))
    }
}

struct NativePhoneStockView: View {
    @ObservedObject var model: NPZStockModel
    let onBack: () -> Void
    let onOpen: (String) -> Void

    @State private var editing: NPZStockPayload.Item?
    @State private var confirmPrint = false
    @State private var confirmLeave = false
    @State private var pendingPath: String?

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "品切れ・残り数", subtitle: model.payload?.store.name ?? "Stock", onBack: { leave(nil) }, trailing: {
                NPZRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }, content: {
                VStack(spacing: 0) {
                    if model.payload != nil { NOSErrorBar(error: $model.error) }
                    if let p = model.payload {
                        content(p)
                    } else {
                        NOSStateView(error: model.error) { Task { await model.refresh() } }
                    }
                }
            })
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task { await model.refresh() }
        .sheet(item: $editing) { i in
            let d = model.draft(i)
            NPZNumberSheet(title: i.name, caption: i.sold > 0 ? "本日 \(i.sold)食 売れました" : "今日の残り（仕込み数）", unit: "食", initial: Double(d.on ? d.remaining : 0),
                           decimal: false, shortcuts: [("品切れ（0）", 0)], okLabel: "決定",
                           onDone: { v in
                               model.set(i, NPZStockDraft(on: true, remaining: Int((v ?? 0).rounded())))
                               editing = nil
                           },
                           onCancel: { editing = nil })
                .presentationDetents([.large])
        }
        .confirmationDialog("在庫を印刷しますか？", isPresented: $confirmPrint, titleVisibility: .visible) {
            Button("印刷する") { Task { await model.printList() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("残りを管理している \(model.managedCount)品の残り数を、お店のプリンターから出します（登録前の数で印刷します）。")
        }
        .confirmationDialog("登録していない変更があります", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("登録して戻る") {
                Task {
                    await model.save()
                    if model.error == nil { go() }
                }
            }
            Button("登録しないで戻る", role: .destructive) { go() }
            Button("続ける", role: .cancel) {}
        }
    }

    private func leave(_ path: String?) {
        pendingPath = path
        if model.changed.isEmpty { go() } else { confirmLeave = true }
    }

    private func go() {
        if let p = pendingPath { onOpen(p) } else { onBack() }
    }

    // MARK: 中身

    private func content(_ p: NPZStockPayload) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    summary
                    filters(p)
                    let list = model.shown
                    if list.isEmpty {
                        NPOCEmpty(icon: "fork.knife", title: model.query.isEmpty ? "このカテゴリに商品がありません" : "見つかりません")
                    } else {
                        ForEach(list) { i in row(i) }
                    }
                    Button { leave("/app/inventory") } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "shippingbox").font(.system(size: 13, weight: .bold))
                            Text("在庫（品目・棚卸・発注）").font(.system(size: 13.5, weight: .bold))
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 14).frame(height: 46)
                        .background(npocCard(14))
                    }
                    .buttonStyle(PressableStyle())
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 120)
            }
            .refreshable { await model.refresh() }
            .scrollDismissesKeyboard(.interactively)
            footer
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("仕込んだ数（残り）を入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRが自動で売切になります。")
                .font(.system(size: 12)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                NPZTile(label: "残りを管理", value: "\(model.managedCount)品", tone: NT.purpleDeep)
                NPZTile(label: "品切れ", value: "\(model.soldOutCount)品", tone: model.soldOutCount > 0 ? NT.danger : NT.ink)
            }
        }
    }

    private func filters(_ p: NPZStockPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NPZSearchField(text: $model.query, placeholder: "商品名で探す（全カテゴリ）")
            if NPZ.trimmed(model.query).isEmpty {
                ForEach(p.groups) { g in
                    VStack(alignment: .leading, spacing: 5) {
                        if p.groups.count > 1 {
                            Text(g.name).font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.ink3).padding(.leading, 4)
                        }
                        NPZChipRow(items: g.categories.map { ($0.id, $0.name) }, selection: model.category) { model.category = $0 }
                    }
                }
                if p.groups.isEmpty {
                    Text("カテゴリがありません").font(.system(size: 13)).foregroundColor(NT.ink3)
                }
            }
            NPOCChip(text: "残りを管理している商品だけ", selected: model.managedOnly) { model.managedOnly.toggle() }
        }
    }

    // MARK: 1 品の行

    private func row(_ i: NPZStockPayload.Item) -> some View {
        let d = model.draft(i)
        let soldOut = d.on && d.remaining == 0
        let dirty = model.drafts[i.id] != nil
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(i.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(2)
                        if soldOut { NOSBadge(text: "品切れ", color: NT.danger) }
                    }
                    Text(i.sold > 0 ? "本日 \(i.sold)食 売れた" : (d.on ? "残りを管理中" : "管理しない（いつでも注文できる）"))
                        .font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                }
                Spacer(minLength: 6)
                Toggle("", isOn: Binding(get: { d.on }, set: { on in model.set(i, NPZStockDraft(on: on, remaining: d.remaining)) }))
                    .labelsHidden().tint(NT.purple)
                    .accessibilityLabel("残りを管理する")
            }
            if d.on {
                HStack(spacing: 8) {
                    NPZBigStepper(value: "\(d.remaining)", unit: "食", tint: soldOut ? NT.danger : NT.ink, minusEnabled: d.remaining > 0,
                                  plusEnabled: d.remaining < 9999,
                                  onMinus: { model.set(i, NPZStockDraft(on: true, remaining: d.remaining - 1)) },
                                  onPlus: { model.set(i, NPZStockDraft(on: true, remaining: d.remaining + 1)) },
                                  onTap: { editing = i })
                    Button { model.set(i, NPZStockDraft(on: true, remaining: 0)) } label: {
                        VStack(spacing: 1) {
                            Image(systemName: "xmark.octagon.fill").font(.system(size: 15, weight: .bold))
                            Text("品切れ").font(.system(size: 10, weight: NT.strong))
                        }
                        .foregroundColor(soldOut ? .white : NT.danger)
                        .frame(width: 56, height: 52)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(soldOut ? NT.danger : NT.dangerBg))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("品切れにする")
                }
            }
        }
        .padding(12)
        .background(npocCard(14))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(dirty ? NT.purple.opacity(0.55) : Color.clear, lineWidth: 1.5))
    }

    // MARK: 下（変更の数・印刷・登録）

    private var footer: some View {
        let n = model.changed.count
        return VStack(spacing: 6) {
            Text(n == 0 ? "変更はありません" : "\(n)品を変更（まだ登録していません）")
                .font(.system(size: 11.5, weight: .bold)).foregroundColor(n == 0 ? NT.ink3 : NT.purpleDeep)
            HStack(spacing: 8) {
                NPOCWideButton(text: "在庫を印刷", icon: "printer", kind: .secondary, disabled: model.busy) { confirmPrint = true }
                NPOCWideButton(text: model.busy ? "登録中…" : "登録", icon: "square.and.arrow.down", kind: .primary, busy: model.busy, disabled: n == 0) {
                    Task { await model.save() }
                }
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 12)
        .background(Color.white.ignoresSafeArea(edges: .bottom).shadow(color: .black.opacity(0.06), radius: 6, y: -2))
    }
}
