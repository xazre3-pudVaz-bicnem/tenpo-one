import SwiftUI

// iPhone の店長・オーナー：勤怠・シフト・有給休暇・従業員の見本（ログインなしでシミュレーターに出す。画面写真用）。
// 起動の引数 -tenpoNativePreview phoneAttendance|phoneShifts|phoneLeave|phoneEmployees|phoneEmployee
//   タブは -tenpoNativePreviewTab today|punch|list|requests（勤怠）・admin|mine（有給）
// 名前・店はすべて作りもの（実在の人・店ではない）。見本のときは読み込み・保存をしない（NativePreview.current を見る）。

enum NPWSample {
    static var tab: String? { UserDefaults.standard.string(forKey: "tenpoNativePreviewTab") }
    static var today: String { NATTime.dayFmt.string(from: Date()) }
    static let weekdays = ["日", "月", "火", "水", "木", "金", "土"]

    /// 今日を含む週の月曜（日本の日付）
    static var weekStart: String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = NATTime.tz
        let wd = cal.component(.weekday, from: Date()) // 1=日 … 7=土
        return NSHFmt.addDays(today, -((wd + 5) % 7))
    }

    /// '2026-10-21' → '10/21(火)'
    static func label(_ ymd: String) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = NATTime.tz
        let wd = cal.component(.weekday, from: NATTime.day(ymd))
        return String(ymd.dropFirst(5)).replacingOccurrences(of: "-", with: "/") + "(\(weekdays[(wd + 6) % 7]))"
    }

    /// '2026-10-21' → '10/21（火）'（勤怠一覧の行）
    static func rowLabel(_ ymd: String) -> String {
        label(ymd).replacingOccurrences(of: "(", with: "（").replacingOccurrences(of: ")", with: "）")
    }

    /// '2026-10-21' と '9:02' → '2026/10/21 9:02'
    static func at(_ ymd: String, _ hm: String) -> String { ymd.replacingOccurrences(of: "-", with: "/") + " " + hm }

    static let store = NATStore(id: "00000000-0000-4000-8000-0000000000s1", name: "TENPO ONE 新宿店")
    static let staff: [NATOption] = [
        NATOption(id: "00000000-0000-4000-8000-000000000a01", name: "山田 太郎"),
        NATOption(id: "00000000-0000-4000-8000-000000000a02", name: "佐藤 花子"),
        NATOption(id: "00000000-0000-4000-8000-000000000a03", name: "鈴木 一郎"),
        NATOption(id: "00000000-0000-4000-8000-000000000a04", name: "高橋 美咲"),
        NATOption(id: "00000000-0000-4000-8000-000000000a05", name: "田中 健"),
        NATOption(id: "00000000-0000-4000-8000-000000000a06", name: "伊藤 さくら"),
    ]
    static func staffId(_ i: Int) -> String { staff[i].id }
}

// MARK: - 勤怠

