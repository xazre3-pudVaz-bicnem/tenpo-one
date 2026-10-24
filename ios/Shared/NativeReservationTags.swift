import SwiftUI
import UIKit

// 予約のキーワード（店舗で登録：10 個・15 文字）と、お客様・予約のタグ（区分ごと・小さいアイコンつき）（2026-10-24 Ronnie）。
// 決まりはサーバーと同じ（lib/reservation-entry.ts の sanitizeKeywords・lib/reservation-tags.ts）。上限はサーバーでも確かめる。
// 予約登録の画面（NativeReservationEntry）と、設定 › 予約台帳設定 › タグ・キーワード で使う。

// MARK: - データ

struct NRWTagDef: Codable, Hashable {
    var label: String
    var icon: String
}

struct NRWTagGroup: Codable, Hashable, Identifiable {
    var key: String
    var label: String
    var visible: Int
    var tags: [NRWTagDef]
    var id: String { key }
}

enum NRWLimits {
    static let keywordCount = 10
    static let keywordLength = 15
    static let tagLength = 15
    static let tagsPerGroup = 30
    static let groups = 10
}

/// アイコンの名前（サーバーと同じ）→ SF Symbols。この iOS に無い印は tag
enum NRWTagIcon {
    static let all: [String] = ["tag", "star", "flag", "wine", "paw", "clock", "leaf", "carrot", "wheat", "alert", "drop", "nut", "egg", "fish",
                                "yen", "gem", "gift", "heart", "briefcase", "party", "sparkles", "people", "family", "flower", "chair", "wheelchair",
                                "stroller", "smoke", "window", "door", "music", "camera"]
    private static let map: [String: [String]] = [
        "tag": ["tag"], "star": ["star"], "flag": ["flag"], "wine": ["wineglass"], "paw": ["pawprint"], "clock": ["clock"],
        "leaf": ["leaf"], "carrot": ["carrot", "leaf"], "wheat": ["allergens", "exclamationmark.circle"], "alert": ["exclamationmark.circle"],
        "drop": ["drop"], "nut": ["allergens", "exclamationmark.circle"], "egg": ["oval.portrait", "circle"], "fish": ["fish"],
        "yen": ["yensign.circle"], "gem": ["diamond"], "gift": ["gift"], "heart": ["heart"], "briefcase": ["briefcase"],
        "party": ["party.popper", "sparkles"], "sparkles": ["sparkles"], "people": ["person.2"], "family": ["figure.2.and.child.holdinghands", "person.3"],
        "flower": ["camera.macro", "leaf"], "chair": ["chair", "chair.lounge"], "wheelchair": ["figure.roll", "figure.walk"], "stroller": ["stroller", "figure.and.child.holdinghands"],
        "smoke": ["smoke", "cloud"], "window": ["window.vertical.open", "square.split.2x1"], "door": ["door.left.hand.open", "door.left.hand.closed"],
        "music": ["music.note"], "camera": ["camera"],
    ]
    private static var resolved: [String: String] = [:]
    static func symbol(_ key: String) -> String {
        if let s = resolved[key] { return s }
        let name = (map[key] ?? ["tag"]).first { UIImage(systemName: $0) != nil } ?? "tag"
        resolved[key] = name
        return name
    }
}

// MARK: - 言葉から印（キーワード・タグ・プランに出す小さなアイコン）
// 2026-10-24 21:18 Ronnie「プランの印を卓の箱に（飲み放題ならビールのグラス、誕生日なら誕生日の印）。
// 予約はキーボードで選ぶので、当たり前のものはキーボードに印つきで」

