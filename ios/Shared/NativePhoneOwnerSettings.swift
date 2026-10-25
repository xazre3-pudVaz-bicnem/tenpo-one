import SwiftUI
import CoreImage

// iPhone の店長・オーナー：設定（Web の /app/settings・/app/settings/**・/app/settings-all・/app/pos/settings・/app/pos/sold-out。
// 2026-10-25 Ronnie「Make everything 101% native」）。Web の画面には行かない。
//   入口：お店の設定のまとめ（店舗・メニュー・デバイス管理・予約・顧客・会計・運用・管理）を iPad・Web と同じ並びで 1 列に
//   中の画面：iPhone の幅に合わせて作り直した画面（NativePhoneOwnerSettings*.swift）。読み込み・操作は iPad と同じ
//   GET part ／ POST type（iPad の NativeSettingsPages.swift のモデルをそのまま使う。返事の形は変えない）
//   iPhone では無理なもの（A4 の印刷・表でまとめて編集・レジ端末そのものの設定など）は「iPad・PC で設定してください」のカード
// スタッフ管理（/app/staff）は key "staff"（戻る＝ホーム）。中身は同じ画面（NPSStaffPage）

/// GET ?part=settings（iPad の設定と同じ。使うところだけ：お店の設定のまとめ hubs・レジの設定の項目 sections）
struct NPSHubPayload: Decodable {
    let store: NFNamed
    let sections: [NSTSection]
    let hubs: [NSTHub]
}

/// 設定の中の画面（Web の道 → 画面）
enum NPSPage: String, CaseIterable, Identifiable {
    case store, clerks, tableQr, hours, company, businessCards
    case soldOut, menu, plans, options, categories, menuBook, qrService, menuBulk, dynamicPricing, menuScan
    case registerSettings, printers, devices, displays, handyQr, handy
    case reservationBook, booking, tables, staff
    case payments, tax, accounts, approvals
    case loyalty, alerts, dataImport, integrations, audit, summary
    var id: String { rawValue }

    var path: String {
        switch self {
        case .store: return "/app/settings/store"
        case .clerks: return "/app/settings/clerks"
        case .tableQr: return "/app/settings/tables/qr-print"
        case .hours: return "/app/settings/hours"
        case .company: return "/app/settings/company"
        case .businessCards: return "/app/settings/store/business-cards"
        case .soldOut: return "/app/pos/sold-out"
        case .menu: return "/app/settings/menu"
        case .plans: return "/app/settings/plans"
        case .options: return "/app/settings/options"
        case .categories: return "/app/settings/categories"
        case .menuBook: return "/app/settings/menu-book"
        case .qrService: return "/app/settings/qr-service"
        case .menuBulk: return "/app/settings/menu-bulk"
        case .dynamicPricing: return "/app/settings/dynamic-pricing"
        case .menuScan: return "/app/settings/menu/scan"
        case .registerSettings: return "/app/pos/settings"
        case .printers: return "/app/settings/printers"
        case .devices: return "/app/settings/devices"
        case .displays: return "/app/settings/displays"
        case .handyQr: return "/app/settings/handy-qr"
        case .handy: return "/app/settings/handy"
        case .reservationBook: return "/app/settings/reservation-book"
        case .booking: return "/app/settings/booking"
        case .tables: return "/app/settings/tables"
        case .staff: return "/app/staff"
        case .payments: return "/app/settings/payments"
        case .tax: return "/app/settings/tax"
        case .accounts: return "/app/settings/accounts"
        case .approvals: return "/app/settings/approvals"
        case .loyalty: return "/app/settings/loyalty"
        case .alerts: return "/app/settings/alerts"
        case .dataImport: return "/app/settings/import"
        case .integrations: return "/app/settings/integrations"
        case .audit: return "/app/settings/audit"
        case .summary: return "/app/settings/summary"
        }
    }

