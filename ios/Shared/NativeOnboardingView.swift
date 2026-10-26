import SwiftUI
import UIKit

// 初期設定（初期導入ウィザード）のネイティブ。Web の /app/onboarding（wizard.tsx・steps/*.tsx）と同じ 10 段・同じ操作。
// 2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」。
//   1 会社情報 → 2 店舗情報 → 3 営業時間 → 4 テーブル・席 → 5 商品カテゴリー → 6 商品登録 → 7 スタッフ → 8 支払方法 → 9 レジ設定 → 10 完了
//   読み込みは GET ?part=onboarding、保存は POST { type: 'onboarding', action: … }（lib/native-modules/onboarding.ts → app/app/onboarding/actions.ts）
//   進むだけ（戻らない）・「後で設定する」で飛ばせる・保存した段は Web と同じく進捗に残る

struct NOBCompany: Codable, Hashable {
    var name: String
    var nameKana: String
    var postalCode: String
    var address: String
    var phone: String
}
struct NOBStore: Codable, Hashable {
    let id: String
    let name: String
    let address: String
    let phone: String
    let slug: String?
}
struct NOBHour: Codable, Hashable, Identifiable {
    let dayOfWeek: Int
    var isClosed: Bool
    var openTime: String?
    var closeTime: String?
    var id: Int { dayOfWeek }
}
struct NOBCategory: Codable, Identifiable, Hashable { let id: String; let name: String }
struct NOBRole: Codable, Identifiable, Hashable { let id: String; let label: String }
struct NOBPayload: Codable {
    let step: Int
    let completed: Bool
    let company: NOBCompany
    /// 企業の最初の店舗（ウィザードで作る・直す店舗）。まだ無ければ nil
    let store: NOBStore?
    let hours: [NOBHour]
    let existingTablesCount: Int
    let existingCategories: [NOBCategory]
    let existingItemsCount: Int
    let existingStaffCount: Int
    let existingRegisterCount: Int
    let roles: [NOBRole]
}

struct NOBTableRow: Identifiable, Hashable { let id = UUID(); var name = ""; var capacity = 4 }
struct NOBCategoryRow: Identifiable, Hashable { let id = UUID(); var name = "" }
struct NOBItemRow: Identifiable, Hashable { let id = UUID(); var categoryId: String?; var name = ""; var price = "0" }
struct NOBStaffRow: Identifiable, Hashable { let id = UUID(); var email = ""; var displayName = ""; var role = "staff" }
struct NOBInvited: Identifiable, Hashable { let email: String; let password: String; var id: String { email } }
/// メニューで選ぶ（カテゴリー・ロール）
struct NOBOption: Identifiable, Hashable { let id: String; let label: String }

/// 段の名前・曜日（Web の wizard.tsx の STEP_TITLES・WEEKDAY_LABELS と同じ）
enum NOBText {
    static let titles = ["会社情報", "店舗情報", "営業時間", "テーブル・席", "商品カテゴリー", "商品登録", "スタッフ", "支払方法", "レジ設定", "完了"]
    static let weekdays = ["日", "月", "火", "水", "木", "金", "土"]
    static func weekday(_ d: Int) -> String { weekdays[max(0, min(6, d))] }
}

/// 行の 1 つを直す（id で探す。消したあとに古い行を触っても落ちない）
func nobUpdate<Row: Identifiable>(_ rows: inout [Row], _ id: Row.ID, _ change: (inout Row) -> Void) {
    if let i = rows.firstIndex(where: { $0.id == id }) { change(&rows[i]) }
}

/// nil を JSON の null に
private func nobNull(_ s: String?) -> Any {
    if let s { return s }
    return NSNull()
}

@MainActor
final class NativeOnboardingModel: ObservableObject {
    @Published var payload: NOBPayload?
    @Published var loadError: String?
    @Published var step = 1
    /// ウィザードで作った・直している店舗（店舗情報の段で決まる）
    @Published var storeId: String?
    /// 商品登録で選べるカテゴリー（今あるもの＋カテゴリーの段で作ったもの）
    @Published var categories: [NOBCategory] = []
    @Published var busy = false
    /// その段の下に出すエラー
    @Published var error: String?
    @Published var toast: String?
    /// 完了の段で「完了する」を押したあと
    @Published var done = false