extension NPATModel {
    static func sample() -> NPATModel {
        let m = NPATModel(tab: NPWSample.tab, month: nil, staffId: nil)
        let today = NPWSample.today
        let yesterday = NSHFmt.addDays(today, -1)
        let entryTypes = [NATChoice(value: "normal", label: "通常"), NATChoice(value: "late", label: "遅刻"), NATChoice(value: "early_leave", label: "早退"),
                          NATChoice(value: "absent", label: "欠勤"), NATChoice(value: "paid_leave", label: "有給"), NATChoice(value: "holiday_work", label: "休日出勤")]
        let punchEvents = [NATChoice(value: "clock_in", label: "出勤"), NATChoice(value: "break_start", label: "休憩開始"),
                           NATChoice(value: "break_end", label: "休憩終了"), NATChoice(value: "clock_out", label: "退勤")]
        func ev(_ id: String, _ label: String, _ day: String, _ hm: String, pin: Bool = false) -> NATEvent {
            NATEvent(id: id, label: label, timeLabel: NPWSample.at(day, hm), sourceLabel: pin ? "共用端末（PIN）" : "個人端末", viaPin: pin)
        }
        func row(_ id: String, _ day: String, _ who: Int, inAt: String, outAt: String, brk: Double, worked: String, type: String = "normal",
                 typeLabel: String = "通常", missing: Bool = false, status: String, statusLabel: String, locked: Bool = false, events: [NATEvent]) -> NATRow {
            NATRow(id: id, workDate: day, workDateLabel: NPWSample.rowLabel(day), staffName: NPWSample.staff[who].name, profileId: NPWSample.staffId(who),
                   clockInLabel: inAt, clockOutLabel: outAt, breakMinutes: brk, workedLabel: worked, entryType: type, entryTypeLabel: typeLabel,
                   missing: missing, status: status, statusLabel: statusLabel, locked: locked,
                   defaultClockIn: inAt == "—" ? "" : inAt, defaultClockOut: (outAt == "—" || outAt == "未打刻") ? "" : outAt, events: events)
        }
        let todayRows = [
            row("00000000-0000-4000-8000-000000000e01", today, 0, inAt: "09:58", outAt: "—", brk: 0, worked: "—", status: "open", statusLabel: "勤務中",
                events: [ev("v1", "出勤", today, "9:58")]),
            row("00000000-0000-4000-8000-000000000e02", today, 1, inAt: "10:02", outAt: "—", brk: 0, worked: "—", status: "open", statusLabel: "勤務中",
                events: [ev("v2", "出勤", today, "10:02", pin: true), ev("v3", "休憩開始", today, "13:30", pin: true)]),
            row("00000000-0000-4000-8000-000000000e03", today, 2, inAt: "07:00", outAt: "12:00", brk: 0, worked: "5時間0分", status: "closed", statusLabel: "打刻済",
                events: [ev("v4", "出勤", today, "7:00"), ev("v5", "退勤", today, "12:00")]),
            row("00000000-0000-4000-8000-000000000e04", today, 5, inAt: "—", outAt: "—", brk: 0, worked: "—", type: "paid_leave", typeLabel: "有給",
                status: "approved", statusLabel: "承認済", events: []),
        ]
        let pastRows = [
            row("00000000-0000-4000-8000-000000000e05", yesterday, 0, inAt: "10:00", outAt: "19:05", brk: 60, worked: "8時間5分", status: "closed", statusLabel: "打刻済",
                events: [ev("v6", "出勤", yesterday, "10:00"), ev("v7", "休憩開始", yesterday, "14:00"), ev("v8", "休憩終了", yesterday, "15:00"), ev("v9", "退勤", yesterday, "19:05")]),
            row("00000000-0000-4000-8000-000000000e06", yesterday, 3, inAt: "17:00", outAt: "未打刻", brk: 0, worked: "—", missing: true, status: "open", statusLabel: "勤務中",
                events: [ev("v10", "出勤", yesterday, "17:00", pin: true)]),
            row("00000000-0000-4000-8000-000000000e07", yesterday, 4, inAt: "11:12", outAt: "16:00", brk: 30, worked: "4時間18分", type: "late", typeLabel: "遅刻",
                status: "approved", statusLabel: "承認済", events: [ev("v11", "出勤", yesterday, "11:12"), ev("v12", "退勤", yesterday, "16:00")]),
        ]
        func payload(_ tab: String, punch: NATPunch? = nil, rows: [NATRow]? = nil, requests: [NATRequest]? = nil) -> NATPayload {
            NATPayload(ok: true, tab: tab, store: NPWSample.store, displayName: "山田 太郎", isApprover: true, canReview: true, canPunch: true,
                       isRegisterDevice: false, today: today, entryTypes: entryTypes, punchEvents: punchEvents, punch: punch,
                       month: rows == nil ? nil : String(today.prefix(7)), monthLabel: rows == nil ? nil : NATTime.monthLabel(String(today.prefix(7))),
                       staffId: rows == nil ? nil : "", staffOptions: rows == nil ? nil : NPWSample.staff, showStaff: rows == nil ? nil : true,
                       rows: rows, requests: requests)
        }
        m.todayP = payload("list", rows: todayRows + pastRows)
        m.listP = payload("list", rows: todayRows + pastRows)
        m.punchP = payload("punch", punch: NATPunch(open: true, onBreak: false, canClockIn: false, canClockOut: true, canBreakStart: true, canBreakEnd: false,
                                                    todayShift: "本日のシフト: 10:00〜19:00", elsewhere: nil))
        m.requestsP = payload("requests", requests: [
            NATRequest(id: "00000000-0000-4000-8000-000000000r01", title: "高橋 美咲 さん — \(yesterday)", workDate: yesterday,
                       current: "17:00 〜 未登録（休憩 0分）", desired: "17:00 〜 22:30（休憩 30分）", reason: "退勤の打刻を忘れてしまいました"),
            NATRequest(id: "00000000-0000-4000-8000-000000000r02", title: "田中 健 さん — \(yesterday)", workDate: yesterday,
                       current: "11:12 〜 16:00（休憩 30分）", desired: "11:00 〜 16:00（休憩 30分）", reason: "電車の遅延（遅延証明あり）"),
        ])
        m.shiftsP = NPSHModel.samplePayload()
        return m
    }
}

// MARK: - シフト