    var title: String {
        switch self {
        case .store: return "店舗情報"
        case .clerks: return "POS担当者"
        case .tableQr: return "テーブルQRコード"
        case .hours: return "営業時間・休業日"
        case .company: return "企業情報"
        case .businessCards: return "店舗名刺"
        case .soldOut: return "品切れ"
        case .menu: return "メニュー"
        case .plans: return "プラン"
        case .options: return "オプション"
        case .categories: return "カテゴリ"
        case .menuBook: return "メニューブック"
        case .qrService: return "QRのサービス"
        case .menuBulk: return "一括編集"
        case .dynamicPricing: return "ダイナミックプライシング"
        case .menuScan: return "写真・PDFからメニュー"
        case .registerSettings: return "レジの設定"
        case .printers: return "ハードウェア"
        case .devices: return "レジ端末（iPad）"
        case .displays: return "ディスプレイ端末"
        case .handyQr: return "iPhoneハンディ"
        case .handy: return "ハンディ端末"
        case .reservationBook: return "予約台帳設定"
        case .booking: return "予約受付ルール"
        case .tables: return "テーブル・フロア"
        case .staff: return "スタッフ管理"
        case .payments: return "決済・端末"
        case .tax: return "税率"
        case .accounts: return "勘定科目"
        case .approvals: return "承認ルール"
        case .loyalty: return "会員・ポイント"
        case .alerts: return "異常検知の閾値"
        case .dataImport: return "データ取込"
        case .integrations: return "連携"
        case .audit: return "監査ログ"
        case .summary: return "集計"
        }
    }

    var icon: String {
        switch self {
        case .store: return "storefront"
        case .clerks: return "person.2"
        case .tableQr: return "qrcode"
        case .hours: return "clock"
        case .company: return "building.2"
        case .businessCards: return "person.text.rectangle"
        case .soldOut: return "nosign"
        case .menu: return "fork.knife"
        case .plans: return "list.bullet.rectangle"
        case .options: return "slider.horizontal.3"
        case .categories: return "square.grid.2x2"
        case .menuBook: return "book"
        case .qrService: return "qrcode.viewfinder"
        case .menuBulk: return "tablecells"
        case .dynamicPricing: return "yensign.circle"
        case .menuScan: return "doc.viewfinder"
        case .registerSettings: return "ipad"
        case .printers: return "printer"
        case .devices: return "ipad.landscape"
        case .displays: return "tv"
        case .handyQr: return "qrcode"
        case .handy: return "iphone"
        case .reservationBook: return "calendar.badge.clock"
        case .booking: return "calendar"
        case .tables: return "rectangle.split.3x3"
        case .staff: return "person.badge.key"
        case .payments: return "creditcard"
        case .tax: return "percent"
        case .accounts: return "list.number"
        case .approvals: return "checkmark.seal"
        case .loyalty: return "star"
        case .alerts: return "bell.badge"
        case .dataImport: return "square.and.arrow.down"
        case .integrations: return "link"
        case .audit: return "doc.text.magnifyingglass"
        case .summary: return "chart.bar"
        }
    }

    /// iPhone でできない理由（nil＝iPhone の画面がある）。Web には行かず、このことばのカードを出す
    var unavailableReason: String? {
        switch self {
        case .tableQr: return "テーブルQRコードは A4 にまとめて印刷するため、iPad のレジ（設定 › テーブルQRコード）か PC の管理画面で印刷してください。"
        case .businessCards: return "店舗名刺は A4 に 10 枚並べて印刷するため、iPad のレジか PC の管理画面で印刷してください。"
        case .menuBook: return "カテゴリの順番・ページのまとめ方・プランで出すカテゴリは、並べ替えが多く画面の広い iPad・PC で設定してください。"
        case .menuBulk: return "一括編集は商品を表でまとめて変える画面です。iPad・PC で開いてください。iPhone では「メニュー」から 1 品ずつ値段・表示を変えられます。"
        case .dynamicPricing: return "曜日・時間帯ごとの値段の表は、iPad・PC で設定してください。"
        case .menuScan: return "写真・PDF からまとめて登録するときは、読み取った商品を大きい画面で確かめるため、iPad・PC で行ってください。"
        case .registerSettings: return "レジの設定はレジの iPad そのものの設定です。iPad のレジの「設定」から変えてください。"
        case .printers: return "プリンターをつなぐのはレジの iPad（Bluetooth）か、PC の管理画面（LAN・Wi-Fi）です。iPhone からはつなぎません。"
        case .devices: return "レジ端末（iPad）ごとの設定は、PC の管理画面で行ってください。"
        case .displays: return "ディスプレイ端末の設定は、iPad・PC で行ってください。"
        case .accounts: return "勘定科目の表は、PC の管理画面（会計）で編集してください。"
        case .dataImport: return "CSV ファイルからの取込は、ファイルを選べる PC で行ってください。"
        case .summary: return "集計の入口はレジの iPad 用です。iPhone ではホームの「メニュー」から各画面を開けます。"
        default: return nil
        }
    }

