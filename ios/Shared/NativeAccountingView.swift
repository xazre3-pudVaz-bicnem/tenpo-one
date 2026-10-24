import SwiftUI

// 会計のネイティブ。Web の /app/accounting（仕訳）・/ledger（帳簿）・/statements（財務レポート）・/banks（銀行口座・明細）・
// /auto（自動仕訳）・/assets（固定資産）と同じ中身・操作（lib/accounting-pages-server.ts・lib/native-modules/accounting.ts）。
// 2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」。
//   上：画面の切り替え（仕訳・帳簿・財務レポート・銀行口座・自動仕訳・固定資産）。Web の下の道（/app/accounting/banks/<id> など）は route.rest
//   CSV 出力は共有シート（ファイル・AirDrop・メール）、銀行明細の CSV 取込はこの iPad のファイルを選んでサーバーで読む
//   ファイル：NativeAccountingJournal（仕訳・月次締め）・NativeAccountingBooks（帳簿・財務レポート）・
//            NativeAccountingBanks（銀行口座・CSV取込）・NativeAccountingAuto（自動仕訳・固定資産）

// MARK: - 画面の切り替え

enum NAccPage: String, CaseIterable, Identifiable {
    case journal, ledger, statements, banks, auto, assets

    var id: String { rawValue }

    var label: String {
        switch self {
        case .journal: return "仕訳"
        case .ledger: return "帳簿"
        case .statements: return "財務レポート"
        case .banks: return "銀行口座"
        case .auto: return "自動仕訳"
        case .assets: return "固定資産"
        }
    }

    var icon: String {
        switch self {
        case .journal: return "book"
        case .ledger: return "list.bullet.rectangle"
        case .statements: return "chart.bar.doc.horizontal"
        case .banks: return "building.columns"
        case .auto: return "wand.and.stars"
        case .assets: return "shippingbox"
        }
    }

    /// Web の道の残り（/app/accounting/<rest>）→ 画面・銀行口座の id
    static func from(rest: String) -> (page: NAccPage, bankId: String?) {
        let parts = rest.split(separator: "/").map(String.init)
        switch parts.first ?? "" {
        case "ledger": return (.ledger, nil)
        case "statements": return (.statements, nil)
        case "banks": return (.banks, parts.count > 1 ? parts[1] : nil)
        case "auto": return (.auto, nil)
        case "assets": return (.assets, nil)
        default: return (.journal, nil)
        }
    }

    /// Web の道（?クエリ込み）→ 画面・クエリ
    static func target(url: URL) -> (page: NAccPage, query: [String: String]) {
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let path = comps?.path ?? url.path
        let rest = String(path.dropFirst(min(path.count, "/app/accounting".count))).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let t = from(rest: rest)
        var q: [String: String] = [:]
        for item in comps?.queryItems ?? [] {
            if let v = item.value { q[item.name] = v }
        }
        if let id = t.bankId { q["id"] = id }
        return (t.page, q)
    }
}

/// 画面の中のリンク（会計の中ならこの画面の中で切り替え、ほかの画面は Web の道で。ネイティブがあればネイティブで開く）
struct NAccNav {
    let open: (NAccPage, [String: String]) -> Void
    let leave: (String) -> Void

    func follow(_ href: String) {
        let path = href.split(separator: "?").first.map(String.init) ?? href
        if path == "/app/accounting" || path.hasPrefix("/app/accounting/"), let url = URL(string: href, relativeTo: AppConfig.url("/")) {
            let t = NAccPage.target(url: url.absoluteURL)
            open(t.page, t.query)
        } else {
            leave(href)
        }
    }
}

struct NativeAccountingView: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @State private var page: NAccPage
    @State private var query: [String: String]
    @State private var token = UUID()

    init(route: NativeModuleRoute) {
        self.route = route
        let t = NAccPage.target(url: route.url)
        _page = State(initialValue: t.page)
        _query = State(initialValue: t.query)
    }

    private var nav: NAccNav {
        NAccNav(open: { p, q in open(p, q) }, leave: { path in state.leaveNativeFloor(to: path) })
    }

    private func open(_ p: NAccPage, _ q: [String: String]) {
        page = p
        query = q
        token = UUID()
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "会計", subtitle: "", onHome: { state.goNativeHome() })
            switcher
            content
                .id(token)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(NT.page.ignoresSafeArea())
        .onChange(of: route) { r in
            let t = NAccPage.target(url: r.url)
            open(t.page, t.query)
        }
    }

    private var switcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(NAccPage.allCases) { p in
                    Button { open(p, [:]) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: p.icon).font(.system(size: 14, weight: .semibold))
                            Text(p.label).font(.system(size: 15, weight: .heavy))
                        }
                        .foregroundColor(page == p ? .white : NT.ink)
                        .padding(.horizontal, 14).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(page == p ? NT.purple : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(page == p ? Color.clear : NT.line, lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
    }

    @ViewBuilder private var content: some View {
        switch page {
        case .journal: NAccJournalPage(initial: query, nav: nav)
        case .ledger: NAccLedgerPage(initial: query, nav: nav)
        case .statements: NAccStatementsPage(initial: query, nav: nav)
        case .banks: NAccBanksPage(initial: query, nav: nav)
        case .auto: NAccAutoPage(initial: query, nav: nav)
        case .assets: NAccAssetsPage(nav: nav)
        }
    }
}

