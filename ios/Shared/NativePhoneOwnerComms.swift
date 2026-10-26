import SwiftUI

// iPhone の店長・オーナー：通知・お知らせ・日報・タスク で共通の部品（2026-10-25 Ronnie「iPhone も native に」）。
// 色・形は iPad のネイティブと同じ（NT：上のバー＝ネイビー、主の色＝青、地＝うすい灰色、白い角丸のカード）。
// iPhone だけで使う（iPad の画面・部品には触らない）。画面の枠は NativePhoneOwner.swift の NPOFrame。

struct NPOCOption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NPOCKeyLabel: Decodable, Hashable {
    let key: String
    let label: String
}

// MARK: - 中身の枠（読み込み中・エラー・引っぱって読み直す）

struct NPOCBody<Content: View>: View {
    let loaded: Bool
    let error: String?
    let retry: () async -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return Group {
            if loaded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) { inner }
                        .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 56)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .refreshable { await retry() }
                .scrollDismissesKeyboard(.interactively)
            } else if let error {
                VStack(spacing: 14) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 30, weight: .bold)).foregroundColor(NT.ink3)
                    Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                    Button { Task { await retry() } } label: {
                        Text("もう一度").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 26).frame(height: 46)
                            .background(Capsule().fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                }
                .padding(.horizontal, 32)
            } else {
                ProgressView("読み込み中…").tint(NT.purple)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 一覧から開いた詳細の枠（上のバー＝ネイビー・「一覧」に戻る・題名・右のボタン）

struct NPOCDetailFrame<Trailing: View, Content: View>: View {
    let title: String
    var subtitle: String = ""
    var backLabel: String = "一覧"
    let onBack: () -> Void
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return VStack(spacing: 0) {
            NPHTopBar(title: title, subtitle: subtitle, backLabel: backLabel, onBack: onBack, trailing: trailing)
            inner.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
    }
}

// MARK: - シートの枠（作成・編集・表示設定）

/// 下から出すシート（白い上のバー：キャンセル・題名・保存。中身はスクロール）。
/// iPhone のアプリは暗い表示なので、NavigationStack・Form は使わず明るい自前の画面にする（ハンディのシートと同じ）
struct NPOCSheetFrame<Content: View>: View {
    let title: String
    var cancelText: String = "キャンセル"
    /// nil なら右のボタンを出さない（表示設定など）
    var confirmText: String? = nil
    var busy = false
    let onCancel: () -> Void
    var onConfirm: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: onCancel) {
                    Text(cancelText).font(.system(size: 16, weight: .semibold)).foregroundColor(NT.ink2)
                        .frame(minWidth: 64, minHeight: 44, alignment: .leading)
                }
                .disabled(busy)
                Spacer(minLength: 4)
                Text(title).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 4)
                if let confirmText, let onConfirm {
                    Button(action: onConfirm) {
                        HStack(spacing: 6) {
                            if busy { ProgressView().tint(.white) }
                            Text(confirmText)
                        }
                        .font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 15).frame(height: 38)
                        .background(Capsule().fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(busy)
                } else {
                    Color.clear.frame(width: 64, height: 44)
                }
            }
            .padding(.horizontal, 16).frame(height: 60)
            .background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) { inner }
                    .padding(16).padding(.bottom, 40)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(NT.page.ignoresSafeArea())
        .interactiveDismissDisabled(busy)
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }
}

/// 入力欄の見出し＋中身
struct NPOCField<Content: View>: View {
    let label: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).padding(.leading, 4)
            inner
        }
    }
}

extension View {
    /// 白い入力欄の地（角丸・うすい線）
    func npocInputBox() -> some View {
        padding(.horizontal, 12).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    /// 白いカードの中の 1 行（スイッチ・日付・選ぶ）
    func npocRow() -> some View {
        padding(.horizontal, 14).frame(minHeight: 52)
    }
}

// MARK: - 部品

/// 上のバーの右のボタン（白い字。label があれば丸い札）
struct NPOCBarButton: View {
    let icon: String
    var label: String = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 15, weight: .bold))
                if !label.isEmpty { Text(label).font(.system(size: 13, weight: .bold)).lineLimit(1) }
            }
            .foregroundColor(.white)
            .padding(.horizontal, label.isEmpty ? 0 : 11)
            .frame(minWidth: 40, minHeight: 40)
            .background(Capsule().fill(Color.white.opacity(label.isEmpty ? 0 : 0.14)))
        }
        .buttonStyle(PressableStyle())
    }
}