    /// 別の道で同じ画面（Web が redirect している道・クエリ付き）
    static func from(path raw: String) -> NPSPage? {
        let p = raw.count > 1 && raw.hasSuffix("/") ? String(raw.dropLast()) : raw
        if let hit = allCases.first(where: { $0.path == p }) { return hit }
        if p == "/app/menu/summary" { return .summary }
        // /app/settings/menu-book/… ・/app/settings/tables/… など、下の道は上の画面で
        return allCases.filter { p.hasPrefix($0.path + "/") }.max(by: { $0.path.count < $1.path.count })
    }
}

// MARK: - 入口（key "settings"）

@MainActor
final class NPSHubModel: ObservableObject {
    @Published var payload: NPSHubPayload?
    @Published var error: String?
    @Published var loading = false

    init() {
        payload = NativeModuleAPI.cached(NPSHubPayload.self, part: "settings")
    }

    func refresh() async {
        if NativePreview.current != nil { return }
        loading = true
        defer { loading = false }
        do {
            payload = try await NativeModuleAPI.get(NPSHubPayload.self, part: "settings")
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) }
        }
    }

    struct HubItem: Identifiable, Hashable {
        let id: String
        let title: String
        let page: NPSPage?
        let locked: String?
    }

    struct HubGroup: Identifiable, Hashable {
        let id: String
        let label: String
        let icon: String
        var items: [HubItem]
    }

    /// Web の設定のまとめ（hubs）を土台に、レジの設定の項目で同じ画面が無いもの（品切れなど）だけ足す。iPad の設定と同じ並び
    var groups: [HubGroup] {
        guard let p = payload else { return [] }
        func path(_ url: String) -> String { String(url.split(separator: "?", maxSplits: 1).first ?? Substring(url)) }
        var out: [HubGroup] = p.hubs.map { h in
            HubGroup(id: h.href, label: h.label, icon: Self.hubIcon(h.label), items: h.children
                .filter { path($0.href) != "/app/pos/settings" }
                .map { HubItem(id: path($0.href), title: $0.label, page: NPSPage.from(path: path($0.href)), locked: nil) })
        }
        var seen = Set(out.flatMap { $0.items.map(\.id) })
        for s in p.sections {
            for l in s.links where !seen.contains(path(l.url)) && path(l.url) != "/app/pos/settings" {
                seen.insert(path(l.url))
                let item = HubItem(id: path(l.url), title: l.title, page: NPSPage.from(path: path(l.url)), locked: l.allowed ? nil : (l.hint ?? "権限がありません"))
                let label = Self.hubLabel(forSection: s.id)
                if let i = out.firstIndex(where: { $0.label == label }) {
                    if l.id == "sold-out" { out[i].items.insert(item, at: 0) } else { out[i].items.append(item) }
                } else {
                    out.append(HubGroup(id: "section:\(s.id)", label: s.title, icon: "slider.horizontal.3", items: [item]))
                }
            }
        }
        return out.filter { !$0.items.isEmpty }
    }

    static func hubLabel(forSection id: String) -> String {
        switch id {
        case "menu", "kitchen": return "メニュー"
        case "tables": return "店舗"
        case "handy": return "デバイス管理"
        case "booking": return "予約・顧客"
        default: return ""
        }
    }

    static func hubIcon(_ label: String) -> String {
        switch label {
        case "店舗": return "storefront"
        case "メニュー": return "fork.knife"
        case "デバイス管理": return "iphone"
        case "予約・顧客": return "calendar"
        case "会計": return "creditcard"
        case "運用・管理": return "gearshape"
        case "集計": return "chart.bar"
        default: return "square.grid.2x2"
        }
    }
}

