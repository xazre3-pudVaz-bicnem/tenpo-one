import SwiftUI

// App Store の画面写真用の見本（iPad のホーム・テーブル一覧・店舗台帳）。ログインしなくてもシミュレーターで出せる。
// 起動の引数 -tenpoNativePreview home|floor|ledger（横向きは -tenpoNativeLandscape YES も）。お店で使うときは出ない。
// 店・お客様・金額はすべて架空（実在の人・店・他社のロゴは使わない）。平日の夜 19:42、混んでいる居酒屋。
// 中身はサーバーと同じ形の JSON を組み立てて、同じ型（NHPayload・NFPayload・NLPayload）に読ませる
// （init の引数の並びを間違えない・サーバーの形が変わったら画面の下に赤で出る）。2026-10-25

// MARK: - 見本の時計

/// 見本の日時：今日（土・日なら前の金曜）の日本時間。「今」は 19:42:18
struct NSPClock {
    static let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Tokyo") ?? .current
        return c
    }()

    let year: Int
    let month: Int
    let day: Int

    init() {
        let today = Date()
        // 1 = 日 … 7 = 土。週末なら金曜の夜にする（平日の夜の見本）
        let weekday = Self.cal.component(.weekday, from: today)
        let back = weekday == 7 ? -1 : (weekday == 1 ? -2 : 0)
        let d = Self.cal.date(byAdding: .day, value: back, to: today) ?? today
        let c = Self.cal.dateComponents([.year, .month, .day], from: d)
        year = c.year ?? 2026
        month = c.month ?? 10
        day = c.day ?? 23
    }

    static func two(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    /// 2026-10-23
    var ymd: String { "\(year)-\(Self.two(month))-\(Self.two(day))" }
    /// 2026/10/23
    var slashYmd: String { "\(year)/\(Self.two(month))/\(Self.two(day))" }

    func date(_ h: Int, _ m: Int, _ s: Int = 0) -> Date {
        Self.cal.date(from: DateComponents(year: year, month: month, day: day, hour: h, minute: m, second: s)) ?? Date()
    }

    /// エポックのミリ秒（整数で JSON に書く。Double の項目にもそのまま入る）
    func ms(_ h: Int, _ m: Int, _ s: Int = 0) -> Int { Int(date(h, m, s).timeIntervalSince1970 * 1000) }
    /// 2026-10-23T19:15:00+09:00
    func iso(_ h: Int, _ m: Int) -> String { "\(ymd)T\(Self.two(h)):\(Self.two(m)):00+09:00" }
    /// 19:15
    func hm(_ h: Int, _ m: Int) -> String { "\(Self.two(h)):\(Self.two(m))" }
    /// n 日前の ISO（予約を受けた日時）
    func isoDaysBefore(_ n: Int, _ h: Int, _ m: Int) -> String {
        ISO8601DateFormatter().string(from: date(h, m).addingTimeInterval(-Double(n) * 86_400))
    }

    var now: Date { date(19, 42, 18) }
    var nowMs: Int { ms(19, 42, 18) }
}

// MARK: - JSON の部品

enum NSPJson {
    /// 読めなかったときの中身（見本の画面の下に赤で出す。どの項目が合わないかがわかる）
    static var problems: [String] = []

    /// 文字列（nil は null）
    static func s(_ v: String?) -> String {
        guard let v else { return "null" }
        return "\"" + v.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    static func i(_ v: Int?) -> String { v.map { "\($0)" } ?? "null" }

    static func arr(_ items: [String]) -> String { "[" + items.joined(separator: ",") + "]" }

    static func strs(_ v: [String]) -> String { arr(v.map { s($0) }) }

    static func decode<T: Decodable>(_ type: T.Type, _ json: String, label: String) -> T? {
        do {
            return try JSONDecoder().decode(T.self, from: Data(json.utf8))
        } catch {
            problems.append("見本 \(label) を読めません: \(error)")
            return nil
        }
    }
}

// MARK: - 見本のデータ（サーバーの /api/app/v1/pos?part=home|floor|ledger と同じ形）

enum NSPData {
    static let storeJson = #"{"id":"preview-store","name":"TENPO ONE 新宿店"}"#

    // MARK: ホーム（lib/native-home-server.ts）

