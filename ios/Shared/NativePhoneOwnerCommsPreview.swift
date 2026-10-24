import SwiftUI

// iPhone の店長・オーナー：通知・お知らせ・日報・タスクの見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）
//   -tenpoNativePreview phoneOwnerNotifications | phoneOwnerAnnouncements | phoneOwnerAnnouncement（詳細）
//                       phoneOwnerDailyReports | phoneOwnerDailyReport（詳細） | phoneOwnerTasks | phoneOwnerTask（詳細）
// 名前・店舗はすべて作りもの（実在の人・お店ではない）

struct NativePhoneOwnerCommsPreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "phoneOwnerNotifications":
            NPOCNoticesPreview()
        case "phoneOwnerAnnouncements", "phoneOwnerAnnouncement":
            NPOCAnnPreview(detail: kind == "phoneOwnerAnnouncement")
        case "phoneOwnerDailyReports", "phoneOwnerDailyReport":
            NPOCDailyPreview(detail: kind == "phoneOwnerDailyReport")
        default:
            NPOCTasksPreview(detail: kind == "phoneOwnerTask")
        }
    }
}

/// 見本の日時（今からの分・日）
private enum NPOCSample {
    static func iso(minutesAgo: Double) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutesAgo * 60))
    }

    static func day(_ offset: Int) -> String { NPOCFmt.addDays(NPDate.str(Date()), offset) }

    static func route(_ key: String, _ path: String) -> NativeModuleRoute {
        NativeModuleRoute(key: key, url: AppConfig.url(path))
    }

    static let shinjuku = NPOCOption(id: "00000000-0000-4000-8000-00000000a001", name: "TENPO ONE 新宿店")
    static let shibuya = NPOCOption(id: "00000000-0000-4000-8000-00000000a002", name: "TENPO ONE 渋谷店")
}

// MARK: - 通知

extension NPONoticesModel {
    static func sample() -> NPONoticesModel {
        let m = NPONoticesModel(route: NPOCSample.route("notifications", "/app/notifications"))
        let items = [
            NPONotice(id: "n1", type: "task_assigned", typeLabel: "タスク", title: "新しいタスクが割り当てられました",
                      body: "「冷蔵庫の温度チェック表を更新」— 山田 太郎 さんから", link: "/app/tasks", readAt: nil, createdAt: NPOCSample.iso(minutesAgo: 4)),
            NPONotice(id: "n2", type: "daily_report", typeLabel: "日報", title: "日報が提出されました",
                      body: "TENPO ONE 新宿店 の昨日の日報が提出されました。内容を確認して承認してください。", link: "/app/daily-reports", readAt: nil, createdAt: NPOCSample.iso(minutesAgo: 38)),
            NPONotice(id: "n3", type: "leave_request", typeLabel: "休暇申請", title: "休暇申請が届きました",
                      body: "佐藤 花子 さんから来週月曜日の有給休暇の申請があります", link: "/app/leave", readAt: nil, createdAt: NPOCSample.iso(minutesAgo: 60 * 3)),
            NPONotice(id: "n4", type: "announcement", typeLabel: "お知らせ", title: "お知らせ：年末年始の営業時間",
                      body: "12/31〜1/3 の営業時間を掲載しました", link: "/app/announcements", readAt: NPOCSample.iso(minutesAgo: 60 * 20), createdAt: NPOCSample.iso(minutesAgo: 60 * 26)),
            NPONotice(id: "n5", type: "reservation", typeLabel: "予約", title: "本日の予約が12件あります",
                      body: "18:00〜20:00 に8件集中しています", link: nil, readAt: NPOCSample.iso(minutesAgo: 60 * 30), createdAt: NPOCSample.iso(minutesAgo: 60 * 32)),
            NPONotice(id: "n6", type: "task_assigned", typeLabel: "タスク", title: "タスクが完了しました",
                      body: "「製氷機の清掃」— 鈴木 一郎 さん", link: "/app/tasks", readAt: NPOCSample.iso(minutesAgo: 60 * 70), createdAt: NPOCSample.iso(minutesAgo: 60 * 72)),
        ]
        m.payload = NPONoticesPayload(
            stores: [NPOCSample.shinjuku, NPOCSample.shibuya],
            typeOptions: [NPOCKeyLabel(key: "announcement", label: "お知らせ"), NPOCKeyLabel(key: "leave_request", label: "休暇申請"),
                          NPOCKeyLabel(key: "task_assigned", label: "タスク"), NPOCKeyLabel(key: "daily_report", label: "日報"),
                          NPOCKeyLabel(key: "reservation", label: "予約")],
            items: items
        )
        return m
    }
}

