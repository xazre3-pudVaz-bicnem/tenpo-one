import SwiftUI

// iPhone の店長・オーナー：日報（ネイティブ）。Web の /app/daily-reports と同じ中身・同じ操作（2026-10-25 Ronnie「iPhone も native に」）
//   対象日（‹ › で前後の日）→ 店舗ごとの日報（レジ締め済みか・状態）・「日報を生成」「再生成」（承認済みは不可）・詳細
//   詳細：数字（総売上・値引・返金・純売上・客数・客単価・現金差異・予約数・キャンセル数・廃棄額・人件費概算）・コメント・提出・承認
//   過去の日報（期間・店舗・状態で絞り込み）→ 詳細
// サーバーは iPad と同じ：GET part=dailyReports・dailyReport ／ POST dailyReportGenerate・dailyReportSubmit・dailyReportApprove
// （lib/native-modules/daily-reports.ts）。生成・提出は店長まで、承認は本社寄り（Web と同じ。サーバーでももう一度見る）

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPODrDayRow: Decodable, Identifiable, Hashable {
    let storeId: String
    let storeName: String
    let closed: Bool
    let reportId: String?
    let status: String?
    var id: String { storeId }
}

struct NPODrHistory: Decodable, Identifiable, Hashable {
    let id: String
    let storeName: String
    let businessDate: String
    let status: String
}

struct NPODrPayload: Decodable {
    let today: String
    let date: String
    let from: String
    let to: String
    let store: String?
    let status: String?
    let canWrite: Bool
    let canApprove: Bool
    let stores: [NPOCOption]
    let day: [NPODrDayRow]
    let history: [NPODrHistory]
}

/// 日報の数字（v0.4.2 より前の日報は legacy＝値引・返金・純売上が「—」）
struct NPODrMetrics: Decodable, Hashable {
    let legacy: Bool
    let grossSales: Double?
    let discounts: Double?
    let refunds: Double?
    let netSales: Double?
    let guests: Double?
    let avgSpend: Double?
    /// nil＝未締め
    let cashDifference: Double?
    let reservationsCount: Double?
    let cancelCount: Double?
    let wasteAmount: Double?
    let laborCost: Double?
}

struct NPODrReport: Decodable, Hashable {
    let id: String
    let storeName: String
    let businessDate: String
    let status: String
    let comment: String?
    let submittedAt: String?
    let approvedAt: String?
    let metrics: NPODrMetrics
}

struct NPODrReportPayload: Decodable {
    let report: NPODrReport
}

/// 状態の名前・色・数字の並び（Web の STATUS_LABEL・STATUS_TONE・ReportDetailDialog と同じ）
enum NPODrText {
    static let statuses: [(String, String)] = [("draft", "下書き"), ("submitted", "提出済み"), ("approved", "承認済み")]

    static func label(_ s: String) -> String { statuses.first { $0.0 == s }?.1 ?? s }

    static func color(_ s: String) -> Color {
        switch s {
        case "submitted": return NT.warn
        case "approved": return NT.ok
        default: return NT.ink3
        }
    }

    static func count(_ v: Double?, _ unit: String) -> String {
        guard let v else { return "—" }
        return "\(Int(v.rounded()))\(unit)"
    }

    static func metricRows(_ m: NPODrMetrics) -> [(String, String)] {
        [
            ("値引", m.legacy ? "—" : NWKFmt.yen(m.discounts)),
            ("返金", m.legacy ? "—" : NWKFmt.yen(m.refunds)),
            ("純売上", m.legacy ? "—" : NWKFmt.yen(m.netSales)),
            ("客単価", NWKFmt.yen(m.avgSpend)),
            ("現金差異", m.cashDifference == nil ? "未締め" : NWKFmt.yen(m.cashDifference)),
            ("予約数", count(m.reservationsCount, "件")),
            ("キャンセル数", count(m.cancelCount, "件")),
            ("廃棄額", NWKFmt.yen(m.wasteAmount)),
            ("人件費概算", NWKFmt.yen(m.laborCost)),
        ]
    }

