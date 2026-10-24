import SwiftUI

/// オーダー画面の「編集 Edit tabs」（Web のレジの MenuPagesDialog / MenuPagesEditor と同じ中身・同じ文言）。
/// 1. タブの並びと名前（↑↓・名前・ページを追加・消す。「おすすめ」は並びだけ）  2. どのページに入れるか
/// 保存は Web と同じ saveMenuBookPages（店長以上）。保存するといまの行き先で固定される（自動の分も）。

struct NMPPayload: Decodable {
    let ok: Bool
    let pages: [NMPPage]
    let categoryPage: [String: String]
    let categories: [NMPCategory]
}
struct NMPPage: Codable, Identifiable, Equatable { let key: String; var name: String; var id: String { key } }
struct NMPCategory: Decodable, Identifiable {
    let id: String
    let name: String
    let itemCount: Int
    let allZeroPrice: Bool
    let drink: Bool
    let hidden: Bool
    let autoPage: String
}

private enum NMP {
    static let picksKey = "picks"
    static let picksName = "おすすめ"
    static let fallbackKey = "other"
    static let nameMax = 30
    static let maxPages = 40
}

struct NativeMenuPagesEditor: View {
    let storeId: String
    let onClose: () -> Void
    let onSaved: () -> Void

    @State private var loaded: NMPPayload?
    @State private var pages: [NMPPage] = []
    @State private var map: [String: String] = [:]
    @State private var loadError: String?
    @State private var error: String?
    @State private var busy = false

    private var categoryPages: [NMPPage] { pages.filter { $0.key != NMP.picksKey } }

    /// いまの画面での行き先（決めていなければ自動。知らないページは OTHER へ。Web の pageKeyOf と同じ）
    private func pageKeyOf(_ c: NMPCategory) -> String {
        let known = Set(categoryPages.map(\.key))
        if let set = map[c.id], known.contains(set) { return set }
        return known.contains(c.autoPage) ? c.autoPage : NMP.fallbackKey
    }

    private func count(_ key: String) -> Int { (loaded?.categories ?? []).filter { pageKeyOf($0) == key }.count }

    private func label(_ p: NMPPage, _ i: Int) -> String {
        let n = p.name.trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "\(i + 1)番目のタブ" : n
    }

    var body: some View {
        NativeModalCard(width: 820, maxHeight: 980) {
            VStack(alignment: .leading, spacing: 14) {
                NIDialogHead(title: "タブを編集 / Edit tabs", onClose: onClose)
                if let e = loadError {
                    Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else if let data = loaded {
                    if data.categories.isEmpty {
                        Text("カテゴリがありません（設定 → メニュー編集 で追加）")
                            .font(.system(size: 15)).foregroundColor(NFColor.ink3)
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 18) {
                                explain
                                pagesSection
                                categoriesSection(data.categories)
                            }
                            .padding(.bottom, 8)
                        }
                        .frame(maxHeight: 700)
                    }
                    NIDialogFoot(error: error, busy: busy, okText: "保存する", busyText: "保存中…", onCancel: onClose) {
                        Task { await save() }
                    }
                } else {
                    ProgressView("読み込み中…").frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(22)
        }
        .task { await load() }
    }

    // MARK: 説明（Web と同じ）

    private var explain: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("ページ ＝ レジ・ハンディ・お客様QRの上のタブ").font(.system(size: 14, weight: .heavy)).foregroundColor(NFColor.navy)
            Text("名前は自由に変えられます。「ページを追加」でタブを足せます。↑↓で順番を変えられます。レジ（POS）はいちばん上のタブを最初に開きます。「おすすめ」（おすすめ・売れ筋）はレジだけのタブで、順番だけ変えられます。")
            Text("カテゴリが1つも入っていないタブは、レジ・ハンディ・お客様QRには出ません（押せないタブを出さないため）。")
            Text("下の「どのページに入れるか」を変えていないカテゴリは自動で振り分けます。保存するといまの並びで固定されます。")
        }
        .font(.system(size: 12.5)).foregroundColor(NFColor.ink2)
        .fixedSize(horizontal: false, vertical: true)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    // MARK: 1. タブの並びと名前