enum NRWKeywordIcon {
    /// 言葉に含まれる語 → SF Symbols の候補（上から、iPad にあるものを使う）
    private static let rules: [(String, [String])] = [
        ("食べ飲み放題", ["mug.fill"]),
        ("飲み放題", ["mug.fill"]),
        ("食べ放題", ["fork.knife"]),
        ("コース", ["menucard.fill", "list.bullet.rectangle.portrait.fill", "list.bullet.rectangle"]),
        ("誕生日", ["birthday.cake.fill", "gift.fill"]),
        ("記念日", ["heart.fill"]),
        ("お祝い", ["party.popper.fill", "sparkles"]),
        ("デート", ["heart.circle.fill", "heart.fill"]),
        ("接待", ["briefcase.fill"]),
        ("会食", ["briefcase.fill"]),
        ("子連れ", ["figure.2.and.child.holdinghands", "person.3.fill"]),
        ("子供", ["figure.2.and.child.holdinghands", "person.3.fill"]),
        ("車いす", ["figure.roll", "figure.walk"]),
        ("ベビーカー", ["stroller.fill", "stroller"]),
        ("ペット", ["pawprint.fill"]),
        ("VIP", ["crown.fill", "star.fill"]),
        ("個室", ["door.left.hand.closed"]),
        ("デザート", ["cup.and.saucer.fill"]),
        ("クーポン", ["ticket.fill"]),
        ("ポイント", ["p.circle.fill"]),
        ("アレルギー", ["exclamationmark.triangle.fill"]),
        ("喫煙", ["smoke.fill", "cloud.fill"]),
        ("禁煙", ["nosign"]),
    ]
    private static var cache: [String: String?] = [:]

    /// 言葉に合う印（無ければ nil）
    static func symbol(for text: String) -> String? {
        if let hit = cache[text] { return hit }
        var found: String? = nil
        for (word, names) in rules where text.contains(word) {
            found = names.first { UIImage(systemName: $0) != nil }
            if found != nil { break }
        }
        cache[text] = found
        return found
    }

    /// 卓のモード（伝票メモ：drink 飲み放題・buffet 食べ放題・food 食べ飲み放題・course コース）の印
    static func planSymbols(_ plans: [String]) -> [String] {
        var out: [String] = []
        for p in plans {
            switch p {
            case "drink": out.append(symbol(for: "飲み放題") ?? "mug.fill")
            case "buffet": out.append(symbol(for: "食べ放題") ?? "fork.knife")
            case "food": out += [symbol(for: "飲み放題") ?? "mug.fill", symbol(for: "食べ放題") ?? "fork.knife"]
            case "course": out.append(symbol(for: "コース") ?? "list.bullet.rectangle")
            default: break
            }
        }
        return out
    }
}

/// どの店でも使う「当たり前」のもの（予約のキーボードのいちばん上に印つきで。店のキーワード 10 個とは別）
enum NRWStandardKeys {
    static let list = ["飲み放題", "食べ放題", "コース", "誕生日", "記念日", "子連れ"]
}

/// 「当たり前」のもののボタン（印つき。押すと選ぶ／外す）
struct NRWStandardKeysPicker: View {
    @Binding var selected: [String]
    var columns: Int = 3
    var height: CGFloat = 52

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8) {
            ForEach(NRWStandardKeys.list, id: \.self) { k in
                let on = selected.contains(k)
                Button { if on { selected.removeAll { $0 == k } } else { selected.append(k) } } label: {
                    HStack(spacing: 6) {
                        if let ic = NRWKeywordIcon.symbol(for: k) { Image(systemName: ic).font(.system(size: 15, weight: .semibold)) }
                        Text(k).font(.system(size: 14, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .foregroundColor(on ? NLColor.navy : NLColor.ink)
                    .frame(maxWidth: .infinity).frame(height: height)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NLColor.yellow : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? NLColor.yellow : NLColor.line, lineWidth: 1.5))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

// MARK: - 折り返して並べる（チップ用）

struct NRWFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 600
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += lineH + lineSpacing; lineH = 0 }
            x += s.width + spacing
            maxX = max(maxX, x - spacing)
            lineH = max(lineH, s.height)
        }
        return CGSize(width: proposal.width ?? maxX, height: y + lineH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += lineH + lineSpacing; lineH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            lineH = max(lineH, s.height)
        }
    }
}

/// 小さいアイコンつきのチップ（押すと選ぶ／はずす）
struct NRWTagChip: View {
    let label: String
    var icon: String? = nil
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: NRWTagIcon.symbol(icon)).font(.system(size: 12, weight: .semibold)) }
                Text(label).font(.system(size: 14, weight: .bold)).lineLimit(1)
                if on { Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)) }
            }
            .foregroundColor(on ? .white : NLColor.ink)
            .padding(.horizontal, 13).frame(height: 38)
            .background(Capsule().fill(on ? NLColor.navy : Color.white))
            .overlay(Capsule().stroke(on ? NLColor.navy : NLColor.line, lineWidth: 1.5))
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - 区分ごとのタグ（予約登録）

