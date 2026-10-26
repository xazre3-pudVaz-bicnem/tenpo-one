import SwiftUI

// iPhone の店長・オーナー：給与・歩合（ネイティブ）。Web の /app/payroll と同じ中身・同じ操作（2026-10-25 Ronnie「iPhone も native に」）
//   スタッフ：自分の給与明細（一覧・明細書・PDF）・最新の歩合給・総支給の推移・年末調整（申告の下書き・提出）
//   店長・オーナー（payroll.manage）：給与計算（一覧・新規作成＝給与／賞与・詳細・再計算・確定・承認・下書きに戻す・CSV・仕訳へ）
//     ・給与ルール・歩合ルール（追加・編集）・年末調整（提出状況の確認・確認中・確認済み・差し戻し）
// サーバーは iPad と同じ：GET part=payroll（&run=<id> ／ &view=nencho）・POST payroll…・nencho…（lib/native-modules/payroll.ts）
// 給与は端末に残さない（iPad と同じ：読んだらすぐ保存を消す・前の中身を先に出さない）。iPad の画面・型は使わない（iPad を壊さない）
// 詳細：NativePhoneOwnerPayrollRun.swift ／ 年末調整：NativePhoneOwnerNencho.swift ／ ルール・作成のシート：NativePhoneOwnerPayrollForms.swift

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPPYAllowance: Decodable, Hashable {
    let name: String
    let amount: Double
    let per: String
}

struct NPPYRule: Decodable, Hashable, Identifiable {
    let id: String
    let profileId: String
    let profileName: String
    let storeId: String?
    let storeName: String
    let payType: String
    let payTypeLabel: String
    let baseAmount: Double
    let overtimeRate: Double
    let nightRate: Double
    let holidayRate: Double
    let commuteAllowance: Double
    let allowances: [NPPYAllowance]
    let closingDay: Double
    let paymentDay: Double
    let effectiveFrom: String
    let effectiveFromLabel: String
}

struct NPPYTier: Decodable, Hashable {
    let from: Double
    let to: Double?
    let rate: Double
}

struct NPPYCommissionRule: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let targetType: String
    let profileId: String?
    let profileName: String
    let storeId: String?
    let storeName: String
    let method: String
    let methodLabel: String
    let rate: Double?
    let fixedAmount: Double?
    let tiers: [NPPYTier]?
    let basis: String
    let basisLabel: String
    let minAmount: Double?
    let maxAmount: Double?
    let effectiveFrom: String
    let effectiveFromLabel: String
}

struct NPPYRun: Decodable, Hashable, Identifiable {
    let id: String
    let runType: String
    let title: String
    let periodLabel: String
    let storeName: String
    let status: String
    let createdLabel: String
}

/// スタッフの給与明細の一覧の 1 行（確定・承認済みだけ）
struct NPPYSlipRow: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let runType: String
    let periodLabel: String
    let grossTotal: Double?
}

struct NPPYDefaults: Decodable, Hashable {
    let periodStart: String
    let periodEnd: String
    let salaryTitle: String
    let bonusTitle: String
    let today: String
}

struct NPPYListPayload: Decodable {
    let canManage: Bool
    let staff: [NPOCOption]?
    let stores: [NPOCOption]?
    let defaults: NPPYDefaults?
    let rules: [NPPYRule]?
    let commissionRules: [NPPYCommissionRule]?
    let runs: [NPPYRun]?
    let payslips: [NPPYSlipRow]?
}

/// 勤怠と支給の数（明細の 1 人・合計・自分の給与明細で同じ名前）
protocol NPPYPayFigures {
    var workDays: Double { get }
    var workMinutes: Double { get }
    var overtimeMinutes: Double { get }
    var nightMinutes: Double { get }
    var holidayMinutes: Double { get }
    var basePay: Double { get }
    var overtimePay: Double { get }
    var nightPay: Double { get }
    var holidayPay: Double { get }
    var commutePay: Double { get }
    var allowanceTotal: Double { get }
    var commissionTotal: Double { get }
    var grossTotal: Double { get }
}

