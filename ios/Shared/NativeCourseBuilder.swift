import SwiftUI

// コース／放題プランを作る（設定 › プラン。2026-10-25 Ronnie「プランとコースを分けて、コースをここで足せるように。
// 注文の画面にも出るように。料理の名前は何品でも、追加で1行ずつ（料理はコースの値段に入っているので ¥0）。
// 最後に 選べるメイン も。コースはできるだけかんたんに。放題（プラン）も見て」）。
// 保存は POST { type: "courseBuilderSave", kind, course, steps, main, planKind, planCategoryIds }
// （lib/course-builder.ts で中身を確かめ、lib/course-builder-server.ts が Web と同じ Server Action を順に呼ぶ）。

/// コースの料理（出す順）。GET ?part=menuItems の courseSteps
struct NMIDish: Codable, Hashable { let id: String; let name: String; let hidden: Bool? }
/// 選べるメインの選択肢
struct NMIMainChoice: Codable, Hashable { let id: String; let name: String; let price: Double }
/// コースの選べるメイン（必須・1つ選ぶ選択肢グループ）
struct NMIMain: Codable, Hashable { let groupId: String; let name: String; let choices: [NMIMainChoice] }

/// 料理の1行（dishId があればメニューの商品、無ければ名前で ¥0・非表示の料理を作る）
struct NCBStepRow: Identifiable, Equatable { let id: String; var dishId: String?; var name: String }
/// 選べるメインの1行
struct NCBChoiceRow: Identifiable, Equatable { let id: String; var name: String; var price: String }

@MainActor
final class NativeCourseBuilderModel: ObservableObject {
    enum Kind: String { case course, plan }

    @Published var kind: Kind = .course
    let editing: NMIItem?
    // 基本
    @Published var name = ""
    @Published var nameEn = ""
    @Published var price = ""
    @Published var duration = "120"
    @Published var taxId: String? = nil
    /// nil は既定のカテゴリ（「コース」「飲み放題プラン」…）を作って使う
    @Published var categoryId: String? = nil
    @Published var hidden = false
    /// 放題の種類：drink（飲み放題）／food（食べ放題）／both（食べ飲み放題）
    @Published var planKind = "drink"
    /// コース：飲み放題つき（フロアに「飲放」）
    @Published var withDrinks = false
    let withAyce: Bool
    // 料理（出す順）
    @Published var steps: [NCBStepRow] = []
    /// 候補（メニューにある料理）を出している行
    @Published var activeStep: String? = nil
    // 選べるメイン
    @Published var mainOn = false
    @Published var choices: [NCBChoiceRow] = []
    // ハンディ・お客様QRに出すカテゴリ
    @Published var catSpecified = false
    @Published var catIds: [String] = []
    // 保存
    @Published var busy = false
    @Published var error: String? = nil
    /// 保存できたが一部うまくいかなかったこと（コースは保存ずみ）
    @Published var notice: String? = nil

    let categories: [NMICategory]
    let taxRates: [NFNamed]
    /// 料理に選べるメニューの商品（フード・ドリンク。非表示の料理も）
    let dishOptions: [NMIItem]
    let planOnly: Set<String>
    let maxSteps: Int
    let maxChoices: Int
    let canEditOptions: Bool
    let canEdit: Bool