    static func metricNote(_ m: NPODrMetrics) -> String {
        var s = "客単価は純売上（総売上−返金）÷客数で算出しています。"
        if m.legacy { s += "\nこの日報はv0.4.2の項目追加より前に生成されたため、値引・返金・純売上は「—」表示です（未計上ではありません）。" }
        return s
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPODrModel: ObservableObject {
    @Published var payload: NPODrPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    /// 日報を生成している店舗
    @Published var generating: String?
    /// 開いている日報
    @Published var detailId: String?
    /// 見本（-tenpoNativePreview）の詳細
    var samples: [String: NPODrReport] = [:]

    // 対象日・過去の日報の絞り込み（サーバーが決めた値＝既定の前日・30日を読み込みのたびに入れ直す）
    @Published var date: String
    @Published var from: String
    @Published var to: String
    @Published var store: String
    @Published var status: String

    private var generation = 0

    init(route: NativeModuleRoute) {
        date = route.query("date") ?? ""
        from = route.query("from") ?? ""
        to = route.query("to") ?? ""
        store = route.query("store") ?? ""
        status = route.query("status") ?? ""
        payload = NativeModuleAPI.cached(NPODrPayload.self, part: "dailyReports", query: query())
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
        if NativePreview.current != nil { return }
        generation += 1
        let mine = generation
        do {
            let p = try await NativeModuleAPI.get(NPODrPayload.self, part: "dailyReports", query: query())
            guard mine == generation else { return }
            payload = p
            date = p.date
            from = p.from
            to = p.to
            store = p.store ?? ""
            status = p.status ?? ""
            error = nil
        } catch {
            guard mine == generation else { return }
            // 最初から読めない（権限・ログイン・回線）ときは Web の画面（オーナーのホームと同じ）
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    func reload() { Task { await load() } }

    /// 前の日・次の日（今日より後へは行かない）
    func shiftDay(_ delta: Int) {
        guard let p = payload else { return }
        let next = NPOCFmt.addDays(date.isEmpty ? p.date : date, delta)
        guard next <= p.today else { return }
        date = next
        reload()
    }

    /// 当日集計をスナップショットして日報を作る（ある日報は下書きに作り直す）
    func generate(_ row: NPODrDayRow) async {
        guard generating == nil, let day = payload?.date else { return }
        if NativePreview.current != nil { toast = "日報を生成しました"; return }
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

    /// 日報の詳細（担当店舗のみ。サーバーが確かめる）
    func report(_ id: String) async throws -> NPODrReport {
        if NativePreview.current != nil, let r = samples[id] { return r }
        let p = try await NativeModuleAPI.get(NPODrReportPayload.self, part: "dailyReport", query: ["id": id])
        return p.report
    }
}

// MARK: - 画面（AppState につなぐ）

struct NativePhoneDailyReportsScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model: NPODrModel

    init(route: NativeModuleRoute) {
        _model = StateObject(wrappedValue: NPODrModel(route: route))
    }

    var body: some View {
        NativePhoneDailyReportsView(model: model, onBack: { state.closePhoneOwnerModule() })
            .modifier(NPOCWebFallback(key: "dailyReports", useWeb: model.useWeb, state: state))
    }
}

struct NativePhoneDailyReportsView: View {
    @ObservedObject var model: NPODrModel
    let onBack: () -> Void
    /// 提出済みの日報を作り直す前に確かめる（下書きに戻るため）
    @State private var confirmRegenerate: NPODrDayRow?

    var body: some View {
        ZStack {
            NPOFrame(title: "日報", subtitle: "Daily reports", onBack: onBack, trailing: { EmptyView() }) {
                NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load() }) {
                    if let p = model.payload {
                        dayPicker(p)
                        daySection(p)
                        historySection(p)
                    }
                }
            }
            if let id = model.detailId {
                NPODrDetailView(model: model, reportId: id)
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.22), value: model.detailId)
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .confirmationDialog("日報を作り直す", isPresented: Binding(get: { confirmRegenerate != nil }, set: { if !$0 { confirmRegenerate = nil } }), titleVisibility: .visible) {
            Button("再生成する") {
                if let r = confirmRegenerate { Task { await model.generate(r) } }
            }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("提出済みの日報を当日集計で作り直します。状態は「下書き」に戻ります。")
        }
    }

    // MARK: 対象日

    private func dayPicker(_ p: NPODrPayload) -> some View {
        // 選んだ日はすぐ出す（読み直しが終わるまで前の日に戻って見えないように）
        let current = model.date.isEmpty ? p.date : model.date
        return HStack(spacing: 8) {
            dayStep(-1, enabled: true)
            Spacer(minLength: 4)
            VStack(spacing: 2) {
                Text("対象日").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                DatePicker(
                    "対象日",
                    selection: Binding(get: { NPDate.date(current) }, set: { d in
                        model.date = NPDate.str(d)
                        model.reload()
                    }),
                    in: ...NPDate.date(p.today),
                    displayedComponents: .date
                )
                .labelsHidden()
            }
            Spacer(minLength: 4)
            dayStep(1, enabled: current < p.today)
        }
        .padding(10)
        .background(npocCard())
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func dayStep(_ delta: Int, enabled: Bool) -> some View {
        Button { model.shiftDay(delta) } label: {
            Image(systemName: delta < 0 ? "chevron.left" : "chevron.right")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(enabled ? NT.purple : NT.ink3.opacity(0.5))
                .frame(width: 44, height: 44)
                .background(Circle().fill(NT.lilac.opacity(enabled ? 1 : 0.4)))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }

    // MARK: 対象日の日報（店舗ごと）

    @ViewBuilder private func daySection(_ p: NPODrPayload) -> some View {
        NPOCSectionTitle(title: "\(NPOCFmt.dayWeek(p.date)) の日報", note: "店舗ごとの当日集計をスナップショットし、店長の提出・本社の承認を管理します")
        if p.day.isEmpty {
            NPOCEmpty(icon: "building.2", title: "アクセス可能な店舗がありません")
        } else {
            ForEach(p.day) { row in dayRow(row, canWrite: p.canWrite) }
        }
    }

    private func dayRow(_ row: NPODrDayRow, canWrite: Bool) -> some View {
        let generatingThis = model.generating == row.storeId
        let canGenerate = canWrite && row.status != "approved"
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.storeName).font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                    HStack(spacing: 5) {
                        Image(systemName: row.closed ? "checkmark.circle.fill" : "circle.dashed").font(.system(size: 12, weight: .bold))
                        Text(row.closed ? "レジ締め済み" : "レジ締め未実施（当日集計のみで生成できます）")
                    }
                    .font(.system(size: 12.5)).foregroundColor(row.closed ? NT.ok : NT.ink3)
                }
                Spacer(minLength: 6)
                if let s = row.status { NWKBadge(text: NPODrText.label(s), color: NPODrText.color(s)) } else { NWKBadge(text: "未作成", color: NT.ink3) }
            }
            if row.reportId != nil || canGenerate {
                HStack(spacing: 10) {
                    if let id = row.reportId {
                        NPOCWideButton(text: "詳細", icon: "doc.text.magnifyingglass", kind: .secondary, height: 46) { model.detailId = id }
                    }
                    if canGenerate {
                        NPOCWideButton(
                            text: generatingThis ? "生成中…" : (row.reportId == nil ? "日報を生成" : "再生成"),
                            icon: "arrow.triangle.2.circlepath",
                            kind: row.reportId == nil && row.closed ? .primary : .secondary,
                            busy: generatingThis,
                            disabled: model.generating != nil && !generatingThis,
                            height: 46
                        ) {
                            if row.status == "submitted" { confirmRegenerate = row } else { Task { await model.generate(row) } }
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(npocCard())
    }

    // MARK: 過去の日報

    @ViewBuilder private func historySection(_ p: NPODrPayload) -> some View {
        NPOCSectionTitle(title: "過去の日報").padding(.top, 8)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("期間").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                DatePicker("期間（開始）", selection: Binding(get: { NPDate.date(model.from) }, set: { d in
                    model.from = NPDate.str(d)
                    model.reload()
                }), displayedComponents: .date).labelsHidden()
                Text("〜").foregroundColor(NT.ink3)
                DatePicker("期間（終了）", selection: Binding(get: { NPDate.date(model.to) }, set: { d in
                    model.to = NPDate.str(d)
                    model.reload()
                }), displayedComponents: .date).labelsHidden()
                Spacer(minLength: 0)
            }
            .environment(\.locale, Locale(identifier: "ja_JP"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if p.stores.count > 1 {
                        NPOCMenuChip(label: "店舗", options: [("", "すべて")] + p.stores.map { ($0.id, $0.name) }, selection: model.store) { v in
                            model.store = v
                            model.reload()
                        }
                    }
                    NPOCMenuChip(label: "状態", options: [("", "すべて")] + NPODrText.statuses, selection: model.status) { v in
                        model.status = v
                        model.reload()
                    }
                }
                .padding(.horizontal, 1)
            }
        }
        .padding(12)
        .background(npocCard())
        if p.history.isEmpty {
            NPOCEmpty(icon: "doc.text", title: "該当する日報がありません")
        } else {
            VStack(spacing: 0) {
                ForEach(p.history) { h in
                    if h.id != p.history.first?.id { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14) }
                    historyRow(h)
                }
            }
            .background(npocCard())
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func historyRow(_ h: NPODrHistory) -> some View {
        Button { model.detailId = h.id } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(NPOCFmt.fullDayWeek(h.businessDate)).font(.system(size: 15, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                    Text(h.storeName).font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 8)
                NWKBadge(text: NPODrText.label(h.status), color: NPODrText.color(h.status))
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.99))
    }
}

// MARK: - 日報の詳細（Web の ReportDetailDialog）

struct NPODrDetailView: View {
    @ObservedObject var model: NPODrModel
    let reportId: String

    @State private var report: NPODrReport?
    @State private var loadError: String?
    @State private var comment = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NPOCDetailFrame(
            title: "日報詳細",
            subtitle: report.map { "\($0.storeName)・\(NWKFmt.slash($0.businessDate))" } ?? "",
            backLabel: "日報",
            onBack: { model.detailId = nil },
            trailing: { EmptyView() }
        ) {
            NPOCBody(loaded: report != nil, error: loadError, retry: { await load() }) {
                if let r = report { detail(r) }
            }
        }
        .task(id: reportId) { await load() }
    }

    @MainActor private func load() async {
        loadError = nil
        do {
            let r = try await model.report(reportId)
            report = r
            comment = r.comment ?? ""
        } catch {
            loadError = NativeModuleAPI.message(error)
        }
    }

    @ViewBuilder private func detail(_ r: NPODrReport) -> some View {
        let canSubmit = model.payload?.canWrite ?? false
        let canApprove = model.payload?.canApprove ?? false
        let editable = r.status == "draft" && canSubmit
        // 見出し：店舗・日付・状態・提出／承認の時刻
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(r.storeName).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink)
                    Text(NPOCFmt.fullDayWeek(r.businessDate)).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2)
                }
                Spacer(minLength: 6)
                NWKBadge(text: NPODrText.label(r.status), color: NPODrText.color(r.status))
            }
            if let s = r.submittedAt { Text("提出: \(NPOCFmt.dateTime(s))").font(.system(size: 12.5)).foregroundColor(NT.ink3) }
            if let a = r.approvedAt { Text("承認: \(NPOCFmt.dateTime(a))").font(.system(size: 12.5)).foregroundColor(NT.ink3) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
        hero(r.metrics)
        metricsGrid(r.metrics)
        Text(NPODrText.metricNote(r.metrics)).font(.system(size: 12)).foregroundColor(NT.ink3)
            .fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
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
                Text(c).font(.system(size: 15)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(npocCard(12))
            }
        }
        if let error {
            Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
        }
        if editable {
            NPOCWideButton(text: busy ? "送信中…" : "提出する", icon: "paperplane", kind: .primary, busy: busy, height: 52) {
                Task { await submit(r) }
            }
        }
        if r.status == "submitted" && canApprove {
            NPOCWideButton(text: busy ? "処理中…" : "承認する", icon: "checkmark.seal", kind: .success, busy: busy, height: 52) {
                Task { await approve(r) }
            }
        }
    }

    /// 大きい数字：総売上・客数（ひと目で）
    private func hero(_ m: NPODrMetrics) -> some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("総売上").font(.system(size: 12, weight: .semibold)).foregroundColor(.white.opacity(0.75))
                Text(NWKFmt.yen(m.grossSales)).font(.system(size: 28, weight: .heavy)).monospacedDigit().foregroundColor(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text("客数").font(.system(size: 12, weight: .semibold)).foregroundColor(.white.opacity(0.75))
                Text(NPODrText.count(m.guests, "名")).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(.white)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.topBar))
    }

    private func metricsGrid(_ m: NPODrMetrics) -> some View {
        let rows = NPODrText.metricRows(m)
        let columns = [GridItem(.flexible(), spacing: 10, alignment: .leading), GridItem(.flexible(), spacing: 10, alignment: .leading)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.0).font(.system(size: 12)).foregroundColor(NT.ink3)
                    Text(row.1).font(.system(size: 17, weight: .bold)).monospacedDigit()
                        .foregroundColor(row.0 == "現金差異" && (m.cashDifference ?? 0) < 0 ? NT.danger : NT.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .background(npocCard())
    }

    /// コメントを付けて提出（下書き→提出済み）
    @MainActor private func submit(_ r: NPODrReport) async {
        if NativePreview.current != nil { model.toast = "日報を提出しました"; model.detailId = nil; return }
        busy = true
        error = nil
        do {
            try await NativeModuleAPI.post(["type": "dailyReportSubmit", "id": r.id, "comment": comment])
            busy = false
            model.toast = "日報を提出しました"
            model.detailId = nil
            await model.load()
        } catch {
            busy = false
            self.error = NativeModuleAPI.message(error)
        }
    }

    /// 本社の承認（提出済み→承認済み）
    @MainActor private func approve(_ r: NPODrReport) async {
        if NativePreview.current != nil { model.toast = "日報を承認しました"; model.detailId = nil; return }
        busy = true
        error = nil
        do {
            try await NativeModuleAPI.post(["type": "dailyReportApprove", "id": r.id])
            busy = false
            model.toast = "日報を承認しました"
            model.detailId = nil
            await model.load()
        } catch {
            busy = false
            self.error = NativeModuleAPI.message(error)
        }
    }
}