extension NPSHModel {
    static func sample() -> NPSHModel {
        let m = NPSHModel(week: nil)
        m.payload = samplePayload()
        return m
    }

    static func samplePayload() -> NSHPayload {
        let start = NPWSample.weekStart
        let days = (0..<7).map { NSHFmt.addDays(start, $0) }
        let staff = NPWSample.staff.map { NSHStaff(id: $0.id, name: $0.name, isHelp: false) }
            + [NSHStaff(id: "00000000-0000-4000-8000-000000000a07", name: "中村 翔", isHelp: true)]
        var shifts: [NSHShift] = []
        func add(_ day: Int, _ who: Int, _ from: String, _ to: String, kind: String = "confirmed", status: String = "published", note: String? = nil) {
            let n = shifts.count + 1
            shifts.append(NSHShift(id: String(format: "00000000-0000-4000-8000-%012d", n), profileId: staff[who].id, date: days[day],
                                   startTime: from, endTime: to, kind: kind, status: status, note: note))
        }
        for d in 0..<7 {
            add(d, 0, "10:00", "19:00")
            if d != 2 { add(d, 1, "10:00", "15:00") }
            if d % 2 == 0 { add(d, 2, "07:00", "12:00") }
            if d >= 4 { add(d, 3, "17:00", "22:30", kind: d == 6 ? "planned" : "confirmed", status: d == 6 ? "draft" : "published") }
        }
        add(1, 4, "11:00", "16:00", kind: "requested")
        add(3, 4, "11:00", "16:00", status: "change_requested", note: "休み希望（通院のため）")
        add(5, 6, "17:00", "23:00", kind: "planned", status: "draft")
        add(6, 5, "12:00", "18:00", kind: "planned", status: "draft")
        let forecast = days.enumerated().map { pair -> NSHForecast in
            let i = pair.offset
            let d = pair.element
            let labor = Double(52_000 + i * 3_500)
            let sales = Double(240_000 + (i >= 4 ? 120_000 : 0))
            let ratio = labor / sales * 100
            return NSHForecast(date: d, label: NPWSample.label(d), source: i < 5 ? "budget" : "forecast", salesBasis: sales, plannedLabor: labor,
                               ratio: ratio, targetRatio: i < 5 ? 20 : nil, diff: i < 5 ? ratio - 20 : nil)
        }
        return NSHPayload(
            ok: true, store: NSHStore(id: NPWSample.store.id, name: NPWSample.store.name), selfId: staff[0].id, canManage: true,
            todayWeekStart: start, weekStart: start, weekEnd: days[6],
            rangeLabel: "\(String(start.dropFirst(5)).replacingOccurrences(of: "-", with: "/")) 〜 \(String(days[6].dropFirst(5)).replacingOccurrences(of: "-", with: "/"))",
            weekDates: days.map { NSHDay(date: $0, label: NPWSample.label($0)) },
            staff: staff, shifts: shifts,
            orgStaffOptions: [NSHOrgStaff(id: "00000000-0000-4000-8000-000000000a07", name: "中村 翔", homeStores: "TENPO ONE 渋谷店")],
            laborRows: [NSHLabor(name: "山田 太郎", isHelp: false, minutes: 3780, cost: 75_600), NSHLabor(name: "佐藤 花子", isHelp: false, minutes: 1800, cost: 34_200),
                        NSHLabor(name: "鈴木 一郎", isHelp: false, minutes: 1200, cost: 22_800), NSHLabor(name: "高橋 美咲", isHelp: false, minutes: 1650, cost: 33_000),
                        NSHLabor(name: "中村 翔", isHelp: true, minutes: 360, cost: nil)],
            totalCost: 165_600, forecastRows: forecast,
            shortages: [NSHShortage(date: days[5], label: NPWSample.label(days[5]), timeFrom: "18:00", timeTo: "22:00", required: 4, actual: 2)],
            consecutiveWarnings: [NSHStreak(profileId: staff[0].id, name: "山田 太郎", streak: 7)],
            weeklyHourWarnings: [], outOfHoursWarnings: [],
            requirements: [NSHRequirement(id: "00000000-0000-4000-8000-0000000000q1", dayOfWeek: 5, timeFrom: "18:00", timeTo: "22:00", requiredCount: 4),
                           NSHRequirement(id: "00000000-0000-4000-8000-0000000000q2", dayOfWeek: 6, timeFrom: "11:00", timeTo: "15:00", requiredCount: 3)],
            thresholds: NSHThresholds(laborRatio: 30, consecutiveDays: 6, weeklyHours: 40)
        )
    }
}

// MARK: - 有給休暇