extension NPPYPayFigures {
    /// 勤務 10日・実働 80:00 …
    var timePairs: [(String, String)] {
        [("勤務", "\(NPPYFmt.count(workDays))日"), ("実働", NPPYFmt.minutes(workMinutes)), ("残業", NPPYFmt.minutes(overtimeMinutes)),
         ("深夜", NPPYFmt.minutes(nightMinutes)), ("休日", NPPYFmt.minutes(holidayMinutes))]
    }

    /// 支給の内訳（Web の給与明細書と同じ名前・同じ並び）
    var payPairs: [(String, Double)] {
        [("基本給", basePay), ("残業手当", overtimePay), ("深夜手当", nightPay), ("休日手当", holidayPay),
         ("交通費", commutePay), ("諸手当", allowanceTotal), ("歩合給", commissionTotal)]
    }
}

struct NPPYLine: Decodable, Hashable {
    let text: String
    let sub: [String]?
    let tail: String?
    let strong: Bool?
}

struct NPPYDay: Decodable, Hashable {
    let date: String
    let inOut: String
    let work: String
    let overtime: String
    let night: String
    let holiday: String
}

struct NPPYItem: Decodable, Hashable, Identifiable, NPPYPayFigures {
    let id: String
    let profileName: String
    let workDays: Double
    let workMinutes: Double
    let overtimeMinutes: Double
    let nightMinutes: Double
    let holidayMinutes: Double
    let basePay: Double
    let overtimePay: Double
    let nightPay: Double
    let holidayPay: Double
    let commutePay: Double
    let allowanceTotal: Double
    let commissionTotal: Double
    let grossTotal: Double
    let lines: [NPPYLine]
    let days: [NPPYDay]
}

struct NPPYTotals: Decodable, Hashable, NPPYPayFigures {
    let workDays: Double
    let workMinutes: Double
    let overtimeMinutes: Double
    let nightMinutes: Double
    let holidayMinutes: Double
    let basePay: Double
    let overtimePay: Double
    let nightPay: Double
    let holidayPay: Double
    let commutePay: Double
    let allowanceTotal: Double
    let commissionTotal: Double
    let grossTotal: Double
}

struct NPPYBonusItem: Decodable, Hashable, Identifiable {
    let id: String
    let profileName: String
    let amount: Double
}

struct NPPYSnapshotRule: Decodable, Hashable {
    let staff: String
    let payType: String
    let base: String
    let overtime: String
    let night: String
    let holiday: String
    let commute: String
    let period: String
}

struct NPPYSnapshotCommission: Decodable, Hashable {
    let name: String
    let target: String
    let method: String
    let value: String
    let period: String
}

/// 承認したときに固定したルール（Web の RulesSnapshotPanel）
struct NPPYSnapshot: Decodable, Hashable {
    let generatedLabel: String?
    let note: String?
    let payrollRules: [NPPYSnapshotRule]
    let commissionRules: [NPPYSnapshotCommission]
}

struct NPPYRunHead: Decodable, Hashable {
    let id: String
    let title: String
    let runType: String
    let status: String
    let description: String
    let note: String?
    let csvName: String?
}

/// 自分の給与明細（スタッフ）
struct NPPYPayslip: Decodable, Hashable, NPPYPayFigures {
    let runTitle: String
    let runType: String
    let periodLabel: String
    let profileName: String
    let organizationName: String?
    let workDays: Double
    let workMinutes: Double
    let overtimeMinutes: Double
    let nightMinutes: Double
    let holidayMinutes: Double
    let basePay: Double
    let overtimePay: Double
    let nightPay: Double
    let holidayPay: Double
    let commutePay: Double
    let allowanceTotal: Double
    let commissionTotal: Double
    let grossTotal: Double
}

struct NPPYRunPayload: Decodable {
    /// self（自分の給与明細）／empty（まだ見られない）／manage（管理者の明細）
    let mode: String
    let title: String?
    let message: String?
    let payslip: NPPYPayslip?
    let run: NPPYRunHead?
    let snapshot: NPPYSnapshot?
    let items: [NPPYItem]?
    let totals: NPPYTotals?
    let bonusItems: [NPPYBonusItem]?
    let bonusTotal: Double?
}

/// POST の返事（「給与計算を確定しました」などの message・作った給与計算の id）
struct NPPYResult: Decodable {
    let ok: Bool
    let error: String?
    let message: String?
    let id: String?
}

// MARK: - 読み込み・操作

