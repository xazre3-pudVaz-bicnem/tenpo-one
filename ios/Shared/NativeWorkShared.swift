import SwiftUI

// 日報・タスク・マニュアルのネイティブ画面で共通の部品（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）。
// 色は NT（ホームの青・うすい灰色の地）、上のバーは共通の NativeTopBar（ネイビー）。

/// 画面の枠：上のバー（ホームへ）・読み込み中／エラー・下の toast
struct NWKPage<Content: View>: View {
    let title: String
    let onHome: () -> Void
    let loaded: Bool
    let error: String?
    @Binding var toast: String?
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: title, subtitle: "", onHome: onHome)
            if loaded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) { content() }
                        .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 32)
                        .frame(maxWidth: 1100, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
                .refreshable { await retry() }
            } else {
                Spacer()
                if let error {
                    VStack(spacing: 10) {
                        Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                        Button("もう一度") { Task { await retry() } }
                    }
                    .padding(.horizontal, 40)
                } else {
                    ProgressView("読み込み中…").tint(NT.purple)
                }
                Spacer()
            }
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .bottom) { NWKToast(toast: $toast) }
    }
}

/// 下に数秒だけ出すことば（押すと消える）
struct NWKToast: View {
    @Binding var toast: String?

    var body: some View {
        if let t = toast {
            Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(NT.ink.opacity(0.92)))
                .padding(.horizontal, 40).padding(.bottom, 24)
                .onTapGesture { toast = nil }
                .task(id: t) {
                    try? await Task.sleep(nanoseconds: 2_800_000_000)
                    if toast == t { toast = nil }
                }
        }
    }
}

/// 白いカード（見出し・右のボタン・中身）
struct NWKCard<Trailing: View, Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let trailing: () -> Trailing
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    if let note { Text(note).font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 8)
                trailing()
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            Rectangle().fill(NT.line).frame(height: 1)
            content()
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

extension NWKCard where Trailing == EmptyView {
    init(title: String, note: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, note: note, trailing: { EmptyView() }, content: content)
    }
}

struct NWKButton: View {
    enum Kind { case primary, secondary, danger, success }
    let text: String
    var icon: String? = nil
    var kind: Kind = .secondary
    var busy = false
    var disabled = false
    var height: CGFloat = 42
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().scaleEffect(0.8).tint(kind == .secondary ? NT.purple : Color.white)
                } else if let icon {
                    Image(systemName: icon)
                }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(kind == .secondary ? NT.ink : Color.white)
            .padding(.horizontal, 15).frame(height: height)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(kind == .secondary ? NT.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }

    private var fill: Color {
        switch kind {
        case .primary: return NT.purple
        case .danger: return NT.danger
        case .success: return NT.ok
        case .secondary: return Color.white
        }
    }
}

/// 状態・優先度などの小さい札
struct NWKBadge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.system(size: 12, weight: .bold)).foregroundColor(color)
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(0.12)))
            .fixedSize()
    }
}

struct NWKEmpty: View {
    let title: String
    var body: some View {
        Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink3)
            .frame(maxWidth: .infinity).padding(.vertical, 30).padding(.horizontal, 16)
    }
}

struct NWKDivider: View {
    var inset: CGFloat = 18
    var body: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, inset) }
}

/// 選ぶ（Web の <select> の代わり）。見出し・今の値・▼
struct NWKMenu: View {
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
            HStack(spacing: 6) {
                Text(label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                Text(current).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 14).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }
}

/// 日付を選ぶ（yyyy-MM-dd の文字で受け渡し。Web の <input type="date">）
struct NWKDateField: View {
    let label: String
    let value: String
    /// これより後は選べない（対象日は今日まで）
    var max: String? = nil
    let onPick: (String) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
            picker.labelsHidden()
        }
        .padding(.leading, 14).padding(.trailing, 6).frame(height: 42)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    @ViewBuilder private var picker: some View {
        let binding = Binding<Date>(get: { NPDate.date(value) }, set: { onPick(NPDate.str($0)) })
        if let max {
            DatePicker(label, selection: binding, in: ...NPDate.date(max), displayedComponents: .date)
        } else {
            DatePicker(label, selection: binding, displayedComponents: .date)
        }
    }
}

enum NWKFmt {
    /// ¥1,234（無ければ —。Web の yen と同じ）
    static func yen(_ v: Double?) -> String {
        guard let v else { return "—" }
        return NT.yen(Int(v.rounded()))
    }

    /// 2026/10/24 → 時刻つき（Web の formatDateTime：2026/10/24 12:34）
    static func dateTime(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "—" }
        // 秒の小数（.123456）は読めない形があるので外してから読む
        let cleaned = iso.replacingOccurrences(of: "\\.\\d+", with: "", options: .regularExpression)
        guard let d = ISO8601DateFormatter().date(from: cleaned) else { return String(iso.prefix(16)).replacingOccurrences(of: "T", with: " ") }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy/M/d HH:mm"
        return f.string(from: d)
    }

    /// 2026-10-24 → 2026/10/24
    static func slash(_ day: String?) -> String {
        guard let day, !day.isEmpty else { return "—" }
        return day.replacingOccurrences(of: "-", with: "/")
    }

    /// JSON の null
    static func orNull(_ s: String?) -> Any {
        if let s, !s.isEmpty { return s }
        return NSNull()
    }
}
