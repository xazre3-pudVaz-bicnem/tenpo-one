import SwiftUI

// iPhone の店長・オーナー：給与・マニュアル・クーポンの見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）
//   -tenpoNativePreview phoneOwnerPayroll（給与計算の一覧）| phoneOwnerPayrollRun（給与計算の詳細）
//                       phoneOwnerPayslips（スタッフの給与明細の一覧）| phoneOwnerPayslip（給与明細書）| phoneOwnerNencho（年末調整）
//                       phoneOwnerManuals（マニュアル）| phoneOwnerCoupons（クーポンの一覧）| phoneOwnerCoupon（クーポンの詳細）
// 名前・店舗はすべて作りもの（実在の人・お店ではない）。中身はサーバーと同じ形の辞書から作る（NOS.decode）

struct NativePhoneOwnerPeoplePreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "phoneOwnerPayrollRun":
            NPPYRunPreview(manager: true)
        case "phoneOwnerPayslips":
            NPPYListPreview(manager: false)
        case "phoneOwnerPayslip":
            NPPYRunPreview(manager: false)
        case "phoneOwnerNencho":
            NPPYNenchoPreview()
        case "phoneOwnerManuals":
            NPMNPreview()
        case "phoneOwnerCoupons", "phoneOwnerCoupon":
            NPCPPreview(detail: kind == "phoneOwnerCoupon")
        default:
            NPPYListPreview(manager: true)
        }
    }
}

/// 見本の中身（サーバーの返事と同じ形の辞書）
enum NPPYSample {
    static let shinjuku = "TENPO ONE 新宿店"
    static let shibuya = "TENPO ONE 渋谷店"

    static func id(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }

    static func option(_ n: Int, _ name: String) -> [String: Any] {
        ["id": id(n), "name": name]
    }

    static var staff: [[String: Any]] {
        [option(101, "山田 太郎"), option(102, "佐藤 花子"), option(103, "鈴木 一郎"), option(104, "田中 美咲")]
    }

    static var stores: [[String: Any]] {
        [option(1, shinjuku), option(2, shibuya)]
    }

    static func day(_ offset: Int) -> String { NOS.addDays(NOS.today, offset) }