struct NRWTagGroupsPicker: View {
    let groups: [NRWTagGroup]
    @Binding var selected: [String]
    @State private var closed: Set<String> = []
    @State private var more: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(groups) { g in
                VStack(alignment: .leading, spacing: 10) {
                    Button {
                        withAnimation(.easeOut(duration: 0.15)) { if closed.contains(g.key) { closed.remove(g.key) } else { closed.insert(g.key) } }
                    } label: {
                        HStack(spacing: 8) {
                            Text(g.label).font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.navy)
                            let n = g.tags.filter { selected.contains($0.label) }.count
                            if n > 0 {
                                Text("\(n)").font(.system(size: 11, weight: .heavy)).foregroundColor(NLColor.navy)
                                    .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NLColor.yellow))
                            }
                            Spacer()
                            Image(systemName: closed.contains(g.key) ? "chevron.down" : "chevron.up").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if !closed.contains(g.key) {
                        let showAll = g.visible <= 0 || more.contains(g.key) || g.tags.count <= g.visible
                        // 「もっと見る」で隠れているものでも、選んでいるものは出す
                        let shown = showAll ? g.tags : g.tags.enumerated().filter { $0.offset < g.visible || selected.contains($0.element.label) }.map(\.element)
                        NRWFlow {
                            ForEach(shown, id: \.label) { t in
                                NRWTagChip(label: t.label, icon: t.icon, on: selected.contains(t.label)) { toggle(t.label) }
                            }
                        }
                        if g.visible > 0 && g.tags.count > g.visible {
                            Button { withAnimation(.easeOut(duration: 0.15)) { if more.contains(g.key) { more.remove(g.key) } else { more.insert(g.key) } } } label: {
                                HStack(spacing: 4) {
                                    Text(more.contains(g.key) ? "閉じる" : "もっと見る（\(g.tags.count - g.visible)）")
                                    Image(systemName: more.contains(g.key) ? "chevron.up" : "chevron.down")
                                }
                                .font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.blue)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if g.key != groups.last?.key { Rectangle().fill(NLColor.line).frame(height: 1) }
            }
        }
    }

    private func toggle(_ label: String) {
        if selected.contains(label) { selected.removeAll { $0 == label } } else { selected.append(label) }
    }
}

// MARK: - キーワード（選ぶ・その場で足す／消す／並べ替える）

struct NRWKeywordsEditor: View {
    @Binding var keywords: [String]
    /// 予約登録では選んだキーワード。設定では nil（選ばない）
    var selected: Binding<[String]>? = nil
    var startEditing = false
    /// 保存（サーバーが確かめた一覧を返す。エラーは文字）
    let save: ([String]) async -> Result<[String], NRWSaveError>

    @State private var editing = false
    @State private var newText = ""
    @State private var problem: String?
    @State private var saving = false
    @FocusState private var inputFocused: Bool

