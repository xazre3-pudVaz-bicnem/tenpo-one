import SwiftUI
import CoreImage.CIFilterBuiltins
import UniformTypeIdentifiers

// 設定の中の画面（ネイティブ。2026-10-24 Ronnie「設定の中も全部ネイティブ。テーブルQRなど何でも」）。
// Web の設定の各画面を1つずつネイティブにしていく。どの画面がネイティブかは NativeSettingsPageKey（道 → 画面）で決まり、
// 設定の一覧（NativeSettingsView）はネイティブのものをアプリの画面で、まだのものを Web で開く。
// 読み込みは GET /api/app/v1/pos?part=<画面>、操作は POST { type: ... }（中身は Web と同じ Server Action。lib/native-settings-pages.ts）

/// 設定の中のネイティブの画面。rawValue は GET ?part= の名前
enum NativeSettingsPageKey: String, CaseIterable, Identifiable {
    case soldOut = "soldout"
    case clerks = "clerks"
    case hours = "hours"
    case store = "store"
    case tax = "tax"
    case loyalty = "loyalty"
    case alerts = "alerts"
    case approvals = "approvals"
    /// ほかの session が作った画面（テーブルQR・予約設定・iPhoneハンディ）も設定からネイティブで
    case tableQr = "tableQr"
    case booking = "bookingSettings"
    case handyQr = "handyqr"
    case accounts = "accounts"
    case handy = "handy"
    /// ディスプレイ端末（キッチンディスプレイ・呼び出しモニター）。GET は lib/native-modules/display-devices.ts（NativeDisplayDevicesView.swift）
    case displays = "displayDevices"
    case categories = "categories"
    case menu = "menuItems"
    case plans = "plans"
    case options = "options"
    case qrService = "qrService"
    case menuBook = "menuBook"
    case payments = "payments"
    case staff = "staff"
    case reservationBook = "reservationBook"
    case integrations = "integrations"
    case audit = "audit"
    case company = "company"
    case tables = "tables"
    case dynamicPricing = "dynamicPricing"
    case summary = "summary"
    case menuBulk = "menuBulk"
    case dataImport = "import"
    /// 店舗名刺（A4 に横名刺10枚）。GET は lib/native-modules/business-cards.ts（NATIVE_MODULE_GET）
    case businessCards = "businessCards"
    /// 写真・PDFからメニューを登録（読み込みは無し。POST menuScanParse・importRun だけ）
    case menuScan = "menuScan"
    var id: String { rawValue }

    /// Web の道（クエリは見ない）
    var path: String {
        switch self {
        case .soldOut: return "/app/pos/sold-out"
        case .clerks: return "/app/settings/clerks"
        case .hours: return "/app/settings/hours"
        case .store: return "/app/settings/store"
        case .tax: return "/app/settings/tax"
        case .loyalty: return "/app/settings/loyalty"
        case .alerts: return "/app/settings/alerts"
        case .approvals: return "/app/settings/approvals"
        case .tableQr: return "/app/settings/tables/qr-print"
        case .booking: return "/app/settings/booking"
        case .handyQr: return "/app/settings/handy-qr"
        case .accounts: return "/app/settings/accounts"
        case .handy: return "/app/settings/handy"
        case .displays: return "/app/settings/displays"
        case .categories: return "/app/settings/categories"
        case .menu: return "/app/settings/menu"
        case .plans: return "/app/settings/plans"
        case .options: return "/app/settings/options"
        case .qrService: return "/app/settings/qr-service"
        case .menuBook: return "/app/settings/menu-book"
        case .payments: return "/app/settings/payments"
        case .staff: return "/app/staff"
        case .reservationBook: return "/app/settings/reservation-book"
        case .integrations: return "/app/settings/integrations"
        case .audit: return "/app/settings/audit"
        case .company: return "/app/settings/company"
        case .tables: return "/app/settings/tables"
        case .dynamicPricing: return "/app/settings/dynamic-pricing"
        case .summary: return "/app/settings/summary"
        case .menuBulk: return "/app/settings/menu-bulk"
        case .dataImport: return "/app/settings/import"
        case .businessCards: return "/app/settings/store/business-cards"
        case .menuScan: return "/app/settings/menu/scan"
        }
    }
    var title: String {
        switch self {
        case .soldOut: return "品切れ"
        case .clerks: return "POS担当者"
        case .hours: return "営業時間・休業日"
        case .store: return "店舗情報"
        case .tax: return "税率"
        case .loyalty: return "会員・ポイント"
        case .alerts: return "異常検知の閾値"
        case .approvals: return "承認ルール"
        case .tableQr: return "テーブルQRコード"
        case .booking: return "予約受付ルール"
        case .handyQr: return "iPhoneハンディ"
        case .accounts: return "勘定科目"
        case .handy: return "ハンディ端末"
        case .displays: return "ディスプレイ端末"
        case .categories: return "カテゴリ"
        case .menu: return "メニュー"
        case .plans: return "プラン"
        case .options: return "オプション"
        case .qrService: return "QRのサービス"
        case .menuBook: return "メニューブック"
        case .payments: return "決済・端末"
        case .staff: return "スタッフ管理"
        case .reservationBook: return "予約台帳設定"
        case .integrations: return "連携"
        case .audit: return "監査ログ"
        case .company: return "企業情報"
        case .tables: return "テーブル・フロア"
        case .dynamicPricing: return "ダイナミックプライシング"
        case .summary: return "集計"
        case .menuBulk: return "メニュー一括編集"
        case .dataImport: return "データ取込"
        case .businessCards: return "店舗名刺"
        case .menuScan: return "写真・PDFからメニュー"
        }
    }
    var en: String {
        switch self {
        case .soldOut: return "Sold out"
        case .clerks: return "Clerks"
        case .hours: return "Hours"
        case .store: return "Store"
        case .tax: return "Tax"
        case .loyalty: return "Loyalty"
        case .alerts: return "Alerts"
        case .approvals: return "Approvals"
        case .tableQr: return "Table QR"
        case .booking: return "Booking rules"
        case .handyQr: return "Handy QR"
        case .accounts: return "Accounts"
        case .handy: return "Handy devices"
        case .displays: return "Display monitors"
        case .categories: return "Categories"
        case .menu: return "Menu"
        case .plans: return "Plans"
        case .options: return "Options"
        case .qrService: return "QR service"
        case .menuBook: return "Menu book"
        case .payments: return "Payments"
        case .staff: return "Staff"
        case .reservationBook: return "Reservation book"
        case .integrations: return "Integrations"
        case .audit: return "Audit log"
        case .company: return "Company"
        case .tables: return "Tables"
        case .dynamicPricing: return "Dynamic pricing"
        case .summary: return "Reports & admin"
        case .menuBulk: return "Bulk edit"
        case .dataImport: return "Import"
        case .businessCards: return "Business cards"
        case .menuScan: return "Scan menu"
        }
    }

    /// 別の道で同じ画面を開くもの（Web が redirect している古い道）。メニュー集計は 設定 › 集計 へ移した（Web の app/app/menu/summary/page.tsx）
    private static let aliases: [String: NativeSettingsPageKey] = ["/app/menu/summary": .summary]

    /// 道からネイティブの画面へ（無ければ nil＝Web のまま）
    static func from(path: String) -> NativeSettingsPageKey? {
        let p = path.hasSuffix("/") && path.count > 1 ? String(path.dropLast()) : path
        return allCases.first { $0.path == p } ?? aliases[p]
    }
}

/// 設定の中の画面（AppState.nativeSettingsPage に合わせて1つ出す）
struct NativeSettingsPageScreen: View {
    let key: NativeSettingsPageKey
    var body: some View {
        switch key {
        case .soldOut: NativeSoldOutScreen()
        case .clerks: NativeClerksScreen()
        case .hours: NativeHoursScreen()
        case .store: NativeStoreScreen()
        case .tax: NativeTaxScreen()
        case .loyalty: NativeLoyaltyScreen()
        case .alerts: NativeAlertsScreen()
        case .approvals: NativeApprovalsScreen()
        case .tableQr: NativeTableQrFromSettings()
        case .booking: NativeBookingFromSettings()
        case .handyQr: NativeHandyQrFromSettings()
        case .accounts: NativeAccountsScreen()
        case .handy: NativeHandyDevicesScreen()
        case .displays: NativeDisplayDevicesScreen()
        case .categories: NativeCategoriesScreen()
        case .menu: NativeMenuItemsScreen(mode: .menu)
        case .plans: NativeMenuItemsScreen(mode: .plan)
        case .options: NativeOptionsScreen()
        case .qrService: NativeQrServiceScreen()
        case .menuBook: NativeMenuBookScreen()
        case .payments: NativePaymentsScreen()
        case .staff: NativeStaffScreen()
        case .reservationBook: NativeReservationBookScreen()
        case .integrations: NativeIntegrationsScreen()
        case .audit: NativeAuditScreen()
        case .company: NativeCompanyScreen()
        case .tables: NativeTablesScreen()
        case .dynamicPricing: NativeDynamicPricingScreen()
        case .summary: NativeSummaryScreen()
        case .menuBulk: NativeMenuBulkScreen()
        case .dataImport: NativeImportScreen()
        case .businessCards: NativeBusinessCardsScreen()
        case .menuScan: NativeMenuScanScreen()
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
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "品切れ", subtitle: "Sold out", userName: "", onHome: onBack, backIcon: "chevron.left")
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
                                        Text(s.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(NFColor.navy)
                                        let n = s.items.filter(\.isSoldOut).count
                                        if n > 0 { Text("売切 \(n)").font(.system(size: 12, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(NFColor.danger)) }
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
                        .font(.system(size: 13, weight: NT.strong)).foregroundColor(it.isSoldOut ? .white : NFColor.success)
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
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "POS担当者", subtitle: "Clerks", userName: "", onHome: onBack, backIcon: "chevron.left")
            if let p = model.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
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
                roleMenu(selected: r.role, disabled: locked || busy) { role in Task { await model.setRole(r, role) } }
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

// MARK: - 共通の部品（設定の中の画面）

enum NSPText {
    /// 英語だけ（ASCII だけ）の文字列か。日本語の補足（件数など）は出し、英語の副題は出さない
    static func isAsciiOnly(_ s: String) -> Bool { s.unicodeScalars.allSatisfy { $0.isASCII } }
}

/// 設定の中の画面の枠：上のバー・読み込み中／エラー・toast
struct NSPFrame<Content: View>: View {
    let storeName: String
    let title: String
    let en: String
    let loaded: Bool
    let error: String?
    @Binding var toast: String?
    let onBack: () -> Void
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            // 英語の副題は出さない（2026-10-24 18:40 Ronnie「いまは日本語だけでいい」）
            NativeTopBar(storeName: storeName, title: title, subtitle: "", userName: "", onHome: onBack, backIcon: "chevron.left")
            if loaded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) { content() }
                        .padding(20).frame(maxWidth: 1100).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 24)
                }
            } else {
                Spacer()
                if let error {
                    VStack(spacing: 10) {
                        Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        Button("もう一度") { Task { await retry() } }
                    }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(Color.white.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if let t = toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 22).fill(NFColor.navy.opacity(0.92)))
                    .padding(.horizontal, 40).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if toast == t { toast = nil } }
            }
        }
    }
}

/// 白いカード（見出し＋中身）
struct NSPCard<Content: View>: View {
    let title: String
    var en: String = ""
    var note: String? = nil
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.system(size: 18, weight: NT.strong)).foregroundColor(NFColor.navy)
                    // 英語だけの副題は出さない（日本語の補足＝件数などは出す）
                    if !en.isEmpty && !NSPText.isAsciiOnly(en) { Text(en).font(.system(size: 12.5, weight: .medium)).foregroundColor(NFColor.ink3) }
                }
                if let note { Text(note).font(.system(size: 13)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true) }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            Rectangle().fill(NFColor.line).frame(height: 1)
            content()
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.05), radius: 6, y: 2)
    }
}

/// 青いボタン／白いボタン
struct NSPButton: View {
    let text: String
    var icon: String? = nil
    var primary = false
    var busy = false
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if busy { ProgressView().tint(primary ? .white : NFColor.iris).scaleEffect(0.8) }
                else if let icon { Image(systemName: icon) }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(primary ? .white : NFColor.ink)
            .padding(.horizontal, 18).frame(height: 46)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(primary ? NFColor.iris : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(primary ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }
}

/// 時刻を選ぶ（00:00〜、15分刻み。閉店は 30:00＝翌朝6時まで）
struct NSPTimeMenu: View {
    let value: String?
    let options: [String]
    var disabled = false
    let pick: (String?) -> Void
    var body: some View {
        Menu {
            Button("未設定") { pick(nil) }
            ForEach(options, id: \.self) { o in Button(o) { pick(o) } }
        } label: {
            HStack(spacing: 6) {
                Text(value ?? "--:--").font(.system(size: 16, weight: .bold)).foregroundColor(value == nil ? NFColor.ink3 : NFColor.ink).monospacedDigit()
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 12).frame(width: 112, height: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(disabled ? NFColor.lilacSoft : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

/// 操作して返事を返す（POST /api/app/v1/pos）
enum NSPApi {
    static func post(_ body: [String: Any]) async -> (ok: Bool, error: String?) {
        let r = await postJSON(body)
        return (r.ok, r.error)
    }
    /// 返事の中身も欲しいとき（招待の初期パスワードなど、返事にだけ載るもの）
    static func postJSON(_ body: [String: Any]) async -> (ok: Bool, error: String?, json: [String: Any]?) {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            let r = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            return (r?["ok"] as? Bool == true, r?["error"] as? String, r)
        } catch {
            return (false, (error as? NativeAPIError)?.message ?? "通信できませんでした", nil)
        }
    }
    static func load<T: Decodable>(_ type: T.Type, part: String) async throws -> (T, URL?) {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: part)]
        let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
        return (try JSONDecoder().decode(T.self, from: data), comps.url)
    }
    static func cachedURL(part: String) -> URL? {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: part)]
        return comps.url
    }
    /// 00:00 から toMin 分まで 15 分刻み（lib/business-hours.ts の businessHourOptions と同じ）
    static func timeOptions(toMin: Int) -> [String] {
        stride(from: 0, through: toMin, by: 15).map { String(format: "%02d:%02d", $0 / 60, $0 % 60) }
    }
}

// MARK: - 営業時間・休業日（Web の /app/settings/hours と同じ）

struct NHRHour: Codable, Hashable {
    let dayOfWeek: Int
    var isClosed: Bool
    var openTime: String?
    var closeTime: String?
    var lastEntryTime: String?
}
struct NHRHoliday: Codable, Identifiable, Hashable { let id: String; let holidayDate: String; let name: String?; let isTemporary: Bool }
struct NHRPayload: Codable {
    let store: NFNamed
    let canEdit: Bool
    var hours: [NHRHour]
    var lunchUntil: String
    var nextFloat: Int?
    var holidays: [NHRHoliday]
}

@MainActor
final class NativeHoursModel: ObservableObject {
    @Published var payload: NHRPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy: String?
    /// 編集中の営業時間（保存で送る）
    @Published var hours: [NHRHour] = []
    @Published var lunchUntil = "15:00"
    @Published var nextFloatText = ""
    @Published var newHolidayDate = Date()
    @Published var newHolidayName = ""
    @Published var newHolidayTemporary = true

    static let openOptions = NSPApi.timeOptions(toMin: 23 * 60 + 45)
    static let closeOptions = NSPApi.timeOptions(toMin: 30 * 60)
    static let dayLabels = ["日", "月", "火", "水", "木", "金", "土"]

    func refresh() async {
        do {
            if payload == nil, let saved = NativeAPI.cached(NHRPayload.self, NSPApi.cachedURL(part: "hours")) { apply(saved) }
            let (p, _) = try await NSPApi.load(NHRPayload.self, part: "hours")
            apply(p)
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
    private func apply(_ p: NHRPayload) {
        payload = p
        hours = p.hours
        lunchUntil = p.lunchUntil
        nextFloatText = p.nextFloat.map { String($0) } ?? ""
    }
    var hoursChanged: Bool { payload.map { $0.hours != hours } ?? false }

    func update(_ day: Int, _ change: (inout NHRHour) -> Void) {
        guard let i = hours.firstIndex(where: { $0.dayOfWeek == day }) else { return }
        change(&hours[i])
    }
    /// まとめて変更：全曜日に同じ時間（定休日の曜日は定休日のまま）
    func applyToAll(open: String?, close: String?, last: String?) {
        for i in hours.indices { hours[i].openTime = open; hours[i].closeTime = close; hours[i].lastEntryTime = last }
    }

    func saveHours() async {
        let body: [String: Any] = ["type": "hoursSave", "hours": hours.map { h -> [String: Any] in
            ["dayOfWeek": h.dayOfWeek, "isClosed": h.isClosed, "openTime": h.openTime as Any? ?? NSNull(), "closeTime": h.closeTime as Any? ?? NSNull(), "lastEntryTime": h.lastEntryTime as Any? ?? NSNull()]
        }]
        if await run("hours", body) { toast = "営業時間を保存しました" }
    }
    func saveLunch() async { if await run("lunch", ["type": "lunchUntilSave", "lunchUntil": lunchUntil]) { toast = "ランチの終わりを保存しました" } }
    func saveNextFloat() async {
        let t = nextFloatText.trimmingCharacters(in: .whitespaces)
        let v: Any = t.isEmpty ? NSNull() : (Int(t) ?? -1)
        if let n = v as? Int, n < 0 { toast = "金額は数字で入れてください"; return }
        if await run("float", ["type": "nextFloatSave", "nextFloat": v]) { toast = "翌準備金を保存しました" }
    }
    func addHoliday() async {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        let date = f.string(from: newHolidayDate)
        if await run("holiday", ["type": "holidayAdd", "date": date, "name": newHolidayName, "isTemporary": newHolidayTemporary]) {
            newHolidayName = ""
            toast = "休業日を追加しました"
        }
    }
    func deleteHoliday(_ h: NHRHoliday) async { if await run(h.id, ["type": "holidayDelete", "id": h.id]) { toast = "休業日を取り消しました" } }

    private func run(_ key: String, _ body: [String: Any]) async -> Bool {
        guard busy == nil else { return false }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.post(body)
        guard r.ok else { toast = r.error ?? "うまくいきませんでした"; return false }
        await refresh()
        return true
    }
}

struct NativeHoursScreen: View {
    @StateObject private var model = NativeHoursModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeHoursView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeHoursView: View {
    @ObservedObject var model: NativeHoursModel
    let onBack: () -> Void
    @State private var bulkOpen: String? = nil
    @State private var bulkClose: String? = nil
    @State private var bulkLast: String? = nil

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "営業時間・休業日", en: "Hours", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                NSPCard(title: "営業時間", en: "Business hours") {
                    VStack(spacing: 0) {
                        if edit {
                            // まとめて変更（2026-09-27 Ronnie「一緒に変更する場合のも」）
                            HStack(spacing: 10) {
                                Text("まとめて変更").font(.system(size: 14, weight: NT.strong)).foregroundColor(NFColor.navy).frame(width: 100, alignment: .leading)
                                timeField("開店", value: bulkOpen, options: NativeHoursModel.openOptions) { bulkOpen = $0 }
                                timeField("閉店", value: bulkClose, options: NativeHoursModel.closeOptions) { bulkClose = $0 }
                                timeField("最終入店", value: bulkLast, options: NativeHoursModel.closeOptions) { bulkLast = $0 }
                                NSPButton(text: "全曜日に入れる", icon: "arrow.down.to.line", disabled: bulkOpen == nil && bulkClose == nil && bulkLast == nil) { model.applyToAll(open: bulkOpen, close: bulkClose, last: bulkLast) }
                                Spacer()
                            }
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(NFColor.lilacSoft)
                            Rectangle().fill(NFColor.line).frame(height: 1)
                        }
                        ForEach(model.hours, id: \.dayOfWeek) { h in
                            HStack(spacing: 10) {
                                Text("\(NativeHoursModel.dayLabels[h.dayOfWeek])曜日").font(.system(size: 16, weight: NT.strong)).foregroundColor(h.isClosed ? NFColor.ink3 : NFColor.navy).frame(width: 70, alignment: .leading)
                                Button { model.update(h.dayOfWeek) { $0.isClosed.toggle() } } label: {
                                    Text(h.isClosed ? "定休日" : "営業").font(.system(size: 13, weight: NT.strong)).foregroundColor(h.isClosed ? .white : NFColor.success)
                                        .frame(width: 72, height: 34)
                                        .background(Capsule().fill(h.isClosed ? NFColor.ink3 : NFColor.successSoft))
                                }
                                .buttonStyle(PressableStyle()).disabled(!edit)
                                timeField("開店", value: h.openTime, options: NativeHoursModel.openOptions, disabled: h.isClosed || !edit) { v in model.update(h.dayOfWeek) { $0.openTime = v } }
                                timeField("閉店", value: h.closeTime, options: NativeHoursModel.closeOptions, disabled: h.isClosed || !edit) { v in model.update(h.dayOfWeek) { $0.closeTime = v } }
                                timeField("最終入店", value: h.lastEntryTime, options: NativeHoursModel.closeOptions, disabled: h.isClosed || !edit) { v in model.update(h.dayOfWeek) { $0.lastEntryTime = v } }
                                Spacer()
                            }
                            .padding(.horizontal, 18).padding(.vertical, 8)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                        if edit {
                            HStack {
                                Spacer()
                                NSPButton(text: "営業時間を保存", primary: true, busy: model.busy == "hours", disabled: !model.hoursChanged) { Task { await model.saveHours() } }
                            }
                            .padding(.horizontal, 18).padding(.vertical, 12)
                        }
                    }
                }
                HStack(alignment: .top, spacing: 18) {
                    NSPCard(title: "ランチの終わり", en: "Lunch until") {
                        HStack(spacing: 10) {
                            NSPTimeMenu(value: model.lunchUntil, options: NSPApi.timeOptions(toMin: 23 * 60 + 45), disabled: !edit) { if let v = $0 { model.lunchUntil = v } }
                            NSPButton(text: "保存", primary: true, busy: model.busy == "lunch", disabled: !edit || model.lunchUntil == p.lunchUntil) { Task { await model.saveLunch() } }
                            Spacer()
                        }
                        .padding(18)
                    }
                    NSPCard(title: "翌準備金", en: "Next float") {
                        HStack(spacing: 10) {
                            HStack(spacing: 4) {
                                Text("¥").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink3)
                                TextField("開局の金額と同じ", text: $model.nextFloatText).keyboardType(.numberPad).font(.system(size: 16, weight: .bold)).multilineTextAlignment(.trailing).disabled(!edit)
                            }
                            .padding(.horizontal, 12).frame(width: 190, height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                            NSPButton(text: "保存", primary: true, busy: model.busy == "float", disabled: !edit || model.nextFloatText == (p.nextFloat.map { String($0) } ?? "")) { Task { await model.saveNextFloat() } }
                            Spacer()
                        }
                        .padding(18)
                    }
                }
                NSPCard(title: "休業日", en: "Holidays") {
                    VStack(spacing: 0) {
                        if edit {
                            HStack(spacing: 10) {
                                DatePicker("", selection: $model.newHolidayDate, displayedComponents: .date).labelsHidden().environment(\.locale, Locale(identifier: "ja_JP"))
                                TextField("名前（例：年末年始・棚卸）", text: $model.newHolidayName).font(.system(size: 15)).padding(.horizontal, 12).frame(height: 44).frame(maxWidth: 320)
                                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                                Button { model.newHolidayTemporary.toggle() } label: {
                                    HStack(spacing: 6) {
                                        Image(systemName: model.newHolidayTemporary ? "checkmark.square.fill" : "square").foregroundColor(model.newHolidayTemporary ? NFColor.iris : NFColor.ink3)
                                        Text("臨時休業").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
                                    }
                                }
                                .buttonStyle(.plain)
                                NSPButton(text: "追加する", icon: "plus", primary: true, busy: model.busy == "holiday") { Task { await model.addHoliday() } }
                                Spacer()
                            }
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(NFColor.lilacSoft)
                            Rectangle().fill(NFColor.line).frame(height: 1)
                        }
                        if p.holidays.isEmpty {
                            Text("今日以降の休業日はありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18)
                        }
                        ForEach(p.holidays) { h in
                            HStack(spacing: 12) {
                                Text(Self.pretty(h.holidayDate)).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink).monospacedDigit()
                                if h.isTemporary { Text("臨時").font(.system(size: 11, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.saffron)) }
                                Text(h.name ?? "").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                                Spacer()
                                if edit {
                                    NSPButton(text: "取り消す", icon: "trash", busy: model.busy == h.id) { Task { await model.deleteHoliday(h) } }
                                }
                            }
                            .padding(.horizontal, 18).frame(minHeight: 56)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }

    private func timeField(_ label: String, value: String?, options: [String], disabled: Bool = false, pick: @escaping (String?) -> Void) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            NSPTimeMenu(value: value, options: options, disabled: disabled, pick: pick)
        }
    }

    /// 2026-10-24 → 10/24（土）
    private static func pretty(_ ymd: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        guard let d = f.date(from: ymd) else { return ymd }
        let o = DateFormatter(); o.dateFormat = "M/d（E）"; o.locale = Locale(identifier: "ja_JP"); o.timeZone = TimeZone(identifier: "Asia/Tokyo")
        return o.string(from: d)
    }
}

// MARK: - 店舗情報（Web の /app/settings/store・components/settings/store-form.tsx と同じ）

struct NSTFields: Codable, Equatable {
    var name: String
    var nameKana: String
    var postalCode: String
    var address: String
    var phone: String
    var email: String
    var description: String
    var seatCount: Int?
    var bookingEnabled: Bool
    var receiptHeader: String
    var receiptFooter: String
    var invoiceRegistrationNumber: String
    var serviceChargeRate: Double
    var rounding: String
    var allowNegativeStock: Bool
}
struct NSTStorePayload: Codable {
    let store: NFNamed
    let canEdit: Bool
    let receiptLocked: Bool
    let bookingUrl: String?
    let slug: String?
    var fields: NSTFields
    let roundings: [NSTLabeled]
}
struct NSTLabeled: Codable, Identifiable, Hashable { let id: String; let label: String }

@MainActor
final class NativeStoreModel: ObservableObject {
    @Published var payload: NSTStorePayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var f = NSTFields(name: "", nameKana: "", postalCode: "", address: "", phone: "", email: "", description: "", seatCount: nil, bookingEnabled: false, receiptHeader: "", receiptFooter: "", invoiceRegistrationNumber: "", serviceChargeRate: 0, rounding: "floor", allowNegativeStock: true)
    @Published var seatText = ""
    @Published var rateText = "0"

    func refresh() async {
        do {
            if payload == nil, let saved = NativeAPI.cached(NSTStorePayload.self, NSPApi.cachedURL(part: "store")) { apply(saved) }
            let (p, _) = try await NSPApi.load(NSTStorePayload.self, part: "store")
            apply(p)
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
    private func apply(_ p: NSTStorePayload) {
        payload = p
        f = p.fields
        seatText = p.fields.seatCount.map { String($0) } ?? ""
        rateText = p.fields.serviceChargeRate == p.fields.serviceChargeRate.rounded() ? String(Int(p.fields.serviceChargeRate)) : String(p.fields.serviceChargeRate)
    }
    var changed: Bool {
        guard let p = payload else { return false }
        var cur = f
        cur.seatCount = Int(seatText.trimmingCharacters(in: .whitespaces))
        cur.serviceChargeRate = Double(rateText.trimmingCharacters(in: .whitespaces)) ?? p.fields.serviceChargeRate
        return cur != p.fields
    }

    func save() async {
        guard !busy else { return }
        if f.name.trimmingCharacters(in: .whitespaces).isEmpty { toast = "店舗名は必須です"; return }
        let seat = seatText.trimmingCharacters(in: .whitespaces)
        if !seat.isEmpty && Int(seat) == nil { toast = "座席数は数字で入れてください"; return }
        guard let rate = Double(rateText.trimmingCharacters(in: .whitespaces)), rate >= 0, rate <= 100 else { toast = "サービス料率は0〜100の範囲で入力してください"; return }
        busy = true
        defer { busy = false }
        let body: [String: Any] = ["type": "storeSave", "store": [
            "name": f.name, "nameKana": f.nameKana, "postalCode": f.postalCode, "address": f.address, "phone": f.phone, "email": f.email,
            "description": f.description, "seatCount": seat.isEmpty ? NSNull() : Int(seat)!, "bookingEnabled": f.bookingEnabled,
            "receiptHeader": f.receiptHeader, "receiptFooter": f.receiptFooter, "invoiceRegistrationNumber": f.invoiceRegistrationNumber,
            "serviceChargeRate": rate, "rounding": f.rounding, "allowNegativeStock": f.allowNegativeStock,
        ]]
        let r = await NSPApi.post(body)
        guard r.ok else { toast = r.error ?? "保存できませんでした"; return }
        await refresh()
        toast = "店舗情報を保存しました"
    }
}

struct NativeStoreScreen: View {
    @StateObject private var model = NativeStoreModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NativeStoreView(model: model, onBack: { state.goNativeSettings() }, onBusinessCards: {
            state.openSettingsPage(.businessCards, webPath: NativeSettingsPageKey.businessCards.path)
        })
    }
}

struct NativeStoreView: View {
    @ObservedObject var model: NativeStoreModel
    let onBack: () -> Void
    /// 店舗名刺（A4 に横名刺10枚）を開く。Web の「店舗名刺としてプリントする」と同じ
    var onBusinessCards: (() -> Void)? = nil

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "店舗情報", en: "Store", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                if let url = p.bookingUrl {
                    NSPCard(title: "店舗ご予約リンク", en: "Reservation link") {
                        HStack(spacing: 12) {
                            Text(url).font(.system(size: 14, weight: .semibold, design: .monospaced)).foregroundColor(NFColor.iris).lineLimit(1).truncationMode(.middle)
                            Spacer()
                            NSPButton(text: "コピー", icon: "doc.on.doc") { UIPasteboard.general.string = url; model.toast = "リンクをコピーしました" }
                            // 店舗名刺は store.settings（Web の店舗情報の画面と同じ権限）
                            if edit, let onBusinessCards {
                                NSPButton(text: "店舗名刺を印刷", icon: "person.text.rectangle", action: onBusinessCards)
                            }
                        }
                        .padding(18)
                    }
                }
                NSPCard(title: "基本情報", en: "Basic") {
                    VStack(spacing: 0) {
                        field("店舗名", required: true) { input($model.f.name, "店舗名", edit) }
                        field("フリガナ") { input($model.f.nameKana, "テンポメイ", edit) }
                        field("郵便番号") { input($model.f.postalCode, "160-0022", edit, width: 200).keyboardType(.numbersAndPunctuation) }
                        field("住所") { input($model.f.address, "東京都新宿区…", edit) }
                        field("電話番号") { input($model.f.phone, "03-0000-0000", edit, width: 260).keyboardType(.phonePad) }
                        field("メールアドレス") { input($model.f.email, "info@example.com", edit).keyboardType(.emailAddress).textInputAutocapitalization(.never) }
                        field("紹介文") { textArea($model.f.description, "お店の紹介（予約ページに出ます）", edit) }
                        field("座席数") {
                            HStack(spacing: 6) {
                                input($model.seatText, "0", edit, width: 120).keyboardType(.numberPad)
                                Text("席").font(.system(size: 14)).foregroundColor(NFColor.ink3)
                            }
                        }
                        field("オンライン予約") {
                            HStack(spacing: 10) {
                                toggle(model.f.bookingEnabled, disabled: !edit) { model.f.bookingEnabled.toggle() }
                                Text(model.f.bookingEnabled ? "受付中" : "停止中").font(.system(size: 14, weight: .bold)).foregroundColor(model.f.bookingEnabled ? NFColor.success : NFColor.ink3)
                            }
                        }
                    }
                }
                NSPCard(title: "レシート・インボイス", en: "Receipt & invoice", note: p.receiptLocked ? "管理画面（パソコン・店長以上のアカウント）で変更します。レジ（iPad）からは変更できません" : nil) {
                    let lock = !edit || p.receiptLocked
                    VStack(spacing: 0) {
                        field("ヘッダー") { textArea($model.f.receiptHeader, "レシートの上に印字する文", lock ? false : true) }
                        field("フッター") { textArea($model.f.receiptFooter, "レシートの下に印字する文", lock ? false : true) }
                        field("登録番号") { input($model.f.invoiceRegistrationNumber, "T1234567890123", !lock, width: 320).textInputAutocapitalization(.characters) }
                        field("サービス料率") {
                            HStack(spacing: 6) {
                                input($model.rateText, "0", !lock, width: 120).keyboardType(.decimalPad)
                                Text("%").font(.system(size: 14)).foregroundColor(NFColor.ink3)
                            }
                        }
                        field("端数処理") {
                            HStack(spacing: 8) {
                                ForEach(p.roundings) { r in
                                    Button { model.f.rounding = r.id } label: {
                                        Text(r.label).font(.system(size: 14, weight: .bold)).foregroundColor(model.f.rounding == r.id ? .white : NFColor.ink2)
                                            .padding(.horizontal, 14).frame(height: 40)
                                            .background(RoundedRectangle(cornerRadius: 10).fill(model.f.rounding == r.id ? NFColor.navy : Color.white))
                                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                                    }
                                    .buttonStyle(PressableStyle()).disabled(lock)
                                }
                            }
                            .opacity(lock ? 0.6 : 1)
                        }
                    }
                }
                NSPCard(title: "在庫", en: "Stock") {
                    field("在庫がマイナスでも注文を受ける") {
                        toggle(model.f.allowNegativeStock, disabled: !edit) { model.f.allowNegativeStock.toggle() }
                    }
                }
                if edit {
                    HStack {
                        Spacer()
                        NSPButton(text: "保存する", primary: true, busy: model.busy, disabled: !model.changed) { Task { await model.save() } }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }

    private func field<C: View>(_ label: String, required: Bool = false, @ViewBuilder content: () -> C) -> some View {
        HStack(alignment: .center, spacing: 16) {
            HStack(spacing: 4) {
                Text(label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                if required { Text("必須").font(.system(size: 10, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(NFColor.danger)) }
            }
            .frame(width: 180, alignment: .leading)
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func input(_ b: Binding<String>, _ ph: String, _ enabled: Bool, width: CGFloat? = nil) -> some View {
        TextField(ph, text: b).font(.system(size: 16)).padding(.horizontal, 12).frame(height: 44)
            .frame(maxWidth: width ?? 520)
            .background(RoundedRectangle(cornerRadius: 10).fill(enabled ? Color.white : NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            .disabled(!enabled)
    }

    private func textArea(_ b: Binding<String>, _ ph: String, _ enabled: Bool) -> some View {
        TextField(ph, text: b, axis: .vertical).lineLimit(2...5).font(.system(size: 15)).padding(12)
            .frame(maxWidth: 520, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 10).fill(enabled ? Color.white : NFColor.lilacSoft))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            .disabled(!enabled)
    }

    private func toggle(_ on: Bool, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? NFColor.iris : Color(hex: 0xCFC9C0)).frame(width: 56, height: 32)
                Circle().fill(Color.white).frame(width: 26, height: 26).shadow(color: .black.opacity(0.15), radius: 2, y: 1).padding(3)
            }
        }
        .buttonStyle(PressableStyle()).disabled(disabled).opacity(disabled ? 0.5 : 1)
        .animation(.easeOut(duration: 0.15), value: on)
    }
}

// MARK: - 共通：行の入力欄・スイッチ（設定の中の画面）

struct NSPInput: View {
    @Binding var text: String
    var placeholder = ""
    var enabled = true
    var width: CGFloat? = nil
    var keyboard: UIKeyboardType = .default
    var trailing: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            TextField(placeholder, text: $text).font(.system(size: 16)).keyboardType(keyboard).disabled(!enabled)
            if let trailing { Text(trailing).font(.system(size: 14, weight: .medium)).foregroundColor(NFColor.ink3) }
        }
        .padding(.horizontal, 13).frame(height: 46).frame(maxWidth: width ?? 520)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(enabled ? Color.white : NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}

struct NSPToggle: View {
    let on: Bool
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? NFColor.iris : Color(hex: 0xCFC9C0)).frame(width: 56, height: 32)
                Circle().fill(Color.white).frame(width: 26, height: 26).shadow(color: .black.opacity(0.15), radius: 2, y: 1).padding(3)
            }
        }
        .buttonStyle(PressableStyle()).disabled(disabled).opacity(disabled ? 0.5 : 1)
        .animation(.easeOut(duration: 0.15), value: on)
    }
}

/// 見出し（左 180pt）＋中身の1行
struct NSPRow<Content: View>: View {
    let label: String
    var en: String = ""
    var required = false
    @ViewBuilder let content: () -> Content
    var body: some View {
        // 名前は左・入力は右（見本の Funfo と同じ並び。2026-10-24 18:44 Ronnie「スタイルはこれ」）
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(label).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink)
                    if required { Text("必須").font(.system(size: 10, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(NFColor.danger)) }
                }
                if !en.isEmpty && !NSPText.isAsciiOnly(en) { Text(en).font(.system(size: 12, weight: .medium)).foregroundColor(NFColor.ink3) }
            }
            .frame(minWidth: 160, alignment: .leading)
            Spacer(minLength: 16)
            content()
        }
        .padding(.horizontal, 20).padding(.vertical, 12).frame(minHeight: 64)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1).padding(.horizontal, 20) }
    }
}