    static func iso(daysAgo: Double) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-daysAgo * 24 * 3600))
    }

    // MARK: 給与・歩合の一覧（店長・オーナー）

    static func managerList() -> [String: Any] {
        let allowances: [[String: Any]] = [["name": "役職手当", "amount": 20000, "per": "month"]]
        var r1: [String: Any] = [:]
        r1["id"] = id(201)
        r1["profileId"] = id(101)
        r1["profileName"] = "山田 太郎"
        r1["storeId"] = id(1)
        r1["storeName"] = shinjuku
        r1["payType"] = "hourly"
        r1["payTypeLabel"] = "時給"
        r1["baseAmount"] = 1300
        r1["overtimeRate"] = 1.25
        r1["nightRate"] = 0.25
        r1["holidayRate"] = 1.35
        r1["commuteAllowance"] = 600
        r1["allowances"] = allowances
        r1["closingDay"] = 31
        r1["paymentDay"] = 25
        r1["effectiveFrom"] = "2026-04-01"
        r1["effectiveFromLabel"] = "2026/04/01"
        var r2 = r1
        r2["id"] = id(202)
        r2["profileId"] = id(102)
        r2["profileName"] = "佐藤 花子"
        r2["payType"] = "monthly"
        r2["payTypeLabel"] = "月給"
        r2["baseAmount"] = 260000
        r2["allowances"] = [[String: Any]]()
        var r3 = r1
        r3["id"] = id(203)
        r3["profileId"] = id(103)
        r3["profileName"] = "鈴木 一郎"
        r3["storeId"] = id(2)
        r3["storeName"] = shibuya
        r3["baseAmount"] = 1150
        r3["allowances"] = [[String: Any]]()

        var c1: [String: Any] = [:]
        c1["id"] = id(301)
        c1["name"] = "個人売上歩合"
        c1["targetType"] = "personal_sales"
        c1["profileName"] = "全スタッフ"
        c1["storeId"] = id(1)
        c1["storeName"] = shinjuku
        c1["method"] = "rate"
        c1["methodLabel"] = "料率"
        c1["rate"] = 2
        c1["basis"] = "tax_excluded"
        c1["basisLabel"] = "税抜"
        c1["effectiveFrom"] = "2026-04-01"
        c1["effectiveFromLabel"] = "2026/04/01"
        var c2: [String: Any] = [:]
        c2["id"] = id(302)
        c2["name"] = "月間目標達成ボーナス"
        c2["targetType"] = "store_target"
        c2["profileName"] = "全スタッフ"
        c2["storeName"] = "全店舗"
        c2["method"] = "fixed"
        c2["methodLabel"] = "固定額"
        c2["fixedAmount"] = 10000
        c2["minAmount"] = 6000000
        c2["basis"] = "tax_excluded"
        c2["basisLabel"] = "税抜"
        c2["effectiveFrom"] = "2026-06-01"
        c2["effectiveFromLabel"] = "2026/06/01"

        let runs: [[String: Any]] = [
            run(401, "salary", "2026年9月分", "2026/09/01 〜 2026/09/30", "全社", "confirmed", "2026/10/03"),
            run(402, "salary", "2026年8月分", "2026/08/01 〜 2026/08/31", "全社", "approved", "2026/09/03"),
            run(403, "bonus", "2026年 夏季賞与", "支給日: 2026/07/10", shinjuku, "approved", "2026/07/01"),
            run(404, "salary", "2026年9月分（渋谷・再計算）", "2026/09/01 〜 2026/09/30", shibuya, "draft", "2026/10/05"),
            run(405, "salary", "2026年7月分", "2026/07/01 〜 2026/07/31", "全社", "approved", "2026/08/03"),
        ]

        var defaults: [String: Any] = [:]
        defaults["periodStart"] = "2026-09-01"
        defaults["periodEnd"] = "2026-09-30"
        defaults["salaryTitle"] = "2026年9月分"
        defaults["bonusTitle"] = "2026年 賞与"
        defaults["today"] = NOS.today

        var d: [String: Any] = [:]
        d["ok"] = true
        d["view"] = "list"
        d["canManage"] = true
        d["staff"] = staff
        d["stores"] = stores
        d["defaults"] = defaults
        d["rules"] = [r1, r2, r3]
        d["commissionRules"] = [c1, c2]
        d["runs"] = runs
        return d
    }

    static func run(_ n: Int, _ type: String, _ title: String, _ period: String, _ store: String, _ status: String, _ created: String) -> [String: Any] {
        var r: [String: Any] = [:]
        r["id"] = id(n)
        r["runType"] = type
        r["title"] = title
        r["periodLabel"] = period
        r["storeName"] = store
        r["status"] = status
        r["createdLabel"] = created
        return r
    }

    // MARK: スタッフの給与明細の一覧

    static func staffList() -> [String: Any] {
        let slips: [[String: Any]] = [
            slip(401, "2026年9月分", "salary", "2026/09/01 〜 2026/09/30", 264_900),
            slip(402, "2026年8月分", "salary", "2026/08/01 〜 2026/08/31", 236_400),
            slip(403, "2026年 夏季賞与", "bonus", "支給日: 2026/07/10", 150_000),
            slip(405, "2026年7月分", "salary", "2026/07/01 〜 2026/07/31", 229_850),
            slip(406, "2026年6月分", "salary", "2026/06/01 〜 2026/06/30", 241_300),
            slip(407, "2026年5月分", "salary", "2026/05/01 〜 2026/05/31", 218_900),
        ]
        var d: [String: Any] = [:]
        d["ok"] = true
        d["view"] = "list"
        d["canManage"] = false
        d["payslips"] = slips
        return d
    }

    static func slip(_ n: Int, _ title: String, _ type: String, _ period: String, _ gross: Int) -> [String: Any] {
        var s: [String: Any] = [:]
        s["id"] = id(n)
        s["title"] = title
        s["runType"] = type
        s["periodLabel"] = period
        s["grossTotal"] = gross
        return s
    }

    // MARK: 給与計算の詳細・給与明細書

    static func figures(days: Int, work: Int, ot: Int, night: Int, base: Int, otPay: Int, nightPay: Int, commute: Int, allowance: Int, commission: Int) -> [String: Any] {
        var f: [String: Any] = [:]
        f["workDays"] = days
        f["workMinutes"] = work
        f["overtimeMinutes"] = ot
        f["nightMinutes"] = night
        f["holidayMinutes"] = 0
        f["basePay"] = base
        f["overtimePay"] = otPay
        f["nightPay"] = nightPay
        f["holidayPay"] = 0
        f["commutePay"] = commute
        f["allowanceTotal"] = allowance
        f["commissionTotal"] = commission
        f["grossTotal"] = base + otPay + nightPay + commute + allowance + commission
        return f
    }

    static func days() -> [[String: Any]] {
        let rows: [(String, String, String, String, String)] = [
            ("2026-09-01", "10:00〜19:00", "8:00", "0:00", "0:00"),
            ("2026-09-02", "16:00〜23:30", "6:30", "0:00", "1:30"),
            ("2026-09-04", "10:00〜21:00", "10:00", "2:00", "0:00"),
            ("2026-09-05", "17:00〜23:00", "5:30", "0:00", "1:00"),
            ("2026-09-07", "10:00〜19:00", "8:00", "0:00", "0:00"),
        ]
        return rows.map { r in
            var d: [String: Any] = [:]
            d["date"] = r.0
            d["inOut"] = r.1
            d["work"] = r.2
            d["overtime"] = r.3
            d["night"] = r.4
            d["holiday"] = "0:00"
            return d
        }
    }

    static func item(_ n: Int, _ name: String, _ f: [String: Any], lines: [[String: Any]]) -> [String: Any] {
        var d = f
        d["id"] = id(n)
        d["profileName"] = name
        d["lines"] = lines
        d["days"] = days()
        return d
    }

    static func line(_ text: String, strong: Bool = false) -> [String: Any] {
        var l: [String: Any] = ["text": text]
        if strong { l["strong"] = true }
        return l
    }

    static func runDetail() -> [String: Any] {
        let f1 = figures(days: 20, work: 9150, ot: 480, night: 600, base: 198_250, otPay: 13_000, nightPay: 3_250, commute: 12_000, allowance: 20_000, commission: 18_400)
        let f2 = figures(days: 21, work: 10080, ot: 300, night: 0, base: 260_000, otPay: 9_400, nightPay: 0, commute: 12_600, allowance: 0, commission: 12_100)
        let f3 = figures(days: 14, work: 5400, ot: 0, night: 900, base: 103_500, otPay: 0, nightPay: 4_310, commute: 8_400, allowance: 0, commission: 0)
        let items: [[String: Any]] = [
            item(501, "山田 太郎", f1, lines: [
                line("基本給 = 時給¥1,300 × 実働152:30 = ¥198,250"),
                line("残業代 = 割増基礎時給¥1,300 × 残業8:00 = ¥13,000"),
                line("深夜手当 = 割増基礎時給¥1,300 × 深夜10:00 = ¥3,250"),
                line("歩合 = 個人売上 ¥920,000 × 2% = ¥18,400"),
                line("総支給 = ¥264,900", strong: true),
            ]),
            item(502, "佐藤 花子", f2, lines: [
                line("基本給 = 月給¥260,000 = ¥260,000"),
                line("歩合 = 個人売上 ¥605,000 × 2% = ¥12,100"),
                line("総支給 = ¥294,100", strong: true),
            ]),
            item(503, "鈴木 一郎", f3, lines: [
                line("基本給 = 時給¥1,150 × 実働90:00 = ¥103,500"),
                line("総支給 = ¥116,210", strong: true),
            ]),
        ]
        var totals: [String: Any] = [:]
        for key in ["workDays", "workMinutes", "overtimeMinutes", "nightMinutes", "holidayMinutes", "basePay", "overtimePay", "nightPay",
                    "holidayPay", "commutePay", "allowanceTotal", "commissionTotal", "grossTotal"] {
            totals[key] = [f1, f2, f3].reduce(0) { $0 + (($1[key] as? Int) ?? 0) }
        }
        var run: [String: Any] = [:]
        run["id"] = id(401)
        run["title"] = "2026年9月分"
        run["runType"] = "salary"
        run["status"] = "confirmed"
        run["description"] = "2026/09/01 〜 2026/09/30｜対象: 全社"
        run["csvName"] = "payroll_2026-09-01_2026年9月分.csv"
        var d: [String: Any] = [:]
        d["ok"] = true
        d["view"] = "run"
        d["mode"] = "manage"
        d["run"] = run
        d["items"] = items
        d["totals"] = totals
        d["bonusItems"] = [[String: Any]]()
        d["bonusTotal"] = 0
        return d
    }

    static func payslip() -> [String: Any] {
        var p = figures(days: 20, work: 9150, ot: 480, night: 600, base: 198_250, otPay: 13_000, nightPay: 3_250, commute: 12_000, allowance: 20_000, commission: 18_400)
        p["runTitle"] = "2026年9月分"
        p["runType"] = "salary"
        p["periodLabel"] = "対象期間: 2026/09/01 〜 2026/09/30"
        p["profileName"] = "山田 太郎"
        p["organizationName"] = "TENPO ONE 株式会社（見本）"
        return p
    }

    static func selfDetail() -> [String: Any] {
        var d: [String: Any] = [:]
        d["ok"] = true
        d["view"] = "run"
        d["mode"] = "self"
        d["payslip"] = payslip()
        return d
    }

    // MARK: 年末調整

    static func nencho() -> [String: Any] {
        let deps: [[String: Any]] = [
            ["name": "山田 花", "relation": "子", "birthDate": "2018-05-12"],
            ["name": "山田 次郎", "relation": "子", "birthDate": "2021-11-03"],
        ]
        var data: [String: Any] = [:]
        data["dependents"] = deps
        data["hasSpouse"] = true
        data["spouseIncome"] = 800_000
        data["lifeInsurancePremium"] = 84_000
        data["earthquakeInsurancePremium"] = 12_000
        data["hasHousingLoanDeduction"] = false
        data["hasPreviousEmploymentIncome"] = false
        data["basicDeductionNote"] = ""
        var own: [String: Any] = [:]
        own["status"] = "draft"
        own["data"] = data

        let lines1: [[String: Any]] = [["text": "配偶者: なし"], ["text": "生命保険料: 60,000円"], ["text": "地震保険料: 0円"],
                                       ["text": "住宅ローン控除: なし"], ["text": "前職源泉徴収票: なし"]]
        let lines2: [[String: Any]] = [["text": "配偶者: あり（年間所得概算 1,000,000円）"], ["text": "生命保険料: 120,000円"],
                                       ["text": "差戻し理由: 生命保険料の控除証明書の金額と合いません", "tone": "danger"]]
        let rows: [[String: Any]] = [
            nenchoRow(601, "佐藤 花子", "submitted", "2026/10/20", ["佐藤 健（子・2016/04/01）"], lines1),
            nenchoRow(602, "鈴木 一郎", "needs_fix", "2026/10/18", [], lines2),
            nenchoRow(603, "田中 美咲", "confirmed", "2026/10/15", [], lines1),
        ]
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())
        var d: [String: Any] = [:]
        d["ok"] = true
        d["view"] = "nencho"
        d["year"] = year
        d["yearOptions"] = [year, year - 1]
        d["status"] = ""
        d["canReview"] = true
        d["canManage"] = true
        d["own"] = own
        d["adminRows"] = rows
        return d
    }

    static func nenchoRow(_ n: Int, _ name: String, _ status: String, _ submitted: String, _ deps: [String], _ lines: [[String: Any]]) -> [String: Any] {
        var r: [String: Any] = [:]
        r["id"] = id(n)
        r["profileName"] = name
        r["year"] = Calendar(identifier: .gregorian).component(.year, from: Date())
        r["status"] = status
        r["submittedLabel"] = submitted
        r["dependents"] = deps
        r["lines"] = lines
        return r
    }

    // MARK: マニュアル

    static func manuals() -> [String: Any] {
        let cats: [(String, String)] = [("service", "接客"), ("hygiene", "衛生"), ("cooking", "調理"), ("register", "レジ"),
                                        ("attendance", "勤怠"), ("emergency", "緊急対応"), ("other", "その他")]
        let categories: [[String: Any]] = cats.map { ["key": $0.0, "label": $0.1] }
        let list: [[String: Any]] = [
            manual(701, "いらっしゃいませから会計までの流れ", "service", "全店共通", true, nil, "新人研修の最初に読んでください"),
            manual(702, "電話予約の受け方", "service", shinjuku, false, "https://example.com/manual/phone", "動画（5分）"),
            manual(703, "開店前の衛生チェック表", "hygiene", "全店共通", true, nil, "毎朝 10:00 までに記入"),
            manual(704, "まかないの仕込み手順", "cooking", shinjuku, true, nil, nil),
            manual(705, "季節の炊き込みご飯（アレルギー表示つき）", "cooking", shinjuku, true, nil, "小麦・大豆を含みます"),
            manual(706, "レジ締めの手順", "register", "全店共通", true, nil, "現金は束ごとに入力"),
            manual(707, "地震・火災のときの避難経路", "emergency", shinjuku, true, nil, "裏口の鍵の場所も確認"),
        ]
        var target: [String: Any] = [:]
        target["id"] = id(1)
        target["name"] = shinjuku
        var d: [String: Any] = [:]
        d["ok"] = true
        d["canWrite"] = true
        d["canTargetAllStores"] = true
        d["target"] = target
        d["categories"] = categories
        d["manuals"] = list
        return d
    }

    static func manual(_ n: Int, _ title: String, _ category: String, _ store: String, _ hasFile: Bool, _ url: String?, _ note: String?) -> [String: Any] {
        var m: [String: Any] = [:]
        m["id"] = id(n)
        m["title"] = title
        m["category"] = category
        m["storeLabel"] = store
        m["hasFile"] = hasFile
        if let url { m["url"] = url }
        if let note { m["note"] = note }
        m["canDelete"] = true
        return m
    }

    // MARK: クーポン

    static func coupons() -> [String: Any] {
        let rows: [[String: Any]] = [
            coupon(801, "WELCOME500", "はじめての方 500円引き", "fixed", 500, nil, "全体", minTotal: 3000, starts: nil, ends: nil,
                   maxUses: nil, perCustomer: 1, firstVisit: true, status: "active", used: 38),
            coupon(802, "LUNCH10", "平日ランチ 10%OFF", "percent", 10, shinjuku, "ランチ", minTotal: 0, starts: iso(daysAgo: 20), ends: iso(daysAgo: -40),
                   maxUses: 300, perCustomer: nil, firstVisit: false, status: "active", used: 124, timeFrom: "11:00:00", timeTo: "14:30:00"),
            coupon(803, "BDAY-2026", "お誕生日月 ドリンク1杯無料", "fixed", 600, nil, "ドリンク", minTotal: 2000, starts: nil, ends: nil,
                   maxUses: nil, perCustomer: 1, firstVisit: false, status: "paused", used: 12),
            coupon(804, "SUMMER15", "夏の宴会 15%OFF", "percent", 15, shibuya, "全体", minTotal: 20000, starts: iso(daysAgo: 110), ends: iso(daysAgo: 50),
                   maxUses: 100, perCustomer: nil, firstVisit: false, status: "deleted", used: 41),
        ]
        var d: [String: Any] = [:]
        d["ok"] = true
        d["rows"] = rows
        d["stores"] = stores
        d["categories"] = [option(901, "ランチ"), option(902, "ドリンク"), option(903, "コース")]
        d["items"] = [option(911, "季節の炊き込みご飯"), option(912, "生ビール（中）")]
        return d
    }

    static func coupon(_ n: Int, _ code: String, _ name: String, _ kind: String, _ value: Int, _ store: String?, _ target: String,
                       minTotal: Int, starts: String?, ends: String?, maxUses: Int?, perCustomer: Int?, firstVisit: Bool, status: String, used: Int,
                       timeFrom: String? = nil, timeTo: String? = nil) -> [String: Any] {
        var c: [String: Any] = [:]
        c["id"] = id(n)
        c["code"] = code
        c["name"] = name
        c["kind"] = kind
        c["value"] = value
        if let store {
            c["storeId"] = store == shinjuku ? id(1) : id(2)
            c["storeName"] = store
        }
        c["targetLabel"] = target
        c["minTotal"] = minTotal
        if let starts { c["startsAt"] = starts }
        if let ends { c["endsAt"] = ends }
        if let timeFrom { c["timeFrom"] = timeFrom }
        if let timeTo { c["timeTo"] = timeTo }
        if let maxUses { c["maxUses"] = maxUses }
        if let perCustomer { c["perCustomerLimit"] = perCustomer }
        c["firstVisitOnly"] = firstVisit
        c["stackable"] = false
        c["status"] = status
        c["redemptionCount"] = used
        return c
    }

    static func uses() -> [NPCPUse] {
        let names: [String?] = ["高橋 さくら", nil, "伊藤 健太", "渡辺 由美", nil]
        return names.enumerated().map { i, name in
            NPCPUse(id: id(950 + i), createdAt: iso(daysAgo: Double(i) * 1.7 + 0.2), orderId: id(960 + i), customerName: name, discountAmount: Double(980 + i * 120))
        }
    }
}

