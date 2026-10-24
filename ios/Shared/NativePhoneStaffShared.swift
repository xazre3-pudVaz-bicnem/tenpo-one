import SwiftUI

// iPhone の店長・オーナーの画面：勤怠・シフト・有給休暇・従業員で共通の部品（2026-10-25 Ronnie「iPhone も native に」）。
// 見た目は iPhone ハンディ・iPad のネイティブと同じ（ネイビーの上のバー NPHTopBar・青 NT.purple・うすい灰色の地・白い角丸のカード）。
// iPad の画面・部品は変えない（iPad の中身の形 NAT…／NSH…／NLV…／NEM… と入力のシートはそのまま使う）。

/// 上のバーの右のボタン（＋追加・更新など）
struct NPWBarButton {
    let icon: String
    let label: String
    let action: () -> Void
}

/// iPhone の店長・オーナーの画面の枠：上のバー・その下に止まるタブ・読み込み中／エラー・下に出る知らせ・引っぱって読み直す
struct NPWPage<Header: View, Content: View>: View {
    let title: String
    let subtitle: String
    let backLabel: String
    let onBack: () -> Void
    let trailing: NPWBarButton?
    let loaded: Bool
    let error: String?
    @Binding var toast: NATToast?
    let retry: () async -> Void
    let header: () -> Header
    let content: () -> Content

    init(title: String, subtitle: String = "", backLabel: String = "ホーム", onBack: @escaping () -> Void,
         trailing: NPWBarButton? = nil, loaded: Bool, error: String?, toast: Binding<NATToast?>,
         retry: @escaping () async -> Void,
         @ViewBuilder header: @escaping () -> Header, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.backLabel = backLabel
        self.onBack = onBack
        self.trailing = trailing
        self.loaded = loaded
        self.error = error
        self._toast = toast
        self.retry = retry
        self.header = header
        self.content = content
    }

    var body: some View {
        let top = header()
        let inner = content()
        return VStack(spacing: 0) {
            NPHTopBar(title: title, subtitle: subtitle, backLabel: backLabel, onBack: onBack) {
                if let t = trailing {
                    NPWBarButtonView(button: t)
                } else {
                    // 題名がまん中に来るように、戻るボタンと同じくらいの幅をあける
                    Color.clear.frame(width: 44, height: 40)
                }
            }
            top
            if loaded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) { inner }
                        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 48)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .refreshable { await retry() }
            } else if let error {
                NPWErrorView(message: error, retry: retry, onBack: onBack)
            } else {
                VStack { Spacer(); ProgressView("読み込み中…").tint(NT.purple); Spacer() }
                    .frame(maxWidth: .infinity)
            }
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .bottom) { NPWToastView(toast: $toast) }
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }
}

extension NPWPage where Header == EmptyView {
    init(title: String, subtitle: String = "", backLabel: String = "ホーム", onBack: @escaping () -> Void,
         trailing: NPWBarButton? = nil, loaded: Bool, error: String?, toast: Binding<NATToast?>,
         retry: @escaping () async -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, backLabel: backLabel, onBack: onBack, trailing: trailing,
                  loaded: loaded, error: error, toast: toast, retry: retry, header: { EmptyView() }, content: content)
    }
}

struct NPWBarButtonView: View {
    let button: NPWBarButton

