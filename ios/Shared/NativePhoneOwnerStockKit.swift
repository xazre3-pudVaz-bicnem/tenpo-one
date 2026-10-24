import SwiftUI

// iPhone の店長・オーナー：在庫・品切れ（残り数）・仕入先・発注・原価管理で共通の部品（2026-10-25 Ronnie「iPhone も native に」）。
// iPad の画面・型は使わない（iPad を壊さない）。サーバーは iPad と同じ GET part ／ POST type（返事の形は変えない。使うところだけ読む）。
// 色は NT（上のバー＝ネイビー・主の色＝青・地＝うすい灰色・白い角丸のカード）。枠は NPOFrame・NPOCDetailFrame・NPOCSheetFrame。

/// id と名前（店舗・仕入先・品目の選択肢）
struct NPZNamed: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

/// POST の返事
struct NPZResult {
    let ok: Bool
    let error: String?
    let id: String?
    let json: [String: Any]?
}

/// 読み込み（GET ?part=）・操作（POST { type: … }）。見本（-tenpoNativePreview）のときは通信しない
enum NPZApi {
    static func get<T: Decodable>(_ type: T.Type, _ part: String, _ query: [String: String] = [:]) async throws -> T {
        try await NativeModuleAPI.get(T.self, part: part, query: query)
    }

    /// 前に読んだ中身（開いた瞬間に出す。裏で読み直す）
    static func cached<T: Decodable>(_ type: T.Type, _ part: String, _ query: [String: String] = [:]) -> T? {
        NativeModuleAPI.cached(T.self, part: part, query: query)
    }

    static func post(_ body: [String: Any]) async -> NPZResult {
        if NativePreview.current != nil { return NPZResult(ok: true, error: nil, id: nil, json: nil) }
        let r = await NSPApi.postJSON(body)
        return NPZResult(ok: r.ok, error: r.ok ? nil : (r.error ?? "うまくいきませんでした"), id: r.json?["id"] as? String, json: r.json)
    }

    static func message(_ error: Error) -> String { NativeModuleAPI.message(error) }

    /// サーバーが「Web の画面で」と言った（機能が無効・店舗を選んでいない）
    static func useWeb(_ error: Error) -> Bool { (error as? NativeAPIError)?.useWeb == true }
}

/// 数・お金・日付の書き方（Web と同じ）
enum NPZ {
    /// 数量（整数なら小数なし。余分な 0 は出さない）
    static func q(_ v: Double) -> String {
        guard v.isFinite else { return "—" }
        if v == v.rounded() && abs(v) < 1e15 { return String(Int(v)) }
        var s = String(format: "%.3f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    static func q(_ v: Double?) -> String { v.map { q($0) } ?? "—" }

    /// +3 ／ −2.5
    static func signed(_ v: Double) -> String { (v > 0 ? "+" : "") + q(v) }

    static func yen(_ v: Double?) -> String {
        guard let v, v.isFinite, abs(v) < 1e15 else { return "—" }
        return NT.yen(Int(v.rounded()))
    }

    /// 2026-10-24 → 2026/10/24
    static func date(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "—" }
        let p = s.prefix(10).split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return s }
        return "\(y)/\(m)/\(d)"
    }

    /// 2026-10-24 → 10/24
    static func md(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "—" }
        let p = s.prefix(10).split(separator: "-")
        guard p.count == 3, let m = Int(p[1]), let d = Int(p[2]) else { return s }
        return "\(m)/\(d)"
    }

    /// ISO の日時 → 2026/10/24 12:05（日本時間）
    static func dateTime(_ iso: String?) -> String { NPOCFmt.dateTime(iso) }

    /// 入力の数（全角・カンマも受ける）。空・読めなければ nil
    static func num(_ s: String) -> Double? {
        let half = s.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? s
        let t = half.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let v = Double(t), v.isFinite else { return nil }
        return v
    }

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// 空なら NSNull（サーバーへ送る任意の文字）
    static func textOrNull(_ s: String) -> Any {
        let t = trimmed(s)
        return t.isEmpty ? NSNull() : t
    }

    /// 数か NSNull（サーバーへ送る任意の数）
    static func numOrNull(_ s: String) -> Any { num(s).map { $0 as Any } ?? NSNull() }
}