// MARK: - 税率（Web の /app/settings/tax・components/settings/tax-rates-panel.tsx と同じ）

struct NTXRow: Codable, Identifiable, Hashable { let id: String; let name: String; let rate: Double; let isReduced: Bool; let isInclusive: Bool; let isDefault: Bool }
struct NTXPayload: Codable { let store: NFNamed; let canEdit: Bool; var rows: [NTXRow] }

@MainActor
final class NativeTaxModel: ObservableObject {
    @Published var payload: NTXPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy: String?
    /// 追加・編集の入力
    @Published var editingId: String? = nil
    @Published var name = ""
    @Published var rate = "10"
    @Published var isReduced = false
    @Published var isInclusive = true
    @Published var isDefault = false
    @Published var showForm = false

    func refresh() async {
        do {
            if payload == nil, let saved = NativeAPI.cached(NTXPayload.self, NSPApi.cachedURL(part: "tax")) { payload = saved }
            let (p, _) = try await NSPApi.load(NTXPayload.self, part: "tax")
            payload = p
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
    func startAdd() { editingId = nil; name = ""; rate = "10"; isReduced = false; isInclusive = true; isDefault = false; showForm = true }
    func startEdit(_ r: NTXRow) {
        editingId = r.id; name = r.name; rate = r.rate == r.rate.rounded() ? String(Int(r.rate)) : String(r.rate)
        isReduced = r.isReduced; isInclusive = r.isInclusive; isDefault = r.isDefault; showForm = true
    }
    func save() async {
        guard let v = Double(rate.trimmingCharacters(in: .whitespaces)), v >= 0, v <= 100 else { toast = "税率は0〜100の範囲で入力してください"; return }
        let body: [String: Any] = ["type": "taxSave", "id": editingId as Any? ?? NSNull(), "name": name, "rate": v, "isReduced": isReduced, "isInclusive": isInclusive, "isDefault": isDefault]
        if await run("save", body) { showForm = false; toast = editingId == nil ? "税率を追加しました" : "税率を保存しました" }
    }
    func delete(_ r: NTXRow) async { if await run(r.id, ["type": "taxDelete", "id": r.id]) { toast = "「\(r.name)」を削除しました" } }
    private func run(_ key: String, _ body: [String: Any]) async -> Bool {
        guard busy == nil else { return false }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.post(body)
        guard r.ok else { toast = r.error ?? "うまくいきませんでした"; return false }
        await refresh()
        return true
    }
}

struct NativeTaxScreen: View {
    @StateObject private var model = NativeTaxModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeTaxView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeTaxView: View {
    @ObservedObject var model: NativeTaxModel
    let onBack: () -> Void
    @State private var confirmDelete: NTXRow?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "税率", en: "Tax", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.canEdit && !model.showForm {
                    HStack { NSPButton(text: "税率を追加", icon: "plus", primary: true) { model.startAdd() }; Spacer() }
                }
                if model.showForm { form }
                NSPCard(title: "税率マスタ", en: "Tax rates") {
                    VStack(spacing: 0) {
                        if p.rows.isEmpty { Text("税率がまだ登録されていません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(p.rows) { r in
                            HStack(spacing: 12) {
                                Text(r.rate == r.rate.rounded() ? "\(Int(r.rate))%" : "\(r.rate)%").font(.system(size: 20, weight: NT.strong)).foregroundColor(NFColor.navy).monospacedDigit().frame(width: 72, alignment: .leading)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink)
                                    HStack(spacing: 6) {
                                        if r.isDefault { tag("既定", NFColor.iris) }
                                        if r.isReduced { tag("軽減税率", NFColor.saffron) }
                                        tag(r.isInclusive ? "内税" : "外税", NFColor.ink3)
                                    }
                                }
                                Spacer()
                                if p.canEdit {
                                    NSPButton(text: "編集", icon: "pencil") { model.startEdit(r) }
                                    NSPButton(text: "削除", icon: "trash", busy: model.busy == r.id, disabled: r.isDefault) { confirmDelete = r }
                                }
                            }
                            .padding(.horizontal, 18).frame(minHeight: 64)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
        .alert("税率を削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let r = confirmDelete { Task { await model.delete(r) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: { Text("「\(confirmDelete?.name ?? "")」を削除します") }
        .task { await model.refresh() }
    }

    private func tag(_ t: String, _ c: Color) -> some View {
        Text(t).font(.system(size: 11, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 7).padding(.vertical, 2).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }

    private var form: some View {
        NSPCard(title: model.editingId == nil ? "税率を追加" : "税率を編集", en: model.editingId == nil ? "Add" : "Edit") {
            VStack(spacing: 0) {
                NSPRow(label: "税率名", required: true) { NSPInput(text: $model.name, placeholder: "標準税率・軽減税率 など", width: 360) }
                NSPRow(label: "税率") { NSPInput(text: $model.rate, placeholder: "10", width: 140, keyboard: .decimalPad, trailing: "%") }
                NSPRow(label: "軽減税率") { NSPToggle(on: model.isReduced) { model.isReduced.toggle() } }
                NSPRow(label: "内税") {
                    HStack(spacing: 10) {
                        NSPToggle(on: model.isInclusive) { model.isInclusive.toggle() }
                        Text(model.isInclusive ? "内税（価格に含む）" : "外税（価格に足す）").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                    }
                }
                NSPRow(label: "既定にする") { NSPToggle(on: model.isDefault) { model.isDefault.toggle() } }
                HStack(spacing: 10) {
                    Spacer()
                    NSPButton(text: "やめる") { model.showForm = false }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: model.name.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.save() } }
                }
                .padding(18)
            }
        }
    }
}

// MARK: - 会員・ポイント（Web の /app/settings/loyalty と同じ）

struct NLYPayload: Codable { let store: NFNamed; let canEdit: Bool; let enabled: Bool; let yenPerPoint: Double; let pointValue: Double; let expiryMonths: Int? }

@MainActor
final class NativeLoyaltyModel: ObservableObject {
    @Published var payload: NLYPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var enabled = false
    @Published var yenPerPoint = "100"
    @Published var pointValue = "1"
    @Published var expiry = ""

    func refresh() async {
        do {
            if payload == nil, let saved = NativeAPI.cached(NLYPayload.self, NSPApi.cachedURL(part: "loyalty")) { apply(saved) }
            let (p, _) = try await NSPApi.load(NLYPayload.self, part: "loyalty")
            apply(p)
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
    private func apply(_ p: NLYPayload) {
        payload = p
        enabled = p.enabled
        yenPerPoint = Self.num(p.yenPerPoint)
        pointValue = Self.num(p.pointValue)
        expiry = p.expiryMonths.map { String($0) } ?? ""
    }
    static func num(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }
    var changed: Bool {
        guard let p = payload else { return false }
        return enabled != p.enabled || yenPerPoint != Self.num(p.yenPerPoint) || pointValue != Self.num(p.pointValue) || expiry != (p.expiryMonths.map { String($0) } ?? "")
    }
    func save() async {
        guard !busy else { return }
        guard let y = Double(yenPerPoint), y > 0 else { toast = "円/pt は1以上で入力してください"; return }
        guard let v = Double(pointValue), v > 0 else { toast = "pt単価は1以上で入力してください"; return }
        let e = expiry.trimmingCharacters(in: .whitespaces)
        let months: Any = e.isEmpty ? NSNull() : (Int(e) ?? 0)
        if let m = months as? Int, m <= 0 { toast = "失効月数は1以上で入力してください（無期限の場合は空欄）"; return }
        busy = true
        defer { busy = false }
        let r = await NSPApi.post(["type": "loyaltySave", "enabled": enabled, "yenPerPoint": y, "pointValue": v, "expiryMonths": months])
        guard r.ok else { toast = r.error ?? "保存できませんでした"; return }
        await refresh()
        toast = "ポイント設定を保存しました"
    }
}

struct NativeLoyaltyScreen: View {
    @StateObject private var model = NativeLoyaltyModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeLoyaltyView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeLoyaltyView: View {
    @ObservedObject var model: NativeLoyaltyModel
    let onBack: () -> Void
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "会員・ポイント", en: "Loyalty", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                NSPCard(title: "ポイント機能", en: "Points") {
                    VStack(spacing: 0) {
                        NSPRow(label: "ポイント機能") {
                            HStack(spacing: 10) {
                                NSPToggle(on: model.enabled, disabled: !edit) { model.enabled.toggle() }
                                Text(model.enabled ? "有効" : "無効").font(.system(size: 14, weight: .bold)).foregroundColor(model.enabled ? NFColor.success : NFColor.ink3)
                            }
                        }
                        NSPRow(label: "付与レート", en: "円 / 1pt") {
                            HStack(spacing: 8) {
                                NSPInput(text: $model.yenPerPoint, placeholder: "100", enabled: edit, width: 160, keyboard: .numberPad, trailing: "円で 1pt")
                                Text("会計金額をこの円数で割った数（切り捨て）を付与").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            }
                        }
                        NSPRow(label: "利用レート", en: "円 / 1pt") {
                            HStack(spacing: 8) {
                                NSPInput(text: $model.pointValue, placeholder: "1", enabled: edit, width: 160, keyboard: .numberPad, trailing: "円 / 1pt")
                                Text("ポイント払いのときの 1pt の円換算").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            }
                        }
                        NSPRow(label: "失効", en: "Expiry") {
                            HStack(spacing: 8) {
                                NSPInput(text: $model.expiry, placeholder: "無期限", enabled: edit, width: 160, keyboard: .numberPad, trailing: "か月")
                                Text("空欄なら無期限").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            }
                        }
                        if edit {
                            HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy, disabled: !model.changed) { Task { await model.save() } } }.padding(18)
                        } else {
                            Text("ポイント設定は本部（org.settings）のアカウントで変えられます").font(.system(size: 12.5)).foregroundColor(NFColor.ink3).padding(18)
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }
}

// MARK: - 共通：読み込みと操作をまとめた土台（設定の中の画面のモデル）

@MainActor
class NSPModel<P: Decodable>: ObservableObject {
    @Published var payload: P?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy: String?
    let part: String
    init(part: String) { self.part = part }

    func refresh() async {
        do {
            if payload == nil, let saved = NativeAPI.cached(P.self, NSPApi.cachedURL(part: part)) { payload = saved; loaded(saved) }
            let (p, _) = try await NSPApi.load(P.self, part: part)
            payload = p
            loaded(p)
            error = nil
        } catch {
            if payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
    }
    /// 読み込めたときに入力欄へ写す（子で上書き）
    func loaded(_ p: P) {}

    /// 操作して読み直す。失敗したら toast。成功したら true
    func run(_ key: String, _ body: [String: Any], done: String? = nil) async -> Bool {
        guard busy == nil else { return false }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.post(body)
        guard r.ok else { toast = r.error ?? "うまくいきませんでした"; return false }
        await refresh()
        if let done { toast = done }
        return true
    }
}

// MARK: - 異常検知の閾値（Web の /app/settings/alerts と同じ）

struct NALItem: Codable, Identifiable, Hashable {
    let ruleKey: String; let label: String; let unit: String; let defaultValue: Double
    let orgValue: Double?; let orgEnabled: Bool; let storeValue: Double?; let storeEnabled: Bool
    let effectiveValue: Double; let effectiveSource: String
    var id: String { ruleKey }
}
struct NALPayload: Codable { let store: NFNamed; let canEditStore: Bool; let canEditOrg: Bool; let items: [NALItem] }

@MainActor
final class NativeAlertsModel: NSPModel<NALPayload> {
    /// 入力中の値（ruleKey → 文字）
    @Published var text: [String: String] = [:]
    init() { super.init(part: "alerts") }
    override func loaded(_ p: NALPayload) {
        for it in p.items where text[it.ruleKey] == nil { text[it.ruleKey] = Self.num(it.storeValue ?? it.effectiveValue) }
    }
    static func num(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }
    func save(_ it: NALItem, scope: String) async {
        guard let v = Double((text[it.ruleKey] ?? "").trimmingCharacters(in: .whitespaces)), v >= 0 else { toast = "閾値を正しく入力してください"; return }
        let enabled = scope == "org" ? it.orgEnabled : it.storeEnabled
        _ = await run(it.ruleKey, ["type": "alertSave", "scope": scope, "ruleKey": it.ruleKey, "threshold": v, "enabled": enabled], done: scope == "org" ? "企業既定を保存しました" : "この店の値を保存しました")
    }
    func toggle(_ it: NALItem, scope: String) async {
        let enabled = scope == "org" ? !it.orgEnabled : !it.storeEnabled
        let v = scope == "org" ? (it.orgValue ?? it.defaultValue) : (it.storeValue ?? it.effectiveValue)
        _ = await run(it.ruleKey, ["type": "alertSave", "scope": scope, "ruleKey": it.ruleKey, "threshold": v, "enabled": enabled], done: enabled ? "有効にしました" : "無効にしました")
    }
    func reset(_ it: NALItem) async {
        if await run(it.ruleKey, ["type": "alertReset", "ruleKey": it.ruleKey], done: "企業既定に戻しました") { text[it.ruleKey] = nil; if let p = payload { loaded(p) } }
    }
}

struct NativeAlertsScreen: View {
    @StateObject private var model = NativeAlertsModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeAlertsView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeAlertsView: View {
    @ObservedObject var model: NativeAlertsModel
    let onBack: () -> Void
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "異常検知の閾値", en: "Alerts", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                NSPCard(title: "閾値", en: "Thresholds") {
                    VStack(spacing: 0) {
                        ForEach(p.items) { it in
                            let busy = model.busy == it.ruleKey
                            HStack(alignment: .center, spacing: 14) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(it.label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                    HStack(spacing: 6) {
                                        Text("いま：\(NativeAlertsModel.num(it.effectiveValue))\(it.unit)").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.iris)
                                        Text(it.effectiveSource == "store" ? "（この店）" : it.effectiveSource == "org" ? "（企業既定）" : "（標準）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                        if it.effectiveSource == "store" && !it.storeEnabled || it.effectiveSource == "org" && !it.orgEnabled { Text("無効").font(.system(size: 11, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.ink3)) }
                                    }
                                }
                                .frame(width: 300, alignment: .leading)
                                Spacer(minLength: 0)
                                if p.canEditStore {
                                    NSPInput(text: Binding(get: { model.text[it.ruleKey] ?? "" }, set: { model.text[it.ruleKey] = $0 }), placeholder: NativeAlertsModel.num(it.defaultValue), width: 150, keyboard: .decimalPad, trailing: it.unit)
                                    NSPButton(text: "この店で保存", primary: true, busy: busy) { Task { await model.save(it, scope: "store") } }
                                    if p.canEditOrg { NSPButton(text: "企業既定に", busy: busy) { Task { await model.save(it, scope: "org") } } }
                                    if it.storeValue != nil {
                                        NSPButton(text: "有効/無効", icon: it.storeEnabled ? "bell.fill" : "bell.slash", busy: busy) { Task { await model.toggle(it, scope: "store") } }
                                        NSPButton(text: "既定に戻す", icon: "arrow.uturn.backward", busy: busy) { Task { await model.reset(it) } }
                                    }
                                }
                            }
                            .padding(.horizontal, 18).padding(.vertical, 10)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }
}

// MARK: - 承認ルール（Web の /app/settings/approvals と同じ）

struct NAPRow: Codable, Identifiable, Hashable { let id: String; let target: String; let minAmount: Int; let maxAmount: Int?; let approverRole: String; let allowSelfApprove: Bool }
struct NAPPayload: Codable { let store: NFNamed; let canEdit: Bool; let targets: [NSTLabeled]; let roles: [NSTLabeled]; let rows: [NAPRow] }

@MainActor
final class NativeApprovalsModel: NSPModel<NAPPayload> {
    @Published var showForm = false
    @Published var editingId: String?
    @Published var target = "invoice"
    @Published var minAmount = "0"
    @Published var maxAmount = ""
    @Published var role = "store_manager"
    @Published var allowSelf = false
    init() { super.init(part: "approvals") }

    func startAdd() { editingId = nil; target = "invoice"; minAmount = "0"; maxAmount = ""; role = "store_manager"; allowSelf = false; showForm = true }
    func startEdit(_ r: NAPRow) { editingId = r.id; target = r.target; minAmount = String(r.minAmount); maxAmount = r.maxAmount.map { String($0) } ?? ""; role = r.approverRole; allowSelf = r.allowSelfApprove; showForm = true }
    func save() async {
        guard let lo = Int(minAmount.trimmingCharacters(in: .whitespaces)), lo >= 0 else { toast = "下限金額は0以上の整数で入力してください"; return }
        let hiText = maxAmount.trimmingCharacters(in: .whitespaces)
        let hi: Any = hiText.isEmpty ? NSNull() : (Int(hiText) ?? -1)
        if let h = hi as? Int, h <= lo { toast = "上限金額は下限金額より大きい整数で入力してください（空欄=上限なし）"; return }
        let body: [String: Any] = ["type": "approvalSave", "id": editingId as Any? ?? NSNull(), "target": target, "minAmount": lo, "maxAmount": hi, "approverRole": role, "allowSelfApprove": allowSelf]
        if await run("save", body, done: editingId == nil ? "ルールを追加しました" : "ルールを保存しました") { showForm = false }
    }
    func delete(_ r: NAPRow) async { _ = await run(r.id, ["type": "approvalDelete", "id": r.id], done: "ルールを削除しました") }
    func label(_ list: [NSTLabeled], _ id: String) -> String { list.first { $0.id == id }?.label ?? id }
}

struct NativeApprovalsScreen: View {
    @StateObject private var model = NativeApprovalsModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeApprovalsView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeApprovalsView: View {
    @ObservedObject var model: NativeApprovalsModel
    let onBack: () -> Void
    @State private var confirmDelete: NAPRow?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "承認ルール", en: "Approvals", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.canEdit && !model.showForm { HStack { NSPButton(text: "ルールを追加", icon: "plus", primary: true) { model.startAdd() }; Spacer() } }
                if model.showForm { form(p) }
                NSPCard(title: "金額帯ごとの必要承認ロール", en: "Rules") {
                    VStack(spacing: 0) {
                        if p.rows.isEmpty { Text("ルールがまだありません（承認なしで通ります）").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(p.rows) { r in
                            HStack(spacing: 12) {
                                Text(model.label(p.targets, r.target)).font(.system(size: 13, weight: NT.strong)).foregroundColor(NFColor.ink2).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NFColor.lilac)).frame(width: 110, alignment: .leading)
                                Text("\(NT.yen(r.minAmount)) 〜 \(r.maxAmount.map { NT.yen($0) } ?? "上限なし")").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).monospacedDigit().frame(width: 230, alignment: .leading)
                                Text(model.label(p.roles, r.approverRole)).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.iris)
                                if r.allowSelfApprove { Text("自己承認可").font(.system(size: 11, weight: NT.strong)).foregroundColor(NFColor.saffron).padding(.horizontal, 7).padding(.vertical, 2).overlay(Capsule().stroke(NFColor.saffron.opacity(0.5), lineWidth: 1)) }
                                Spacer()
                                if p.canEdit {
                                    NSPButton(text: "編集", icon: "pencil") { model.startEdit(r) }
                                    NSPButton(text: "削除", icon: "trash", busy: model.busy == r.id) { confirmDelete = r }
                                }
                            }
                            .padding(.horizontal, 18).frame(minHeight: 60)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
        .alert("ルールを削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let r = confirmDelete { Task { await model.delete(r) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: { Text("この承認ルールを削除します") }
        .task { await model.refresh() }
    }

    private func form(_ p: NAPPayload) -> some View {
        NSPCard(title: model.editingId == nil ? "ルールを追加" : "ルールを編集", en: model.editingId == nil ? "Add" : "Edit") {
            VStack(spacing: 0) {
                NSPRow(label: "対象") { picker(p.targets, $model.target) }
                NSPRow(label: "下限金額") { NSPInput(text: $model.minAmount, placeholder: "0", width: 180, keyboard: .numberPad, trailing: "円") }
                NSPRow(label: "上限金額") { NSPInput(text: $model.maxAmount, placeholder: "上限なし", width: 180, keyboard: .numberPad, trailing: "円") }
                NSPRow(label: "必要承認ロール") { picker(p.roles, $model.role) }
                NSPRow(label: "自己承認") {
                    HStack(spacing: 10) {
                        NSPToggle(on: model.allowSelf) { model.allowSelf.toggle() }
                        Text(model.allowSelf ? "申請した本人も承認できる" : "本人は承認できない").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                    }
                }
                HStack(spacing: 10) {
                    Spacer()
                    NSPButton(text: "やめる") { model.showForm = false }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save") { Task { await model.save() } }
                }
                .padding(18)
            }
        }
    }

    private func picker(_ list: [NSTLabeled], _ sel: Binding<String>) -> some View {
        HStack(spacing: 8) {
            ForEach(list) { o in
                Button { sel.wrappedValue = o.id } label: {
                    Text(o.label).font(.system(size: 14, weight: .bold)).foregroundColor(sel.wrappedValue == o.id ? .white : NFColor.ink2)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(sel.wrappedValue == o.id ? NFColor.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

// MARK: - ほかの session が作った画面を「設定の中」として出す（戻るは設定へ）

struct NativeTableQrFromSettings: View {
    @EnvironmentObject var state: AppState
    var body: some View { NativeTableQrScreen(onClose: { state.goNativeSettings() }) }
}

struct NativeBookingFromSettings: View {
    @StateObject private var model = NativeBookingSettingsModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NativeBookingSettingsView(model: model, onHome: { state.goNativeSettings() }, onLedger: { state.goNativeLedger() }, onWeb: { path in state.leaveNativeFloor(to: path) })
    }
}

struct NativeHandyQrFromSettings: View {
    @EnvironmentObject var state: AppState
    // QR の作成・作り直し・お店の Wi-Fi・印刷もネイティブで（NativeHandyQrAdmin.swift。2026-10-25 Ronnie「101% native」）
    var body: some View { NativeHandyQrAdminView(onBack: { state.goNativeSettings() }) }
}

// MARK: - 勘定科目（Web の /app/settings/accounts と同じ）

struct NACRow: Codable, Identifiable, Hashable { let id: String; let code: String; let name: String; let category: String; let subType: String?; let defaultTaxTreatment: String; let isSystem: Bool; let sortOrder: Int }
struct NACPayload: Codable { let store: NFNamed; let canEdit: Bool; let categories: [NSTLabeled]; let subTypes: [NSTLabeled]; let taxTreatments: [NSTLabeled]; let rows: [NACRow] }

@MainActor
final class NativeAccountsModel: NSPModel<NACPayload> {
    @Published var showForm = false
    @Published var editing: NACRow?
    @Published var code = ""
    @Published var name = ""
    @Published var category = "expense"
    @Published var subType = ""
    @Published var tax = "taxable_standard"
    @Published var sortOrder = "0"
    @Published var filter = ""
    init() { super.init(part: "accounts") }

    func startAdd() { editing = nil; code = ""; name = ""; category = "expense"; subType = ""; tax = "taxable_standard"; sortOrder = "0"; showForm = true }
    func startEdit(_ r: NACRow) { editing = r; code = r.code; name = r.name; category = r.category; subType = r.subType ?? ""; tax = r.defaultTaxTreatment; sortOrder = String(r.sortOrder); showForm = true }
    func save() async {
        let body: [String: Any] = ["type": "accountSave", "id": editing?.id as Any? ?? NSNull(), "code": code, "name": name, "category": category,
                                   "subType": subType.isEmpty ? NSNull() : subType, "defaultTaxTreatment": tax, "sortOrder": Int(sortOrder) ?? 0]
        if await run("save", body, done: editing == nil ? "科目を追加しました" : "科目を保存しました") { showForm = false }
    }
    func delete(_ r: NACRow) async { _ = await run(r.id, ["type": "accountDelete", "id": r.id], done: "「\(r.name)」を削除しました") }
    func installStandard() async { _ = await run("install", ["type": "accountInstallStandard"], done: "標準の科目を入れました") }
    func label(_ list: [NSTLabeled], _ id: String?) -> String { id.flatMap { i in list.first { $0.id == i }?.label } ?? "—" }
    var groups: [(NSTLabeled, [NACRow])] {
        guard let p = payload else { return [] }
        let q = filter.trimmingCharacters(in: .whitespaces).lowercased()
        return p.categories.map { c in (c, p.rows.filter { $0.category == c.id && (q.isEmpty || $0.name.lowercased().contains(q) || $0.code.lowercased().contains(q)) }) }.filter { !$0.1.isEmpty }
    }
}

struct NativeAccountsScreen: View {
    @StateObject private var model = NativeAccountsModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeAccountsView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeAccountsView: View {
    @ObservedObject var model: NativeAccountsModel
    let onBack: () -> Void
    @State private var confirmDelete: NACRow?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "勘定科目", en: "Accounts", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                HStack(spacing: 10) {
                    NSPInput(text: $model.filter, placeholder: "コード・科目名で探す", width: 320)
                    if p.canEdit && !model.showForm { NSPButton(text: "科目を追加", icon: "plus", primary: true) { model.startAdd() } }
                    if p.canEdit && p.rows.isEmpty { NSPButton(text: "標準の科目を入れる", icon: "square.and.arrow.down", busy: model.busy == "install") { Task { await model.installStandard() } } }
                    Spacer()
                }
                if model.showForm { form(p) }
                ForEach(model.groups, id: \.0.id) { c, rows in
                    NSPCard(title: c.label, en: c.id) {
                        VStack(spacing: 0) {
                            ForEach(rows) { r in
                                HStack(spacing: 12) {
                                    Text(r.code).font(.system(size: 14, weight: NT.strong, design: .monospaced)).foregroundColor(NFColor.ink3).frame(width: 70, alignment: .leading)
                                    Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).frame(minWidth: 180, alignment: .leading)
                                    if let st = r.subType { Text(model.label(p.subTypes, st)).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac)) }
                                    Text(model.label(p.taxTreatments, r.defaultTaxTreatment)).font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
                                    if r.isSystem { Text("標準").font(.system(size: 11, weight: NT.strong)).foregroundColor(NFColor.iris).padding(.horizontal, 7).padding(.vertical, 2).overlay(Capsule().stroke(NFColor.iris.opacity(0.5), lineWidth: 1)) }
                                    Spacer()
                                    if p.canEdit {
                                        NSPButton(text: "編集", icon: "pencil") { model.startEdit(r) }
                                        NSPButton(text: "削除", icon: "trash", busy: model.busy == r.id, disabled: r.isSystem) { confirmDelete = r }
                                    }
                                }
                                .padding(.horizontal, 18).frame(minHeight: 56)
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                        }
                    }
                }
                if model.groups.isEmpty { Text(p.rows.isEmpty ? "科目がまだありません。「標準の科目を入れる」で始められます" : "見つかりません").font(.system(size: 14)).foregroundColor(NFColor.ink3) }
            }
        }
        .alert("科目を削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let r = confirmDelete { Task { await model.delete(r) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: { Text("「\(confirmDelete?.name ?? "")」を削除します") }
        .task { await model.refresh() }
    }

    private func form(_ p: NACPayload) -> some View {
        let sys = model.editing?.isSystem ?? false
        return NSPCard(title: model.editing == nil ? "科目を追加" : "科目を編集", en: model.editing == nil ? "Add" : "Edit", note: sys ? "標準科目はコード・区分を変えられません（名称は変えられます）" : nil) {
            VStack(spacing: 0) {
                NSPRow(label: "コード", required: true) { NSPInput(text: $model.code, placeholder: "例：5110", enabled: !sys, width: 180) }
                NSPRow(label: "科目名", required: true) { NSPInput(text: $model.name, placeholder: "例：仕入高", width: 360) }
                NSPRow(label: "区分") { chips(p.categories, $model.category, disabled: sys) }
                NSPRow(label: "補助区分") { chips([NSTLabeled(id: "", label: "なし")] + p.subTypes, $model.subType, disabled: false) }
                NSPRow(label: "既定の税区分") { chips(p.taxTreatments, $model.tax, disabled: false) }
                NSPRow(label: "表示順") { NSPInput(text: $model.sortOrder, placeholder: "0", width: 120, keyboard: .numberPad) }
                HStack(spacing: 10) {
                    Spacer()
                    NSPButton(text: "やめる") { model.showForm = false }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: model.code.trimmingCharacters(in: .whitespaces).isEmpty || model.name.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.save() } }
                }
                .padding(18)
            }
        }
    }

    private func chips(_ list: [NSTLabeled], _ sel: Binding<String>, disabled: Bool) -> some View {
        WrapLayout(spacing: 8) {
            ForEach(list) { o in
                Button { sel.wrappedValue = o.id } label: {
                    Text(o.label).font(.system(size: 14, weight: .bold)).foregroundColor(sel.wrappedValue == o.id ? .white : NFColor.ink2)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(sel.wrappedValue == o.id ? NFColor.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle()).disabled(disabled)
            }
        }
        .opacity(disabled ? 0.6 : 1)
    }
}

// MARK: - ハンディ端末（Web の /app/settings/handy・components/settings/handy-devices-panel.tsx と同じ）

// approval: TENPO ONE 運営の承認（pending / approved / rejected / revoked。古いサーバーは無し＝承認済み）
// 2026-10-25 Ronnie「端末のことは全部コントロールセンター」: 新しい端末の承認・台数は運営コンソール（なくした端末の解除・名前・QR はここでも）
struct NHVDevice: Codable, Identifiable, Hashable { let id: String; let name: String; let status: String; let pairedAt: String; let lastSeenAt: String?; let pairedIp: String?; let userAgent: String?; let approval: String? }
struct NHVPayload: Codable { let store: NFNamed; let canEdit: Bool; let pairBase: String?; let readOnlyNote: String?; let devices: [NHVDevice] }

@MainActor
final class NativeHandyDevicesModel: NSPModel<NHVPayload> {
    @Published var deviceName = ""
    /// 発行した QR（5分で消える）
    @Published var qr: (url: String, expiresAt: Date)?
    @Published var editing: String?
    @Published var editName = ""
    // "handy" は iPhone ハンディのテーブル一覧の part（route.ts で先に当たる）。設定の一覧は "handyDevices"
    init() { super.init(part: "handyDevices") }

    func issue() async {
        let n = deviceName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { toast = "端末の名前を入力してください"; return }
        guard let base = payload?.pairBase else { toast = "公開URL（NEXT_PUBLIC_SITE_URL）が未設定のため、QRコードを作れません"; return }
        guard busy == nil else { return }
        busy = "issue"
        defer { busy = nil }
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["type": "handyIssue", "deviceName": n])
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            let r = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            guard r?["ok"] as? Bool == true, let code = r?["code"] as? String else { toast = (r?["error"] as? String) ?? "QRコードを発行できませんでした"; return }
            let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let exp = (r?["expiresAt"] as? String).flatMap { f.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) } ?? Date().addingTimeInterval(300)
            // 登録画面は認証の外。コードは # 以降（サーバーへ送らない。Web と同じ）
            qr = (base + code, exp)
        } catch {
            toast = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }
    func revoke(_ d: NHVDevice) async { _ = await run(d.id, ["type": "handyRevoke", "id": d.id], done: "「\(d.name)」のつながりを解除しました") }
    func rename(_ d: NHVDevice) async {
        let n = editName.trimmingCharacters(in: .whitespaces)
        editing = nil
        guard !n.isEmpty, n != d.name else { return }
        _ = await run(d.id, ["type": "handyRename", "id": d.id, "name": n], done: "名前を変えました")
    }
}

struct NativeHandyDevicesScreen: View {
    @StateObject private var model = NativeHandyDevicesModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeHandyDevicesView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeHandyDevicesView: View {
    @ObservedObject var model: NativeHandyDevicesModel
    let onBack: () -> Void
    @State private var now = Date()
    @State private var confirmRevoke: NHVDevice?
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "ハンディ端末", en: "Handy devices", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.canEdit {
                    NSPCard(title: "スマホをハンディとして登録", en: "Pair a phone") {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 10) {
                                NSPInput(text: $model.deviceName, placeholder: "端末の名前（例：ホール1・田中のiPhone）", width: 360)
                                NSPButton(text: "QRコードを表示", icon: "qrcode", primary: true, busy: model.busy == "issue", disabled: p.pairBase == nil) { Task { await model.issue() } }
                            }
                            if let q = model.qr {
                                let left = max(0, Int(q.expiresAt.timeIntervalSince(now)))
                                if left > 0 {
                                    HStack(alignment: .top, spacing: 20) {
                                        if let img = Self.qrImage(q.url) {
                                            Image(uiImage: img).interpolation(.none).resizable().scaledToFit().frame(width: 220, height: 220)
                                                .padding(10).background(RoundedRectangle(cornerRadius: 12).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                                        }
                                        VStack(alignment: .leading, spacing: 8) {
                                            Text("スマホのカメラでこの QR を読んでください").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                            Text("あと \(left / 60):\(String(format: "%02d", left % 60))").font(.system(size: 22, weight: NT.strong)).foregroundColor(NFColor.iris).monospacedDigit()
                                            NSPButton(text: "読み直す", icon: "arrow.clockwise") { Task { await model.refresh() } }
                                        }
                                    }
                                } else {
                                    Text("QR の有効期限が切れました。もう一度「QRコードを表示」を押してください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                                }
                            }
                            if p.pairBase == nil { Text("公開URL（NEXT_PUBLIC_SITE_URL）が未設定のため、QRコードを作れません").font(.system(size: 13)).foregroundColor(NFColor.danger) }
                        }
                        .padding(18)
                    }
                }
                NSPCard(title: "登録済みの端末", en: "Devices") {
                    VStack(spacing: 0) {
                        if p.devices.isEmpty { Text("まだ端末がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(p.devices) { d in
                            let revoked = d.status == "revoked"
                            let waiting = !revoked && d.approval == "pending"
                            HStack(spacing: 12) {
                                Image(systemName: "iphone").font(.system(size: 16, weight: .semibold)).foregroundColor(revoked ? NFColor.ink3 : NFColor.iris)
                                    .frame(width: 36, height: 36).background(RoundedRectangle(cornerRadius: 10).fill(revoked ? NFColor.lilacSoft : NFColor.irisSoft))
                                if model.editing == d.id {
                                    NSPInput(text: $model.editName, placeholder: "端末の名前", width: 280)
                                    NSPButton(text: "決定", primary: true) { Task { await model.rename(d) } }
                                    NSPButton(text: "やめる") { model.editing = nil }
                                } else {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) {
                                            Text(d.name).font(.system(size: 16, weight: .bold)).foregroundColor(revoked ? NFColor.ink3 : NFColor.ink).strikethrough(revoked, color: NFColor.ink3)
                                            if revoked { Text(d.approval == "rejected" ? "却下（運営）" : d.approval == "revoked" ? "解除（運営）" : "解除済み").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac)) }
                                            if waiting { Text("承認待ち").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.danger).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac)) }
                                        }
                                        // どの端末か（機種・OS）と、いま使っているか（3分以内に通信）
                                        HStack(spacing: 6) {
                                            if !revoked && !waiting {
                                                let on = Self.isOnline(d.lastSeenAt, now: now)
                                                Circle().fill(on ? NFColor.success : NFColor.ink3.opacity(0.5)).frame(width: 8, height: 8)
                                                Text(on ? "使用中" : "未使用").font(.system(size: 12, weight: .bold)).foregroundColor(on ? NFColor.success : NFColor.ink3)
                                            }
                                            Text(Self.deviceLabel(d.userAgent)).font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink2)
                                        }
                                        Text("登録 \(Self.pretty(d.pairedAt))　最後に使った \(d.lastSeenAt.map(Self.pretty) ?? "—")\(d.pairedIp.map { "　IP \($0)" } ?? "")").font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                                    }
                                }
                                Spacer()
                                if p.canEdit && !revoked && model.editing != d.id {
                                    NSPButton(text: "名前", icon: "pencil") { model.editing = d.id; model.editName = d.name }
                                    NSPButton(text: "解除", icon: "xmark.circle", busy: model.busy == d.id) { confirmRevoke = d }
                                }
                            }
                            .padding(.horizontal, 18).frame(minHeight: 62)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                        // 新しい端末の承認・台数は TENPO ONE 運営（コントロールセンター）。なくした端末の解除はここでも
                        Text(p.readOnlyNote ?? "新しい端末の承認・契約・台数は TENPO ONE 運営（コントロールセンター）で行います（なくした端末の解除はここでもできます）")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(18)
                    }
                }
            }
        }
        .onReceive(tick) { now = $0 }
        .alert("ハンディを解除", isPresented: Binding(get: { confirmRevoke != nil }, set: { if !$0 { confirmRevoke = nil } })) {
            Button("解除する", role: .destructive) { if let d = confirmRevoke { Task { await model.revoke(d) } }; confirmRevoke = nil }
            Button("やめる", role: .cancel) { confirmRevoke = nil }
        } message: { Text("「\(confirmRevoke?.name ?? "")」はハンディとして使えなくなります") }
        .task { await model.refresh() }
    }

    private static func qrImage(_ s: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)), let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
    /// 3分以内に通信していれば「使用中」
    private static func isOnline(_ iso: String?, now: Date) -> Bool {
        guard let iso else { return false }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return false }
        return now.timeIntervalSince(d) < 180
    }
    /// User-Agent から「iPhone · iOS 18.1」「Android 14」など（分からなければ「端末の種類 不明」）
    private static func deviceLabel(_ ua: String?) -> String {
        guard let ua, !ua.isEmpty else { return "端末の種類 不明" }
        func ver(_ pattern: String) -> String? {
            guard let r = ua.range(of: pattern, options: .regularExpression) else { return nil }
            return String(ua[r]).replacingOccurrences(of: "_", with: ".").components(separatedBy: CharacterSet.decimalDigits.union(CharacterSet(charactersIn: ".")).inverted).filter { !$0.isEmpty }.first
        }
        if ua.contains("iPhone") { return "iPhone" + (ver("OS [0-9_]+").map { " · iOS \($0)" } ?? "") }
        if ua.contains("iPad") { return "iPad" + (ver("OS [0-9_]+").map { " · iPadOS \($0)" } ?? "") }
        if ua.contains("Android") { return "Android" + (ver("Android [0-9.]+").map { " \($0)" } ?? "") }
        if ua.contains("TENPO") || ua.contains("TenpoOne") { return "TENPO ONE アプリ" }
        return "ブラウザ"
    }
    private static func pretty(_ iso: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        let o = DateFormatter(); o.dateFormat = "M/d HH:mm"; o.timeZone = TimeZone(identifier: "Asia/Tokyo")
        return o.string(from: d)
    }
}

// MARK: - カテゴリ（Web の /app/settings/categories・components/settings/category-panel.tsx・station-panel.tsx と同じ）

struct NCTRow: Codable, Identifiable, Hashable { let id: String; let name: String; let nameEn: String; let color: String; let sortOrder: Int; let station: String; let shared: Bool }
struct NCTPayload: Codable { let store: NFNamed; let canEdit: Bool; let colors: [String]; let stations: [NSTLabeled]; let rows: [NCTRow] }

@MainActor
final class NativeCategoriesModel: NSPModel<NCTPayload> {
    @Published var showForm = false
    @Published var editing: NCTRow?
    @Published var name = ""
    @Published var nameEn = ""
    @Published var color = "#bc5940"
    @Published var sortOrder = "0"
    init() { super.init(part: "categories") }