    init(kind: Kind, item: NMIItem?, payload p: NMIPayload) {
        editing = item
        categories = p.categories.sorted { $0.sortOrder < $1.sortOrder }
        taxRates = p.taxRates
        dishOptions = p.items.filter { $0.itemType == "food" || $0.itemType == "drink" }
        planOnly = Set(p.planOnlyCategoryIds ?? [])
        maxSteps = p.maxCourseSteps ?? 30
        maxChoices = p.maxMainChoices ?? 20
        canEditOptions = p.canEditOptions ?? p.canEdit
        canEdit = p.canEdit
        withAyce = item?.includesAyce ?? false
        self.kind = kind
        if let i = item {
            name = i.name
            nameEn = i.nameEn
            price = NativeMenuItemsModel.num(i.price)
            duration = NativeMenuItemsModel.num(i.durationMinutes)
            taxId = i.taxRateId
            hidden = i.status == "hidden"
            planKind = Self.planKindOf(i) ?? "drink"
            withDrinks = i.includesDrinks ?? false
            // カテゴリの無いコースは注文の画面のタブに出ない → 既定のカテゴリ（無ければ保存のときに作る）にする
            let current = categories.first { $0.id == i.categoryId }?.id
            categoryId = current ?? defaultCategory()?.id
            let dishes = p.courseSteps?[i.id] ?? []
            steps = dishes.map { NCBStepRow(id: UUID().uuidString, dishId: $0.id, name: $0.name) }
            if let m = p.courseMains?[i.id] {
                mainOn = true
                choices = m.choices.map { NCBChoiceRow(id: UUID().uuidString, name: $0.name, price: $0.price == 0 ? "" : NativeMenuItemsModel.num($0.price)) }
            }
            if let c = p.planCategories?[i.id] {
                catSpecified = true
                catIds = c
            }
        } else {
            categoryId = defaultCategory()?.id
        }
        if steps.isEmpty { steps = [NCBStepRow(id: UUID().uuidString, dishId: nil, name: "")] }
    }

    // MARK: 種類・カテゴリ

    static func planLabel(_ k: String) -> String { k == "food" ? "食べ放題" : (k == "both" ? "食べ飲み放題" : "飲み放題") }