/// 選べる丸い札（状態の絞り込みなど）
struct NPOCChip: View {
    let text: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text).font(.system(size: 14, weight: .bold))
                .foregroundColor(selected ? .white : NT.ink2)
                .padding(.horizontal, 15).frame(height: 38)
                .background(Capsule().fill(selected ? NT.purple : Color.white))
                .overlay(Capsule().stroke(selected ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

/// 選ぶ（Web の <select> の代わり）。見出し・今の値・▼。何か選んでいるときはうすい青
struct NPOCMenuChip: View {
    let label: String
    /// (値, 表示)
    let options: [(String, String)]
    let selection: String
    let onSelect: (String) -> Void

    private var current: String { options.first { $0.0 == selection }?.1 ?? options.first?.1 ?? "" }

    var body: some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                Button { onSelect(o.0) } label: {
                    if o.0 == selection { Label(o.1, systemImage: "checkmark") } else { Text(o.1) }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                Text(current).font(.system(size: 14, weight: .bold)).foregroundColor(selection.isEmpty ? NT.ink : NT.purpleDeep).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 13).frame(height: 38)
            .background(Capsule().fill(selection.isEmpty ? Color.white : NT.lilac))
            .overlay(Capsule().stroke(selection.isEmpty ? NT.line : NT.lilacLine, lineWidth: 1))
        }
    }
}

/// 横いっぱいの大きいボタン（iPhone で押しやすい高さ）
struct NPOCWideButton: View {
    enum Kind { case primary, secondary, danger, success }
    let text: String
    var icon: String? = nil
    var kind: Kind = .primary
    var busy = false
    var disabled = false
    var height: CGFloat = 50
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if busy {
                    ProgressView().tint(kind == .secondary ? NT.purple : Color.white)
                } else if let icon {
                    Image(systemName: icon)
                }
                Text(text).lineLimit(1).minimumScaleFactor(0.8)
            }
            .font(.system(size: 16, weight: NT.strong))
            .foregroundColor(fg)
            .frame(maxWidth: .infinity).frame(height: height)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(bg))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(kind == .secondary ? NT.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }

    private var bg: Color {
        switch kind {
        case .primary: return NT.purple
        case .danger: return NT.danger
        case .success: return NT.ok
        case .secondary: return Color.white
        }
    }

    private var fg: Color { kind == .secondary ? NT.ink : Color.white }
}

/// 何も無いとき（白いカード）
struct NPOCEmpty: View {
    let icon: String
    let title: String
    var note: String = ""

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 28, weight: .semibold)).foregroundColor(NT.ink3.opacity(0.7))
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
            if !note.isEmpty {
                Text(note).font(.system(size: 12.5)).foregroundColor(NT.ink3).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 34).padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }
}

/// 見出し（カードの上の小さい題）
struct NPOCSectionTitle: View {
    let title: String
    var note: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
            if !note.isEmpty {
                Text(note).font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 4).padding(.top, 4)
    }
}

/// 白い角丸のカードの地
func npocCard(_ radius: CGFloat = 16) -> some View {
    RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color.white)
}

// MARK: - 日時の出し方（日本時間）

enum NPOCFmt {
    private static let jst = TimeZone(identifier: "Asia/Tokyo") ?? TimeZone.current

    private static func make(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = jst
        f.dateFormat = pattern
        return f
    }

    private static let hm = make("HH:mm")
    private static let mdhm = make("M/d HH:mm")
    private static let ymdhm = make("yyyy/M/d HH:mm")
    private static let ymd = make("yyyy/MM/dd")
    private static let mdw = make("M/d（E）")
    private static let ymdw = make("yyyy/M/d（E）")