    private var full: Bool { keywords.count >= NRWLimits.keywordCount }
    private var trimmed: String { newText.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var duplicate: Bool { keywords.contains(trimmed) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("キーワード").font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("\(keywords.count)/\(NRWLimits.keywordCount)").font(.system(size: 12, weight: .bold)).monospacedDigit().foregroundColor(full ? NLColor.red : NLColor.muted)
                if selected != nil { Text("（いくつでも選べます）").font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.muted) }
                Spacer()
                if saving { ProgressView().scaleEffect(0.7) }
                Button { withAnimation(.easeOut(duration: 0.15)) { editing.toggle(); problem = nil } } label: {
                    HStack(spacing: 4) {
                        Image(systemName: editing ? "checkmark" : "pencil")
                        Text(editing ? "完了" : "編集・追加")
                    }
                    .font(.system(size: 13, weight: .heavy)).foregroundColor(NLColor.navy)
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(Capsule().fill(editing ? NLColor.yellow : NLColor.page))
                    .overlay(Capsule().stroke(editing ? NLColor.yellow : NLColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
            if editing { editor } else { chips }
            if let problem { Text(problem).font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.red) }
        }
        .onAppear { if startEditing { editing = true } }
    }

    private var chips: some View {
        Group {
            if keywords.isEmpty {
                Text("キーワードはまだありません。「編集・追加」から 10 個まで登録できます").font(.system(size: 13, weight: .semibold)).foregroundColor(NLColor.muted)
            } else {
                NRWFlow {
                    ForEach(keywords, id: \.self) { k in
                        if let sel = selected {
                            NRWTagChip(label: k, icon: "tag", on: sel.wrappedValue.contains(k)) {
                                if sel.wrappedValue.contains(k) { sel.wrappedValue.removeAll { $0 == k } } else { sel.wrappedValue.append(k) }
                            }
                        } else {
                            NRWTagChip(label: k, icon: "tag", on: false) {}
                                .disabled(true)
                        }
                    }
                }
            }
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(keywords.enumerated()), id: \.element) { i, k in
                HStack(spacing: 8) {
                    Image(systemName: "tag").font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.muted)
                    Text(k).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.ink).lineLimit(1)
                    Spacer()
                    iconButton("chevron.up", disabled: i == 0) { move(i, by: -1) }
                    iconButton("chevron.down", disabled: i == keywords.count - 1) { move(i, by: 1) }
                    iconButton("trash", tint: NLColor.red) { remove(k) }
                }
                .padding(.horizontal, 12).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.page))
            }
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    TextField(full ? "キーワードは 10 個までです" : "新しいキーワード", text: $newText)
                        .font(.system(size: 16)).focused($inputFocused)
                        .disabled(full)
                        .submitLabel(.done)
                        .onSubmit { Task { await add() } }
                        .onChange(of: newText) { v in
                            if v.count > NRWLimits.keywordLength { newText = String(v.prefix(NRWLimits.keywordLength)) }
                        }
                    Text("\(newText.count)/\(NRWLimits.keywordLength)").font(.system(size: 12, weight: .bold)).monospacedDigit()
                        .foregroundColor(newText.count >= NRWLimits.keywordLength ? NLColor.red : NLColor.muted)
                }
                .padding(.horizontal, 12).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
                Button { Task { await add() } } label: {
                    HStack(spacing: 4) { Image(systemName: "plus"); Text("追加") }
                        .font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.navy)
                        .padding(.horizontal, 16).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.yellow.opacity(canAdd ? 1 : 0.35)))
                }
                .buttonStyle(PressableStyle())
                .disabled(!canAdd)
            }
            if full {
                Text("キーワードは 10 個までです").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.red)
            } else if !trimmed.isEmpty && duplicate {
                Text("同じキーワードがあります").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.red)
            }
        }
    }

    private var canAdd: Bool { !saving && !full && !trimmed.isEmpty && !duplicate }

    private func iconButton(_ name: String, tint: Color = NLColor.navy, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).font(.system(size: 13, weight: .bold)).foregroundColor(disabled ? NLColor.gray.opacity(0.5) : tint)
                .frame(width: 36, height: 34)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || saving)
    }

    private func add() async {
        guard canAdd else { return }
        let t = trimmed
        if await commit(keywords + [t]) { newText = "" }
    }

    private func remove(_ k: String) {
        Task {
            _ = await commit(keywords.filter { $0 != k })
            selected?.wrappedValue.removeAll { $0 == k }
        }
    }

    private func move(_ i: Int, by d: Int) {
        let j = i + d
        guard j >= 0, j < keywords.count else { return }
        var list = keywords
        list.swapAt(i, j)
        Task { _ = await commit(list) }
    }

    @discardableResult
    private func commit(_ list: [String]) async -> Bool {
        saving = true
        defer { saving = false }
        let before = keywords
        keywords = list
        switch await save(list) {
        case .success(let saved):
            keywords = saved
            problem = nil
            return true
        case .failure(let e):
            keywords = before
            problem = e.message
            return false
        }
    }
}

struct NRWSaveError: Error { let message: String }