extension NPLVModel {
    static func sample() -> NPLVModel {
        let m = NPLVModel(tab: NPWSample.tab)
        let today = NPWSample.today
        let staff = NPWSample.staff
        m.admin = NLVPayload(
            ok: true, tab: "admin", displayName: "山田 太郎", isApprover: true, canReview: true, canSetPolicy: true, today: today,
            summary: nil, requests: nil, grants: nil, taken: nil,
            staffOptions: staff, defaultExpiryYears: 2,
            grantDefaults: NLVGrantDefaults(days: 10, grantedOn: today, expiresOn: NLVDate.addYears(today, 2)),
            pending: [NLVPending(id: "00000000-0000-4000-8000-0000000000l1", staffName: "佐藤 花子", dateLabel: "2026/11/3", fractionLabel: "全休", reason: "家族の行事のため"),
                      NLVPending(id: "00000000-0000-4000-8000-0000000000l2", staffName: "田中 健", dateLabel: "2026/11/12", fractionLabel: "半休", reason: "通院")],
            expiringSoon: [NLVExpiring(id: "g1", staffName: "鈴木 一郎", daysLabel: "3日", expiresLabel: "2026/11/30")],
            balances: [NLVBalance(id: staff[0].id, name: staff[0].name, granted: 14, taken: 5, expired: 0, remaining: 9),
                       NLVBalance(id: staff[1].id, name: staff[1].name, granted: 10, taken: 2.5, expired: 0, remaining: 7.5),
                       NLVBalance(id: staff[2].id, name: staff[2].name, granted: 11, taken: 8, expired: 1, remaining: 3),
                       NLVBalance(id: staff[3].id, name: staff[3].name, granted: 10, taken: 0, expired: 0, remaining: 10),
                       NLVBalance(id: staff[4].id, name: staff[4].name, granted: 7, taken: 7, expired: 0, remaining: 0)],
            policy: NLVPolicy(expiryYears: 2, memo: "入社6ヶ月経過後に10日付与。以降は勤続年数に応じて加算。")
        )
        m.mine = NLVPayload(
            ok: true, tab: "mine", displayName: "山田 太郎", isApprover: true, canReview: true, canSetPolicy: true, today: today,
            summary: NLVSummary(remaining: 9, activeGranted: 14, taken: 5, expired: 0),
            requests: [NLVRequest(id: "00000000-0000-4000-8000-0000000000m1", leaveDate: "2026-11-20", dateLabel: "2026/11/20", fractionLabel: "全休",
                                  reason: "私用のため", status: "pending", statusLabel: "承認待ち", rejectNote: nil, canWithdraw: true),
                       NLVRequest(id: "00000000-0000-4000-8000-0000000000m2", leaveDate: "2026-09-08", dateLabel: "2026/9/8", fractionLabel: "全休",
                                  reason: "旅行", status: "approved", statusLabel: "承認済み", rejectNote: nil, canWithdraw: false)],
            grants: [NLVGrant(id: "gr1", grantedLabel: "2026/4/1", daysLabel: "11日", expiresLabel: "2028/4/1", reasonLabel: "年次付与", expired: false),
                     NLVGrant(id: "gr2", grantedLabel: "2025/4/1", daysLabel: "10日", expiresLabel: "2027/4/1", reasonLabel: "年次付与", expired: false)],
            taken: [NLVTaken(id: "t1", dateLabel: "2026/9/8", fractionLabel: "全休", note: ""), NLVTaken(id: "t2", dateLabel: "2026/7/22", fractionLabel: "半休", note: "午後")],
            staffOptions: nil, defaultExpiryYears: nil, grantDefaults: nil, pending: nil, expiringSoon: nil, balances: nil, policy: nil
        )
        return m
    }
}

// MARK: - 従業員

enum NPEMSample {
    static let stores = [NEMOption(id: "00000000-0000-4000-8000-0000000000s1", name: "TENPO ONE 新宿店"),
                         NEMOption(id: "00000000-0000-4000-8000-0000000000s2", name: "TENPO ONE 渋谷店")]
    static let types = [NEMType(id: "full_time", label: "正社員"), NEMType(id: "contract", label: "契約社員"),
                        NEMType(id: "part_time", label: "アルバイト・パート"), NEMType(id: "outsourced", label: "業務委託")]

    static func row(_ i: Int, _ no: String, _ name: String, _ type: String, _ store: String?, _ pos: String?, _ hired: String?, status: String = "active") -> NEMRow {
        NEMRow(id: String(format: "00000000-0000-4000-8000-0000000001%02d", i), employeeNo: no, legalName: name, displayName: name, employmentType: type,
               employmentTypeLabel: types.first { $0.id == type }?.label ?? type, storeName: store, position: pos, hiredOn: hired,
               hiredOnLabel: hired.map { $0.replacingOccurrences(of: "-", with: "/") } ?? "—",
               status: status, statusLabel: status == "active" ? "在籍中" : "退職")
    }

