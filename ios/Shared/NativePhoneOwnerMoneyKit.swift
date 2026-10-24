import SwiftUI
import UIKit

// iPhone の店長・オーナー：入出金・レジオープン／クローズ・仕入経費・スキャン（お金・書類）で使う小さな部品（2026-10-25 Ronnie「iPhone も native に」）。
// iPad の画面・型は使わない（iPad を壊さない）。サーバーは iPad と同じ GET part ／ POST type（返事の形は変えない）。
// 色は NT（上のバー＝ネイビー・主の色＝青・地＝うすい灰色）。印刷は iPhone からはしない（印刷は別のチーム。iPad のレジから）。

/// サーバーの { id, name }
struct NOMNamed: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

enum NOM {
    /// 金種（レジのトレイの順。Web の CASH_DENOMINATIONS と同じ）
    static let denoms = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000]

    static func denomLabel(_ d: Int) -> String {
        switch d {
        case 1000: return "千円札"
        case 5000: return "五千円札"
        case 10000: return "一万円札"
        default: return "\(d)円玉"
        }
    }

    /// POST（iPad と同じ type）。見本のときは送らない。印刷係は起こさない（NSPApi は kickPrint: false）
    static func post(_ body: [String: Any]) async -> (ok: Bool, error: String?, json: [String: Any]?) {
        if NativePreview.current != nil { return (true, nil, [:]) }
        return await NSPApi.postJSON(body)
    }

    /// ISO の時刻 → "HH:mm"（日本時間。小数の秒のけた数に関係なく読む）
    static func hm(_ iso: String?) -> String { fmt(iso, "HH:mm") }
    /// ISO の時刻 → "10/25 18:30"
    static func mdhm(_ iso: String?) -> String { fmt(iso, "M/d HH:mm") }

    private static func fmt(_ iso: String?, _ pattern: String) -> String {
        guard let iso, !iso.isEmpty else { return "" }
        let plain = iso.replacingOccurrences(of: "\\.[0-9]+", with: "", options: .regularExpression)
        let p = ISO8601DateFormatter()
        p.formatOptions = [.withInternetDateTime]
        guard let d = p.date(from: plain) else { return "" }
        let o = DateFormatter()
        o.locale = Locale(identifier: "en_US_POSIX")
        o.timeZone = NOS.tz
        o.dateFormat = pattern
        return o.string(from: d)
    }

    /// +¥1,000 ／ −¥1,000 ／ ±¥0
    static func signed(_ v: Double) -> String {
        let n = Int(v.rounded())
        if n == 0 { return "±¥0" }
        return (n > 0 ? "+" : "−") + NT.yen(abs(n))
    }

    /// 2026/10/25
    static func slash(_ s: String) -> String { s.replacingOccurrences(of: "-", with: "/") }

    /// 期間の字（10/1〜10/25。同じ日なら 10/25（土））
    static func period(_ from: String, _ to: String) -> String {
        if from == to { return NOS.mdw(from) }
        let sameYear = from.prefix(4) == to.prefix(4) && from.prefix(4) == NOS.today.prefix(4)
        if sameYear { return "\(NOS.md(from))〜\(NOS.md(to))" }
        return "\(slash(from))〜\(slash(to))"
    }

    /// 承認の状態の色（承認済み＝緑、差戻し＝赤、ほか＝黄）
    static func approvalColor(_ status: String) -> Color {
        switch status {
        case "approved": return NT.ok
        case "rejected": return NT.danger
        default: return NT.warn
        }
    }

    /// 写真を JPEG にする（長い辺 2400px・3MB まで。iPad・Web と同じ上限＝サーバーの NATIVE_SCAN_MAX_BYTES）
    static func jpeg(_ img: UIImage) -> Data? {
        let maxSide: CGFloat = 2400
        let s = img.size
        guard s.width > 0, s.height > 0 else { return nil }
        let scale = min(1, maxSide / max(s.width, s.height))
        let size = CGSize(width: floor(s.width * scale), height: floor(s.height * scale))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        var q: CGFloat = 0.8
        while q >= 0.3 {
            if let d = resized.jpegData(compressionQuality: q), d.count <= 3_000_000 { return d }
            q -= 0.15
        }
        return nil
    }

    /// 小さな見本の写真（アップロードの一覧に出す）
    static func thumb(_ img: UIImage, side: CGFloat = 120) -> UIImage {
        let s = img.size
        guard s.width > 0, s.height > 0 else { return img }
        let scale = min(1, side / max(s.width, s.height))
        let size = CGSize(width: max(1, floor(s.width * scale)), height: max(1, floor(s.height * scale)))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 2
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }
}