    func startAdd() { editing = nil; name = ""; nameEn = ""; color = payload?.colors.first ?? "#bc5940"; sortOrder = String((payload?.rows.map(\.sortOrder).max() ?? 0) + 1); showForm = true }
    func startEdit(_ r: NCTRow) { editing = r; name = r.name; nameEn = r.nameEn; color = r.color; sortOrder = String(r.sortOrder); showForm = true }
    func save() async {
        let body: [String: Any] = ["type": "categorySave", "id": editing?.id as Any? ?? NSNull(), "name": name, "nameEn": nameEn, "color": color, "sortOrder": Int(sortOrder) ?? 0]
        if await run("save", body, done: editing == nil ? "カテゴリを追加しました" : "カテゴリを保存しました") { showForm = false }
    }
    func delete(_ r: NCTRow) async { _ = await run(r.id, ["type": "categoryDelete", "id": r.id], done: "「\(r.name)」を削除しました") }
    func setStation(_ r: NCTRow, _ st: String) async { guard st != r.station else { return }; _ = await run(r.id, ["type": "categoryStation", "id": r.id, "station": st], done: "振り分けを変えました") }
    func label(_ list: [NSTLabeled], _ id: String) -> String { list.first { $0.id == id }?.label ?? id }
}

struct NativeCategoriesScreen: View {
    @StateObject private var model = NativeCategoriesModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeCategoriesView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeCategoriesView: View {
    @ObservedObject var model: NativeCategoriesModel
    let onBack: () -> Void
    @State private var confirmDelete: NCTRow?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "カテゴリ", en: "Categories", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.canEdit && !model.showForm { HStack { NSPButton(text: "カテゴリを追加", icon: "plus", primary: true) { model.startAdd() }; Spacer() } }
                if model.showForm { form(p) }
                NSPCard(title: "カテゴリ", en: "Categories") {
                    VStack(spacing: 0) {
                        if p.rows.isEmpty { Text("カテゴリがまだありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(p.rows) { r in
                            HStack(spacing: 12) {
                                RoundedRectangle(cornerRadius: 8).fill(Color(hex: UInt32(r.color.dropFirst(), radix: 16) ?? 0xBC5940)).frame(width: 28, height: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink)
                                        if r.shared { Text("全店共通").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac)) }
                                    }
                                    Text("\(r.nameEn.isEmpty ? "" : r.nameEn + "　")並び \(r.sortOrder)").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                }
                                .frame(width: 260, alignment: .leading)
                                // 振り分け（ステーション）
                                HStack(spacing: 6) {
                                    ForEach(p.stations) { st in
                                        Button { Task { await model.setStation(r, st.id) } } label: {
                                            Text(st.label).font(.system(size: 13, weight: .bold)).foregroundColor(r.station == st.id ? .white : NFColor.ink2)
                                                .padding(.horizontal, 12).frame(height: 36)
                                                .background(RoundedRectangle(cornerRadius: 9).fill(r.station == st.id ? NFColor.navy : Color.white))
                                                .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
                                        }
                                        .buttonStyle(PressableStyle()).disabled(!p.canEdit || model.busy != nil)
                                    }
                                }
                                Spacer()
                                if model.busy == r.id { ProgressView() }
                                if p.canEdit {
                                    NSPButton(text: "編集", icon: "pencil") { model.startEdit(r) }
                                    NSPButton(text: "削除", icon: "trash") { confirmDelete = r }
                                }
                            }
                            .padding(.horizontal, 18).frame(minHeight: 62)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
        .alert("カテゴリを削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let r = confirmDelete { Task { await model.delete(r) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: { Text("「\(confirmDelete?.name ?? "")」を削除します（中の商品はカテゴリなしになります）") }
        .task { await model.refresh() }
    }

    private func form(_ p: NCTPayload) -> some View {
        NSPCard(title: model.editing == nil ? "カテゴリを追加" : "カテゴリを編集", en: model.editing == nil ? "Add" : "Edit") {
            VStack(spacing: 0) {
                NSPRow(label: "カテゴリ名", required: true) { NSPInput(text: $model.name, placeholder: "例：ドリンク・前菜", width: 360) }
                NSPRow(label: "英語名") { NSPInput(text: $model.nameEn, placeholder: "Drinks", width: 360) }
                NSPRow(label: "色") {
                    HStack(spacing: 8) {
                        ForEach(p.colors, id: \.self) { c in
                            Button { model.color = c } label: {
                                RoundedRectangle(cornerRadius: 9).fill(Color(hex: UInt32(c.dropFirst(), radix: 16) ?? 0xBC5940)).frame(width: 36, height: 36)
                                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(model.color == c ? NFColor.navy : Color.clear, lineWidth: 3))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
                NSPRow(label: "並び順") { NSPInput(text: $model.sortOrder, placeholder: "0", width: 120, keyboard: .numberPad) }
                HStack(spacing: 10) {
                    Spacer()
                    NSPButton(text: "やめる") { model.showForm = false }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: model.name.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.save() } }
                }
                .padding(18)
            }
        }
    }
}

// MARK: - メニュー・プラン（Web の /app/settings/menu・/app/settings/plans・components/settings/menu-items-panel.tsx・menu-item-dialog.tsx と同じ）

struct NMIItem: Codable, Identifiable, Hashable {
    let id: String
    var categoryId: String?
    var name: String
    var nameEn: String
    var nameKana: String
    var description: String
    var itemType: String
    var price: Double
    var takeoutPrice: Double?
    var cost: Double?
    var taxRateId: String?
    var durationMinutes: Double?
    var sellStartTime: String?
    var sellEndTime: String?
    var sortOrder: Int
    var status: String
    var isSoldOut: Bool
    var pricePending: Bool
    var shared: Bool
    /// コース・プランの中身の印（飲み放題つき・食べ放題。古いサーバーは送らない）
    var includesDrinks: Bool?
    var includesAyce: Bool?
}
struct NMICategory: Codable, Identifiable, Hashable { let id: String; let name: String; let sortOrder: Int }
struct NMIPayload: Codable {
    let store: NFNamed; let canEdit: Bool; let categories: [NMICategory]; let taxRates: [NFNamed]; var items: [NMIItem]
    // プランの画面（コース／放題プランの作成。NativeCourseBuilder.swift）で使う。古いサーバーは送らない
    let courseSteps: [String: [NMIDish]]?
    let courseMains: [String: NMIMain]?
    let planCategories: [String: [String]]?
    let planOnlyCategoryIds: [String]?
    let maxCourseSteps: Int?
    let maxMainChoices: Int?
    let canEditOptions: Bool?
}

/// 画面：メニュー（コース以外）／プラン（コース＝コース・飲み放題・食べ放題）
enum NMIMode { case menu, plan }

@MainActor
final class NativeMenuItemsModel: NSPModel<NMIPayload> {
    let mode: NMIMode
    @Published var query = ""
    @Published var categoryFilter: String? = nil
    // 編集中
    @Published var showForm = false
    @Published var editing: NMIItem?
    @Published var fName = ""; @Published var fNameEn = ""; @Published var fKana = ""; @Published var fDesc = ""
    @Published var fType = "food"; @Published var fCategory: String? = nil
    @Published var fPrice = ""; @Published var fTakeout = ""; @Published var fCost = ""; @Published var fTax: String? = nil
    @Published var fDuration = ""; @Published var fStart: String? = nil; @Published var fEnd: String? = nil
    @Published var fSort = "0"; @Published var fHidden = false
    /// プランの画面：コース／放題プランの作成・編集（NativeCourseBuilder.swift）
    @Published var builder: NativeCourseBuilderModel?

    init(mode: NMIMode) { self.mode = mode; super.init(part: "menuItems") }

    func openBuilder(_ kind: NativeCourseBuilderModel.Kind, item: NMIItem?) {
        guard let p = payload else { return }
        showForm = false
        builder = NativeCourseBuilderModel(kind: kind, item: item, payload: p)
    }
    func builderSaved(_ message: String) async {
        builder = nil
        await refresh()
        toast = message
        // 注文の画面（iPad に保存したメニュー）も読み直す。足したコース・プランがすぐ出るように
        NativeCatalogCache.shared.refresh()
    }
    func deleteFromBuilder(_ i: NMIItem) async {
        await delete(i)
        builder = nil
    }
    func detailFromBuilder(_ i: NMIItem) {
        builder = nil
        startEdit(i)
    }

    static let types: [NSTLabeled] = [NSTLabeled(id: "food", label: "フード"), NSTLabeled(id: "drink", label: "ドリンク"), NSTLabeled(id: "course", label: "コース"), NSTLabeled(id: "option", label: "オプション")]
    var typesForMode: [NSTLabeled] { mode == .plan ? Self.types.filter { $0.id == "course" } : Self.types.filter { $0.id != "course" } }
    func inMode(_ i: NMIItem) -> Bool { mode == .plan ? i.itemType == "course" : i.itemType != "course" }

    /// カテゴリごと（検索・カテゴリ絞り込み）
    var sections: [(NMICategory?, [NMIItem])] {
        guard let p = payload else { return [] }
        let q = NativeSoldOutModel.norm(query)
        func ok(_ i: NMIItem) -> Bool {
            inMode(i) && (categoryFilter == nil || i.categoryId == categoryFilter) && (q.isEmpty || NativeSoldOutModel.norm(i.name).contains(q) || NativeSoldOutModel.norm(i.nameKana).contains(q) || NativeSoldOutModel.norm(i.nameEn).contains(q))
        }
        let byOrder: (NMIItem, NMIItem) -> Bool = { a, b in a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.name < b.name }
        var out: [(NMICategory?, [NMIItem])] = p.categories.sorted { $0.sortOrder < $1.sortOrder }.map { c in (c, p.items.filter { $0.categoryId == c.id && ok($0) }.sorted(by: byOrder)) }.filter { !$0.1.isEmpty }
        let known = Set(p.categories.map(\.id))
        let orphans = p.items.filter { ($0.categoryId == nil || !known.contains($0.categoryId!)) && ok($0) }.sorted(by: byOrder)
        if !orphans.isEmpty { out.append((nil, orphans)) }
        return out
    }
    func categoryName(_ id: String?) -> String { id.flatMap { i in payload?.categories.first { $0.id == i }?.name } ?? "カテゴリなし" }
    func taxName(_ id: String?) -> String { id.flatMap { i in payload?.taxRates.first { $0.id == i }?.name } ?? "既定" }
    static func num(_ v: Double?) -> String { guard let v else { return "" }; return v == v.rounded() ? String(Int(v)) : String(v) }

    func startAdd() {
        editing = nil; fName = ""; fNameEn = ""; fKana = ""; fDesc = ""; fType = mode == .plan ? "course" : "food"; fCategory = categoryFilter
        fPrice = ""; fTakeout = ""; fCost = ""; fTax = nil; fDuration = mode == .plan ? "120" : ""; fStart = nil; fEnd = nil
        fSort = String((payload?.items.filter { inMode($0) }.map(\.sortOrder).max() ?? 0) + 1); fHidden = false; showForm = true
    }
    func startEdit(_ i: NMIItem) {
        editing = i; fName = i.name; fNameEn = i.nameEn; fKana = i.nameKana; fDesc = i.description; fType = i.itemType; fCategory = i.categoryId
        fPrice = Self.num(i.price); fTakeout = Self.num(i.takeoutPrice); fCost = Self.num(i.cost); fTax = i.taxRateId
        fDuration = Self.num(i.durationMinutes); fStart = i.sellStartTime; fEnd = i.sellEndTime; fSort = String(i.sortOrder); fHidden = i.status == "hidden"; showForm = true
    }
    func save() async {
        guard let price = Double(fPrice.trimmingCharacters(in: .whitespaces)), price >= 0 else { toast = "価格は0以上で入力してください"; return }
        func opt(_ t: String) -> Any { let x = t.trimmingCharacters(in: .whitespaces); return x.isEmpty ? NSNull() : (Double(x) ?? NSNull()) }
        let item: [String: Any] = [
            "id": editing?.id as Any? ?? NSNull(), "categoryId": fCategory as Any? ?? NSNull(), "name": fName, "nameEn": fNameEn, "nameKana": fKana, "description": fDesc,
            "itemType": fType, "price": price, "takeoutPrice": opt(fTakeout), "cost": opt(fCost), "taxRateId": fTax as Any? ?? NSNull(),
            "durationMinutes": fType == "course" ? opt(fDuration) : NSNull(), "sellStartTime": fStart as Any? ?? NSNull(), "sellEndTime": fEnd as Any? ?? NSNull(),
            "sortOrder": Int(fSort) ?? 0, "status": fHidden ? "hidden" : "active",
        ]
        if await run("save", ["type": "menuItemSave", "item": item], done: editing == nil ? "商品を追加しました" : "商品を保存しました") { showForm = false }
    }
    func delete(_ i: NMIItem) async { if await run(i.id, ["type": "menuItemDelete", "id": i.id], done: "「\(i.name)」を削除しました") { showForm = false } }
    func toggleSoldOut(_ i: NMIItem) async { _ = await run(i.id, ["type": "menuItemSoldOut", "id": i.id, "soldOut": !i.isSoldOut], done: i.isSoldOut ? "販売を再開しました" : "売切にしました") }
}

struct NativeMenuItemsScreen: View {
    let mode: NMIMode
    @StateObject private var model: NativeMenuItemsModel
    @EnvironmentObject var state: AppState
    init(mode: NMIMode) { self.mode = mode; _model = StateObject(wrappedValue: NativeMenuItemsModel(mode: mode)) }
    var body: some View { NativeMenuItemsView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeMenuItemsView: View {
    @ObservedObject var model: NativeMenuItemsModel
    let onBack: () -> Void
    @State private var confirmDelete: NMIItem?
    private var isPlan: Bool { model.mode == .plan }

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: isPlan ? "プラン" : "メニュー", en: isPlan ? "Plans" : "Menu", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if isPlan, let bm = model.builder {
                // コース／放題プランの作成・編集（料理・選べるメイン・出すカテゴリまで1つの画面で）
                NativeCourseBuilderView(
                    b: bm,
                    onClose: { model.builder = nil },
                    onSaved: { msg in Task { await model.builderSaved(msg) } },
                    onDelete: { item in Task { await model.deleteFromBuilder(item) } },
                    onDetail: { item in model.detailFromBuilder(item) }
                )
            } else if let p = model.payload {
                HStack(spacing: 10) {
                    NSPInput(text: $model.query, placeholder: "商品名・フリガナで探す", width: 300)
                    if !isPlan {
                        Menu {
                            Button("すべてのカテゴリ") { model.categoryFilter = nil }
                            ForEach(p.categories.sorted { $0.sortOrder < $1.sortOrder }) { c in Button(c.name) { model.categoryFilter = c.id } }
                        } label: {
                            HStack(spacing: 6) {
                                Text(model.categoryFilter.map { model.categoryName($0) } ?? "すべてのカテゴリ").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 14).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                        }
                    }
                    if p.canEdit && !model.showForm {
                        if isPlan {
                            // コース（料理・選べるメイン）と 放題プラン（飲み放題・食べ放題）を分けて作る（2026-10-25 Ronnie）
                            NSPButton(text: "コースを追加", icon: "plus", primary: true) { model.openBuilder(.course, item: nil) }
                            NSPButton(text: "放題プランを追加", icon: "plus") { model.openBuilder(.plan, item: nil) }
                        } else {
                            NSPButton(text: "商品を追加", icon: "plus", primary: true) { model.startAdd() }
                        }
                    }
                    // 写真・PDF からまとめて登録（Web のメニューの画面と同じ入口。登録の権限はサーバーで確かめる）
                    if !isPlan && p.canEdit && !model.showForm {
                        NSPButton(text: "写真・PDFから登録", icon: "doc.viewfinder") { AppState.shared.openSettingsPage(.menuScan, webPath: NativeSettingsPageKey.menuScan.path) }
                    }
                    Spacer()
                }
                if model.showForm { form(p) }
                let secs = model.sections
                if secs.isEmpty { Text(isPlan ? "コース・放題プランがまだありません（上の「コースを追加」「放題プランを追加」から）" : "商品が見つかりません").font(.system(size: 14)).foregroundColor(NFColor.ink3) }
                ForEach(Array(secs.enumerated()), id: \.offset) { _, sec in
                    NSPCard(title: sec.0?.name ?? "カテゴリなし", en: "") {
                        VStack(spacing: 0) {
                            ForEach(sec.1) { it in row(it, p: p) }
                        }
                    }
                }
            }
        }
        .alert("商品を削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let i = confirmDelete { Task { await model.delete(i) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: { Text("「\(confirmDelete?.name ?? "")」を削除します") }
        .task { await model.refresh() }
    }

    private func row(_ it: NMIItem, p: NMIPayload) -> some View {
        let hidden = it.status == "hidden"
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(it.name).font(.system(size: 16, weight: .bold)).foregroundColor(hidden ? NFColor.ink3 : NFColor.ink).lineLimit(1).strikethrough(hidden, color: NFColor.ink3)
                    if it.shared { tag("全店共通", NFColor.ink3) }
                    if hidden { tag("非表示", NFColor.ink3) }
                    if it.pricePending { tag("価格未設定", NFColor.danger) }
                    if it.itemType == "course", let m = it.durationMinutes { tag("\(Int(m))分", NFColor.iris) }
                    if isPlan { planTags(it, p) }
                }
                HStack(spacing: 8) {
                    if !it.nameEn.isEmpty { Text(it.nameEn).font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                    if let s = it.sellStartTime, let e = it.sellEndTime { Text("\(s)〜\(e)").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                    if !isPlan { Text(NativeMenuItemsModel.types.first { $0.id == it.itemType }?.label ?? it.itemType).font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                }
            }
            Spacer()
            Text(NT.yen(Int(it.price))).font(.system(size: 17, weight: NT.strong)).foregroundColor(NFColor.navy).monospacedDigit()
            if let t = it.takeoutPrice { Text("TO \(NT.yen(Int(t)))").font(.system(size: 12)).foregroundColor(NFColor.ink3).monospacedDigit() }
            Button { Task { await model.toggleSoldOut(it) } } label: {
                Text(it.isSoldOut ? "売切" : "販売中").font(.system(size: 12, weight: NT.strong)).foregroundColor(it.isSoldOut ? .white : NFColor.success)
                    .frame(width: 60, height: 30).background(Capsule().fill(it.isSoldOut ? NFColor.danger : NFColor.successSoft))
            }
            .buttonStyle(PressableStyle()).disabled(!p.canEdit || model.busy != nil)
            if model.busy == it.id { ProgressView() }
            if p.canEdit {
                NSPButton(text: "編集", icon: "pencil") {
                    if isPlan { model.openBuilder(NativeCourseBuilderModel.kindOf(it, p), item: it) } else { model.startEdit(it) }
                }
            }
        }
        .padding(.horizontal, 18).frame(minHeight: 58)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func tag(_ t: String, _ c: Color) -> some View {
        Text(t).font(.system(size: 10.5, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 6).padding(.vertical, 2).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }

    /// プランの一覧の印：コース／飲み放題…・料理の数・選べるメインの数
    @ViewBuilder private func planTags(_ it: NMIItem, _ p: NMIPayload) -> some View {
        let kind = NativeCourseBuilderModel.kindOf(it, p)
        let steps = p.courseSteps?[it.id]?.count ?? 0
        tag(kind == .course ? "コース" : NativeCourseBuilderModel.planLabel(NativeCourseBuilderModel.planKindOf(it) ?? "drink"), NT.purple)
        if steps > 0 { tag("料理\(steps)品", NFColor.ink3) }
        if let m = p.courseMains?[it.id] { tag("メイン\(m.choices.count)種", NFColor.ink3) }
    }

    private func form(_ p: NMIPayload) -> some View {
        NSPCard(title: model.editing == nil ? (isPlan ? "プランを追加" : "商品を追加") : (isPlan ? "プランを編集" : "商品を編集"), en: model.editing == nil ? "Add" : "Edit") {
            VStack(spacing: 0) {
                NSPRow(label: "商品名", required: true) { NSPInput(text: $model.fName, placeholder: "例：生ビール", width: 400) }
                NSPRow(label: "英語名") { NSPInput(text: $model.fNameEn, placeholder: "Draft beer", width: 400) }
                NSPRow(label: "フリガナ") { NSPInput(text: $model.fKana, placeholder: "ナマビール", width: 400) }
                if !isPlan { NSPRow(label: "種別") { chips(model.typesForMode, Binding(get: { model.fType }, set: { model.fType = $0 })) } }
                NSPRow(label: "カテゴリ") {
                    Menu {
                        Button("カテゴリなし") { model.fCategory = nil }
                        ForEach(p.categories.sorted { $0.sortOrder < $1.sortOrder }) { c in Button(c.name) { model.fCategory = c.id } }
                    } label: {
                        HStack(spacing: 6) {
                            Text(model.categoryName(model.fCategory)).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                        }
                        .padding(.horizontal, 14).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                    }
                }
                NSPRow(label: "価格", required: true) {
                    HStack(spacing: 10) {
                        NSPInput(text: $model.fPrice, placeholder: "0", width: 160, keyboard: .numberPad, trailing: "円")
                        Text("テイクアウト").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        NSPInput(text: $model.fTakeout, placeholder: "同じ", width: 150, keyboard: .numberPad, trailing: "円")
                        Text("原価").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        NSPInput(text: $model.fCost, placeholder: "—", width: 140, keyboard: .numberPad, trailing: "円")
                    }
                }
                NSPRow(label: "税率") {
                    chips([NSTLabeled(id: "", label: "既定")] + p.taxRates.map { NSTLabeled(id: $0.id, label: $0.name) }, Binding(get: { model.fTax ?? "" }, set: { model.fTax = $0.isEmpty ? nil : $0 }))
                }
                if model.fType == "course" {
                    NSPRow(label: "時間") { NSPInput(text: $model.fDuration, placeholder: "120", width: 140, keyboard: .numberPad, trailing: "分") }
                }
                NSPRow(label: "販売時間") {
                    HStack(spacing: 8) {
                        NSPTimeMenu(value: model.fStart, options: NSPApi.timeOptions(toMin: 23 * 60 + 45)) { model.fStart = $0 }
                        Text("〜").foregroundColor(NFColor.ink3)
                        NSPTimeMenu(value: model.fEnd, options: NSPApi.timeOptions(toMin: 23 * 60 + 45)) { model.fEnd = $0 }
                        Text("空なら終日").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                }
                NSPRow(label: "説明") { NSPInput(text: $model.fDesc, placeholder: "", width: 520) }
                NSPRow(label: "並び順") {
                    HStack(spacing: 14) {
                        NSPInput(text: $model.fSort, placeholder: "0", width: 120, keyboard: .numberPad)
                        NSPToggle(on: model.fHidden) { model.fHidden.toggle() }
                        Text(model.fHidden ? "非表示（レジ・ハンディに出さない）" : "表示").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                    }
                }
                HStack(spacing: 10) {
                    if let e = model.editing { NSPButton(text: "削除", icon: "trash") { confirmDelete = e } }
                    Spacer()
                    NSPButton(text: "やめる") { model.showForm = false }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: model.fName.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.save() } }
                }
                .padding(18)
            }
        }
    }

    private func chips(_ list: [NSTLabeled], _ sel: Binding<String>) -> some View {
        WrapLayout(spacing: 8) {
            ForEach(list) { o in
                Button { sel.wrappedValue = o.id } label: {
                    Text(o.label).font(.system(size: 14, weight: .bold)).foregroundColor(sel.wrappedValue == o.id ? .white : NFColor.ink2)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(sel.wrappedValue == o.id ? NFColor.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

// MARK: - オプション（Web の /app/settings/options・components/settings/option-groups-panel.tsx と同じ）

struct NOGItem: Codable, Identifiable, Hashable { let id: String; let name: String; let nameEn: String?; let price: Double }
struct NOGGroup: Codable, Identifiable, Hashable { let id: String; let name: String; let isRequired: Bool; let minSelect: Int; let maxSelect: Int; let items: [NOGItem]; let menuItemIds: [String] }
struct NOGPayload: Codable { let store: NFNamed; let canEdit: Bool; let groups: [NOGGroup]; let menuItems: [NFNamed] }

@MainActor
final class NativeOptionsModel: NSPModel<NOGPayload> {
    @Published var showForm = false
    @Published var editing: NOGGroup?
    @Published var gName = ""; @Published var gRequired = false; @Published var gMin = "0"; @Published var gMax = "1"
    /// 選択肢の追加（グループごと）
    @Published var newItemName: [String: String] = [:]
    @Published var newItemEn: [String: String] = [:]
    @Published var newItemPrice: [String: String] = [:]
    /// 対象商品を選んでいるグループ
    @Published var linking: NOGGroup?
    @Published var linkIds: Set<String> = []
    @Published var linkQuery = ""
    init() { super.init(part: "options") }

    func startAdd() { editing = nil; gName = ""; gRequired = false; gMin = "0"; gMax = "1"; showForm = true }
    func startEdit(_ g: NOGGroup) { editing = g; gName = g.name; gRequired = g.isRequired; gMin = String(g.minSelect); gMax = String(g.maxSelect); showForm = true }
    func saveGroup() async {
        guard let mn = Int(gMin), let mx = Int(gMax), mn >= 0, mx >= 0 else { toast = "選ぶ数は数字で入れてください"; return }
        if await run("save", ["type": "optionGroupSave", "id": editing?.id as Any? ?? NSNull(), "name": gName, "isRequired": gRequired, "minSelect": mn, "maxSelect": mx], done: editing == nil ? "グループを追加しました" : "グループを保存しました") { showForm = false }
    }
    func deleteGroup(_ g: NOGGroup) async { _ = await run(g.id, ["type": "optionGroupDelete", "id": g.id], done: "「\(g.name)」を削除しました") }
    func move(_ g: NOGGroup, _ dir: String) async { _ = await run(g.id, ["type": "optionGroupMove", "id": g.id, "direction": dir]) }
    func addItem(_ g: NOGGroup) async {
        let name = (newItemName[g.id] ?? "").trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { toast = "選択肢の名前を入力してください"; return }
        let price = Double((newItemPrice[g.id] ?? "0").trimmingCharacters(in: .whitespaces)) ?? 0
        if await run("add:\(g.id)", ["type": "optionItemAdd", "groupId": g.id, "name": name, "nameEn": newItemEn[g.id] ?? "", "price": price], done: "選択肢を追加しました") {
            newItemName[g.id] = ""; newItemEn[g.id] = ""; newItemPrice[g.id] = ""
        }
    }
    func deleteItem(_ it: NOGItem) async { _ = await run(it.id, ["type": "optionItemDelete", "id": it.id], done: "選択肢を消しました") }
    func startLink(_ g: NOGGroup) { linking = g; linkIds = Set(g.menuItemIds); linkQuery = "" }
    func saveLink() async {
        guard let g = linking else { return }
        if await run("link", ["type": "optionGroupItems", "groupId": g.id, "menuItemIds": Array(linkIds)], done: "対象の商品を保存しました") { linking = nil }
    }
}

struct NativeOptionsScreen: View {
    @StateObject private var model = NativeOptionsModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeOptionsView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeOptionsView: View {
    @ObservedObject var model: NativeOptionsModel
    let onBack: () -> Void
    @State private var confirmDelete: NOGGroup?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "オプション", en: "Options", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.canEdit && !model.showForm && model.linking == nil { HStack { NSPButton(text: "グループを追加", icon: "plus", primary: true) { model.startAdd() }; Spacer() } }
                if model.showForm { groupForm }
                if let g = model.linking { linkCard(g, p) }
                if p.groups.isEmpty { Text("選択肢のグループがまだありません（例：サイズ・トッピング・辛さ）").font(.system(size: 14)).foregroundColor(NFColor.ink3) }
                ForEach(Array(p.groups.enumerated()), id: \.element.id) { idx, g in
                    NSPCard(title: g.name, en: g.isRequired ? "必須・\(g.minSelect)〜\(g.maxSelect)" : "任意・最大\(g.maxSelect)") {
                        VStack(spacing: 0) {
                            if g.items.isEmpty { Text("選択肢がまだありません").font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(.horizontal, 18).padding(.vertical, 10) }
                            ForEach(g.items) { it in
                                HStack(spacing: 10) {
                                    Text(it.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                    if let en = it.nameEn, !en.isEmpty { Text(en).font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                                    Spacer()
                                    Text(it.price == 0 ? "±0" : "+\(NT.yen(Int(it.price)))").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy).monospacedDigit()
                                    if p.canEdit { NSPButton(text: "消す", icon: "xmark", busy: model.busy == it.id) { Task { await model.deleteItem(it) } } }
                                }
                                .padding(.horizontal, 18).frame(minHeight: 48)
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                            if p.canEdit {
                                HStack(spacing: 8) {
                                    NSPInput(text: Binding(get: { model.newItemName[g.id] ?? "" }, set: { model.newItemName[g.id] = $0 }), placeholder: "選択肢（例：大盛り）", width: 220)
                                    NSPInput(text: Binding(get: { model.newItemEn[g.id] ?? "" }, set: { model.newItemEn[g.id] = $0 }), placeholder: "English", width: 160)
                                    NSPInput(text: Binding(get: { model.newItemPrice[g.id] ?? "" }, set: { model.newItemPrice[g.id] = $0 }), placeholder: "0", width: 120, keyboard: .numberPad, trailing: "円")
                                    NSPButton(text: "追加", icon: "plus", busy: model.busy == "add:\(g.id)") { Task { await model.addItem(g) } }
                                    Spacer()
                                }
                                .padding(.horizontal, 18).padding(.vertical, 10)
                                .background(NFColor.lilacSoft)
                                HStack(spacing: 8) {
                                    NSPButton(text: "対象の商品（\(g.menuItemIds.count)）", icon: "link") { model.startLink(g) }
                                    NSPButton(text: "編集", icon: "pencil") { model.startEdit(g) }
                                    NSPButton(text: "↑", disabled: idx == 0) { Task { await model.move(g, "up") } }
                                    NSPButton(text: "↓", disabled: idx == p.groups.count - 1) { Task { await model.move(g, "down") } }
                                    Spacer()
                                    NSPButton(text: "削除", icon: "trash") { confirmDelete = g }
                                }
                                .padding(.horizontal, 18).padding(.vertical, 10)
                            } else {
                                Text("対象の商品：\(g.menuItemIds.count)").font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(.horizontal, 18).padding(.vertical, 10)
                            }
                        }
                    }
                }
            }
        }
        .alert("グループを削除", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("削除する", role: .destructive) { if let g = confirmDelete { Task { await model.deleteGroup(g) } }; confirmDelete = nil }
            Button("やめる", role: .cancel) { confirmDelete = nil }
        } message: { Text("「\(confirmDelete?.name ?? "")」と中の選択肢を削除します") }
        .task { await model.refresh() }
    }

    private var groupForm: some View {
        NSPCard(title: model.editing == nil ? "グループを追加" : "グループを編集", en: "") {
            VStack(spacing: 0) {
                NSPRow(label: "グループ名", required: true) { NSPInput(text: $model.gName, placeholder: "例：サイズ・トッピング", width: 360) }
                NSPRow(label: "必須") {
                    HStack(spacing: 10) { NSPToggle(on: model.gRequired) { model.gRequired.toggle() }; Text(model.gRequired ? "必ず選ぶ" : "選ばなくてもよい").font(.system(size: 14)).foregroundColor(NFColor.ink2) }
                }
                NSPRow(label: "選ぶ数") {
                    HStack(spacing: 8) {
                        NSPInput(text: $model.gMin, placeholder: "0", width: 100, keyboard: .numberPad)
                        Text("〜").foregroundColor(NFColor.ink3)
                        NSPInput(text: $model.gMax, placeholder: "1", width: 100, keyboard: .numberPad)
                    }
                }
                HStack(spacing: 10) {
                    Spacer()
                    NSPButton(text: "やめる") { model.showForm = false }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: model.gName.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.saveGroup() } }
                }
                .padding(18)
            }
        }
    }

    private func linkCard(_ g: NOGGroup, _ p: NOGPayload) -> some View {
        let q = NativeSoldOutModel.norm(model.linkQuery)
        let list = p.menuItems.filter { q.isEmpty || NativeSoldOutModel.norm($0.name).contains(q) }
        return NSPCard(title: "「\(g.name)」の対象の商品", en: "\(model.linkIds.count) 件") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    NSPInput(text: $model.linkQuery, placeholder: "商品名で探す", width: 300)
                    NSPButton(text: "すべて選ぶ") { model.linkIds = Set(list.map(\.id)) }
                    NSPButton(text: "すべて外す") { model.linkIds = [] }
                    Spacer()
                    NSPButton(text: "やめる") { model.linking = nil }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "link") { Task { await model.saveLink() } }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                    ForEach(list) { m in
                        let on = model.linkIds.contains(m.id)
                        Button { if on { model.linkIds.remove(m.id) } else { model.linkIds.insert(m.id) } } label: {
                            HStack(spacing: 8) {
                                Image(systemName: on ? "checkmark.square.fill" : "square").foregroundColor(on ? NFColor.iris : NFColor.ink3)
                                Text(m.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(on ? NFColor.irisSoft : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
            }
            .padding(18)
        }
    }
}

// MARK: - QRのサービス（Web の /app/settings/qr-service・components/settings/qr-service-editor.tsx と同じ）

struct NQSItem: Codable, Identifiable, Hashable { var name: String; var nameEn: String?; var id: String { name + "|" + (nameEn ?? "") } }
struct NQSPayload: Codable { let store: NFNamed; let canEdit: Bool; let enabled: Bool; let items: [NQSItem]; let maxItems: Int }

@MainActor
final class NativeQrServiceModel: NSPModel<NQSPayload> {
    @Published var enabled = true
    @Published var rows: [(name: String, en: String)] = []
    init() { super.init(part: "qrService") }
    override func loaded(_ p: NQSPayload) { enabled = p.enabled; rows = p.items.map { ($0.name, $0.nameEn ?? "") } }
    var changed: Bool {
        guard let p = payload else { return false }
        return enabled != p.enabled || rows.map { $0.name } != p.items.map { $0.name } || rows.map { $0.en } != p.items.map { $0.nameEn ?? "" }
    }
    func save() async {
        let items = rows.map { ["name": $0.name, "nameEn": $0.en.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : $0.en] as [String: Any] }
        _ = await run("save", ["type": "qrServiceSave", "enabled": enabled, "items": items], done: "保存しました")
    }
}

struct NativeQrServiceScreen: View {
    @StateObject private var model = NativeQrServiceModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeQrServiceView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeQrServiceView: View {
    @ObservedObject var model: NativeQrServiceModel
    let onBack: () -> Void
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "QRのサービス", en: "QR service", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                let edit = p.canEdit
                NSPCard(title: "お客様QRの「サービス」", en: "お水・お箸など、無料で頼めるもの") {
                    VStack(spacing: 0) {
                        NSPRow(label: "お客様QRに出す") {
                            HStack(spacing: 10) { NSPToggle(on: model.enabled, disabled: !edit) { model.enabled.toggle() }; Text(model.enabled ? "出す" : "出さない").font(.system(size: 14, weight: .bold)).foregroundColor(model.enabled ? NFColor.success : NFColor.ink3) }
                        }
                        ForEach(model.rows.indices, id: \.self) { i in
                            HStack(spacing: 10) {
                                Text("\(i + 1)").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 24)
                                NSPInput(text: Binding(get: { model.rows[i].name }, set: { model.rows[i].name = $0 }), placeholder: "お水", enabled: edit, width: 260)
                                NSPInput(text: Binding(get: { model.rows[i].en }, set: { model.rows[i].en = $0 }), placeholder: "Water", enabled: edit, width: 220)
                                if edit {
                                    NSPButton(text: "↑", disabled: i == 0) { model.rows.swapAt(i, i - 1) }
                                    NSPButton(text: "↓", disabled: i == model.rows.count - 1) { model.rows.swapAt(i, i + 1) }
                                    NSPButton(text: "消す", icon: "xmark") { model.rows.remove(at: i) }
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 18).padding(.vertical, 6)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                        if edit {
                            HStack(spacing: 10) {
                                NSPButton(text: "追加", icon: "plus", disabled: model.rows.count >= p.maxItems) { model.rows.append(("", "")) }
                                Spacer()
                                NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: !model.changed) { Task { await model.save() } }
                            }
                            .padding(18)
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }
}

// MARK: - メニューブック（Web の /app/settings/menu-book・components/settings/menu-book-editor.tsx と同じ）

struct NMBShow: Codable, Identifiable, Hashable { let id: String; let label: String; let note: String }
struct NMBCategory: Codable, Identifiable, Hashable { let id: String; let name: String; let nameEn: String; let color: String; let sortOrder: Int; let shared: Bool; let itemCount: Int; let group: String; let show: String; let autoShow: String }
struct NMBItem: Codable, Identifiable, Hashable { let id: String; let name: String; let categoryId: String?; let price: Double; let sortOrder: Int }
struct NMBPlan: Codable, Identifiable, Hashable { let id: String; let name: String; let price: Double; let categoryIds: [String]?; let addOn: Bool }
struct NMBPage: Codable, Identifiable, Hashable { var key: String; var name: String; var id: String { key } }
struct NMBLunch: Codable, Hashable { var start: String; var end: String }
struct NMBPayload: Codable {
    let store: NFNamed; let canEdit: Bool; let shows: [NMBShow]; let categories: [NMBCategory]; let items: [NMBItem]; let plans: [NMBPlan]
    let lunch: NMBLunch; let pages: [NMBPage]; let categoryPage: [String: String]; let takeoutItemIds: [String]
}

@MainActor
final class NativeMenuBookModel: NSPModel<NMBPayload> {
    enum Tab: String, CaseIterable { case categories, items, plans, pages, lunch, takeout
        var label: String { switch self { case .categories: return "カテゴリ"; case .items: return "商品の並び順"; case .plans: return "プラン"; case .pages: return "ページ"; case .lunch: return "ランチ"; case .takeout: return "テイクアウト" } }
    }
    @Published var tab: Tab = .categories
    // カテゴリ：並び＋出し方
    @Published var catOrder: [NMBCategory] = []
    @Published var catShow: [String: String] = [:]
    // 商品の並び順
    @Published var orderCategory: String? = nil
    @Published var itemOrder: [NMBItem] = []
    // プラン
    @Published var planCats: [String: [String]?] = [:]
    // ページ
    @Published var pages: [NMBPage] = []
    @Published var categoryPage: [String: String] = [:]
    // ランチ
    @Published var lunchStart = "10:00"
    @Published var lunchEnd = "16:00"
    // テイクアウト
    @Published var takeout: Set<String> = []
    @Published var takeoutQuery = ""
    init() { super.init(part: "menuBook") }

    override func loaded(_ p: NMBPayload) {
        catOrder = p.categories
        catShow = Dictionary(uniqueKeysWithValues: p.categories.map { ($0.id, $0.show) })
        if orderCategory == nil { orderCategory = p.categories.first?.id }
        reloadItemOrder(p)
        planCats = Dictionary(uniqueKeysWithValues: p.plans.map { ($0.id, $0.categoryIds) })
        pages = p.pages
        categoryPage = p.categoryPage
        lunchStart = p.lunch.start; lunchEnd = p.lunch.end
        takeout = Set(p.takeoutItemIds)
    }
    func reloadItemOrder(_ p: NMBPayload? = nil) {
        guard let p = p ?? payload else { return }
        itemOrder = p.items.filter { $0.categoryId == orderCategory }.sorted { $0.sortOrder != $1.sortOrder ? $0.sortOrder < $1.sortOrder : $0.name < $1.name }
    }
    func showLabel(_ id: String) -> String { payload?.shows.first { $0.id == id }?.label ?? id }
    func pageName(_ key: String?) -> String { key.flatMap { k in pages.first { $0.key == k }?.name } ?? "自動" }

    func saveLayout() async {
        let rows = catOrder.map { ["id": $0.id, "show": catShow[$0.id] ?? "auto"] }
        _ = await run("layout", ["type": "menuBookLayout", "rows": rows], done: "カテゴリの並びと出し方を保存しました")
    }
    func saveItemOrder() async {
        guard let c = orderCategory else { return }
        _ = await run("items", ["type": "menuBookItemOrder", "categoryId": c, "itemIds": itemOrder.map(\.id)], done: "商品の並び順を保存しました")
    }
    func savePlans() async {
        let rows = planCats.map { k, v -> [String: Any] in ["planItemId": k, "categoryIds": v.map { $0 as Any } ?? NSNull()] }
        _ = await run("plans", ["type": "menuBookPlans", "rows": rows], done: "プランで出すカテゴリを保存しました")
    }
    func savePages() async {
        _ = await run("pages", ["type": "menuBookPages", "pages": pages.map { ["key": $0.key, "name": $0.name] }, "categoryPage": categoryPage], done: "ページを保存しました")
    }
    func saveLunch() async { _ = await run("lunch", ["type": "menuBookLunch", "start": lunchStart, "end": lunchEnd], done: "ランチの時間を保存しました") }
    func saveTakeout() async { _ = await run("takeout", ["type": "menuBookTakeout", "itemIds": Array(takeout)], done: "テイクアウトのメニューを保存しました") }
}

struct NativeMenuBookScreen: View {
    @StateObject private var model = NativeMenuBookModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeMenuBookView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeMenuBookView: View {
    @ObservedObject var model: NativeMenuBookModel
    let onBack: () -> Void

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "メニューブック", en: "Menu book", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                // 上のタブ
                HStack(spacing: 6) {
                    ForEach(NativeMenuBookModel.Tab.allCases, id: \.self) { t in
                        Button { model.tab = t } label: {
                            Text(t.label).font(.system(size: 15, weight: .bold)).foregroundColor(model.tab == t ? .white : NFColor.ink2)
                                .padding(.horizontal, 16).frame(height: 42)
                                .background(RoundedRectangle(cornerRadius: 11).fill(model.tab == t ? NFColor.navy : Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 11).stroke(NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                    }
                    Spacer()
                }
                switch model.tab {
                case .categories: categoriesTab(p)
                case .items: itemsTab(p)
                case .plans: plansTab(p)
                case .pages: pagesTab(p)
                case .lunch: lunchTab(p)
                case .takeout: takeoutTab(p)
                }
            }
        }
        .task { await model.refresh() }
    }

    private func arrows(_ i: Int, _ count: Int, up: @escaping () -> Void, down: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            NSPButton(text: "↑", disabled: i == 0, action: up)
            NSPButton(text: "↓", disabled: i == count - 1, action: down)
        }
    }

    private func categoriesTab(_ p: NMBPayload) -> some View {
        NSPCard(title: "カテゴリの並びと出し方", en: "ハンディ・お客様QR") {
            VStack(spacing: 0) {
                ForEach(Array(model.catOrder.enumerated()), id: \.element.id) { i, c in
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 6).fill(Color(hex: UInt32(c.color.dropFirst(), radix: 16) ?? 0xBC5940)).frame(width: 20, height: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 6) {
                                Text(c.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                if c.shared { Text("全店共通").font(.system(size: 10.5, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.lilac)) }
                            }
                            Text("\(c.group)・\(c.itemCount)品").font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                        }
                        .frame(width: 230, alignment: .leading)
                        Menu {
                            Button("自動（\(model.showLabel(c.autoShow))）") { model.catShow[c.id] = "auto" }
                            ForEach(p.shows) { sh in Button(sh.label) { model.catShow[c.id] = sh.id } }
                        } label: {
                            HStack(spacing: 6) {
                                let cur = model.catShow[c.id] ?? "auto"
                                Text(cur == "auto" ? "自動：\(model.showLabel(c.autoShow))" : model.showLabel(cur)).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 12).frame(height: 40)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                        }
                        .disabled(!p.canEdit)
                        Spacer()
                        if p.canEdit { arrows(i, model.catOrder.count, up: { model.catOrder.swapAt(i, i - 1) }, down: { model.catOrder.swapAt(i, i + 1) }) }
                    }
                    .padding(.horizontal, 18).frame(minHeight: 54)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                if p.canEdit { HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "layout") { Task { await model.saveLayout() } } }.padding(18) }
            }
        }
    }

    private func itemsTab(_ p: NMBPayload) -> some View {
        NSPCard(title: "商品の並び順", en: "レジ・ハンディ・お客様QRで同じ順") {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(p.categories) { c in Button(c.name) { model.orderCategory = c.id; model.reloadItemOrder() } }
                    } label: {
                        HStack(spacing: 6) {
                            Text(p.categories.first { $0.id == model.orderCategory }?.name ?? "カテゴリを選ぶ").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                        }
                        .padding(.horizontal, 14).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                    }
                    Spacer()
                    if p.canEdit { NSPButton(text: "保存する", primary: true, busy: model.busy == "items", disabled: model.itemOrder.isEmpty) { Task { await model.saveItemOrder() } } }
                }
                .padding(18)
                Rectangle().fill(NFColor.line).frame(height: 1)
                if model.itemOrder.isEmpty { Text("このカテゴリに商品がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                ForEach(Array(model.itemOrder.enumerated()), id: \.element.id) { i, it in
                    HStack(spacing: 10) {
                        Text("\(i + 1)").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 28)
                        Text(it.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                        Text(NT.yen(Int(it.price))).font(.system(size: 13)).foregroundColor(NFColor.ink3).monospacedDigit()
                        Spacer()
                        if p.canEdit { arrows(i, model.itemOrder.count, up: { model.itemOrder.swapAt(i, i - 1) }, down: { model.itemOrder.swapAt(i, i + 1) }) }
                    }
                    .padding(.horizontal, 18).frame(minHeight: 50)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
            }
        }
    }

    private func plansTab(_ p: NMBPayload) -> some View {
        NSPCard(title: "プランで出すカテゴリ", en: "飲み放題 A・AB・ABC やコースごと") {
            VStack(spacing: 0) {
                if p.plans.isEmpty { Text("プラン（コース・飲み放題・食べ放題）がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                ForEach(p.plans) { pl in
                    let sel = model.planCats[pl.id] ?? nil
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Text(pl.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                            if pl.addOn { Text("追加・延長").font(.system(size: 10.5, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.lilac)) }
                            Text(NT.yen(Int(pl.price))).font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            Spacer()
                            // 値が Optional の辞書に nil を入れるとキーが消えるので updateValue で「指定なし」を残す
                            Button { model.planCats.updateValue(sel == nil ? [] : nil, forKey: pl.id) } label: {
                                Text(sel == nil ? "指定なし（プランのときだけのカテゴリを全部）" : "指定する").font(.system(size: 13, weight: .bold)).foregroundColor(sel == nil ? NFColor.ink2 : NFColor.iris)
                            }
                            .buttonStyle(.plain).disabled(!p.canEdit)
                        }
                        if let sel {
                            WrapLayout(spacing: 6) {
                                ForEach(p.categories) { c in
                                    let on = sel.contains(c.id)
                                    Button { var next = sel; if on { next.removeAll { $0 == c.id } } else { next.append(c.id) }; model.planCats.updateValue(next, forKey: pl.id) } label: {
                                        Text(c.name).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                                            .padding(.horizontal, 12).frame(height: 34)
                                            .background(Capsule().fill(on ? NFColor.iris : Color.white)).overlay(Capsule().stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                                    }
                                    .buttonStyle(PressableStyle()).disabled(!p.canEdit)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                if p.canEdit && !p.plans.isEmpty { HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "plans") { Task { await model.savePlans() } } }.padding(18) }
            }
        }
    }

    private func pagesTab(_ p: NMBPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NSPCard(title: "上のタブ（ページ）", en: "並びと名前") {
                VStack(spacing: 0) {
                    ForEach(Array(model.pages.enumerated()), id: \.element.key) { i, pg in
                        HStack(spacing: 10) {
                            Text(pg.key).font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundColor(NFColor.ink3).frame(width: 90, alignment: .leading)
                            NSPInput(text: Binding(get: { model.pages[i].name }, set: { model.pages[i].name = $0 }), placeholder: "タブの名前", enabled: p.canEdit, width: 260)
                            Spacer()
                            if p.canEdit { arrows(i, model.pages.count, up: { model.pages.swapAt(i, i - 1) }, down: { model.pages.swapAt(i, i + 1) }) }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 6)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                }
            }
            NSPCard(title: "カテゴリをどのタブに", en: "決めていないものは自動") {
                VStack(spacing: 0) {
                    ForEach(p.categories) { c in
                        HStack(spacing: 10) {
                            Text(c.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).frame(width: 220, alignment: .leading)
                            Menu {
                                Button("自動") { model.categoryPage[c.id] = nil }
                                ForEach(model.pages) { pg in Button(pg.name) { model.categoryPage[c.id] = pg.key } }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(model.pageName(model.categoryPage[c.id])).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                                }
                                .padding(.horizontal, 12).frame(height: 40)
                                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                            }
                            .disabled(!p.canEdit)
                            Spacer()
                        }
                        .padding(.horizontal, 18).frame(minHeight: 50)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if p.canEdit { HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "pages") { Task { await model.savePages() } } }.padding(18) }
                }
            }
        }
    }

    private func lunchTab(_ p: NMBPayload) -> some View {
        NSPCard(title: "ランチの時間", en: "「ランチの時間だけ」のカテゴリを出す時間帯") {
            HStack(spacing: 10) {
                NSPTimeMenu(value: model.lunchStart, options: NSPApi.timeOptions(toMin: 23 * 60 + 45), disabled: !p.canEdit) { if let v = $0 { model.lunchStart = v } }
                Text("〜").foregroundColor(NFColor.ink3)
                NSPTimeMenu(value: model.lunchEnd, options: NSPApi.timeOptions(toMin: 23 * 60 + 45), disabled: !p.canEdit) { if let v = $0 { model.lunchEnd = v } }
                if p.canEdit { NSPButton(text: "保存する", primary: true, busy: model.busy == "lunch", disabled: model.lunchStart == p.lunch.start && model.lunchEnd == p.lunch.end) { Task { await model.saveLunch() } } }
                Spacer()
            }
            .padding(18)
        }
    }

    private func takeoutTab(_ p: NMBPayload) -> some View {
        let q = NativeSoldOutModel.norm(model.takeoutQuery)
        let list = p.items.filter { q.isEmpty || NativeSoldOutModel.norm($0.name).contains(q) }
        return NSPCard(title: "テイクアウトのメニュー", en: "\(model.takeout.count) 品") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    NSPInput(text: $model.takeoutQuery, placeholder: "商品名で探す", width: 300)
                    Spacer()
                    if p.canEdit { NSPButton(text: "保存する", primary: true, busy: model.busy == "takeout", disabled: model.takeout == Set(p.takeoutItemIds)) { Task { await model.saveTakeout() } } }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                    ForEach(list) { m in
                        let on = model.takeout.contains(m.id)
                        Button { if on { model.takeout.remove(m.id) } else { model.takeout.insert(m.id) } } label: {
                            HStack(spacing: 8) {
                                Image(systemName: on ? "checkmark.square.fill" : "square").foregroundColor(on ? NFColor.iris : NFColor.ink3)
                                Text(m.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(on ? NFColor.irisSoft : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle()).disabled(!p.canEdit)
                    }
                }
            }
            .padding(18)
        }
    }
}

// MARK: - 決済・端末（Web の /app/settings/payments と同じ）

struct NPYBrand: Codable, Identifiable, Hashable { var key: String; var name: String; var id: String { key } }
struct NPYDiscount: Codable, Identifiable, Hashable { var key: String; var name: String; var kind: String; var value: Double; var id: String { key } }
struct NPYIdLabel: Codable, Identifiable, Hashable { let id: String; let label: String }
struct NPYStera: Codable, Identifiable, Hashable { let id: String; let name: String; let terminalNo: String?; let linkCode: String; let active: Bool; let online: Bool; let lastSeenLabel: String?; let appVersion: String? }

/// Preparatory LAN settings. Discovery and payment require the provider protocol.
struct NativeSteraLANSetup: View {
    let serverURL: String
    let storeID: String
    let terminal: NPYStera
    let canEdit: Bool
    @State private var terminalID = ""
    @State private var host = ""
    @State private var saved: SteraLANConfiguration?

    private var storageKey: String { "tenpo.stera.lan.\(serverURL).\(storeID).\(terminal.id)" }
    private var configuration: SteraLANConfiguration {
        SteraLANConfiguration(terminalID: terminalID.trimmingCharacters(in: .whitespacesAndNewlines),
                              host: host.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NTPopupLabel(title: "\(terminal.name)・LAN設定", subtitle: "LAN setup on this device")
            Text("iPadとsteraを同じルーターのWi-Fi／LANにつなぎ、連動アプリに表示される決済端末IDを登録してください。IPアドレスの手入力は通常不要です。")
                .font(.system(size: 13)).foregroundColor(NT.ink2)
            NTPopupLabel(title: "決済端末ID", subtitle: "Terminal ID")
            TextField("連動アプリに表示されるID", text: $terminalID)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .textFieldStyle(.roundedBorder).disabled(!canEdit)
            DisclosureGroup("詳細設定（IPアドレスを手動指定）") {
                VStack(alignment: .leading, spacing: 8) {
                    NTPopupLabel(title: "IPアドレス（任意）", subtitle: "Optional manual IP address")
                    TextField("空欄：端末IDで自動検索", text: $host)
                        .keyboardType(.numbersAndPunctuation).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder).disabled(!canEdit)
                    if !host.isEmpty && !SteraLANConfiguration.isLANIPv4(configuration.host) {
                        Text("店舗内のIPv4アドレスを入力してください（URL・ポート番号は不要です）。")
                            .font(.system(size: 12)).foregroundColor(NT.danger)
                    }
                    Text("通常は空欄のままにします。")
                        .font(.system(size: 12)).foregroundColor(NT.ink3)
                }
                .padding(.top, 8)
            }
            Button {
                guard canEdit, configuration.isValid,
                      let data = try? JSONEncoder().encode(configuration) else { return }
                UserDefaults.standard.set(data, forKey: storageKey)
                saved = configuration
            } label: {
                NTPopupLabel(title: configuration.usesAutomaticDiscovery ? "端末IDを保存" : "設定を保存", subtitle: "Save setup", alignment: .center)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .foregroundColor(.white)
                    .background(NT.purple, in: RoundedRectangle(cornerRadius: NTPopupStyle.controlRadius))
            }
            .buttonStyle(PressableStyle())
            .disabled(!canEdit || !configuration.isValid || configuration == saved)
            .opacity(!canEdit || !configuration.isValid || configuration == saved ? 0.4 : 1)
            Text(saved == configuration ? (configuration.usesAutomaticDiscovery ? "端末ID保存済み・自動検索は準備中" : "設定保存済み・LAN接続は未確認") : "LAN連携の準備")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2)
            Text("この端末と店舗にのみ保存します。LAN連携は準備中です。IDの自動検索・接続確認・決済はまだ利用できません。設定の保存だけでは接続完了になりません。")
                .font(.system(size: 12)).foregroundColor(NT.ink3)
        }
        .padding(16)
        .background(NT.card, in: RoundedRectangle(cornerRadius: NTPopupStyle.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: NTPopupStyle.cardRadius).stroke(NT.lilacLine))
        .task(id: storageKey) {
            saved = UserDefaults.standard.data(forKey: storageKey).flatMap { try? JSONDecoder().decode(SteraLANConfiguration.self, from: $0) }
            terminalID = saved?.terminalID ?? terminal.terminalNo ?? ""
            host = saved?.host ?? ""
        }
    }
}
struct NPYReader: Codable, Identifiable, Hashable { let id: String; let label: String; let deviceType: String?; let isSimulated: Bool; let status: String; let statusLabel: String; let lastSeenAt: String? }
struct NPYPayload: Codable {
    struct Stripe: Codable { let configured: Bool; let testMode: Bool }
    struct Presets: Codable { let discounts: [NPYDiscount]; let pointBrands: [NPYBrand]; let methodBrands: [String: [NPYBrand]] }
    struct SteraBox: Codable { let serverUrl: String; let terminals: [NPYStera] }
    struct Booking: Codable { let mode: String; let depositAmount: Int; let modes: [NPYIdLabel] }
    let store: NFNamed; let canEdit: Bool; let canEditStera: Bool; let stripe: Stripe
    let discountKinds: [NPYIdLabel]; let methods: [NPYIdLabel]; let presets: Presets
    let stera: SteraBox; let readers: [NPYReader]; let booking: Booking
}

@MainActor
final class NativePaymentsModel: NSPModel<NPYPayload> {
    enum Tab: String, CaseIterable { case presets, stera, readers, booking
        var label: String { switch self { case .presets: return "会計の選択肢"; case .stera: return "stera 連携"; case .readers: return "決済端末"; case .booking: return "予約の決済" } }
    }
    @Published var tab: Tab = .presets
    @Published var discounts: [NPYDiscount] = []
    @Published var brands: [NPYBrand] = []
    @Published var methods: [String: [NPYBrand]] = [:]
    @Published var steraName = ""
    @Published var steraNo = ""
    @Published var readerLabel = ""
    @Published var bookingMode = "onsite"
    @Published var depositText = "0"
    init() { super.init(part: "payments") }

    override func loaded(_ p: NPYPayload) {
        discounts = p.presets.discounts
        brands = p.presets.pointBrands
        methods = p.presets.methodBrands
        bookingMode = p.booking.mode
        depositText = String(p.booking.depositAmount)
    }
    var presetsDirty: Bool {
        guard let p = payload else { return false }
        return discounts != p.presets.discounts || brands != p.presets.pointBrands || methods != p.presets.methodBrands
    }
    /// lib/checkout-presets.ts の nextPresetKey と同じ
    static func nextKey(_ used: [String], prefix: String) -> String {
        for i in 1...99 where !used.contains("\(prefix)\(i)") { return "\(prefix)\(i)" }
        return prefix + String(Int(Date().timeIntervalSince1970), radix: 36)
    }
    func setDiscountKind(_ i: Int, _ kind: String) {
        guard i < discounts.count else { return }
        discounts[i].kind = kind
        if kind == "manual" { discounts[i].value = 0 } else if discounts[i].value <= 0 { discounts[i].value = kind == "percent" ? 10 : 500 }
    }
    func savePresets() async {
        // クレジット・QR・電子マネーは 1 つ以上（全部外すと既定の一覧に戻るため）。外部端末は 0 でもよい
        if let empty = ["credit", "qr", "emoney"].first(where: { (methods[$0] ?? []).isEmpty && methods[$0] != nil }) {
            toast = "\(["credit": "クレジット", "qr": "QR", "emoney": "電子マネー"][empty] ?? empty)は 1 つ以上選んでください"; return
        }
        let all = brands + methods.values.flatMap { $0 }
        if discounts.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) || all.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) {
            toast = "名前を入れてください"; return
        }
        let body: [String: Any] = [
            "type": "checkoutPresetsSave",
            "discounts": discounts.map { d -> [String: Any] in ["key": d.key, "name": d.name, "kind": d.kind, "value": d.kind == "manual" ? 0 : Int(d.value)] },
            "pointBrands": brands.map { ["key": $0.key, "name": $0.name] },
            "methodBrands": methods.mapValues { list in list.map { ["key": $0.key, "name": $0.name] } },
        ]
        _ = await run("presets", body, done: "会計の選択肢を保存しました（レジにすぐ反映）")
    }
    func addStera() async {
        if await run("steraAdd", ["type": "steraAdd", "name": steraName, "terminalNo": steraNo], done: "追加しました。リンクコードを端末のアプリに入れてください") { steraName = ""; steraNo = "" }
    }
    func addReader() async {
        if await run("readerAdd", ["type": "readerAdd", "label": readerLabel], done: "決済端末を登録しました") { readerLabel = "" }
    }
    func saveBooking() async {
        guard let n = Int(depositText.trimmingCharacters(in: .whitespaces)), n >= 0 else { toast = "予約金額の指定が正しくありません"; return }
        _ = await run("booking", ["type": "bookingPaymentSave", "mode": bookingMode, "depositAmount": bookingMode == "deposit" ? n : 0], done: "予約決済設定を保存しました")
    }
}

struct NativePaymentsScreen: View {
    @StateObject private var model = NativePaymentsModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativePaymentsView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativePaymentsView: View {
    @ObservedObject var model: NativePaymentsModel
    let onBack: () -> Void
    private enum Confirm: Identifiable {
        case steraRegen(NPYStera), steraDelete(NPYStera), readerDelete(NPYReader)
        var id: String { switch self { case .steraRegen(let t): return "r" + t.id; case .steraDelete(let t): return "d" + t.id; case .readerDelete(let r): return "x" + r.id } }
        var title: String { switch self { case .steraRegen: return "リンクコードを作り直す"; case .steraDelete: return "stera 端末を削除"; case .readerDelete: return "決済端末を削除" } }
        var message: String {
            switch self {
            case .steraRegen(let t): return "「\(t.name)」の今のコードは使えなくなります。端末のアプリにもう一度新しいコードを入れてください"
            case .steraDelete(let t): return "「\(t.name)」を一覧から消します。決済の記録は残ります"
            case .readerDelete(let r): return "「\(r.label)」を削除します。この操作は取り消せません"
            }
        }
        var ok: String { switch self { case .steraRegen: return "作り直す"; default: return "削除する" } }
        var done: String { switch self { case .steraRegen: return "作り直しました"; default: return "削除しました" } }
        var body: [String: Any] {
            switch self {
            case .steraRegen(let t): return ["type": "steraRegen", "id": t.id]
            case .steraDelete(let t): return ["type": "steraDelete", "id": t.id]
            case .readerDelete(let r): return ["type": "readerDelete", "id": r.id]
            }
        }
    }
    @State private var confirm: Confirm?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "決済・端末", en: "Payments", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                HStack(spacing: 6) {
                    ForEach(NativePaymentsModel.Tab.allCases, id: \.self) { t in
                        Button { model.tab = t } label: {
                            Text(t.label).font(.system(size: 15, weight: .bold)).foregroundColor(model.tab == t ? .white : NFColor.ink2)
                                .padding(.horizontal, 16).frame(height: 42)
                                .background(RoundedRectangle(cornerRadius: 11).fill(model.tab == t ? NFColor.navy : Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 11).stroke(NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                    }
                    Spacer()
                    statusChip(p)
                }
                switch model.tab {
                case .presets: presetsTab(p)
                case .stera: steraTab(p)
                case .readers: readersTab(p)
                case .booking: bookingTab(p)
                }
            }
        }
        .task { await model.refresh() }
        .alert(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { c in
            Button(c.ok, role: .destructive) { Task { _ = await model.run(c.id, c.body, done: c.done) }; confirm = nil }
            Button("やめる", role: .cancel) { confirm = nil }
        } message: { c in
            Text(c.message)
        }
    }

    /// 右上：Stripe と stera のつながり
    private func statusChip(_ p: NPYPayload) -> some View {
        HStack(spacing: 6) {
            chip("Stripe", p.stripe.configured ? (p.stripe.testMode ? "テストモード" : "本番") : "未接続", p.stripe.configured ? (p.stripe.testMode ? NFColor.saffron : NFColor.danger) : NFColor.ink3)
            chip("stera", p.stera.terminals.contains { $0.online } ? "接続済み" : (p.stera.terminals.isEmpty ? "手動運用" : "未接続"), p.stera.terminals.contains { $0.online } ? NFColor.success : NFColor.ink3)
        }
    }
    private func chip(_ name: String, _ status: String, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(name).font(.system(size: 13, weight: NT.strong)).foregroundColor(NFColor.ink)
            Text(status).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
        }
        .padding(.horizontal, 12).frame(height: 36)
        .background(Capsule().fill(Color.white)).overlay(Capsule().stroke(NFColor.line, lineWidth: 1))
    }

    private func chipButton(_ text: String, icon: String? = nil, danger: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon { Image(systemName: icon).font(.system(size: 12, weight: .bold)) }
                Text(text).font(.system(size: 13, weight: .bold))
            }
            .foregroundColor(danger ? NFColor.danger : NFColor.ink)
            .padding(.horizontal, 12).frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 9).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 9).stroke(danger ? NFColor.dangerSoft : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle()).disabled(disabled).opacity(disabled ? 0.5 : 1)
    }

    // 会計の「値引き」「ポイント」「支払方法の種類」
    private func presetsTab(_ p: NPYPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NSPCard(title: "値引きの選択肢", en: "会計画面のボタン") {
                VStack(spacing: 0) {
                    ForEach(Array(model.discounts.enumerated()), id: \.element.key) { i, d in
                        HStack(spacing: 10) {
                            NSPInput(text: Binding(get: { i < model.discounts.count ? model.discounts[i].name : "" }, set: { if i < model.discounts.count { model.discounts[i].name = $0 } }), placeholder: "例: 幹事様無料", enabled: p.canEdit, width: 260)
                            Menu {
                                ForEach(p.discountKinds) { k in Button(k.label) { model.setDiscountKind(i, k.id) } }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(p.discountKinds.first { $0.id == d.kind }?.label ?? d.kind).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                                }
                                .padding(.horizontal, 12).frame(height: 44)
                                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                            }
                            .disabled(!p.canEdit)
                            if d.kind != "manual" {
                                NSPInput(text: Binding(get: { d.value > 0 ? String(Int(d.value)) : "" }, set: { v in if i < model.discounts.count { model.discounts[i].value = Double(Int(v.filter(\.isNumber)) ?? 0) } }),
                                         placeholder: d.kind == "percent" ? "10" : "500", enabled: p.canEdit, width: 120, keyboard: .numberPad, trailing: d.kind == "percent" ? "%" : "円")
                            }
                            Spacer()
                            if p.canEdit { chipButton("消す", icon: "trash", danger: true) { model.discounts.remove(at: i) } }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 8)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if p.canEdit {
                        HStack {
                            NSPButton(text: "値引きを足す", icon: "plus", disabled: model.discounts.count >= 20) {
                                model.discounts.append(NPYDiscount(key: NativePaymentsModel.nextKey(model.discounts.map(\.key), prefix: "disc"), name: "", kind: "manual", value: 0))
                            }
                            Spacer()
                        }
                        .padding(18)
                    }
                }
            }
            NSPCard(title: "ポイントの選択肢", en: "ホットペッパー・ぐるなび・食べログ など") {
                brandList(Binding(get: { model.brands }, set: { model.brands = $0 }), prefix: "pt", placeholder: "例: ホットペッパー", canEdit: p.canEdit)
            }
            // 支払方法の種類は「使うもの」をタップで選ぶ（選んだものだけ会計画面に出る。2026-10-24 22:35 Ronnie）
            ForEach(p.methods) { m in
                NSPCard(title: m.id == "external" ? "外部端末（決済端末）" : "\(m.label)の種類",
                        en: m.id == "external" ? "stera はつなぐと自動で出ます。ほかの端末はここで選ぶ" : "使うものをタップ（選んだものだけ会計画面に出ます）") {
                    brandPicker(m.id, canEdit: p.canEdit)
                }
            }
            if p.canEdit {
                HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "presets", disabled: !model.presetsDirty) { Task { await model.savePresets() } } }
            }
        }
    }

    /// 一覧から「使うもの」を選ぶ（順番は一覧の順、自分で足したものは後ろ）
    private func brandPicker(_ methodId: String, canEdit: Bool) -> some View {
        let catalog = NPBrands.catalog(methodId)
        let keys = Set(catalog.map(\.id))
        let current = model.methods[methodId] ?? []
        let chosen = Set(current.map(\.key))
        let fallback = NPPayMethod(rawValue: methodId)?.color ?? NFColor.navy
        return VStack(alignment: .leading, spacing: 4) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                ForEach(catalog) { b in
                    Button {
                        var picked = chosen
                        if picked.contains(b.id) { picked.remove(b.id) } else { picked.insert(b.id) }
                        let custom = current.filter { !keys.contains($0.key) }
                        // 名前は店で変えたものを残す
                        let named = Dictionary(current.map { ($0.key, $0.name) }, uniquingKeysWith: { a, _ in a })
                        model.methods[methodId] = catalog.filter { picked.contains($0.id) }.map { NPYBrand(key: $0.id, name: named[$0.id] ?? $0.name) } + custom
                    } label: {
                        NPBrandTile(brand: NPBrand(id: b.id, name: current.first { $0.key == b.id }?.name ?? b.name), fallback: fallback, on: chosen.contains(b.id), height: 58)
                    }
                    .buttonStyle(PressableStyle()).disabled(!canEdit)
                }
            }
            .padding(.horizontal, 18).padding(.top, 16)
            Text("一覧に無いものは下で足せます").font(.system(size: 12.5)).foregroundColor(NFColor.ink3).padding(.horizontal, 18).padding(.top, 8)
            brandList(Binding(get: { (model.methods[methodId] ?? []).filter { !keys.contains($0.key) } },
                              set: { custom in model.methods[methodId] = (model.methods[methodId] ?? []).filter { keys.contains($0.key) } + custom }),
                      prefix: methodId, placeholder: methodId == "external" ? "例: 楽天ペイ端末" : "例: \(catalog.first?.name ?? "")", canEdit: canEdit)
        }
    }

