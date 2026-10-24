import SwiftUI

// 店舗台帳の日付を押したときのカレンダー（2026-10-24 20:20 Ronnie「日付を押すとこういうカレンダー。デザインは TENPO ONE、働きはこれ」）。
// 月ごとの表に、日ごとの組数・人数（キャンセル・無断キャンセルを除く）、仮予約・要連絡がある日は赤い点、日曜・休業日は赤・土曜は青。
// 中身は GET part=ledgerMonth（月間カレンダーと同じ集計）。

struct NLDatePickerPanel: View {
    /// いま台帳で見ている日（'YYYY-MM-DD'）
    let selected: String
    let today: String
    let onPick: (String) -> Void

    @State private var month = ""
    @State private var payloads: [String: NLMonthPayload] = [:]
    @State private var loading = false
    @State private var problem: String?

    private let cellW: CGFloat = 96
    private let cellH: CGFloat = 70

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "calendar").font(.system(size: 16, weight: .semibold)).foregroundColor(NLColor.yellow)
                Text("日付を選ぶ").font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                Spacer()
                if let p = payloads[month] {
                    Text("この月 \(p.monthCount)組・\(p.monthGuests)名").font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(.white.opacity(0.8))
                }
            }
            .padding(.horizontal, 18).frame(height: 54)
            .background(NLColor.navy)

            HStack(spacing: 10) {
                monthButton("chevron.left") { shift(-1) }
                Spacer()
                Text(monthLabel).font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.ink)
                if loading { ProgressView().scaleEffect(0.7) }
                Spacer()
                monthButton("chevron.right") { shift(1) }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)

            HStack(spacing: 0) {
                ForEach(Array(["日", "月", "火", "水", "木", "金", "土"].enumerated()), id: \.offset) { i, w in
                    Text(w).font(.system(size: 13, weight: .heavy))
                        .foregroundColor(i == 0 ? NLColor.red : i == 6 ? NLColor.blue : NLColor.muted)
                        .frame(width: cellW, height: 34)
                }
            }
            .background(NLColor.page)

            VStack(spacing: 0) {
                if let weeks = payloads[month]?.weeks {
                    ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                        HStack(spacing: 0) {
                            ForEach(week, id: \.date) { d in dayCell(d) }
                        }
                        Rectangle().fill(NLColor.line).frame(height: 1)
                    }
                } else {
                    VStack(spacing: 8) {
                        if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red) }
                        else { ProgressView() }
                    }
                    .frame(width: cellW * 7, height: cellH * 5)
                }
            }

            HStack(spacing: 12) {
                Button { month = String(today.prefix(7)) } label: {
                    HStack(spacing: 6) { Image(systemName: "arrow.uturn.backward"); Text("今月を出す") }
                        .font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                        .padding(.horizontal, 14).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
                }
                .buttonStyle(PressableStyle())
                .disabled(month == String(today.prefix(7)))
                Button { onPick(today) } label: {
                    Text("今日へ").font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                        .padding(.horizontal, 14).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.yellow))
                }
                .buttonStyle(PressableStyle())
                Spacer()
                Circle().fill(NLColor.red).frame(width: 10, height: 10)
                Text("仮予約・要連絡あり").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
        }
        .frame(width: cellW * 7)
        .background(Color.white)
        .onAppear { if month.isEmpty { month = String(selected.prefix(7)) } }
        .task(id: month) { await load(month) }
    }

    private var monthLabel: String {
        let y = month.prefix(4), m = Int(month.suffix(2)) ?? 0
        return "\(y)年\(m)月"
    }

    private func monthButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundColor(NLColor.navy)
                .frame(width: 46, height: 40)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.page))
        }
        .buttonStyle(PressableStyle())
    }

    private func dayCell(_ d: NLMonthDay) -> some View {
        let on = d.date == selected
        let isToday = d.date == today
        let red = d.dow == 0 || d.holiday != nil
        let color: Color = on ? .white : !d.inMonth ? NLColor.gray.opacity(0.6) : red ? NLColor.red : d.dow == 6 ? NLColor.blue : NLColor.ink
        return Button { onPick(d.date) } label: {
            VStack(spacing: 3) {
                HStack(spacing: 4) {
                    Text("\(d.day)").font(.system(size: 21, weight: on || isToday ? .heavy : .semibold)).monospacedDigit().foregroundColor(color)
                    if d.attention == true && d.inMonth {
                        Circle().fill(on ? NLColor.yellow : NLColor.red).frame(width: 7, height: 7)
                    }
                }
                if d.inMonth && d.count > 0 {
                    Text("\(d.count)組（\(d.guests)名）").font(.system(size: 11, weight: .bold)).monospacedDigit()
                        .foregroundColor(on ? .white.opacity(0.9) : NLColor.muted).lineLimit(1).minimumScaleFactor(0.7)
                } else if let h = d.holiday, d.inMonth {
                    Text(h).font(.system(size: 10, weight: .bold)).foregroundColor(on ? .white : NLColor.red).lineLimit(1)
                } else {
                    Text(" ").font(.system(size: 11))
                }
            }
            .frame(width: cellW - 6, height: cellH - 6)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NLColor.navy : isToday ? NLColor.yellowSoft : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(isToday && !on ? NLColor.yellow : Color.clear, lineWidth: 2))
            .frame(width: cellW, height: cellH)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.96))
    }

    private func shift(_ n: Int) {
        var y = Int(month.prefix(4)) ?? 2026
        var m = (Int(month.suffix(2)) ?? 1) + n
        if m < 1 { m = 12; y -= 1 }
        if m > 12 { m = 1; y += 1 }
        month = String(format: "%04d-%02d", y, m)
    }

    private func load(_ m: String) async {
        guard !m.isEmpty, payloads[m] == nil else { return }
        loading = true
        defer { loading = false }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "ledgerMonth"), URLQueryItem(name: "month", value: m)]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payloads[m] = try JSONDecoder().decode(NLMonthPayload.self, from: data)
            problem = nil
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "カレンダーを読めませんでした"
        }
    }
}