enum NPPYApi {
    /// GET part=payroll。給与は端末に残さない（NativeAPI.send が保存した分をすぐ消す）
    static func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        defer { NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url("payroll", query))) }
        return try await NativeModuleAPI.get(T.self, part: "payroll", query: query)
    }

    /// POST（{ type: …, … }）。うまくいかなくても投げずに ok=false とことばを返す
    @MainActor
    static func post(_ body: [String: Any]) async -> NPPYResult {
        do {
            var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            return try JSONDecoder().decode(NPPYResult.self, from: data)
        } catch {
            return NPPYResult(ok: false, error: NativeModuleAPI.message(error), message: nil, id: nil)
        }
    }
}

enum NPPYFmt {
    static func yen(_ v: Double?) -> String {
        guard let v, v.isFinite else { return "—" }
        return NT.yen(Int(v.rounded()))
    }

    /// 600 → 10:00（Web の formatMinutes）
    static func minutes(_ v: Double) -> String {
        guard v.isFinite else { return "0:00" }
        let m = max(0, Int(v.rounded()))
        return "\(m / 60):" + String(format: "%02d", m % 60)
    }

    static func count(_ v: Double) -> String { v.isFinite ? String(Int(v.rounded())) : "0" }

    /// 入力欄に出す数（1200 → "1200"、1.25 → "1.25"、nil → ""）
    static func num(_ v: Double?) -> String {
        guard let v, v.isFinite else { return "" }
        if v == v.rounded() && abs(v) < 1e12 { return String(Int(v)) }
        return String(v)
    }

    /// 入力の文字 → 数（カンマ・全角も）。空は nil
    static func double(_ s: String) -> Double? { NOS.num(s) }

    /// 数字だけ（全角も半角に）
    static func digits(_ s: String) -> String {
        let half = s.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? s
        return half.filter { "0123456789".contains($0) }
    }

    static func fileSafe(_ s: String) -> String { s.replacingOccurrences(of: "[/:\\\\]", with: "_", options: .regularExpression) }

    /// nil は JSON の null に
    static func orNull<T>(_ v: T?) -> Any {
        if let v { return v }
        return NSNull()
    }

    /// 2026-10-01 → 10/1（水）
    static func day(_ s: String) -> String { NOS.isDay(s) ? NOS.mdw(s) : s }

    /// 「2026年9月分」→「9月」（推移の棒の下の字）
    static func shortLabel(_ s: String) -> String {
        if let r = s.range(of: "[0-9]{1,2}月", options: .regularExpression) { return String(s[r]) }
        return String(s.prefix(4))
    }

    static let runStatus: [String: String] = ["draft": "下書き", "confirmed": "確定済み", "approved": "承認済み"]
    static let runType: [String: String] = ["salary": "給与", "bonus": "賞与"]
    static let nenchoStatus: [String: String] = ["new": "未作成", "draft": "下書き", "submitted": "提出済み", "reviewing": "確認中", "needs_fix": "要修正", "confirmed": "確認済み"]

    static func runStatusColor(_ s: String) -> Color {
        switch s {
        case "approved": return NT.ok
        case "confirmed": return NT.warn
        default: return NT.ink3
        }
    }

    static func runTypeColor(_ t: String) -> Color { t == "bonus" ? NT.ink2 : NT.purple }

    static func nenchoColor(_ s: String) -> Color {
        switch s {
        case "submitted", "reviewing": return NT.warn
        case "needs_fix": return NT.danger
        case "confirmed": return NT.ok
        default: return NT.ink3
        }
    }

    /// 歩合ルールの値（一覧の右）
    static func commissionValue(_ r: NPPYCommissionRule) -> String {
        if r.targetType == "store_target" { return yen(r.fixedAmount) }
        switch r.method {
        case "rate": return r.rate.map { "\(num($0))%" } ?? "—"
        case "fixed": return yen(r.fixedAmount)
        default: return "段階別"
        }
    }