    private func brandList(_ list: Binding<[NPYBrand]>, prefix: String, placeholder: String, canEdit: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            WrapLayout(spacing: 8) {
                ForEach(Array(list.wrappedValue.enumerated()), id: \.element.key) { i, _ in
                    HStack(spacing: 4) {
                        NSPInput(text: Binding(get: { i < list.wrappedValue.count ? list.wrappedValue[i].name : "" }, set: { if i < list.wrappedValue.count { list.wrappedValue[i].name = $0 } }), placeholder: placeholder, enabled: canEdit, width: 200)
                        if canEdit {
                            Button { var l = list.wrappedValue; l.remove(at: i); list.wrappedValue = l } label: {
                                Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 32, height: 44)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            if canEdit {
                NSPButton(text: "足す", icon: "plus", disabled: list.wrappedValue.count >= 20) {
                    var l = list.wrappedValue
                    l.append(NPYBrand(key: NativePaymentsModel.nextKey(l.map(\.key), prefix: prefix), name: ""))
                    list.wrappedValue = l
                }
            }
        }
        .padding(18)
    }

    // stera 連携
    private func steraTab(_ p: NPYPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NSPCard(title: "stera 連携", en: "端末登録・接続状況", note: p.canEditStera ? nil : "stera 端末の追加・変更は管理画面（パソコン・店長以上のアカウント）で行ってください") {
                VStack(spacing: 0) {
                    if p.stera.terminals.isEmpty {
                        Text("まだ stera 端末がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18)
                    }
                    ForEach(p.stera.terminals) { t in
                        HStack(alignment: .center, spacing: 14) {
                            Image(systemName: t.online ? "wifi" : "wifi.slash").font(.system(size: 18, weight: .semibold)).foregroundColor(t.online ? NFColor.success : NFColor.ink3).frame(width: 26)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(t.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                    if !t.active { Text("停止中").font(.system(size: 10.5, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.lilac)) }
                                }
                                Text([t.terminalNo.map { "端末番号 \($0)" }, t.online ? "つながっています" : (t.lastSeenLabel.map { "最後の接続 \($0)" } ?? "まだ接続がありません"), t.appVersion.map { "アプリ \($0)" }].compactMap { $0 }.joined(separator: "・"))
                                    .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                HStack(spacing: 6) {
                                    Image(systemName: "key").font(.system(size: 13, weight: .bold))
                                    Text(formatLinkCode(t.linkCode)).font(.system(size: 16, weight: NT.strong, design: .monospaced)).tracking(1.5)
                                }
                                .foregroundColor(NFColor.iris)
                                .padding(.horizontal, 10).padding(.vertical, 4).background(RoundedRectangle(cornerRadius: 8).fill(NFColor.lilac))
                            }
                            Spacer()
                            if p.canEditStera {
                                HStack(spacing: 6) {
                                    chipButton(t.active ? "停止" : "再開", disabled: model.busy != nil) { Task { _ = await model.run("stera" + t.id, ["type": "steraUpdate", "id": t.id, "active": !t.active], done: t.active ? "停止しました" : "再開しました") } }
                                    chipButton("コードを作り直す", icon: "arrow.clockwise", disabled: model.busy != nil) { confirm = .steraRegen(t) }
                                    chipButton("削除", icon: "trash", danger: true, disabled: model.busy != nil) { confirm = .steraDelete(t) }
                                }
                            }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 12)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if p.canEditStera {
                        HStack(spacing: 10) {
                            NSPInput(text: $model.steraName, placeholder: "例：レジ横 stera", width: 260)
                            NSPInput(text: $model.steraNo, placeholder: "端末番号（任意）", width: 200)
                            NSPButton(text: "追加する", icon: "plus", primary: true, busy: model.busy == "steraAdd", disabled: model.steraName.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.addStera() } }
                            Spacer()
                        }
                        .padding(18)
                    }
                }
            }
            ForEach(p.stera.terminals.filter { $0.active }) { terminal in
                NativeSteraLANSetup(serverURL: p.stera.serverUrl, storeID: p.store.id, terminal: terminal, canEdit: p.canEditStera)
            }
            // クラウド方式とLAN設定は別。登録だけで接続済みとはしない。
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "info.circle").foregroundColor(NFColor.ink3)
                Text("端末登録のみでは接続完了になりません。LAN設定とクラウドのリンクコードは別の接続方式です。POS連動仕様と接続設定の確認後、実機での接続・決済テストが必要です。").font(.system(size: 13)).foregroundColor(NFColor.ink3)
            }
        }
    }
    private func formatLinkCode(_ code: String) -> String {
        stride(from: 0, to: code.count, by: 4).map { i in String(code.dropFirst(i).prefix(4)) }.joined(separator: "-")
    }