/// key "settings" の画面（NativePhoneOwnerScreen から）。/app/settings/<画面> で来たらその画面を開いた状態で出す（戻る＝設定の入口）
struct NativePhoneOwnerSettingsScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var hub = NPSHubModel()
    @State private var page: NPSPage?

    init(route: NativeModuleRoute) {
        self.route = route
        let p = NPSPage.from(path: route.url.path)
        // レジの設定（/app/pos/settings）・設定の入口（/app/settings・/app/settings-all）は入口を出す
        _page = State(initialValue: p == .registerSettings ? nil : p)
    }

    var body: some View {
        ZStack {
            NPSHubView(model: hub, onBack: { state.closePhoneOwnerModule() }, onOpen: { p in page = p })
            if let p = page {
                NPSPageView(page: p, backLabel: "設定", onBack: { page = nil }, onOpenPage: { page = $0 }, onOpenPath: { state.leaveNativePhone(to: $0) })
                    .id(p)
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.22), value: page)
    }
}

/// key "staff" の画面（/app/staff。戻る＝ホーム）
struct NativePhoneOwnerStaffScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    var body: some View {
        NPSStaffPage(backLabel: "ホーム", onBack: { state.closePhoneOwnerModule() })
    }
}

/// 設定の中の画面を 1 つ出す（iPhone の画面がないものは「iPad・PC で設定してください」）
struct NPSPageView: View {
    let page: NPSPage
    var backLabel = "設定"
    let onBack: () -> Void
    var onOpenPage: (NPSPage) -> Void = { _ in }
    /// 設定の外の画面へ（ネイティブの画面があるものだけ。Web には行かない）
    var onOpenPath: (String) -> Void = { _ in }

    var body: some View {
        switch page {
        case .store: NPSStorePage(backLabel: backLabel, onBack: onBack, onOpenPage: onOpenPage)
        case .hours: NPSHoursPage(backLabel: backLabel, onBack: onBack)
        case .company: NPSCompanyPage(backLabel: backLabel, onBack: onBack)
        case .clerks: NPSClerksPage(backLabel: backLabel, onBack: onBack)
        case .staff: NPSStaffPage(backLabel: backLabel, onBack: onBack)
        case .soldOut: NPSSoldOutPage(backLabel: backLabel, onBack: onBack)
        case .menu: NPSMenuItemsPage(mode: .menu, backLabel: backLabel, onBack: onBack)
        case .plans: NPSMenuItemsPage(mode: .plan, backLabel: backLabel, onBack: onBack)
        case .options: NPSOptionsPage(backLabel: backLabel, onBack: onBack)
        case .categories: NPSCategoriesPage(backLabel: backLabel, onBack: onBack)
        case .qrService: NPSQrServicePage(backLabel: backLabel, onBack: onBack)
        case .handyQr: NPSHandyQrPage(backLabel: backLabel, onBack: onBack)
        case .handy: NPSHandyDevicesPage(backLabel: backLabel, onBack: onBack)
        case .reservationBook: NPSReservationBookPage(backLabel: backLabel, onBack: onBack, onOpenPage: onOpenPage, onOpenPath: onOpenPath)
        case .booking: NPSBookingPage(backLabel: backLabel, onBack: onBack, onOpenPage: onOpenPage)
        case .tables: NPSTablesPage(backLabel: backLabel, onBack: onBack, onOpenPage: onOpenPage)
        case .payments: NPSPaymentsPage(backLabel: backLabel, onBack: onBack)
        case .tax: NPSTaxPage(backLabel: backLabel, onBack: onBack)
        case .approvals: NPSApprovalsPage(backLabel: backLabel, onBack: onBack)
        case .loyalty: NPSLoyaltyPage(backLabel: backLabel, onBack: onBack)
        case .alerts: NPSAlertsPage(backLabel: backLabel, onBack: onBack)
        case .integrations: NPSIntegrationsPage(backLabel: backLabel, onBack: onBack, onOpenPage: onOpenPage, onOpenPath: onOpenPath)
        case .audit: NPSAuditPage(backLabel: backLabel, onBack: onBack)
        default: NPSUnavailablePage(page: page, backLabel: backLabel, onBack: onBack)
        }
    }
}

// MARK: - 入口の画面