extension UIImage {
    /// 向きを「上」にそろえた写真（カメラの写真は向きの印だけ付いているので、切り取る前にそろえる）
    func nomUpright() -> UIImage {
        if imageOrientation == .up { return self }
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = scale
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// 右に 90 度まわした写真
    func nomRotated() -> UIImage {
        let s = size
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = scale
        return UIGraphicsImageRenderer(size: CGSize(width: s.height, height: s.width), format: fmt).image { ctx in
            let c = ctx.cgContext
            c.translateBy(x: s.height / 2, y: s.width / 2)
            c.rotate(by: .pi / 2)
            draw(in: CGRect(x: -s.width / 2, y: -s.height / 2, width: s.width, height: s.height))
        }
    }

    /// 切り取った写真（rect は 0〜1。写真の幅・高さに対して）。全体のときはそのまま
    func nomCropped(_ rect: CGRect) -> UIImage {
        let up = nomUpright()
        if rect.minX <= 0.001 && rect.minY <= 0.001 && rect.maxX >= 0.999 && rect.maxY >= 0.999 { return up }
        guard let cg = up.cgImage else { return up }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        let px = CGRect(x: rect.minX * w, y: rect.minY * h, width: rect.width * w, height: rect.height * h).integral
        guard px.width >= 1, px.height >= 1, let c = cg.cropping(to: px) else { return up }
        return UIImage(cgImage: c, scale: up.scale, orientation: .up)
    }
}

// MARK: - 部品

/// 「タイトル　English」の小見出し
struct NOMTitle: View {
    let ja: String
    var en: String = ""
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(ja).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
            if !en.isEmpty { Text(en).font(.system(size: 10.5, weight: .semibold)).foregroundColor(NT.ink3) }
        }
    }
}

/// 大きく押せるボタン（塗り／うすい青）
struct NOMButton: View {
    let title: String
    var icon: String = ""
    var filled = true
    var tint: Color = NT.purple
    var height: CGFloat = 50
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if !icon.isEmpty { Image(systemName: icon).font(.system(size: 15, weight: .bold)) }
                Text(title).font(.system(size: 15.5, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.75)
            }
            .foregroundColor(filled ? .white : (tint == NT.purple ? NT.purpleDeep : tint))
            .frame(maxWidth: .infinity).frame(height: height)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(filled ? tint : (tint == NT.purple ? NT.lilac : tint.opacity(0.1))))
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }
}

/// 小さいボタン（一覧の行の中）
struct NOMSmallButton: View {
    let title: String
    var filled = false
    var tint: Color = NT.purple
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 12.5, weight: .heavy)).lineLimit(1)
                .foregroundColor(filled ? .white : tint)
                .padding(.horizontal, 12).frame(height: 34)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(filled ? tint : tint.opacity(0.1)))
        }
        .buttonStyle(PressableStyle())
    }
}

/// 丸いチップ（期間・状態の絞り込み）
struct NOMChip: View {
    let title: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 13.5, weight: .bold)).foregroundColor(on ? .white : NT.ink2).lineLimit(1)
                .padding(.horizontal, 13).frame(height: 34)
                .background(Capsule().fill(on ? NT.purple : Color.white))
                .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

/// 数字のタイル（ラベル・金額・小さな説明）
struct NOMStat: View {
    let label: String
    let value: String
    var tone: Color = NT.ink
    var sub: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 18, weight: .heavy)).foregroundColor(tone).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if !sub.isEmpty { Text(sub).font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(2).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
    }
}