enum NRWLabelsApi {
    static func saveKeywords(_ list: [String]) async -> Result<[String], NRWSaveError> {
        let r = await NSPApi.postJSON(["type": "ledgerKeywordsSave", "keywords": list])
        guard r.ok else { return .failure(NRWSaveError(message: r.error ?? "キーワードを保存できませんでした")) }
        return .success((r.json?["keywords"] as? [String]) ?? list)
    }

    static func saveTagGroups(_ groups: [NRWTagGroup]?) async -> Result<[NRWTagGroup], NRWSaveError> {
        var body: [String: Any] = ["type": "ledgerTagGroupsSave"]
        if let groups {
            body["groups"] = groups.map { g in
                ["key": g.key, "label": g.label, "visible": g.visible, "tags": g.tags.map { ["label": $0.label, "icon": $0.icon] }] as [String: Any]
            }
        } else {
            body["groups"] = NSNull()
        }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { return .failure(NRWSaveError(message: r.error ?? "タグを保存できませんでした")) }
        if let raw = r.json?["tagGroups"], let data = try? JSONSerialization.data(withJSONObject: raw), let gs = try? JSONDecoder().decode([NRWTagGroup].self, from: data) {
            return .success(gs)
        }
        return .success(groups ?? [])
    }
}

// MARK: - 設定 › 予約台帳設定 › タグ・キーワード