    private var pagesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("1. タブの並びと名前").font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.navy)
            ForEach(Array(pages.enumerated()), id: \.element.key) { i, p in
                HStack(spacing: 10) {
                    Text(verbatim: "\(i + 1)").font(.system(size: 14, weight: .heavy)).monospacedDigit()
                        .foregroundColor(NT.purple).frame(width: 26)
                    if p.key == NMP.picksKey {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(NMP.picksName).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.navy)
                            Text("おすすめ・売れ筋").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                        }
                        .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
                        Text("レジだけ").font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink3)
                    } else {
                        TextField("タブの名前", text: Binding(
                            get: { p.name },
                            set: { v in rename(p.key, String(v.prefix(NMP.nameMax))) }
                        ))
                        .font(.system(size: 16, weight: .semibold))
                        .padding(.horizontal, 12).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                        Text("\(count(p.key))カテゴリ").font(.system(size: 12, weight: .semibold)).monospacedDigit()
                            .foregroundColor(NFColor.ink3).frame(width: 70, alignment: .trailing)
                    }
                    moveButton("chevron.up", disabled: i == 0) { move(i, i - 1) }
                    moveButton("chevron.down", disabled: i == pages.count - 1) { move(i, i + 1) }
                    if p.key != NMP.picksKey {
                        Button { remove(p.key) } label: {
                            Image(systemName: "trash").font(.system(size: 16, weight: .bold))
                                .foregroundColor(categoryPages.count <= 1 ? NFColor.ink3.opacity(0.5) : NFColor.danger)
                                .frame(width: 44, height: 44)
                                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(categoryPages.count <= 1)
                        .accessibilityLabel("\(label(p, i))を消す")
                    } else {
                        Color.clear.frame(width: 44, height: 44)
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(p.key == NMP.picksKey ? NT.lilac.opacity(0.5) : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            }
            Button(action: add) {
                Label("ページを追加", systemImage: "plus").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                    .padding(.horizontal, 16).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.purple.opacity(0.5), lineWidth: 1.5))
            }
            .buttonStyle(PressableStyle())
            .disabled(pages.count >= NMP.maxPages)
        }
    }

    private func moveButton(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .heavy))
                .foregroundColor(disabled ? NFColor.ink3.opacity(0.4) : NFColor.navy)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
    }

    // MARK: 2. どのページに入れるか

    private func categoriesSection(_ cats: [NMPCategory]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("2. どのページに入れるか").font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.navy)
            ForEach(cats) { c in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.name).font(.system(size: 15, weight: .bold))
                            .foregroundColor(c.hidden ? NFColor.ink3 : NFColor.navy)
                            .strikethrough(c.hidden)
                        Text("\(c.itemCount)品\(c.allZeroPrice && c.itemCount > 0 ? "・全部0円" : "")\(c.drink ? "・ドリンク" : "")")
                            .font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    let current = pageKeyOf(c)
                    Menu {
                        ForEach(Array(pages.enumerated()), id: \.element.key) { i, p in
                            if p.key != NMP.picksKey {
                                Button { map[c.id] = p.key } label: {
                                    if p.key == current { Label(label(p, i), systemImage: "checkmark") } else { Text(label(p, i)) }
                                }
                            }
                        }
                    } label: {
                        let i = pages.firstIndex(where: { $0.key == current })
                        HStack {
                            Text(i.map { label(pages[$0], $0) } ?? "—").lineLimit(1)
                            Spacer(minLength: 6)
                            Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                        }
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink)
                        .padding(.horizontal, 12).frame(width: 200, height: 44)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            }
        }
    }

    // MARK: 操作（Web の MenuPagesEditor と同じ）

    private func rename(_ key: String, _ name: String) {
        if let i = pages.firstIndex(where: { $0.key == key }) { pages[i].name = name }
    }

    private func move(_ from: Int, _ to: Int) {
        guard pages.indices.contains(from), pages.indices.contains(to) else { return }
        withAnimation(.easeOut(duration: 0.15)) { pages.swapAt(from, to) }
    }

    /// 追加するページの key（page1, page2 …。既にある key は飛ばす）
    private func add() {
        guard pages.count < NMP.maxPages else { return }
        let used = Set(pages.map(\.key))
        let key = (1...99).map { "page\($0)" }.first { !used.contains($0) } ?? "page\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))"
        pages.append(NMPPage(key: key, name: ""))
    }

    private func remove(_ key: String) {
        guard key != NMP.picksKey, categoryPages.count > 1 else { return }
        pages.removeAll { $0.key == key }
        for (id, k) in map where k == key { map[id] = nil }
    }

    private func load() async {
        guard loaded == nil else { return }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "menuPages"), URLQueryItem(name: "storeId", value: storeId)]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NMPPayload.self, from: data)
            pages = p.pages
            map = p.categoryPage
            loaded = p
        } catch {
            loadError = (error as? NativeAPIError)?.message ?? "読み込めませんでした。もう一度お試しください"
        }
    }

    private func save() async {
        guard let data = loaded else { return }
        if pages.contains(where: { $0.key != NMP.picksKey && $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) {
            error = "ページの名前を入れてください"
            return
        }
        // 画面に出ている行き先をそのまま保存する（自動の分も固定する）
        var categoryPage: [String: String] = [:]
        for c in data.categories { categoryPage[c.id] = pageKeyOf(c) }
        busy = true
        defer { busy = false }
        do {
            var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: [
                "type": "menuPagesSave",
                "storeId": storeId,
                "pages": pages.map { ["key": $0.key, "name": $0.key == NMP.picksKey ? NMP.picksName : $0.name.trimmingCharacters(in: .whitespaces)] },
                "categoryPage": categoryPage,
            ] as [String: Any])
            let r = try JSONDecoder().decode(NIActResult.self, from: try await NativeAPI.shared.send(req))
            if r.ok {
                error = nil
                onSaved()
            } else {
                error = r.error ?? "保存できませんでした"
            }
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }
}