// MARK: - 読み込み・操作（GET part=accounting&view=… ／ POST acc*）

@MainActor
final class NAccLoader<T: Decodable>: ObservableObject {
    @Published var data: T?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var loading = false

    func load(_ query: [String: String]) async {
        if data == nil, let saved = NativeModuleAPI.cached(T.self, part: "accounting", query: query) { data = saved }
        loading = true
        defer { loading = false }
        do {
            data = try await NativeModuleAPI.get(T.self, part: "accounting", query: query)
            error = nil
        } catch {
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 操作（成功なら true。done があれば下に出す）
    @discardableResult
    func act(_ body: [String: Any], done: String? = nil) async -> Bool {
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

    /// 結果のある操作（一括作成・CSV取込）
    func actResult<R: Decodable>(_ body: [String: Any], as type: R.Type) async -> R? {
        busy = true
        defer { busy = false }
        do {
            return try await NAccAPI.post(body, as: R.self)
        } catch {
            self.error = NativeModuleAPI.message(error)
            return nil
        }
    }
}

enum NAccAPI {
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

    static func get<R: Decodable>(_ query: [String: String], as type: R.Type) async throws -> R {
        try await NativeModuleAPI.get(R.self, part: "accounting", query: query)
    }
}

/// CSV 出力（Web の「CSV出力」と同じファイルを共有シートへ）
enum NAccExport {
    @MainActor
    static func csv(_ path: String, name: String, onError: @escaping (String) -> Void) {
        Task { @MainActor in
            do {
                let data = try await NativeAPI.shared.download(path)
                if let url = NLShare.tempFile(name, data: data) { NLShare.present(url: url) } else { onError("CSV を保存できませんでした") }
            } catch {
                onError(NativeModuleAPI.message(error))
            }
        }
    }
}

// MARK: - 共通のデータ

struct NAccStore: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NAccOption: Decodable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct NAccAccountRef: Decodable, Hashable, Identifiable {
    let id: String
    let code: String
    let name: String
}

struct NAccRange: Decodable, Hashable {
    let from: String
    let to: String
}

struct NAccFailed: Decodable, Hashable {
    let key: String
    let reason: String
}

struct NAccCreateResult: Decodable, Hashable {
    let created: Int
    let skipped: Int
    let failed: [NAccFailed]

    /// Web の toast と同じ「作成 n件 / スキップ（作成済み） n件 / 失敗 n件」
    var message: String {
        var parts = ["作成 \(created)件"]
        if skipped > 0 { parts.append("スキップ（作成済み） \(skipped)件") }
        if !failed.isEmpty { parts.append("失敗 \(failed.count)件") }
        return parts.joined(separator: " / ")
    }
}

struct NAccCreateResponse: Decodable {
    let result: NAccCreateResult
}

enum NAccText {
    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// 'YYYY-MM-DD' → 'YYYY/MM/DD'（'—' はそのまま）
    static func date(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "—" }
        return NPDate.slash(s)
    }

    /// 'YYYY-MM' を delta ヶ月ずらす
    static func shiftMonth(_ ym: String, _ delta: Int) -> String {
        let parts = ym.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return ym }
        var total = parts[0] * 12 + (parts[1] - 1) + delta
        if total < 0 { total = 0 }
        return String(format: "%04d-%02d", total / 12, total % 12 + 1)
    }

    /// 'YYYY-MM' → 'YYYY年M月'
    static func monthLabel(_ ym: String) -> String {
        let parts = ym.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return ym }
        return "\(parts[0])年\(parts[1])月"
    }

    /// 金額の入力（カンマ・円記号を除いて整数）
    static func amount(_ s: String) -> Int {
        let cleaned = s.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: "¥", with: "").replacingOccurrences(of: "円", with: "")
        return Int((Double(trimmed(cleaned)) ?? 0).rounded())
    }
}

// MARK: - 共通の部品

/// 白いカード（見出しは任意）
struct NAccCard<Content: View>: View {
    var title: String? = nil
    var note: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    if let note { Text(note).font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                Rectangle().fill(NT.line).frame(height: 1)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

/// 画面の見出し（名前・説明・右のボタン）
struct NAccHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 8)
            trailing()
        }
    }
}

enum NAccButtonKind { case primary, secondary, danger, pay }

struct NAccButton: View {
    let text: String
    var icon: String? = nil
    var kind: NAccButtonKind = .secondary
    var busy = false
    var disabled = false
    let action: () -> Void

    private var fg: Color {
        switch kind {
        case .secondary: return NT.ink
        default: return .white
        }
    }