// MARK: - 部品

/// 上の数字の札（2 列に並べる）
struct NPZTile: View {
    let label: String
    let value: String
    var tone: Color = NT.ink
    var sub: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1)
            Text(value).font(.system(size: 20, weight: .heavy)).foregroundColor(tone).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
            if !sub.isEmpty {
                Text(sub).font(.system(size: 10.5)).foregroundColor(NT.ink3).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(npocCard(14))
    }
}

/// 2 列の札の並び
struct NPZTileGrid<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        let inner = content()
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) { inner }
    }
}

/// 探す（白い角丸）
struct NPZSearchField: View {
    @Binding var text: String
    var placeholder = "名前で探す"
    var onSubmit: () -> Void = {}

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink3)
            TextField(placeholder, text: $text)
                .font(.system(size: 16))
                .submitLabel(.search)
                .onSubmit { onSubmit() }
            if !text.isEmpty {
                Button {
                    text = ""
                    onSubmit()
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 16)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).frame(height: 44)
        .background(npocCard(12))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

/// 横に流れる丸い札の並び（タブ・絞り込み）
struct NPZChipRow: View {
    let items: [(String, String)]
    let selection: String
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.0) { it in
                    NPOCChip(text: it.1, selected: it.0 == selection) { onSelect(it.0) }
                }
            }
            .padding(.vertical, 1)
        }
    }
}

/// カードの中の 1 行（見出し・値）
struct NPZInfoRow: View {
    let label: String
    let value: String
    var tone: Color = NT.ink

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3)
            Spacer(minLength: 8)
            Text(value).font(.system(size: 14.5, weight: .bold)).foregroundColor(tone).monospacedDigit()
                .multilineTextAlignment(.trailing).lineLimit(3)
        }
        .padding(.vertical, 2)
    }
}

/// うすい線
struct NPZDivider: View {
    var inset: CGFloat = 0
    var body: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, inset) }
}

/// ラベルつきの入力欄（白い角丸）
struct NPZTextField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var number = false
    var suffix = ""

    var body: some View {
        NPOCField(label: label) {
            HStack(spacing: 6) {
                TextField(placeholder, text: $text)
                    .keyboardType(number ? .decimalPad : .default)
                    .font(.system(size: 17, weight: .semibold)).foregroundColor(NT.ink)
                if !suffix.isEmpty { Text(suffix).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3) }
            }
            .npocInputBox()
        }
    }
}

/// 数字のキー（3×4）。decimal なら「.」、そうでなければ「C」
struct NPZKeypad: View {
    @Binding var text: String
    var decimal = true
    var maxLength = 10