    // 入力
    @Published var company = NOBCompany(name: "", nameKana: "", postalCode: "", address: "", phone: "")
    @Published var storeName = ""
    @Published var storeAddress = ""
    @Published var storePhone = ""
    @Published var hours: [NOBHour] = []
    @Published var tables: [NOBTableRow] = [NOBTableRow()]
    @Published var categoryRows: [NOBCategoryRow] = [NOBCategoryRow()]
    @Published var items: [NOBItemRow] = [NOBItemRow()]
    @Published var staff: [NOBStaffRow] = [NOBStaffRow()]
    /// 招待した人と初期パスワード（この画面でしか出ない）
    @Published var invited: [NOBInvited]?

    var title: String { NOBText.titles[max(0, min(NOBText.titles.count - 1, step - 1))] }

    func load() async {
        do {
            let p = try await NativeModuleAPI.get(NOBPayload.self, part: "onboarding")
            apply(p)
            loadError = nil
        } catch {
            if payload == nil { loadError = NativeModuleAPI.message(error) }
        }
    }

    private func apply(_ p: NOBPayload) {
        payload = p
        storeId = p.store?.id
        categories = p.existingCategories
        company = p.company
        storeName = p.store?.name ?? ""
        storeAddress = p.store?.address ?? ""
        storePhone = p.store?.phone ?? ""
        hours = p.hours.count == 7 ? p.hours : (0..<7).map { NOBHour(dayOfWeek: $0, isClosed: false, openTime: "11:00", closeTime: "22:00") }
        goto(min(10, max(1, p.step)))
    }

    /// 次の段へ。Web と同じく、段ごとに入力欄は新しく（テーブル・カテゴリー・商品・スタッフは 1 行から）
    func goto(_ n: Int) {
        error = nil
        switch n {
        case 4: tables = [NOBTableRow()]
        case 5: categoryRows = [NOBCategoryRow()]
        case 6: items = [NOBItemRow(categoryId: categories.first?.id)]
        case 7: staff = [NOBStaffRow()]; invited = nil
        default: break
        }
        step = n
    }

    /// 保存（POST { type: 'onboarding', action, … }）。失敗はその段のエラーに出して nil
    private func send(_ body: [String: Any]) async -> [String: Any]? {
        guard !busy else { return nil }
        busy = true
        defer { busy = false }
        error = nil
        var b = body
        b["type"] = "onboarding"
        let r = await NSPApi.postJSON(b)
        guard r.ok else { error = r.error ?? "保存できませんでした"; return nil }
        return r.json ?? [:]
    }

    /// 「後で設定する」：保存せずに次の段へ
    func skip(to next: Int) async {
        guard await send(["action": "skip", "next": next]) != nil else { return }
        goto(next)
    }

    private var needStore: Bool {
        if storeId == nil { error = "先に店舗情報を登録してください（前のステップへ戻ってください）"; return true }
        return false
    }

    // 1 会社情報
    func saveCompany() async {
        let c = company
        guard await send(["action": "company", "company": ["name": c.name, "nameKana": c.nameKana, "postalCode": c.postalCode, "address": c.address, "phone": c.phone]]) != nil else { return }
        toast = "会社情報を保存しました"
        goto(2)
    }

