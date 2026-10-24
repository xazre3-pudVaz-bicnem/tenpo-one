import SwiftUI

// 予約登録（iPad ネイティブ）。1 枚の画面：左＝日時・確保時間・人数・おすすめのテーブル・メモ・ステータス・コース・担当・経路、
// 右＝お客様（電話番号で探す）・キーワード、下＝要約と「予約を登録」。テーブルは「すべてのテーブルを見る」で時間の表から選ぶ。
// （2026-10-24 19:28〜19:36 Ronnie「Web の予約登録の機能（予約可能なテーブル・キーワード・確保時間・予約ステータス・担当者・メール）を
//   ネイティブの色で。iPad の見本（Tableo）のような形に、レストランボードの機能で。そのままのコピーはしない」）。
// 卓の空き・人数に合う卓・つなげる卓の決め方は Web と同じ（lib/reservation-entry.ts の tableChoices / tableCombos を Swift に移したもの）。
// その日の卓と予約は GET part=ledgerEntry（Web の getReservationEntryData と同じ中身）。

// MARK: - データ

struct NRWTable: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let capacityMin: Int
    let capacityMax: Int
    let floorName: String?
    let locked: Bool
    let inUse: Bool
}

struct NRWBooked: Decodable, Hashable {
    let id: String?
    let start: String
    let end: String
    let tableIds: [String]
}

struct NRWEntry: Decodable {
    let date: String
    let tables: [NRWTable]
    let booked: [NRWBooked]
    let defaultStay: Int
    var keywords: [String]
    /// 店舗がキーワードを自分で登録したか（false＝初期値）
    let keywordsCustom: Bool
    /// お客様・予約のタグ（区分ごと）
    var tagGroups: [NRWTagGroup]
    let clerks: [NFNamed]
    let courseDurations: [String: Int]

    enum CodingKeys: String, CodingKey { case date, tables, booked, defaultStay, keywords, keywordsCustom, tagGroups, clerks, courseDurations }

    // 古いサーバー（項目が足りない）でも読めるように、無い項目は空にする
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        tables = (try? c.decode([NRWTable].self, forKey: .tables)) ?? []
        booked = (try? c.decode([NRWBooked].self, forKey: .booked)) ?? []
        defaultStay = (try? c.decode(Int.self, forKey: .defaultStay)) ?? 120
        keywords = (try? c.decode([String].self, forKey: .keywords)) ?? []
        keywordsCustom = (try? c.decode(Bool.self, forKey: .keywordsCustom)) ?? false
        tagGroups = (try? c.decode([NRWTagGroup].self, forKey: .tagGroups)) ?? []
        clerks = (try? c.decode([NFNamed].self, forKey: .clerks)) ?? []
        courseDurations = (try? c.decode([String: Int].self, forKey: .courseDurations)) ?? [:]
    }
}

/// 予約ステータス（Web の ENTRY_STATUSES と同じ）
enum NRWStatus: String, CaseIterable {
    case confirmed, pending, needsContact = "needs_contact"
    var label: String { self == .confirmed ? "来店待ち" : self == .pending ? "仮予約" : "要連絡" }
    var hint: String { self == .confirmed ? "予約確定" : self == .pending ? "あとで確定する" : "お客様に連絡が必要" }
}

// MARK: - 空いている卓の計算（lib/reservation-entry.ts と同じ決まり）

enum NRWFit { case just, ok, big, small }

struct NRWChoice: Identifiable {
    let table: NRWTable
    let free: Bool
    /// 空いていない理由（予約あり・使用中・使用不可）
    let reason: String?
    var fit: NRWFit
    var best: Bool
    var id: String { table.id }
}

struct NRWCombo: Identifiable {
    let tables: [NRWTable]
    let seats: Int
    let adjacent: Bool
    var ids: [String] { tables.map(\.id) }
    var id: String { ids.joined(separator: "+") }
}