    /// 歩合の試算（Web の lib/payroll.ts calcCommission と同じ計算）
    static func commission(method: String, rate: Double?, fixed: Double?, tiers: [NPPYTier], lo: Double?, hi: Double?, sales: Double) -> Double {
        var r: Double = 0
        switch method {
        case "fixed":
            r = fixed ?? 0
        case "rate":
            r = floor(sales * (rate ?? 0) / 100)
        case "tiered":
            for t in tiers {
                let upper = t.to ?? Double.infinity
                if sales <= t.from { continue }
                let band = Swift.min(sales, upper) - t.from
                r += floor(band * t.rate / 100)
            }
        default:
            break
        }
        if let lo { r = Swift.max(r, lo) }
        if let hi { r = Swift.min(r, hi) }
        return r
    }
}

// MARK: - 入口（Web の道 → 画面）

enum NPPYScreen: Hashable {
    case list
    case run(String)
    case nencho

    /// /app/payroll（?tab=）・/app/payroll/<runId>・/app/payroll/nencho（?year=&status=）
    static func from(_ route: NativeModuleRoute) -> NPPYScreen {
        let base = "/app/payroll/"
        let path = route.url.path
        guard path.hasPrefix(base) else { return .list }
        let first = path.dropFirst(base.count).split(separator: "/").first.map(String.init) ?? ""
        if first == "nencho" { return .nencho }
        if NOS.isUuid(first) { return .run(first) }
        return .list
    }
}

/// AppState につなぐ（一覧を下に、詳細・年末調整を右から重ねる）
struct NativePhonePayrollScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var list = NPPYListModel()
    @State private var screen: NPPYScreen
    @State private var tab: String
    private let nenchoYear: Int?
    private let nenchoStatus: String?

    init(route: NativeModuleRoute) {
        _screen = State(initialValue: NPPYScreen.from(route))
        // iPhone は給与計算（確定・承認）を先に。?tab=rules のときだけルール
        _tab = State(initialValue: route.query("tab") == "rules" ? "rules" : "runs")
        nenchoYear = route.query("year").flatMap { Int($0) }
        nenchoStatus = route.query("status")
    }

    var body: some View {
        ZStack {
            NPPYListView(model: list, tab: $tab, onBack: { state.closePhoneOwnerModule() }, open: { screen = $0 })
            switch screen {
            case .list:
                EmptyView()
            case .run(let id):
                NPPYRunScreen(runId: id, onBack: { back() }, onWeb: { NPWNav.openWeb(state, $0) })
                    .id(id)
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            case .nencho:
                NPPYNenchoScreen(year: nenchoYear, status: nenchoStatus, onBack: { back() })
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.22), value: screen)
        .modifier(NPOCWebFallback(key: "payroll", useWeb: list.useWeb, state: state))
    }

    /// 詳細から一覧へ（確定・承認したかもしれないので読み直す）
    private func back() {
        screen = .list
        list.reload()
    }
}

// MARK: - 一覧（/app/payroll）

@MainActor
final class NPPYListModel: ObservableObject {
    @Published var payload: NPPYListPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var useWeb = false
    /// スタッフ：いちばん新しい給与（賞与でない）の明細の中身。歩合給・実働を一覧の上に出す
    @Published var latest: NPPYPayslip?
    private var generation = 0