struct NPSHubView: View {
    @ObservedObject var model: NPSHubModel
    let onBack: () -> Void
    let onOpen: (NPSPage) -> Void
    @State private var toast: String?

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "設定", subtitle: model.payload?.store.name ?? "Settings", onBack: onBack, trailing: {
                NPZRefreshButton(loading: model.loading) { Task { await model.refresh() } }
            }, content: {
                NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.refresh() }) {
                    ForEach(model.groups) { g in group(g) }
                    Text("TENPO ONE \(AppConfig.version)").font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3)
                        .frame(maxWidth: .infinity).padding(.top, 8)
                }
            })
            NPHToast(text: $toast)
        }
        .animation(.easeOut(duration: 0.18), value: toast)
        .task { await model.refresh() }
    }

    private func group(_ g: NPSHubModel.HubGroup) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: g.icon).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Text(g.label).font(.system(size: 13, weight: .heavy)).foregroundColor(NT.ink3)
            }
            .padding(.leading, 6)
            VStack(spacing: 0) {
                ForEach(Array(g.items.enumerated()), id: \.element.id) { i, it in
                    row(it)
                    if i < g.items.count - 1 { NPZDivider(inset: 58) }
                }
            }
            .background(npocCard())
        }
    }

    private func row(_ it: NPSHubModel.HubItem) -> some View {
        let page = it.page
        let iPadOnly = page?.unavailableReason != nil
        return Button {
            if let locked = it.locked { toast = locked; return }
            if let page { onOpen(page) } else { toast = "この画面は iPad・PC で開いてください" }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: it.locked != nil ? "lock" : (page?.icon ?? "square.grid.2x2"))
                    .font(.system(size: 15, weight: .semibold)).foregroundColor(it.locked != nil ? NT.ink3 : NT.purple)
                    .frame(width: 34, height: 34)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(it.locked != nil ? NT.page : NT.lilac))
                VStack(alignment: .leading, spacing: 1) {
                    Text(it.title).font(.system(size: 16, weight: .bold)).foregroundColor(it.locked != nil ? NT.ink3 : NT.ink).lineLimit(1)
                    if let locked = it.locked { Text(locked).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1) }
                }
                Spacer(minLength: 6)
                if iPadOnly || page == nil {
                    Text("iPad・PC").font(.system(size: 10.5, weight: .heavy)).foregroundColor(NT.ink3)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .overlay(Capsule().stroke(NT.line, lineWidth: 1))
                }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 12).frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.99))
    }
}

// MARK: - iPhone ではできない画面

struct NPSUnavailablePage: View {
    let page: NPSPage
    var backLabel = "設定"
    let onBack: () -> Void

    var body: some View {
        NPOCDetailFrame(title: page.title, backLabel: backLabel, onBack: onBack, trailing: { EmptyView() }) {
            ScrollView {
                NPSIPadCard(title: "iPad・PC で設定してください", message: page.unavailableReason ?? "この設定は iPad・PC で行ってください。", icon: page.icon)
                    .padding(14)
            }
        }
    }
}

/// 「iPad・PC で設定してください」のカード（画面の一部だけ iPhone でできないときにも使う）
struct NPSIPadCard: View {
    var title = "iPad・PC で設定してください"
    let message: String
    var icon = "ipad.and.iphone"

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 30, weight: .semibold)).foregroundColor(NT.purple)
                .frame(width: 64, height: 64)
                .background(Circle().fill(NT.lilac))
            Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).multilineTextAlignment(.center)
            Text(message).font(.system(size: 13.5)).foregroundColor(NT.ink2).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 14) {
                Label("iPad のレジ", systemImage: "ipad")
                Label("PC の管理画面", systemImage: "desktopcomputer")
            }
            .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(.vertical, 26).padding(.horizontal, 18)
        .frame(maxWidth: .infinity)
        .background(npocCard())
    }
}

// MARK: - 設定の中の画面の部品（iPhone）

/// 設定の中の画面の枠：ネイビーの上のバー（「設定」に戻る）・読み込み中／エラー・引っぱって読み直す・下の知らせ
struct NPSPageFrame<Trailing: View, Content: View>: View {
    let title: String
    var subtitle: String = ""
    var backLabel: String = "設定"
    let loaded: Bool
    let error: String?
    @Binding var toast: String?
    let onBack: () -> Void
    let retry: () async -> Void
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOCDetailFrame(title: title, subtitle: subtitle, backLabel: backLabel, onBack: onBack, trailing: trailing) {
                NPOCBody(loaded: loaded, error: error, retry: retry, content: content)
            }
            NPHToast(text: $toast)
        }
        .animation(.easeOut(duration: 0.18), value: toast)
    }
}

