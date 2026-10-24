import SwiftUI

// iPhone の店長・オーナーの店舗台帳・顧客の見本（シミュレーターで形を確かめる・画面写真を撮る用。ログインしなくても出せる）。
// 起動の引数 -tenpoNativePreview phoneOwnerLedger | phoneOwnerLedgerInbox | phoneOwnerLedgerDetail | phoneOwnerLedgerNew
//                              | phoneOwnerCustomers | phoneOwnerCustomer
// 通信しない（モデルの isSample・NativePreview.current を見る）。店・お客様・金額はすべて架空（実在の人・店・ロゴは使わない）。
// 店舗台帳の中身は iPad の見本（NativeStorePreview.swift の NSPData.ledgerPayload）をそのまま使う。
// 顧客はサーバーと同じ形の JSON を組み立てて、iPad と同じ型（NCListPayload・NCDPayload）に読ませる（読めなければ画面の下に赤で出る）。

@MainActor
enum NPOSample {
    // MARK: 店舗台帳

    static func ledger() -> NPOLedgerModel {
        let m = NPOLedgerModel(date: nil)
        m.isSample = true
        m.payload = NSPData.ledgerPayload(NSPClock())
        m.sampleEntry = entry(m.payload)
        return m
    }

    /// 予約可能なテーブル（part=ledgerEntry と同じ形）。卓・予約は店舗台帳の見本と同じ
    static func entry(_ p: NLPayload?) -> NRWEntry? {
        guard let p else { return nil }
        let upstairs: Set<String> = ["t-r1", "t-r2", "t-r3", "t-t7", "t-t8", "t-t9", "t-t10", "t-t11"]
        let tables: [[String: Any]] = p.tables.map { t -> [String: Any] in
            ["id": t.id, "name": t.name, "capacityMin": t.capacityMin, "capacityMax": t.capacityMax,
             "floorName": upstairs.contains(t.id) ? "2F" : "1F", "locked": false, "inUse": false]
        }
        let booked: [[String: Any]] = p.reservations.filter { $0.status != "completed" }.map { r -> [String: Any] in
            ["id": r.id, "start": r.startAt, "end": r.endAt, "tableIds": r.tableIds]
        }
        let clerks: [[String: Any]] = p.staffOptions.map { s -> [String: Any] in ["id": s.id, "name": s.name] }
        let obj: [String: Any] = [
            "date": p.date, "tables": tables, "booked": booked, "defaultStay": 120,
            "keywords": ["誕生日", "記念日", "接待", "個室希望", "飲み放題", "アレルギー"], "keywordsCustom": true,
            "tagGroups": [Any](), "clerks": clerks, "courseDurations": ["co-omakase": 150],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        do {
            return try JSONDecoder().decode(NRWEntry.self, from: data)
        } catch {
            NSPJson.problems.append("見本 ledgerEntry を読めません: \(error)")
            return nil
        }
    }

    /// 受付管理・メッセージ（part=ledgerInbox と同じ中身）
    static func inbox() -> NLInboxModel {
        let m = NLInboxModel()
        let today = NSPClock().ymd
        let tomorrow = NPHRDate.shift(today, 1)
        let iso = ISO8601DateFormatter()
        let recent = iso.string(from: Date().addingTimeInterval(-50 * 60))
        let earlier = iso.string(from: Date().addingTimeInterval(-5 * 3600))
        let day = NPHRDate.dayLabel(today)
        let next = NPHRDate.dayLabel(tomorrow)
        m.payload = NLInboxPayload(
            storeId: "preview-store", canWrite: true, canAcknowledge: true,
            tasks: [
                NLInboxTask(key: "p:r10", kind: "pending", reservationId: "r10", importId: nil, title: "吉田 翔 様",
                            detail: "\(day) 20:15〜 3名", note: "Google", at: recent, date: today),
                NLInboxTask(key: "c:r21", kind: "contact", reservationId: "r21", importId: nil, title: "小川 結衣 様",
                            detail: "\(next) 18:30〜 6名", note: "コースの相談", at: earlier, date: tomorrow),
                NLInboxTask(key: "n:r13", kind: "new", reservationId: "r13", importId: nil, title: "山本 大輔 様",
                            detail: "\(day) 21:30〜 2名", note: "TABLE ONE", at: recent, date: today),
                NLInboxTask(key: "x:r22", kind: "change", reservationId: "r22", importId: nil, title: "森 健一 様",
                            detail: "\(next) 19:00〜 4名 → 5名", note: "食べログ", at: earlier, date: tomorrow),
            ],
            notices: [
                NLInboxNotice(key: "n:r13", kind: "new", title: "新しい予約　山本 大輔 様", detail: "\(day) 21:30〜 2名", note: "TABLE ONE",
                              at: recent, reservationId: "r13", date: today),
                NLInboxNotice(key: "x:r22", kind: "change", title: "予約の変更　森 健一 様", detail: "\(next) 19:00〜 5名", note: "食べログ",
                              at: earlier, reservationId: "r22", date: tomorrow),
                NLInboxNotice(key: "c:r23", kind: "cancel", title: "お客様キャンセル　石井 彩 様", detail: "\(day) 19:00〜 2名",
                              note: "お客様キャンセル（連絡あり）", at: earlier, reservationId: nil, date: today),
            ])
        return m
    }

    // MARK: 顧客

    static func customers() -> NPOCustomersModel {
        let m = NPOCustomersModel()
        m.isSample = true
        if let p = customersPayload() {
            m.payload = p
            m.rows = p.rows
        }
        return m
    }

    private static func tagJson(_ id: String, _ name: String, _ color: String) -> String {
        #"{"id":\#(NSPJson.s(id)),"name":\#(NSPJson.s(name)),"color":\#(NSPJson.s(color))}"#
    }

    private static func badgeJson(_ label: String, _ tone: String) -> String {
        #"{"label":\#(NSPJson.s(label)),"tone":\#(NSPJson.s(tone))}"#
    }

    /// 一覧（part=customers と同じ形）
    static func customersPayload() -> NCListPayload? {
        typealias J = NSPJson
        let c = NSPClock()
        let vip = tagJson("tg-vip", "VIP", "#BC5940")
        let bday = tagJson("tg-bday", "誕生日", "#1E8F62")
        let biz = tagJson("tg-biz", "接待", "#2A6FE6")
        let allergy = tagJson("tg-allergy", "アレルギー", "#C62828")
        func row(_ id: String, _ name: String, kana: String, phone: String, badges: [String], more: Int = 0, birthday: Bool = false,
                 rfm: (String, String), visits: Int, spent: Int, points: Int, lastDays: Int, tags: [String]) -> String {
            let avg = visits > 0 ? spent / visits : 0
            let last = J.s(c.isoDaysBefore(lastDays, 19, 30))
            return #"{"id":\#(J.s(id)),"name":\#(J.s(name)),"nameKana":\#(J.s(kana)),"phone":\#(J.s(phone)),"anonymized":false,"badges":\#(J.arr(badges)),"moreCount":\#(more),"birthdayMonth":\#(birthday),"rfm":\#(badgeJson(rfm.0, rfm.1)),"visitCount":\#(visits),"totalSpent":\#(spent),"avgSpend":\#(avg),"pointBalance":\#(points),"lastVisitAt":\#(last),"tags":\#(J.arr(tags))}"#
        }
        var rows: [String] = []
        rows.append(row("c-0001", "山田 太郎", kana: "ヤマダ タロウ", phone: "090-0000-2101", badges: [badgeJson("常連", "success"), badgeJson("VIP", "navy")], more: 1,
                        birthday: true, rfm: ("RFM S", "navy"), visits: 14, spent: 186_400, points: 1_864, lastDays: 7, tags: [vip, bday]))
        rows.append(row("c-0002", "佐藤 花子", kana: "サトウ ハナコ", phone: "090-0000-2102", badges: [badgeJson("リピーター", "success")],
                        rfm: ("RFM A", "success"), visits: 5, spent: 42_600, points: 426, lastDays: 12, tags: [bday]))
        rows.append(row("c-0003", "高橋 健太", kana: "タカハシ ケンタ", phone: "090-0000-2103", badges: [badgeJson("リピーター", "success"), badgeJson("高単価", "warning")],
                        rfm: ("RFM A", "success"), visits: 3, spent: 61_800, points: 618, lastDays: 20, tags: [biz]))
        rows.append(row("c-0004", "鈴木 一郎", kana: "スズキ イチロウ", phone: "090-0000-2104", badges: [badgeJson("新規", "primary")],
                        rfm: ("RFM C", "warning"), visits: 1, spent: 6_200, points: 62, lastDays: 1, tags: []))
        rows.append(row("c-0005", "田中 美咲", kana: "タナカ ミサキ", phone: "090-0000-2105", badges: [badgeJson("休眠", "gray")],
                        rfm: ("RFM D", "danger"), visits: 4, spent: 23_800, points: 0, lastDays: 120, tags: [allergy]))
        rows.append(row("c-0006", "伊藤 美咲", kana: "イトウ ミサキ", phone: "090-0000-2106", badges: [badgeJson("リピーター", "success")],
                        rfm: ("RFM B", "primary"), visits: 2, spent: 15_400, points: 154, lastDays: 35, tags: []))
        rows.append(row("c-0007", "渡辺 直樹", kana: "ワタナベ ナオキ", phone: "090-0000-2107", badges: [badgeJson("キャンセル注意", "danger")],
                        rfm: ("RFM C", "warning"), visits: 2, spent: 9_800, points: 98, lastDays: 64, tags: []))
        rows.append(row("c-0008", "中村 優子", kana: "ナカムラ ユウコ", phone: "090-0000-2108", badges: [badgeJson("新規", "primary")],
                        rfm: ("RFM B", "primary"), visits: 1, spent: 7_400, points: 74, lastDays: 3, tags: []))
        let json = #"""
        {"canView":true,"canWrite":true,"canExport":true,"canCoupons":true,"loyaltyEnabled":true,
         "total":248,"page":1,"totalPages":5,"q":"","tag":"","segment":"","sort":"last_visit_desc",
         "tags":[{"id":"tg-vip","name":"VIP"},{"id":"tg-bday","name":"誕生日"},{"id":"tg-biz","name":"接待"},{"id":"tg-allergy","name":"アレルギー"}],
         "segments":[{"key":"new","label":"新規","count":96},{"key":"repeater","label":"リピーター","count":88},{"key":"regular","label":"常連","count":31},
                     {"key":"vip","label":"VIP","count":12},{"key":"dormant","label":"休眠","count":41},{"key":"high_spender","label":"高単価","count":18},
                     {"key":"cancel_risk","label":"キャンセル注意","count":6},{"key":"no_show_risk","label":"無断キャンセル注意","count":2}],
         "extendedSegments":[{"key":"dormant_30","label":"休眠30日"},{"key":"dormant_60","label":"休眠60日"},{"key":"dormant_90","label":"休眠90日"},
                             {"key":"birthday_month","label":"誕生月"},{"key":"second_visit","label":"2回目"}],
         "rows":\#(J.arr(rows))}
        """#
        return J.decode(NCListPayload.self, json, label: "customers")
    }

    /// 詳細（part=customer と同じ形）：山田 太郎 様
    static func customerDetail() -> NCDPayload? {
        typealias J = NSPJson
        let c = NSPClock()
        let vip = tagJson("tg-vip", "VIP", "#BC5940")
        let bday = tagJson("tg-bday", "誕生日", "#1E8F62")
        let biz = tagJson("tg-biz", "接待", "#2A6FE6")
        let allergy = tagJson("tg-allergy", "アレルギー", "#C62828")
        func resv(_ id: String, days: Int, party: Int, label: String, tone: String, reason: String? = nil) -> String {
            #"{"id":\#(J.s(id)),"startAt":\#(J.s(c.isoDaysBefore(days, 18, 30))),"storeName":"TENPO ONE 新宿店","partySize":\#(party),"status":\#(badgeJson(label, tone)),"cancelReason":\#(J.s(reason))}"#
        }
        func order(_ id: String, days: Int, store: String, total: Int) -> String {
            #"{"id":\#(J.s(id)),"openedAt":\#(J.s(c.isoDaysBefore(days, 18, 32))),"storeName":\#(J.s(store)),"total":\#(total)}"#
        }
        func note(_ id: String, _ body: String, days: Int, by: String) -> String {
            #"{"id":\#(J.s(id)),"body":\#(J.s(body)),"createdAt":\#(J.s(c.isoDaysBefore(days, 22, 10))),"creatorName":\#(J.s(by))}"#
        }
        let json = #"""
        {"canWrite":true,"canDelete":true,"canAdjustPoints":true,"canExport":true,"canAnonymize":true,"loyaltyEnabled":true,
         "memberRanks":[{"key":"regular","label":"レギュラー"},{"key":"silver","label":"シルバー"},{"key":"gold","label":"ゴールド"},{"key":"vip","label":"VIP"}],
         "memberRankLabel":"ゴールド",
         "consents":[{"type":"privacy","label":"個人情報の取り扱いへの同意","granted":true,"grantedAt":\#(J.s(c.isoDaysBefore(400, 19, 0)))},
                     {"type":"marketing_email","label":"メールでのお知らせ配信","granted":true,"grantedAt":\#(J.s(c.isoDaysBefore(400, 19, 0)))},
                     {"type":"marketing_line","label":"LINEでのお知らせ配信","granted":false,"grantedAt":null}],
         "allTags":[\#(vip),\#(bday),\#(biz),\#(allergy)],
         "customer":{"id":"c-0001","name":"山田 太郎","nameKana":"ヤマダ タロウ","phone":"090-0000-2101","email":"taro@example.com",
                     "birthday":"1986-\#(NSPClock.two(c.month))-12","gender":"male","postalCode":null,"address":null,"memberNo":"M-000123","memberRank":"gold",
                     "pointBalance":1864,"visitCount":14,"totalSpent":186400,"cancelCount":1,"noShowCount":0,
                     "lastVisitAt":\#(J.s(c.isoDaysBefore(7, 19, 30))),"createdAt":\#(J.s(c.isoDaysBefore(400, 19, 0))),"anonymized":false,
                     "allergyNote":"えび（軽度）","dislikeNote":"パクチー","preferenceNote":"日本酒が好き（辛口）","seatPreference":"個室",
                     "anniversaryNote":"結婚記念日 6月","serviceNote":"いつも奥様とご来店。乾杯はスパークリングワイン"},
         "segments":[{"label":"常連","tone":"success"},{"label":"VIP","tone":"navy"},{"label":"高単価","tone":"warning"}],
         "rfm":{"label":"RFM S（最優良）","tone":"navy","detail":"R5 F5 M5"},
         "extended":[{"label":"誕生月","tone":"success"},{"label":"ディナー客","tone":"navy"}],
         "tags":[\#(vip),\#(bday)],
         "reservationCount":16,"avgSpend":13314,"daysSinceLastVisit":7,
         "ltv":{"actual":186400,"projected12m":239700,"avgSpend":13314,"visitsPerMonth":1.5},
         "notes":[\#(note("n-1", "誕生日のデザートプレートをとても喜ばれていた。次回も同じ個室を希望。", days: 7, by: "田中")),
                  \#(note("n-2", "日本酒の飲み比べを毎回注文される。", days: 40, by: "佐々木"))],
         "points":[],
         "stores":[{"storeId":"preview-store","storeName":"TENPO ONE 新宿店","visitCount":12,"totalSpent":162400},
                   {"storeId":"preview-store-2","storeName":"TENPO ONE 池袋店","visitCount":2,"totalSpent":24000}],
         "topProducts":[{"name":"宴会コース（2時間飲み放題付）","quantity":8,"amount":44000},{"name":"日本酒 飲み比べ3種","quantity":18,"amount":23400},
                        {"name":"本日の刺身盛り合わせ","quantity":12,"amount":20160},{"name":"だし巻き玉子","quantity":9,"amount":5220},
                        {"name":"〆の焼きおにぎり","quantity":7,"amount":2660}],
         "payments":[],
         "reservations":[\#(resv("r04", days: 0, party: 4, label: "着席", tone: "success")),
                         \#(resv("r-h1", days: 7, party: 2, label: "退店", tone: "gray")),
                         \#(resv("r-h2", days: 30, party: 6, label: "退店", tone: "gray")),
                         \#(resv("r-h3", days: 52, party: 2, label: "キャンセル", tone: "danger", reason: "お客様キャンセル（連絡あり）"))],
         "orders":[\#(order("o-h1", days: 7, store: "TENPO ONE 新宿店", total: 18600)),
                   \#(order("o-h2", days: 30, store: "TENPO ONE 新宿店", total: 46200)),
                   \#(order("o-h3", days: 61, store: "TENPO ONE 池袋店", total: 12400))]}
        """#
        return J.decode(NCDPayload.self, json, label: "customer")
    }
}

// MARK: - 見本の画面（NativePreviewView から）

/// -tenpoNativePreview phoneOwnerLedger*（kind: list / inbox / detail / new）
struct NPOLedgerPreview: View {
    let kind: String
    @StateObject private var model = NPOSample.ledger()
    @StateObject private var inbox = NPOSample.inbox()

    init(kind: String) {
        self.kind = kind
    }

    var body: some View {
        content
            .preferredColorScheme(.light)
            .overlay(alignment: .bottom) { NPOPreviewProblems() }
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case "detail":
            // 来店前の予約（予約確定・来店・テーブル変更・キャンセルが出る）
            if let r = model.payload?.reservations.first(where: { $0.id == "r09" }) ?? model.payload?.reservations.first {
                NPOLedgerDetail(model: model, reservation: r, onClose: {})
            } else {
                Color.white
            }
        case "new":
            NPOLedgerNewReservation(model: model, date: model.shownDate, onClose: {}, onSaved: { _ in })
        default:
            NPOLedgerView(model: model, inbox: inbox, onBack: {})
                .onAppear { if kind == "inbox" { model.tab = .inbox } }
        }
    }
}

/// -tenpoNativePreview phoneOwnerCustomers | phoneOwnerCustomer（kind: list / detail）
struct NPOCustomersPreview: View {
    let kind: String
    @StateObject private var model = NPOSample.customers()

    init(kind: String) {
        self.kind = kind
    }

    var body: some View {
        NPOCustomersView(model: model, onBack: {}, onWeb: { _ in }, openId: kind == "detail" ? "c-0001" : nil, sampleDetail: NPOSample.customerDetail())
            .preferredColorScheme(.light)
            .overlay(alignment: .bottom) { NPOPreviewProblems() }
    }
}

/// 見本の JSON が読めなかったとき（サーバーの形が変わった）に、画面の下に赤で出す
struct NPOPreviewProblems: View {
    var body: some View {
        if !NSPJson.problems.isEmpty {
            Text(NSPJson.problems.joined(separator: "\n\n"))
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.white)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.red.opacity(0.92)))
                .padding(16)
        }
    }
}
