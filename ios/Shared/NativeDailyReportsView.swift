import SwiftUI

// 日報のネイティブ。Web の /app/daily-reports と同じ中身・同じ操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   対象日を選ぶ → 店舗ごとの日報（レジ締め済みか・状態）・「日報を生成」「再生成」（承認済みは不可）・詳細
//   詳細：数字（総売上・値引・返金・純売上・客数・客単価・現金差異・予約数・キャンセル数・廃棄額・人件費概算）・コメント・提出・承認
//   過去の日報を検索（期間・店舗・状態）→ 詳細
// サーバーは lib/native-modules/daily-reports.ts（読み込みは Web と同じ lib/daily-reports-server.ts、操作は Web と同じ Server Action）。
// 生成・提出は店長まで、承認は本社寄り（Web と同じ。サーバーでももう一度見る）。

// MARK: - 中身（サーバーの返事）

struct NDRStore: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

/// 対象日の店舗ごとの行
struct NDRDayRow: Decodable, Hashable, Identifiable {
    let storeId: String
    let storeName: String
    let closed: Bool
    let reportId: String?
    let status: String?
    var id: String { storeId }
}

struct NDRHistoryRow: Decodable, Hashable, Identifiable {
    let id: String
    let storeId: String
    let storeName: String
    let businessDate: String
    let status: String
}

struct NDRPayload: Decodable {
    let ok: Bool
    let today: String
    let date: String
    let from: String
    let to: String
    let store: String?
    let status: String?
    let canWrite: Bool
    let canApprove: Bool
    let stores: [NDRStore]
    let day: [NDRDayRow]
    let history: [NDRHistoryRow]
}

/// 日報の数字（v0.4.2 より前の日報は legacy＝値引・返金・純売上が「—」）
struct NDRMetrics: Decodable, Hashable {
    let legacy: Bool
    let grossSales: Double?
    let discounts: Double?
    let refunds: Double?
    let netSales: Double?
    let guests: Double?
    let avgSpend: Double?
    /// nil＝未締め
    let cashDifference: Double?
    let closingExists: Bool
    let reservationsCount: Double?
    let cancelCount: Double?
    let wasteAmount: Double?
    let laborCost: Double?
}

struct NDRReport: Decodable, Hashable {
    let id: String
    let storeId: String
    let storeName: String
    let businessDate: String
    let status: String
    let comment: String?
    let submittedAt: String?
    let approvedAt: String?
    let metrics: NDRMetrics
}

struct NDRReportPayload: Decodable {
    let ok: Bool
    let report: NDRReport
}

struct NDRDetailRef: Identifiable, Hashable {
    let id: String
}

/// 状態の名前・色（Web の STATUS_LABEL・STATUS_TONE と同じ）
enum NDRText {
    static let statuses: [(String, String)] = [("draft", "下書き"), ("submitted", "提出済み"), ("approved", "承認済み")]

    static func label(_ s: String) -> String { statuses.first { $0.0 == s }?.1 ?? s }

    static func color(_ s: String) -> Color {
        switch s {
        case "submitted": return NT.warn
        case "approved": return NT.ok
        default: return NT.ink3
        }
    }

    /// 1 件・1 名（数が無ければ —）
    static func count(_ v: Double?, _ unit: String) -> String {
        guard let v else { return "—" }
        return "\(Int(v.rounded()))\(unit)"
    }

    /// 詳細の数字の並び（Web の ReportDetailDialog と同じ順・同じ出し方）
    static func metricRows(_ m: NDRMetrics) -> [(String, String)] {
        [
            ("総売上", NWKFmt.yen(m.grossSales)),
            ("値引", m.legacy ? "—" : NWKFmt.yen(m.discounts)),
            ("返金", m.legacy ? "—" : NWKFmt.yen(m.refunds)),
            ("純売上", m.legacy ? "—" : NWKFmt.yen(m.netSales)),
            ("客数", count(m.guests, "名")),
            ("客単価", NWKFmt.yen(m.avgSpend)),
            ("現金差異", m.cashDifference == nil ? "未締め" : NWKFmt.yen(m.cashDifference)),
            ("予約数", count(m.reservationsCount, "件")),
            ("キャンセル数", count(m.cancelCount, "件")),
            ("廃棄額", NWKFmt.yen(m.wasteAmount)),
            ("人件費概算", NWKFmt.yen(m.laborCost)),
        ]
    }