    private static func has(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
    /// 名前が飲み放題・食べ放題（lib/handy-visit.ts の looksLikePlanName と同じ）
    static func looksLikePlan(_ name: String) -> Bool {
        has(name, "飲み放題|飲放|のみほ|食べ放題|食放|食べ飲み放題|食飲放|nomi-?h(o|ou|oo|ō)dai|tabe-?h(o|ou|oo|ō)dai|tabenomi")
    }
    /// 印と名前から放題の種類（lib/course-builder.ts の planKindOf と同じ）
    static func planKindOf(_ i: NMIItem) -> String? {
        let both = has(i.name, "食べ飲み放題|食飲放|tabenomi") || (i.includesDrinks == true && i.includesAyce == true)
        if both { return "both" }
        let drink = i.includesDrinks == true || has(i.name, "飲み放題|飲放|のみほ|nomi-?h(o|ou|oo|ō)dai")
        let food = i.includesAyce == true || has(i.name, "食べ放題|食放|tabe-?h(o|ou|oo|ō)dai")
        if drink && food { return "both" }
        if drink { return "drink" }
        if food { return "food" }
        return nil
    }
    /// 一覧の商品がコースか放題プランか（料理・選べるメインがあればコース。名前が放題・食べ放題の印なら放題プラン）
    static func kindOf(_ i: NMIItem, _ p: NMIPayload) -> Kind {
        if !(p.courseSteps?[i.id] ?? []).isEmpty || p.courseMains?[i.id] != nil { return .course }
        if i.includesAyce == true || looksLikePlan(i.name) { return .plan }
        return .course
    }

    /// カテゴリを選ばないときに使う（無ければ作る）カテゴリの名前（lib/course-builder.ts の defaultCategoryFor と同じ）
    var defaultCategoryName: String {
        if kind == .course { return "コース" }
        if planKind == "food" { return "食べ放題プラン" }
        if planKind == "both" { return "食べ飲み放題プラン" }
        return "飲み放題プラン"
    }
    func defaultCategory() -> NMICategory? { categories.first { $0.name == defaultCategoryName } }
    var categoryLabel: String {
        if let id = categoryId { return categories.first { $0.id == id }?.name ?? "カテゴリ" }
        return "「\(defaultCategoryName)」を新しく作る"
    }

    /// 種類を変える（新しく作るときは、既定のカテゴリも合わせる）
    func setKind(_ k: Kind) {
        let wasDefault = categoryId == nil || categoryId == defaultCategory()?.id
        kind = k
        if wasDefault && editing == nil { categoryId = defaultCategory()?.id }
    }
    func setPlanKind(_ k: String) {
        let wasDefault = categoryId == nil || categoryId == defaultCategory()?.id
        planKind = k
        if wasDefault && editing == nil { categoryId = defaultCategory()?.id }
    }

    // MARK: 料理（出す順）

    static func ordinal(_ n: Int) -> String {
        let mod100 = n % 100
        let suffix: String
        if mod100 >= 11 && mod100 <= 13 { suffix = "th" }
        else if n % 10 == 1 { suffix = "st" }
        else if n % 10 == 2 { suffix = "nd" }
        else if n % 10 == 3 { suffix = "rd" }
        else { suffix = "th" }
        return "\(n)\(suffix)"
    }
    var filledSteps: Int { steps.filter { $0.dishId != nil || !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }.count }

    func addStep() {
        guard steps.count < maxSteps else { return }
        let r = NCBStepRow(id: UUID().uuidString, dishId: nil, name: "")
        steps.append(r)
        activeStep = r.id
    }
    func removeStep(_ id: String) {
        steps.removeAll { $0.id == id }
        if activeStep == id { activeStep = nil }
    }
    func moveStep(_ id: String, _ delta: Int) {
        guard let i = steps.firstIndex(where: { $0.id == id }) else { return }
        let j = i + delta
        guard j >= 0 && j < steps.count else { return }
        steps.swapAt(i, j)
    }
    func stepName(_ id: String) -> String { steps.first { $0.id == id }?.name ?? "" }
    /// 名前を打った。メニューから選んだ料理の名前を変えたら、新しい料理（¥0）になる
    func setStepName(_ id: String, _ v: String) {
        guard let i = steps.firstIndex(where: { $0.id == id }) else { return }
        if steps[i].name == v { return }
        steps[i].name = v
        if let d = steps[i].dishId {
            let linked = dishOptions.first { $0.id == d }?.name
            if linked != v { steps[i].dishId = nil }
        }
        activeStep = id
    }
    /// 打った名前に近いメニューの料理（最大6つ。もう入っている料理は出さない）
    func suggestions(for id: String) -> [NMIItem] {
        guard activeStep == id, let row = steps.first(where: { $0.id == id }), row.dishId == nil else { return [] }
        let q = NativeSoldOutModel.norm(row.name)
        guard !q.isEmpty else { return [] }
        let used = Set(steps.compactMap { $0.dishId })
        let hits = dishOptions.filter { !used.contains($0.id) && (NativeSoldOutModel.norm($0.name).contains(q) || NativeSoldOutModel.norm($0.nameEn).contains(q)) }
        return Array(hits.prefix(6))
    }
    func pick(_ item: NMIItem, for id: String) {
        guard let i = steps.firstIndex(where: { $0.id == id }) else { return }
        steps[i].dishId = item.id
        steps[i].name = item.name
        activeStep = nil
    }

    // MARK: 選べるメイン

    var filledChoices: Int { choices.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }.count }
    func toggleMain() {
        mainOn.toggle()
        if mainOn && choices.isEmpty {
            choices = [NCBChoiceRow(id: UUID().uuidString, name: "", price: ""), NCBChoiceRow(id: UUID().uuidString, name: "", price: "")]
        }
    }
    func addChoice() {
        guard choices.count < maxChoices else { return }
        choices.append(NCBChoiceRow(id: UUID().uuidString, name: "", price: ""))
    }
    func removeChoice(_ id: String) { choices.removeAll { $0.id == id } }
    func moveChoice(_ id: String, _ delta: Int) {
        guard let i = choices.firstIndex(where: { $0.id == id }) else { return }
        let j = i + delta
        guard j >= 0 && j < choices.count else { return }
        choices.swapAt(i, j)
    }
    func choiceName(_ id: String) -> String { choices.first { $0.id == id }?.name ?? "" }
    func setChoiceName(_ id: String, _ v: String) {
        guard let i = choices.firstIndex(where: { $0.id == id }), choices[i].name != v else { return }
        choices[i].name = v
    }
    func choicePrice(_ id: String) -> String { choices.first { $0.id == id }?.price ?? "" }
    func setChoicePrice(_ id: String, _ v: String) {
        guard let i = choices.firstIndex(where: { $0.id == id }), choices[i].price != v else { return }
        choices[i].price = v
    }