private struct NPOCNoticesPreview: View {
    @StateObject private var model = NPONoticesModel.sample()

    var body: some View {
        NativePhoneNotificationsView(model: model, onBack: {}, onLink: { _ in })
    }
}

// MARK: - お知らせ

extension NPOAnnModel {
    static func sample() -> NPOAnnModel {
        let m = NPOAnnModel()
        m.payload = NPOAnnPayload(
            canWrite: true,
            canTargetAllStores: true,
            targetStore: NPOCSample.shinjuku,
            items: [
                NPOAnnItem(id: "a1", title: "年末年始の営業時間について",
                           body: "12/31（水）は 17:00 閉店、1/1（木）〜1/3（土）は休業します。\n予約の受付は 12/30 までです。シフトの希望は今週中に提出してください。",
                           isImportant: true, storeLabel: "全店舗", publishFrom: NPOCSample.day(-2), publishTo: NPOCSample.day(40),
                           createdAt: NPOCSample.iso(minutesAgo: 60 * 50), isRead: false, canDelete: true),
                NPOAnnItem(id: "a2", title: "新メニュー「季節の炊き込みご飯」の提供開始",
                           body: "来週から提供を始めます。仕込みの手順はマニュアルに追加しました。アレルギー表示（小麦・大豆）の確認をお願いします。",
                           isImportant: false, storeLabel: "TENPO ONE 新宿店", publishFrom: nil, publishTo: nil,
                           createdAt: NPOCSample.iso(minutesAgo: 60 * 26), isRead: false, canDelete: true),
                NPOAnnItem(id: "a3", title: "レジ締めの手順が変わりました",
                           body: "現金の数え方を 1 枚ずつから束ごとの入力に変更しました。差異が出たときはコメントに理由を書いてください。",
                           isImportant: false, storeLabel: "全店舗", publishFrom: nil, publishTo: nil,
                           createdAt: NPOCSample.iso(minutesAgo: 60 * 24 * 6), isRead: true, canDelete: true),
                NPOAnnItem(id: "a4", title: "10月の衛生点検の結果",
                           body: "全項目で基準を満たしていました。ご協力ありがとうございました。",
                           isImportant: false, storeLabel: "TENPO ONE 新宿店", publishFrom: NPOCSample.day(-20), publishTo: NPOCSample.day(-5),
                           createdAt: NPOCSample.iso(minutesAgo: 60 * 24 * 20), isRead: true, canDelete: true),
            ]
        )
        return m
    }
}

private struct NPOCAnnPreview: View {
    let detail: Bool
    @StateObject private var model = NPOAnnModel.sample()

    init(detail: Bool) {
        self.detail = detail
    }

    var body: some View {
        NativePhoneAnnouncementsView(model: model, onBack: {}, onLink: { _ in })
            .onAppear { if detail, let a = model.payload?.items.first { model.open(a) } }
    }
}

// MARK: - 日報

extension NPODrModel {
    static func sample() -> NPODrModel {
        let m = NPODrModel(route: NPOCSample.route("dailyReports", "/app/daily-reports"))
        let today = NPOCSample.day(0)
        let yesterday = NPOCSample.day(-1)
        m.payload = NPODrPayload(
            today: today, date: yesterday, from: NPOCSample.day(-30), to: yesterday, store: nil, status: nil,
            canWrite: true, canApprove: true,
            stores: [NPOCSample.shinjuku, NPOCSample.shibuya],
            day: [
                NPODrDayRow(storeId: NPOCSample.shinjuku.id, storeName: NPOCSample.shinjuku.name, closed: true, reportId: "r1", status: "submitted"),
                NPODrDayRow(storeId: NPOCSample.shibuya.id, storeName: NPOCSample.shibuya.name, closed: false, reportId: nil, status: nil),
            ],
            history: [
                NPODrHistory(id: "r1", storeName: NPOCSample.shinjuku.name, businessDate: yesterday, status: "submitted"),
                NPODrHistory(id: "r2", storeName: NPOCSample.shibuya.name, businessDate: NPOCSample.day(-2), status: "approved"),
                NPODrHistory(id: "r3", storeName: NPOCSample.shinjuku.name, businessDate: NPOCSample.day(-2), status: "approved"),
                NPODrHistory(id: "r4", storeName: NPOCSample.shibuya.name, businessDate: NPOCSample.day(-3), status: "draft"),
                NPODrHistory(id: "r5", storeName: NPOCSample.shinjuku.name, businessDate: NPOCSample.day(-3), status: "approved"),
            ]
        )
        m.date = yesterday
        m.from = NPOCSample.day(-30)
        m.to = yesterday
        m.samples = [
            "r1": NPODrReport(
                id: "r1", storeName: NPOCSample.shinjuku.name, businessDate: yesterday, status: "submitted",
                comment: "団体予約（12名）が入り、ドリンクの提供が遅れた時間帯がありました。明日はホール 1 名増やします。",
                submittedAt: NPOCSample.iso(minutesAgo: 60 * 10), approvedAt: nil,
                metrics: NPODrMetrics(legacy: false, grossSales: 486_300, discounts: 12_400, refunds: 0, netSales: 486_300, guests: 87,
                                      avgSpend: 5_590, cashDifference: -200, reservationsCount: 14, cancelCount: 1, wasteAmount: 6_800, laborCost: 98_500)
            ),
        ]
        return m
    }
}

