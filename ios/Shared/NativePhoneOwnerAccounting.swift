import SwiftUI
import UIKit

// iPhone の店長・オーナー：会計（ネイティブ）。Web の /app/accounting（仕訳）・/ledger（帳簿）・/statements（財務レポート）・
// /banks（銀行口座・CSV取込）・/auto（自動仕訳）・/assets（固定資産）と同じ中身・同じ操作（2026-10-25 Ronnie「101% native」）。
//   上：画面の切り替え（仕訳・月次締め・帳簿・財務レポート・銀行口座・自動仕訳・固定資産）。iPhone の幅に合わせて月次締めは別の画面
//   ?source_type=…&source_id=…（給与・発注・請求書の「仕訳を見る」）は、その元取引の仕訳だけを全期間で出す
//   締め・確定・削除・取消など戻せない操作は必ず確認（confirmationDialog ／ 理由の入力）
//   CSV 出力は iOS の共有シート（この画面の中の小さな部品 NPACShare。iPad の部品は使わない）
// サーバーは iPad と同じ：GET part=accounting&view=… ／ POST acc*（lib/native-modules/accounting.ts。返事の形は変えない）
// iPad の画面・型は使わない（iPad を壊さない）。会計連携（freee など）の中身は別のチーム。
// ファイル：NativePhoneOwnerAccounting（共通）・…AccountingJournal（仕訳・月次締め）・…AccountingForms（入力のシート）・…AccountingBooks（帳簿・財務レポート）・
//          …AccountingBanks（銀行口座・CSV取込）・…AccountingAuto（自動仕訳・固定資産）・…AccountingPreview（見本）

// MARK: - 共通の中身（サーバーの返事）

struct NPACStore: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NPACOption: Decodable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct NPACAccountRef: Decodable, Hashable, Identifiable {
    let id: String
    let code: String
    let name: String
}

struct NPACRange: Decodable, Hashable {
    let from: String
    let to: String
}

struct NPACFailed: Decodable, Hashable {
    let key: String
    let reason: String
}

struct NPACCreateResult: Decodable, Hashable {
    let created: Int
    let skipped: Int
    let failed: [NPACFailed]

    /// Web の toast と同じ「作成 n件 / スキップ（作成済み） n件 / 失敗 n件」
    var message: String {
        var parts = ["作成 \(created)件"]
        if skipped > 0 { parts.append("スキップ（作成済み） \(skipped)件") }
        if !failed.isEmpty { parts.append("失敗 \(failed.count)件") }
        return parts.joined(separator: " / ")
    }
}

struct NPACCreateResponse: Decodable {
    let result: NPACCreateResult
}

// MARK: - 読み込み・操作

enum NPACApi {
    static func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        try await NativeModuleAPI.get(T.self, part: "accounting", query: query)
    }

    static func cached<T: Decodable>(_ type: T.Type, _ query: [String: String]) -> T? {
        NativeModuleAPI.cached(T.self, part: "accounting", query: query)
    }

    /// POST して中身を読む（ok:false はサーバーのことばを投げる）
    static func post<R: Decodable>(_ body: [String: Any], as type: R.Type) async throws -> R {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await NativeAPI.shared.send(req, kickPrint: false)
        let head = try JSONDecoder().decode(NativeModuleOK.self, from: data)
        if !head.ok { throw NativeAPIError(message: head.error ?? "保存できませんでした", useWeb: false) }
        return try JSONDecoder().decode(R.self, from: data)
    }

    /// POST（結果の中身はいらないもの）。見本のときは送らない
    static func send(_ body: [String: Any]) async throws {
        if NativePreview.current != nil { return }
        try await NativeModuleAPI.post(body)
    }
}

/// 会計の各画面の読み込み（前の中身を先に出す・見本のときは見本の中身）
@MainActor
final class NPACLoader<T: Decodable>: ObservableObject {
    @Published var data: T?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var loading = false
    /// 最初の読み込みで「Web で」と言われた（本社経理など pos.order の無い役割）→ この画面を閉じて裏の Web を見せる
    @Published var useWeb = false

