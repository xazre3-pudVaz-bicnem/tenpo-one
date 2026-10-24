import SwiftUI

// 店舗台帳の「月間カレンダー」（ネイティブ）。Web の /app/reservations/calendar と同じ：
// 日曜始まりの月グリッド、日ごとの組数（名数）、休業日、今日、多い日ほど濃い ／ 日をタップ＝その日のスケジュール（2026-10-24）

struct NLMonthDay: Codable, Hashable { let date: String; let day: Int; let dow: Int; let inMonth: Bool; let count: Int; let guests: Int; let holiday: String?; var attention: Bool? = nil }
struct NLMonthPayload: Codable {
    let today: String
    let month: String
    let weeks: [[NLMonthDay]]
    let monthCount: Int
    let monthGuests: Int
    let busiest: Int
}

struct NativeLedgerMonthView: View {
    let date: String
    let onPickDay: (String) -> Void

    @State private var month = ""
    @State private var payload: NLMonthPayload?
    @State private var error: String?
    private let weekdays = ["日", "月", "火", "水", "木", "金", "土"]
    private let english = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    private let terracotta = Color(red: 188 / 255, green: 89 / 255, blue: 64 / 255)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                header
                if let p = payload {
                    VStack(spacing: 0) {
                        HStack(spacing: 0) {
                            ForEach(0..<7, id: \.self) { i in
                                Text(weekdays[i]).font(.system(size: 13, weight: .bold))
                                    .foregroundColor(i == 0 ? NLColor.red : i == 6 ? NLColor.blue : NLColor.muted)
                                    .frame(maxWidth: .infinity, minHeight: 34).background(NLColor.graySoft)
                            }
                        }
                        ForEach(Array(p.weeks.enumerated()), id: \.offset) { _, week in
                            HStack(spacing: 0) {
                                ForEach(week, id: \.date) { c in cell(c, p) }
                            }
                            .overlay(alignment: .top) { Rectangle().fill(NLColor.line).frame(height: 1) }
                        }
                    }
                    .background(NLColor.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
                    HStack(spacing: 16) {
                        HStack(spacing: 6) { Circle().fill(Color(red: 0.85, green: 0.82, blue: 0.78)).frame(width: 9, height: 9); Text("グレー＝休業日") }
                        HStack(spacing: 6) { RoundedRectangle(cornerRadius: 2).stroke(NLColor.blue, lineWidth: 2).frame(width: 9, height: 9); Text("枠＝今日") }
                        HStack(spacing: 6) { RoundedRectangle(cornerRadius: 2).fill(terracotta.opacity(0.3)).frame(width: 9, height: 9); Text("濃いほど予約が多い日") }
                    }
                    .font(.system(size: 11.5, weight: .medium)).foregroundColor(NLColor.muted)
                } else if let error {
                    Text(error).foregroundColor(NLColor.red).padding(40)
                } else {
                    ProgressView().padding(60).frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
        .onAppear { if month.isEmpty { month = String(date.prefix(7)) } }
        .task(id: month) { if !month.isEmpty { await load() } }
    }

    private var header: some View {
        let y = Int(month.prefix(4)) ?? 0
        let m = Int(month.suffix(2)) ?? 1
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold)).frame(width: 36, height: 36).background(Circle().fill(NLColor.graySoft)) }.buttonStyle(.plain)
            Text("\(String(y))年\(m)月").font(.system(size: 20, weight: .heavy)).foregroundColor(NLColor.navy)
            Text(english[max(0, min(11, m - 1))]).font(.system(size: 11)).foregroundColor(NLColor.muted)
            Button { shift(1) } label: { Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).frame(width: 36, height: 36).background(Circle().fill(NLColor.graySoft)) }.buttonStyle(.plain)
            if let p = payload, p.month != String(p.today.prefix(7)) {
                Button { month = String(p.today.prefix(7)) } label: { Text("今月").font(.system(size: 13, weight: .bold)).padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(NLColor.blueSoft)) }.buttonStyle(.plain)
            }
            Spacer()
            if let p = payload {
                Text("\(p.monthCount)組 \(p.monthGuests)名 ・ 日をタップ＝その日のスケジュール").font(.system(size: 12)).monospacedDigit().foregroundColor(NLColor.muted)
            }
        }
    }

    private func cell(_ c: NLMonthDay, _ p: NLMonthPayload) -> some View {
        let heat = p.busiest > 0 && c.inMonth ? Double(c.guests) / Double(p.busiest) : 0
        let isToday = c.date == p.today
        let closed = c.holiday != nil && c.inMonth
        return Button { onPickDay(c.date) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text("\(c.day)").font(.system(size: 15, weight: .bold)).monospacedDigit()
                        .foregroundColor(!c.inMonth ? NLColor.line : c.dow == 0 || closed ? NLColor.red : c.dow == 6 ? NLColor.blue : NLColor.ink)
                    if isToday { Text("今日").font(.system(size: 10, weight: .bold)).foregroundColor(NLColor.blue).padding(.horizontal, 5).background(Capsule().fill(NLColor.blueSoft)) }
                }
                if closed, let h = c.holiday { Text(h).font(.system(size: 11, weight: .medium)).foregroundColor(NLColor.muted).lineLimit(1) }
                Spacer(minLength: 0)
                if c.count > 0 && c.inMonth {
                    HStack(spacing: 3) {
                        Text("\(c.count)組").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.navy)
                        Text("(\(c.guests)名)").font(.system(size: 11, weight: .medium)).foregroundColor(NLColor.muted)
                    }
                    .monospacedDigit()
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 6).fill(terracotta.opacity(0.1 + heat * 0.25)))
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
            .background(closed ? Color(red: 0.95, green: 0.94, blue: 0.92) : c.date == date ? NLColor.blueSoft : NLColor.card)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(isToday ? NLColor.blue : .clear, lineWidth: 2).padding(2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .leading) { Rectangle().fill(NLColor.line).frame(width: 1) }
    }

    private func shift(_ n: Int) {
        var y = Int(month.prefix(4)) ?? 2026
        var m = (Int(month.suffix(2)) ?? 1) + n
        if m < 1 { m = 12; y -= 1 }
        if m > 12 { m = 1; y += 1 }
        month = String(format: "%04d-%02d", y, m)
    }

    private func load() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "ledgerMonth"), URLQueryItem(name: "month", value: month)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NLMonthPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }
}
