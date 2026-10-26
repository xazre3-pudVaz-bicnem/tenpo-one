import SwiftUI

// iPhone の店長・オーナー：レポート・伝票明細・予算管理・日別予算で使う小さな部品（2026-10-25 Ronnie「iPhone も native に」）。
// iPad の画面・型は使わない（iPad を壊さない）。色は NT（上のバー＝ネイビー・主の色＝青）。

/// 日付・お金・数字の書き方（日本時間）
enum NOS {
    static let tz = TimeZone(identifier: "Asia/Tokyo")!
    static var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = tz
        return c
    }
    static let dayF: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static let weekdays = ["日", "月", "火", "水", "木", "金", "土"]

    static func date(_ s: String) -> Date? { dayF.date(from: String(s.prefix(10))) }
    static func str(_ d: Date) -> String { dayF.string(from: d) }
    static var today: String { str(Date()) }

    static func isDay(_ s: String) -> Bool { s.count == 10 && date(s) != nil }
    static func isMonth(_ s: String) -> Bool { s.count == 7 && date(s + "-01") != nil }
    static func isUuid(_ s: String) -> Bool { s.count == 36 && s.allSatisfy { $0.isHexDigit || $0 == "-" } }

    static func addDays(_ s: String, _ n: Int) -> String {
        guard let d = date(s), let r = cal.date(byAdding: .day, value: n, to: d) else { return s }
        return str(r)
    }
    /// 0＝日 … 6＝土
    static func weekday(_ s: String) -> Int {
        guard let d = date(s) else { return 0 }
        return max(0, min(6, cal.component(.weekday, from: d) - 1))
    }
    /// その週の月曜（Web の mondayOfStr と同じ）
    static func monday(_ s: String) -> String {
        let w = weekday(s)
        return addDays(s, w == 0 ? -6 : 1 - w)
    }
    static func monthFirst(_ s: String) -> String { String(s.prefix(7)) + "-01" }
    static func monthLast(_ s: String) -> String { monthDays(String(s.prefix(7))).last ?? monthFirst(s) }
    /// "yyyy-MM" を d か月ずらす（"yyyy-MM" を返す）
    static func shiftMonth(_ ym: String, _ d: Int) -> String {
        let parts = String(ym.prefix(7)).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return String(ym.prefix(7)) }
        let total = parts[0] * 12 + (parts[1] - 1) + d
        return String(format: "%04d-%02d", total / 12, total % 12 + 1)
    }
    /// その月の日（"yyyy-MM-dd" の並び）
    static func monthDays(_ ym: String) -> [String] {
        guard let first = date(String(ym.prefix(7)) + "-01"), let r = cal.range(of: .day, in: .month, for: first) else { return [] }
        return r.map { String(format: "%@-%02d", String(ym.prefix(7)), $0) }
    }

    /// 10/25
    static func md(_ s: String) -> String {
        let p = s.split(separator: "-")
        guard p.count >= 3, let m = Int(p[1]), let d = Int(p[2].prefix(2)) else { return s }
        return "\(m)/\(d)"
    }
    /// 10/25（土）
    static func mdw(_ s: String) -> String { "\(md(s))（\(weekdays[weekday(s)])）" }
    /// 2026年10月
    static func ymLabel(_ s: String) -> String {
        let p = s.split(separator: "-")
        guard p.count >= 2, let y = Int(p[0]), let m = Int(p[1]) else { return s }
        return "\(y)年\(m)月"
    }

    static func yen(_ v: Double) -> String { NT.yen(Int(v.rounded())) }
    static func yen(_ v: Double?) -> String { v.map { yen($0) } ?? "—" }
    static func int(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "ja_JP")
        return f.string(from: NSNumber(value: Int(v.rounded()))) ?? "\(Int(v.rounded()))"
    }
    static func pct(_ v: Double?, digits: Int = 1) -> String {
        guard let v else { return "—" }
        return String(format: "%.\(digits)f%%", v)
    }
    /// 入力欄に入れる数（整数ならそのまま、小数は2桁まで）
    static func plain(_ v: Double?) -> String {
        guard let v else { return "" }
        if v == v.rounded() { return String(Int(v)) }
        return String(format: "%.2f", v).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
    }
    /// 入力の文字から数（カンマ・全角・円・% を除く）。空は nil
    static func num(_ text: String) -> Double? {
        let half = text.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? text
        let t = half.filter { $0.isNumber || $0 == "." || $0 == "-" }
        guard !t.isEmpty, t != ".", t != "-" else { return nil }
        return Double(t)
    }

    /// ISO の日時 → 時刻（日本時間）。withDate で 10/25 18:30
    static func time(_ iso: String?, withDate: Bool = false) -> String {
        guard let iso, !iso.isEmpty else { return "" }
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let f2 = ISO8601DateFormatter()
        guard let d = f1.date(from: iso) ?? f2.date(from: iso) else { return "" }
        let o = DateFormatter()
        o.locale = Locale(identifier: "en_US_POSIX")
        o.timeZone = tz
        o.dateFormat = withDate ? "M/d HH:mm" : "HH:mm"
        return o.string(from: d)
    }

    /// 達成率の色（Web の予算管理と同じ：100%以上＝緑、90%以上＝黄、それ未満＝赤）
    static func tone(_ rate: Double?) -> Color {
        guard let r = rate else { return NT.ink3 }
        if r >= 100 { return NT.ok }
        if r >= 90 { return NT.warn }
        return NT.danger
    }

    /// 前の期間との差（%）。前が 0 なら nil
    static func change(_ cur: Double, _ prev: Double?) -> Double? {
        guard let prev, prev != 0 else { return nil }
        return (cur - prev) / abs(prev) * 100
    }

    /// サーバーの返事の中身だけ見る（見本のデータを辞書から作るときも使う）
    static func decode<T: Decodable>(_ type: T.Type, _ object: Any) -> T? {
        guard JSONSerialization.isValidJSONObject(object), let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/// 読み込み中・読めなかったとき（真ん中に）
struct NOSStateView: View {
    let error: String?
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            if let e = error {
                Image(systemName: "exclamationmark.circle").font(.system(size: 30, weight: .semibold)).foregroundColor(NT.ink3)
                Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center).padding(.horizontal, 28)
                Button(action: onRetry) {
                    Text("もう一度読む").font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 22).frame(height: 44)
                        .background(Capsule().fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            } else {
                ProgressView().tint(NT.purple)
                Text("読み込み中…").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

/// 上に細く出すエラー（中身があるとき）
struct NOSErrorBar: View {
    @Binding var error: String?
    var body: some View {
        if let e = error {
            Button { error = nil } label: {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 12, weight: .bold))
                    Text(e).font(.system(size: 12.5, weight: .bold)).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold))
                }
                .foregroundColor(NT.danger)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(NT.dangerBg)
            }
            .buttonStyle(.plain)
        }
    }
}