enum NRWMath {
    static func jst(_ date: String, _ time: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: "\(date) \(time)")
    }

    static func iso(_ s: String) -> Date? {
        let p = ISO8601DateFormatter()
        p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = p.date(from: s) { return d }
        p.formatOptions = [.withInternetDateTime]
        return p.date(from: s)
    }

    /// ピッタリと言える余り（席数の 1/3 まで・最低1）
    static func snugSurplus(_ capacityMax: Int) -> Int { max(1, capacityMax / 3) }

    /// date の time から stay 分のあいだ、どの卓が空いているか・人数に合うか
    static func choices(_ entry: NRWEntry, date: String, time: String, stay: Int, party: Int, today: String, now: Date) -> [NRWChoice] {
        guard let start = jst(date, time) else { return [] }
        let end = start.addingTimeInterval(Double(stay) * 60)
        var busy = Set<String>()
        for b in entry.booked {
            guard let s = iso(b.start), let e = iso(b.end) else { continue }
            if s < end && start < e { b.tableIds.forEach { busy.insert($0) } }
        }
        let nearNow = date == today && start < now.addingTimeInterval(Double(stay) * 60)
        var list: [NRWChoice] = entry.tables.map { t in
            let reason: String? = t.locked ? "使用不可" : busy.contains(t.id) ? "予約あり" : (nearNow && t.inUse) ? "使用中" : nil
            let fit: NRWFit = party > t.capacityMax ? .small : party < t.capacityMin ? .big : .ok
            return NRWChoice(table: t, free: reason == nil, reason: reason, fit: fit, best: false)
        }
        let fitting = list.indices.filter { list[$0].free && list[$0].fit == .ok }
        if let minSurplus = fitting.map({ list[$0].table.capacityMax - party }).min() {
            for i in fitting {
                let surplus = list[i].table.capacityMax - party
                if surplus == minSurplus && surplus <= snugSurplus(list[i].table.capacityMax) {
                    list[i].best = true
                    list[i].fit = .just
                }
            }
        }
        func rank(_ c: NRWChoice) -> Int {
            if !c.free { return 4 }
            switch c.fit { case .just: return 0; case .ok: return 1; case .big: return 2; case .small: return 3 }
        }
        return list.enumerated().sorted { a, b in
            let ra = rank(a.element), rb = rank(b.element)
            if ra != rb { return ra < rb }
            if a.element.fit == .ok && b.element.fit == .ok && a.element.table.capacityMax != b.element.table.capacityMax {
                return a.element.table.capacityMax < b.element.table.capacityMax
            }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// 1つの卓に入らない人数のとき、つなげて使える卓（同じフロアの空いている卓。2卓はどれでも、3〜6卓はとなりどうし）
    static func combos(_ entry: NRWEntry, choices: [NRWChoice], party: Int, limit: Int = 6) -> [NRWCombo] {
        let free = Set(choices.filter(\.free).map(\.table.id))
        var floors: [String: [NRWTable]] = [:]
        var floorOrder: [String] = []
        for t in entry.tables {
            let k = t.floorName ?? ""
            if floors[k] == nil { floorOrder.append(k) }
            floors[k, default: []].append(t)
        }
        var out: [(combo: NRWCombo, first: Int)] = []
        var seen = Set<String>()
        func push(_ list: [NRWTable], _ idx: [Int], adjacent: Bool) {
            let tables = idx.map { list[$0] }
            let seats = tables.reduce(0) { $0 + $1.capacityMax }
            guard seats >= party else { return }
            let key = tables.map(\.id).sorted().joined(separator: "+")
            guard !seen.contains(key) else { return }
            seen.insert(key)
            out.append((NRWCombo(tables: tables, seats: seats, adjacent: adjacent), idx[0]))
        }
        for k in floorOrder {
            let list = floors[k] ?? []
            for i in list.indices where free.contains(list[i].id) {
                for j in (i + 1)..<max(i + 1, list.count) where free.contains(list[j].id) {
                    push(list, [i, j], adjacent: j == i + 1)
                }
            }
            for i in list.indices where free.contains(list[i].id) {
                var idx = [i]
                var j = i + 1
                while j < list.count && idx.count < 6 {
                    if !free.contains(list[j].id) { break }
                    idx.append(j)
                    if idx.count >= 3 { push(list, idx, adjacent: true) }
                    j += 1
                }
            }
        }
        return out.sorted { a, b in
            if a.combo.tables.count != b.combo.tables.count { return a.combo.tables.count < b.combo.tables.count }
            if a.combo.adjacent != b.combo.adjacent { return a.combo.adjacent }
            if a.combo.seats != b.combo.seats { return a.combo.seats < b.combo.seats }
            return a.first < b.first
        }.prefix(limit).map(\.combo)
    }

    /// 'HH:mm' に分を足す（0:00〜23:55 の中）
    static func addMinutes(_ time: String, _ m: Int) -> String {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return time }
        let total = min(23 * 60 + 55, max(0, parts[0] * 60 + parts[1] + m))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    static func stayLabel(_ m: Int) -> String {
        let h = m / 60, r = m % 60
        if h == 0 { return "\(r)分" }
        return r == 0 ? "\(h)時間" : "\(h)時間\(r)分"
    }

    static func minutes(_ time: String) -> Int {
        let p = time.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 ? p[0] * 60 + p[1] : 0
    }
}

// MARK: - 画面

struct NativeReservationEntry: View {
    @ObservedObject var model: NativeLedgerModel
    var prefill: NLReservationPrefill? = nil
    let onClose: () -> Void
    /// 上の「直接来店」（ウォークインの登録へ）
    var onWalkIn: (() -> Void)? = nil

    enum Pop { case date, time, stay }
    /// テンキーで入れているところ：人数（最小）・「〜」のあとの最大人数・「の内子供」
    enum PartyField { case min, max, children }

    @State private var date = ""
    @State private var time = "18:00"
    /// 人数（範囲のときは最小）。「〜」で最大人数（席の割り当ては最大）。子供は「の内子供」（合計に含む）
    @State private var partyMin = 2
    @State private var partyMax: Int? = nil
    @State private var children = 0
    @State private var partyField: PartyField = .min
    /// 次に押した数字で入れ直す（押した直後・欄を切り替えた直後）
    @State private var partyFresh = true
    /// 選んだお客様・予約のタグ（区分のタグ。キーワードは tags）
    @State private var tagLabels: [String] = []
    @State private var tableIds: [String] = []
    @State private var name = ""
    @State private var kana = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var note = ""
    @State private var sourceCode = "phone"
    @State private var courseId = ""
    @State private var tags: [String] = []
    @State private var stayCustom: Int? = nil
    @State private var status: NRWStatus = .confirmed
    @State private var clerkId = ""

    @State private var entry: NRWEntry?
    @State private var entryLoading = false
    @State private var pop: Pop?
    @State private var padText = ""
    @State private var tablesOpen = false
    @State private var hits: [NFCustomerHit] = []
    @State private var saving = false
    @State private var problem: String?
    @State private var now = Date()

    private var p: NLPayload? { model.payload }
    /// キャンセル待ちから予約へ変換
    private var isConvert: Bool { prefill?.waitlistEntryId != nil }
    private var today: String { Self.ymd(Date()) }
    /// 席の割り当て・人数に使う数（範囲のときは最大）
    private var party: Int { max(partyMin, partyMax ?? partyMin) }
    /// 最大人数が最小人数より小さい（確定できない）
    private var partyRangeBad: Bool { if let mx = partyMax { return mx < partyMin } else { return false } }
    /// 「〜」を押して最大人数を入れているところ（まだ数字を入れていない）
    private var partyRangeOpen: Bool { partyField == .max && partyMax == nil }
    private var partyLabel: String {
        var t = partyMax.map { "\(partyMin)〜\($0)名" } ?? "\(partyMin)名"
        if partyRangeOpen { t = "\(partyMin)〜 名" }
        if children > 0 { t += "（うち子供 \(children)）" }
        return t
    }
    private var defaultStay: Int {
        if !courseId.isEmpty, let d = entry?.courseDurations[courseId], d > 0 { return d }
        return entry?.defaultStay ?? 120
    }
    private var stay: Int { stayCustom ?? defaultStay }
    private var choices: [NRWChoice] { choicesAt(time) }
    private func choicesAt(_ t: String) -> [NRWChoice] {
        guard let e = entry, e.date == date else { return [] }
        return NRWMath.choices(e, date: date, time: t, stay: stay, party: party, today: today, now: now)
    }
    private var canSave: Bool {
        !saving && !name.trimmingCharacters(in: .whitespaces).isEmpty && phone.filter(\.isNumber).count >= 10 && partyMin >= 1 && !partyRangeBad && !partyRangeOpen && children <= partyMin && !date.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            HStack(alignment: .top, spacing: 16) {
                leftCard
                rightCard.frame(width: 470)
            }
            .padding(16)
            .frame(maxHeight: .infinity)
            footer
        }
        .background(NLColor.page.ignoresSafeArea())
        .onAppear(perform: setUp)
        .task(id: date) { await loadEntry() }
        .fullScreenCover(isPresented: $tablesOpen) { tablePicker }
    }

    // MARK: 上（閉じる・予約／直接来店）

    private var header: some View {
        HStack(spacing: 14) {
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    .frame(width: 46, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.12)))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("閉じる")
            HStack(spacing: 4) {
                modeTab(isConvert ? "予約へ変換" : "予約", icon: "calendar.badge.plus", on: true) {}
                if let onWalkIn, !isConvert {
                    modeTab("直接来店", icon: "figure.walk", on: false, action: onWalkIn)
                }
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.12)))
            Spacer()
            if let s = p?.store.name {
                Text(s).font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.8)).lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(NLColor.navy)
    }

    private func modeTab(_ t: String, icon: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: icon); Text(t) }
                .font(.system(size: 15, weight: .heavy))
                .foregroundColor(on ? NLColor.navy : .white)
                .padding(.horizontal, 18).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(on ? NLColor.yellow : Color.clear))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: 左

    private var leftCard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top, spacing: 12) {
                    field("日付") {
                        dropButton(icon: "calendar", dateLabel(date, long: true)) { pop = .date }
                            .popover(isPresented: popBinding(.date)) { datePopover }
                    }
                    field("時間") {
                        dropButton(icon: "clock", "\(time)〜") { pop = .time }
                            .popover(isPresented: popBinding(.time)) { timePopover }
                    }
                    field("確保時間") {
                        dropButton(icon: "hourglass", NRWMath.stayLabel(stay) + (stayCustom == nil ? "" : "＊")) { pop = .stay }
                            .popover(isPresented: popBinding(.stay)) { stayPopover }
                    }
                }
                partyKeypad
                tableSection
                divider
                field("要望メモ") { memo }
                field("予約ステータス") { statusPicker }
                HStack(alignment: .top, spacing: 12) {
                    field("コース（任意）") { courseMenu }
                    if !(entry?.clerks ?? []).isEmpty { field("担当者") { clerkMenu } }
                }
                field("予約経路") { sourceGrid }
            }
            .padding(22)
        }
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NLColor.line, lineWidth: 1))
    }

    private var divider: some View { Rectangle().fill(NLColor.line).frame(height: 1) }

    private func popBinding(_ k: Pop) -> Binding<Bool> {
        Binding(get: { pop == k }, set: { if !$0 { pop = nil } })
    }

    private func dropButton(icon: String, _ text: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(NLColor.muted)
                Text(text).font(.system(size: 17, weight: .bold)).monospacedDigit().foregroundColor(NLColor.ink).lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 4)
                Image(systemName: "chevron.down").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
            }
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
        }
        .buttonStyle(PressableStyle())
    }

    private func field<Content: View>(_ title: String, required: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                if required {
                    Text("必須").font(.system(size: 10, weight: .heavy)).foregroundColor(.white)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(NLColor.red))
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // 日付：月の表（日ごとの組数・人数・仮予約／要連絡の赤い点。台帳の日付と同じ。2026-10-24 20:23 Ronnie「全部の日が出るように、上のカレンダーと同じに」）
    private var datePopover: some View {
        NLDatePickerPanel(selected: date, today: today) { d in
            setDate(d)
            pop = nil
        }
    }

    // 時間：時と 5 分ごとの分
    private var timePopover: some View {
        HStack(spacing: 10) {
            pickList(hours.map { String(format: "%02d", $0) }, selected: String(time.prefix(2)), suffix: "時") { h in
                time = "\(h):\(time.suffix(2))"; tableIds = []
            }
            pickList(stride(from: 0, to: 60, by: 5).map { String(format: "%02d", $0) }, selected: String(time.suffix(2)), suffix: "分") { m in
                time = "\(time.prefix(2)):\(m)"; tableIds = []; pop = nil
            }
        }
        .padding(14)
        .frame(width: 300, height: 470)
    }

    private var hours: [Int] {
        let open = max(0, ((p?.openMin ?? 11 * 60) / 60) - 1)
        let close = min(23, max(open + 1, ((p?.closeMin ?? 23 * 60) + 59) / 60))
        var list = Array(open...close)
        let h = NRWMath.minutes(time) / 60
        if !list.contains(h) { list.append(h); list.sort() }
        return list
    }

    private func pickList(_ items: [String], selected: String, suffix: String, onPick: @escaping (String) -> Void) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(items, id: \.self) { v in
                        let on = v == selected
                        Button { onPick(v) } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 2) {
                                Text(v).font(.system(size: 22, weight: on ? .heavy : .medium)).monospacedDigit()
                                Text(suffix).font(.system(size: 12, weight: .bold)).foregroundColor(on ? NLColor.navy : NLColor.muted)
                            }
                            .foregroundColor(on ? NLColor.navy : NLColor.ink)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(on ? NLColor.yellow : Color.white)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(v)
                        Rectangle().fill(NLColor.line).frame(height: 1)
                    }
                }
            }
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .onAppear { proxy.scrollTo(selected, anchor: .center) }
        }
    }

    // 確保時間：−30・−5・＋5・＋30・元に戻す（レストランボードと同じ）
    private var stayPopover: some View {
        VStack(spacing: 14) {
            Text(NRWMath.stayLabel(stay)).font(.system(size: 30, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.ink)
            HStack(spacing: 8) {
                ForEach([-30, -5, 5, 30], id: \.self) { d in
                    Button {
                        let v = min(720, max(15, stay + d))
                        stayCustom = v == defaultStay ? nil : v
                    } label: {
                        Text(d > 0 ? "+\(d)分" : "\(d)分").font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.navy)
                            .frame(width: 74, height: 48)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.page))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            Button { stayCustom = nil } label: {
                Text("元に戻す（\(courseId.isEmpty ? "店の既定" : "コース") \(NRWMath.stayLabel(defaultStay))）").font(.system(size: 14, weight: .bold))
            }
            .disabled(stayCustom == nil)
        }
        .padding(20)
        .frame(width: 360)
    }

    // 人数：テンキー（7 8 9 ／ 4 5 6 ／ 1 2 3 ／ 0 〜 ⌫）。「〜」で 4〜6 人のように範囲、「の内子供」で子供の人数
    // （2026-10-24 Ronnie。席の割り当ては最大人数。子供は合計に含み、最小人数を超えない）
    private let keyW: CGFloat = 96
    private let keyH: CGFloat = 64

    private var partyKeypad: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("人数は何名様ですか？").font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.navy)
            HStack(alignment: .center, spacing: 10) {
                Button { partyField = .min; partyFresh = true } label: { partyDisplay }
                    .buttonStyle(.plain)
                    .frame(width: keyW * 2 + 10, alignment: .leading)
                padKey(children > 0 && partyField != .children ? "の内子供 \(children)" : "の内子供", on: partyField == .children) {
                    partyField = partyField == .children ? .min : .children
                    partyFresh = true
                }
            }
            VStack(spacing: 10) {
                ForEach([["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], ["0", "〜", "⌫"]], id: \.self) { row in
                    HStack(spacing: 10) {
                        ForEach(row, id: \.self) { k in
                            padKey(k, on: k == "〜" && partyField == .max) { pressParty(k) }
                        }
                    }
                }
            }
            if let warn = partyWarning {
                Text(warn).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red)
            }
        }
    }

    private var partyDisplay: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(partyMax.map { "\(partyMin)〜\($0)" } ?? (partyRangeOpen ? "\(partyMin)〜" : "\(partyMin)"))
                    .font(.system(size: 44, weight: .heavy)).monospacedDigit()
                    .foregroundColor(partyField == .children ? NLColor.muted : NLColor.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if partyRangeOpen {
                    Text("？").font(.system(size: 30, weight: .heavy)).foregroundColor(NLColor.gray)
                }
                Text("人").font(.system(size: 20, weight: .bold)).foregroundColor(NLColor.muted)
            }
            if children > 0 || partyField == .children {
                Text("うち子供 \(children)").font(.system(size: 15, weight: .heavy)).monospacedDigit()
                    .foregroundColor(partyField == .children ? NLColor.navy : NLColor.muted)
                    .padding(.horizontal, partyField == .children ? 8 : 0).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 6).fill(partyField == .children ? NLColor.yellow : Color.clear))
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: keyH, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.page))
    }

    private var partyWarning: String? {
        if partyMin < 1 { return "人数を入れてください" }
        if partyRangeOpen { return "「〜」のあとに最大の人数を入れてください" }
        if partyRangeBad { return "最大人数が最小人数より小さいので確定できません" }
        if children > partyMin { return "子供の人数は合計（\(partyMin)人）を超えられません" }
        return nil
    }

    /// テンキーの 1 つ（数字・「〜」・⌫・「の内子供」は同じ大きさ・同じ形）
    private func padKey(_ k: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if k == "⌫" { Image(systemName: "delete.left").font(.system(size: 24, weight: .semibold)) }
                else if k.count > 2 { Text(k).font(.system(size: 17, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7) }
                else { Text(k).font(.system(size: 30, weight: .semibold)).monospacedDigit() }
            }
            .foregroundColor(on ? NLColor.navy : NLColor.ink)
            .frame(width: keyW, height: keyH)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NLColor.yellow : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? NLColor.yellow : NLColor.line, lineWidth: 1.5))
            .shadow(color: Color.black.opacity(0.05), radius: 1, y: 1)
        }
        .buttonStyle(PressableStyle())
    }

    private func pressParty(_ k: String) {
        tableIds = []
        switch k {
        case "〜":
            guard partyField != .max else { return }
            partyField = .max
            partyMax = nil
            partyFresh = true
        case "⌫":
            switch partyField {
            case .min: partyMin /= 10
            case .children: children /= 10
            case .max:
                if let mx = partyMax {
                    let v = mx / 10
                    partyMax = v == 0 ? nil : v
                } else {
                    partyField = .min      // 「〜」を消す
                }
            }
            partyFresh = false
        default:
            guard let d = Int(k) else { return }
            switch partyField {
            case .min: partyMin = partyFresh ? d : min(999, partyMin * 10 + d)
            case .max: partyMax = (partyFresh || partyMax == nil) ? d : min(999, (partyMax ?? 0) * 10 + d)
            case .children: children = partyFresh ? d : min(999, children * 10 + d)
            }
            partyFresh = false
        }
    }

    // おすすめのテーブル（その時間に空いていて人数に合う卓。入らないときはつなげる卓。30 分後も）
    private var tableSection: some View {
        let list = choices
        let fits = list.filter { $0.free && ($0.fit == .just || $0.fit == .ok) }
        let combos = fits.isEmpty && entry != nil ? NRWMath.combos(entry!, choices: list, party: party) : []
        let later = NRWMath.addMinutes(time, 30)
        let fitsLater = later == time ? [] : choicesAt(later).filter { $0.free && ($0.fit == .just || $0.fit == .ok) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("おすすめのテーブル").font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("\(party)名・\(time)〜\(NRWMath.addMinutes(time, stay))").font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundColor(NLColor.muted)
                if entryLoading { ProgressView().scaleEffect(0.7) }
                Spacer()
            }
            if !tableIds.isEmpty {
                let seats = (entry?.tables ?? []).filter { tableIds.contains($0.id) }.reduce(0) { $0 + $1.capacityMax }
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(NLColor.green)
                    Text("\(tableSummary)・\(seats)名席").font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink)
                    if seats < party { Text("（\(party - seats)名分たりません）").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red) }
                    Spacer()
                    Button { tableIds = [] } label: { Text("はずす").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.blue) }.buttonStyle(.plain)
                }
            }
            if entry == nil {
                Text(entryLoading ? "空いている卓を確かめています…" : "卓の情報を読めませんでした").font(.system(size: 13, weight: .semibold)).foregroundColor(NLColor.muted)
            } else if !fits.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 10)], alignment: .leading, spacing: 10) {
                    ForEach(fits.prefix(12)) { c in tableCard(c, time: time) }
                }
            } else if !combos.isEmpty {
                Text("1つの卓に入らないので、つなげて使える卓").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], alignment: .leading, spacing: 10) {
                    ForEach(combos) { c in comboCard(c) }
                }
            } else {
                Text("この時間に \(party)名で入れる卓がありません").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red)
            }
            if !fitsLater.isEmpty && (fits.isEmpty || Set(fitsLater.map(\.id)) != Set(fits.map(\.id))) {
                HStack(spacing: 8) {
                    Text("30分後（\(later)〜）なら").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(fitsLater.prefix(8)) { c in
                                Button { time = later; tableIds = [c.table.id] } label: {
                                    Text(c.table.name).font(.system(size: 13, weight: .heavy)).foregroundColor(NLColor.navy)
                                        .padding(.horizontal, 10).frame(height: 32)
                                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NLColor.page))
                                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(NLColor.line, lineWidth: 1))
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                    }
                }
            }
            Button { tablesOpen = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "rectangle.split.3x3")
                    Text("すべてのテーブルを見る（時間の表）")
                    Image(systemName: "chevron.right")
                }
                .font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.blue)
            }
            .buttonStyle(.plain)
            .disabled(entry == nil)
        }
    }

    private var tableSummary: String {
        let names = (entry?.tables ?? []).filter { tableIds.contains($0.id) }.map(\.name)
        return names.isEmpty ? "テーブル未選択" : names.joined(separator: "+")
    }

    private func tableCard(_ c: NRWChoice, time t: String) -> some View {
        let on = tableIds.contains(c.table.id)
        return Button { toggle(c.table.id) } label: {
            VStack(spacing: 4) {
                Text(c.table.name).font(.system(size: 18, weight: .heavy)).foregroundColor(on ? NLColor.navy : NLColor.ink).lineLimit(1)
                HStack(spacing: 3) {
                    Image(systemName: "person.fill").font(.system(size: 10))
                    Text(c.table.capacityMin == c.table.capacityMax ? "\(c.table.capacityMax)" : "\(c.table.capacityMin)〜\(c.table.capacityMax)")
                }
                .font(.system(size: 12, weight: .bold)).monospacedDigit().foregroundColor(NLColor.muted)
                if c.best {
                    Text("ピッタリ").font(.system(size: 10, weight: .heavy)).foregroundColor(Color(hex: 0x05603A))
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(NLColor.greenSoft))
                }
            }
            .frame(maxWidth: .infinity).frame(height: 84)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NLColor.yellow : NLColor.blueSoft.opacity(0.55)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? NLColor.navy.opacity(0.4) : NLColor.blue.opacity(0.25), lineWidth: on ? 2 : 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func comboCard(_ c: NRWCombo) -> some View {
        let on = Set(c.ids) == Set(tableIds)
        return Button { tableIds = c.ids } label: {
            VStack(spacing: 4) {
                Text(c.tables.map(\.name).joined(separator: "+")).font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.ink).lineLimit(1).minimumScaleFactor(0.7)
                Text("\(c.seats)名席\(c.adjacent ? "・となり" : "")").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
            }
            .frame(maxWidth: .infinity).frame(height: 70)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? NLColor.yellow : NLColor.blueSoft.opacity(0.55)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? NLColor.navy.opacity(0.4) : NLColor.blue.opacity(0.25), lineWidth: on ? 2 : 1))
        }
        .buttonStyle(PressableStyle())
    }

    private func toggle(_ id: String) {
        if tableIds.contains(id) { tableIds.removeAll { $0 == id } } else { tableIds.append(id) }
    }

    private var memo: some View {
        TextEditor(text: $note)
            .font(.system(size: 16))
            .frame(minHeight: 96)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
            .overlay(alignment: .topLeading) {
                if note.isEmpty {
                    Text("ご要望・アレルギー・お店の中のメモ").font(.system(size: 15)).foregroundColor(NLColor.gray).padding(.horizontal, 14).padding(.vertical, 16).allowsHitTesting(false)
                }
            }
    }

    private var statusPicker: some View {
        HStack(spacing: 10) {
            ForEach(NRWStatus.allCases, id: \.self) { s in
                let on = status == s
                Button { status = s } label: {
                    VStack(spacing: 2) {
                        Text(s.label).font(.system(size: 16, weight: .heavy))
                        Text(s.hint).font(.system(size: 11, weight: .semibold)).opacity(0.75)
                    }
                    .foregroundColor(on ? .white : NLColor.ink)
                    .frame(maxWidth: .infinity).frame(height: 58)
                    .background(RoundedRectangle(cornerRadius: 29, style: .continuous).fill(on ? NLColor.navy : NLColor.page))
                    .overlay(RoundedRectangle(cornerRadius: 29, style: .continuous).stroke(on ? NLColor.navy : NLColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func menuLabel(_ text: String, placeholder: Bool) -> some View {
        HStack {
            Text(text).font(.system(size: 16, weight: .semibold)).foregroundColor(placeholder ? NLColor.muted : NLColor.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
        }
        .padding(.horizontal, 14).frame(height: 52)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
    }

    private var courseMenu: some View {
        Menu {
            Button("選ばない（アラカルト）") { courseId = ""; stayCustom = nil }
            ForEach(p?.courses ?? []) { c in Button(c.name) { courseId = c.id; stayCustom = nil } }
        } label: {
            let n = (p?.courses ?? []).first { $0.id == courseId }?.name
            menuLabel(n ?? "選ばない（アラカルト）", placeholder: n == nil)
        }
    }

    private var clerkMenu: some View {
        Menu {
            Button("選ばない") { clerkId = "" }
            ForEach(entry?.clerks ?? []) { c in Button(c.name) { clerkId = c.id } }
        } label: {
            let n = (entry?.clerks ?? []).first { $0.id == clerkId }?.name
            menuLabel(n ?? "選ばない", placeholder: n == nil)
        }
    }

    private var sourceGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
            ForEach(p?.sources ?? [], id: \.code) { s in
                let v = NPVisitSource(id: s.code, label: s.name)
                let on = sourceCode == s.code
                Button { sourceCode = s.code } label: {
                    Text(s.name).font(.system(size: 14, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.6)
                        .foregroundColor(on ? (v.darkText ? NLColor.ink : .white) : v.color)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? v.color : v.color.opacity(0.12)))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? NLColor.navy : v.color.opacity(0.35), lineWidth: on ? 2 : 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    // MARK: 右（お客様・キーワード）

    private var rightCard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                field("電話番号", required: true) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass").foregroundColor(NLColor.muted)
                            TextField("09012345678（入れると前のお客様を探します）", text: $phone)
                                .font(.system(size: 17)).keyboardType(.phonePad)
                        }
                        .padding(.horizontal, 14).frame(height: 54)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
                        if !hits.isEmpty { hitList }
                    }
                }
                .task(id: phone) { await searchCustomer() }
                field("お名前", required: true) { input("山田 太郎", text: $name) }
                field("フリガナ") { input("ヤマダ タロウ", text: $kana) }
                field("メール（任意）") {
                    input("name@example.com", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                divider
                NRWKeywordsEditor(keywords: Binding(get: { entry?.keywords ?? [] }, set: { entry?.keywords = $0 }), selected: $tags, save: NRWLabelsApi.saveKeywords)
                if let groups = entry?.tagGroups, !groups.isEmpty {
                    divider
                    Text("お客様・予約のタグ").font(.system(size: 14, weight: .heavy)).foregroundColor(NLColor.navy)
                    NRWTagGroupsPicker(groups: groups, selected: $tagLabels)
                } else if entry == nil {
                    Text(entryLoading ? "キーワード・タグを読み込んでいます…" : "キーワード・タグを読めませんでした").font(.system(size: 13, weight: .semibold)).foregroundColor(NLColor.muted)
                }
            }
            .padding(22)
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NLColor.line, lineWidth: 1))
    }

    private var hitList: some View {
        VStack(spacing: 0) {
            ForEach(hits.prefix(5)) { h in
                Button {
                    name = h.name
                    if let ph = h.phone, !ph.isEmpty { phone = ph }
                    hits = []
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "person.crop.circle.fill").font(.system(size: 22)).foregroundColor(NLColor.navy2)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(h.name) 様").font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink)
                            Text(h.phone ?? "").font(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundColor(NLColor.muted)
                        }
                        Spacer()
                        Text("このお客様").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.blue)
                    }
                    .padding(.horizontal, 12).frame(height: 54)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Rectangle().fill(NLColor.line).frame(height: 1)
            }
        }
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.page))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func input(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(.system(size: 17)).foregroundColor(NLColor.ink)
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1.5))
    }

    // MARK: 下（要約・キャンセル・登録）

    private var footer: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(isConvert ? "予約へ変換" : "予約の登録").font(.system(size: 12, weight: .heavy)).foregroundColor(NLColor.muted)
                Text("\(partyLabel)・\(dateLabel(date))\(date == today ? "（今日）" : "")・\(time)〜\(NRWMath.addMinutes(time, stay))・\(tableSummary)")
                    .font(.system(size: 16, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.ink).lineLimit(1).minimumScaleFactor(0.7)
                if let warn = staySelectionWarning ?? problem {
                    Text(warn).font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.red).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            Button(action: onClose) {
                HStack(spacing: 6) { Image(systemName: "arrow.left"); Text("キャンセル") }
                    .font(.system(size: 17, weight: .heavy)).foregroundColor(NLColor.navy)
                    .padding(.horizontal, 30).frame(height: 58)
                    .background(RoundedRectangle(cornerRadius: 29, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 29, style: .continuous).stroke(NLColor.navy, lineWidth: 1.5))
            }
            .buttonStyle(PressableStyle())
            Button { Task { await save() } } label: {
                HStack(spacing: 8) { Text(saving ? "登録中…" : "予約を登録"); Image(systemName: "arrow.right") }
                    .font(.system(size: 18, weight: .heavy)).foregroundColor(NLColor.navy)
                    .frame(width: 320, height: 58)
                    .background(RoundedRectangle(cornerRadius: 29, style: .continuous).fill(NLColor.yellow.opacity(canSave ? 1 : 0.45)))
            }
            .buttonStyle(PressableStyle())
            .disabled(!canSave)
        }
        .padding(.horizontal, 22)
        .frame(height: 88)
        .background(Color.white.shadow(color: Color.black.opacity(0.06), radius: 8, y: -2))
    }

    /// 確保時間を延ばして、選んだ卓がほかの予約と重なるとき
    private var staySelectionWarning: String? {
        guard !tableIds.isEmpty else { return nil }
        let bad = choices.filter { tableIds.contains($0.table.id) && !$0.free }.map(\.table.name)
        return bad.isEmpty ? nil : "\(bad.joined(separator: "・")) はこの時間・確保時間だとほかの予約と重なります"
    }

    // MARK: すべてのテーブル（時間の表）

    private let laneW: CGFloat = 76
    private let rowH: CGFloat = 60
    private let nameW: CGFloat = 200

    private var viewRange: (start: Int, end: Int) {
        let s = NRWMath.minutes(time)
        let lo = max(0, ((s - 120) / 30) * 30)
        let hi = min(30 * 60, ((s + stay + 150) / 30) * 30)
        return (lo, max(hi, lo + 240))
    }

    private var tablePicker: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Text("テーブルを選ぶ").font(.system(size: 20, weight: .heavy)).foregroundColor(.white)
                Text("\(dateLabel(date)) \(time)〜\(NRWMath.addMinutes(time, stay))・\(partyLabel)").font(.system(size: 14, weight: .bold)).monospacedDigit().foregroundColor(NLColor.yellow)
                Spacer()
                Text("時間をずらす").font(.system(size: 12, weight: .bold)).foregroundColor(.white.opacity(0.7))
                ForEach([-30, -15, 15, 30], id: \.self) { d in
                    Button {
                        time = NRWMath.addMinutes(time, d)
                        tableIds = tableIds.filter { id in choices.first { $0.table.id == id }?.free ?? false }
                    } label: {
                        Text(d > 0 ? "+\(d)分" : "\(d)分").font(.system(size: 13, weight: .heavy)).monospacedDigit().foregroundColor(.white)
                            .padding(.horizontal, 10).frame(height: 36)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.14)))
                    }
                    .buttonStyle(PressableStyle())
                }
                Button { tablesOpen = false } label: {
                    Text("決める").font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.navy)
                        .padding(.horizontal, 22).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.yellow))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 16)
            .frame(height: 64)
            .background(NLColor.navy)
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: tableIds.isEmpty ? "info.circle" : "checkmark.circle.fill").foregroundColor(tableIds.isEmpty ? NLColor.muted : NLColor.green)
                    Text(tableIds.isEmpty ? "空いている卓の点線の枠を押すと選べます（いくつでも）" : tableSummary).font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink)
                    Spacer()
                    legendItem(NLColor.yellow, "今回の予約")
                    legendItem(NLColor.green, "ピッタリ")
                    legendItem(NLColor.blue.opacity(0.5), "空いている")
                    legendItem(NLColor.box, "ほかの予約")
                }
                timeline(choices)
            }
            .padding(16)
            .frame(maxHeight: .infinity)
        }
        .background(NLColor.page.ignoresSafeArea())
    }

    private func legendItem(_ c: Color, _ t: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 16, height: 10)
            Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
        }
    }

    private func timeline(_ list: [NRWChoice]) -> some View {
        let range = viewRange
        let slots = (range.end - range.start) / 30
        let byId = Dictionary(list.map { ($0.table.id, $0) }, uniquingKeysWith: { a, _ in a })
        let tables = entry?.tables ?? []
        return ScrollView(.vertical) {
            HStack(alignment: .top, spacing: 0) {
                VStack(spacing: 0) {
                    Text("テーブル").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                        .frame(width: nameW - 12, height: 34, alignment: .leading).padding(.leading, 12)
                    Rectangle().fill(NLColor.line).frame(height: 1)
                    if tableIds.isEmpty { nameCell("未割り当て", sub: "卓を選ぶとここから移ります", choice: nil) }
                    ForEach(tables) { t in
                        nameCell(t.name, sub: "\(t.capacityMin == t.capacityMax ? "\(t.capacityMax)" : "\(t.capacityMin)〜\(t.capacityMax)")名席\(t.floorName.map { "・\($0)" } ?? "")", choice: byId[t.id])
                    }
                }
                .frame(width: nameW)
                .background(Color.white)
                .overlay(alignment: .trailing) { Rectangle().fill(NLColor.line).frame(width: 1) }
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 0) {
                            ForEach(0..<slots, id: \.self) { i in
                                let m = range.start + i * 30
                                Text(String(format: "%d:%02d", m / 60, m % 60)).font(.system(size: 12, weight: m % 60 == 0 ? .bold : .regular)).monospacedDigit()
                                    .foregroundColor(m % 60 == 0 ? NLColor.ink : NLColor.muted)
                                    .padding(.leading, 4)
                                    .frame(width: laneW, height: 34, alignment: .leading)
                            }
                        }
                        Rectangle().fill(NLColor.line).frame(height: 1)
                        if tableIds.isEmpty { laneRow(tableId: nil, choice: nil, range: range, slots: slots) }
                        ForEach(tables) { t in laneRow(tableId: t.id, choice: byId[t.id], range: range, slots: slots) }
                    }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NLColor.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func nameCell(_ title: String, sub: String, choice: NRWChoice?) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.ink).lineLimit(1)
                Text(sub).font(.system(size: 11)).foregroundColor(NLColor.muted).lineLimit(1)
            }
            Spacer(minLength: 2)
            if let c = choice {
                if let r = c.reason { badge(r, fg: NLColor.red, bg: NLColor.redSoft) }
                else if c.best { badge("ピッタリ", fg: Color(hex: 0x05603A), bg: NLColor.greenSoft) }
                else if c.fit == .small { badge("小さい", fg: NLColor.muted, bg: NLColor.graySoft) }
                else if c.fit == .big { badge("大きい", fg: NLColor.muted, bg: NLColor.graySoft) }
            }
        }
        .padding(.horizontal, 12)
        .frame(width: nameW, height: rowH)
        .background(choice.map { tableIds.contains($0.table.id) } == true ? NLColor.yellowSoft : Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
    }

    private func badge(_ t: String, fg: Color, bg: Color) -> some View {
        Text(t).font(.system(size: 10, weight: .heavy)).foregroundColor(fg)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: 5).fill(bg))
    }

    private func xPos(_ minute: Int, _ range: (start: Int, end: Int)) -> CGFloat {
        CGFloat(minute - range.start) / 30 * laneW
    }

    private func laneRow(tableId: String?, choice: NRWChoice?, range: (start: Int, end: Int), slots: Int) -> some View {
        let newX = xPos(NRWMath.minutes(time), range)
        let newW = max(laneW * 0.8, CGFloat(stay) / 30 * laneW - 4)
        let selected = tableId.map { tableIds.contains($0) } ?? false
        let spans = bookedSpans(tableId)
        return ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(0..<slots, id: \.self) { i in
                    let m = range.start + i * 30
                    let closed = m < (p?.openMin ?? 0) || m >= (p?.closeMin ?? 24 * 60)
                    Rectangle().fill(closed ? NLColor.graySoft.opacity(0.6) : Color.clear)
                        .frame(width: laneW, height: rowH)
                        .overlay(alignment: .leading) { Rectangle().fill(NLColor.line).frame(width: m % 60 == 0 ? 1 : 0.5) }
                }
            }
            ForEach(Array(spans.enumerated()), id: \.offset) { _, sp in
                let bx = xPos(sp.start, range)
                let bw = max(laneW * 0.6, CGFloat(sp.end - sp.start) / 30 * laneW - 4)
                HStack(spacing: 0) {
                    Text(sp.label).font(.system(size: 12, weight: .bold)).foregroundColor(.white).lineLimit(1).padding(.horizontal, 8)
                    Spacer(minLength: 0)
                }
                .frame(width: bw, height: rowH - 16)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NLColor.box.opacity(0.85)))
                .offset(x: max(0, bx) + 2, y: 8)
            }
            if tableId == nil || selected {
                newBar(width: newW, removable: selected).offset(x: max(0, newX) + 2, y: 6)
            } else if let c = choice, c.free {
                Button { toggle(c.table.id) } label: {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill((c.best ? NLColor.greenSoft : NLColor.blueSoft).opacity(0.7))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(c.best ? NLColor.green : NLColor.blue.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                        .overlay(alignment: .leading) {
                            HStack(spacing: 6) {
                                Image(systemName: "plus.circle.fill")
                                Text(c.best ? "ここに入れる（ピッタリ）" : c.fit == .small ? "ここに入れる（席が足りません）" : "ここに入れる")
                            }
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundColor(c.best ? Color(hex: 0x05603A) : NLColor.blue)
                            .padding(.leading, 10)
                        }
                        .frame(width: newW, height: rowH - 12)
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .offset(x: max(0, newX) + 2, y: 6)
            }
        }
        .frame(width: CGFloat(slots) * laneW, height: rowH, alignment: .topLeading)
        .background(selected ? NLColor.yellowSoft.opacity(0.5) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
    }

    private func newBar(width: CGFloat, removable: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "person.2.fill").font(.system(size: 12, weight: .bold))
            Text("\(party)名 \(name.isEmpty ? "今回のご予約" : "\(name) 様")").font(.system(size: 13, weight: .heavy)).lineLimit(1)
            Spacer(minLength: 0)
            if removable { Image(systemName: "xmark.circle.fill").font(.system(size: 15)).opacity(0.7) }
        }
        .foregroundColor(NLColor.navy)
        .padding(.horizontal, 10)
        .frame(width: width, height: rowH - 12)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NLColor.yellow))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(NLColor.navy.opacity(0.3), lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { if removable { tableIds = [] } }
    }

    /// その卓のほかの予約（分）。台帳の日なら名前も
    private func bookedSpans(_ tableId: String?) -> [(start: Int, end: Int, label: String)] {
        guard let tableId, let e = entry, e.date == date else { return [] }
        let names: [String: NLReservation] = (p?.date == date) ? Dictionary((p?.reservations ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) : [:]
        return e.booked.filter { $0.tableIds.contains(tableId) }.map { b in
            let s = nlJstMinutes(b.start, dayStart: date)
            let en = max(nlJstMinutes(b.end, dayStart: date), s + 15)
            var label = "予約あり"
            if let id = b.id, let r = names[id] { label = "\(r.partySize)名 \(r.guestName.hasSuffix("様") ? r.guestName : "\(r.guestName) 様")" }
            return (s, en, label)
        }
    }

    // MARK: 読み込み・登録

    private func setUp() {
        now = Date()
        if let pf = prefill {
            date = pf.date; time = pf.time; partyMin = max(1, pf.adults); name = pf.name; phone = pf.phone; note = pf.note
            partyMax = pf.partyMax; children = pf.children; tableIds = pf.tableIds; tags = pf.tags
            partyFresh = true
            return
        }
        let base = model.date ?? p?.date ?? today
        date = base
        if base == today {
            // 今日は「いまから 15 分後」をちょうどの 15 分に
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
            let c = cal.dateComponents([.hour, .minute], from: Date())
            let m = ((c.hour ?? 18) * 60 + (c.minute ?? 0) + 15 + 14) / 15 * 15
            time = m >= 24 * 60 ? "23:45" : String(format: "%02d:%02d", m / 60, m % 60)
        }
    }

    private func setDate(_ d: String) {
        guard d != date else { return }
        date = d
        tableIds = []
    }

    private func loadEntry() async {
        guard !date.isEmpty else { return }
        entryLoading = true
        defer { entryLoading = false }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "ledgerEntry"), URLQueryItem(name: "date", value: date)]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let e = try JSONDecoder().decode(NRWEntry.self, from: data)
            if e.date == date { entry = e; now = Date(); problem = nil }
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "卓の空きを読めませんでした（テーブルなしで登録できます）"
        }
    }

    /// 電話番号で前のお客様を探す（4 けた以上。来店登録と同じ customerSearch）
    private func searchCustomer() async {
        let q = phone.filter { $0.isNumber || $0 == "-" }
        guard q.filter(\.isNumber).count >= 4 else { hits = []; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "customerSearch"), URLQueryItem(name: "phone", value: q)]
        guard let data = try? await NativeAPI.shared.send(URLRequest(url: comps.url!)),
              let r = try? JSONDecoder().decode(NFCustomerSearch.self, from: data) else { return }
        // もう選んだお客様（名前と電話が同じ）なら出さない
        hits = r.results.filter { !($0.name == name && ($0.phone ?? "") == phone) }
    }

    private func save() async {
        problem = nil
        if let warn = staySelectionWarning { problem = warn; return }
        saving = true
        defer { saving = false }
        var input: [String: Any] = [
            "date": date,
            "time": time,
            "adults": party - min(children, party),
            "children": min(children, party),
            "partySizeMin": partyMax != nil && partyMin < party ? partyMin : NSNull(),
            "name": name,
            "kana": kana,
            "phone": phone,
            "email": email.trimmingCharacters(in: .whitespaces),
            "note": note,
            "sourceCode": sourceCode,
            "courseId": courseId.isEmpty ? NSNull() : courseId,
            "tableIds": tableIds,
            "stayMinutes": stay,
            "status": status.rawValue,
            "tags": tags + tagLabels.filter { !tags.contains($0) },
            "clerkId": clerkId.isEmpty ? NSNull() : clerkId,
        ]
        if let w = prefill?.waitlistEntryId { input["waitlistEntryId"] = w }
        if await model.act(["type": "ledgerCreate", "input": input]) != nil {
            model.date = date
            await model.refresh(silent: true)
            model.show(toast: isConvert ? "予約へ変換しました" : "予約を登録しました")
            onClose()
        } else {
            problem = model.error ?? "登録できませんでした"
        }
    }

    // MARK: 日付の小物

    static func ymd(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    static func dateFrom(_ s: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)
    }

    static func shift(_ s: String, _ days: Int) -> String {
        guard let d = dateFrom(s) else { return s }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return ymd(cal.date(byAdding: .day, value: days, to: d) ?? d)
    }

    /// 0=日〜6=土
    static func weekday(_ s: String) -> Int {
        guard let d = dateFrom(s) else { return 1 }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return cal.component(.weekday, from: d) - 1
    }

    private func dateLabel(_ s: String, long: Bool = false) -> String {
        guard s.count == 10 else { return s }
        let w = ["日", "月", "火", "水", "木", "金", "土"][Self.weekday(s)]
        let m = Int(s.dropFirst(5).prefix(2)) ?? 0
        let d = Int(s.suffix(2)) ?? 0
        return long ? "\(s.prefix(4))/\(m)/\(d)（\(w)）" : "\(m)/\(d)（\(w)）"
    }
}