    // Stripe の決済端末
    private func readersTab(_ p: NPYPayload) -> some View {
        NSPCard(title: "決済端末", en: "Stripe Terminal", note: p.stripe.testMode ? nil : (p.stripe.configured ? "本番キーのため、シミュレーション端末は登録できません" : "Stripe が未接続です（STRIPE_SECRET_KEY）")) {
            VStack(spacing: 0) {
                if p.readers.isEmpty { Text("決済端末がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                ForEach(p.readers) { r in
                    HStack(spacing: 12) {
                        Circle().fill(r.status == "online" ? NFColor.success : (r.status == "offline" ? NFColor.ink3 : NFColor.saffron)).frame(width: 10, height: 10)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(r.label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                if r.isSimulated { Text("シミュレーション").font(.system(size: 10.5, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(NFColor.lilac)) }
                                Text(r.statusLabel).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2)
                            }
                            Text("\(r.deviceType ?? "種別不明")・最終接続 \(r.lastSeenAt.map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "—")").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        Spacer()
                        if p.canEdit { chipButton("削除", icon: "trash", danger: true, disabled: model.busy != nil) { confirm = .readerDelete(r) } }
                    }
                    .padding(.horizontal, 18).frame(minHeight: 56)
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                if p.canEdit && p.stripe.testMode {
                    HStack(spacing: 10) {
                        NSPInput(text: $model.readerLabel, placeholder: "端末名（例: レジ1台目）", width: 300)
                        NSPButton(text: "シミュレーション端末を登録", icon: "plus", primary: true, busy: model.busy == "readerAdd", disabled: model.readerLabel.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.addReader() } }
                        Spacer()
                    }
                    .padding(18)
                }
            }
        }
    }

    // 予約の決済
    private func bookingTab(_ p: NPYPayload) -> some View {
        NSPCard(title: "予約の決済", en: "現地払い・全額決済・予約金") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    ForEach(p.booking.modes) { m in
                        let on = model.bookingMode == m.id
                        Button { model.bookingMode = m.id } label: {
                            Text(m.label).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                                .padding(.horizontal, 16).frame(height: 44)
                                .background(RoundedRectangle(cornerRadius: 10).fill(on ? NFColor.iris : Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle()).disabled(!p.canEdit)
                    }
                }
                if model.bookingMode == "deposit" {
                    NSPRow(label: "予約金", en: "1名あたり") {
                        NSPInput(text: $model.depositText, placeholder: "0", enabled: p.canEdit, width: 160, keyboard: .numberPad, trailing: "円")
                    }
                }
                if p.canEdit {
                    HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "booking", disabled: model.bookingMode == p.booking.mode && Int(model.depositText) == p.booking.depositAmount) { Task { await model.saveBooking() } } }
                }
            }
            .padding(18)
        }
    }
}

// MARK: - スタッフ管理（Web の /app/staff・components/staff/* と同じ）

struct NSFRole: Codable, Identifiable, Hashable { let id: String; let label: String; let assignable: Bool; let hq: Bool }
struct NSFRow: Codable, Identifiable, Hashable {
    let membershipId: String; let profileId: String; let displayName: String; let displayNameKana: String?
    let role: String; let roleLabel: String; let status: String; let storeIds: [String]; let storeNames: [String]; let hasPin: Bool; let canEdit: Bool
    var id: String { membershipId }
}
struct NSFPayload: Codable {
    let store: NFNamed; let organizationName: String; let selfProfileId: String
    let roles: [NSFRole]; let stores: [NFNamed]; let statuses: [NPYIdLabel]; let rows: [NSFRow]
}

@MainActor
final class NativeStaffModel: NSPModel<NSFPayload> {
    enum Panel: Equatable { case none, invite, edit(String) }
    @Published var panel: Panel = .none
    @Published var query = ""
    @Published var statusFilter: String? = nil
    // 招待
    @Published var invEmail = ""
    @Published var invName = ""
    @Published var invKana = ""
    @Published var invRole = "staff"
    @Published var invStores: Set<String> = []
    // 編集
    @Published var edRole = ""
    @Published var edStores: Set<String> = []
    @Published var edPin = ""
    /// 招待・再発行で一度だけ出るパスワード（画面を閉じたら消える。Web と同じ）
    @Published var secret: (title: String, who: String, value: String)? = nil
    init() { super.init(part: "staff") }

    var filtered: [NSFRow] {
        let q = NativeSoldOutModel.norm(query)
        return (payload?.rows ?? []).filter { r in
            (statusFilter == nil || r.status == statusFilter) && (q.isEmpty || NativeSoldOutModel.norm(r.displayName + (r.displayNameKana ?? "") + r.roleLabel + r.storeNames.joined()).contains(q))
        }
    }
    func isHq(_ role: String) -> Bool { payload?.roles.first { $0.id == role }?.hq ?? false }
    func startInvite() {
        invEmail = ""; invName = ""; invKana = ""; invRole = "staff"
        invStores = payload.map { Set([$0.store.id]) } ?? []
        panel = .invite
    }
    func startEdit(_ r: NSFRow) {
        edRole = r.role; edStores = Set(r.storeIds); edPin = ""
        panel = .edit(r.membershipId)
    }
    func row(_ id: String) -> NSFRow? { payload?.rows.first { $0.membershipId == id } }