    static func metricNote(_ m: NDRMetrics) -> String {
        var s = "客単価は純売上（総売上−返金）÷客数で算出しています。"
        if m.legacy { s += "\nこの日報はv0.4.2の項目追加より前に生成されたため、値引・返金・純売上は「—」表示です（未計上ではありません）。" }
        return s
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NDRModel: ObservableObject {
    @Published var payload: NDRPayload?
    @Published var error: String?
    @Published var toast: String?
    /// 日報を生成している店舗
    @Published var generating: String?

    // 対象日・過去の日報の検索（Web の 2 つのフォームと同じ。サーバーが決めた値＝既定の前日・30日を読み込みのたびに入れ直す）
    @Published var date: String
    @Published var from: String
    @Published var to: String
    @Published var store: String
    @Published var status: String

    init(route: NativeModuleRoute) {
        date = route.query("date") ?? ""
        from = route.query("from") ?? ""
        to = route.query("to") ?? ""
        store = route.query("store") ?? ""
        status = route.query("status") ?? ""
        payload = NativeModuleAPI.cached(NDRPayload.self, part: "dailyReports", query: query())
    }

    func query() -> [String: String] {
        var q: [String: String] = [:]
        if !date.isEmpty { q["date"] = date }
        if !from.isEmpty { q["from"] = from }
        if !to.isEmpty { q["to"] = to }
        if !store.isEmpty { q["store"] = store }
        if !status.isEmpty { q["status"] = status }
        return q
    }

    func load() async {
        do {
            let p = try await NativeModuleAPI.get(NDRPayload.self, part: "dailyReports", query: query())
            payload = p
            date = p.date
            from = p.from
            to = p.to
            store = p.store ?? ""
            status = p.status ?? ""
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    /// 当日集計をスナップショットして日報を作る（ある日報は下書きに作り直す）
    func generate(_ row: NDRDayRow) async {
        guard generating == nil, let day = payload?.date else { return }
        generating = row.storeId
        do {
            try await NativeModuleAPI.post(["type": "dailyReportGenerate", "storeId": row.storeId, "date": day])
            toast = "日報を生成しました"
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
        generating = nil
    }
}

// MARK: - 画面

struct NativeDailyReportsView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    @StateObject private var model: NDRModel
    @State private var detail: NDRDetailRef?

    init(route: NativeModuleRoute, onHome: @escaping () -> Void) {
        self.route = route
        self.onHome = onHome
        _model = StateObject(wrappedValue: NDRModel(route: route))
    }

    var body: some View {
        NWKPage(title: "日報", onHome: onHome, loaded: model.payload != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload {
                dayCard(p)
                historyCard(p)
            }
        }
        .task { await model.load() }
        .sheet(item: $detail) { d in
            NDRDetailSheet(reportId: d.id, canSubmit: model.payload?.canWrite ?? false, canApprove: model.payload?.canApprove ?? false) { message in
                detail = nil
                if let message {
                    model.toast = message
                    Task { await model.load() }
                }
            }
        }
    }

    // MARK: 対象日の日報（店舗ごと）

    private func dayCard(_ p: NDRPayload) -> some View {
        NWKCard(title: "\(NWKFmt.slash(p.date)) の日報", note: "店舗ごとの当日集計をスナップショットし、店長の提出・本社の承認を管理します", trailing: {
            NWKDateField(label: "対象日", value: p.date, max: p.today) { d in
                model.date = d
                Task { await model.load() }
            }
        }) {
            if p.day.isEmpty {
                NWKEmpty(title: "アクセス可能な店舗がありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(p.day) { row in
                        if row.id != p.day.first?.id { NWKDivider() }
                        dayRow(row, canWrite: p.canWrite)
                    }
                }
            }
        }
    }

    private func dayRow(_ row: NDRDayRow, canWrite: Bool) -> some View {
        let generatingThis = model.generating == row.storeId
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(row.storeName).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                Text(row.closed ? "レジ締め済み" : "レジ締め未実施（当日集計のみで生成できます）")
                    .font(.system(size: 12.5)).foregroundColor(row.closed ? NT.ok : NT.ink3)
            }
            Spacer(minLength: 8)
            if let s = row.status { NWKBadge(text: NDRText.label(s), color: NDRText.color(s)) }
            if let id = row.reportId {
                NWKButton(text: "詳細", icon: "eye") { detail = NDRDetailRef(id: id) }
            }
            if canWrite && row.status != "approved" {
                NWKButton(
                    text: generatingThis ? "生成中…" : (row.reportId == nil ? "日報を生成" : "再生成"),
                    icon: "arrow.triangle.2.circlepath",
                    kind: row.closed ? .primary : .secondary,
                    busy: generatingThis,
                    disabled: model.generating != nil && !generatingThis
                ) {
                    Task { await model.generate(row) }
                }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
    }

    // MARK: 過去の日報を検索

    private func historyCard(_ p: NDRPayload) -> some View {
        NWKCard(title: "過去の日報を検索") {
            VStack(alignment: .leading, spacing: 0) {
                WrapLayout(spacing: 10) {
                    NWKDateField(label: "期間（開始）", value: model.from) { model.from = $0 }
                    NWKDateField(label: "期間（終了）", value: model.to) { model.to = $0 }
                    if p.stores.count > 1 {
                        NWKMenu(label: "店舗", options: [("", "すべて")] + p.stores.map { ($0.id, $0.name) }, selection: model.store) { model.store = $0 }
                    }
                    NWKMenu(label: "状態", options: [("", "すべて")] + NDRText.statuses, selection: model.status) { model.status = $0 }
                    NWKButton(text: "検索する", icon: "magnifyingglass", kind: .primary) { Task { await model.load() } }
                }
                .padding(18)
                Rectangle().fill(NT.line).frame(height: 1)
                if p.history.isEmpty {
                    NWKEmpty(title: "該当する日報がありません")
                } else {
                    historyHeader
                    ForEach(p.history) { h in
                        historyRow(h)
                        if h.id != p.history.last?.id { NWKDivider() }
                    }
                }
            }
        }
    }

    private var historyHeader: some View {
        HStack(spacing: 12) {
            Text("日付").frame(width: 112, alignment: .leading)
            Text("店舗")
            Spacer(minLength: 8)
            Text("状態")
        }
        .font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
        .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 4)
    }

    private func historyRow(_ h: NDRHistoryRow) -> some View {
        Button { detail = NDRDetailRef(id: h.id) } label: {
            HStack(spacing: 12) {
                Text(NWKFmt.slash(h.businessDate)).font(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundColor(NT.ink)
                    .frame(width: 112, alignment: .leading)
                Text(h.storeName).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Spacer(minLength: 8)
                NWKBadge(text: NDRText.label(h.status), color: NDRText.color(h.status))
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.99))
    }
}

// MARK: - 日報の詳細（Web の ReportDetailDialog）

struct NDRDetailSheet: View {
    let reportId: String
    let canSubmit: Bool
    let canApprove: Bool
    /// 閉じる。提出・承認したらそのことば（一覧で toast にして読み直す）
    let onDone: (String?) -> Void

    @State private var report: NDRReport?
    @State private var loadError: String?
    @State private var comment = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let r = report {
                    detail(r)
                } else if let e = loadError {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                        Button("もう一度") { Task { await load() } }
                    }
                    .padding(30)
                } else {
                    ProgressView("読み込み中…").tint(NT.purple)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(NT.page.ignoresSafeArea())
            .navigationTitle("日報詳細")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる") { onDone(nil) }.disabled(busy) }
            }
        }
        .interactiveDismissDisabled(busy)
        .task { await load() }
    }