/// 日・週・月 などの切り替え（大きく押せる）
struct NOSSegment: View {
    let items: [(key: String, label: String)]
    let selection: String
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items, id: \.0) { it in
                let on = it.key == selection
                Button { onSelect(it.key) } label: {
                    Text(it.label).font(.system(size: 15, weight: NT.strong)).foregroundColor(on ? .white : NT.ink2)
                        .frame(maxWidth: .infinity).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NT.purple : Color.clear))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(NT.lilac))
    }
}

/// ‹ 前 ／ 真ん中の字 ／ 次 ›
struct NOSStepper: View {
    let title: String
    var caption: String = ""
    var canNext = true
    let onPrev: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            arrow("chevron.left", enabled: true, action: onPrev)
            VStack(spacing: 1) {
                Text(title).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1).minimumScaleFactor(0.7)
                if !caption.isEmpty { Text(caption).font(.system(size: 11, weight: .bold)).foregroundColor(NT.purple).lineLimit(1) }
            }
            .frame(maxWidth: .infinity)
            arrow("chevron.right", enabled: canNext, action: onNext)
        }
    }

    private func arrow(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(enabled ? NT.ink : NT.line)
                .frame(width: 46, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }
}

/// 小さい丸い札
struct NOSBadge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.system(size: 11, weight: NT.strong)).foregroundColor(color).lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(0.12)))
    }
}

/// 前の期間との差（↑ +12.3%）。positiveIsGood=false は下がると緑（原価率など）
struct NOSDelta: View {
    let pct: Double?
    var label: String = ""
    var positiveIsGood = true