    // 2 店舗情報
    func saveStore() async {
        if storeName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "店舗名を入力してください"; return }
        guard let r = await send(["action": "store", "storeId": nobNull(storeId), "name": storeName, "address": storeAddress, "phone": storePhone]) else { return }
        if let id = r["storeId"] as? String { storeId = id }
        toast = "店舗情報を保存しました"
        goto(3)
    }

    // 3 営業時間
    func saveHours() async {
        if needStore { return }
        let rows: [[String: Any]] = hours.map { ["dayOfWeek": $0.dayOfWeek, "isClosed": $0.isClosed, "openTime": nobNull($0.openTime), "closeTime": nobNull($0.closeTime)] }
        guard await send(["action": "hours", "storeId": storeId ?? "", "hours": rows]) != nil else { return }
        toast = "営業時間を保存しました"
        goto(4)
    }

    // 4 テーブル・席
    func saveTables() async {
        if needStore { return }
        let rows: [[String: Any]] = tables.map { ["name": $0.name, "capacityMax": $0.capacity] }
        guard await send(["action": "tables", "storeId": storeId ?? "", "tables": rows]) != nil else { return }
        toast = "テーブルを登録しました"
        goto(5)
    }

    // 5 商品カテゴリー
    func saveCategories() async {
        if needStore { return }
        let rows: [[String: Any]] = categoryRows.map { ["name": $0.name] }
        guard let r = await send(["action": "categories", "storeId": storeId ?? "", "categories": rows]) else { return }
        let created = (r["created"] as? [[String: Any]] ?? []).compactMap { d -> NOBCategory? in
            guard let id = d["id"] as? String, let name = d["name"] as? String else { return nil }
            return NOBCategory(id: id, name: name)
        }
        categories += created
        toast = "カテゴリーを登録しました"
        goto(6)
    }

    // 6 商品登録
    func saveItems() async {
        if needStore { return }
        let rows: [[String: Any]] = items.map { (i: NOBItemRow) -> [String: Any] in
            let price = Int(i.price.trimmingCharacters(in: .whitespaces)) ?? 0
            return ["categoryId": nobNull(i.categoryId), "name": i.name, "price": price]
        }
        guard await send(["action": "items", "storeId": storeId ?? "", "items": rows]) != nil else { return }
        toast = "商品を登録しました（税率10%を自動適用しました）"
        goto(7)
    }

    // 7 スタッフ
    func saveStaff() async {
        let rows: [[String: Any]] = staff.map { ["email": $0.email, "displayName": $0.displayName, "role": $0.role] }
        guard let r = await send(["action": "staff", "entries": rows]) else { return }
        let list = (r["invited"] as? [[String: Any]] ?? []).compactMap { d -> NOBInvited? in
            guard let e = d["email"] as? String, let pw = d["password"] as? String else { return nil }
            return NOBInvited(email: e, password: pw)
        }
        if list.isEmpty {
            goto(8)
        } else {
            invited = list
            toast = "スタッフを招待しました"
        }
    }

    // 8 支払方法（案内だけ）
    func advancePayments() async {
        guard await send(["action": "payments"]) != nil else { return }
        goto(9)
    }

    // 9 レジ設定
    func saveRegister() async {
        if needStore { return }
        guard await send(["action": "register", "storeId": storeId ?? ""]) != nil else { return }
        toast = (payload?.existingRegisterCount ?? 0) > 0 ? "次へ進みます" : "レジ1を作成しました"
        goto(10)
    }

    // 10 完了
    func complete() async {
        guard await send(["action": "complete"]) != nil else {
            // Web はトーストで出す
            if let e = error { toast = e; error = nil }
            return
        }
        done = true
        toast = "初期設定が完了しました"
    }
}

struct NativeOnboardingView: View {
    let onHome: () -> Void
    @StateObject private var model = NativeOnboardingModel()
    @EnvironmentObject var state: AppState