    func invite() async {
        let body: [String: Any] = ["type": "staffInvite", "email": invEmail, "displayName": invName, "displayNameKana": invKana, "role": invRole, "storeIds": isHq(invRole) ? [] : Array(invStores)]
        guard busy == nil else { return }
        busy = "invite"; defer { busy = nil }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { toast = r.error ?? "招待できませんでした"; return }
        await refresh()
        panel = .none
        if let pw = r.json?["initialPassword"] as? String, !pw.isEmpty { secret = ("招待が完了しました", invName, pw) } else { toast = "招待しました" }
    }
    func saveRole(_ r: NSFRow) async {
        if await run("role", ["type": "staffRole", "membershipId": r.membershipId, "profileId": r.profileId, "role": edRole, "storeIds": isHq(edRole) ? [] : Array(edStores)], done: "ロールを変更しました") { panel = .none }
    }
    func saveStores(_ r: NSFRow) async {
        if await run("stores", ["type": "staffStores", "membershipId": r.membershipId, "profileId": r.profileId, "storeIds": Array(edStores)], done: "所属店舗を変更しました") { panel = .none }
    }
    func savePin(_ r: NSFRow) async {
        if await run("pin", ["type": "staffPin", "membershipId": r.membershipId, "profileId": r.profileId, "pin": edPin], done: "PINを設定しました") { edPin = "" }
    }
    func setStatus(_ r: NSFRow, _ status: String) async {
        _ = await run("status", ["type": "staffStatus", "membershipId": r.membershipId, "profileId": r.profileId, "status": status], done: status == "active" ? "再開しました" : "利用を停止しました")
    }
    func resetPassword(_ r: NSFRow) async {
        guard busy == nil else { return }
        busy = "pw"; defer { busy = nil }
        let res = await NSPApi.postJSON(["type": "staffPasswordReset", "membershipId": r.membershipId, "profileId": r.profileId])
        guard res.ok else { toast = res.error ?? "再発行できませんでした"; return }
        if let pw = res.json?["newPassword"] as? String, !pw.isEmpty { secret = ("パスワードを再発行しました", r.displayName, pw) } else { toast = "再発行しました" }
    }
}

struct NativeStaffScreen: View {
    @StateObject private var model = NativeStaffModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeStaffView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeStaffView: View {
    @ObservedObject var model: NativeStaffModel
    let onBack: () -> Void
    @State private var confirmSuspend: NSFRow?
    @State private var confirmReset: NSFRow?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "スタッフ管理", en: "Staff", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if let sec = model.secret { secretCard(sec) }
                HStack(spacing: 10) {
                    NSPInput(text: $model.query, placeholder: "名前・ロール・店舗で探す", width: 300)
                    HStack(spacing: 6) {
                        filterChip("すべて", on: model.statusFilter == nil) { model.statusFilter = nil }
                        ForEach(p.statuses) { st in filterChip(st.label, on: model.statusFilter == st.id) { model.statusFilter = st.id } }
                    }
                    Spacer()
                    if model.panel != .invite { NSPButton(text: "スタッフを招待", icon: "person.badge.plus", primary: true) { model.startInvite() } }
                }
                if model.panel == .invite { inviteCard(p) }
                NSPCard(title: "登録スタッフ", en: "\(p.organizationName)・\(model.filtered.count) 人") {
                    VStack(spacing: 0) {
                        if model.filtered.isEmpty { Text("該当するスタッフがいません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(model.filtered) { r in
                            rowView(p, r)
                            if model.panel == .edit(r.membershipId) { editCard(p, r) }
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
        .alert("利用を停止", isPresented: Binding(get: { confirmSuspend != nil }, set: { if !$0 { confirmSuspend = nil } }), presenting: confirmSuspend) { r in
            Button("停止する", role: .destructive) { Task { await model.setStatus(r, "suspended") }; confirmSuspend = nil }
            Button("やめる", role: .cancel) { confirmSuspend = nil }
        } message: { r in Text("「\(r.displayName)」はログインできなくなります。あとで再開できます") }
        .alert("パスワードを再発行", isPresented: Binding(get: { confirmReset != nil }, set: { if !$0 { confirmReset = nil } }), presenting: confirmReset) { r in
            Button("再発行する", role: .destructive) { Task { await model.resetPassword(r) }; confirmReset = nil }
            Button("やめる", role: .cancel) { confirmReset = nil }
        } message: { r in Text("「\(r.displayName)」の今のパスワードは使えなくなります。新しいパスワードは一度だけ表示されます") }
    }

    private func filterChip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 36)
                .background(Capsule().fill(on ? NFColor.navy : Color.white)).overlay(Capsule().stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func tag(_ t: String, _ c: Color, fill: Color = .clear) -> some View {
        Text(t).font(.system(size: 11, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(fill)).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }

    private func rowView(_ p: NSFPayload, _ r: NSFRow) -> some View {
        let open = model.panel == .edit(r.membershipId)
        return Button {
            if !r.canEdit { model.toast = r.profileId == p.selfProfileId ? "自分の設定はプロフィールから変えてください" : "自分より上のロールのスタッフは変えられません"; return }
            if open { model.panel = .none } else { model.startEdit(r) }
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(r.status == "active" ? NFColor.irisSoft : NFColor.lilacSoft).frame(width: 40, height: 40)
                    Text(String(r.displayName.prefix(1))).font(.system(size: 16, weight: NT.strong)).foregroundColor(r.status == "active" ? NFColor.iris : NFColor.ink3)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(r.displayName).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                        if let k = r.displayNameKana, !k.isEmpty { Text(k).font(.system(size: 11.5)).foregroundColor(NFColor.ink3) }
                        if r.profileId == p.selfProfileId { tag("自分", NFColor.ink3) }
                    }
                    Text(model.isHq(r.role) ? "全店舗" : (r.storeNames.isEmpty ? "店舗 未設定" : r.storeNames.joined(separator: "、"))).font(.system(size: 12)).foregroundColor(NFColor.ink3)
                }
                .frame(width: 280, alignment: .leading)
                Text(r.roleLabel).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 170, alignment: .leading)
                tag(p.statuses.first { $0.id == r.status }?.label ?? r.status, r.status == "active" ? NFColor.success : (r.status == "invited" ? NFColor.iris : NFColor.ink3), fill: r.status == "active" ? NFColor.successSoft : .clear)
                tag(r.hasPin ? "PIN 設定済" : "PIN 未設定", r.hasPin ? NFColor.success : NFColor.ink3)
                Spacer()
                if r.canEdit { Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3) }
            }
            .padding(.horizontal, 18).frame(minHeight: 60)
            .background(open ? NFColor.lilacSoft : Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
        }
        .buttonStyle(.plain)
    }

    private func storePicker(_ p: NSFPayload, _ sel: Binding<Set<String>>) -> some View {
        WrapLayout(spacing: 6) {
            ForEach(p.stores) { st in
                let on = sel.wrappedValue.contains(st.id)
                Button { if on { sel.wrappedValue.remove(st.id) } else { sel.wrappedValue.insert(st.id) } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: on ? "checkmark.square.fill" : "square").foregroundColor(on ? NFColor.iris : NFColor.ink3)
                        Text(st.name).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink)
                    }
                    .padding(.horizontal, 12).frame(height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(on ? NFColor.irisSoft : Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func rolePicker(_ p: NSFPayload, _ sel: Binding<String>) -> some View {
        Menu {
            ForEach(p.roles.filter(\.assignable)) { r in Button(r.label) { sel.wrappedValue = r.id } }
        } label: {
            HStack(spacing: 6) {
                Text(p.roles.first { $0.id == sel.wrappedValue }?.label ?? "ロールを選ぶ").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
            }
            .padding(.horizontal, 12).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private func inviteCard(_ p: NSFPayload) -> some View {
        NSPCard(title: "スタッフを招待", en: "初期パスワードは招待のあと一度だけ表示") {
            VStack(spacing: 0) {
                NSPRow(label: "メールアドレス", required: true) { NSPInput(text: $model.invEmail, placeholder: "staff@example.com", width: 360, keyboard: .emailAddress) }
                NSPRow(label: "氏名", required: true) { NSPInput(text: $model.invName, placeholder: "山田 太郎", width: 300) }
                NSPRow(label: "ふりがな") { NSPInput(text: $model.invKana, placeholder: "やまだ たろう", width: 300) }
                NSPRow(label: "ロール", required: true) { rolePicker(p, $model.invRole) }
                if !model.isHq(model.invRole) { NSPRow(label: "所属店舗", en: "1つ以上", required: true) { storePicker(p, $model.invStores) } }
                HStack(spacing: 10) {
                    NSPButton(text: "招待する", icon: "paperplane", primary: true, busy: model.busy == "invite", disabled: model.invEmail.trimmingCharacters(in: .whitespaces).isEmpty || model.invName.trimmingCharacters(in: .whitespaces).isEmpty || (!model.isHq(model.invRole) && model.invStores.isEmpty)) { Task { await model.invite() } }
                    NSPButton(text: "やめる") { model.panel = .none }
                    Spacer()
                }
                .padding(18)
            }
        }
    }

    private func editCard(_ p: NSFPayload, _ r: NSFRow) -> some View {
        VStack(spacing: 0) {
            NSPRow(label: "ロール") {
                HStack(spacing: 10) {
                    rolePicker(p, $model.edRole)
                    NSPButton(text: "変更", primary: true, busy: model.busy == "role", disabled: model.edRole == r.role || (!model.isHq(model.edRole) && model.edStores.isEmpty)) { Task { await model.saveRole(r) } }
                }
            }
            if !model.isHq(model.edRole) {
                NSPRow(label: "所属店舗", en: "1つ以上") {
                    HStack(alignment: .top, spacing: 10) {
                        storePicker(p, $model.edStores)
                        if model.edRole == r.role { NSPButton(text: "変更", primary: true, busy: model.busy == "stores", disabled: model.edStores == Set(r.storeIds) || model.edStores.isEmpty) { Task { await model.saveStores(r) } } }
                    }
                }
            }
            NSPRow(label: "PIN", en: "4〜6桁") {
                HStack(spacing: 10) {
                    NSPInput(text: $model.edPin, placeholder: "新しいPIN", width: 160, keyboard: .numberPad)
                    NSPButton(text: r.hasPin ? "PINを変える" : "PINを設定", primary: true, busy: model.busy == "pin", disabled: !(4...6).contains(model.edPin.count) || !model.edPin.allSatisfy(\.isNumber)) { Task { await model.savePin(r) } }
                }
            }
            HStack(spacing: 10) {
                if r.status == "suspended" {
                    NSPButton(text: "利用を再開", icon: "play.circle", busy: model.busy == "status") { Task { await model.setStatus(r, "active") } }
                } else {
                    NSPButton(text: "利用を停止", icon: "pause.circle", busy: model.busy == "status") { confirmSuspend = r }
                }
                NSPButton(text: "パスワードを再発行", icon: "key", busy: model.busy == "pw") { confirmReset = r }
                Spacer()
                NSPButton(text: "閉じる") { model.panel = .none }
            }
            .padding(18)
        }
        .background(NFColor.lilacSoft.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    /// 招待・再発行のパスワード（一度だけ）
    private func secretCard(_ sec: (title: String, who: String, value: String)) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "key.fill").font(.system(size: 20, weight: .bold)).foregroundColor(NFColor.iris)
            VStack(alignment: .leading, spacing: 4) {
                Text(sec.title).font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.navy)
                Text("\(sec.who) さんの初期パスワード。本人に安全な方法で伝えてください（この画面を閉じると見られません）").font(.system(size: 12.5)).foregroundColor(NFColor.ink2)
            }
            Spacer()
            Text(sec.value).font(.system(size: 20, weight: NT.strong, design: .monospaced)).foregroundColor(NFColor.ink).padding(.horizontal, 14).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            NSPButton(text: "コピー", icon: "doc.on.doc") { UIPasteboard.general.string = sec.value; model.toast = "パスワードをコピーしました" }
            NSPButton(text: "閉じる") { model.secret = nil }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 16).fill(NFColor.irisSoft))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.iris.opacity(0.4), lineWidth: 1))
    }
}

// MARK: - 予約台帳設定（Web の /app/settings/reservation-book と同じ：予約台帳設定・グルメ連携・SNS連携・Google連携）

struct NRBSite: Codable, Identifiable, Hashable { let key: String; let name: String; let en: String; let howTo: String; let adminUrl: String?; let status: String; let lastImportLabel: String?; let setupLabel: String?; let lastKindLabel: String?; var id: String { key } }
struct NRBImport: Codable, Identifiable, Hashable {
    let id: String; let siteName: String; let kind: String; let kindLabel: String; let status: String; let statusLabel: String; let summary: String
    let subject: String?; let fromAddress: String?; let externalId: String?; let receivedLabel: String; let reservationId: String?; let error: String?; let resolved: Bool; let bodyText: String?; let links: [String]
}
struct NRBChannel: Codable, Identifiable, Hashable { let key: String; let label: String; let en: String; let howTo: String; let adminUrl: String?; let link: String; let count30d: Int; let google: Bool; var id: String { key } }
struct NRBPayload: Codable {
    struct Book: Codable { let pushDevices: [String]; let reminderEnabled: Bool }
    struct Gourmet: Codable { let enabled: Bool; let address: String?; let inboundReady: Bool; let canRegenerate: Bool; let verifiedCount: Int; let sites: [NRBSite]; let imports: [NRBImport] }
    struct Sns: Codable { var instagram: String; var line: String; var facebook: String; var x: String }
    struct Links: Codable { let bookingUrl: String?; let channels: [NRBChannel]; let sns: Sns; let icalFeedUrl: String? }
    let store: NFNamed; let canEdit: Bool; let book: Book; let gourmet: Gourmet; let links: Links
}

@MainActor
final class NativeReservationBookModel: NSPModel<NRBPayload> {
    enum Tab: String, CaseIterable { case book, labels, gourmet, sns, google
        var label: String { switch self { case .book: return "予約台帳設定"; case .labels: return "タグ・キーワード"; case .gourmet: return "グルメ連携"; case .sns: return "SNS連携"; case .google: return "Google連携" } }
        var icon: String { switch self { case .book: return "calendar.badge.clock"; case .labels: return "tag"; case .gourmet: return "envelope"; case .sns: return "square.and.arrow.up"; case .google: return "globe" } }
    }
    @Published var tab: Tab = .book
    @Published var openSite: NRBSite?
    @Published var openImport: String?
    @Published var sns = NRBPayload.Sns(instagram: "", line: "", facebook: "", x: "")
    @Published var reminderResult: String?
    init() { super.init(part: "reservationBook") }
    override func loaded(_ p: NRBPayload) {
        sns = p.links.sns
        if let o = openSite { openSite = p.gourmet.sites.first { $0.key == o.key } }
    }
    var snsDirty: Bool { guard let p = payload else { return false }; return sns.instagram != p.links.sns.instagram || sns.line != p.links.sns.line || sns.facebook != p.links.sns.facebook || sns.x != p.links.sns.x }
    func saveSns() async { _ = await run("sns", ["type": "snsLinksSave", "instagram": sns.instagram, "line": sns.line, "facebook": sns.facebook, "x": sns.x], done: "SNS のアカウントを保存しました") }
    func prepareReminders() async {
        guard busy == nil else { return }
        busy = "reminder"; defer { busy = nil }
        let r = await NSPApi.postJSON(["type": "remindersPrepare"])
        guard r.ok else { toast = r.error ?? "準備に失敗しました"; return }
        reminderResult = r.json?["message"] as? String
        toast = "リマインダーを準備しました"
    }
}

struct NativeReservationBookScreen: View {
    @StateObject private var model = NativeReservationBookModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeReservationBookView(model: model, onBack: { state.goNativeSettings() }, onWeb: { path in state.leaveNativeFloor(to: path) }) }
}

struct NativeReservationBookView: View {
    @ObservedObject var model: NativeReservationBookModel
    let onBack: () -> Void
    let onWeb: (String) -> Void
    @State private var confirmRegen = false
    @State private var confirmIcal: String?   // "regen" | "revoke"

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "予約台帳設定", en: "Reservation book", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                HStack(spacing: 6) {
                    ForEach(NativeReservationBookModel.Tab.allCases, id: \.self) { t in
                        Button { model.tab = t } label: {
                            HStack(spacing: 8) {
                                Image(systemName: t.icon).font(.system(size: 15, weight: .bold)).foregroundColor(model.tab == t ? .white : NFColor.saffron)
                                Text(t.label).font(.system(size: 15, weight: .bold)).foregroundColor(model.tab == t ? .white : NFColor.ink2)
                            }
                            .padding(.horizontal, 16).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 11).fill(model.tab == t ? NFColor.navy : Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 11).stroke(NFColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                    }
                    Spacer()
                }
                switch model.tab {
                case .book: bookTab(p)
                // 予約のキーワード（10 個・15 文字）とお客様・予約のタグ（区分ごと）。2026-10-24 Ronnie「タグは店舗の設定で追加・編集」
                case .labels: NRWLabelsSettings()
                case .gourmet: gourmetTab(p)
                case .sns: snsTab(p)
                case .google: googleTab(p)
                }
            }
        }
        .task { await model.refresh() }
        .alert("取り込み用アドレスを作り直す", isPresented: $confirmRegen) {
            Button("作り直す", role: .destructive) { Task { _ = await model.run("regen", ["type": "gourmetMailRegenerate"], done: "アドレスを作り直しました。各サイトに登録し直してください") } }
            Button("やめる", role: .cancel) {}
        } message: { Text("古いアドレスに届いたメールは入らなくなります。各サイトの「設定済」の印も消えます") }
        .alert(confirmIcal == "revoke" ? "Google カレンダーへの配信を止める" : "購読URLを作り直す", isPresented: Binding(get: { confirmIcal != nil }, set: { if !$0 { confirmIcal = nil } }), presenting: confirmIcal) { kind in
            Button(kind == "revoke" ? "止める" : "作り直す", role: .destructive) {
                Task { _ = await model.run("ical", ["type": kind == "revoke" ? "icalRevoke" : "icalRegenerate"], done: kind == "revoke" ? "配信を止めました" : "購読URLを作り直しました") }
                confirmIcal = nil
            }
            Button("やめる", role: .cancel) { confirmIcal = nil }
        } message: { kind in
            Text(kind == "revoke" ? "URLが無効になります" : "Google カレンダーに登録した古いURLは止まるので、登録し直しが必要です")
        }
    }

    private func tag(_ t: String, _ c: Color, fill: Color = .clear) -> some View {
        Text(t).font(.system(size: 11, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(fill)).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }
    private func copyBox(_ text: String, label: String) -> some View {
        HStack(spacing: 8) {
            Text(text).font(.system(size: 12.5, design: .monospaced)).foregroundColor(NFColor.navy).lineLimit(1).truncationMode(.middle)
                .padding(.horizontal, 10).frame(height: 40).frame(maxWidth: 520, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilac))
            NSPButton(text: "コピー", icon: "doc.on.doc") { UIPasteboard.general.string = text; model.toast = "\(label)をコピーしました" }
        }
    }
    private func qrView(_ text: String) -> some View {
        Group {
            if let img = NativeReservationBookView.qrImage(text) {
                Image(uiImage: img).interpolation(.none).resizable().frame(width: 96, height: 96)
                    .padding(6).background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
        }
    }
    private static func qrImage(_ s: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)), let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    // 予約台帳設定：通知を受け取る端末・リマインダー
    private func bookTab(_ p: NRBPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NSPCard(title: "通知を受け取る端末", en: "Push") {
                HStack(spacing: 10) {
                    Image(systemName: "bell.badge").font(.system(size: 18, weight: .semibold)).foregroundColor(NFColor.iris)
                    Text(p.book.pushDevices.isEmpty ? "まだありません。パソコン・iPad でログインすると自動でオンになります（通知の許可が出たら「許可」）" : "\(p.book.pushDevices.count)台：\(p.book.pushDevices.joined(separator: "・"))")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink)
                    Spacer()
                }
                .padding(18)
            }
            if p.book.reminderEnabled {
                NSPCard(title: "予約リマインダーの準備", en: "Reminder", note: "設定した「送信タイミング」に入る予約を送信キューへ積みます（1予約1回）") {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            NSPButton(text: "リマインダーを準備する", icon: "bell.and.waves.left.and.right", primary: true, busy: model.busy == "reminder") { Task { await model.prepareReminders() } }
                            Spacer()
                        }
                        if let r = model.reminderResult { Text(r).font(.system(size: 13)).foregroundColor(NFColor.ink2).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft)) }
                        Text("※ 外部メール/SMSプロバイダは未接続です。実送信は接続後に有効になります").font(.system(size: 12)).foregroundColor(NFColor.saffron)
                    }
                    .padding(18)
                }
            } else {
                HStack(spacing: 6) {
                    Text("お客様へのリマインダー（前日メール等）は").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                    Button("予約受付ルール") { onWeb("/app/settings/booking") }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.iris)
                    Text("でオンにできます").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                }
            }
        }
    }

    // グルメ連携
    private func gourmetTab(_ p: NRBPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NSPCard(title: "グルメサイトメール取り込み", en: p.gourmet.enabled ? "利用中（\(p.gourmet.verifiedCount) サイト設定済）" : "停止中") {
                VStack(alignment: .leading, spacing: 12) {
                    if !p.gourmet.inboundReady {
                        Text("サーバーのメール受信（INBOUND_MAIL_SECRET）がまだ設定されていません。運営に連絡してください").font(.system(size: 12.5)).foregroundColor(NFColor.saffron)
                    }
                    HStack(spacing: 12) {
                        NSPToggle(on: p.gourmet.enabled, disabled: !p.canEdit || model.busy != nil) { Task { _ = await model.run("enabled", ["type": "gourmetMailEnabled", "enabled": !p.gourmet.enabled], done: p.gourmet.enabled ? "取り込みを止めました" : "取り込みを始めました") } }
                        Text(p.gourmet.enabled ? "食べログ・ホットペッパー等の予約メールを自動で台帳へ" : "オンにすると取り込み専用アドレスが出ます").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink)
                        Spacer()
                    }
                    if p.gourmet.enabled, let addr = p.gourmet.address {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("取り込み専用メールアドレス").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            HStack(spacing: 8) {
                                copyBox(addr, label: "アドレス")
                                if p.gourmet.canRegenerate { NSPButton(text: "作り直す", icon: "arrow.clockwise", busy: model.busy == "regen") { confirmRegen = true } }
                            }
                            Text("各グルメサイトの管理画面で、予約通知メールの送り先にこのアドレスを登録します").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                    }
                }
                .padding(18)
                if p.gourmet.enabled {
                    Rectangle().fill(NFColor.line).frame(height: 1)
                    VStack(spacing: 0) {
                        ForEach(p.gourmet.sites) { site in
                            Button { model.openSite = model.openSite?.key == site.key ? nil : site } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(site.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                        Text(site.en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
                                    }
                                    .frame(width: 220, alignment: .leading)
                                    if site.status == "verified" { tag("設定済", NFColor.success, fill: NFColor.successSoft) }
                                    else if site.status == "registered" { tag("メール待ち", NFColor.saffron) }
                                    else { tag("未設定", NFColor.ink3) }
                                    Text("最新メール取り込み：\(site.lastImportLabel ?? "----/--/-- --:--")\(site.lastKindLabel.map { "（\($0)）" } ?? "")").font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                                    Spacer()
                                    Image(systemName: model.openSite?.key == site.key ? "chevron.up" : "chevron.down").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3)
                                }
                                .padding(.horizontal, 18).frame(minHeight: 54)
                                .background(model.openSite?.key == site.key ? NFColor.lilacSoft : Color.white)
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                            .buttonStyle(.plain)
                            if model.openSite?.key == site.key { siteSetup(p, site) }
                        }
                    }
                }
            }
            NSPCard(title: "取り込んだメール", en: "最近 50 件") {
                VStack(spacing: 0) {
                    if p.gourmet.imports.isEmpty { Text("まだ取り込んだメールはありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                    ForEach(p.gourmet.imports) { r in
                        let review = r.status == "needs_review" && !r.resolved
                        let open = model.openImport == r.id
                        Button { model.openImport = open ? nil : r.id } label: {
                            HStack(spacing: 10) {
                                Text(r.receivedLabel).font(.system(size: 12)).foregroundColor(NFColor.ink3).monospacedDigit().frame(width: 84, alignment: .leading)
                                Text(r.siteName).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink).frame(width: 110, alignment: .leading).lineLimit(1)
                                Text(r.kindLabel).font(.system(size: 12.5)).foregroundColor(NFColor.ink2).frame(width: 80, alignment: .leading)
                                Text(r.summary).font(.system(size: 13)).foregroundColor(NFColor.ink2).lineLimit(1)
                                Spacer()
                                tag(r.resolved ? "対応済み" : r.statusLabel, review ? NFColor.danger : (r.resolved ? NFColor.ink3 : (r.status == "imported" || r.status == "updated" ? NFColor.success : NFColor.ink2)))
                                if r.kind == "verify" && !r.links.isEmpty && !r.resolved { tag("要クリック", NFColor.saffron) }
                                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 18).frame(minHeight: 46)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                        .buttonStyle(.plain)
                        if open { importDetail(p, r) }
                    }
                }
            }
        }
    }

    private func siteSetup(_ p: NRBPayload, _ site: NRBSite) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let addr = p.gourmet.address {
                Text("1. 取り込み専用アドレスをコピー").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
                copyBox(addr, label: "アドレス")
            }
            Text("2. \(site.name) の店舗管理画面で、予約通知メールの送り先に登録").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
            Text(site.howTo).font(.system(size: 13)).foregroundColor(NFColor.ink2)
            if let u = site.adminUrl, let url = URL(string: u) {
                Link(destination: url) {
                    HStack(spacing: 6) { Image(systemName: "arrow.up.right.square"); Text("\(site.name) の管理画面を開く") }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.iris)
                }
            }
            Text("3. 登録できたら印を付ける（最初のメールが届いた時点で「設定済」に変わります）").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
            HStack(spacing: 10) {
                if site.status == "off" {
                    NSPButton(text: "登録した", icon: "checkmark", primary: true, busy: model.busy == "site" + site.key, disabled: !p.canEdit) { Task { _ = await model.run("site" + site.key, ["type": "gourmetSiteRegistered", "site": site.key, "registered": true], done: "印を付けました") } }
                } else {
                    NSPButton(text: "印を外す", busy: model.busy == "site" + site.key, disabled: !p.canEdit) { Task { _ = await model.run("site" + site.key, ["type": "gourmetSiteRegistered", "site": site.key, "registered": false], done: "印を外しました") } }
                }
                if let s = site.setupLabel { Text("設定：\(s)").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                Spacer()
                NSPButton(text: "閉じる") { model.openSite = nil }
            }
        }
        .padding(18)
        .background(NFColor.lilacSoft.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func importDetail(_ p: NRBPayload, _ r: NRBImport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("件名：\(r.subject ?? "—")").font(.system(size: 13)).foregroundColor(NFColor.ink2)
            Text("差出人：\(r.fromAddress ?? "—")").font(.system(size: 13)).foregroundColor(NFColor.ink2)
            if let e = r.externalId { Text("予約番号：\(e)").font(.system(size: 13)).foregroundColor(NFColor.ink2) }
            if let err = r.error { Text("理由：\(err)").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
            if let body = r.bodyText, !body.isEmpty {
                ScrollView { Text(body).font(.system(size: 12)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading).padding(10) }
                    .frame(maxHeight: 220).background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            }
            if r.kind == "verify" && !r.links.isEmpty {
                Text("認証メールのリンク（開くとサイト側の登録が完了します）").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2)
                WrapLayout(spacing: 8) {
                    ForEach(r.links, id: \.self) { u in
                        if let url = URL(string: u) {
                            Link(destination: url) { Text("認証リンクを開く").font(.system(size: 13, weight: .bold)).foregroundColor(.white).padding(.horizontal, 14).frame(height: 40).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.iris)) }
                        }
                    }
                }
            }
            HStack(spacing: 10) {
                if let rid = r.reservationId { NSPButton(text: "台帳で開く", icon: "calendar") { onWeb("/app/reservations?open=\(rid)") } }
                if r.status == "needs_review" && !r.resolved && p.canEdit { NSPButton(text: "対応済みにする", icon: "checkmark", primary: true, busy: model.busy == "imp" + r.id) { Task { _ = await model.run("imp" + r.id, ["type": "gourmetImportResolve", "importId": r.id], done: "対応済みにしました") } } }
                Spacer()
            }
        }
        .padding(18)
        .background(NFColor.lilacSoft.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func channelRow(_ c: NRBChannel) -> some View {
        HStack(alignment: .top, spacing: 14) {
            qrView(c.link)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(c.label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                    Text(c.en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
                    Spacer()
                    Text("過去30日の予約 \(c.count30d) 件").font(.system(size: 12)).foregroundColor(NFColor.ink3).monospacedDigit()
                }
                Text(c.howTo).font(.system(size: 12.5)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    copyBox(c.link, label: "\(c.label) の予約リンク")
                    if let u = c.adminUrl, let url = URL(string: u) {
                        Link(destination: url) { HStack(spacing: 5) { Image(systemName: "arrow.up.right.square"); Text("開く") }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.iris).padding(.horizontal, 12).frame(height: 40).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1)) }
                    }
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func missingSiteUrl() -> some View {
        Text("公開予約URLを出すには、環境変数 NEXT_PUBLIC_SITE_URL と店舗のスラッグが必要です").font(.system(size: 13)).foregroundColor(NFColor.ink2).padding(14)
            .frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
    }

    // SNS連携
    private func snsTab(_ p: NRBPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if p.links.bookingUrl == nil { missingSiteUrl() } else {
                NSPCard(title: "SNS に貼る予約リンク", en: "リンクから入った予約は経路にそのSNSが付く") {
                    VStack(spacing: 0) { ForEach(p.links.channels.filter { !$0.google }) { c in channelRow(c) } }
                }
            }
            NSPCard(title: "お店の SNS アカウント", en: "控え") {
                VStack(spacing: 0) {
                    NSPRow(label: "Instagram") { NSPInput(text: $model.sns.instagram, placeholder: "https://www.instagram.com/…", enabled: p.canEdit, keyboard: .URL) }
                    NSPRow(label: "LINE公式") { NSPInput(text: $model.sns.line, placeholder: "https://lin.ee/…", enabled: p.canEdit, keyboard: .URL) }
                    NSPRow(label: "Facebook") { NSPInput(text: $model.sns.facebook, placeholder: "https://www.facebook.com/…", enabled: p.canEdit, keyboard: .URL) }
                    NSPRow(label: "X（Twitter）") { NSPInput(text: $model.sns.x, placeholder: "https://x.com/…", enabled: p.canEdit, keyboard: .URL) }
                    if p.canEdit { HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "sns", disabled: !model.snsDirty) { Task { await model.saveSns() } } }.padding(18) }
                }
            }
        }
    }

    // Google連携
    private func googleTab(_ p: NRBPayload) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if p.links.bookingUrl == nil { missingSiteUrl() } else {
                NSPCard(title: "Google の「予約」ボタン", en: "Google ビジネスプロフィール") {
                    VStack(spacing: 0) { ForEach(p.links.channels.filter(\.google)) { c in channelRow(c) } }
                }
            }
            NSPCard(title: "Google カレンダーに予約を出す", en: "iCal 購読", note: "Google カレンダー →「他のカレンダー」→「URL で追加」に購読URLを入れると、台帳の予約が自動で出ます（15分ごとに更新）") {
                VStack(alignment: .leading, spacing: 10) {
                    if let feed = p.links.icalFeedUrl {
                        HStack(spacing: 8) {
                            copyBox(feed, label: "購読URL")
                            if p.canEdit {
                                NSPButton(text: "作り直す", icon: "arrow.clockwise", busy: model.busy == "ical") { confirmIcal = "regen" }
                                NSPButton(text: "配信を止める", icon: "xmark.circle", busy: model.busy == "ical") { confirmIcal = "revoke" }
                            }
                        }
                        Text("※ このURLを知っている人は予約が見られます。外に出さないでください。漏れたら「作り直す」で無効にできます").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    } else {
                        HStack {
                            NSPButton(text: "購読URLを作る", icon: "calendar.badge.plus", primary: true, busy: model.busy == "ical", disabled: !p.canEdit) { Task { _ = await model.run("ical", ["type": "icalRegenerate"], done: "購読URLを作りました") } }
                            Spacer()
                        }
                    }
                }
                .padding(18)
            }
        }
    }
}