    // MARK: 出すカテゴリ

    var planOnlyCategories: [NMICategory] { categories.filter { planOnly.contains($0.id) } }
    var otherCategories: [NMICategory] { categories.filter { !planOnly.contains($0.id) } }
    func toggleCategory(_ id: String) {
        if catIds.contains(id) { catIds.removeAll { $0 == id } } else { catIds.append(id) }
    }

    // MARK: 保存

    private static func priceValue(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return 0 }
        if let v = Int(t) { return v }
        return t
    }

    /// 保存する。閉じてよければ true（一部うまくいかなかったときは notice を出して false）
    func save() async -> Bool {
        error = nil
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { error = kind == .course ? "コース名を入力してください" : "プラン名を入力してください"; return false }
        guard let yen = Int(price.trimmingCharacters(in: .whitespaces)), yen >= 0 else { error = "値段は0以上の数字で入れてください"; return false }
        let d = duration.trimmingCharacters(in: .whitespaces)
        var dur: Any = NSNull()
        if !d.isEmpty {
            guard let m = Int(d) else { error = "時間は分の数字で入れてください"; return false }
            dur = m
        }
        let course: [String: Any] = [
            "id": editing?.id as Any? ?? NSNull(),
            "name": n,
            "nameEn": nameEn,
            "price": yen,
            "durationMinutes": dur,
            "taxRateId": taxId as Any? ?? NSNull(),
            "categoryId": categoryId as Any? ?? NSNull(),
            "hidden": hidden,
            "includesDrinks": withDrinks,
            "includesAyce": withAyce,
        ]
        let cats: Any = catSpecified ? (catIds as Any) : (NSNull() as Any)
        var body: [String: Any] = ["type": "courseBuilderSave", "kind": kind.rawValue, "course": course, "planCategoryIds": cats]
        if kind == .plan {
            body["planKind"] = planKind
        } else {
            body["steps"] = steps.map { row -> [String: Any] in ["dishId": row.dishId as Any? ?? NSNull(), "name": row.name] }
            // オプションの権限が無いときは送らない（サーバーは今のままにする）
            if canEditOptions {
                let list = choices.map { row -> [String: Any] in ["name": row.name, "price": Self.priceValue(row.price)] }
                body["main"] = ["enabled": mainOn, "choices": list] as [String: Any]
            }
        }
        busy = true
        defer { busy = false }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { error = r.error ?? "保存できませんでした"; return false }
        if let w = r.json?["warning"] as? String, !w.isEmpty {
            notice = w
            return false
        }
        return true
    }
}