    var body: some View {
        Button(action: button.action) {
            VStack(spacing: 1) {
                Image(systemName: button.icon).font(.system(size: 17, weight: .heavy))
                Text(button.label).font(.system(size: 9.5, weight: .heavy)).lineLimit(1)
            }
            .foregroundColor(.white)
            .frame(minWidth: 48, minHeight: 44)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(button.label)
    }
}

/// 読めなかったとき（もう一度・ホームへ）
struct NPWErrorView: View {
    let message: String
    let retry: () async -> Void
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "exclamationmark.circle").font(.system(size: 30, weight: .semibold)).foregroundColor(NT.ink3)
            Text(message).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink2)
                .multilineTextAlignment(.center).padding(.horizontal, 28)
            Button { Task { await retry() } } label: {
                Text("もう一度読む").font(.system(size: 15, weight: .heavy)).foregroundColor(.white)
                    .padding(.horizontal, 24).frame(height: 46)
                    .background(Capsule().fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
            Button("ホームへ戻る", action: onBack)
                .font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

/// 下に数秒だけ出す知らせ（成功＝黒・注意＝黄・失敗＝赤。押すと消える）
struct NPWToastView: View {
    @Binding var toast: NATToast?

    var body: some View {
        if let t = toast {
            Text(t.text).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(Capsule().fill(Self.color(t.tone)))
                .padding(.horizontal, 20).padding(.bottom, 28)
                .onTapGesture { toast = nil }
                .task(id: t.text) {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if toast == t { toast = nil }
                }
        }
    }

    static func color(_ tone: NATToast.Tone) -> Color {
        switch tone {
        case .ok: return NT.topBar.opacity(0.94)
        case .warn: return NT.warn.opacity(0.96)
        case .error: return NT.danger.opacity(0.96)
        }
    }
}

/// 上のバーの下のタブ（下線。数字は赤い丸）
struct NPWTab: Hashable {
    let key: String
    let label: String
    var count: Int = 0
}

struct NPWTabBar: View {
    let tabs: [NPWTab]
    let selected: String
    let pick: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.key) { t in
                let on = t.key == selected
                Button { pick(t.key) } label: {
                    VStack(spacing: 0) {
                        HStack(spacing: 5) {
                            Text(t.label).font(.system(size: 14.5, weight: .heavy)).foregroundColor(on ? NT.ink : NT.ink3).lineLimit(1)
                            if t.count > 0 {
                                Text(t.count > 99 ? "99+" : "\(t.count)").font(.system(size: 11, weight: .heavy)).foregroundColor(.white)
                                    .padding(.horizontal, 5).frame(minWidth: 19, minHeight: 19)
                                    .background(Capsule().fill(NT.danger))
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 44)
                        Rectangle().fill(on ? NT.purple : Color.clear).frame(height: 3)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
    }
}

/// ‹ 前 ／ まん中の題名（押せる）／ 次 ›。今でないときは「今週」「今月」
struct NPWPeriodBar: View {
    let label: String
    var sub: String = ""
    /// 今（今週・今月）でないときだけ出す
    var resetLabel: String? = nil
    var loading = false
    let onPrev: () -> Void
    let onNext: () -> Void
    var onReset: () -> Void = {}

    var body: some View {
        HStack(spacing: 8) {
            arrow("chevron.left", "前へ", onPrev)
            HStack(spacing: 6) {
                if let r = resetLabel {
                    Button(action: onReset) {
                        Text(r).font(.system(size: 13, weight: .heavy)).foregroundColor(NT.purple)
                            .padding(.horizontal, 10).frame(height: 32)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white))
                    }
                    .buttonStyle(PressableStyle())
                }
                VStack(spacing: 0) {
                    Text(label).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if !sub.isEmpty { Text(sub).font(.system(size: 10.5, weight: .heavy)).foregroundColor(NT.purple).lineLimit(1) }
                }
                .frame(maxWidth: .infinity)
                if loading { ProgressView().scaleEffect(0.8).tint(NT.purple) }
            }
            .padding(.horizontal, 6)
            .frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NT.lilac))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
            arrow("chevron.right", "次へ", onNext)
        }
    }

    private func arrow(_ icon: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink2)
                .frame(width: 46, height: 44)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

/// 大きめのボタン（青・白・緑・赤）
struct NPWButton: View {
    enum Kind { case primary, secondary, ok, danger }
    let text: String
    var icon: String? = nil
    var kind: Kind = .secondary
    var busy = false
    var disabled = false
    var height: CGFloat = 46
    /// 横いっぱいに広げる
    var wide = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().scaleEffect(0.8).tint(kind == .secondary ? NT.purple : Color.white)
                } else if let icon {
                    Image(systemName: icon).font(.system(size: 14, weight: .bold))
                }
                Text(text).lineLimit(1).minimumScaleFactor(0.8)
            }
            .font(.system(size: 15, weight: .heavy))
            .foregroundColor(kind == .secondary ? NT.ink : Color.white)
            .padding(.horizontal, 14)
            .frame(maxWidth: wide ? .infinity : nil)
            .frame(height: height)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(kind == .secondary ? NT.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.45 : 1)
    }

    private var fill: Color {
        switch kind {
        case .primary: return NT.purple
        case .ok: return NT.ok
        case .danger: return NT.danger
        case .secondary: return Color.white
        }
    }
}

/// 数のタイル（残日数・勤務中の人数など）
struct NPWStat: View {
    let label: String
    let value: String
    var color: Color = NT.ink
    var sub: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 24, weight: .heavy)).monospacedDigit().foregroundColor(color).lineLimit(1).minimumScaleFactor(0.6)
            if let sub { Text(sub).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }
}

/// 中身が無いとき
struct NPWEmpty: View {
    var icon: String = "tray"
    let title: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 26, weight: .semibold)).foregroundColor(NT.ink3)
            Text(title).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
            if let message { Text(message).font(.system(size: 12.5)).foregroundColor(NT.ink3).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 30).padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }
}

/// 見出し（カードの外。小さい字の数・右の操作）
struct NPWSectionTitle<Trailing: View>: View {
    let title: String
    var count: String = ""
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
            if !count.isEmpty { Text(count).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit() }
            Spacer(minLength: 6)
            trailing()
        }
        .padding(.horizontal, 2).padding(.top, 6)
    }
}

extension NPWSectionTitle where Trailing == EmptyView {
    init(title: String, count: String = "") {
        self.init(title: title, count: count, trailing: { EmptyView() })
    }
}

/// 見出し：値 の 1 行（詳細の表）
struct NPWInfoRow: View {
    let label: String
    let value: String
    var strong = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
                .frame(width: 104, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(.system(size: 15, weight: strong ? Font.Weight.heavy : Font.Weight.medium))
                .foregroundColor(value.isEmpty ? NT.ink3 : NT.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 9)
    }
}

/// カードの中の区切り線
struct NPWDivider: View {
    var inset: CGFloat = 0
    var body: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, inset) }
}

/// 名前の頭文字の丸
struct NPWAvatar: View {
    let name: String
    var size: CGFloat = 40
    var color: Color = NT.purple

    var body: some View {
        Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)))
            .font(.system(size: size * 0.42, weight: .heavy)).foregroundColor(color)
            .frame(width: size, height: size)
            .background(Circle().fill(color.opacity(0.12)))
    }
}

enum NPWNav {
    /// Web だけの画面へ（ネイティブの画面を閉じてから。ネイティブがある道ならネイティブで開く）。
    /// leaveNativePhone は Web だけの道のとき phoneOwnerModule を消さないので、先に消す（iPhone だけ。iPad は通らない）
    static func openWeb(_ state: AppState, _ path: String) {
        state.phoneOwnerModule = nil
        state.leaveNativePhone(to: path)
    }
}