extension NPSPageFrame where Trailing == EmptyView {
    init(title: String, subtitle: String = "", backLabel: String = "設定", loaded: Bool, error: String?, toast: Binding<String?>,
         onBack: @escaping () -> Void, retry: @escaping () async -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, backLabel: backLabel, loaded: loaded, error: error, toast: toast,
                  onBack: onBack, retry: retry, trailing: { EmptyView() }, content: content)
    }
}

/// 入力欄（見出し・白い角丸。数字・メール・複数行）
struct NPSInput: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var keyboard: UIKeyboardType = .default
    var enabled = true
    var suffix = ""
    var multiline = false
    var required = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                if required { Text("必須").font(.system(size: 9.5, weight: .heavy)).foregroundColor(.white).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(NT.danger)) }
            }
            .padding(.leading, 4)
            HStack(spacing: 6) {
                if multiline {
                    TextField(placeholder, text: $text, axis: .vertical).lineLimit(2...6)
                } else {
                    TextField(placeholder, text: $text).keyboardType(keyboard)
                        .textInputAutocapitalization(keyboard == .emailAddress || keyboard == .URL ? .never : .sentences)
                        .autocorrectionDisabled(keyboard == .emailAddress || keyboard == .URL)
                }
                if !suffix.isEmpty { Text(suffix).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3) }
            }
            .font(.system(size: 16)).foregroundColor(enabled ? NT.ink : NT.ink3)
            .disabled(!enabled)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(enabled ? Color.white : NT.page))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }
}

/// スイッチの行（白いカードの中）
struct NPSToggleRow: View {
    let title: String
    var sub: String = ""
    @Binding var isOn: Bool
    var disabled = false

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
                if !sub.isEmpty { Text(sub).font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
            }
        }
        .tint(NT.purple)
        .disabled(disabled)
        .padding(.vertical, 4)
    }
}

/// 折り返して並ぶ選択の札（種別・税率・ロールなど）
struct NPSChoice: View {
    let options: [(String, String)]
    let selection: String
    var disabled = false
    let onSelect: (String) -> Void

    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                let on = o.0 == selection
                Button { onSelect(o.0) } label: {
                    Text(o.1).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NT.ink2)
                        .padding(.horizontal, 13).frame(height: 38)
                        .background(Capsule().fill(on ? NT.purple : Color.white))
                        .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(disabled)
            }
        }
        .opacity(disabled ? 0.6 : 1)
    }
}

/// 小さい札（全店共通・非表示・既定 など）
struct NPSTag: View {
    let text: String
    var color: Color = NT.ink3
    var body: some View {
        Text(text).font(.system(size: 10.5, weight: .heavy)).foregroundColor(color).lineLimit(1)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .overlay(Capsule().stroke(color.opacity(0.5), lineWidth: 1))
    }
}

/// 鍵の注意（見るだけのとき）
struct NPSLockNote: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "lock").font(.system(size: 12, weight: .bold))
            Text(text).font(.system(size: 12.5)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundColor(NT.ink2)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }
}

/// 時刻を選ぶ（未設定・00:00〜 15 分刻み）
struct NPSTimeMenu: View {
    let value: String?
    let options: [String]
    var disabled = false
    let pick: (String?) -> Void

    var body: some View {
        Menu {
            Button("未設定") { pick(nil) }
            ForEach(options, id: \.self) { o in Button(o) { pick(o) } }
        } label: {
            HStack(spacing: 4) {
                Text(value ?? "--:--").font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(value == nil ? NT.ink3 : NT.ink)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 9).frame(height: 38).frame(minWidth: 78)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(disabled ? NT.page : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .disabled(disabled)
        .opacity(disabled ? 0.55 : 1)
    }
}

/// 設定の中の画面の読み込み（見本のときは通信しない）
enum NPS {
    static var preview: Bool { NativePreview.current != nil }

    /// 0 なら小数なし（10 → "10"、8.5 → "8.5"）
    static func num(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }

    /// ISO → 10/25 12:34（日本時間）
    static func mdhm(_ iso: String?) -> String {
        guard let iso, let d = NPOCFmt.date(iso) else { return "—" }
        let f = DateFormatter()
        f.dateFormat = "M/d HH:mm"
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        return f.string(from: d)
    }

    /// QR の絵
    static func qrImage(_ s: String, scale: CGFloat = 10) -> UIImage? {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        f.setValue(Data(s.utf8), forKey: "inputMessage")
        f.setValue("M", forKey: "inputCorrectionLevel")
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