    var body: some View {
        let dir = (pct ?? 0) > 0.05 ? 1 : (pct ?? 0) < -0.05 ? -1 : 0
        let good: Bool? = dir == 0 ? nil : ((dir > 0) == positiveIsGood)
        let color = good == nil ? NT.ink3 : (good! ? NT.ok : NT.danger)
        return HStack(spacing: 2) {
            if !label.isEmpty { Text(label).foregroundColor(NT.ink3) }
            if let p = pct {
                Image(systemName: dir > 0 ? "arrow.up.right" : dir < 0 ? "arrow.down.right" : "minus").font(.system(size: 9, weight: NT.strong))
                Text("\(p >= 0 ? "+" : "")\(String(format: "%.1f", p))%")
            } else {
                Text("—")
            }
        }
        .font(.system(size: 11, weight: .bold)).monospacedDigit()
        .foregroundColor(color)
        .lineLimit(1)
    }
}

/// 名前・金額・割合の横棒（支払方法・カテゴリ）
struct NOSMeterRow: View {
    var rank: Int? = nil
    let label: String
    let value: String
    let ratio: Double
    var sub: String = ""
    var tint: Color = NT.purple

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                if let rank {
                    Text("\(rank)").font(.system(size: 11, weight: NT.strong)).foregroundColor(rank <= 3 ? .white : NT.ink3)
                        .frame(width: 20, height: 20).background(Circle().fill(rank <= 3 ? NT.purple : NT.page))
                }
                Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 6)
                if !sub.isEmpty { Text(sub).font(.system(size: 11, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit() }
                Text(value).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(NT.page)
                    Capsule().fill(tint.opacity(0.75)).frame(width: max(4, g.size.width * CGFloat(max(0, min(1, ratio)))))
                }
            }
            .frame(height: 7)
        }
    }
}

/// 棒グラフの 1 本
struct NOSBar: Hashable {
    let label: String
    let value: Double
    /// 押したときに出す字（無ければ label）
    var detail: String = ""
    var tint: Color = NT.purple
}

/// かんたんな棒グラフ（SwiftUI の図形だけ。iOS 16 の Charts は使わない）。棒を押すとその金額を上に出す
struct NOSBars: View {
    let bars: [NOSBar]
    var height: CGFloat = 150
    /// 下の字を何本ごとに出すか（0＝自動）
    var labelEvery = 0
    /// 何も押していないときの上の字
    var summary: String = ""
    @State private var picked: Int?

    var body: some View {
        let maxV = max(1, bars.map(\.value).max() ?? 1)
        let n = max(1, bars.count)
        let every = labelEvery > 0 ? labelEvery : (n <= 8 ? 1 : n <= 16 ? 2 : n <= 24 ? 3 : n <= 40 ? 5 : n / 6)
        let sel: Int? = picked.flatMap { $0 < bars.count ? $0 : nil }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let i = sel {
                    Text(bars[i].detail.isEmpty ? bars[i].label : bars[i].detail).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink2)
                    Text(NOS.yen(bars[i].value)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                } else {
                    Text(summary.isEmpty ? "棒を押すと金額が出ます" : summary).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                }
                Spacer()
                Text("最大 \(NOS.yen(maxV))").font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3).monospacedDigit()
            }
            .frame(height: 20)
            GeometryReader { g in
                let gap: CGFloat = n > 40 ? 1 : n > 20 ? 2 : 4
                let w = max(1, (g.size.width - gap * CGFloat(n - 1)) / CGFloat(n))
                ZStack(alignment: .topLeading) {
                    // 目盛り（半分・上）
                    Rectangle().fill(NT.line).frame(width: g.size.width, height: 1).offset(y: height)
                    Rectangle().fill(NT.line.opacity(0.6)).frame(width: g.size.width, height: 1).offset(y: height / 2)
                    ForEach(Array(bars.enumerated()), id: \.offset) { i, b in
                        let h = b.value > 0 ? max(3, height * CGFloat(b.value / maxV)) : 2
                        let x = CGFloat(i) * (w + gap)
                        RoundedRectangle(cornerRadius: min(3, w / 2), style: .continuous)
                            .fill(b.value > 0 ? (sel == nil || sel == i ? b.tint : b.tint.opacity(0.35)) : NT.line)
                            .frame(width: w, height: h)
                            .offset(x: x, y: height - h)
                        if i % every == 0 {
                            Text(b.label).font(.system(size: 9.5, weight: .semibold)).foregroundColor(sel == i ? NT.purpleDeep : NT.ink3)
                                .fixedSize()
                                .frame(width: max(w, 28))
                                .offset(x: x + w / 2 - max(w, 28) / 2, y: height + 4)
                        }
                        // 押すところ（棒の列ぜんぶ）
                        Color.clear
                            .frame(width: w + gap, height: height + 18)
                            .contentShape(Rectangle())
                            .offset(x: x - gap / 2)
                            .onTapGesture { picked = picked == i ? nil : i }
                    }
                }
            }
            .frame(height: height + 18)
        }
    }
}