    func load() async {
        if NativePreview.current != nil { return }
        generation += 1
        let mine = generation
        do {
            let p = try await NPPYApi.get(NPPYListPayload.self, [:])
            guard mine == generation else { return }
            payload = p
            error = nil
            if !p.canManage { await loadLatest(p) }
        } catch {
            guard mine == generation else { return }
            // 最初から読めない（権限・機能・ログイン・回線）ときは Web の画面（ほかの店長・オーナーの画面と同じ）
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    func reload() { Task { await load() } }

    private func loadLatest(_ p: NPPYListPayload) async {
        guard let first = (p.payslips ?? []).first(where: { $0.runType != "bonus" }) else {
            latest = nil
            return
        }
        if let r = try? await NPPYApi.get(NPPYRunPayload.self, ["run": first.id]), r.mode == "self" { latest = r.payslip }
    }
}

struct NPPYRuleRef: Identifiable {
    let id = UUID()
    let rule: NPPYRule?
}

struct NPPYCommissionRef: Identifiable {
    let id = UUID()
    let rule: NPPYCommissionRule?
}

struct NPPYListView: View {
    @ObservedObject var model: NPPYListModel
    @Binding var tab: String
    let onBack: () -> Void
    let open: (NPPYScreen) -> Void
    @State private var ruleEdit: NPPYRuleRef?
    @State private var commissionEdit: NPPYCommissionRef?
    @State private var creating = false
    @State private var runFilter = ""

    private var p: NPPYListPayload? { model.payload }
    private var isManager: Bool { model.payload?.canManage == true }

    var body: some View {
        NPOFrame(title: p?.canManage == false ? "給与明細" : "給与・歩合", subtitle: "Payroll", onBack: onBack, trailing: {
            barButtons
        }) {
            NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load() }) {
                if let p = model.payload {
                    if p.canManage { manager(p) } else { staff(p) }
                }
            }
        }
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .sheet(item: $ruleEdit) { e in
            NPPYRuleSheet(
                rule: e.rule, staff: p?.staff ?? [], stores: p?.stores ?? [], today: p?.defaults?.today ?? NPDate.str(Date()),
                onSaved: { msg in
                    ruleEdit = nil
                    model.toast = msg
                    model.reload()
                },
                onClose: { ruleEdit = nil }
            )
        }
        .sheet(item: $commissionEdit) { e in
            NPPYCommissionSheet(
                rule: e.rule, staff: p?.staff ?? [], stores: p?.stores ?? [], today: p?.defaults?.today ?? NPDate.str(Date()),
                onSaved: { msg in
                    commissionEdit = nil
                    model.toast = msg
                    model.reload()
                },
                onClose: { commissionEdit = nil }
            )
        }
        .sheet(isPresented: $creating) {
            NPPYRunCreateSheet(
                defaults: p?.defaults, staff: p?.staff ?? [], stores: p?.stores ?? [],
                onCreated: { id in
                    creating = false
                    model.reload()
                    open(.run(id))
                },
                onClose: { creating = false }
            )
        }
    }