    func load(_ query: [String: String]) async {
        if NativePreview.current != nil {
            if let o = NPACSamples.object("accounting", query), let d = NOS.decode(T.self, o) { data = d }
            return
        }
        if data == nil, let saved = NPACApi.cached(T.self, query) { data = saved }
        loading = true
        defer { loading = false }
        do {
            data = try await NPACApi.get(T.self, query)
            error = nil
        } catch {
            if data == nil && NPACText.wantsWeb(error) { useWeb = true }
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 操作（成功なら true。done があれば下に出す）
    @discardableResult
    func act(_ body: [String: Any], done: String? = nil) async -> Bool {
        if NativePreview.current != nil {
            if let done { toast = done }
            return true
        }
        busy = true
        defer { busy = false }
        do {
            try await NativeModuleAPI.post(body)
            if let done { toast = done }
            return true
        } catch {
            self.error = NativeModuleAPI.message(error)
            return false
        }
    }

    /// 結果のある操作（一括作成）
    func actResult<R: Decodable>(_ body: [String: Any], as type: R.Type) async -> R? {
        if NativePreview.current != nil { return nil }
        busy = true
        defer { busy = false }
        do {
            return try await NPACApi.post(body, as: R.self)
        } catch {
            self.error = NativeModuleAPI.message(error)
            return nil
        }
    }

    /// 理由のシートに返すエラー（下の帯には出さない）
    func takeError(_ fallback: String) -> String {
        let e = error ?? fallback
        error = nil
        return e
    }
}

/// CSV・PDF を iOS の共有シートで渡す（iPhone の会計・請求書の中だけで使う小さな部品）
enum NPACShare {
    /// Web の「CSV出力」と同じ道のファイルを取ってきて共有シートへ
    @MainActor
    static func csv(_ path: String, name: String, onError: @escaping (String) -> Void) {
        if NativePreview.current != nil { onError("見本では CSV を出せません"); return }
        Task { @MainActor in
            do {
                let data = try await NativeAPI.shared.download(path)
                guard let url = tempFile(name, data: data) else { onError("CSV を保存できませんでした"); return }
                present(url)
            } catch {
                onError(NativeModuleAPI.message(error))
            }
        }
    }

    static func tempFile(_ name: String, data: Data) -> URL? {
        let safe = name.replacingOccurrences(of: "[/:\\\\]", with: "_", options: .regularExpression)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe.isEmpty ? "file" : safe)
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    @MainActor
    static func present(_ url: URL) {
        guard let top = topController() else { return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: 80, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        top.present(vc, animated: true)
    }

    @MainActor
    static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first,
              var top = window.rootViewController else { return nil }
        while let presented = top.presentedViewController { top = presented }
        return top
    }
}

// MARK: - 字の出し方

enum NPACText {
    /// 「すべての期間」（元取引の仕訳を全期間で出すときの開始日）
    static let allFrom = "2000-01-01"

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// 最初の読み込みのエラーが「Web の画面で」の意味か（サーバーの useWeb・アプリの API を使えない役割＝route.ts の「権限がありません」）
    static func wantsWeb(_ error: Error) -> Bool {
        guard let e = error as? NativeAPIError else { return false }
        return e.useWeb || e.message == "権限がありません"
    }

    /// 'YYYY-MM-DD' → 'YYYY/MM/DD'（空は '—'）
    static func date(_ s: String?) -> String {
        guard let s, !s.isEmpty, s != "—" else { return "—" }
        return String(s.prefix(10)).replacingOccurrences(of: "-", with: "/")
    }

    /// 'YYYY-MM' → 'YYYY年M月'
    static func monthLabel(_ ym: String) -> String { NOS.ymLabel(ym) }

    /// 金額の入力（カンマ・円記号・全角を除いて整数。読めなければ 0）
    static func amount(_ s: String) -> Int {
        guard let v = NOS.num(s.replacingOccurrences(of: "¥", with: "").replacingOccurrences(of: "円", with: "")) else { return 0 }
        return Int(v.rounded())
    }

    /// 期間の字（すべての期間・10/1〜10/25・2025/12/1〜2026/1/31）
    static func period(_ from: String, _ to: String) -> String {
        if from <= allFrom { return "すべての期間" }
        return NOM.period(from, to)
    }

    /// 元取引の仕訳（?source_id=）は期間を指定していなければ全期間で出す（給与の月・請求書の月が今月でなくても見える）
    static func widen(_ page: NPACPage, _ q: [String: String]) -> [String: String] {
        guard page == .journal, let sid = q["source_id"], !sid.isEmpty, (q["from"] ?? "").isEmpty else { return q }
        var out = q
        out["from"] = allFrom
        if (out["to"] ?? "").isEmpty { out["to"] = NOS.addDays(NOS.today, 400) }
        return out
    }

    /// 「現金」「現金 ほか2件」
    static func summary(_ lines: [NPACJournalLine], _ side: String) -> String {
        let s = lines.filter { $0.side == side }
        guard let first = s.first else { return "—" }
        return s.count > 1 ? "\(first.accountName) ほか\(s.count - 1)件" : first.accountName
    }

    static func statusColor(_ s: String) -> Color {
        switch s {
        case "posted", "closed", "in_use": return NT.ok
        case "voided", "deleted": return NT.danger
        case "sold": return NT.purple
        default: return NT.ink3
        }
    }

    /// 「10/25 18:30（山田）」
    static func actor(_ at: String?, _ name: String?) -> String {
        guard let at else { return "—" }
        if let name, !name.isEmpty { return "\(at)（\(name)）" }
        return at
    }
}

// MARK: - 画面の切り替え

enum NPACPage: String, CaseIterable, Identifiable {
    case journal, periods, ledger, statements, banks, auto, assets

    var id: String { rawValue }

    var label: String {
        switch self {
        case .journal: return "仕訳"
        case .periods: return "月次締め"
        case .ledger: return "帳簿"
        case .statements: return "財務レポート"
        case .banks: return "銀行口座"
        case .auto: return "自動仕訳"
        case .assets: return "固定資産"
        }
    }

    var en: String {
        switch self {
        case .journal: return "Journal"
        case .periods: return "Closing"
        case .ledger: return "Ledger"
        case .statements: return "Statements"
        case .banks: return "Bank accounts"
        case .auto: return "Auto journal"
        case .assets: return "Fixed assets"
        }
    }

    var icon: String {
        switch self {
        case .journal: return "book"
        case .periods: return "lock"
        case .ledger: return "list.bullet.rectangle"
        case .statements: return "chart.bar.doc.horizontal"
        case .banks: return "building.columns"
        case .auto: return "wand.and.stars"
        case .assets: return "shippingbox"
        }
    }

    /// Web の道（?クエリ込み）→ 画面・クエリ（/app/accounting/banks/<id> は id）
    static func target(_ url: URL) -> (page: NPACPage, query: [String: String]) {
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let path = comps?.path ?? url.path
        let base = "/app/accounting"
        let rest = path.hasPrefix(base) ? String(path.dropFirst(base.count)) : ""
        let parts = rest.split(separator: "/").map(String.init)
        var q: [String: String] = [:]
        for item in comps?.queryItems ?? [] {
            if let v = item.value { q[item.name] = v }
        }
        let page: NPACPage
        switch parts.first ?? "" {
        case "ledger": page = .ledger
        case "statements": page = .statements
        case "banks":
            page = .banks
            if parts.count > 1 { q["id"] = parts[1] }
        case "auto": page = .auto
        case "assets": page = .assets
        case "periods": page = .periods
        default: page = .journal
        }
        return (page, q)
    }
}

/// 画面の中のリンク（会計の中ならこの画面の中で切り替え、ほかは Web の道で。ネイティブがあればネイティブで開く）
struct NPACNav {
    let page: NPACPage
    let open: (NPACPage, [String: String]) -> Void
    let leave: (String) -> Void
    let back: () -> Void
    /// この画面を閉じて裏の Web の画面を見せる（API を使えない役割のとき）
    let web: () -> Void

    func follow(_ href: String) {
        let path = href.split(separator: "?").first.map(String.init) ?? href
        if path == "/app/accounting" || path.hasPrefix("/app/accounting/"), !path.hasSuffix("/export"),
           let url = URL(string: href, relativeTo: AppConfig.url("/")) {
            let t = NPACPage.target(url.absoluteURL)
            open(t.page, t.query)
        } else {
            leave(href)
        }
    }
}

/// key "accounting" の画面（NativePhoneOwnerScreen から）
struct NativePhoneAccountingScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @State private var useWeb = false

    var body: some View {
        NPACRootView(route: route, onBack: { state.closePhoneOwnerModule() }, onLeave: { NPOCLink.open($0, state: state) }, onWeb: { useWeb = true })
            .modifier(NPOCWebFallback(key: "accounting", useWeb: useWeb, state: state))
    }
}

struct NPACRootView: View {
    let route: NativeModuleRoute
    let onBack: () -> Void
    let onLeave: (String) -> Void
    var onWeb: () -> Void = {}

