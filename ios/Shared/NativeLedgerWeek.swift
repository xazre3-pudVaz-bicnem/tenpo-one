import SwiftUI

// 店舗台帳の「週間」（ネイティブ）。Web の view=week と同じ：日ごとの組数・名数・満席率・貸切、1時間ごとの組数・名数（多いほど濃い）
// 日付・マスを押すとその日のスケジュール（2026-10-24）

struct NLWeekDay: Codable, Hashable { let date: String; let count: Int; let guests: Int; let occupancy: Int?; let hasPrivate: Bool }
struct NLWeekCell: Codable, Hashable { let date: String; let band: Int; let count: Int; let guests: Int }
struct NLWeekPayload: Codable {
    let today: String
    let date: String
    let weekDates: [String]
    let bandLabels: [String]
    let days: [NLWeekDay]
    let cells: [NLWeekCell]
    let maxCell: Int
    let weekCount: Int
    let weekGuests: Int
}

struct NativeLedgerWeekView: View {
    let date: String
    let onPickDay: (String) -> Void

    @State private var payload: NLWeekPayload?
    @State private var error: String?
    private let weekdays = ["日", "月", "火", "水", "木", "金", "土"]

    var body: some View {
        ScrollView {
            if let p = payload {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("週間").font(.system(size: 18, weight: NT.strong)).foregroundColor(NLColor.navy)
                        Text("Week").font(.system(size: 11)).foregroundColor(NLColor.muted)
                        Text("\(md(p.weekDates.first)) 〜 \(md(p.weekDates.last))").font(.system(size: 13)).foregroundColor(NLColor.muted)
                        Spacer()
                        Text("\(p.weekCount)組 \(p.weekGuests)名 ・ 日付をタップ＝その日のスケジュール").font(.system(size: 12)).foregroundColor(NLColor.muted)
                    }
                    let cellMap = Dictionary(uniqueKeysWithValues: p.cells.map { ("\($0.date)|\($0.band)", $0) })
                    Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                        GridRow {
                            Text("時間帯").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                                .frame(width: 70, height: 76).background(NLColor.graySoft)
                            ForEach(Array(p.days.enumerated()), id: \.offset) { i, d in
                                Button { onPickDay(d.date) } label: {
                                    VStack(spacing: 2) {
                                        HStack(spacing: 4) {
                                            Text("\(Int(d.date.suffix(2)) ?? 0)日（\(weekdays[i])）").font(.system(size: 14, weight: .bold))
                                                .foregroundColor(i == 0 ? NLColor.red : i == 6 ? NLColor.blue : NLColor.ink)
                                            if d.date == p.today { Text("今日").font(.system(size: 10, weight: .bold)).foregroundColor(NLColor.blue).padding(.horizontal, 5).background(Capsule().fill(NLColor.blueSoft)) }
                                        }
                                        Text("\(d.count)組 / \(d.guests)名").font(.system(size: 11.5)).monospacedDigit().foregroundColor(NLColor.muted)
                                        Text(d.occupancy.map { "満席率 \($0)%" } ?? "—").font(.system(size: 11, weight: .bold)).foregroundColor(NLColor.navy)
                                        if d.hasPrivate { Text("貸切あり").font(.system(size: 10, weight: .bold)).foregroundColor(.white).padding(.horizontal, 6).background(Capsule().fill(NLColor.navy)) }
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 76)
                                    .background(d.date == p.date ? NLColor.blueSoft : NLColor.graySoft)
                                    .overlay(alignment: .bottom) { if d.date == p.today { Rectangle().fill(NLColor.blue).frame(height: 3) } }
                                }.buttonStyle(.plain)
                                .overlay(alignment: .leading) { Rectangle().fill(NLColor.line).frame(width: 1) }
                            }
                        }
                        ForEach(Array(p.bandLabels.enumerated()), id: \.offset) { b, label in
                            GridRow {
                                Text(label).font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(NLColor.muted)
                                    .frame(width: 70, height: 44).background(NLColor.card)
                                ForEach(p.weekDates, id: \.self) { d in
                                    let c = cellMap["\(d)|\(b)"]
                                    let heat = c.map { p.maxCell > 0 ? Double($0.guests) / Double(p.maxCell) : 0 } ?? 0
                                    Button { onPickDay(d) } label: {
                                        Group {
                                            if let c {
                                                HStack(spacing: 3) {
                                                    Text("\(c.count)組").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.navy)
                                                    Text("\(c.guests)名").font(.system(size: 12)).foregroundColor(NLColor.muted)
                                                }.monospacedDigit()
                                            } else {
                                                Text("—").foregroundColor(NLColor.line)
                                            }
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                        .background(c == nil ? NLColor.card : NLColor.blue.opacity(0.06 + heat * 0.24))
                                    }.buttonStyle(.plain)
                                    .overlay(alignment: .leading) { Rectangle().fill(NLColor.line).frame(width: 1) }
                                }
                            }
                            .overlay(alignment: .top) { Rectangle().fill(NLColor.line).frame(height: 1) }
                        }
                    }
                    .background(NLColor.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
                }
                .padding(16)
            } else if let error {
                Text(error).foregroundColor(NLColor.red).padding(40)
            } else {
                ProgressView().padding(60)
            }
        }
        .task(id: date) { await load() }
    }

    private func md(_ d: String?) -> String { guard let d else { return "" }; return String(d.dropFirst(5)).replacingOccurrences(of: "-", with: "/") }

    private func load() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "ledgerWeek"), URLQueryItem(name: "date", value: date)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NLWeekPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }
}