    /// ISO の日時（秒の小数つきも）→ Date
    static func date(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let cleaned = iso.replacingOccurrences(of: "\\.\\d+", with: "", options: .regularExpression)
        return ISO8601DateFormatter().date(from: cleaned)
    }

    static func nowISO() -> String { ISO8601DateFormatter().string(from: Date()) }

    /// たった今・◯分前・12:34（今日）・昨日 12:34・10/23 12:34・2025/10/23 12:34
    static func ago(_ iso: String?, now: Date = Date()) -> String {
        guard let d = date(iso) else { return iso.map { String($0.prefix(16)).replacingOccurrences(of: "T", with: " ") } ?? "—" }
        let sec = now.timeIntervalSince(d)
        if sec < 60 { return "たった今" }
        if sec < 3600 { return "\(Int(sec / 60))分前" }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = jst
        if cal.isDate(d, inSameDayAs: now) { return hm.string(from: d) }
        if let y = cal.date(byAdding: .day, value: -1, to: now), cal.isDate(d, inSameDayAs: y) { return "昨日 " + hm.string(from: d) }
        if cal.component(.year, from: d) == cal.component(.year, from: now) { return mdhm.string(from: d) }
        return ymdhm.string(from: d)
    }

    /// 2026/10/25 12:34
    static func dateTime(_ iso: String?) -> String {
        guard let d = date(iso) else { return "—" }
        return ymdhm.string(from: d)
    }

    /// ISO → 日本時間の 2026/10/25
    static func day(_ iso: String?) -> String {
        guard let d = date(iso) else { return "—" }
        return ymd.string(from: d)
    }

    /// 2026-10-25 → 10/25（日）
    static func dayWeek(_ ymdString: String) -> String { mdw.string(from: NPDate.date(ymdString)) }

    /// 2026-10-25 → 2026/10/25（日）
    static func fullDayWeek(_ ymdString: String) -> String { ymdw.string(from: NPDate.date(ymdString)) }

    /// 2026-10-25 に日を足す（日本時間）
    static func addDays(_ ymdString: String, _ days: Int) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = jst
        guard let d = cal.date(byAdding: .day, value: days, to: NPDate.date(ymdString)) else { return ymdString }
        return NPDate.str(d)
    }
}

// MARK: - Web に戻す（権限が無い・最初の読み込みができない）

/// 少し前に Web に戻した画面（裏の Web の読み込みが終わって、もう一度ネイティブで開かれたときにすぐ Web に戻す）
enum NPOCFallback {
    private static var at: [String: Date] = [:]
    static func mark(_ key: String) { at[key] = Date() }
    static func recent(_ key: String) -> Bool { at[key].map { Date().timeIntervalSince($0) < 10 } ?? false }
}

/// サーバーが「Web で」と言った・最初の読み込みができなかった（本社経理など pos.order の無い役割を含む）とき、
/// この画面を閉じて裏の Web の画面を見せる（オーナーのホームの useWeb と同じ考え方）
struct NPOCWebFallback: ViewModifier {
    let key: String
    let useWeb: Bool
    let state: AppState

    func body(content: Content) -> some View {
        content
            .onAppear {
                if NPOCFallback.recent(key) { state.phoneOwnerModule = nil }
            }
            .onChange(of: useWeb) { on in
                guard on else { return }
                NPOCFallback.mark(key)
                state.phoneOwnerModule = nil
            }
    }
}

// MARK: - リンクを開く

enum NPOCLink {
    /// 通知・お知らせのリンク。ネイティブの画面があればネイティブで、無ければこの画面を閉じて Web の画面。外のサイトは Safari
    static func open(_ link: String, state: AppState) {
        let s = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, let url = URL(string: s, relativeTo: AppConfig.url("/"))?.absoluteURL else { return }
        guard AppConfig.isOwnHost(url) else {
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "https" || scheme == "http" { UIApplication.shared.open(url) }
            return
        }
        // leaveNativePhone は Web だけの画面へ行くときに店長・オーナーの画面を閉じないので、ここで閉じる
        if NativePhoneOwnerRegistry.route(for: url) == nil { state.phoneOwnerModule = nil }
        state.leaveNativePhone(to: url.absoluteString)
    }
}