    @State private var page: NPACPage
    @State private var query: [String: String]
    @State private var token = UUID()

    init(route: NativeModuleRoute, onBack: @escaping () -> Void, onLeave: @escaping (String) -> Void, onWeb: @escaping () -> Void = {}) {
        self.route = route
        self.onBack = onBack
        self.onLeave = onLeave
        self.onWeb = onWeb
        let t = NPACPage.target(route.url)
        _page = State(initialValue: t.page)
        _query = State(initialValue: NPACText.widen(t.page, t.query))
    }

    private var nav: NPACNav {
        NPACNav(page: page, open: { p, q in open(p, q) }, leave: onLeave, back: onBack, web: onWeb)
    }

    private func open(_ p: NPACPage, _ q: [String: String]) {
        page = p
        query = NPACText.widen(p, q)
        token = UUID()
    }

    var body: some View {
        content
            .id(token)
            .environment(\.colorScheme, .light)
            .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    @ViewBuilder private var content: some View {
        switch page {
        case .journal: NPACJournalPage(initial: query, nav: nav)
        case .periods: NPACPeriodsPage(initial: query, nav: nav)
        case .ledger: NPACLedgerPage(initial: query, nav: nav)
        case .statements: NPACStatementsPage(initial: query, nav: nav)
        case .banks: NPACBanksPage(initial: query, nav: nav)
        case .auto: NPACAutoPage(initial: query, nav: nav)
        case .assets: NPACAssetsPage(nav: nav)
        }
    }
}

// MARK: - 共通の部品

/// 会計の画面の枠（上のバー＝ネイビー・ホームへ・右のボタン ＋ 画面の切り替え）
struct NPACFrame<Trailing: View, Content: View>: View {
    let nav: NPACNav
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return NPOFrame(title: "会計", subtitle: "\(nav.page.label)・\(nav.page.en)", onBack: nav.back, trailing: trailing) {
            VStack(spacing: 0) {
                NPACSwitcher(current: nav.page) { p in nav.open(p, [:]) }
                inner.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

/// 仕訳・帳簿・財務レポート … の切り替え（横にスクロール）
struct NPACSwitcher: View {
    let current: NPACPage
    let onSelect: (NPACPage) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(NPACPage.allCases) { p in
                        Button { onSelect(p) } label: {
                            HStack(spacing: 5) {
                                Image(systemName: p.icon).font(.system(size: 12.5, weight: .bold))
                                Text(p.label).font(.system(size: 14, weight: NT.strong)).lineLimit(1)
                            }
                            .foregroundColor(p == current ? .white : NT.ink2)
                            .padding(.horizontal, 13).frame(height: 36)
                            .background(Capsule().fill(p == current ? NT.purple : Color.white))
                            .overlay(Capsule().stroke(p == current ? Color.clear : NT.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .id(p)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .onAppear { proxy.scrollTo(current, anchor: .center) }
        }
        .background(NT.page)
    }
}

/// 読み込み中・エラーの帯・下の知らせをそろえる
struct NPACPageShell<Content: View>: View {
    @Binding var error: String?
    @Binding var toast: String?
    let hasData: Bool
    /// 最初の読み込みで「Web で」と言われた → onWeb（裏の Web の画面を見せる）
    let useWeb: Bool
    let onWeb: () -> Void
    let retry: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                if hasData {
                    NOSErrorBar(error: $error)
                    content()
                } else {
                    NOSStateView(error: error, onRetry: retry)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            NPHToast(text: $toast)
        }
        .animation(.easeOut(duration: 0.18), value: toast)
        .onAppear { if useWeb { onWeb() } }
        .onChange(of: useWeb) { on in if on { onWeb() } }
    }
}

/// 期間（すべての期間・今月・先月 … ・期間を変える）
struct NPACPeriodBar: View {
    let from: String
    let to: String
    var showAll = false
    let onSet: (String, String) -> Void
    @State private var picking = false

    private var presets: [(String, String, String)] {
        let today = NOS.today
        let lastMonth = NOS.shiftMonth(String(today.prefix(7)), -1) + "-01"
        var list: [(String, String, String)] = [
            ("今月", NOS.monthFirst(today), today),
            ("先月", lastMonth, NOS.monthLast(lastMonth)),
            ("過去30日", NOS.addDays(today, -30), today),
            ("今年", String(today.prefix(4)) + "-01-01", today),
        ]
        if showAll { list.append(("すべて", NPACText.allFrom, NOS.addDays(today, 400))) }
        return list
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                Text(NPACText.period(from, to)).font(.system(size: 16.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 4)
                Button { picking = true } label: {
                    Text("期間を変える").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(presets, id: \.0) { p in
                        NOMChip(title: p.0, on: p.1 == from && p.2 == to) { onSet(p.1, p.2) }
                    }
                }
                .padding(.vertical, 1)
            }
        }
        .padding(12)
        .background(npocCard(16))
        .sheet(isPresented: $picking) {
            NOMRangeSheet(from: from <= NPACText.allFrom ? NOS.monthFirst(NOS.today) : from, to: to, onClose: { picking = false }, onApply: { a, b in
                picking = false
                onSet(a, b)
            })
            .environment(\.colorScheme, .light)
        }
    }
}

/// 横にスクロールする丸い札の列（状態の絞り込み・帳簿の種類）
struct NPACChipScroll: View {
    let items: [(String, String)]
    let selection: String
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    NOMChip(title: it.1, on: it.0 == selection) { onSelect(it.0) }
                }
            }
            .padding(.vertical, 1)
        }
    }
}

/// 横に並べる選ぶボタン（はみ出したら横にスクロール）
struct NPACMenuRow<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { content() }.padding(.vertical, 1)
        }
    }
}