    @MainActor private func load() async {
        loadError = nil
        do {
            let p = try await NativeModuleAPI.get(NDRReportPayload.self, part: "dailyReport", query: ["id": reportId])
            report = p.report
            comment = p.report.comment ?? ""
        } catch {
            loadError = NativeModuleAPI.message(error)
        }
    }

    private func detail(_ r: NDRReport) -> some View {
        let editable = r.status == "draft" && canSubmit
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(r.storeName)　\(NWKFmt.slash(r.businessDate))").font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink)
                        if let s = r.submittedAt { Text("提出: \(NWKFmt.dateTime(s))").font(.system(size: 12.5)).foregroundColor(NT.ink3) }
                        if let a = r.approvedAt { Text("承認: \(NWKFmt.dateTime(a))").font(.system(size: 12.5)).foregroundColor(NT.ink3) }
                    }
                    Spacer(minLength: 8)
                    NWKBadge(text: NDRText.label(r.status), color: NDRText.color(r.status))
                }
                metrics(r.metrics)
                Text(NDRText.metricNote(r.metrics)).font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                if editable {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("コメント").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        TextField("申し送り事項・特記事項を入力", text: $comment, axis: .vertical)
                            .lineLimit(4...10)
                            .font(.system(size: 16))
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                    }
                } else if let c = r.comment, !c.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("コメント").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
                        Text(c).font(.system(size: 15)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    }
                }
                if let error {
                    Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 10) {
                    Spacer()
                    if editable {
                        NWKButton(text: busy ? "送信中…" : "提出する", icon: "paperplane", kind: .primary, busy: busy, height: 48) {
                            Task { await submit(r) }
                        }
                    }
                    if r.status == "submitted" && canApprove {
                        NWKButton(text: busy ? "処理中…" : "承認する", icon: "checkmark.seal", kind: .success, busy: busy, height: 48) {
                            Task { await approve(r) }
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func metrics(_ m: NDRMetrics) -> some View {
        let rows = NDRText.metricRows(m)
        let columns = Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .leading), count: 4)
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.0).font(.system(size: 12)).foregroundColor(NT.ink3)
                    Text(row.1).font(.system(size: 16, weight: .bold)).monospacedDigit().foregroundColor(NT.ink).lineLimit(1).minimumScaleFactor(0.7)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    /// コメントを付けて提出（下書き→提出済み）
    @MainActor private func submit(_ r: NDRReport) async {
        busy = true
        error = nil
        do {
            try await NativeModuleAPI.post(["type": "dailyReportSubmit", "id": r.id, "comment": comment])
            busy = false
            onDone("日報を提出しました")
        } catch {
            busy = false
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 本社の承認（提出済み→承認済み）
    @MainActor private func approve(_ r: NDRReport) async {
        busy = true
        error = nil
        do {
            try await NativeModuleAPI.post(["type": "dailyReportApprove", "id": r.id])
            busy = false
            onDone("日報を承認しました")
        } catch {
            busy = false
            self.error = NativeModuleAPI.message(error)
        }
    }
}