// MARK: - 連携（Web の /app/settings/integrations と同じ。見るだけ）

struct NIGRow: Codable, Identifiable, Hashable { let key: String; let name: String; let status: String; let tone: String; let note: String; let href: String?; let hrefLabel: String?; var id: String { key } }
struct NIGMigration: Codable, Identifiable, Hashable { let key: String; let name: String; let note: String; var id: String { key } }
struct NIGPayload: Codable { let store: NFNamed; let rows: [NIGRow]; let migration: [NIGMigration] }

@MainActor final class NativeIntegrationsModel: NSPModel<NIGPayload> { init() { super.init(part: "integrations") } }

struct NativeIntegrationsScreen: View {
    @StateObject private var model = NativeIntegrationsModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "連携", en: "Integrations", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                NSPCard(title: "連携の状態", en: "虚偽の「接続済み」表示は行いません") {
                    VStack(spacing: 0) {
                        ForEach(p.rows) { r in
                            HStack(alignment: .center, spacing: 14) {
                                Circle().fill(toneColor(r.tone)).frame(width: 10, height: 10)
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 8) {
                                        Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                                        Text(r.status).font(.system(size: 11, weight: NT.strong)).foregroundColor(toneColor(r.tone)).padding(.horizontal, 7).padding(.vertical, 2).overlay(Capsule().stroke(toneColor(r.tone).opacity(0.5), lineWidth: 1))
                                    }
                                    Text(r.note).font(.system(size: 12.5)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer()
                                if let href = r.href, let label = r.hrefLabel {
                                    NSPButton(text: label, icon: "arrow.right") {
                                        if let key = NativeSettingsPageKey.from(path: href) { state.openSettingsPage(key, webPath: href) }
                                        else if href == "/app/pos/settings" { state.goNativeSettings() }
                                        else { state.leaveNativeFloor(to: href) }
                                    }
                                }
                            }
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
                NSPCard(title: "会計・勤怠ソフトからの移行・互換", en: "オプション", note: "TENPO ONE 単独で会計・勤怠・給与が完結します。既に使っている店舗が乗り換える・併用するときのデータ移行の現状だけを示します") {
                    VStack(spacing: 0) {
                        ForEach(p.migration) { m in
                            HStack(spacing: 14) {
                                Text(m.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).frame(width: 240, alignment: .leading)
                                Text(m.note).font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
                                Spacer()
                            }
                            .padding(.horizontal, 18).frame(minHeight: 48)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                        Text("CSV の出力：仕訳は「会計」、勤怠は「勤怠」、給与明細は「給与」、請求書・経費は「請求書」の各画面から").font(.system(size: 12.5)).foregroundColor(NFColor.ink2).padding(18)
                    }
                }
            }
        }
        .task { await model.refresh() }
    }
    private func toneColor(_ t: String) -> Color {
        switch t { case "success": return NFColor.success; case "warning": return NFColor.saffron; case "danger": return NFColor.danger; case "primary": return NFColor.iris; default: return NFColor.ink3 }
    }
}

// MARK: - 監査ログ（Web の /app/settings/audit と同じ。新しい順・最大200件、絞り込みはこの iPad で）

struct NAULog: Codable, Identifiable, Hashable {
    let id: String; let createdAt: String; let createdLabel: String; let actorName: String; let actorRole: String?
    let action: String; let targetTable: String?; let targetId: String?; let before: String?; let after: String?; let note: String?
    var hasDetail: Bool { before != nil || after != nil || !(note ?? "").isEmpty }
}
struct NAUPayload: Codable { let store: NFNamed; let rows: [NAULog] }

@MainActor
final class NativeAuditModel: NSPModel<NAUPayload> {
    @Published var query = ""
    @Published var table = ""
    @Published var open: String?
    init() { super.init(part: "audit") }
    var filtered: [NAULog] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let t = table.trimmingCharacters(in: .whitespaces).lowercased()
        return (payload?.rows ?? []).filter { r in
            (q.isEmpty || r.action.lowercased().contains(q) || r.actorName.lowercased().contains(q) || (r.note ?? "").lowercased().contains(q)) && (t.isEmpty || (r.targetTable ?? "").lowercased().contains(t))
        }
    }
}

struct NativeAuditScreen: View {
    @StateObject private var model = NativeAuditModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "監査ログ", en: "Audit log", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if model.payload != nil {
                HStack(spacing: 10) {
                    NSPInput(text: $model.query, placeholder: "アクション・操作者で探す（staff.role_change 等）", width: 360)
                    NSPInput(text: $model.table, placeholder: "対象テーブル（memberships 等）", width: 260)
                    Spacer()
                    NSPButton(text: "読み直す", icon: "arrow.clockwise") { Task { await model.refresh() } }
                }
                NSPCard(title: "操作履歴", en: "\(model.filtered.count) 件（新しい順・最大200件）") {
                    VStack(spacing: 0) {
                        if model.filtered.isEmpty { Text("該当する操作履歴がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(model.filtered) { r in
                            let open = model.open == r.id
                            Button { if r.hasDetail { model.open = open ? nil : r.id } } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(r.hasDetail ? NFColor.ink3 : .clear).frame(width: 14)
                                    Text(r.createdLabel).font(.system(size: 12.5)).foregroundColor(NFColor.ink2).monospacedDigit().frame(width: 150, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(r.actorName).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                                        if let role = r.actorRole { Text(role).font(.system(size: 11)).foregroundColor(NFColor.ink3) }
                                    }
                                    .frame(width: 150, alignment: .leading)
                                    Text(r.action).font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundColor(NFColor.iris).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NFColor.irisSoft)).lineLimit(1)
                                    Text(r.targetTable ?? "—").font(.system(size: 12.5)).foregroundColor(NFColor.ink2).frame(width: 140, alignment: .leading).lineLimit(1)
                                    Text(r.targetId ?? "—").font(.system(size: 11, design: .monospaced)).foregroundColor(NFColor.ink3).lineLimit(1).truncationMode(.middle)
                                    Spacer()
                                }
                                .padding(.horizontal, 18).frame(minHeight: 46)
                                .background(open ? NFColor.lilacSoft : Color.white)
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                            .buttonStyle(.plain)
                            if open {
                                VStack(alignment: .leading, spacing: 8) {
                                    if let n = r.note, !n.isEmpty { Text("メモ: \(n)").font(.system(size: 13)).foregroundColor(NFColor.ink2) }
                                    HStack(alignment: .top, spacing: 12) {
                                        jsonBox("変更前", r.before)
                                        jsonBox("変更後", r.after)
                                    }
                                }
                                .padding(18)
                                .background(NFColor.lilacSoft.opacity(0.5))
                                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            }
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }
    private func jsonBox(_ title: String, _ body: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            ScrollView { Text(body ?? "—").font(.system(size: 11.5, design: .monospaced)).foregroundColor(NFColor.ink2).frame(maxWidth: .infinity, alignment: .leading).padding(10) }
                .frame(maxHeight: 220).background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 企業情報（Web の /app/settings/company と同じ）

struct NCOFields: Codable, Hashable { var name: String; var nameKana: String; var postalCode: String; var address: String; var phone: String; var billingName: String; var billingEmail: String; var billingNote: String }
struct NCOPayload: Codable { let store: NFNamed; let canEdit: Bool; let company: NCOFields; let includeTakeoutGuests: Bool }

@MainActor
final class NativeCompanyModel: NSPModel<NCOPayload> {
    @Published var f = NCOFields(name: "", nameKana: "", postalCode: "", address: "", phone: "", billingName: "", billingEmail: "", billingNote: "")
    init() { super.init(part: "company") }
    override func loaded(_ p: NCOPayload) { f = p.company }
    var dirty: Bool { payload.map { $0.company != f } ?? false }
    func save() async {
        let body: [String: Any] = ["type": "companySave", "company": ["name": f.name, "nameKana": f.nameKana, "postalCode": f.postalCode, "address": f.address, "phone": f.phone, "billingName": f.billingName, "billingEmail": f.billingEmail, "billingNote": f.billingNote]]
        _ = await run("save", body, done: "企業情報を保存しました")
    }
    func setKpi(_ on: Bool) async { _ = await run("kpi", ["type": "kpiSave", "includeTakeoutGuests": on], done: "KPI設定を保存しました") }
}

struct NativeCompanyScreen: View {
    @StateObject private var model = NativeCompanyModel()
    @EnvironmentObject var state: AppState
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "企業情報", en: "Company", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                NSPCard(title: "基本情報", en: "Company") {
                    VStack(spacing: 0) {
                        NSPRow(label: "会社名", required: true) { NSPInput(text: $model.f.name, placeholder: "株式会社○○", enabled: p.canEdit, width: 420) }
                        NSPRow(label: "会社名（カナ）") { NSPInput(text: $model.f.nameKana, placeholder: "カブシキガイシャ○○", enabled: p.canEdit, width: 420) }
                        NSPRow(label: "郵便番号") { NSPInput(text: $model.f.postalCode, placeholder: "123-4567", enabled: p.canEdit, width: 180, keyboard: .numbersAndPunctuation) }
                        NSPRow(label: "住所") { NSPInput(text: $model.f.address, placeholder: "東京都…", enabled: p.canEdit) }
                        NSPRow(label: "電話番号") { NSPInput(text: $model.f.phone, placeholder: "03-1234-5678", enabled: p.canEdit, width: 240, keyboard: .phonePad) }
                    }
                }
                NSPCard(title: "請求情報", en: "Billing") {
                    VStack(spacing: 0) {
                        NSPRow(label: "請求先名") { NSPInput(text: $model.f.billingName, placeholder: "経理部 御中 など", enabled: p.canEdit, width: 420) }
                        NSPRow(label: "請求先メール") { NSPInput(text: $model.f.billingEmail, placeholder: "billing@example.com", enabled: p.canEdit, width: 420, keyboard: .emailAddress) }
                        NSPRow(label: "備考") { NSPInput(text: $model.f.billingNote, placeholder: "請求書送付先や支払条件など", enabled: p.canEdit) }
                        if p.canEdit { HStack { Spacer(); NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: !model.dirty || model.f.name.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.save() } } }.padding(18) }
                    }
                }
                NSPCard(title: "KPI設定", en: "客数の数え方") {
                    HStack(spacing: 14) {
                        NSPToggle(on: p.includeTakeoutGuests, disabled: !p.canEdit || model.busy != nil) { Task { await model.setKpi(!p.includeTakeoutGuests) } }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("テイクアウト・デリバリーの客数を客数KPIに含める").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                            Text("オフにすると、ダッシュボード・レポート・予算・日報の客数・客単価は店内飲食だけで算出").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        Spacer()
                    }
                    .padding(18)
                }
                Text("ロゴのアップロードは今後のアップデートで対応予定").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            }
        }
        .task { await model.refresh() }
    }
}

// MARK: - テーブル・フロア（Web の /app/settings/tables と同じ。変更は管理画面だけ＝レジ端末では見るだけ）

struct NTBFloor: Codable, Identifiable, Hashable { let id: String; let name: String; let tableCount: Int }
struct NTBTable: Codable, Identifiable, Hashable {
    let id: String; let name: String; let floorId: String?; let floorName: String?; let capacityMin: Int; let capacityMax: Int
    let isPrivateRoom: Bool; let isCounter: Bool; let smokingAllowed: Bool; let sortOrder: Int; let available: Bool
}
struct NTBPayload: Codable { let store: NFNamed; let canEdit: Bool; let adminOnlyNote: String; let defaultFloorId: String?; let floors: [NTBFloor]; let tables: [NTBTable] }

@MainActor
final class NativeTablesModel: NSPModel<NTBPayload> {
    enum Panel: Equatable { case none, addTable, editTable(String), renameFloor(String) }
    @Published var panel: Panel = .none
    @Published var floorFilter: String? = nil
    @Published var newFloor = ""
    @Published var floorName = ""
    // テーブルの入力
    @Published var tName = ""
    @Published var tFloor: String? = nil
    @Published var tMin = "2"
    @Published var tMax = "4"
    @Published var tPrivate = false
    @Published var tCounter = false
    @Published var tSmoking = false
    @Published var tSort = "0"
    init() { super.init(part: "tables") }

    var tables: [NTBTable] { (payload?.tables ?? []).filter { floorFilter == nil || $0.floorId == floorFilter } }
    func startAdd() {
        tName = ""; tFloor = floorFilter ?? payload?.floors.first?.id; tMin = "2"; tMax = "4"; tPrivate = false; tCounter = false; tSmoking = false
        tSort = String(((payload?.tables.map(\.sortOrder).max()) ?? 0) + 1)
        panel = .addTable
    }
    func startEdit(_ t: NTBTable) {
        tName = t.name; tFloor = t.floorId; tMin = String(t.capacityMin); tMax = String(t.capacityMax); tPrivate = t.isPrivateRoom; tCounter = t.isCounter; tSmoking = t.smokingAllowed; tSort = String(t.sortOrder)
        panel = .editTable(t.id)
    }
    func saveTable(id: String?) async {
        guard let mn = Int(tMin), let mx = Int(tMax), mn >= 1, mx >= mn else { toast = "席数の指定が正しくありません"; return }
        var table: [String: Any] = ["name": tName, "capacityMin": mn, "capacityMax": mx, "isPrivateRoom": tPrivate, "isCounter": tCounter, "smokingAllowed": tSmoking, "sortOrder": Int(tSort) ?? 0]
        if let id { table["id"] = id }
        if let f = tFloor { table["floorId"] = f }
        if await run("table", ["type": "tableSave", "table": table], done: id == nil ? "テーブルを追加しました" : "テーブルを保存しました") { panel = .none }
    }
}

struct NativeTablesScreen: View {
    @StateObject private var model = NativeTablesModel()
    @EnvironmentObject var state: AppState
    @State private var confirmDeleteTable: NTBTable?
    @State private var confirmDeleteFloor: NTBFloor?

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "テーブル・フロア", en: "Tables", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                if !p.canEdit {
                    HStack(spacing: 10) {
                        Image(systemName: "lock").foregroundColor(NFColor.ink3)
                        Text(p.adminOnlyNote).font(.system(size: 13)).foregroundColor(NFColor.ink2)
                        Spacer()
                    }
                    .padding(14).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
                }
                HStack(alignment: .top, spacing: 16) {
                    floorsCard(p).frame(width: 320)
                    tablesCard(p)
                }
                HStack(spacing: 10) {
                    NSPButton(text: "テーブルQRコードをまとめて印刷", icon: "qrcode") { state.openSettingsPage(.tableQr, webPath: "/app/settings/tables/qr-print") }
                    Spacer()
                }
            }
        }
        .task { await model.refresh() }
        .alert("テーブルを削除", isPresented: Binding(get: { confirmDeleteTable != nil }, set: { if !$0 { confirmDeleteTable = nil } }), presenting: confirmDeleteTable) { t in
            Button("削除する", role: .destructive) { Task { _ = await model.run("del" + t.id, ["type": "tableDelete", "id": t.id], done: "削除しました") }; confirmDeleteTable = nil }
            Button("やめる", role: .cancel) { confirmDeleteTable = nil }
        } message: { t in Text("「\(t.name)」を削除します。過去の伝票は残ります") }
        .alert("フロアを削除", isPresented: Binding(get: { confirmDeleteFloor != nil }, set: { if !$0 { confirmDeleteFloor = nil } }), presenting: confirmDeleteFloor) { f in
            Button("削除する", role: .destructive) { Task { _ = await model.run("delf" + f.id, ["type": "floorDelete", "id": f.id], done: "削除しました") }; confirmDeleteFloor = nil }
            Button("やめる", role: .cancel) { confirmDeleteFloor = nil }
        } message: { f in Text("「\(f.name)」を削除します。このフロアのテーブルはフロア未設定になります") }
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 36)
                .background(Capsule().fill(on ? NFColor.navy : Color.white)).overlay(Capsule().stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
    private func tag(_ t: String, _ c: Color, fill: Color = .clear) -> some View {
        Text(t).font(.system(size: 11, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(fill)).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }
    private func small(_ text: String, icon: String? = nil, danger: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) { if let icon { Image(systemName: icon).font(.system(size: 11, weight: .bold)) }; Text(text).font(.system(size: 12.5, weight: .bold)) }
                .foregroundColor(danger ? NFColor.danger : NFColor.ink).padding(.horizontal, 10).frame(height: 34)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 9).stroke(danger ? NFColor.dangerSoft : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle()).disabled(disabled).opacity(disabled ? 0.5 : 1)
    }

    private func floorsCard(_ p: NTBPayload) -> some View {
        NSPCard(title: "フロア", en: "\(p.floors.count) フロア") {
            VStack(spacing: 0) {
                Button { model.floorFilter = nil } label: {
                    HStack { Text("すべて").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink); Spacer(); Text("\(p.tables.count) 卓").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                        .padding(.horizontal, 18).frame(height: 44).background(model.floorFilter == nil ? NFColor.lilacSoft : Color.white)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                .buttonStyle(.plain)
                ForEach(p.floors) { f in
                    VStack(spacing: 0) {
                        Button { model.floorFilter = f.id } label: {
                            HStack(spacing: 8) {
                                Text(f.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                                if p.defaultFloorId == f.id { tag("最初に出す", NFColor.iris, fill: NFColor.irisSoft) }
                                Spacer()
                                Text("\(f.tableCount) 卓").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 18).frame(height: 44).background(model.floorFilter == f.id ? NFColor.lilacSoft : Color.white)
                        }
                        .buttonStyle(.plain)
                        if p.canEdit && model.floorFilter == f.id {
                            if model.panel == .renameFloor(f.id) {
                                HStack(spacing: 6) {
                                    NSPInput(text: $model.floorName, placeholder: "フロア名", width: 180)
                                    small("保存", disabled: model.floorName.trimmingCharacters(in: .whitespaces).isEmpty) { Task { if await model.run("floor", ["type": "floorRename", "id": f.id, "name": model.floorName], done: "フロア名を変えました") { model.panel = .none } } }
                                    small("やめる") { model.panel = .none }
                                }
                                .padding(.horizontal, 18).padding(.bottom, 10)
                            } else {
                                HStack(spacing: 6) {
                                    small("名前", icon: "pencil") { model.floorName = f.name; model.panel = .renameFloor(f.id) }
                                    small(p.defaultFloorId == f.id ? "最初に出すのを解除" : "最初に出す", icon: "star") { Task { _ = await model.run("deff", ["type": "floorDefault", "id": p.defaultFloorId == f.id ? NSNull() as Any : f.id as Any], done: "保存しました") } }
                                    small("削除", icon: "trash", danger: true) { confirmDeleteFloor = f }
                                }
                                .padding(.horizontal, 18).padding(.bottom, 10)
                            }
                        }
                    }
                    .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
                if p.canEdit {
                    HStack(spacing: 6) {
                        NSPInput(text: $model.newFloor, placeholder: "新しいフロア名", width: 190)
                        NSPButton(text: "追加", icon: "plus", primary: true, busy: model.busy == "floorAdd", disabled: model.newFloor.trimmingCharacters(in: .whitespaces).isEmpty) { Task { if await model.run("floorAdd", ["type": "floorAdd", "name": model.newFloor], done: "フロアを追加しました") { model.newFloor = "" } } }
                    }
                    .padding(14)
                }
            }
        }
    }

    private func tablesCard(_ p: NTBPayload) -> some View {
        NSPCard(title: "テーブル", en: "\(model.tables.count) 卓") {
            VStack(spacing: 0) {
                if p.canEdit {
                    HStack(spacing: 8) {
                        if model.panel != .addTable { NSPButton(text: "テーブルを追加", icon: "plus", primary: true) { model.startAdd() } }
                        NSPButton(text: "名前順に並べ直す", icon: "arrow.up.arrow.down", busy: model.busy == "reorder") { Task { _ = await model.run("reorder", ["type": "tablesReorderByName"], done: "名前順に並べ直しました") } }
                        Spacer()
                    }
                    .padding(14)
                    Rectangle().fill(NFColor.line).frame(height: 1)
                }
                if model.panel == .addTable { tableForm(p, id: nil) }
                if model.tables.isEmpty { Text("テーブルがありません").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                ForEach(model.tables) { t in
                    let open = model.panel == .editTable(t.id)
                    Button { if p.canEdit { if open { model.panel = .none } else { model.startEdit(t) } } } label: {
                        HStack(spacing: 12) {
                            Text("\(t.sortOrder)").font(.system(size: 12)).foregroundColor(NFColor.ink3).monospacedDigit().frame(width: 28)
                            Text(t.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).frame(width: 120, alignment: .leading)
                            Text(t.floorName ?? "フロア未設定").font(.system(size: 13)).foregroundColor(NFColor.ink2).frame(width: 110, alignment: .leading)
                            Text("\(t.capacityMin)〜\(t.capacityMax) 名").font(.system(size: 13)).foregroundColor(NFColor.ink2).monospacedDigit().frame(width: 80, alignment: .leading)
                            HStack(spacing: 4) {
                                if t.isPrivateRoom { tag("個室", NFColor.ink2) }
                                if t.isCounter { tag("カウンター", NFColor.ink2) }
                                if t.smokingAllowed { tag("喫煙可", NFColor.ink2) }
                            }
                            Spacer()
                            tag(t.available ? "利用可能" : "利用停止中", t.available ? NFColor.success : NFColor.ink3, fill: t.available ? NFColor.successSoft : .clear)
                            if p.canEdit {
                                small(t.available ? "停止" : "再開", icon: t.available ? "pause" : "play", disabled: model.busy != nil) { Task { _ = await model.run("av" + t.id, ["type": "tableAvailable", "id": t.id, "available": !t.available], done: t.available ? "利用停止にしました" : "再開しました") } }
                                small("削除", icon: "trash", danger: true, disabled: model.busy != nil) { confirmDeleteTable = t }
                                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                        }
                        .padding(.horizontal, 18).frame(minHeight: 52)
                        .background(open ? NFColor.lilacSoft : Color.white)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    .buttonStyle(.plain)
                    if open { tableForm(p, id: t.id) }
                }
            }
        }
    }

    private func tableForm(_ p: NTBPayload, id: String?) -> some View {
        VStack(spacing: 0) {
            NSPRow(label: "テーブル名", required: true) { NSPInput(text: $model.tName, placeholder: "A1", width: 220) }
            NSPRow(label: "席数", en: "最小〜最大", required: true) {
                HStack(spacing: 8) {
                    NSPInput(text: $model.tMin, placeholder: "2", width: 90, keyboard: .numberPad)
                    Text("〜").foregroundColor(NFColor.ink3)
                    NSPInput(text: $model.tMax, placeholder: "4", width: 90, keyboard: .numberPad, trailing: "名")
                }
            }
            NSPRow(label: "フロア") {
                Menu {
                    Button("フロア未設定") { model.tFloor = nil }
                    ForEach(p.floors) { f in Button(f.name) { model.tFloor = f.id } }
                } label: {
                    HStack(spacing: 6) {
                        Text(p.floors.first { $0.id == model.tFloor }?.name ?? "フロア未設定").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                    }
                    .padding(.horizontal, 12).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
            }
            NSPRow(label: "並び順") { NSPInput(text: $model.tSort, placeholder: "0", width: 90, keyboard: .numberPad) }
            NSPRow(label: "種別") {
                HStack(spacing: 8) {
                    checkChip("個室", on: model.tPrivate) { model.tPrivate.toggle() }
                    checkChip("カウンター", on: model.tCounter) { model.tCounter.toggle() }
                    checkChip("喫煙可", on: model.tSmoking) { model.tSmoking.toggle() }
                }
            }
            HStack(spacing: 10) {
                NSPButton(text: id == nil ? "追加する" : "保存する", primary: true, busy: model.busy == "table", disabled: model.tName.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await model.saveTable(id: id) } }
                NSPButton(text: "やめる") { model.panel = .none }
                Spacer()
            }
            .padding(18)
        }
        .background(NFColor.lilacSoft.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }
    private func checkChip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: on ? "checkmark.square.fill" : "square").foregroundColor(on ? NFColor.iris : NFColor.ink3)
                Text(text).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink)
            }
            .padding(.horizontal, 12).frame(height: 40)
            .background(RoundedRectangle(cornerRadius: 10).fill(on ? NFColor.irisSoft : Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - ダイナミックプライシング（Web の /app/settings/dynamic-pricing・components/settings/dynamic-pricing-editor.tsx と同じ）

struct NDPRule: Codable, Identifiable, Hashable {
    var id: String; var name: String; var enabled: Bool; var days: [Int]; var start: String; var end: String
    var target: String; var categoryIds: [String]; var itemIds: [String]; var kind: String; var value: Int; var roundTo10: Bool
    static func fresh() -> NDPRule {
        NDPRule(id: UUID().uuidString.lowercased(), name: "ハッピーアワー", enabled: true, days: [1, 2, 3, 4, 5], start: "17:00", end: "19:00", target: "categories", categoryIds: [], itemIds: [], kind: "percent", value: -20, roundTo10: true)
    }
    /// lib/dynamic-pricing.ts の describeRule と同じ
    var describe: String {
        let w = ["日", "月", "火", "水", "木", "金", "土"]
        let d = days.isEmpty || days.count == 7 ? "毎日" : days.sorted().map { w[$0] }.joined(separator: "・")
        let t = start == end ? "終日" : "\(start)〜\(end)"
        let how: String
        switch kind {
        case "fixed": how = "\(NT.yen(value))にする"
        case "amount": how = value >= 0 ? "+\(NT.yen(value))" : "-\(NT.yen(-value))"
        default: how = value < 0 ? "\(-value)%引き" : "+\(value)%"
        }
        return "\(d) \(t)・\(how)\(roundTo10 ? "（10円単位）" : "")"
    }
    var json: [String: Any] {
        ["id": id, "name": name, "enabled": enabled, "days": days, "start": start, "end": end, "target": target, "categoryIds": categoryIds, "itemIds": itemIds, "kind": kind, "value": value, "roundTo10": roundTo10]
    }
}
struct NDPItem: Codable, Identifiable, Hashable { let id: String; let name: String; let categoryId: String?; let price: Double }
struct NDPPayload: Codable { let store: NFNamed; let canEdit: Bool; let rules: [NDPRule]; let categories: [NFNamed]; let items: [NDPItem] }

@MainActor
final class NativeDynamicPricingModel: NSPModel<NDPPayload> {
    @Published var rules: [NDPRule] = []
    @Published var open: String?
    @Published var itemQuery = ""
    init() { super.init(part: "dynamicPricing") }
    override func loaded(_ p: NDPPayload) { rules = p.rules }
    var dirty: Bool { payload.map { $0.rules != rules } ?? false }
    func idx(_ id: String) -> Int? { rules.firstIndex { $0.id == id } }
    func save() async {
        for r in rules {
            if r.name.trimmingCharacters(in: .whitespaces).isEmpty { toast = "ルール名を入力してください"; return }
            if r.target == "categories" && r.categoryIds.isEmpty { toast = "「\(r.name)」: カテゴリを1つ以上選んでください"; return }
            if r.target == "items" && r.itemIds.isEmpty { toast = "「\(r.name)」: 商品を1つ以上選んでください"; return }
        }
        _ = await run("save", ["type": "dynamicPricingSave", "rules": rules.map(\.json)], done: "ダイナミックプライシングを保存しました（レジ・ハンディ・QRにすぐ反映）")
    }
}

struct NativeDynamicPricingScreen: View {
    @StateObject private var model = NativeDynamicPricingModel()
    @EnvironmentObject var state: AppState
    private let kinds: [(String, String)] = [("percent", "± ％"), ("amount", "± 円"), ("fixed", "この金額にする")]
    private let targets: [(String, String)] = [("categories", "カテゴリを選ぶ"), ("items", "商品を選ぶ"), ("all", "フード・ドリンク全部")]

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "ダイナミックプライシング", en: "Dynamic pricing", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                HStack(spacing: 10) {
                    Text("上から順に優先。曜日と時間帯で値段を自動で変える（ハッピーアワー・深夜料金など）").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                    Spacer()
                    NSPButton(text: "ルールを足す", icon: "plus", disabled: model.rules.count >= 50) { let r = NDPRule.fresh(); model.rules.append(r); model.open = r.id }
                    NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: !model.dirty) { Task { await model.save() } }
                }
                NSPCard(title: "ルール", en: "\(model.rules.count) 件") {
                    VStack(spacing: 0) {
                        if model.rules.isEmpty { Text("ルールがありません。「ルールを足す」から").font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18) }
                        ForEach(Array(model.rules.enumerated()), id: \.element.id) { i, r in
                            let open = model.open == r.id
                            HStack(spacing: 10) {
                                NSPToggle(on: r.enabled) { model.rules[i].enabled.toggle() }
                                Button { model.open = open ? nil : r.id } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(r.name.isEmpty ? "（名前なし）" : r.name).font(.system(size: 15, weight: .bold)).foregroundColor(r.enabled ? NFColor.ink : NFColor.ink3)
                                        Text(r.describe + "・" + targetText(p, r)).font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                                NSPButton(text: "↑", disabled: i == 0) { model.rules.swapAt(i, i - 1) }
                                NSPButton(text: "↓", disabled: i == model.rules.count - 1) { model.rules.swapAt(i, i + 1) }
                                NSPButton(text: "削除", icon: "trash") { model.rules.remove(at: i); if model.open == r.id { model.open = nil } }
                                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                            }
                            .padding(.horizontal, 18).frame(minHeight: 58)
                            .background(open ? NFColor.lilacSoft : Color.white)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            if open { editor(p, i) }
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }

    private func targetText(_ p: NDPPayload, _ r: NDPRule) -> String {
        switch r.target {
        case "all": return "フード・ドリンク全部"
        case "items": return "商品 \(r.itemIds.count) 品"
        default: return r.categoryIds.isEmpty ? "カテゴリ未選択" : r.categoryIds.compactMap { id in p.categories.first { $0.id == id }?.name }.joined(separator: "・")
        }
    }

    private func menuBox(_ text: String, enabled: Bool = true) -> some View {
        HStack(spacing: 6) {
            Text(text).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
        }
        .padding(.horizontal, 12).frame(height: 44)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
    }
    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13.5, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 38)
                .background(Capsule().fill(on ? NFColor.iris : Color.white)).overlay(Capsule().stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func editor(_ p: NDPPayload, _ i: Int) -> some View {
        let r = model.rules[i]
        let w = ["日", "月", "火", "水", "木", "金", "土"]
        return VStack(spacing: 0) {
            NSPRow(label: "ルール名", required: true) { NSPInput(text: Binding(get: { model.rules[i].name }, set: { model.rules[i].name = $0 }), placeholder: "ハッピーアワー", width: 300) }
            NSPRow(label: "曜日", en: "何も選ばなければ毎日") {
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { d in
                        chip(w[d], on: r.days.contains(d)) { if let k = model.rules[i].days.firstIndex(of: d) { model.rules[i].days.remove(at: k) } else { model.rules[i].days.append(d); model.rules[i].days.sort() } }
                    }
                }
            }
            NSPRow(label: "時間", en: "同じなら終日・終了が前なら日をまたぐ") {
                HStack(spacing: 8) {
                    NSPTimeMenu(value: r.start, options: NSPApi.timeOptions(toMin: 23 * 60 + 45)) { if let v = $0 { model.rules[i].start = v } }
                    Text("〜").foregroundColor(NFColor.ink3)
                    NSPTimeMenu(value: r.end, options: NSPApi.timeOptions(toMin: 23 * 60 + 45)) { if let v = $0 { model.rules[i].end = v } }
                }
            }
            NSPRow(label: "対象") {
                Menu { ForEach(targets, id: \.0) { t in Button(t.1) { model.rules[i].target = t.0 } } } label: { menuBox(targets.first { $0.0 == r.target }?.1 ?? r.target) }
            }
            if r.target == "categories" {
                NSPRow(label: "カテゴリ", required: true) {
                    WrapLayout(spacing: 6) {
                        ForEach(p.categories) { c in
                            chip(c.name, on: r.categoryIds.contains(c.id)) { if let k = model.rules[i].categoryIds.firstIndex(of: c.id) { model.rules[i].categoryIds.remove(at: k) } else { model.rules[i].categoryIds.append(c.id) } }
                        }
                    }
                }
            }
            if r.target == "items" {
                NSPRow(label: "商品", en: "\(r.itemIds.count) 品", required: true) {
                    VStack(alignment: .leading, spacing: 8) {
                        WrapLayout(spacing: 6) {
                            ForEach(r.itemIds, id: \.self) { id in
                                chip((p.items.first { $0.id == id }?.name ?? "？") + " ×", on: true) { model.rules[i].itemIds.removeAll { $0 == id } }
                            }
                        }
                        NSPInput(text: $model.itemQuery, placeholder: "商品名で検索して追加", width: 300)
                        if !model.itemQuery.isEmpty {
                            let q = NativeSoldOutModel.norm(model.itemQuery)
                            WrapLayout(spacing: 6) {
                                ForEach(p.items.filter { !r.itemIds.contains($0.id) && NativeSoldOutModel.norm($0.name).contains(q) }.prefix(30)) { it in
                                    chip("+ \(it.name)（\(NT.yen(Int(it.price)))）", on: false) { model.rules[i].itemIds.append(it.id) }
                                }
                            }
                        }
                    }
                }
            }
            NSPRow(label: "値段の変え方", required: true) {
                HStack(spacing: 8) {
                    Menu { ForEach(kinds, id: \.0) { k in Button(k.1) { model.rules[i].kind = k.0 } } } label: { menuBox(kinds.first { $0.0 == r.kind }?.1 ?? r.kind) }
                    NSPInput(text: Binding(get: { String(model.rules[i].value) }, set: { model.rules[i].value = Int($0.replacingOccurrences(of: "−", with: "-").filter { $0.isNumber || $0 == "-" }) ?? 0 }), placeholder: "-20", width: 120, keyboard: .numbersAndPunctuation, trailing: r.kind == "percent" ? "%" : "円")
                    Text(r.kind == "percent" ? "-20 で2割引き、10 で1割増し" : (r.kind == "amount" ? "-100 で100円引き、50 で50円増し" : "例: 300 で全部300円")).font(.system(size: 12)).foregroundColor(NFColor.ink3)
                }
            }
            NSPRow(label: "端数") { chip("10円単位に四捨五入", on: r.roundTo10) { model.rules[i].roundTo10.toggle() } }
        }
        .background(NFColor.lilacSoft.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }
}

// MARK: - 集計（Web の /app/settings/summary と同じ。店舗運営・仕入・在庫・経理・労務・経営・店舗内共有・管理 の画面への入口）

struct NSMItem: Codable, Identifiable, Hashable { let href: String; let label: String; let en: String; let icon: String; var id: String { href } }
struct NSMGroup: Codable, Identifiable, Hashable { let label: String; let en: String; let items: [NSMItem]; var id: String { label } }
struct NSMPayload: Codable { let store: NFNamed; let groups: [NSMGroup] }

@MainActor final class NativeSummaryModel: NSPModel<NSMPayload> { init() { super.init(part: "summary") } }

struct NativeSummaryScreen: View {
    @StateObject private var model = NativeSummaryModel()
    @EnvironmentObject var state: AppState
    /// lucide の名前 → SF Symbols（components/layout/nav-icons.tsx の対応と同じ意味のもの）
    private static let icons: [String: String] = [
        "yen": "yensign.circle", "calendar": "calendar", "pos": "cart", "home": "house", "clock": "clock", "clipboard": "list.clipboard", "chart": "chart.bar",
        "more": "ellipsis.circle", "list": "list.bullet", "file": "doc.text", "book": "book", "wallet": "wallet.pass", "users": "person.2", "truck": "shippingbox",
        "ticket": "ticket", "settings": "gearshape", "receipt": "receipt", "package": "cube.box", "monitor": "desktopcomputer", "mail": "envelope", "lock": "lock",
        "gear": "gearshape", "drawer": "tray", "camera": "camera", "calculator": "plus.forwardslash.minus", "bell": "bell", "bank": "building.columns", "bag": "bag",
    ]
    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "集計", en: "Reports & admin", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.groups.isEmpty { Text("権限の範囲では開ける画面がありません").font(.system(size: 14)).foregroundColor(NFColor.ink3) }
                ForEach(p.groups) { g in
                    NSPCard(title: g.label, en: g.en) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 10)], spacing: 10) {
                            ForEach(g.items) { it in
                                Button {
                                    if let key = NativeSettingsPageKey.from(path: it.href) { state.openSettingsPage(key, webPath: it.href) } else { state.leaveNativeFloor(to: it.href) }
                                } label: {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            RoundedRectangle(cornerRadius: 10).fill(NFColor.navy).frame(width: 40, height: 40)
                                            Image(systemName: NativeSummaryScreen.icons[it.icon] ?? "square.grid.2x2").font(.system(size: 17, weight: .semibold)).foregroundColor(.white)
                                        }
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(it.label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                                            Text(it.en).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1)
                                        }
                                        Spacer(minLength: 0)
                                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                                    }
                                    .padding(.horizontal, 12).frame(height: 60)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                        .padding(14)
                    }
                }
            }
        }
        .task { await model.refresh() }
    }
}