/// 何も無いとき（カードの形）
struct NOMEmpty: View {
    let icon: String
    let title: String
    var sub: String = ""

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 24, weight: .semibold)).foregroundColor(NT.ink3)
            Text(title).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink2).multilineTextAlignment(.center)
            if !sub.isEmpty { Text(sub).font(.system(size: 12)).foregroundColor(NT.ink3).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }
}

/// うすい青の説明
struct NOMNote: View {
    let text: String
    var tint: Color = NT.purpleDeep

    var body: some View {
        Text(text).font(.system(size: 12)).foregroundColor(tint).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tint == NT.purpleDeep ? NT.lilac : tint.opacity(0.1)))
    }
}

/// 「レシートを撮って保存」（入出金・仕入経費 → スキャンの画面）
struct NOMSnapCard: View {
    let sub: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "camera.fill").font(.system(size: 20, weight: .bold)).foregroundColor(.white)
                    .frame(width: 44, height: 44).background(Circle().fill(NT.purple))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("レシートを撮って保存").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.purpleDeep)
                        Text("Snap receipt").font(.system(size: 10, weight: .semibold)).foregroundColor(NT.ink3)
                    }
                    Text(sub).font(.system(size: 11.5)).foregroundColor(NT.ink2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6])).foregroundColor(NT.purple.opacity(0.6)))
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }
}

/// 期間のカード（10/1〜10/25 ・ 期間を変える ・ よく使う期間）
struct NOMPeriodCard: View {
    let from: String
    let to: String
    let onPick: () -> Void
    let onSet: (String, String) -> Void

    var body: some View {
        let today = NOS.today
        let presets: [(String, String, String)] = [
            ("過去30日", NOS.addDays(today, -30), today),
            ("今月", NOS.monthFirst(today), today),
            ("先月", NOS.shiftMonth(String(today.prefix(7)), -1) + "-01", NOS.monthLast(NOS.shiftMonth(String(today.prefix(7)), -1) + "-01")),
            ("過去7日", NOS.addDays(today, -6), today),
        ]
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple)
                Text(NOM.period(from, to)).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 4)
                Button(action: onPick) {
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
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }
}

/// 期間を選ぶ（開始日・終了日）
struct NOMRangeSheet: View {
    let onClose: () -> Void
    let onApply: (String, String) -> Void
    @State private var from: Date
    @State private var to: Date

    init(from: String, to: String, onClose: @escaping () -> Void, onApply: @escaping (String, String) -> Void) {
        self.onClose = onClose
        self.onApply = onApply
        _from = State(initialValue: NOS.date(from) ?? Date())
        _to = State(initialValue: NOS.date(to) ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("開始日", selection: $from, displayedComponents: .date)
                    DatePicker("終了日", selection: $to, displayedComponents: .date)
                }
            }
            .environment(\.locale, Locale(identifier: "ja_JP"))
            .navigationTitle("期間を選ぶ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("表示") {
                        let a = NOS.str(from), b = NOS.str(to)
                        onApply(min(a, b), max(a, b))
                    }
                    .font(.system(size: 16, weight: .bold))
                }
            }
        }
    }
}

/// 理由を入れて確かめる（差戻し・締め後修正・再オープン。Web の ConfirmDialog requireReason）
struct NOMReasonPrompt: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let confirm: String
    var placeholder = "理由を入力"
    /// nil＝うまくいった（閉じる）、文字＝エラー（閉じずに出す）
    let run: (String) async -> String?
}