    var body: some View {
        let keys: [String] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "." : "C", "0", "⌫"]
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(keys, id: \.self) { k in
                Button { tap(k) } label: {
                    Group {
                        if k == "⌫" {
                            Image(systemName: "delete.left").font(.system(size: 20, weight: .bold))
                        } else {
                            Text(k).font(.system(size: 24, weight: .bold))
                        }
                    }
                    .foregroundColor(k == "C" ? NT.danger : NT.ink)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func tap(_ k: String) {
        switch k {
        case "C":
            text = ""
        case "⌫":
            if !text.isEmpty { text.removeLast() }
        case ".":
            if text.contains(".") { return }
            text = text.isEmpty ? "0." : text + "."
        default:
            guard text.count < maxLength else { return }
            text = text == "0" ? k : text + k
        }
    }
}

/// 数を入れるシート（棚卸の実数・残り数・入荷数）。大きい字＋テンキー。押した数で置きかわる
struct NPZNumberSheet: View {
    let title: String
    var caption: String = ""
    var unit: String = ""
    let initial: Double?
    var decimal = true
    /// 近道（字・値）。「理論在庫と同じ」「残り全部」など
    var shortcuts: [(String, Double)] = []
    /// 「未入力に戻す」を出す（棚卸の実数）
    var allowClear = false
    var okLabel = "決定"
    /// 「決定して次へ」（nil なら出さない）
    var onNext: ((Double?) -> Void)? = nil
    let onDone: (Double?) -> Void
    let onCancel: () -> Void

    @State private var text = ""
    @State private var touched = false

    private var value: Double? { touched ? NPZ.num(text) : initial }

    private var display: String {
        if touched { return text.isEmpty ? "0" : text }
        return initial.map { NPZ.q($0) } ?? "—"
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button("キャンセル", action: onCancel).font(.system(size: 16, weight: .semibold)).foregroundColor(NT.ink2)
                Spacer()
                if allowClear {
                    Button("未入力に戻す") { onDone(nil) }.font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger)
                }
            }
            .padding(.horizontal, 18).padding(.top, 14)
            VStack(spacing: 3) {
                Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.center)
                if !caption.isEmpty { Text(caption).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3) }
            }
            .padding(.horizontal, 18)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(display).font(.system(size: 44, weight: .heavy)).foregroundColor(touched ? NT.ink : NT.ink3).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.5)
                if !unit.isEmpty { Text(unit).font(.system(size: 18, weight: .bold)).foregroundColor(NT.ink2) }
            }
            .padding(.horizontal, 18)
            if !shortcuts.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(shortcuts.enumerated()), id: \.offset) { _, s in
                        Button {
                            text = NPZ.q(s.1)
                            touched = true
                        } label: {
                            VStack(spacing: 0) {
                                Text(s.0).font(.system(size: 13, weight: .heavy))
                                Text(NPZ.q(s.1) + unit).font(.system(size: 10.5, weight: .semibold)).opacity(0.75).monospacedDigit()
                            }
                            .foregroundColor(NT.purpleDeep)
                            .frame(maxWidth: .infinity).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 18)
            }
            NPZKeypad(text: Binding(get: { text }, set: { text = $0; touched = true }), decimal: decimal)
                .padding(.horizontal, 18)
            HStack(spacing: 8) {
                if let onNext {
                    Button { onNext(value) } label: {
                        Text("決定して次へ").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.purpleDeep)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
                Button { onDone(value) } label: {
                    Text(okLabel).font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 18)
            Spacer(minLength: 0)
        }
        .background(Color.white.ignoresSafeArea())
        .environment(\.colorScheme, .light)
    }
}

/// − 数 ＋（大きく押せる。数を押すとテンキー）
struct NPZBigStepper: View {
    let value: String
    var unit: String = ""
    /// 未入力（灰色の字）
    var placeholder = false
    var tint: Color = NT.ink
    var minusEnabled = true
    var plusEnabled = true
    let onMinus: () -> Void
    let onPlus: () -> Void
    let onTap: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            stepButton("minus", enabled: minusEnabled, action: onMinus)
            Button(action: onTap) {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(value).font(.system(size: placeholder ? 16 : 24, weight: .heavy)).monospacedDigit()
                        .foregroundColor(placeholder ? NT.ink3 : tint).lineLimit(1).minimumScaleFactor(0.5)
                    if !unit.isEmpty { Text(unit).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3) }
                }
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(placeholder ? NT.page : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(placeholder ? NT.line : NT.lilacLine, lineWidth: 1.5))
            }
            .buttonStyle(PressableStyle())
            stepButton("plus", enabled: plusEnabled, action: onPlus)
        }
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 20, weight: .heavy)).foregroundColor(enabled ? NT.purpleDeep : NT.ink3)
                .frame(width: 56, height: 52)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(enabled ? NT.lilac : NT.page))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }
}

/// 一覧から選ぶシート（品目・仕入先・食材）。名前で探せる
struct NPZPickOption: Identifiable, Hashable {
    let id: String
    let title: String
    var sub: String = ""
}

struct NPZPickSheet: View {
    let title: String
    let options: [NPZPickOption]
    let selected: String?
    let onPick: (String) -> Void
    let onClose: () -> Void
    @State private var query = ""

    private var filtered: [NPZPickOption] {
        let t = NPZ.trimmed(query)
        if t.isEmpty { return options }
        return options.filter { $0.title.localizedCaseInsensitiveContains(t) || $0.sub.localizedCaseInsensitiveContains(t) }
    }