    /// 売上 ¥186,400 ／ 予算 ¥220,000（85%）。来店 11 組 40 名（店舗台帳の来店済み＋退店と同じ）
    static func homePayload(_ c: NSPClock) -> NHPayload? {
        let json = ##"""
        {"store":\##(storeJson),
         "serverNow":\##(c.nowMs),
         "today":"\##(c.ymd)",
         "needsOpenRegister":false,
         "bigTiles":[{"href":"/app/floor","label":"注文・会計","en":"Order & Pay"},
                     {"href":"/app/reservations","label":"店舗台帳","en":"Reservation"}],
         "tools":[
          {"href":"/app/quick-pay","label":"即会計","en":"Quick pay","icon":"calculator","action":null,"badge":null},
          {"href":"/app/orders","label":"伝票明細","en":"Slips / Receipts","icon":"receipt","action":null,"badge":null},
          {"href":"/app/cash","label":"入出金","en":"Cash in / out","icon":"wallet","action":null,"badge":null},
          {"href":"/app/expenses","label":"仕入・経費","en":"Bills & payables","icon":"file","action":null,"badge":3},
          {"href":"#drawer","label":"ドロアオープン","en":"Open drawer","icon":"drawer","action":"drawer","badge":null},
          {"href":"/app/cash/close","label":"レジクローズ","en":"Close register","icon":"lock","action":null,"badge":null},
          {"href":"/app/inventory","label":"在庫設定","en":"Stock","icon":"package","action":null,"badge":null},
          {"href":"/app/settings","label":"設定","en":"Settings","icon":"settings","action":null,"badge":null}
         ],
         "sales":{"actual":186400,"avgSpend":4660,"budget":220000,"pct":85,"ringPct":84.7,
                  "asOf":"\##(c.slashYmd) 19:42","date":"\##(c.ymd)","dayLabel":"本日","heading":null,"note":null,"canAnalytics":true},
         "kpis":{"groups":11,"groupsYesterday":10,"guests":40,"guestsYesterday":35,"repeaters":2,"walkIns":4},
         "weather":{"temperature":16.4,"place":"新宿区新宿","icon":"partly","isDay":false},
         "noticeCount":3}
        """##
        return NSPJson.decode(NHPayload.self, json, label: "home")
    }

    // MARK: テーブル一覧（lib/native-floor-server.ts）

    /// 1F・2F の 16 卓。注文済・着席中・L.O.・会計待ち・予約あり・空席・清掃中、呼び出し 2 件（お会計・スタッフ）
    static func floorPayload(_ c: NSPClock) -> NFPayload? {
        typealias J = NSPJson

        func line(_ id: String, _ name: String, _ q: Int) -> String {
            #"{"id":\#(J.s(id)),"name":\#(J.s(name)),"quantity":\#(q),"menuItemId":null}"#
        }

        /// 卓の伝票（1 卓 1 伝票）。course は「飲放」「時間制」など（サーバーの courseLabel と同じ）・120 分
        func order(_ id: String, no: Int, opened: (Int, Int), end: (Int, Int), guests: Int, total: Int,
                   customer: String? = nil, visits: Int? = nil, guest: String? = nil, source: String = "直接来店", clerk: String,
                   course: String? = nil, courseId: String? = nil, plans: [String] = ["normal"], tags: [String] = [],
                   lastOrder: (Int, Int)? = nil, lines: [String]) -> String {
            let openedMs = c.ms(opened.0, opened.1)
            let endMs = c.ms(end.0, end.1)
            let courseJson = course.map { #"{"label":\#(J.s($0)),"minutes":120}"# } ?? "null"
            let lastJson = lastOrder.map { String(c.ms($0.0, $0.1)) } ?? "null"
            let slip = #"{"id":\#(J.s(id)),"orderNo":\#(no),"openedAtMs":\#(openedMs),"guestCount":\#(guests),"total":\#(total),"lines":\#(J.arr(lines))}"#
            return #"{"id":\#(J.s(id)),"openedAtMs":\#(openedMs),"guestCount":\#(guests),"total":\#(total),"customerName":\#(J.s(customer)),"visitCount":\#(J.i(visits)),"guestName":\#(J.s(guest)),"sourceLabel":\#(J.s(source)),"clerkName":\#(J.s(clerk)),"course":\#(courseJson),"endAtMs":\#(endMs),"courseId":\#(J.s(courseId)),"plans":\#(J.strs(plans)),"tags":\#(J.strs(tags)),"lastOrderAtMs":\#(lastJson),"slips":[\#(slip)]}"#
        }

        /// 卓の「次」の予約
        func next(_ id: String, at: (Int, Int), name: String, party: Int, source: String) -> String {
            #"{"id":\#(J.s(id)),"startMs":\#(c.ms(at.0, at.1)),"time":\#(J.s(c.hm(at.0, at.1))),"name":\#(J.s(name)),"partySize":\#(party),"sourceLabel":\#(J.s(source))}"#
        }

        /// お客様の呼び出し（kind: checkout ＝お会計・staff ＝スタッフ）
        func call(_ id: String, kind: String, at: (Int, Int), note: String? = nil) -> String {
            #"{"id":\#(J.s(id)),"kind":\#(J.s(kind)),"createdAt":\#(J.s(c.iso(at.0, at.1))),"note":\#(J.s(note))}"#
        }

        /// 卓（キーはサーバーと同じ snake_case。NFTable の CodingKeys）
        func table(_ id: String, _ floorId: String, _ name: String, cap: (Int, Int), room: Bool = false, counter: Bool = false,
                   status: String = "available", order: String? = nil, upcoming: [String] = [], calls: [String] = []) -> String {
            #"{"id":\#(J.s(id)),"floor_id":\#(J.s(floorId)),"name":\#(J.s(name)),"capacity_min":\#(cap.0),"capacity_max":\#(cap.1),"is_private_room":\#(room),"is_counter":\#(counter),"current_status":\#(J.s(status)),"pos_x":null,"pos_y":null,"shape":"square","order":\#(order ?? "null"),"upcoming":\#(J.arr(upcoming)),"groupTableIds":[],"groupTableNames":[],"calls":\#(J.arr(calls))}"#
        }

        /// 右の「来店待ち」の予約
        func resv(_ id: String, at: (Int, Int), name: String, party: Int, table: String, status: String = "confirmed", today: Bool = false) -> String {
            #"{"id":\#(J.s(id)),"startMs":\#(c.ms(at.0, at.1)),"time":\#(J.s(c.hm(at.0, at.1))),"name":\#(J.s(name)),"partySize":\#(party),"tableLabel":\#(J.s(table)),"status":\#(J.s(status)),"createdToday":\#(today)}"#
        }

        var tables: [String] = []
        // ── 1F：カウンター・テーブル ──
        tables.append(table("t-c1", "f1", "C1", cap: (1, 2), counter: true, status: "ordering",
                            order: order("o-c1", no: 118, opened: (19, 5), end: (21, 5), guests: 2, total: 8_120, clerk: "田中", lastOrder: (19, 31),
                                         lines: [line("c1-1", "生ビール（中）", 3), line("c1-2", "枝豆", 1), line("c1-3", "焼き鳥盛り合わせ（5本）", 1), line("c1-4", "だし巻き玉子", 1)])))
        tables.append(table("t-c2", "f1", "C2", cap: (1, 2), counter: true,
                            upcoming: [next("r13", at: (21, 30), name: "山本 大輔", party: 2, source: "TABLE ONE")]))
        tables.append(table("t-t1", "f1", "T1", cap: (2, 4), status: "ordering",
                            order: order("o-t1", no: 109, opened: (18, 30), end: (20, 30), guests: 4, total: 22_000,
                                         customer: "山田 太郎", visits: 5, guest: "山田 太郎", source: "電話", clerk: "田中",
                                         course: "飲放", courseId: "co-enkai", plans: ["course", "drink"], tags: ["誕生日", "飲み放題"], lastOrder: (19, 24),
                                         lines: [line("t1-1", "宴会コース（2時間飲み放題付）", 4), line("t1-2", "誕生日デザートプレート", 1)])))
        tables.append(table("t-t2", "f1", "T2", cap: (2, 4), status: "billing",
                            order: order("o-t2", no: 104, opened: (17, 55), end: (19, 55), guests: 3, total: 16_120,
                                         guest: "松本 さくら", source: "食べログ", clerk: "佐々木", lastOrder: (19, 21),
                                         lines: [line("t2-1", "ハイボール", 5), line("t2-2", "本日の刺身盛り合わせ", 1), line("t2-3", "鶏の唐揚げ", 2), line("t2-4", "〆の焼きおにぎり", 3)]),
                            calls: [call("call-t2", kind: "checkout", at: (19, 40))]))
        tables.append(table("t-t3", "f1", "T3", cap: (2, 4), status: "ordering",
                            order: order("o-t3", no: 103, opened: (17, 50), end: (19, 50), guests: 3, total: 12_820, clerk: "佐々木", lastOrder: (19, 20),
                                         lines: [line("t3-1", "レモンサワー", 4), line("t3-2", "ねぎま", 3), line("t3-3", "ポテトサラダ", 1), line("t3-4", "ほっけの塩焼き", 1)])))
        tables.append(table("t-t4", "f1", "T4", cap: (2, 4), status: "reserved",
                            upcoming: [next("r09", at: (20, 0), name: "佐藤 花子", party: 4, source: "食べログ")]))
        tables.append(table("t-t5", "f1", "T5", cap: (4, 6), status: "ordering",
                            order: order("o-t5", no: 120, opened: (19, 20), end: (21, 20), guests: 5, total: 13_480, clerk: "田中",
                                         plans: ["drink"], lastOrder: (19, 36),
                                         lines: [line("t5-1", "飲み放題（120分）", 5), line("t5-2", "シーザーサラダ", 1), line("t5-3", "ポテトフライ", 2)]),
                            calls: [call("call-t5", kind: "staff", at: (19, 39), note: "取り皿 ×2")]))
        tables.append(table("t-t6", "f1", "T6", cap: (1, 2), status: "seated",
                            order: order("o-t6", no: 122, opened: (19, 39), end: (21, 30), guests: 2, total: 0,
                                         customer: "鈴木 一郎", visits: 1, guest: "鈴木 一郎", source: "Google", clerk: "佐々木", lines: [])))
        // ── 2F：個室・テーブル ──
        tables.append(table("t-r1", "f2", "R1", cap: (4, 6), room: true, status: "ordering",
                            order: order("o-r1", no: 114, opened: (19, 0), end: (21, 0), guests: 6, total: 46_200,
                                         customer: "高橋 健太", visits: 2, guest: "高橋 健太", source: "TABLE ONE", clerk: "田中",
                                         course: "時間制", courseId: "co-omakase", plans: ["course"], tags: ["接待", "個室"], lastOrder: (19, 33),
                                         lines: [line("r1-1", "おまかせコース", 6), line("r1-2", "日本酒 飲み比べ3種", 2), line("r1-3", "瓶ビール", 4)])))
        tables.append(table("t-r2", "f2", "R2", cap: (2, 4), room: true, status: "reserved",
                            upcoming: [next("r11", at: (20, 30), name: "伊藤 美咲", party: 4, source: "ホットペッパー")]))
        tables.append(table("t-r3", "f2", "R3", cap: (6, 8), room: true, status: "ordering",
                            order: order("o-r3", no: 111, opened: (18, 45), end: (20, 45), guests: 7, total: 34_650,
                                         guest: "小林 誠", source: "ホットペッパー", clerk: "佐々木",
                                         course: "飲放", courseId: "co-nomi", plans: ["drink"], tags: ["飲み放題"], lastOrder: (19, 5),
                                         lines: [line("r3-1", "飲み放題コース（2時間）", 7), line("r3-2", "鶏の唐揚げ", 2)])))
        tables.append(table("t-t7", "f2", "T7", cap: (2, 4),
                            upcoming: [next("r12", at: (21, 0), name: "渡辺 直樹", party: 2, source: "電話")]))
        tables.append(table("t-t8", "f2", "T8", cap: (2, 4), status: "ordering",
                            order: order("o-t8", no: 121, opened: (19, 28), end: (21, 28), guests: 2, total: 5_350, clerk: "田中", lastOrder: (19, 34),
                                         lines: [line("t8-1", "レモンサワー", 2), line("t8-2", "冷やしトマト", 1), line("t8-3", "つくね", 4)])))
        tables.append(table("t-t9", "f2", "T9", cap: (2, 4), status: "cleaning"))
        tables.append(table("t-t10", "f2", "T10", cap: (1, 2), status: "reserved",
                            upcoming: [next("r07", at: (19, 15), name: "中村 優子", party: 2, source: "電話")]))
        tables.append(table("t-t11", "f2", "T11", cap: (2, 4)))

        var panel: [String] = []
        panel.append(resv("r07", at: (19, 15), name: "中村 優子", party: 2, table: "T10"))
        panel.append(resv("r09", at: (20, 0), name: "佐藤 花子", party: 4, table: "T4"))
        panel.append(resv("r10", at: (20, 15), name: "吉田 翔", party: 3, table: "席未定", status: "pending", today: true))
        panel.append(resv("r11", at: (20, 30), name: "伊藤 美咲", party: 4, table: "R2"))
        panel.append(resv("r12", at: (21, 0), name: "渡辺 直樹", party: 2, table: "T7"))
        panel.append(resv("r13", at: (21, 30), name: "山本 大輔", party: 2, table: "C2"))

        let json = #"""
        {"store":\#(storeJson),"serverNow":\#(c.nowMs),"stayMinutes":120,"defaultFloorId":null,
         "floors":[{"id":"f1","name":"1F","sort_order":1},{"id":"f2","name":"2F","sort_order":2}],
         "tables":\#(J.arr(tables)),
         "reservations":\#(J.arr(panel)),
         "seatCourses":[{"id":"co-enkai","name":"宴会コース（2時間飲み放題付）","durationMinutes":120},
                        {"id":"co-omakase","name":"おまかせコース","durationMinutes":120},
                        {"id":"co-nomi","name":"飲み放題コース（2時間）","durationMinutes":120}],
         "planItems":[{"id":"pi-drink","name":"飲み放題（120分）","price":1650,"durationMinutes":120,"kind":"drink"},
                      {"id":"pi-premium","name":"プレミアム飲み放題（120分）","price":2200,"durationMinutes":120,"kind":"drink"}],
         "plans":[{"id":"normal","name":"アラカルト"},{"id":"drink","name":"飲み放題"},{"id":"buffet","name":"食べ放題"},
                  {"id":"food","name":"食べ飲み放題"},{"id":"course","name":"コース"}],
         "visitSources":[{"id":"free","label":"ウォークイン"},{"id":"phone","label":"電話"},{"id":"tabelog","label":"食べログ"},
                         {"id":"hotpepper","label":"ホットペッパー"},{"id":"google","label":"Google"}],
         "approvers":[{"id":"st-1","name":"田中"}],
         "canOperate":true}
        """#
        return J.decode(NFPayload.self, json, label: "floor")
    }

    // MARK: 店舗台帳（lib/native-ledger-server.ts）

    /// 17:00〜24:00 のスケジュール。予約 13 件（コース・飲み放題・仮予約・未連絡・退店）＋ウォークイン 4 件。卓はテーブル一覧と同じ
    static func ledgerPayload(_ c: NSPClock) -> NLPayload? {
        typealias J = NSPJson
        let tableNames: [String: String] = [
            "t-c1": "C1", "t-c2": "C2", "t-t1": "T1", "t-t2": "T2", "t-t3": "T3", "t-t4": "T4", "t-t5": "T5", "t-t6": "T6",
            "t-r1": "R1", "t-r2": "R2", "t-r3": "R3", "t-t7": "T7", "t-t8": "T8", "t-t9": "T9", "t-t10": "T10", "t-t11": "T11",
        ]
        let sourceNames: [String: String] = [
            "src-phone": "電話", "src-tabelog": "食べログ", "src-hotpepper": "ホットペッパー", "src-google": "Google", "src-table-one": "TABLE ONE",
        ]
        let courseNames: [String: String] = [
            "co-enkai": "宴会コース（2時間飲み放題付）", "co-omakase": "おまかせコース", "co-nomi": "飲み放題コース（2時間）",
        ]

        func ltable(_ id: String, cap: (Int, Int), label: String) -> String {
            #"{"id":\#(J.s(id)),"name":\#(J.s(tableNames[id] ?? id)),"capacityMin":\#(cap.0),"capacityMax":\#(cap.1),"statusLabel":\#(J.s(label))}"#
        }

        /// 予約 1 件（NLReservation と同じキー）。source は sourceRows の id・course は courses の id・tables は卓の id
        func resv(_ id: String, code: String, _ start: (Int, Int), _ end: (Int, Int), name: String, kana: String? = nil, phone: String = "-",
                  party: Int, status: String, via: String, source: String? = nil, tables: [String] = [],
                  course: String? = nil, purpose: String? = nil, allergy: String? = nil, request: String? = nil,
                  visits: Int? = nil, tags: [String] = [], createdAt: (Int, Int)? = nil, arrived: (Int, Int)? = nil, left: (Int, Int)? = nil) -> String {
            let created = createdAt.map { c.iso($0.0, $0.1) } ?? c.isoDaysBefore(3, 14, 20)
            let arrivedIso = arrived.map { c.iso($0.0, $0.1) }
            let leftIso = left.map { c.iso($0.0, $0.1) }
            let names = tables.map { tableNames[$0] ?? $0 }
            let sourceName = source.flatMap { sourceNames[$0] }
            let courseName = course.flatMap { courseNames[$0] }
            return #"{"id":\#(J.s(id)),"code":\#(J.s(code)),"reservedDate":\#(J.s(c.ymd)),"startAt":\#(J.s(c.iso(start.0, start.1))),"endAt":\#(J.s(c.iso(end.0, end.1))),"guestName":\#(J.s(name)),"guestNameKana":\#(J.s(kana)),"guestPhone":\#(J.s(phone)),"guestEmail":null,"partySize":\#(party),"adults":\#(party),"children":0,"status":\#(J.s(status)),"courseId":\#(J.s(course)),"courseName":\#(J.s(courseName)),"seatType":null,"purpose":\#(J.s(purpose)),"allergyNote":\#(J.s(allergy)),"requestNote":\#(J.s(request)),"memo":null,"sourceName":\#(J.s(sourceName)),"sourceId":\#(J.s(source)),"createdVia":\#(J.s(via)),"tableIds":\#(J.strs(tables)),"tableNames":\#(J.strs(names)),"staffId":null,"staffName":null,"isPrivateHire":false,"createdAt":\#(J.s(created)),"arrivedAt":\#(J.s(arrivedIso)),"leftAt":\#(J.s(leftIso)),"visitCount":\#(J.i(visits)),"tags":\#(J.strs(tags)),"partySizeMin":null}"#
        }

        // 卓の並び・状態の字はテーブル一覧と同じ（サーバーの statusLabel：会計待ち／着席中 N名 ・ 名前 様／空席・予約あり・清掃中）
        var board: [String] = []
        board.append(ltable("t-c1", cap: (1, 2), label: "着席中 2名 ・ ウォークイン 様"))
        board.append(ltable("t-c2", cap: (1, 2), label: "空席"))
        board.append(ltable("t-t1", cap: (2, 4), label: "着席中 4名 ・ 山田 太郎 様"))
        board.append(ltable("t-t2", cap: (2, 4), label: "会計待ち"))
        board.append(ltable("t-t3", cap: (2, 4), label: "着席中 3名 ・ ウォークイン 様"))
        board.append(ltable("t-t4", cap: (2, 4), label: "予約あり"))
        board.append(ltable("t-t5", cap: (4, 6), label: "着席中 5名 ・ ウォークイン 様"))
        board.append(ltable("t-t6", cap: (1, 2), label: "着席中 2名 ・ 鈴木 一郎 様"))
        board.append(ltable("t-r1", cap: (4, 6), label: "着席中 6名 ・ 高橋 健太 様"))
        board.append(ltable("t-r2", cap: (2, 4), label: "予約あり"))
        board.append(ltable("t-r3", cap: (6, 8), label: "着席中 7名 ・ 小林 誠 様"))
        board.append(ltable("t-t7", cap: (2, 4), label: "空席"))
        board.append(ltable("t-t8", cap: (2, 4), label: "着席中 2名 ・ ウォークイン 様"))
        board.append(ltable("t-t9", cap: (2, 4), label: "清掃中"))
        board.append(ltable("t-t10", cap: (1, 2), label: "予約あり"))
        board.append(ltable("t-t11", cap: (2, 4), label: "空席"))

        // 開始の早い順（サーバーと同じ order('start_at')）
        var rs: [String] = []
        rs.append(resv("r01", code: "7F3A-B21C", (17, 30), (19, 0), name: "加藤 恵", kana: "カトウ メグミ", phone: "090-0000-1101",
                       party: 2, status: "completed", via: "phone", source: "src-phone", tables: ["t-t7"], arrived: (17, 28), left: (19, 6)))
        rs.append(resv("r02", code: "A91D-0C4E", (17, 45), (19, 30), name: "林 拓也", kana: "ハヤシ タクヤ", phone: "090-0000-1102",
                       party: 4, status: "completed", via: "gourmet_mail", source: "src-tabelog", tables: ["t-t9"], arrived: (17, 47), left: (19, 34)))
        rs.append(resv("w1", code: "WI-482913", (17, 50), (19, 50), name: "ウォークイン",
                       party: 3, status: "seated", via: "walk_in", tables: ["t-t3"], createdAt: (17, 50), arrived: (17, 50)))
        rs.append(resv("r03", code: "5B2C-9E10", (17, 55), (19, 55), name: "松本 さくら", kana: "マツモト サクラ", phone: "090-0000-1103",
                       party: 3, status: "billing", via: "gourmet_mail", source: "src-tabelog", tables: ["t-t2"], arrived: (17, 55)))
        rs.append(resv("r04", code: "C0E7-44A2", (18, 30), (20, 30), name: "山田 太郎", kana: "ヤマダ タロウ", phone: "090-0000-1104",
                       party: 4, status: "seated", via: "phone", source: "src-phone", tables: ["t-t1"],
                       course: "co-enkai", purpose: "誕生日", request: "デザートプレートにメッセージ「HAPPY BIRTHDAY」",
                       visits: 5, tags: ["誕生日", "飲み放題"], arrived: (18, 28)))
        rs.append(resv("r05", code: "E3F1-7A90", (18, 45), (20, 45), name: "小林 誠", kana: "コバヤシ マコト", phone: "090-0000-1105",
                       party: 7, status: "seated", via: "gourmet_mail", source: "src-hotpepper", tables: ["t-r3"],
                       course: "co-nomi", tags: ["飲み放題"], arrived: (18, 44)))
        rs.append(resv("r06", code: "1D8B-F2C3", (19, 0), (21, 0), name: "高橋 健太", kana: "タカハシ ケンタ", phone: "090-0000-1106",
                       party: 6, status: "seated", via: "web", source: "src-table-one", tables: ["t-r1"],
                       course: "co-omakase", purpose: "接待", allergy: "1名 えびアレルギー",
                       visits: 2, tags: ["接待", "個室"], arrived: (18, 57)))
        rs.append(resv("w2", code: "WI-517204", (19, 5), (21, 5), name: "ウォークイン",
                       party: 2, status: "seated", via: "walk_in", tables: ["t-c1"], createdAt: (19, 5), arrived: (19, 5)))
        rs.append(resv("r07", code: "9A4E-3B6D", (19, 15), (21, 15), name: "中村 優子", kana: "ナカムラ ユウコ", phone: "090-0000-1107",
                       party: 2, status: "confirmed", via: "phone", source: "src-phone", tables: ["t-t10"]))
        rs.append(resv("w3", code: "WI-630588", (19, 20), (21, 20), name: "ウォークイン",
                       party: 5, status: "seated", via: "walk_in", tables: ["t-t5"], createdAt: (19, 20), arrived: (19, 20)))
        rs.append(resv("w4", code: "WI-704361", (19, 28), (21, 28), name: "ウォークイン",
                       party: 2, status: "seated", via: "walk_in", tables: ["t-t8"], createdAt: (19, 28), arrived: (19, 28)))
        rs.append(resv("r08", code: "F6C2-81E5", (19, 30), (21, 30), name: "鈴木 一郎", kana: "スズキ イチロウ", phone: "090-0000-1108",
                       party: 2, status: "seated", via: "web", source: "src-google", tables: ["t-t6"],
                       visits: 1, createdAt: (15, 10), arrived: (19, 39)))
        rs.append(resv("r09", code: "2E9F-6D14", (20, 0), (22, 0), name: "佐藤 花子", kana: "サトウ ハナコ", phone: "090-0000-1109",
                       party: 4, status: "confirmed", via: "gourmet_mail", source: "src-tabelog", tables: ["t-t4"],
                       request: "窓側の席を希望", tags: ["記念日"]))
        rs.append(resv("r10", code: "8C3A-D07B", (20, 15), (22, 15), name: "吉田 翔", kana: "ヨシダ ショウ", phone: "090-0000-1110",
                       party: 3, status: "pending", via: "web", source: "src-google", tags: ["要連絡"], createdAt: (18, 52)))
        rs.append(resv("r11", code: "4F7D-2A9C", (20, 30), (22, 30), name: "伊藤 美咲", kana: "イトウ ミサキ", phone: "090-0000-1111",
                       party: 4, status: "confirmed", via: "gourmet_mail", source: "src-hotpepper", tables: ["t-r2"],
                       course: "co-nomi", tags: ["飲み放題"]))
        rs.append(resv("r12", code: "B5E8-0F31", (21, 0), (23, 0), name: "渡辺 直樹", kana: "ワタナベ ナオキ", phone: "090-0000-1112",
                       party: 2, status: "confirmed", via: "phone", source: "src-phone", tables: ["t-t7"]))
        rs.append(resv("r13", code: "6A1C-E4D7", (21, 30), (23, 0), name: "山本 大輔", kana: "ヤマモト ダイスケ", phone: "090-0000-1113",
                       party: 2, status: "confirmed", via: "web", source: "src-table-one", tables: ["t-c2"]))

        // 集計（lib/ledger-summary.ts と同じ数え方。キャンセル 1 件は一覧に出ない）
        let json = #"""
        {"store":\#(storeJson),"date":"\#(c.ymd)","today":"\#(c.ymd)","isToday":true,"nowMs":\#(c.nowMs),
         "viewStartMin":1020,"viewEndMin":1440,"openMin":1020,"closeMin":1440,"isClosedDay":false,"bufferMinutes":15,"slotMinutes":30,
         "tables":\#(J.arr(board)),
         "reservations":\#(J.arr(rs)),
         "summary":{"count":17,"guests":57,"cancelled":1,"sameDayCount":2,"sameDayGuests":5,"inCount":9,"outCount":2,"waitingCount":6,"unconfirmed":1,"unseated":1},
         "sources":[{"code":"web","name":"公式Web予約"},{"code":"phone","name":"電話"},{"code":"walk_in","name":"ウォークイン"},{"code":"google","name":"Google"},
                    {"code":"tabelog","name":"食べログ"},{"code":"hotpepper","name":"ホットペッパー"},{"code":"table_one","name":"TABLE ONE"}],
         "sourceRows":[{"id":"src-web","code":"web","name":"公式Web予約"},{"id":"src-phone","code":"phone","name":"電話"},
                       {"id":"src-walk-in","code":"walk_in","name":"ウォークイン"},{"id":"src-google","code":"google","name":"Google"},
                       {"id":"src-tabelog","code":"tabelog","name":"食べログ"},{"id":"src-hotpepper","code":"hotpepper","name":"ホットペッパー"},
                       {"id":"src-table-one","code":"table_one","name":"TABLE ONE"}],
         "courses":[{"id":"co-enkai","name":"宴会コース（2時間飲み放題付）"},{"id":"co-omakase","name":"おまかせコース"},{"id":"co-nomi","name":"飲み放題コース（2時間）"}],
         "staffOptions":[{"id":"st-1","name":"田中"},{"id":"st-2","name":"佐々木"}],
         "statusLabels":{"pending":"仮予約","confirmed":"予約確定","waiting":"来店待ち","arrived":"来店済み","seated":"着席","billing":"会計待ち",
                         "completed":"退店","cancelled":"キャンセル","no_show":"無断キャンセル","waitlisted":"キャンセル待ち"},
         "transitions":{"pending":["confirmed","cancelled"],"confirmed":["waiting","arrived","seated","cancelled","no_show"],
                        "waiting":["arrived","seated","cancelled","no_show"],"arrived":["seated","cancelled"],"seated":["billing","completed"],
                        "billing":["completed"],"completed":["cancelled"],"cancelled":[],"no_show":[],"waitlisted":["pending","confirmed","cancelled"]},
         "canWrite":true,
         "links":{"tables":true,"customers":true,"analytics":true,"settings":true},
         "unconfirmed":1}
        """#
        return J.decode(NLPayload.self, json, label: "ledger")
    }
}

// MARK: - 見本のモデル（読み込まない・時計を止める＝ isPreview）

extension NativeHomeModel {
    static func sample() -> NativeHomeModel {
        let m = NativeHomeModel()
        m.isPreview = true
        let c = NSPClock()
        m.now = c.now
        m.payload = NSPData.homePayload(c)
        return m
    }
}

extension NativeFloorModel {
    static func sample() -> NativeFloorModel {
        let m = NativeFloorModel()
        m.isPreview = true
        let c = NSPClock()
        m.now = Double(c.nowMs)
        m.payload = NSPData.floorPayload(c)
        m.floorFilter = "all"
        return m
    }
}

extension NativeLedgerModel {
    static func sample() -> NativeLedgerModel {
        let m = NativeLedgerModel()
        m.isPreview = true
        let c = NSPClock()
        m.now = c.now
        m.payload = NSPData.ledgerPayload(c)
        m.date = m.payload?.date
        // 来店中の予約の箱をテーブル一覧と同じ色・残り時間に
        m.previewFloor = NSPData.floorPayload(c)
        return m
    }
}

// MARK: - 見本の画面

/// -tenpoNativePreview home|floor|ledger の中身（NativePreviewView から）
struct NativeStorePreview: View {
    let kind: String
    @StateObject private var home = NativeHomeModel.sample()
    @StateObject private var floorModel = NativeFloorModel.sample()
    @StateObject private var ledger = NativeLedgerModel.sample()

    var body: some View {
        content
            // iPad のレジは明るい表示（RootView の WebContainer と同じ）
            .preferredColorScheme(.light)
            .overlay(alignment: .bottom) {
                if !NSPJson.problems.isEmpty {
                    Text(NSPJson.problems.joined(separator: "\n\n"))
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.red.opacity(0.92)))
                        .padding(20)
                }
            }
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case "floor":
            // 左に細いメニュー（アイコンだけ）＋ 広い本文（2026-10-27 02:13 Ronnie）
            HStack(spacing: 0) {
                NativeNavRail(previewActive: "floor")
                NativeFloorView(model: floorModel, onStock: {})
                    .environment(\.tenpoNavRail, true)
            }
        case "ledger":
            NativeLedgerView(model: ledger)
        default:
            NativeHomeView(model: home)
        }
    }
}