    static var list: NEMListPayload {
        NEMListPayload(ok: true, canWrite: true, rows: [
            row(1, "0001", "山田 太郎", "full_time", "TENPO ONE 新宿店", "店長", "2021-04-01"),
            row(2, "0002", "佐藤 花子", "full_time", "TENPO ONE 新宿店", "副店長", "2022-10-01"),
            row(3, "0013", "鈴木 一郎", "part_time", "TENPO ONE 新宿店", nil, "2024-06-15"),
            row(4, "0017", "高橋 美咲", "part_time", "TENPO ONE 渋谷店", nil, "2025-01-10"),
            row(5, "0021", "田中 健", "contract", "TENPO ONE 渋谷店", "キッチン", "2025-08-01"),
            row(6, "0008", "伊藤 さくら", "part_time", "TENPO ONE 新宿店", nil, "2023-03-01", status: "retired"),
        ], staffOptions: [NEMOption(id: "00000000-0000-4000-8000-000000000a07", name: "中村 翔")], stores: stores, employmentTypes: types)
    }

    static var detail: NEMDetailPayload {
        let id = String(format: "00000000-0000-4000-8000-0000000001%02d", 1)
        return NEMDetailPayload(
            ok: true, state: "ok", canViewList: true, canEdit: true, displayName: "山田 太郎", employmentType: "full_time", employmentTypeLabel: "正社員",
            storeName: "TENPO ONE 新宿店", hiredOn: "2021-04-01", hiredOnLabel: "2021/4/1",
            basic: NEMBasic(id: id, employeeNo: "0001", legalName: "山田 太郎", legalNameKana: "ヤマダ タロウ", postalCode: "160-0000",
                            address: "東京都新宿区○○1-2-3 サンプルマンション101", birthDate: "1990-05-12", hiredOn: "2021-04-01", terminatedOn: "",
                            employmentType: "full_time", position: "店長", primaryStoreId: stores[0].id, status: "active"),
            confidential: NEMConfidential(employeeId: id, bank: NEMBank(bank: "サンプル銀行", branch: "新宿支店", type: "普通", last4: "1234", holder: "ヤマダ タロウ"),
                                          emergency: NEMEmergency(name: "山田 花子", relation: "配偶者", phone: "090-0000-0000")),
            insurance: NEMInsurance(employeeId: id, healthInsurance: true, pension: true, employmentInsurance: true, careInsurance: false,
                                    standardMonthlyRemuneration: "300000", acquiredOn: "2021-04-01", lostOn: "", region: "東京都", note: ""),
            stores: stores, employmentTypes: types
        )
    }
}

extension NPEMListModel {
    static func sample() -> NPEMListModel {
        let m = NPEMListModel()
        m.payload = NPEMSample.list
        return m
    }
}

extension NPEMDetailModel {
    static func sample() -> NPEMDetailModel {
        let m = NPEMDetailModel(id: NPEMSample.detail.basic?.id ?? "")
        m.payload = NPEMSample.detail
        return m
    }
}

// MARK: - 見本の画面

struct NativePhoneStaffPreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "phoneShifts": NPSHPreviewScreen()
        case "phoneLeave": NPLVPreviewScreen()
        case "phoneEmployees": NPEMListPreviewScreen()
        case "phoneEmployee": NPEMDetailPreviewScreen()
        default: NPATPreviewScreen()
        }
    }
}

private struct NPATPreviewScreen: View {
    @StateObject private var model = NPATModel.sample()
    var body: some View { NativePhoneAttendanceView(model: model, onBack: {}) }
}

private struct NPSHPreviewScreen: View {
    @StateObject private var model = NPSHModel.sample()
    var body: some View { NativePhoneShiftsView(model: model, onBack: {}, onWeb: { _ in }) }
}

private struct NPLVPreviewScreen: View {
    @StateObject private var model = NPLVModel.sample()
    var body: some View { NativePhoneLeaveView(model: model, onBack: {}) }
}

private struct NPEMListPreviewScreen: View {
    @StateObject private var model = NPEMListModel.sample()
    var body: some View { NativePhoneEmployeeListView(model: model, onBack: {}, open: { _ in }) }
}

private struct NPEMDetailPreviewScreen: View {
    @StateObject private var model = NPEMDetailModel.sample()
    var body: some View { NativePhoneEmployeeDetailView(model: model, onBack: { _ in }) }
}
