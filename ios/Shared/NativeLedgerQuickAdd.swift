import SwiftUI

// スケジュールの空いたマス（赤い今の線より先）を押したときの、その場の受付（2026-10-24 20:21 Ronnie
// 「スケジュールの赤い線より先を押したら予約を足せる」。働きは見本、見た目は TENPO ONE）。
//   左：キーワード（店舗の登録）／右：人数（テンキー・〜）・来店の区分（初回・リピート・常連・不明）
//   「予約登録」＝その卓・その時間・人数・キーワードを入れた予約登録の画面へ（名前・電話はそこで）
//   「直接来店」＝その卓にすぐ案内（ウォークイン。今の時間のマスのときだけ）

struct NLQuickSlot: Equatable {
    let tableId: String
    let tableName: String
    let date: String
    /// 押したところの時刻（分。5 分に切り下げ）
    let minute: Int
    /// 今の時間のあたり（直接来店できる）
    let nearNow: Bool
}

struct NLQuickAddPanel: View {
    let slot: NLQuickSlot
    let onClose: () -> Void
    /// 予約登録の画面へ（人数・範囲の最大・キーワード）
    let onReserve: (_ party: Int, _ partyMax: Int?, _ tags: [String]) -> Void
    /// 直接来店（その卓にすぐ）
    let onWalkIn: (_ party: Int) -> Void

    @State private var partyText = ""
    @State private var maxText: String? = nil
    @State private var visit: String? = nil
    @State private var tags: [String] = []
    @State private var keywords: [String] = []
    @State private var loaded = false

    private static let visits = ["初回", "リピート", "常連", "不明"]
    private let keyW: CGFloat = 78
    private let keyH: CGFloat = 66

    private var party: Int { Int(partyText) ?? 0 }
    private var partyMax: Int? { maxText.flatMap { Int($0) } }
    private var rangeBad: Bool { if let mx = partyMax { return mx < party } else { return maxText != nil } }
    private var ready: Bool { party >= 1 && !rangeBad }

    var body: some View {
        HStack(spacing: 0) {
            // 左：キーワード
            VStack(alignment: .leading, spacing: 12) {
                Text("キーワード").font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.navy)
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if keywords.isEmpty {
                    Text("キーワードは 設定 › 予約台帳設定 › タグ・キーワード から登録できます").font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.muted)
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                            ForEach(keywords, id: \.self) { k in
                                let on = tags.contains(k)
                                Button { if on { tags.removeAll { $0 == k } } else { tags.append(k) } } label: {
                                    Text(k).font(.system(size: 13, weight: .bold)).lineLimit(2).minimumScaleFactor(0.7).multilineTextAlignment(.center)
                                        .foregroundColor(on ? .white : NLColor.ink)
                                        .frame(maxWidth: .infinity).frame(height: 52)
                                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NLColor.navy : Color.white))
                                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? NLColor.navy : NLColor.line, lineWidth: 1.5))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(width: 270)
            .background(NLColor.page)

            // 右：人数のテンキー
            VStack(spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(slot.tableName)・\(nlHm(slot.minute))〜").font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(.white.opacity(0.75))
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(partyText.isEmpty ? "—" : partyText).font(.system(size: 36, weight: .heavy)).monospacedDigit()
                            if let m = maxText { Text("〜\(m.isEmpty ? "？" : m)").font(.system(size: 30, weight: .heavy)).monospacedDigit() }
                            Text("名").font(.system(size: 17, weight: .bold)).opacity(0.75)
                        }
                        .foregroundColor(.white)
                    }
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                            .frame(width: 34, height: 34).background(Circle().fill(Color.white))
                    }
                    .buttonStyle(PressableStyle())
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(NLColor.navy)

                VStack(spacing: 10) {
                    HStack(spacing: 8) {
                        ForEach(Self.visits, id: \.self) { v in
                            let on = visit == v
                            Button { visit = on ? nil : v } label: {
                                Text(v).font(.system(size: 14, weight: .heavy))
                                    .foregroundColor(on ? NLColor.navy : NLColor.ink)
                                    .frame(width: keyW, height: 40)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NLColor.yellow : NLColor.page))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    HStack(alignment: .top, spacing: 8) {
                        VStack(spacing: 8) {
                            ForEach([["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], ["0", "〜", "⌫"]], id: \.self) { row in
                                HStack(spacing: 8) { ForEach(row, id: \.self) { k in key(k) } }
                            }
                        }
                        VStack(spacing: 8) {
                            action("予約登録", fill: NLColor.yellow, ink: NLColor.navy, height: keyH * 2 + 8, enabled: ready) {
                                onReserve(party, partyMax, tags + (visit.map { [$0] } ?? []))
                            }
                            action("直接来店", fill: NLColor.green, ink: .white, height: keyH * 2 + 8, enabled: ready && slot.nearNow) { onWalkIn(partyMax ?? party) }
                        }
                    }
                    Text(slot.nearNow ? "人数を入れて「予約登録」（名前・電話は次の画面）か「直接来店」（すぐ着席）" : "人数を入れて「予約登録」（名前・電話は次の画面）")
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(NLColor.muted)
                    if rangeBad && !(maxText ?? "").isEmpty {
                        Text("最大人数が最小人数より小さいです").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.red)
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 14)
            }
            .frame(width: keyW * 4 + 8 * 3 + 28)
            .background(Color.white)
        }
        .frame(height: 560)
        .task { await loadKeywords() }
    }

    private func key(_ k: String) -> some View {
        Button { press(k) } label: {
            Group {
                if k == "⌫" { Image(systemName: "delete.left").font(.system(size: 22, weight: .semibold)) }
                else { Text(k).font(.system(size: 28, weight: .semibold)).monospacedDigit() }
            }
            .foregroundColor(k == "〜" && maxText != nil ? NLColor.navy : NLColor.ink)
            .frame(width: keyW, height: keyH)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(k == "〜" && maxText != nil ? NLColor.yellow : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
        }
        .buttonStyle(PressableStyle())
    }

    private func action(_ t: String, fill: Color, ink: Color, height: CGFloat, enabled: Bool, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(t).font(.system(size: 17, weight: .heavy)).foregroundColor(ink)
                .multilineTextAlignment(.center)
                .frame(width: keyW, height: height)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fill.opacity(enabled ? 1 : 0.3)))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }

    private func press(_ k: String) {
        switch k {
        case "〜":
            if maxText == nil && party >= 1 { maxText = "" }
        case "⌫":
            if let m = maxText {
                if m.isEmpty { maxText = nil } else { maxText = String(m.dropLast()) }
            } else {
                partyText = String(partyText.dropLast())
            }
        default:
            if let m = maxText {
                let t = m + k
                if t.count <= 3 { maxText = t.hasPrefix("0") ? String(t.drop(while: { $0 == "0" })) : t }
            } else {
                var t = partyText + k
                while t.count > 1 && t.hasPrefix("0") { t.removeFirst() }
                if t.count <= 3 { partyText = t }
            }
        }
    }

    private func loadKeywords() async {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "ledgerEntry"), URLQueryItem(name: "date", value: slot.date)]
        if let data = try? await NativeAPI.shared.send(URLRequest(url: comps.url!)),
           let e = try? JSONDecoder().decode(NRWEntry.self, from: data) {
            keywords = e.keywords
        }
        loaded = true
    }
}