/// 小さい丸いボタン（CSV出力・前へ・次へ など）
struct NPACPill: View {
    let title: String
    var icon: String = ""
    var tint: Color = NT.purpleDeep
    var filled = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if !icon.isEmpty { Image(systemName: icon).font(.system(size: 12, weight: .bold)) }
                Text(title).font(.system(size: 13, weight: .bold)).lineLimit(1)
            }
            .foregroundColor(filled ? .white : tint)
            .padding(.horizontal, 13).frame(height: 34)
            .background(Capsule().fill(filled ? tint : (tint == NT.purpleDeep ? NT.lilac : tint.opacity(0.1))))
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }
}

/// チェック（取引・候補を選ぶ）
struct NPACCheck: View {
    let on: Bool
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: on ? "checkmark.square.fill" : "square")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(enabled ? NT.purple : NT.line)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

/// 名前と金額の 1 行
struct NPACMoneyRow: View {
    let label: String
    let value: Int
    var bold = false
    var tone: Color = NT.ink
    var indent: CGFloat = 0

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).font(.system(size: bold ? 14.5 : 13.5, weight: bold ? NT.strong : .regular)).foregroundColor(bold ? NT.ink : NT.ink2)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Text(NT.yen(value)).font(.system(size: bold ? 15 : 13.5, weight: bold ? NT.strong : .semibold)).foregroundColor(tone).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(.leading, indent)
        .padding(.vertical, 5)
    }
}