// MARK: - 見本のモデル

extension NPPYListModel {
    static func sample(manager: Bool) -> NPPYListModel {
        let m = NPPYListModel()
        m.payload = NOS.decode(NPPYListPayload.self, manager ? NPPYSample.managerList() : NPPYSample.staffList())
        if !manager { m.latest = NOS.decode(NPPYPayslip.self, NPPYSample.payslip()) }
        return m
    }
}

extension NPPYRunModel {
    static func sample(manager: Bool) -> NPPYRunModel {
        let m = NPPYRunModel(runId: NPPYSample.id(401))
        m.payload = NOS.decode(NPPYRunPayload.self, manager ? NPPYSample.runDetail() : NPPYSample.selfDetail())
        return m
    }
}

extension NPPYNenchoModel {
    static func sample() -> NPPYNenchoModel {
        let m = NPPYNenchoModel(year: nil, status: nil)
        if let p = NOS.decode(NPPYNenchoPayload.self, NPPYSample.nencho()) {
            m.payload = p
            m.form = NPPYNenchoForm(p.own.data)
            m.year = p.year
        }
        return m
    }
}

extension NPMNModel {
    static func sample() -> NPMNModel {
        let m = NPMNModel()
        m.payload = NOS.decode(NPMNPayload.self, NPPYSample.manuals())
        return m
    }
}

