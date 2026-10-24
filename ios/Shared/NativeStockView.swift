import SwiftUI

// 在庫設定（本日の残り数・ネイティブ）。Web の /app/inventory/menu-stock（MenuStockBoard）と同じ（2026-10-24）
//   左：ページ（フード・ドリンク…）ごとのカテゴリ／右：商品ごとに 在庫管理する・− ＋・残り ／ 下：在庫を印刷・登録
//   残りを入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRが自動で売切になる

struct NSKGroup: Codable, Identifiable { var id: String { key }; let key: String; let name: String; let categories: [NFNamed] }
struct NSKItem: Codable, Identifiable { let id: String; let name: String; let categoryId: String?; let limit: Int?; let sold: Int }
struct NSKPayload: Codable { let store: NFNamed; let groups: [NSKGroup]; let items: [NSKItem] }

@MainActor
final class NativeStockModel: ObservableObject {
    @Published var payload: NSKPayload?
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "stock")]
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NSKPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NSKPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func act(_ body: [String: Any]) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return nil }
            return r
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

struct NativeStockView: View {
    @ObservedObject var model: NativeStockModel
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var active = ""
    @State private var draft: [String: (on: Bool, remaining: Int)] = [:]
    @State private var loadedKey = ""

    private var p: NSKPayload? { model.payload }
    private func initial(_ i: NSKItem) -> (on: Bool, remaining: Int) { (i.limit != nil, i.limit.map { max(0, $0 - i.sold) } ?? 0) }
    private func d(_ i: NSKItem) -> (on: Bool, remaining: Int) { draft[i.id] ?? initial(i) }
    private var changed: [NSKItem] {
        (p?.items ?? []).filter { i in
            let a = d(i), b = initial(i)
            return a.on != b.on || (a.on && a.remaining != b.remaining)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "在庫管理", subtitle: "Stock", onHome: onHome)
            if let p {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("仕込んだ数（残り）を入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRが自動で売切になります")
                            .font(.system(size: 13)).foregroundColor(NFColor.ink2)
                        Spacer()
                        Button { onWeb("/app/inventory") } label: {
                            HStack(spacing: 4) { Text("在庫（品目・棚卸・発注）"); Image(systemName: "chevron.right") }.font(.system(size: 13, weight: .bold))
                        }
                    }
                    HStack(alignment: .top, spacing: 12) {
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(p.groups) { g in
                                    Text(g.name).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 10)
                                        .background(NFColor.royal)
                                    ForEach(g.categories) { c in
                                        Button { active = c.id } label: {
                                            HStack {
                                                Text(c.name).font(.system(size: 15, weight: .bold)).foregroundColor(active == c.id ? NFColor.royal : NFColor.ink2)
                                                Spacer()
                                                Text("›").foregroundColor(NFColor.ink3)
                                            }
                                            .padding(.horizontal, 16).frame(height: 52)
                                            .background(active == c.id ? NFColor.lilacSoft : Color.white)
                                        }.buttonStyle(.plain)
                                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                                    }
                                }
                                if p.groups.isEmpty { Text("カテゴリがありません").font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(16) }
                            }
                        }
                        .frame(width: 280)
                        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))

                        ScrollView {
                            let shown = p.items.filter { $0.categoryId == active }
                            VStack(spacing: 0) {
                                if shown.isEmpty { Text("このカテゴリに商品がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(40) }
                                ForEach(shown) { i in itemRow(i) }
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
                    }
                    HStack(spacing: 10) {
                        Spacer()
                        Text(changed.isEmpty ? "変更はありません" : "\(changed.count)品を変更").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        Button { Task { await printList(p) } } label: {
                            HStack(spacing: 6) { Image(systemName: "printer"); Text("在庫を印刷") }
                                .font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.royal)
                                .padding(.horizontal, 20).frame(height: 54)
                                .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.wisteria, lineWidth: 1.5))
                        }.buttonStyle(PressableStyle()).disabled(model.busy)
                        Button { Task { await save(p) } } label: {
                            HStack(spacing: 6) { Image(systemName: "square.and.arrow.down"); Text(model.busy ? "登録中…" : "登録") }
                                .font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                                .padding(.horizontal, 30).frame(height: 54)
                                .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.iris))
                        }.buttonStyle(PressableStyle()).disabled(model.busy)
                    }
                }
                .padding(16)
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await model.refresh() } } }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft)).frame(maxWidth: 720)
                }.buttonStyle(.plain).padding(.top, 74)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NFColor.navy.opacity(0.92))).padding(.bottom, 90)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .task {
            await model.refresh()
            if active.isEmpty { active = model.payload?.groups.first?.categories.first?.id ?? "" }
        }
    }

    private func itemRow(_ i: NSKItem) -> some View {
        let s = d(i)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(i.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy).lineLimit(1)
                if i.sold > 0 { Text("本日 \(i.sold)食 売れた").font(.system(size: 11)).foregroundColor(NFColor.ink3) }
            }
            Spacer()
            Toggle("", isOn: Binding(get: { s.on }, set: { draft[i.id] = ($0, s.remaining) })).labelsHidden().tint(NFColor.iris)
            Button { draft[i.id] = (s.on, max(0, s.remaining - 1)) } label: { stepLabel("−") }.buttonStyle(PressableStyle()).disabled(!s.on || s.remaining <= 0).opacity(!s.on || s.remaining <= 0 ? 0.3 : 1)
            Button { draft[i.id] = (s.on, min(9999, s.remaining + 1)) } label: { stepLabel("＋") }.buttonStyle(PressableStyle()).disabled(!s.on).opacity(s.on ? 1 : 0.3)
            HStack(spacing: 6) {
                Text("残り").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                Text(s.on ? "\(s.remaining)" : "—").font(.system(size: 20, weight: .heavy)).monospacedDigit()
                    .foregroundColor(s.on ? (s.remaining == 0 ? NFColor.danger : NFColor.navy) : NFColor.ink3)
                    .frame(width: 64, height: 42)
                    .background(RoundedRectangle(cornerRadius: 12).fill(s.on ? Color.white : NFColor.lilacSoft))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
            }
            if s.on && s.remaining == 0 { Text("売切").font(.system(size: 12, weight: .heavy)).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NFColor.danger)) }
        }
        .padding(.horizontal, 16).frame(minHeight: 64)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func stepLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 22, weight: .bold)).foregroundColor(NFColor.royal)
            .frame(width: 44, height: 44)
            .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
    }

    private func save(_ p: NSKPayload) async {
        let list = changed
        if list.isEmpty { model.toast = "変更はありません"; return }
        let entries: [[String: Any]] = list.map { i in
            let s = d(i)
            return ["itemId": i.id, "limit": s.on ? (i.sold + s.remaining) as Any : NSNull()]
        }
        if let r = await model.act(["type": "stockSave", "entries": entries]) {
            model.toast = "\(r.queued ?? entries.count)品を登録しました"
            draft = [:]
            await model.refresh()
        }
    }

    private func printList(_ p: NSKPayload) async {
        let lines: [[String: Any]] = p.items.filter { d($0).on }.map { ["name": $0.name, "remaining": d($0).remaining] }
        if lines.isEmpty { model.error = "在庫管理している商品がありません"; return }
        if await model.act(["type": "stockPrint", "lines": lines]) != nil { model.toast = "在庫を印刷します" }
    }
}