    private var bg: Color {
        switch kind {
        case .primary: return NT.purple
        case .secondary: return Color.white
        case .danger: return NFColor.danger
        case .pay: return NT.pay
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().tint(kind == .secondary ? NT.purple : .white).scaleEffect(0.8)
                } else if let icon {
                    Image(systemName: icon)
                }
                Text(text).lineLimit(1)
            }
            .font(.system(size: 14.5, weight: .bold))
            .foregroundColor(fg)
            .padding(.horizontal, 14).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(kind == .secondary ? NT.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.45 : 1)
    }
}

/// 行の中の小さいボタン（編集・確定・削除 …）
struct NAccSmallButton: View {
    let text: String
    var tint: Color = NT.ink2
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text).font(.system(size: 12.5, weight: .bold)).foregroundColor(tint)
                .padding(.horizontal, 10).frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.09)))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }
}

/// 絞り込みの1項目（上に小さい名前）
struct NAccField<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            content()
        }
    }
}

/// 日付（'YYYY-MM-DD' の文字で持つ）
struct NAccDate: View {
    @Binding var value: String

    var body: some View {
        DatePicker("", selection: Binding(get: { NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date)
            .labelsHidden()
            .environment(\.locale, Locale(identifier: "ja_JP"))
    }
}

/// 選ぶ（メニュー）
struct NAccMenu: View {
    let options: [NAccOption]
    @Binding var selection: String

    var body: some View {
        Picker("", selection: $selection) {
            ForEach(options) { o in Text(o.label).tag(o.value) }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(NT.ink)
    }
}

/// 絞り込みの帯（はみ出したら次の行へ）
struct NAccFilterBar<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        WrapLayout(spacing: 14) { content() }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

/// 読み込み中・読めなかったとき
struct NAccLoading: View {
    let error: String?
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            if let error {
                Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center)
                Button("もう一度", action: retry)
            } else {
                ProgressView("読み込み中…")
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(20)
    }
}

/// 何もないとき
struct NAccEmptyView: View {
    let title: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "tray").font(.system(size: 30)).foregroundColor(NT.ink3)
            Text(title).font(.system(size: 15.5, weight: .heavy)).foregroundColor(NT.ink)
            if let message { Text(message).font(.system(size: 13)).foregroundColor(NT.ink3).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 34)
        .padding(.horizontal, 16)
    }
}

/// 色つきの帯（注意・案内）
struct NAccNotice: View {
    let text: String
    var color: Color = NT.warn
    var icon: String = "exclamationmark.triangle.fill"

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.system(size: 13, weight: .bold))
            Text(text).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundColor(color)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(color.opacity(0.09)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(color.opacity(0.25), lineWidth: 1))
    }
}

/// 数字のタイル（財務レポート・銀行口座の上）
struct NAccStat: View {
    let label: String
    let value: Int
    var tone: Color = NT.ink
    var note: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
            Text(NT.yen(value)).font(.system(size: 21, weight: .heavy)).monospacedDigit().foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.6)
            if let note { Text(note).font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

/// 表の1マス（幅を決める。nil は残りいっぱい）
struct NAccCell: View {
    let text: String
    var width: CGFloat? = nil
    var trailing = false
    var bold = false
    var color: Color = NT.ink
    var size: CGFloat = 13.5

    var body: some View {
        Group {
            if let width {
                Text(text).frame(width: width, alignment: trailing ? .trailing : .leading)
            } else {
                Text(text).frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
            }
        }
        .font(.system(size: size, weight: bold ? .bold : .regular))
        .monospacedDigit()
        .foregroundColor(color)
        .lineLimit(1)
    }
}

/// 表の見出しの行
struct NAccTableHead: View {
    let cells: [(String, CGFloat?, Bool)]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(cells.enumerated()), id: \.offset) { item in
                NAccCell(text: item.element.0, width: item.element.1, trailing: item.element.2, bold: true, color: NT.ink3, size: 12)
            }
        }
        .padding(.horizontal, 14).frame(height: 34)
        .background(NT.page.opacity(0.7))
    }
}

/// 理由を書いて実行（仕訳の取消・締め解除）
struct NAccReasonSheet: View {
    let title: String
    let message: String
    let confirmLabel: String
    let onCancel: () -> Void
    let onConfirm: (String) async -> Void

    @State private var reason = ""
    @State private var sending = false

    private var ready: Bool { !NAccText.trimmed(reason).isEmpty && !sending }

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(message).font(.system(size: 14)).foregroundColor(NT.ink2) }
                Section("理由（必須）") {
                    TextField("理由を入力", text: $reason, axis: .vertical).lineLimit(2...5)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("やめる", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "送信中…" : confirmLabel) {
                        sending = true
                        let r = NAccText.trimmed(reason)
                        Task {
                            await onConfirm(r)
                            sending = false
                        }
                    }
                    .disabled(!ready)
                }
            }
        }
    }
}