extension NPCPModel {
    static func sample(detail: Bool) -> NPCPModel {
        let m = NPCPModel()
        m.payload = NOS.decode(NPCPPayload.self, NPPYSample.coupons())
        m.uses[NPPYSample.id(802)] = NPPYSample.uses()
        if detail { m.detailId = NPPYSample.id(802) }
        return m
    }
}

// MARK: - 見本の画面

private struct NPPYListPreview: View {
    @StateObject private var model: NPPYListModel
    @State private var tab = "runs"

    init(manager: Bool) {
        _model = StateObject(wrappedValue: NPPYListModel.sample(manager: manager))
    }

    var body: some View {
        NPPYListView(model: model, tab: $tab, onBack: {}, open: { _ in })
    }
}

private struct NPPYRunPreview: View {
    @StateObject private var model: NPPYRunModel

    init(manager: Bool) {
        _model = StateObject(wrappedValue: NPPYRunModel.sample(manager: manager))
    }

    var body: some View {
        NPPYRunView(model: model, onBack: {}, onWeb: { _ in })
    }
}

private struct NPPYNenchoPreview: View {
    @StateObject private var model = NPPYNenchoModel.sample()

    var body: some View {
        NPPYNenchoView(model: model, onBack: {})
    }
}

private struct NPMNPreview: View {
    @StateObject private var model = NPMNModel.sample()

    var body: some View {
        NativePhoneManualsView(model: model, onBack: {})
    }
}

private struct NPCPPreview: View {
    @StateObject private var model: NPCPModel

    init(detail: Bool) {
        _model = StateObject(wrappedValue: NPCPModel.sample(detail: detail))
    }

    var body: some View {
        NativePhoneCouponsView(model: model, onBack: {}, onOrder: { _ in })
    }
}