struct NRWLabelsSettings: View {
    @State private var keywords: [String] = []
    @State private var groups: [NRWTagGroup] = []
    @State private var loaded = false
    @State private var problem: String?
    @State private var dirty = false
    @State private var saving = false
    @State private var newTag: [String: String] = [:]
    @State private var newTagIcon: [String: String] = [:]
    @State private var confirmReset = false
    @State private var toast: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !loaded {
                HStack { Spacer(); ProgressView("読み込み中…"); Spacer() }.padding(.vertical, 40)
            } else {
                card {
                    NRWKeywordsEditor(keywords: $keywords, save: NRWLabelsApi.saveKeywords)
                    Text("予約につけるラベルです。1 店舗 10 個まで・1 つ 15 文字まで。予約登録の画面からも足せます。")
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.muted)
                }
                card {
                    HStack(spacing: 10) {
                        Text("お客様・予約のタグ").font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.navy)
                        Text("区分ごと（キーワードとは別）").font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.muted)
                        Spacer()
                        Button("既定に戻す") { confirmReset = true }.font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red)
                        Button { Task { await saveGroups() } } label: {
                            Text(saving ? "保存中…" : "保存する").font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.navy)
                                .padding(.horizontal, 18).frame(height: 40)
                                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.yellow.opacity(dirty ? 1 : 0.4)))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(!dirty || saving)
                    }
                    ForEach($groups) { $g in groupEditor($g) }
                    if groups.count < NRWLimits.groups {
                        Button {
                            groups.append(NRWTagGroup(key: "custom-\(Int(Date().timeIntervalSince1970))", label: "新しい区分", visible: 0, tags: []))
                            dirty = true
                        } label: {
                            HStack(spacing: 6) { Image(systemName: "plus.circle"); Text("区分を足す") }
                                .font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.blue)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red) }
            if let toast { Text(toast).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.green) }
        }
        .task { await load() }
        .alert("タグを既定に戻しますか？", isPresented: $confirmReset) {
            Button("戻す", role: .destructive) { Task { await reset() } }
            Button("やめる", role: .cancel) {}
        } message: { Text("足したタグ・区分は消えます（もう付いている予約のタグは消えません）") }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) { content() }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NLColor.line, lineWidth: 1))
    }

    private func groupEditor(_ g: Binding<NRWTagGroup>) -> some View {
        let key = g.wrappedValue.key
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TextField("区分の名前", text: Binding(get: { g.wrappedValue.label }, set: { g.wrappedValue.label = String($0.prefix(15)); dirty = true }))
                    .font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.navy)
                    .padding(.horizontal, 10).frame(height: 40).frame(maxWidth: 260)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NLColor.page))
                Text("\(g.wrappedValue.tags.count)/\(NRWLimits.tagsPerGroup)").font(.system(size: 12, weight: .bold)).monospacedDigit().foregroundColor(NLColor.muted)
                Spacer()
                Button { groups.removeAll { $0.key == key }; dirty = true } label: {
                    Image(systemName: "trash").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red)
                }
                .buttonStyle(.plain)
            }
            NRWFlow {
                ForEach(Array(g.wrappedValue.tags.enumerated()), id: \.element.label) { i, t in
                    HStack(spacing: 6) {
                        Menu {
                            ForEach(NRWTagIcon.all, id: \.self) { ic in
                                Button { g.wrappedValue.tags[i].icon = ic; dirty = true } label: { Label(ic, systemImage: NRWTagIcon.symbol(ic)) }
                            }
                        } label: {
                            Image(systemName: NRWTagIcon.symbol(t.icon)).font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.navy)
                        }
                        Text(t.label).font(.system(size: 14, weight: .bold)).foregroundColor(NLColor.ink)
                        Button { g.wrappedValue.tags.remove(at: i); dirty = true } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundColor(NLColor.gray)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12).frame(height: 38)
                    .background(Capsule().fill(Color.white))
                    .overlay(Capsule().stroke(NLColor.line, lineWidth: 1.5))
                }
            }
            HStack(spacing: 8) {
                Menu {
                    ForEach(NRWTagIcon.all, id: \.self) { ic in
                        Button { newTagIcon[key] = ic } label: { Label(ic, systemImage: NRWTagIcon.symbol(ic)) }
                    }
                } label: {
                    Image(systemName: NRWTagIcon.symbol(newTagIcon[key] ?? "tag")).font(.system(size: 15, weight: .semibold)).foregroundColor(NLColor.navy)
                        .frame(width: 42, height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.page))
                }
                let text = newTag[key] ?? ""
                HStack(spacing: 6) {
                    TextField("タグを足す", text: Binding(get: { newTag[key] ?? "" }, set: { newTag[key] = String($0.prefix(NRWLimits.tagLength)) }))
                        .font(.system(size: 15))
                        .onSubmit { addTag(g) }
                    Text("\(text.count)/\(NRWLimits.tagLength)").font(.system(size: 11, weight: .bold)).monospacedDigit().foregroundColor(NLColor.muted)
                }
                .padding(.horizontal, 10).frame(height: 42).frame(maxWidth: 320)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
                Button { addTag(g) } label: {
                    HStack(spacing: 4) { Image(systemName: "plus"); Text("追加") }
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                        .padding(.horizontal, 14).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.yellowSoft))
                }
                .buttonStyle(PressableStyle())
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || g.wrappedValue.tags.count >= NRWLimits.tagsPerGroup)
                Spacer()
            }
            Rectangle().fill(NLColor.line).frame(height: 1)
        }
    }

    private func addTag(_ g: Binding<NRWTagGroup>) {
        let key = g.wrappedValue.key
        let t = (newTag[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, g.wrappedValue.tags.count < NRWLimits.tagsPerGroup else { return }
        guard !g.wrappedValue.tags.contains(where: { $0.label == t }) else { problem = "同じタグがあります（\(t)）"; return }
        g.wrappedValue.tags.append(NRWTagDef(label: t, icon: newTagIcon[key] ?? "tag"))
        newTag[key] = ""
        problem = nil
        dirty = true
    }

    private func load() async {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Tokyo"); f.dateFormat = "yyyy-MM-dd"
        comps.queryItems = [URLQueryItem(name: "part", value: "ledgerEntry"), URLQueryItem(name: "date", value: f.string(from: Date()))]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let e = try JSONDecoder().decode(NRWEntry.self, from: data)
            keywords = e.keywords
            groups = e.tagGroups
            loaded = true
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "読み込めませんでした"
            loaded = true
        }
    }

    private func saveGroups() async {
        saving = true
        defer { saving = false }
        switch await NRWLabelsApi.saveTagGroups(groups) {
        case .success(let gs): groups = gs; dirty = false; problem = nil; toast = "タグを保存しました"
        case .failure(let e): problem = e.message
        }
    }

    private func reset() async {
        saving = true
        defer { saving = false }
        switch await NRWLabelsApi.saveTagGroups(nil) {
        case .success(let gs): groups = gs; dirty = false; problem = nil; toast = "既定に戻しました"
        case .failure(let e): problem = e.message
        }
    }
}