    @ViewBuilder private var barButtons: some View {
        if isManager && tab == "runs" {
            NPOCBarButton(icon: "plus", label: "作成") { creating = true }
        } else if isManager {
            Menu {
                Button { ruleEdit = NPPYRuleRef(rule: nil) } label: { Label("給与ルールを追加", systemImage: "yensign.circle") }
                Button { commissionEdit = NPPYCommissionRef(rule: nil) } label: { Label("歩合ルールを追加", systemImage: "percent") }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 15, weight: .bold))
                    Text("追加").font(.system(size: 13, weight: .bold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 11).frame(minHeight: 40)
                .background(Capsule().fill(Color.white.opacity(0.14)))
            }
        }
    }

    // MARK: 店長・オーナー

    @ViewBuilder private func manager(_ p: NPPYListPayload) -> some View {
        NOSSegment(items: [(key: "runs", label: "給与計算"), (key: "rules", label: "給与・歩合ルール")], selection: tab) { tab = $0 }
        if tab == "runs" {
            runsSection(p.runs ?? [])
        } else {
            rulesSection(p)
        }
        nenchoLink
        NPPYDisclaimer()
    }

    @ViewBuilder private func runsSection(_ runs: [NPPYRun]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                NPOCChip(text: "すべて（\(runs.count)）", selected: runFilter.isEmpty) { runFilter = "" }
                ForEach(["draft", "confirmed", "approved"], id: \.self) { s in
                    NPOCChip(text: chipText(runs, s), selected: runFilter == s) { runFilter = s }
                }
            }
            .padding(.horizontal, 1)
        }
        let list = runFilter.isEmpty ? runs : runs.filter { $0.status == runFilter }
        if list.isEmpty {
            NPOCEmpty(icon: "yensign.circle", title: runs.isEmpty ? "給与計算はまだ作成されていません" : "該当する給与計算はありません",
                      note: runs.isEmpty ? "右上の「作成」から期間を指定して作成してください" : "")
        } else {
            ForEach(list) { r in runRow(r) }
        }
    }

    /// 「下書き（2）」
    private func chipText(_ runs: [NPPYRun], _ status: String) -> String {
        let n = runs.filter { $0.status == status }.count
        return "\(NPPYFmt.runStatus[status] ?? status)（\(n)）"
    }

    private func runRow(_ r: NPPYRun) -> some View {
        Button { open(.run(r.id)) } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    NWKBadge(text: NPPYFmt.runType[r.runType] ?? r.runType, color: NPPYFmt.runTypeColor(r.runType))
                    NWKBadge(text: NPPYFmt.runStatus[r.status] ?? r.status, color: NPPYFmt.runStatusColor(r.status))
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                }
                Text(r.title).font(.system(size: 16.5, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                Text(r.periodLabel).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink2).lineLimit(1)
                HStack(spacing: 12) {
                    meta("storefront", "対象 \(r.storeName)")
                    meta("clock", "作成 \(r.createdLabel)")
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard())
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    @ViewBuilder private func rulesSection(_ p: NPPYListPayload) -> some View {
        let rules = p.rules ?? []
        let commissions = p.commissionRules ?? []
        sectionHeader("給与ルール（\(rules.count)件）") { ruleEdit = NPPYRuleRef(rule: nil) }
        if rules.isEmpty {
            NPOCEmpty(icon: "person.text.rectangle", title: "給与ルールが登録されていません", note: "スタッフごとの時給・月給・割増・手当を登録します")
        } else {
            VStack(spacing: 0) {
                ForEach(Array(rules.enumerated()), id: \.element.id) { i, r in
                    if i > 0 { divider }
                    Button { ruleEdit = NPPYRuleRef(rule: r) } label: { ruleRow(r) }
                        .buttonStyle(.plain)
                }
            }
            .background(npocCard())
        }
        sectionHeader("歩合ルール（\(commissions.count)件）") { commissionEdit = NPPYCommissionRef(rule: nil) }
        if commissions.isEmpty {
            NPOCEmpty(icon: "percent", title: "歩合ルールが登録されていません", note: "個人売上の歩合・店舗目標達成の支給を登録します")
        } else {
            VStack(spacing: 0) {
                ForEach(Array(commissions.enumerated()), id: \.element.id) { i, r in
                    if i > 0 { divider }
                    Button { commissionEdit = NPPYCommissionRef(rule: r) } label: { commissionRow(r) }
                        .buttonStyle(.plain)
                }
            }
            .background(npocCard())
        }
    }

    private func sectionHeader(_ title: String, add: @escaping () -> Void) -> some View {
        HStack(alignment: .bottom) {
            NPOCSectionTitle(title: title)
            Spacer(minLength: 8)
            Button(action: add) {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 12, weight: NT.strong))
                    Text("追加").font(.system(size: 13.5, weight: .bold))
                }
                .foregroundColor(NT.purpleDeep)
                .padding(.horizontal, 13).frame(height: 36)
                .background(Capsule().fill(NT.lilac))
            }
            .buttonStyle(PressableStyle())
        }
    }

    private var divider: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14) }

    private func ruleRow(_ r: NPPYRule) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(r.profileName).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Text("\(r.storeName)・\(r.payTypeLabel)・適用 \(r.effectiveFromLabel)〜").font(.system(size: 12)).foregroundColor(NT.ink3)
                    .lineLimit(2).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 6)
            Text(NPPYFmt.yen(r.baseAmount)).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private func commissionRow(_ r: NPPYCommissionRule) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(r.name).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                Text("\(r.profileName)・\(r.storeName)・\(r.targetType == "store_target" ? "店舗目標達成" : "\(r.methodLabel)・\(r.basisLabel)")")
                    .font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(2).multilineTextAlignment(.leading)
                Text("適用 \(r.effectiveFromLabel)〜").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            }
            Spacer(minLength: 6)
            Text(NPPYFmt.commissionValue(r)).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    // MARK: スタッフ（自分の給与明細）

    @ViewBuilder private func staff(_ p: NPPYListPayload) -> some View {
        let rows = p.payslips ?? []
        if let first = rows.first { latestCard(first) }
        nenchoLink
        if rows.filter({ $0.runType != "bonus" }).count >= 2 { trendCard(rows) }
        NPOCSectionTitle(title: "給与明細（\(rows.count)件）", note: "確定した給与・賞与の明細です。押すと明細書を開きます")
        if rows.isEmpty {
            NPOCEmpty(icon: "doc.text", title: "表示できる給与明細はまだありません", note: "給与計算が確定すると表示されます")
        } else {
            ForEach(rows) { r in slipRow(r) }
        }
        NPPYDisclaimer()
    }

    private func latestCard(_ r: NPPYSlipRow) -> some View {
        Button { open(.run(r.id)) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text("最新の明細").font(.system(size: 12, weight: .bold)).foregroundColor(.white.opacity(0.75))
                    Text(NPPYFmt.runType[r.runType] ?? r.runType).font(.system(size: 11, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(Color.white.opacity(0.18)))
                    Spacer(minLength: 4)
                    Text("明細を見る").font(.system(size: 12.5, weight: .bold)).foregroundColor(.white.opacity(0.9))
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(.white.opacity(0.9))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).font(.system(size: 18, weight: NT.strong)).foregroundColor(.white).lineLimit(1)
                    Text(r.periodLabel).font(.system(size: 12)).foregroundColor(.white.opacity(0.7)).lineLimit(1)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(r.runType == "bonus" ? "賞与支給額" : "総支給").font(.system(size: 12, weight: .bold)).foregroundColor(.white.opacity(0.75))
                    Text(NPPYFmt.yen(r.grossTotal)).font(.system(size: 32, weight: NT.strong)).foregroundColor(.white).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.6)
                }
                if let l = model.latest {
                    Rectangle().fill(Color.white.opacity(0.16)).frame(height: 1)
                    HStack(spacing: 0) {
                        heroStat("歩合給", NPPYFmt.yen(l.commissionTotal))
                        heroStat("実働", NPPYFmt.minutes(l.workMinutes))
                        heroStat("出勤", "\(NPPYFmt.count(l.workDays))日")
                    }
                    if l.runTitle != r.title {
                        Text("（\(l.runTitle) の明細から）").font(.system(size: 11)).foregroundColor(.white.opacity(0.6))
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LinearGradient(colors: [NT.topBar, NT.purpleDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    private func heroStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(.white.opacity(0.65))
            Text(value).font(.system(size: 16, weight: NT.strong)).foregroundColor(.white).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func trendCard(_ rows: [NPPYSlipRow]) -> some View {
        let salary: [NPPYSlipRow] = Array(rows.filter { $0.runType != "bonus" }.prefix(12).reversed())
        let bars: [NOSBar] = salary.map { NOSBar(label: NPPYFmt.shortLabel($0.title), value: $0.grossTotal ?? 0, detail: $0.title) }
        return NPOCard(title: "総支給の推移", trailing: "給与のみ・\(salary.count)回") {
            NOSBars(bars: bars, height: 120, summary: "棒を押すとその月の総支給")
        }
    }

    private func slipRow(_ r: NPPYSlipRow) -> some View {
        Button { open(.run(r.id)) } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        NWKBadge(text: NPPYFmt.runType[r.runType] ?? r.runType, color: NPPYFmt.runTypeColor(r.runType))
                        Text(r.title).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                    }
                    Text(r.periodLabel).font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 6)
                Text(NPPYFmt.yen(r.grossTotal)).font(.system(size: 17, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard())
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    // MARK: 共通

    private var nenchoLink: some View {
        Button { open(.nencho) } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.text.fill").font(.system(size: 18, weight: .bold)).foregroundColor(NT.purple)
                    .frame(width: 42, height: 42)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                VStack(alignment: .leading, spacing: 2) {
                    Text("年末調整").font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
                    Text(isManager ? "自分の申告・提出状況の確認" : "扶養家族・保険料の申告（下書き・提出）")
                        .font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard())
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    private func meta(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(text).font(.system(size: 12, weight: .semibold)).lineLimit(1)
        }
        .foregroundColor(NT.ink3)
    }
}

// MARK: - 小さい部品

/// 給与画面の注意（Web の PayrollDisclaimer と同じ文言）
struct NPPYDisclaimer: View {
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 12, weight: .bold)).padding(.top, 1)
            Text("本機能は概算の試算です。税金・社会保険料・年末調整は含まれません。正式な給与計算は社会保険労務士・税理士へご確認ください。")
                .font(.system(size: 12, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundColor(NT.warn)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.warn.opacity(0.09)))
    }
}

/// 「勤務 10日」「実働 80:00」のような小さい札を折り返して並べる
struct NPPYChips: View {
    let pairs: [(String, String)]

    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(Array(pairs.enumerated()), id: \.offset) { _, p in
                HStack(spacing: 4) {
                    Text(p.0).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink3)
                    Text(p.1).font(.system(size: 13.5, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                }
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.page))
            }
        }
    }
}