/// 勘定科目が未導入のときの案内（自動仕訳・銀行口座）
struct NPACInstallBanner: View {
    let busy: Bool
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NT.warn)
                Text("この企業には勘定科目がまだ導入されていません。標準の勘定科目テンプレート（現金・売上高・仕入高・給与手当 等）を導入すると自動仕訳が利用できます。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            }
            NPOCWideButton(text: "標準科目を導入する", icon: "square.and.arrow.down", kind: .primary, busy: busy, height: 44, action: action)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.warn.opacity(0.1)))
    }
}

/// 2 列のタイル
struct NPACTiles<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) { content() }
    }
}

/// 線
struct NPACDivider: View {
    var body: some View { Rectangle().fill(NT.line).frame(height: 1) }
}

/// 前へ・次へ（ページ送り）
struct NPACPager: View {
    let page: Int
    let totalPages: Int
    let caption: String
    let onGo: (Int) -> Void

    var body: some View {
        HStack(spacing: 8) {
            NPACPill(title: "前へ", icon: "chevron.left", enabled: page > 1) { onGo(page - 1) }
            Spacer(minLength: 4)
            VStack(spacing: 1) {
                Text("\(page) / \(totalPages)").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                Text(caption).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            NPACPill(title: "次へ", icon: "chevron.right", enabled: page < totalPages) { onGo(page + 1) }
        }
        .padding(.horizontal, 4)
    }
}