struct NOMReasonSheet: View {
    let prompt: NOMReasonPrompt
    let onDone: () -> Void
    @State private var reason = ""
    @State private var busy = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(prompt.message).font(.system(size: 14)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                    Text("理由").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                    TextField(prompt.placeholder, text: $reason, axis: .vertical)
                        .lineLimit(3...6)
                        .focused($focused)
                        .font(.system(size: 16))
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    if let problem {
                        Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger)
                    }
                    NOMButton(title: busy ? "処理中…" : prompt.confirm, tint: NT.danger, enabled: !busy && !trimmed.isEmpty) {
                        guard !busy, !trimmed.isEmpty else { return }
                        busy = true
                        let text = trimmed
                        Task {
                            let err = await prompt.run(text)
                            busy = false
                            if let err { problem = err } else { onDone() }
                        }
                    }
                }
                .padding(16)
            }
            .background(NT.page.ignoresSafeArea())
            .navigationTitle(prompt.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onDone) } }
            .onAppear { focused = true }
        }
    }
}

/// 金額のテンキー（1〜9・00・0・⌫。電卓と同じ並び）
struct NOMKeypad: View {
    @Binding var text: String
    var maxLength = 9
    var doubleZero = true

    var body: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", doubleZero ? "00" : "C", "0", "⌫"]
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(keys, id: \.self) { k in
                Button { press(k) } label: {
                    Group {
                        if k == "⌫" {
                            Image(systemName: "delete.left").font(.system(size: 20, weight: .bold))
                        } else {
                            Text(k).font(.system(size: 22, weight: .bold))
                        }
                    }
                    .foregroundColor(k == "C" ? NT.danger : NT.ink)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func press(_ k: String) {
        switch k {
        case "C": text = ""
        case "⌫": if !text.isEmpty { text.removeLast() }
        case "00": if !text.isEmpty && text != "0" && text.count + 2 <= maxLength { text += "00" }
        default: if text.count < maxLength { text = (text == "0" ? "" : text) + k }
        }
    }
}

/// 金額を表示する箱（押すとテンキーの入れ先になる）
struct NOMAmountBox: View {
    let label: String
    let value: String
    var active = false
    var big = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(label).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink2).lineLimit(1)
                Spacer(minLength: 6)
                Text(value.isEmpty ? "0" : NOS.int(Double(value) ?? 0))
                    .font(.system(size: big ? 30 : 22, weight: .heavy)).monospacedDigit()
                    .foregroundColor(value.isEmpty ? NT.ink3 : (active ? NT.purpleDeep : NT.ink))
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text("円").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 14).frame(height: big ? 62 : 52)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(active ? NT.purple : NT.line, lineWidth: active ? 2 : 1))
        }
        .buttonStyle(.plain)
    }
}

/// 一覧から 1 人・1 つ選ぶ（担当者・勘定科目など。人数が多くても選べる）
struct NOMPickSheet: View {
    let title: String
    let items: [(id: String, name: String, sub: String)]
    let selected: String?
    var noneLabel: String = ""
    let onPick: (String?) -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if !noneLabel.isEmpty {
                    row(id: nil, name: noneLabel, sub: "")
                }
                ForEach(items, id: \.id) { it in
                    row(id: it.id, name: it.name, sub: it.sub)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
        }
    }

    private func row(id: String?, name: String, sub: String) -> some View {
        Button { onPick(id) } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.system(size: 16, weight: .semibold)).foregroundColor(NT.ink)
                    if !sub.isEmpty { Text(sub).font(.system(size: 12)).foregroundColor(NT.ink3) }
                }
                Spacer()
                if selected == id { Image(systemName: "checkmark").font(.system(size: 15, weight: .bold)).foregroundColor(NT.purple) }
            }
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Web の画面へ（iPhone のネイティブに無いもの：CSV・店舗日次締め・ScanSnap など。道に ?web=1 を付けると Web のまま開く）
struct NOMWebLink: View {
    let title: String
    let sub: String
    var icon: String = "safari"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink2).frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).multilineTextAlignment(.leading)
                    Text(sub).font(.system(size: 11)).foregroundColor(NT.ink3).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                Image(systemName: "arrow.up.right.square").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }
}

/// 右上の「更新」ボタン（読み込み中はくるくる）
struct NOMRefreshButton: View {
    let loading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if loading { ProgressView().tint(.white) } else { Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)) }
            }
            .foregroundColor(.white).frame(width: 44, height: 44)
        }
        .accessibilityLabel("更新")
    }
}