/// ‹ 2026年10月 › の月の切り替え（予算管理・日別予算）
struct NOSMonthBar: View {
    let month: String
    let onShift: (Int) -> Void

    var body: some View {
        let thisMonth = String(NOS.today.prefix(7))
        let caption = month == thisMonth ? "今月" : month == NOS.shiftMonth(thisMonth, -1) ? "先月" : month == NOS.shiftMonth(thisMonth, 1) ? "来月" : ""
        return NOSStepper(title: NOS.ymLabel(month), caption: caption, canNext: true, onPrev: { onShift(-1) }, onNext: { onShift(1) })
    }
}

/// 金額をテンキーで入れる（円。日別予算の 1 日・今月の売上目標）
struct NOSAmountSheet: View {
    let title: String
    var caption: String = ""
    let initial: Int?
    var note: String = ""
    var okLabel = "決定"
    /// 「前日と同じ」に入れる金額（無ければボタンを出さない）
    var previous: Int? = nil
    /// 「決定して次の日へ」（nil なら出さない）
    var onNext: ((Int) -> Void)? = nil
    /// 「この金額を全部の日に」（nil なら出さない）
    var onFillAll: ((Int) -> Void)? = nil
    let onDone: (Int) -> Void
    let onCancel: () -> Void

    @State private var text = ""
    @State private var fillConfirm = false

    private var value: Int { Int(text) ?? initial ?? 0 }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button("キャンセル", action: onCancel).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink2)
                Spacer()
            }
            .padding(.horizontal, 18).padding(.top, 14)
            VStack(spacing: 2) {
                Text(title).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink)
                if !caption.isEmpty { Text(caption).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3) }
            }
            Text(NT.yen(value)).font(.system(size: 38, weight: NT.strong)).foregroundColor(text.isEmpty ? NT.ink3 : NT.ink).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.5).padding(.horizontal, 18)
            if value >= 10_000 {
                Text("＝ \(NOS.plain((Double(value) / 10_000 * 10).rounded() / 10))万円").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
            }
            if !note.isEmpty {
                Text(note).font(.system(size: 11.5)).foregroundColor(NT.ink3).multilineTextAlignment(.center).padding(.horizontal, 22)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if previous != nil || onFillAll != nil {
                HStack(spacing: 8) {
                    if let p = previous {
                        smallButton("前日と同じ", sub: NT.yen(p)) { text = String(p) }
                    }
                    if onFillAll != nil {
                        smallButton("全部の日に", sub: "この金額") { if value > 0 { fillConfirm = true } }
                    }
                }
                .padding(.horizontal, 18)
            }
            NPHKeypad(text: $text, maxLength: 11)
            HStack(spacing: 8) {
                if let onNext {
                    Button { onNext(value) } label: {
                        Text("決定して次の日へ").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.purpleDeep)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
                Button { onDone(value) } label: {
                    Text(okLabel).font(.system(size: 16, weight: NT.strong)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 18)
            Spacer(minLength: 0)
        }
        .background(Color.white.ignoresSafeArea())
        .confirmationDialog("\(NT.yen(value)) を全部の日に入れますか？", isPresented: $fillConfirm, titleVisibility: .visible) {
            Button("全部の日に入れる") { onFillAll?(value) }
            Button("やめる", role: .cancel) {}
        }
    }

    private func smallButton(_ title: String, sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Text(title).font(.system(size: 13, weight: NT.strong))
                Text(sub).font(.system(size: 10, weight: .semibold)).opacity(0.75).monospacedDigit()
            }
            .foregroundColor(NT.ink2)
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
        }
        .buttonStyle(PressableStyle())
    }
}