// MARK: - メニュー一括編集（Web の /app/settings/menu-bulk・components/settings/menu-bulk-editor.tsx と同じ。変更は管理画面だけ）

struct NMBRow: Codable, Identifiable, Hashable {
    let id: String; var name: String; var nameEn: String; var categoryId: String?; var itemType: String; var price: Int; var takeoutPrice: Int?; var status: String; var isSoldOut: Bool
}
struct NMBKPayload: Codable { let store: NFNamed; let canEdit: Bool; let adminOnlyNote: String; let categories: [NFNamed]; let itemTypes: [NPYIdLabel]; let rows: [NMBRow] }

@MainActor
final class NativeMenuBulkModel: NSPModel<NMBKPayload> {
    @Published var rows: [NMBRow] = []
    @Published var query = ""
    @Published var catFilter: String? = nil
    @Published var selected: Set<String> = []
    @Published var open: String?
    @Published var opYen = ""
    @Published var opPercent = ""
    init() { super.init(part: "menuBulk") }
    override func loaded(_ p: NMBKPayload) { rows = p.rows; selected = []; open = nil }
    var initial: [String: NMBRow] { Dictionary(uniqueKeysWithValues: (payload?.rows ?? []).map { ($0.id, $0) }) }
    /// lib/menu-bulk.ts の diffBulkRows と同じ（変わった行・項目だけ）
    var patches: [[String: Any]] {
        let before = initial
        var out: [[String: Any]] = []
        for r in rows {
            guard let b = before[r.id] else { continue }
            var p: [String: Any] = ["id": r.id]
            if r.name.trimmingCharacters(in: .whitespaces) != b.name.trimmingCharacters(in: .whitespaces) { p["name"] = r.name.trimmingCharacters(in: .whitespaces) }
            if r.nameEn.trimmingCharacters(in: .whitespaces) != b.nameEn.trimmingCharacters(in: .whitespaces) { p["nameEn"] = r.nameEn.trimmingCharacters(in: .whitespaces) }
            if r.categoryId != b.categoryId { p["categoryId"] = r.categoryId.map { $0 as Any } ?? NSNull() }
            if r.itemType != b.itemType { p["itemType"] = r.itemType }
            if r.price != b.price { p["price"] = r.price }
            if r.takeoutPrice != b.takeoutPrice { p["takeoutPrice"] = r.takeoutPrice.map { $0 as Any } ?? NSNull() }
            if r.status != b.status { p["status"] = r.status }
            if r.isSoldOut != b.isSoldOut { p["isSoldOut"] = r.isSoldOut }
            if p.count > 1 { out.append(p) }
        }
        return out
    }
    var changedCount: Int { patches.count }
    var filtered: [NMBRow] {
        let q = NativeSoldOutModel.norm(query)
        return rows.filter { r in (catFilter == nil || r.categoryId == catFilter) && (q.isEmpty || NativeSoldOutModel.norm(r.name + r.nameEn).contains(q)) }
    }
    func idx(_ id: String) -> Int? { rows.firstIndex { $0.id == id } }
    /// 選んだ行にまとめて（lib/menu-bulk.ts の applyBulkOp と同じ）
    func applyAll(_ f: (inout NMBRow) -> Void) { for i in rows.indices where selected.contains(rows[i].id) { f(&rows[i]) } }
    func save() async {
        let ps = patches
        guard !ps.isEmpty else { toast = "変更がありません"; return }
        if rows.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) { toast = "商品名が空の行があります"; return }
        guard busy == nil else { return }
        busy = "save"; defer { busy = nil }
        let r = await NSPApi.postJSON(["type": "menuBulkSave", "patches": ps])
        guard r.ok else { toast = r.error ?? "保存できませんでした"; return }
        await refresh()
        toast = "\((r.json?["updated"] as? Int) ?? ps.count)件を保存しました"
    }
}

struct NativeMenuBulkScreen: View {
    @StateObject private var model = NativeMenuBulkModel()
    @EnvironmentObject var state: AppState

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "メニュー一括編集", en: "Bulk edit", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                if !p.canEdit {
                    HStack(spacing: 10) { Image(systemName: "lock").foregroundColor(NFColor.ink3); Text(p.adminOnlyNote).font(.system(size: 13)).foregroundColor(NFColor.ink2); Spacer() }
                        .padding(14).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
                }
                HStack(spacing: 10) {
                    NSPInput(text: $model.query, placeholder: "商品名で探す", width: 260)
                    Menu {
                        Button("すべてのカテゴリ") { model.catFilter = nil }
                        ForEach(p.categories) { c in Button(c.name) { model.catFilter = c.id } }
                    } label: { menuBox(p.categories.first { $0.id == model.catFilter }?.name ?? "すべてのカテゴリ") }
                    Spacer()
                    if p.canEdit {
                        Text(model.changedCount > 0 ? "\(model.changedCount) 件変更" : "変更なし").font(.system(size: 13, weight: .bold)).foregroundColor(model.changedCount > 0 ? NFColor.iris : NFColor.ink3)
                        NSPButton(text: "元に戻す", disabled: model.changedCount == 0) { model.rows = p.rows }
                        NSPButton(text: "保存する", primary: true, busy: model.busy == "save", disabled: model.changedCount == 0) { Task { await model.save() } }
                    }
                }
                if p.canEdit && !model.selected.isEmpty { bulkBar(p) }
                NSPCard(title: "商品", en: "\(model.filtered.count) 品") {
                    VStack(spacing: 0) {
                        if p.canEdit {
                            HStack(spacing: 10) {
                                check(model.filtered.allSatisfy { model.selected.contains($0.id) } && !model.filtered.isEmpty) {
                                    let ids = model.filtered.map(\.id)
                                    if ids.allSatisfy({ model.selected.contains($0) }) { ids.forEach { model.selected.remove($0) } } else { ids.forEach { model.selected.insert($0) } }
                                }
                                Text("表示中を全部選ぶ").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                                Spacer()
                            }
                            .padding(.horizontal, 18).frame(height: 40)
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                        ForEach(model.filtered) { r in
                            let changed = model.initial[r.id] != r
                            let open = model.open == r.id
                            HStack(spacing: 10) {
                                if p.canEdit { check(model.selected.contains(r.id)) { if model.selected.contains(r.id) { model.selected.remove(r.id) } else { model.selected.insert(r.id) } } }
                                Button { if p.canEdit { model.open = open ? nil : r.id } } label: {
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(r.name.isEmpty ? "（名前なし）" : r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(r.status == "hidden" ? NFColor.ink3 : NFColor.ink).lineLimit(1)
                                            if !r.nameEn.isEmpty { Text(r.nameEn).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1) }
                                        }
                                        .frame(width: 240, alignment: .leading)
                                        Text(p.categories.first { $0.id == r.categoryId }?.name ?? "カテゴリ未設定").font(.system(size: 13)).foregroundColor(NFColor.ink2).frame(width: 130, alignment: .leading).lineLimit(1)
                                        Text(p.itemTypes.first { $0.id == r.itemType }?.label ?? r.itemType).font(.system(size: 12.5)).foregroundColor(NFColor.ink2).frame(width: 80, alignment: .leading)
                                        Text(NT.yen(r.price)).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink).monospacedDigit().frame(width: 90, alignment: .trailing)
                                        Text(r.takeoutPrice.map { NT.yen($0) } ?? "—").font(.system(size: 12.5)).foregroundColor(NFColor.ink3).monospacedDigit().frame(width: 90, alignment: .trailing)
                                        Spacer()
                                        if r.isSoldOut { tag("売切", NFColor.danger) }
                                        tag(r.status == "hidden" ? "非表示" : "表示", r.status == "hidden" ? NFColor.ink3 : NFColor.success)
                                        if changed { tag("変更", NFColor.iris, fill: NFColor.irisSoft) }
                                        if p.canEdit { Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3) }
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 18).frame(minHeight: 50)
                            .background(open ? NFColor.lilacSoft : (changed ? NFColor.irisSoft.opacity(0.35) : Color.white))
                            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                            if open, let i = model.idx(r.id) { rowEditor(p, i) }
                        }
                    }
                }
            }
        }
        .task { await model.refresh() }
    }

    private func tag(_ t: String, _ c: Color, fill: Color = .clear) -> some View {
        Text(t).font(.system(size: 11, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(fill)).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }
    private func check(_ on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: on ? "checkmark.square.fill" : "square").font(.system(size: 20)).foregroundColor(on ? NFColor.iris : NFColor.ink3).frame(width: 28, height: 28) }.buttonStyle(.plain)
    }
    private func menuBox(_ text: String) -> some View {
        HStack(spacing: 6) {
            Text(text).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
        }
        .padding(.horizontal, 12).frame(height: 44)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
    }
    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 13, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2).padding(.horizontal, 12).frame(height: 38)
                .background(Capsule().fill(on ? NFColor.iris : Color.white)).overlay(Capsule().stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    /// 選んだ行にまとめてかける操作（lib/menu-bulk.ts の BulkOp）
    private func bulkBar(_ p: NMBKPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text("\(model.selected.count) 品を選択中").font(.system(size: 14, weight: NT.strong)).foregroundColor(NFColor.navy)
                Menu { Button("カテゴリ未設定") { model.applyAll { $0.categoryId = nil } }; ForEach(p.categories) { c in Button(c.name) { model.applyAll { $0.categoryId = c.id } } } } label: { menuBox("カテゴリを変える") }
                Menu { ForEach(p.itemTypes) { t in Button(t.label) { model.applyAll { $0.itemType = t.id } } } } label: { menuBox("種別を変える") }
                Menu {
                    Button("表示にする") { model.applyAll { $0.status = "active" } }
                    Button("非表示にする") { model.applyAll { $0.status = "hidden" } }
                    Button("売切にする") { model.applyAll { $0.isSoldOut = true } }
                    Button("売切を解除") { model.applyAll { $0.isSoldOut = false } }
                } label: { menuBox("表示・売切") }
                Spacer()
                NSPButton(text: "選択を解除") { model.selected = [] }
            }
            HStack(spacing: 10) {
                NSPInput(text: $model.opYen, placeholder: "±円 / 金額", width: 130, keyboard: .numbersAndPunctuation)
                NSPButton(text: "円を足す/引く", disabled: Int(model.opYen) == nil) { let y = Int(model.opYen) ?? 0; model.applyAll { $0.price = max(0, min(10_000_000, $0.price + y)) } }
                NSPButton(text: "この金額にする", disabled: Int(model.opYen) == nil) { let y = Int(model.opYen) ?? 0; model.applyAll { $0.price = max(0, min(10_000_000, y)) } }
                NSPInput(text: $model.opPercent, placeholder: "±％", width: 100, keyboard: .numbersAndPunctuation)
                NSPButton(text: "％で変える（10円単位）", disabled: Int(model.opPercent) == nil) {
                    let pc = Double(Int(model.opPercent) ?? 0)
                    model.applyAll { let raw = Double($0.price) * (100 + pc) / 100; $0.price = max(0, min(10_000_000, Int((raw / 10).rounded()) * 10)) }
                }
                Spacer()
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.irisSoft))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.iris.opacity(0.35), lineWidth: 1))
    }

    private func rowEditor(_ p: NMBKPayload, _ i: Int) -> some View {
        let r = model.rows[i]
        return VStack(spacing: 0) {
            NSPRow(label: "商品名", required: true) {
                HStack(spacing: 8) {
                    NSPInput(text: Binding(get: { model.rows[i].name }, set: { model.rows[i].name = $0 }), placeholder: "商品名", width: 300)
                    NSPInput(text: Binding(get: { model.rows[i].nameEn }, set: { model.rows[i].nameEn = $0 }), placeholder: "English name", width: 260)
                }
            }
            NSPRow(label: "カテゴリ・種別") {
                HStack(spacing: 8) {
                    Menu { Button("カテゴリ未設定") { model.rows[i].categoryId = nil }; ForEach(p.categories) { c in Button(c.name) { model.rows[i].categoryId = c.id } } } label: { menuBox(p.categories.first { $0.id == r.categoryId }?.name ?? "カテゴリ未設定") }
                    Menu { ForEach(p.itemTypes) { t in Button(t.label) { model.rows[i].itemType = t.id } } } label: { menuBox(p.itemTypes.first { $0.id == r.itemType }?.label ?? r.itemType) }
                }
            }
            NSPRow(label: "価格", en: "店内 / テイクアウト") {
                HStack(spacing: 8) {
                    NSPInput(text: Binding(get: { String(model.rows[i].price) }, set: { model.rows[i].price = Int($0.filter(\.isNumber)) ?? 0 }), placeholder: "0", width: 130, keyboard: .numberPad, trailing: "円")
                    NSPInput(text: Binding(get: { model.rows[i].takeoutPrice.map(String.init) ?? "" }, set: { let d = $0.filter(\.isNumber); model.rows[i].takeoutPrice = d.isEmpty ? nil : Int(d) }), placeholder: "店内と同じ", width: 150, keyboard: .numberPad, trailing: "円")
                }
            }
            NSPRow(label: "表示・売切") {
                HStack(spacing: 8) {
                    chip("表示", on: r.status == "active") { model.rows[i].status = "active" }
                    chip("非表示", on: r.status == "hidden") { model.rows[i].status = "hidden" }
                    chip("売切", on: r.isSoldOut) { model.rows[i].isSoldOut.toggle() }
                }
            }
        }
        .background(NFColor.lilacSoft.opacity(0.5))
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }
}

// MARK: - データ取込（Web の /app/settings/import・components/import/import-wizard.tsx と同じ。CSV はこの iPad で選んでサーバーで読む）

struct NIMField: Codable, Identifiable, Hashable { let key: String; let label: String; let required: Bool; let hint: String?; var id: String { key } }
struct NIMType: Codable, Identifiable, Hashable { let id: String; let label: String; let listPath: String; let fields: [NIMField] }
struct NIMPayload: Codable { let store: NFNamed; let hasStore: Bool; let types: [NIMType]; let maxRows: Int }
struct NIMPreviewRow: Codable, Identifiable, Hashable { let rowNumber: Int; let status: String; let reason: String?; let values: [String: String]; var id: Int { rowNumber } }
struct NIMPreview: Codable, Hashable {
    struct Counts: Codable, Hashable { let ok: Int; let error: Int; let duplicate: Int }
    let headers: [String]; let mapping: [String: String?]; let missingRequired: [String]; let rows: [NIMPreviewRow]; let counts: Counts
}
struct NIMResult: Codable, Hashable {
    struct Failed: Codable, Hashable, Identifiable { let rowNumber: Int; let reason: String; var id: Int { rowNumber } }
    let inserted: Int; let skipped: Int; let updated: Int?; let failed: [Failed]
}

@MainActor
final class NativeImportModel: NSPModel<NIMPayload> {
    @Published var type: String = "menu_items"
    @Published var fileName: String?
    @Published var preview: NIMPreview?
    @Published var result: NIMResult?
    @Published var fileError: String?
    init() { super.init(part: "import") }

    func pick(_ url: URL) async {
        preview = nil; result = nil; fileError = nil
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { fileError = "ファイルを読めませんでした"; return }
        // Web の decodeCsvFile と同じく UTF-8。Excel の Shift_JIS も読めるようにする（iPad から送るときはこちらで直す）
        guard var text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .shiftJIS) else { fileError = "文字コードが読めません。Excel は「CSV UTF-8」で保存し直してください"; return }
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        fileName = url.lastPathComponent
        guard busy == nil else { return }
        busy = "preview"; defer { busy = nil }
        let r = await NSPApi.postJSON(["type": "importPreview", "importType": type, "csv": text])
        guard r.ok, let pv = r.json?["preview"] else { fileError = r.error ?? "読み込めませんでした"; return }
        if let d = try? JSONSerialization.data(withJSONObject: pv), let decoded = try? JSONDecoder().decode(NIMPreview.self, from: d) { preview = decoded } else { fileError = "プレビューを作れませんでした" }
    }
    func run() async {
        guard let pv = preview else { return }
        let rows = pv.rows.filter { $0.status == "ok" }.map { ["rowNumber": $0.rowNumber, "values": $0.values] as [String: Any] }
        guard !rows.isEmpty else { toast = "取り込める行がありません"; return }
        guard busy == nil else { return }
        busy = "run"; defer { busy = nil }
        let r = await NSPApi.postJSON(["type": "importRun", "importType": type, "rows": rows])
        guard r.ok, let res = r.json?["result"] else { toast = r.error ?? "取り込めませんでした"; return }
        if let d = try? JSONSerialization.data(withJSONObject: res), let decoded = try? JSONDecoder().decode(NIMResult.self, from: d) { result = decoded; preview = nil; toast = "\(decoded.inserted) 件を登録しました" } else { toast = "結果を読めませんでした" }
    }
}

struct NativeImportScreen: View {
    @StateObject private var model = NativeImportModel()
    @EnvironmentObject var state: AppState
    @State private var showPicker = false

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "データ取込", en: "Import", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: { await model.refresh() }) {
            if let p = model.payload {
                NSPCard(title: "1. 何を取り込むか", en: "CSV（1行目は列名）") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 8) {
                            ForEach(p.types) { t in
                                Button { model.type = t.id; model.preview = nil; model.result = nil; model.fileError = nil } label: {
                                    Text(t.label).font(.system(size: 14, weight: .bold)).foregroundColor(model.type == t.id ? .white : NFColor.ink2)
                                        .padding(.horizontal, 16).frame(height: 44)
                                        .background(RoundedRectangle(cornerRadius: 10).fill(model.type == t.id ? NFColor.iris : Color.white))
                                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(model.type == t.id ? NFColor.iris : NFColor.line, lineWidth: 1))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                        if let t = p.types.first(where: { $0.id == model.type }) {
                            WrapLayout(spacing: 6) {
                                ForEach(t.fields) { f in
                                    HStack(spacing: 4) {
                                        Text(f.label).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                                        if f.required { Text("必須").font(.system(size: 10, weight: NT.strong)).foregroundColor(.white).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(NFColor.danger)) }
                                    }
                                    .padding(.horizontal, 10).frame(height: 32).background(Capsule().fill(NFColor.lilacSoft))
                                }
                            }
                        }
                        HStack(spacing: 10) {
                            NSPButton(text: "CSV ファイルを選ぶ", icon: "doc.badge.plus", primary: true, busy: model.busy == "preview", disabled: !p.hasStore) { showPicker = true }
                            if let f = model.fileName { Text(f).font(.system(size: 13)).foregroundColor(NFColor.ink2) }
                            Spacer()
                            Text("最大 \(p.maxRows) 行").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        if let e = model.fileError { Text(e).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                    }
                    .padding(18)
                }
                if let pv = model.preview, let t = p.types.first(where: { $0.id == model.type }) { previewCard(pv, t) }
                if let res = model.result, let t = p.types.first(where: { $0.id == model.type }) { resultCard(res, t) }
            }
        }
        .task { await model.refresh() }
        .fileImporter(isPresented: $showPicker, allowedContentTypes: [.commaSeparatedText, .plainText, .text, .data], allowsMultipleSelection: false) { res in
            if case .success(let urls) = res, let url = urls.first { Task { await model.pick(url) } }
        }
    }

    private func tag(_ t: String, _ c: Color, fill: Color = .clear) -> some View {
        Text(t).font(.system(size: 11, weight: NT.strong)).foregroundColor(c).padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(fill)).overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
    }

    private func previewCard(_ pv: NIMPreview, _ t: NIMType) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NSPCard(title: "2. 列の対応", en: "列名から自動で対応付け") {
                VStack(spacing: 0) {
                    ForEach(t.fields) { f in
                        let col = pv.mapping[f.key] ?? nil
                        HStack(spacing: 10) {
                            Text(f.label).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink).frame(width: 180, alignment: .leading)
                            if f.required { tag("必須", NFColor.danger) }
                            Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                            Text(col ?? "（対応する列なし）").font(.system(size: 13.5, weight: col == nil ? .regular : .bold)).foregroundColor(col == nil ? (f.required ? NFColor.danger : NFColor.ink3) : NFColor.ink2)
                            if let h = f.hint { Text(h).font(.system(size: 11.5)).foregroundColor(NFColor.ink3).lineLimit(1) }
                            Spacer()
                        }
                        .padding(.horizontal, 18).frame(minHeight: 40)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if !pv.missingRequired.isEmpty {
                        Text("必須の列が足りません：\(pv.missingRequired.joined(separator: "・"))。CSV の1行目の列名を見直してください").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger).padding(18)
                    }
                }
            }
            NSPCard(title: "3. 確認して取り込む", en: "登録 \(pv.counts.ok)・エラー \(pv.counts.error)・スキップ \(pv.counts.duplicate)") {
                VStack(spacing: 0) {
                    ForEach(pv.rows.prefix(200)) { r in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(r.rowNumber)").font(.system(size: 12)).foregroundColor(NFColor.ink3).monospacedDigit().frame(width: 40, alignment: .trailing)
                            tag(r.status == "ok" ? "登録" : (r.status == "error" ? "エラー" : "スキップ"), r.status == "ok" ? NFColor.success : (r.status == "error" ? NFColor.danger : NFColor.ink3), fill: r.status == "ok" ? NFColor.successSoft : .clear).frame(width: 64)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.fields.compactMap { f in (r.values[f.key] ?? "").isEmpty ? nil : "\(f.label)：\(r.values[f.key] ?? "")" }.joined(separator: "　")).font(.system(size: 12.5)).foregroundColor(NFColor.ink2).lineLimit(2)
                                if let why = r.reason { Text(why).font(.system(size: 12)).foregroundColor(r.status == "error" ? NFColor.danger : NFColor.ink3) }
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 18).padding(.vertical, 6)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if pv.rows.count > 200 { Text("…他 \(pv.rows.count - 200) 行").font(.system(size: 12)).foregroundColor(NFColor.ink3).padding(12) }
                    HStack(spacing: 10) {
                        NSPButton(text: "\(pv.counts.ok) 件を取り込む", icon: "square.and.arrow.down", primary: true, busy: model.busy == "run", disabled: pv.counts.ok == 0 || !pv.missingRequired.isEmpty) { Task { await model.run() } }
                        Text("エラー・スキップの行は取り込みません").font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
                        Spacer()
                        NSPButton(text: "やめる") { model.preview = nil; model.fileName = nil }
                    }
                    .padding(18)
                }
            }
        }
    }

    private func resultCard(_ res: NIMResult, _ t: NIMType) -> some View {
        NSPCard(title: "取り込みました", en: t.label) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 14) {
                    Text("登録 \(res.inserted) 件").font(.system(size: 16, weight: NT.strong)).foregroundColor(NFColor.success)
                    if let u = res.updated, u > 0 { Text("更新 \(u) 件").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2) }
                    Text("スキップ \(res.skipped) 件").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink3)
                    if !res.failed.isEmpty { Text("失敗 \(res.failed.count) 件").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger) }
                    Spacer()
                    NSPButton(text: "一覧を見る", icon: "arrow.right") {
                        if let key = NativeSettingsPageKey.from(path: t.listPath) { state.openSettingsPage(key, webPath: t.listPath) } else { state.leaveNativeFloor(to: t.listPath) }
                    }
                }
                ForEach(res.failed.prefix(50)) { f in Text("\(f.rowNumber) 行目：\(f.reason)").font(.system(size: 12.5)).foregroundColor(NFColor.danger) }
            }
            .padding(18)
        }
    }
}