    var body: some View {
        let list = filtered
        return NPOCSheetFrame(title: title, cancelText: "閉じる", onCancel: onClose, onConfirm: nil) {
            NPZSearchField(text: $query, placeholder: "名前で探す")
            if list.isEmpty {
                NPOCEmpty(icon: "magnifyingglass", title: "見つかりません")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(list) { o in
                        Button { onPick(o.id) } label: { row(o) }
                            .buttonStyle(.plain)
                        if o.id != list.last?.id { NPZDivider(inset: 14) }
                    }
                }
                .background(npocCard())
            }
        }
    }

    private func row(_ o: NPZPickOption) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(o.title).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink).multilineTextAlignment(.leading)
                if !o.sub.isEmpty { Text(o.sub).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1) }
            }
            Spacer(minLength: 6)
            if o.id == selected {
                Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundColor(NT.purple)
            }
        }
        .padding(.horizontal, 14).frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

/// 選んだものを見せて、押すと一覧から選ぶ（Web の <select> の代わり）
struct NPZPickButton: View {
    let label: String
    let value: String?
    var placeholder = "選んでください"
    let action: () -> Void

    var body: some View {
        NPOCField(label: label) {
            Button(action: action) {
                HStack(spacing: 8) {
                    Text(value ?? placeholder).font(.system(size: 16, weight: .semibold))
                        .foregroundColor(value == nil ? NT.ink3 : NT.ink).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                }
                .npocInputBox()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

/// 理由が要る確認（取消・削除。Web の ConfirmDialog requireReason）
struct NPZReasonSheet: View {
    let title: String
    let message: String
    let okText: String
    let busy: Bool
    /// 理由を受け取って送る。nil＝できた、字＝エラー
    let send: (String) async -> String?
    let onClose: () -> Void
    @State private var reason = ""
    @State private var error: String?

    var body: some View {
        NPOCSheetFrame(title: title, confirmText: okText, busy: busy, onCancel: onClose, onConfirm: { Task { await save() } }) {
            Text(message).font(.system(size: 15)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            NPOCField(label: "理由（必須）") {
                TextField("理由を入力", text: $reason, axis: .vertical)
                    .lineLimit(2...5)
                    .font(.system(size: 16))
                    .npocInputBox()
            }
            if let error {
                Text(error).font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        let r = NPZ.trimmed(reason)
        guard !r.isEmpty else { error = "理由を入力してください"; return }
        error = nil
        if let e = await send(r) { error = e } else { onClose() }
    }
}

/// 日付（空にできる。yyyy-MM-dd）
struct NPZDateField: View {
    let label: String
    @Binding var value: String

    var body: some View {
        NPOCField(label: label) {
            HStack(spacing: 8) {
                if value.isEmpty {
                    Button { value = NPDate.str(Date()) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "calendar").font(.system(size: 14, weight: .bold))
                            Text("日付を入れる").font(.system(size: 15, weight: .bold))
                        }
                        .foregroundColor(NT.purpleDeep)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                } else {
                    DatePicker("", selection: Binding(get: { NPDate.date(value) }, set: { value = NPDate.str($0) }), displayedComponents: .date)
                        .datePickerStyle(.compact).labelsHidden()
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    Spacer()
                    Button { value = "" } label: {
                        Text("クリア").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.danger)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).frame(minHeight: 48)
            .background(npocCard(12))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }
}

/// 白いカードの見出し（左に題・右に小さい字）
struct NPZCardHead: View {
    let title: String
    var trailing: String = ""

    var body: some View {
        HStack {
            Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink)
            Spacer()
            if !trailing.isEmpty { Text(trailing).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3) }
        }
    }
}

/// 上のバーの右の「更新」（読み込み中はくるくる）
struct NPZRefreshButton: View {
    let loading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if loading { ProgressView().tint(.white) } else { Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)) }
            }
            .foregroundColor(.white).frame(width: 40, height: 40)
        }
        .accessibilityLabel("更新")
    }
}