    private static let times = NSPApi.timeOptions(toMin: 23 * 60 + 45)

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "初期設定", subtitle: "", onHome: onHome)
            if model.payload != nil {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header
                        stepBody
                    }
                    .padding(20)
                    .frame(maxWidth: 860)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 30)
                }
            } else if let e = model.loadError {
                Spacer()
                VStack(spacing: 10) {
                    Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center)
                    Button("もう一度") { Task { await model.load() } }
                }
                .padding(.horizontal, 30)
                Spacer()
            } else {
                Spacer()
                ProgressView("読み込み中…").tint(NFColor.iris)
                Spacer()
            }
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22).fill(NFColor.navy.opacity(0.92)))
                    .padding(.horizontal, 40).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .task { await model.load() }
    }

    // MARK: 上：題・ステップ・進み具合（10 本の線）

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("初期導入ウィザード").font(.system(size: 22, weight: NT.strong)).foregroundColor(NFColor.navy)
            Text("ステップ \(model.step) / 10 — \(model.title)").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink3)
            HStack(spacing: 4) {
                ForEach(1...10, id: \.self) { n in
                    Capsule().fill(n <= model.step ? NT.purple : NT.line).frame(height: 6)
                }
            }
            .padding(.top, 6)
            .animation(.easeOut(duration: 0.2), value: model.step)
        }
    }

    @ViewBuilder private var stepBody: some View {
        switch model.step {
        case 1: companyStep
        case 2: storeStep
        case 3: hoursStep
        case 4: tablesStep
        case 5: categoriesStep
        case 6: itemsStep
        case 7: staffStep
        case 8: paymentsStep
        case 9: registerStep
        default: completeStep
        }
    }

    // MARK: 共通

    private func stepCard<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        // NSPCard は中身を後で作る（escaping）ので、先に作っておく
        let inner = content()
        return NSPCard(title: title) {
            VStack(alignment: .leading, spacing: 0) {
                inner
                if let e = model.error {
                    Text(e).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 20).padding(.top, 12)
                }
            }
            .padding(.bottom, 4)
        }
    }

    /// 下のボタン（後で設定する／次へ）
    private func footer(skip: Int?, next: String = "次へ", busyText: String = "保存中…", action: @escaping () async -> Void) -> some View {
        HStack(spacing: 10) {
            Spacer()
            if let skip {
                NSPButton(text: "後で設定する", disabled: model.busy) { Task { await model.skip(to: skip) } }
            }
            NSPButton(text: model.busy ? busyText : next, primary: true, busy: model.busy) { Task { await action() } }
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
    }

    private func info(_ s: String) -> some View {
        Text(s).font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.irisDeep)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.irisSoft))
    }

    private func note(_ s: String) -> some View {
        Text(s).font(.system(size: 13)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
    }

    private func paragraph(_ s: String) -> some View {
        Text(s).font(.system(size: 15)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
    }

    private func trash(disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "trash").font(.system(size: 16, weight: .semibold)).foregroundColor(disabled ? NFColor.ink3.opacity(0.4) : NFColor.danger)
                .frame(width: 46, height: 46)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .accessibilityLabel("削除")
    }

    private func addRow(_ action: @escaping () -> Void) -> some View {
        NSPButton(text: "行を追加", icon: "plus", action: action)
    }

    private func fieldLabel(_ s: String) -> some View {
        Text(s).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
    }

    /// メニューで選ぶ（カテゴリー・ロール）
    private func pickMenu(_ label: String, width: CGFloat, options: [NOBOption], pick: @escaping (String) -> Void) -> some View {
        Menu {
            ForEach(options) { o in Button(o.label) { pick(o.id) } }
        } label: {
            HStack(spacing: 6) {
                Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink).lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 12).frame(width: width, height: 46)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
    }

    // MARK: 1 会社情報

    private var companyStep: some View {
        stepCard("会社情報を入力してください") {
            NSPRow(label: "会社名") { NSPInput(text: $model.company.name, placeholder: "株式会社〇〇") }
            NSPRow(label: "会社名（カナ）") { NSPInput(text: $model.company.nameKana, placeholder: "カブシキガイシャ〇〇") }
            NSPRow(label: "郵便番号") { NSPInput(text: $model.company.postalCode, placeholder: "123-4567", width: 200, keyboard: .numbersAndPunctuation) }
            NSPRow(label: "住所") { NSPInput(text: $model.company.address, placeholder: "東京都…") }
            NSPRow(label: "電話番号") { NSPInput(text: $model.company.phone, placeholder: "03-0000-0000", width: 260, keyboard: .phonePad) }
            footer(skip: 2) { await model.saveCompany() }
        }
    }

    // MARK: 2 店舗情報

    private var storeStep: some View {
        stepCard("最初の店舗を登録してください") {
            NSPRow(label: "店舗名", required: true) { NSPInput(text: $model.storeName, placeholder: "〇〇 新宿店") }
            NSPRow(label: "住所") { NSPInput(text: $model.storeAddress, placeholder: "東京都…") }
            NSPRow(label: "電話番号") { NSPInput(text: $model.storePhone, placeholder: "03-0000-0000", width: 260, keyboard: .phonePad) }
            footer(skip: 3) { await model.saveStore() }
        }
    }

    // MARK: 3 営業時間

    private var hoursStep: some View {
        stepCard("曜日別の営業時間（既定 11:00〜22:00）") {
            ForEach(model.hours, id: \.dayOfWeek) { h in
                HStack(spacing: 14) {
                    Text("\(NOBText.weekday(h.dayOfWeek))曜日")
                        .font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink).frame(width: 70, alignment: .leading)
                    HStack(spacing: 8) {
                        NSPToggle(on: h.isClosed) { nobUpdate(&model.hours, h.dayOfWeek) { $0.isClosed.toggle() } }
                        Text("定休日").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                    }
                    .frame(width: 130, alignment: .leading)
                    Spacer(minLength: 0)
                    fieldLabel("開店")
                    NSPTimeMenu(value: h.openTime, options: Self.times, disabled: h.isClosed) { v in nobUpdate(&model.hours, h.dayOfWeek) { $0.openTime = v } }
                    fieldLabel("閉店")
                    NSPTimeMenu(value: h.closeTime, options: Self.times, disabled: h.isClosed) { v in nobUpdate(&model.hours, h.dayOfWeek) { $0.closeTime = v } }
                }
                .padding(.horizontal, 20).padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1).padding(.horizontal, 20) }
            }
            footer(skip: 4) { await model.saveHours() }
        }
    }

    // MARK: 4 テーブル・席

    private var tablesStep: some View {
        stepCard("テーブル・席を登録してください") {
            VStack(alignment: .leading, spacing: 10) {
                if let n = model.payload?.existingTablesCount, n > 0 {
                    info("すでに\(n)件のテーブルが登録されています。追加が不要な場合は「後で設定する」を押してください。")
                }
                ForEach(model.tables) { row in tableRow(row) }
                addRow { model.tables.append(NOBTableRow()) }
            }
            .padding(.horizontal, 20).padding(.top, 16)
            footer(skip: 5) { await model.saveTables() }
        }
    }

    private func tableRow(_ row: NOBTableRow) -> some View {
        let id = row.id
        let name = Binding<String>(get: { row.name }, set: { v in nobUpdate(&model.tables, id) { $0.name = v } })
        let capacity = Binding<Int>(get: { row.capacity }, set: { v in nobUpdate(&model.tables, id) { $0.capacity = v } })
        return HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("テーブル名")
                NSPInput(text: name, placeholder: "例: T1")
            }
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("席数")
                Stepper(value: capacity, in: 1...99) {
                    Text("\(row.capacity)席").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).monospacedDigit()
                }
                .padding(.horizontal, 12).frame(width: 210, height: 46)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            }
            trash(disabled: model.tables.count == 1) { model.tables.removeAll { $0.id == id } }
        }
    }

    // MARK: 5 商品カテゴリー

    private var categoriesStep: some View {
        stepCard("商品カテゴリーを登録してください") {
            VStack(alignment: .leading, spacing: 10) {
                note("例: フード、ドリンク、デザート など")
                ForEach(model.categoryRows) { row in categoryRow(row) }
                addRow { model.categoryRows.append(NOBCategoryRow()) }
            }
            .padding(.horizontal, 20).padding(.top, 16)
            footer(skip: 6) { await model.saveCategories() }
        }
    }

    private func categoryRow(_ row: NOBCategoryRow) -> some View {
        let id = row.id
        let name = Binding<String>(get: { row.name }, set: { v in nobUpdate(&model.categoryRows, id) { $0.name = v } })
        return HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("カテゴリー名")
                NSPInput(text: name, placeholder: "例: フード")
            }
            trash(disabled: model.categoryRows.count == 1) { model.categoryRows.removeAll { $0.id == id } }
        }
    }

    // MARK: 6 商品登録

    private var itemsStep: some View {
        stepCard("商品を登録してください") {
            VStack(alignment: .leading, spacing: 10) {
                if let n = model.payload?.existingItemsCount, n > 0 {
                    info("すでに\(n)件の商品が登録されています。")
                }
                note("税率は標準税率10%（内税）が自動適用されます。軽減税率対象などの詳細設定は「設定 > メニュー」から行えます。")
                ForEach(model.items) { row in itemRow(row) }
                addRow { model.items.append(NOBItemRow(categoryId: model.categories.first?.id)) }
            }
            .padding(.horizontal, 20).padding(.top, 16)
            footer(skip: 7) { await model.saveItems() }
        }
    }

    private func itemRow(_ row: NOBItemRow) -> some View {
        let id = row.id
        let name = Binding<String>(get: { row.name }, set: { v in nobUpdate(&model.items, id) { $0.name = v } })
        // 数字だけ（Web の input[type=number] と同じ）
        let price = Binding<String>(get: { row.price }, set: { v in nobUpdate(&model.items, id) { $0.price = String(v.filter { $0.isASCII && $0.isNumber }) } })
        return HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("カテゴリー")
                pickMenu(categoryName(row.categoryId), width: 170, options: categoryOptions) { picked in
                    nobUpdate(&model.items, id) { $0.categoryId = picked.isEmpty ? nil : picked }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("商品名")
                NSPInput(text: name, placeholder: "例: 唐揚げ定食")
            }
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("価格（円）")
                NSPInput(text: price, placeholder: "0", width: 150, keyboard: .numberPad, trailing: "円")
                    .frame(width: 150)
            }
            trash(disabled: model.items.count == 1) { model.items.removeAll { $0.id == id } }
        }
    }

    /// 未分類＋カテゴリー
    private var categoryOptions: [NOBOption] {
        [NOBOption(id: "", label: "未分類")] + model.categories.map { NOBOption(id: $0.id, label: $0.name) }
    }

    private func categoryName(_ id: String?) -> String {
        guard let id else { return "未分類" }
        return model.categories.first { $0.id == id }?.name ?? "未分類"
    }

    // MARK: 7 スタッフ

    @ViewBuilder private var staffStep: some View {
        if let invited = model.invited {
            stepCard("スタッフを招待しました") {
                VStack(alignment: .leading, spacing: 10) {
                    note("初期パスワードは再表示できません。本人へ安全な方法で共有してください。")
                    ForEach(invited) { inv in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(inv.email).font(.system(size: 13, weight: .regular, design: .monospaced)).foregroundColor(NFColor.navy)
                            HStack(spacing: 8) {
                                Text(inv.password).font(.system(size: 16, weight: .semibold, design: .monospaced)).foregroundColor(NFColor.navy).textSelection(.enabled)
                                Button {
                                    UIPasteboard.general.string = inv.password
                                    model.toast = "コピーしました"
                                } label: {
                                    Image(systemName: "doc.on.doc").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink3).frame(width: 36, height: 36)
                                }
                                .buttonStyle(PressableStyle())
                                .accessibilityLabel("コピー")
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                    }
                }
                .padding(.horizontal, 20).padding(.top, 16)
                HStack {
                    Spacer()
                    NSPButton(text: "次へ", primary: true) { model.goto(8) }
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
            }
        } else {
            stepCard("スタッフを招待しましょう（任意）") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(model.staff) { row in staffRow(row) }
                    addRow { model.staff.append(NOBStaffRow()) }
                }
                .padding(.horizontal, 20).padding(.top, 16)
                footer(skip: 8, next: "招待して次へ", busyText: "招待中…") { await model.saveStaff() }
            }
        }
    }

    private func staffRow(_ row: NOBStaffRow) -> some View {
        let id = row.id
        let email = Binding<String>(get: { row.email }, set: { v in nobUpdate(&model.staff, id) { $0.email = v } })
        let displayName = Binding<String>(get: { row.displayName }, set: { v in nobUpdate(&model.staff, id) { $0.displayName = v } })
        let roles: [NOBOption] = (model.payload?.roles ?? []).map { NOBOption(id: $0.id, label: $0.label) }
        return HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("メールアドレス")
                NSPInput(text: email, placeholder: "staff@example.com", keyboard: .emailAddress)
                    .textInputAutocapitalization(.never)
            }
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("氏名")
                NSPInput(text: displayName)
            }
            VStack(alignment: .leading, spacing: 4) {
                fieldLabel("ロール")
                pickMenu(roleLabel(row.role), width: 170, options: roles) { picked in
                    nobUpdate(&model.staff, id) { $0.role = picked }
                }
            }
            trash(disabled: model.staff.count == 1) { model.staff.removeAll { $0.id == id } }
        }
    }

    private func roleLabel(_ id: String) -> String {
        model.payload?.roles.first { $0.id == id }?.label ?? id
    }

    // MARK: 8 支払方法（案内だけ）

    private var paymentsStep: some View {
        stepCard("支払方法について") {
            VStack(alignment: .leading, spacing: 10) {
                paragraph("現金・クレジットカード・QRコード決済などは、追加設定なしでPOSレジからすぐにご利用いただけます。")
                paragraph("クレジットカードやQR決済の実店舗決済端末との連携（Stripe連携）が必要な場合は、後から「設定 > 決済・端末」画面で設定できます。")
            }
            .padding(.horizontal, 20).padding(.top, 16)
            footer(skip: nil, busyText: "処理中…") { await model.advancePayments() }
        }
    }

    // MARK: 9 レジ設定

    private var registerStep: some View {
        stepCard("レジ設定") {
            VStack(alignment: .leading, spacing: 10) {
                if let n = model.payload?.existingRegisterCount, n > 0 {
                    paragraph("すでにレジが\(n)台登録されています。追加のレジは「設定 > レジ・プリンター」から登録できます。")
                } else {
                    paragraph("「レジ1」を自動作成します。営業開始前に、レジ担当者が釣銭準備金（つり銭用の現金）をレジ締め画面から登録してください。")
                }
            }
            .padding(.horizontal, 20).padding(.top, 16)
            footer(skip: 10, busyText: "処理中…") { await model.saveRegister() }
        }
    }

    // MARK: 10 完了

    private var completeStep: some View {
        stepCard("おつかれさまでした") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 20)).foregroundColor(NFColor.success)
                    Text("初期設定はこれで完了です").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.navy)
                }
                paragraph("会社情報・店舗・営業時間・テーブル・商品・スタッフなどは、いつでも「設定」画面から変更できます。")
                if model.done {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("次にやること").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                        if let slug = model.payload?.store?.slug, !slug.isEmpty {
                            nextLink("予約を試す", icon: "arrow.up.right.square") { UIApplication.shared.open(AppConfig.url("/book/\(slug)")) }
                        }
                        nextLink("POSを試す", icon: "cart") { state.goNativeFloor() }
                        nextLink("スタッフ打刻", icon: "clock") { state.leaveNativeFloor(to: "/app/attendance") }
                        nextLink("QRコードを表示（テーブル）", icon: "qrcode") { state.openSettingsPage(.tables, webPath: NativeSettingsPageKey.tables.path) }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.lilacSoft))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
                }
            }
            .padding(.horizontal, 20).padding(.top, 16)
            HStack {
                Spacer()
                if model.done {
                    NSPButton(text: "ダッシュボードへ", primary: true, action: onHome)
                } else {
                    NSPButton(text: model.busy ? "処理中…" : "完了する", primary: true, busy: model.busy) { Task { await model.complete() } }
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
        }
    }

    private func nextLink(_ text: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).frame(width: 20)
                Text(text)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
            }
            .font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
            .padding(.vertical, 6)
        }
        .buttonStyle(PressableStyle())
    }
}