private struct NPOCDailyPreview: View {
    let detail: Bool
    @StateObject private var model = NPODrModel.sample()

    init(detail: Bool) {
        self.detail = detail
    }

    var body: some View {
        NativePhoneDailyReportsView(model: model, onBack: {})
            .onAppear { if detail { model.detailId = "r1" } }
    }
}

// MARK: - タスク

extension NPOTasksModel {
    static func sample() -> NPOTasksModel {
        let m = NPOTasksModel(route: NPOCSample.route("tasks", "/app/tasks"))
        let yamada = NPOCOption(id: "00000000-0000-4000-8000-00000000b001", name: "山田 太郎")
        let sato = NPOCOption(id: "00000000-0000-4000-8000-00000000b002", name: "佐藤 花子")
        let suzuki = NPOCOption(id: "00000000-0000-4000-8000-00000000b003", name: "鈴木 一郎")
        let s = NPOCSample.shinjuku
        m.payload = NPOTasksPayload(
            stores: [s],
            selectedStoreId: s.id,
            status: nil, priority: nil, assignee: nil,
            staff: [sato, suzuki, yamada],
            tasks: [
                NPOTask(id: "t1", storeId: s.id, storeName: s.name, title: "冷蔵庫の温度チェック表を更新", body: "朝・昼・閉店前の 3 回。記入漏れがあれば店長に連絡してください。",
                        status: "in_progress", priority: "high", assigneeId: sato.id, assigneeName: sato.name, dueDate: NPOCSample.day(-1), overdue: true,
                        comments: [
                            NPOTaskComment(by: yamada.id, name: yamada.name, at: NPOCSample.iso(minutesAgo: 60 * 20), body: "新しい記入用紙をバックヤードの棚に置きました"),
                            NPOTaskComment(by: sato.id, name: sato.name, at: NPOCSample.iso(minutesAgo: 45), body: "朝の分は記入済みです。昼の分はランチ後にやります"),
                        ]),
                NPOTask(id: "t2", storeId: s.id, storeName: s.name, title: "週末の団体予約（12名）の席の準備", body: "奥の座敷を使います。前日までに座布団を追加。",
                        status: "open", priority: "normal", assigneeId: suzuki.id, assigneeName: suzuki.name, dueDate: NPOCSample.day(3), overdue: false, comments: []),
                NPOTask(id: "t3", storeId: s.id, storeName: s.name, title: "おしぼりの発注", body: nil,
                        status: "open", priority: "low", assigneeId: nil, assigneeName: nil, dueDate: nil, overdue: false,
                        comments: [NPOTaskComment(by: yamada.id, name: yamada.name, at: NPOCSample.iso(minutesAgo: 60 * 5), body: "在庫はあと 2 日分です")]),
                NPOTask(id: "t4", storeId: s.id, storeName: s.name, title: "新人スタッフのレジ研修", body: "レジ締めまで一通り。",
                        status: "in_progress", priority: "normal", assigneeId: yamada.id, assigneeName: yamada.name, dueDate: NPOCSample.day(7), overdue: false, comments: []),
            ]
        )
        return m
    }
}

private struct NPOCTasksPreview: View {
    let detail: Bool
    @StateObject private var model = NPOTasksModel.sample()

    init(detail: Bool) {
        self.detail = detail
    }

    var body: some View {
        NativePhoneTasksView(model: model, onBack: {})
            .onAppear { if detail { model.detail = model.payload?.tasks.first } }
    }
}