/// コース／放題プランの作成・編集の画面（設定 › プラン の中に出す）
struct NativeCourseBuilderView: View {
    @ObservedObject var b: NativeCourseBuilderModel
    let onClose: () -> Void
    let onSaved: (String) -> Void
    let onDelete: (NMIItem) -> Void
    /// 販売時間・テイクアウト価格などの今までの編集（この画面に無い項目）
    let onDetail: (NMIItem) -> Void
    @State private var confirmDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            kindBar
            basicsCard
            if b.kind == .course {
                stepsCard
                mainCard
            }
            categoriesCard
            footer
        }
        .alert("保存しました", isPresented: Binding(get: { b.notice != nil }, set: { if !$0 { b.notice = nil } })) {
            Button("OK") { b.notice = nil; onSaved("保存しました") }
        } message: {
            Text(b.notice ?? "")
        }
    }

    // MARK: 上：コース／放題プラン

    private var kindBar: some View {
        HStack(spacing: 8) {
            chip("コース", on: b.kind == .course) { b.setKind(.course) }
            chip("放題プラン（飲み放題・食べ放題）", on: b.kind == .plan) { b.setKind(.plan) }
            Spacer()
        }
    }

    // MARK: 基本

    private var basicsCard: some View {
        let isCourse = b.kind == .course
        let note = isCourse
            ? "値段は1人分。時間はフロアの残り時間と L.O.（終わる30分前）に使います"
            : "値段は1人分。時間はフロアの残り時間と L.O.（終わる30分前）に使います。出すカテゴリは下で選べます"
        return NSPCard(title: isCourse ? "コース" : "放題プラン", en: b.editing == nil ? "新しく作る" : "編集", note: note) {
            VStack(spacing: 0) {
                NSPRow(label: isCourse ? "コース名" : "プラン名", required: true) {
                    NSPInput(text: $b.name, placeholder: isCourse ? "例：おまかせコース" : "例：飲み放題 120分", width: 420)
                }
                if !isCourse {
                    NSPRow(label: "種類") { planKindChips }
                }
                NSPRow(label: "値段（1人）", required: true) {
                    NSPInput(text: $b.price, placeholder: "0", width: 180, keyboard: .numberPad, trailing: "円")
                }
                NSPRow(label: "時間") { durationRow }
                NSPRow(label: "カテゴリ") { categoryMenu }
                if isCourse {
                    NSPRow(label: "飲み放題つき") {
                        HStack(spacing: 10) {
                            NSPToggle(on: b.withDrinks) { b.withDrinks.toggle() }
                            Text(b.withDrinks ? "つき（フロアに「飲放」）" : "なし").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                        }
                    }
                }
                NSPRow(label: "税率") { taxChips }
                NSPRow(label: "英語名") { NSPInput(text: $b.nameEn, placeholder: isCourse ? "Chef's course" : "All-you-can-drink", width: 420) }
                NSPRow(label: "表示") {
                    HStack(spacing: 10) {
                        NSPToggle(on: !b.hidden) { b.hidden.toggle() }
                        Text(b.hidden ? "非表示（レジ・ハンディに出さない）" : "出す（注文の画面の「\(b.categoryLabel)」）")
                            .font(.system(size: 14)).foregroundColor(NFColor.ink2).lineLimit(2)
                    }
                }
            }
        }
    }

    private var planKindChips: some View {
        HStack(spacing: 8) {
            ForEach(["drink", "food", "both"], id: \.self) { k in
                chip(NativeCourseBuilderModel.planLabel(k), on: b.planKind == k) { b.setPlanKind(k) }
            }
        }
    }

    private var durationRow: some View {
        HStack(spacing: 8) {
            NSPInput(text: $b.duration, placeholder: "なし", width: 120, keyboard: .numberPad, trailing: "分")
            ForEach([60, 90, 120, 150, 180], id: \.self) { m in
                chip("\(m)", on: b.duration == String(m)) { b.duration = String(m) }
            }
        }
    }

    private var categoryMenu: some View {
        Menu {
            if b.defaultCategory() == nil {
                Button("「\(b.defaultCategoryName)」を新しく作る") { b.categoryId = nil }
            }
            ForEach(b.categories) { c in
                Button(c.name) { b.categoryId = c.id }
            }
        } label: {
            HStack(spacing: 6) {
                Text(b.categoryLabel).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 14).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private var taxChips: some View {
        WrapLayout(spacing: 8) {
            chip("既定", on: b.taxId == nil) { b.taxId = nil }
            ForEach(b.taxRates) { t in
                chip(t.name, on: b.taxId == t.id) { b.taxId = t.id }
            }
        }
    }

    // MARK: 料理（出す順）

    private var stepsCard: some View {
        let rows = b.steps
        return NSPCard(
            title: "料理（出す順）",
            en: "\(b.filledSteps)品",
            note: "料理の名前を打つだけ。料理はコースの値段に入っているので ¥0 で作ります（レジ・QR には単品で出ません）。コースを注文すると厨房の伝票に 1st・2nd… の順に出ます"
        ) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                    stepRow(i, row, count: rows.count)
                }
                HStack(spacing: 12) {
                    NSPButton(text: "追加", icon: "plus", primary: true, disabled: b.steps.count >= b.maxSteps) { b.addStep() }
                    Text("\(b.steps.count) / \(b.maxSteps) 行").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                    Spacer()
                }
                .padding(18)
            }
        }
    }

    private func stepRow(_ i: Int, _ row: NCBStepRow, count: Int) -> some View {
        let sugg = b.suggestions(for: row.id)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Text(NativeCourseBuilderModel.ordinal(i + 1))
                    .font(.system(size: 15, weight: .heavy)).foregroundColor(NT.purple).monospacedDigit()
                    .frame(width: 44, alignment: .leading)
                NSPInput(text: Binding(get: { b.stepName(row.id) }, set: { b.setStepName(row.id, $0) }), placeholder: "料理の名前（例：前菜の盛り合わせ）", width: 360)
                stepTag(row)
                Spacer(minLength: 4)
                NSPButton(text: "↑", disabled: i == 0) { b.moveStep(row.id, -1) }
                NSPButton(text: "↓", disabled: i == count - 1) { b.moveStep(row.id, 1) }
                NSPButton(text: "消す", icon: "xmark") { b.removeStep(row.id) }
            }
            if !sugg.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Text("メニューから").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.top, 8)
                    WrapLayout(spacing: 6) {
                        ForEach(sugg) { it in
                            Button { b.pick(it, for: row.id) } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "plus.circle.fill")
                                    Text(it.name).lineLimit(1)
                                }
                                .font(.system(size: 13, weight: .bold)).foregroundColor(NT.purple)
                                .padding(.horizontal, 10).frame(height: 32)
                                .background(Capsule().fill(NT.lilac))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
                .padding(.leading, 54)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    @ViewBuilder private func stepTag(_ row: NCBStepRow) -> some View {
        if row.dishId != nil {
            tag("メニュー", NT.purple)
        } else if !row.name.trimmingCharacters(in: .whitespaces).isEmpty {
            tag("新しく ¥0", NFColor.ink3)
        }
    }

    // MARK: 選べるメイン

    private var mainCard: some View {
        let rows = b.choices
        let edit = b.canEditOptions
        return NSPCard(
            title: "選べるメイン",
            en: b.mainOn ? "\(b.filledChoices)種" : "なし",
            note: "注文するときに1つ選びます（必須）。追加料金があれば入れてください。選んだメインは厨房の伝票に出ます"
        ) {
            VStack(spacing: 0) {
                NSPRow(label: "使う") {
                    HStack(spacing: 10) {
                        NSPToggle(on: b.mainOn, disabled: !edit) { b.toggleMain() }
                        Text(b.mainOn ? "使う" : "使わない").font(.system(size: 14, weight: .bold)).foregroundColor(b.mainOn ? NFColor.success : NFColor.ink3)
                    }
                }
                if b.mainOn {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                        choiceRow(i, row, count: rows.count, edit: edit)
                    }
                    HStack(spacing: 12) {
                        NSPButton(text: "追加", icon: "plus", primary: true, disabled: !edit || b.choices.count >= b.maxChoices) { b.addChoice() }
                        Spacer()
                    }
                    .padding(18)
                }
                if !edit {
                    Text("オプションを変える権限がないので、ここは変えられません")
                        .font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(18)
                }
            }
        }
    }

    private func choiceRow(_ i: Int, _ row: NCBChoiceRow, count: Int, edit: Bool) -> some View {
        HStack(spacing: 10) {
            Text("\(i + 1)").font(.system(size: 14, weight: .heavy)).foregroundColor(NFColor.ink3).frame(width: 28)
            NSPInput(text: Binding(get: { b.choiceName(row.id) }, set: { b.setChoiceName(row.id, $0) }), placeholder: "例：牛ステーキ", enabled: edit, width: 300)
            Text("＋").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink3)
            NSPInput(text: Binding(get: { b.choicePrice(row.id) }, set: { b.setChoicePrice(row.id, $0) }), placeholder: "0", enabled: edit, width: 130, keyboard: .numberPad, trailing: "円")
            Spacer(minLength: 4)
            if edit {
                NSPButton(text: "↑", disabled: i == 0) { b.moveChoice(row.id, -1) }
                NSPButton(text: "↓", disabled: i == count - 1) { b.moveChoice(row.id, 1) }
                NSPButton(text: "消す", icon: "xmark") { b.removeChoice(row.id) }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    // MARK: 出すカテゴリ（メニューブックの「プランで出すカテゴリ」と同じ）

    private var categoriesCard: some View {
        let isCourse = b.kind == .course
        let planCats = b.planOnlyCategories
        let otherCats = b.otherCategories
        return NSPCard(
            title: isCourse ? "コースのときに出すカテゴリ" : "このプランで出すカテゴリ",
            en: b.catSpecified ? "\(b.catIds.count)カテゴリ" : "指定なし",
            note: "ハンディ・お客様QRで、伝票にこの\(isCourse ? "コース" : "プラン")が入っているときに出す中身（飲み放題の F など）。指定しないと「プランのときだけ」のカテゴリを全部出します"
        ) {
            VStack(alignment: .leading, spacing: 0) {
                NSPRow(label: "指定する") {
                    HStack(spacing: 10) {
                        NSPToggle(on: b.catSpecified) { b.catSpecified.toggle() }
                        Text(b.catSpecified ? "下で選んだカテゴリだけ" : "指定なし（プランのときだけのカテゴリを全部）")
                            .font(.system(size: 14)).foregroundColor(NFColor.ink2).lineLimit(2)
                    }
                }
                if b.catSpecified {
                    VStack(alignment: .leading, spacing: 10) {
                        if !planCats.isEmpty {
                            Text("プランのときだけのカテゴリ").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            WrapLayout(spacing: 6) {
                                ForEach(planCats) { c in categoryChip(c) }
                            }
                        }
                        if !otherCats.isEmpty {
                            Text("そのほかのカテゴリ").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            WrapLayout(spacing: 6) {
                                ForEach(otherCats) { c in categoryChip(c) }
                            }
                        }
                    }
                    .padding(18)
                }
            }
        }
    }

    private func categoryChip(_ c: NMICategory) -> some View {
        let on = b.catIds.contains(c.id)
        return Button { b.toggleCategory(c.id) } label: {
            Text(c.name).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 34)
                .background(Capsule().fill(on ? NT.purple : Color.white))
                .overlay(Capsule().stroke(on ? NT.purple : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 下：保存

    private var footer: some View {
        let canSave = b.canEdit && !b.name.trimmingCharacters(in: .whitespaces).isEmpty
        return VStack(alignment: .leading, spacing: 8) {
            if let err = b.error {
                Text(err).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                if b.editing != nil && b.canEdit {
                    NSPButton(text: "削除", icon: "trash") { confirmDelete = true }
                    NSPButton(text: "販売時間など") { if let e = b.editing { onDetail(e) } }
                }
                Spacer()
                NSPButton(text: "やめる") { onClose() }
                NSPButton(text: "保存する", icon: "checkmark", primary: true, busy: b.busy, disabled: !canSave) {
                    let what = b.kind == .course ? "コース" : "プラン"
                    let msg = b.hidden ? "\(what)を保存しました（非表示）" : "\(what)を保存しました（注文の画面にも出ます）"
                    Task {
                        if await b.save() { onSaved(msg) }
                    }
                }
            }
        }
        .alert("削除", isPresented: $confirmDelete) {
            Button("削除する", role: .destructive) { if let e = b.editing { onDelete(e) } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("「\(b.editing?.name ?? "")」を削除します（料理・選べるメインはメニュー・オプションに残ります）")
        }
    }

    // MARK: 部品

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 14).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? NT.topBar : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NT.topBar : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func tag(_ t: String, _ c: Color) -> some View {
        Text(t).font(.system(size: 11, weight: .heavy)).foregroundColor(c)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }
}
