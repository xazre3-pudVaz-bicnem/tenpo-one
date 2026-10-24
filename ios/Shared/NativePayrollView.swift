import SwiftUI

// 給与・歩合のネイティブ。Web と同じ中身・操作（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   /app/payroll           … 管理者：給与ルール・歩合ルール（追加・編集）／給与計算（一覧・新規作成＝給与・賞与）。スタッフ：自分の給与明細
//   /app/payroll/<runId>   … 管理者：明細（計算根拠・日別勤怠）・再計算・確定・下書きに戻す・承認・CSV・仕訳。スタッフ：給与明細（PDF）
//   /app/payroll/nencho    … 年末調整（自分の申告の下書き・提出／確認する人は提出状況・確認中・確認済み・差し戻し）
// サーバーは lib/native-modules/payroll.ts（読み込みは Web と同じ lib/payroll-server.ts、操作は Web と同じ Server Action）。
// 給与は iPad に残さない（レジの iPad は何人も使う）：読んだらすぐ保存を消す・前の中身を先に出さない。

// MARK: - 中身（サーバーの返事）

struct NPROption: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NPRAllowance: Decodable, Hashable {
    let name: String
    let amount: Double
    let per: String
}

struct NPRRule: Decodable, Hashable, Identifiable {
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
    let allowances: [NPRAllowance]
    let closingDay: Double
    let paymentDay: Double
    let effectiveFrom: String
    let effectiveFromLabel: String
}

struct NPRTier: Decodable, Hashable {
    let from: Double
    let to: Double?
    let rate: Double
}

struct NPRCommissionRule: Decodable, Hashable, Identifiable {
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
    let tiers: [NPRTier]?
    let basis: String
    let basisLabel: String
    let minAmount: Double?
    let maxAmount: Double?
    let effectiveFrom: String
    let effectiveFromLabel: String
}

struct NPRRun: Decodable, Hashable, Identifiable {
    let id: String
    let runType: String
    let title: String
    let periodLabel: String
    let storeName: String
    let status: String
    let createdLabel: String
}

struct NPRPayslipRow: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let runType: String
    let periodLabel: String
    let grossTotal: Double?
}

struct NPRDefaults: Decodable, Hashable {
    let periodStart: String
    let periodEnd: String
    let salaryTitle: String
    let bonusTitle: String
    let today: String
}

struct NPRListPayload: Decodable {
    let ok: Bool
    let canManage: Bool
    let staff: [NPROption]?
    let stores: [NPROption]?
    let defaults: NPRDefaults?
    let rules: [NPRRule]?
    let commissionRules: [NPRCommissionRule]?
    let runs: [NPRRun]?
    let payslips: [NPRPayslipRow]?
}

struct NPRLine: Decodable, Hashable {
    let text: String
    let sub: [String]?
    let tail: String?
    let strong: Bool?
}

struct NPRDay: Decodable, Hashable {
    let date: String
    let inOut: String
    let work: String
    let overtime: String
    let night: String
    let holiday: String
}

struct NPRItem: Decodable, Hashable, Identifiable {
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
    let lines: [NPRLine]
    let days: [NPRDay]
}

struct NPRTotals: Decodable, Hashable {
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

struct NPRBonusItem: Decodable, Hashable, Identifiable {
    let id: String
    let profileName: String
    let amount: Double
}

struct NPRSnapshotRule: Decodable, Hashable, Identifiable {
    let id: String
    let staff: String
    let payType: String
    let base: String
    let overtime: String
    let night: String
    let holiday: String
    let commute: String
    let period: String
}

struct NPRSnapshotCommission: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let target: String
    let method: String
    let value: String
    let period: String
}

struct NPRSnapshot: Decodable, Hashable {
    let generatedLabel: String?
    let note: String?
    let payrollRules: [NPRSnapshotRule]
    let commissionRules: [NPRSnapshotCommission]
}

struct NPRRunHead: Decodable, Hashable {
    let id: String
    let title: String
    let runType: String
    let status: String
    let description: String
    let note: String?
    let csvName: String?
}

struct NPRPayslip: Decodable, Hashable {
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

struct NPRRunPayload: Decodable {
    let ok: Bool
    /// self（自分の給与明細）／empty（まだ見られない）／manage（管理者の明細）
    let mode: String
    let title: String?
    let message: String?
    let payslip: NPRPayslip?
    let run: NPRRunHead?
    let snapshot: NPRSnapshot?
    let items: [NPRItem]?
    let totals: NPRTotals?
    let bonusItems: [NPRBonusItem]?
    let bonusTotal: Double?
}

struct NPRDependentDTO: Decodable, Hashable {
    let name: String
    let relation: String
    let birthDate: String
}

struct NPRNenchoDataDTO: Decodable, Hashable {
    let dependents: [NPRDependentDTO]
    let hasSpouse: Bool
    let spouseIncome: Double?
    let lifeInsurancePremium: Double
    let earthquakeInsurancePremium: Double
    let hasHousingLoanDeduction: Bool
    let hasPreviousEmploymentIncome: Bool
    let basicDeductionNote: String
}

struct NPROwnNencho: Decodable {
    let status: String
    let data: NPRNenchoDataDTO
    let reviewNote: String?
}

struct NPRAdminLine: Decodable, Hashable {
    let text: String
    let tone: String?
}

struct NPRNenchoRow: Decodable, Hashable, Identifiable {
    let id: String
    let profileName: String
    let year: Int
    let status: String
    let submittedLabel: String
    let dependents: [String]
    let lines: [NPRAdminLine]
}

struct NPRNenchoPayload: Decodable {
    let ok: Bool
    let year: Int
    let yearOptions: [Int]
    let status: String
    let canReview: Bool
    let canManage: Bool
    let own: NPROwnNencho
    let adminRows: [NPRNenchoRow]
}

struct NPRResult: Decodable {
    let ok: Bool
    let error: String?
    let message: String?
    let id: String?
}

// MARK: - 読み込み・操作

enum NPRApi {
    /// GET part=payroll。給与は iPad に残さない（NativeAPI.send が保存した分をすぐ消す。前の中身も先に出さない）
    static func get<T: Decodable>(_ type: T.Type, _ query: [String: String]) async throws -> T {
        defer { NativeDiskCache.remove(NativeAPI.cacheKey(NativeModuleAPI.url("payroll", query))) }
        return try await NativeModuleAPI.get(T.self, part: "payroll", query: query)
    }

    /// POST（{ type: …, … }）。返事の message（「給与計算を確定しました」など）も返す
    @MainActor
    static func post(_ body: [String: Any]) async -> NPRResult {
        do {
            var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            return try JSONDecoder().decode(NPRResult.self, from: data)
        } catch {
            return NPRResult(ok: false, error: NativeModuleAPI.message(error), message: nil, id: nil)
        }
    }
}

enum NPRFmt {
    static func yen(_ v: Double?) -> String {
        guard let v else { return "—" }
        return NT.yen(Int(v.rounded()))
    }

    /// 600 → 10:00（Web の formatMinutes）
    static func minutes(_ v: Double) -> String {
        let m = max(0, Int(v.rounded()))
        return "\(m / 60):" + String(format: "%02d", m % 60)
    }

    /// 入力欄に出す数（1200 → "1200"、1.25 → "1.25"、nil → ""）
    static func num(_ v: Double?) -> String {
        guard let v else { return "" }
        if v == v.rounded() && abs(v) < 1e12 { return String(Int(v)) }
        return String(v)
    }

    static func double(_ s: String) -> Double? { Double(s.trimmingCharacters(in: .whitespaces)) }

    static func digits(_ s: String) -> String { s.filter { "0123456789".contains($0) } }

    static func fileSafe(_ s: String) -> String { s.replacingOccurrences(of: "[/:\\\\]", with: "_", options: .regularExpression) }

    /// nil は JSON の null に（型をそのまま受けるので、Optional が Any に包まれて送れなくなることがない）
    static func orNull<T>(_ v: T?) -> Any {
        if let v { return v }
        return NSNull()
    }

    static func date(_ s: Binding<String>) -> Binding<Date> {
        Binding(get: { NPDate.date(s.wrappedValue) }, set: { s.wrappedValue = NPDate.str($0) })
    }

    static let runStatus = ["draft": "下書き", "confirmed": "確定済み", "approved": "承認済み"]
    static let runType = ["salary": "給与", "bonus": "賞与"]
    static let nenchoStatus = ["new": "未作成", "draft": "下書き", "submitted": "提出済み", "reviewing": "確認中", "needs_fix": "要修正", "confirmed": "確認済み"]

    static func runStatusColor(_ s: String) -> Color {
        switch s {
        case "approved": return NT.ok
        case "confirmed": return NT.warn
        default: return NT.ink3
        }
    }

    static func runTypeColor(_ t: String) -> Color { t == "bonus" ? NT.ink : NT.purple }

    static func nenchoColor(_ s: String) -> Color {
        switch s {
        case "submitted", "reviewing": return NT.warn
        case "needs_fix": return NT.danger
        case "confirmed": return NT.ok
        default: return NT.ink3
        }
    }

    /// 歩合の試算（Web の lib/payroll.ts calcCommission と同じ計算）
    static func commission(method: String, rate: Double?, fixed: Double?, tiers: [NPRTier], lo: Double?, hi: Double?, sales: Double) -> Double {
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

enum NPRTab: String {
    case rules
    case runs
}

enum NPRScreen: Hashable {
    case list(NPRTab)
    case run(String)
    case nencho(Int?, String?)

    /// /app/payroll（?tab=runs）・/app/payroll/<runId>・/app/payroll/nencho（?year=&status=）
    static func from(_ route: NativeModuleRoute) -> NPRScreen {
        let first = route.rest.split(separator: "/").first.map(String.init) ?? ""
        if first == "nencho" { return .nencho(route.query("year").flatMap { Int($0) }, route.query("status")) }
        if !first.isEmpty { return .run(first) }
        return .list(route.query("tab") == "runs" ? .runs : .rules)
    }
}

struct NativePayrollView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    /// ほかの画面（仕訳など）へ。ネイティブがあればネイティブで開く
    let onWeb: (String) -> Void
    @State private var screen: NPRScreen

    init(route: NativeModuleRoute, onHome: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.route = route
        self.onHome = onHome
        self.onWeb = onWeb
        _screen = State(initialValue: NPRScreen.from(route))
    }

    var body: some View {
        content
            .id(screen)
            .onChange(of: route) { r in screen = NPRScreen.from(r) }
    }

    @ViewBuilder private var content: some View {
        switch screen {
        case .list(let tab):
            NPRListScreen(initialTab: tab, onHome: onHome, open: { screen = $0 })
        case .run(let id):
            NPRRunScreen(runId: id, onBack: { screen = .list(.runs) }, onWeb: onWeb)
        case .nencho(let year, let status):
            NPRNenchoScreen(year: year, status: status, onBack: { screen = .list(.rules) })
        }
    }
}

// MARK: - 共通の部品

/// 画面の枠：上のバー（画面と同じ地・ホーム／戻る）・読み込み中／エラー・toast
struct NPRPage<Content: View>: View {
    let title: String
    var backIcon: String = "house.fill"
    let onBack: () -> Void
    let loaded: Bool
    let error: String?
    @Binding var toast: String?
    let retry: () async -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: title, subtitle: "", onHome: onBack, backIcon: backIcon)
            if loaded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) { content() }
                        .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 32)
                        .frame(maxWidth: 1100, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
                .refreshable { await retry() }
            } else {
                Spacer()
                if let error {
                    VStack(spacing: 10) {
                        Text(error).font(.system(size: 15, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                        Button("もう一度") { Task { await retry() } }
                    }
                    .padding(.horizontal, 40)
                } else {
                    ProgressView("読み込み中…").tint(NT.purple)
                }
                Spacer()
            }
        }
        .background(NT.page.ignoresSafeArea())
        .overlay(alignment: .bottom) { toastView }
    }

    @ViewBuilder private var toastView: some View {
        if let t = toast {
            Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white).multilineTextAlignment(.center)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(NT.ink.opacity(0.92)))
                .padding(.horizontal, 40).padding(.bottom, 24)
                .onTapGesture { toast = nil }
                .task {
                    try? await Task.sleep(nanoseconds: 2_800_000_000)
                    if toast == t { toast = nil }
                }
        }
    }
}

/// 白いカード（見出し＋右のボタン＋中身）
struct NPRCard<Trailing: View, Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let trailing: () -> Trailing
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                    if let note { Text(note).font(.system(size: 12.5)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 8)
                trailing()
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            Rectangle().fill(NT.line).frame(height: 1)
            content()
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

struct NPRButton: View {
    enum Kind { case primary, secondary, danger }
    let text: String
    var icon: String? = nil
    var kind: Kind = .secondary
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().scaleEffect(0.8).tint(kind == .secondary ? NT.purple : Color.white)
                } else if let icon {
                    Image(systemName: icon)
                }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(kind == .secondary ? NT.ink : Color.white)
            .padding(.horizontal, 16).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(background))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(kind == .secondary ? NT.line : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }

    private var background: Color {
        switch kind {
        case .primary: return NT.purple
        case .danger: return NT.danger
        case .secondary: return Color.white
        }
    }
}

/// 給与画面の注意（Web の PayrollDisclaimer）
struct NPRDisclaimer: View {
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text("本機能は概算の試算です。税金・社会保険料・年末調整は含まれません。正式な給与計算は社会保険労務士・税理士へご確認ください。")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 13, weight: .medium)).foregroundColor(NT.warn)
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.saffronSoft))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.warn.opacity(0.3), lineWidth: 1))
    }
}

struct NPREmpty: View {
    let title: String
    var message: String? = nil
    var body: some View {
        VStack(spacing: 6) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
            if let message { Text(message).font(.system(size: 13)).foregroundColor(NT.ink3).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 16)
    }
}

private struct NPRDivider: View {
    var body: some View { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 18) }
}

/// 「勤務 10日」「基本給 ¥12,000」のような小さい札を折り返して並べる
private struct NPRChips: View {
    let pairs: [(String, String)]
    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(Array(pairs.enumerated()), id: \.offset) { _, p in
                HStack(spacing: 4) {
                    Text(p.0).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                    Text(p.1).font(.system(size: 14, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.page))
            }
        }
    }
}

/// 表の 1 行（幅を決めて並べる）
private struct NPRTableRow: View {
    let cells: [(String, CGFloat, Bool)]
    var header = false
    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                Text(c.0)
                    .font(.system(size: header ? 11.5 : 13, weight: header ? Font.Weight.semibold : Font.Weight.regular))
                    .foregroundColor(header ? NT.ink3 : NT.ink)
                    .monospacedDigit()
                    .lineLimit(1)
                    .frame(width: c.1, alignment: c.2 ? .trailing : .leading)
            }
        }
        .padding(.vertical, header ? 4 : 6)
    }
}

// MARK: - 一覧（/app/payroll）

@MainActor
final class NPRListModel: ObservableObject {
    @Published var payload: NPRListPayload?
    @Published var error: String?
    @Published var toast: String?

    func load() async {
        do {
            payload = try await NPRApi.get(NPRListPayload.self, [:])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }
}

struct NPREditRule: Identifiable {
    let id = UUID()
    let rule: NPRRule?
}

struct NPREditCommission: Identifiable {
    let id = UUID()
    let rule: NPRCommissionRule?
}

struct NPRListScreen: View {
    let initialTab: NPRTab
    let onHome: () -> Void
    let open: (NPRScreen) -> Void
    @StateObject private var model = NPRListModel()
    @State private var tab: NPRTab
    @State private var ruleEdit: NPREditRule?
    @State private var commissionEdit: NPREditCommission?
    @State private var creating = false

    init(initialTab: NPRTab, onHome: @escaping () -> Void, open: @escaping (NPRScreen) -> Void) {
        self.initialTab = initialTab
        self.onHome = onHome
        self.open = open
        _tab = State(initialValue: initialTab)
    }

    private var p: NPRListPayload? { model.payload }

    var body: some View {
        NPRPage(title: p?.canManage == false ? "給与明細" : "給与・歩合", onBack: onHome, loaded: p != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p {
                if p.canManage { managerBody(p) } else { staffBody(p) }
            }
        }
        .task { await model.load() }
        .sheet(item: $ruleEdit) { e in
            NPRRuleSheet(
                rule: e.rule, staff: p?.staff ?? [], stores: p?.stores ?? [], today: p?.defaults?.today ?? NPDate.str(Date()),
                onSaved: { msg in ruleEdit = nil; model.toast = msg; Task { await model.load() } },
                onClose: { ruleEdit = nil }
            )
        }
        .sheet(item: $commissionEdit) { e in
            NPRCommissionSheet(
                rule: e.rule, staff: p?.staff ?? [], stores: p?.stores ?? [], today: p?.defaults?.today ?? NPDate.str(Date()),
                onSaved: { msg in commissionEdit = nil; model.toast = msg; Task { await model.load() } },
                onClose: { commissionEdit = nil }
            )
        }
        .sheet(isPresented: $creating) {
            if let p, let d = p.defaults {
                NPRRunCreateSheet(
                    defaults: d, staff: p.staff ?? [], stores: p.stores ?? [],
                    onCreated: { id in creating = false; open(.run(id)) },
                    onClose: { creating = false }
                )
            }
        }
    }

    // MARK: 管理者

    @ViewBuilder private func managerBody(_ p: NPRListPayload) -> some View {
        HStack(spacing: 12) {
            tabs
            Spacer(minLength: 8)
            NPRButton(text: "年末調整", icon: "doc.text") { open(.nencho(nil, nil)) }
            if tab == .runs { NPRButton(text: "新規作成", icon: "plus", kind: .primary) { creating = true } }
        }
        NPRDisclaimer()
        if tab == .rules {
            rulesCard(p.rules ?? [])
            commissionCard(p.commissionRules ?? [])
        } else {
            runsCard(p.runs ?? [])
        }
    }

    private var tabs: some View {
        HStack(spacing: 0) {
            ForEach([NPRTab.rules, NPRTab.runs], id: \.self) { t in
                Button { tab = t } label: {
                    Text(t == .rules ? "給与ルール" : "給与計算").font(.system(size: 15, weight: .bold))
                        .foregroundColor(tab == t ? Color.white : NT.ink2)
                        .padding(.horizontal, 18).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(tab == t ? NT.purple : Color.clear))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func rulesCard(_ rules: [NPRRule]) -> some View {
        NPRCard(title: "給与ルール", trailing: {
            NPRButton(text: "追加", icon: "plus", kind: .primary) { ruleEdit = NPREditRule(rule: nil) }
        }) {
            if rules.isEmpty {
                NPREmpty(title: "給与ルールが登録されていません")
            } else {
                VStack(spacing: 0) {
                    ForEach(rules) { r in
                        if r.id != rules.first?.id { NPRDivider() }
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(r.profileName).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                                Text("\(r.storeName) ・ \(r.payTypeLabel) ・ 適用 \(r.effectiveFromLabel)〜").font(.system(size: 13)).foregroundColor(NT.ink3)
                            }
                            Spacer(minLength: 8)
                            Text(NPRFmt.yen(r.baseAmount)).font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                            NPRButton(text: "編集") { ruleEdit = NPREditRule(rule: r) }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 12)
                    }
                }
            }
        }
    }

    private func commissionCard(_ rules: [NPRCommissionRule]) -> some View {
        NPRCard(title: "歩合ルール", trailing: {
            NPRButton(text: "追加", icon: "plus", kind: .primary) { commissionEdit = NPREditCommission(rule: nil) }
        }) {
            if rules.isEmpty {
                NPREmpty(title: "歩合ルールが登録されていません")
            } else {
                VStack(spacing: 0) {
                    ForEach(rules) { r in
                        if r.id != rules.first?.id { NPRDivider() }
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(r.name).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                                Text("\(r.profileName) ・ \(r.storeName) ・ \(r.methodLabel) ・ \(r.basisLabel) ・ 適用 \(r.effectiveFromLabel)〜")
                                    .font(.system(size: 13)).foregroundColor(NT.ink3)
                            }
                            Spacer(minLength: 8)
                            NPRButton(text: "編集") { commissionEdit = NPREditCommission(rule: r) }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 12)
                    }
                }
            }
        }
    }

    private func runsCard(_ runs: [NPRRun]) -> some View {
        NPRCard(title: "給与計算", trailing: { EmptyView() }) {
            if runs.isEmpty {
                NPREmpty(title: "給与計算はまだ作成されていません", message: "「新規作成」から期間を指定して作成してください")
            } else {
                VStack(spacing: 0) {
                    ForEach(runs) { r in
                        if r.id != runs.first?.id { NPRDivider() }
                        Button { open(.run(r.id)) } label: { runRow(r) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func runRow(_ r: NPRRun) -> some View {
        HStack(spacing: 12) {
            NPBadge(text: NPRFmt.runType[r.runType] ?? r.runType, color: NPRFmt.runTypeColor(r.runType))
            VStack(alignment: .leading, spacing: 3) {
                Text(r.title).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                Text("\(r.periodLabel) ・ 対象 \(r.storeName) ・ 作成 \(r.createdLabel)").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            Spacer(minLength: 8)
            NPBadge(text: NPRFmt.runStatus[r.status] ?? r.status, color: NPRFmt.runStatusColor(r.status))
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    // MARK: スタッフ（自分の給与明細）

    @ViewBuilder private func staffBody(_ p: NPRListPayload) -> some View {
        HStack {
            Text("自分の給与・賞与の明細です").font(.system(size: 14)).foregroundColor(NT.ink2)
            Spacer()
            NPRButton(text: "年末調整", icon: "doc.text") { open(.nencho(nil, nil)) }
        }
        NPRDisclaimer()
        let rows = p.payslips ?? []
        if rows.isEmpty {
            NPRCard(title: "給与明細", trailing: { EmptyView() }) {
                NPREmpty(title: "表示できる給与明細はまだありません", message: "給与計算が確定すると表示されます")
            }
        } else {
            VStack(spacing: 10) {
                ForEach(rows) { r in
                    Button { open(.run(r.id)) } label: { payslipRow(r) }
                        .buttonStyle(PressableStyle(scale: 0.99))
                }
            }
        }
    }

    private func payslipRow(_ r: NPRPayslipRow) -> some View {
        HStack(spacing: 12) {
            NPBadge(text: NPRFmt.runType[r.runType] ?? r.runType, color: NPRFmt.runTypeColor(r.runType))
            VStack(alignment: .leading, spacing: 3) {
                Text(r.title).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                Text(r.periodLabel).font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            Spacer(minLength: 8)
            Text(NPRFmt.yen(r.grossTotal)).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
            Text("明細を見る").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
        .contentShape(Rectangle())
    }
}

// MARK: - 給与ルールの追加・編集（Web の PayrollRuleDialog）

struct NPRAllowanceRow: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var amount: String
    var per: String
}

struct NPRRuleSheet: View {
    let rule: NPRRule?
    let staff: [NPROption]
    let stores: [NPROption]
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var profileId: String
    @State private var storeId: String
    @State private var payType: String
    @State private var base: String
    @State private var commute: String
    @State private var effectiveFrom: String
    @State private var overtime: String
    @State private var night: String
    @State private var holiday: String
    @State private var closingDay: Int
    @State private var paymentDay: Int
    @State private var allowances: [NPRAllowanceRow]
    @State private var error: String?
    @State private var saving = false

    init(rule: NPRRule?, staff: [NPROption], stores: [NPROption], today: String, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.rule = rule
        self.staff = staff
        self.stores = stores
        self.onSaved = onSaved
        self.onClose = onClose
        _profileId = State(initialValue: rule?.profileId ?? staff.first?.id ?? "")
        _storeId = State(initialValue: rule?.storeId ?? "")
        _payType = State(initialValue: rule?.payType ?? "hourly")
        _base = State(initialValue: NPRFmt.num(rule?.baseAmount ?? 0))
        _commute = State(initialValue: NPRFmt.num(rule?.commuteAllowance ?? 0))
        _effectiveFrom = State(initialValue: rule?.effectiveFrom ?? today)
        _overtime = State(initialValue: NPRFmt.num(rule?.overtimeRate ?? 1.25))
        _night = State(initialValue: NPRFmt.num(rule?.nightRate ?? 0.25))
        _holiday = State(initialValue: NPRFmt.num(rule?.holidayRate ?? 1.35))
        _closingDay = State(initialValue: Int(rule?.closingDay ?? 31))
        _paymentDay = State(initialValue: Int(rule?.paymentDay ?? 25))
        _allowances = State(initialValue: (rule?.allowances ?? []).map { NPRAllowanceRow(name: $0.name, amount: NPRFmt.num($0.amount), per: $0.per) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("対象") {
                    Picker("スタッフ", selection: $profileId) {
                        Text("選んでください").tag("")
                        ForEach(staff) { s in Text(s.name).tag(s.id) }
                    }
                    .disabled(rule != nil)
                    Picker("店舗", selection: $storeId) {
                        Text("全店舗共通").tag("")
                        ForEach(stores) { s in Text(s.name).tag(s.id) }
                    }
                }
                Section("給与") {
                    Picker("給与形態", selection: $payType) {
                        Text("時給").tag("hourly")
                        Text("月給").tag("monthly")
                        Text("日給").tag("daily")
                    }
                    .pickerStyle(.segmented)
                    numberRow("基本額", text: $base, unit: "円")
                    numberRow("交通費／日", text: $commute, unit: "円")
                    DatePicker("適用開始日", selection: NPRFmt.date($effectiveFrom), displayedComponents: .date)
                }
                Section("割増") {
                    numberRow("残業倍率", text: $overtime, unit: "倍", decimal: true)
                    numberRow("深夜加算", text: $night, unit: "", decimal: true)
                    numberRow("休日倍率", text: $holiday, unit: "倍", decimal: true)
                }
                Section("締め・支払") {
                    Stepper("締め日：\(closingDay)日", value: $closingDay, in: 1...31)
                    Stepper("支払日：\(paymentDay)日", value: $paymentDay, in: 1...31)
                }
                allowanceSection
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle(rule == nil ? "給与ルールを追加" : "給与ルールを編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "保存中…" : "保存") { save() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private var allowanceSection: some View {
        Section {
            if allowances.isEmpty { Text("手当はありません").foregroundColor(NT.ink3) }
            ForEach($allowances) { $a in
                HStack(spacing: 10) {
                    TextField("手当名", text: $a.name)
                    TextField("金額", text: $a.amount).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 110)
                    Picker("", selection: $a.per) {
                        Text("月額").tag("month")
                        Text("日額").tag("day")
                    }
                    .labelsHidden().pickerStyle(.menu).frame(width: 96)
                    Button { allowances.removeAll { $0.id == a.id } } label: {
                        Image(systemName: "trash").foregroundColor(NT.danger)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("削除")
                }
            }
            Button { allowances.append(NPRAllowanceRow(name: "", amount: "0", per: "month")) } label: {
                Label("手当を追加", systemImage: "plus")
            }
        } header: {
            Text("手当")
        }
    }

    private func numberRow(_ label: String, text: Binding<String>, unit: String, decimal: Bool = false) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("0", text: text).keyboardType(decimal ? .decimalPad : .numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 160)
            if !unit.isEmpty { Text(unit).foregroundColor(NT.ink3) }
        }
    }

    private func save() {
        if profileId.isEmpty {
            error = "対象スタッフを選択してください"
            return
        }
        error = nil
        saving = true
        let allowanceList: [[String: Any]] = allowances.map { a in
            let amount: Double = NPRFmt.double(a.amount) ?? 0
            return ["name": a.name, "amount": amount, "per": a.per]
        }
        let ruleBody: [String: Any] = [
            "id": NPRFmt.orNull(rule?.id),
            "profileId": profileId,
            "storeId": NPRFmt.orNull(storeId.isEmpty ? nil : storeId),
            "payType": payType,
            "baseAmount": NPRFmt.double(base) ?? Double(0),
            "overtimeRate": NPRFmt.double(overtime) ?? Double(0),
            "nightRate": NPRFmt.double(night) ?? Double(0),
            "holidayRate": NPRFmt.double(holiday) ?? Double(0),
            "commuteAllowance": NPRFmt.double(commute) ?? Double(0),
            "allowances": allowanceList,
            "closingDay": closingDay,
            "paymentDay": paymentDay,
            "effectiveFrom": effectiveFrom,
        ]
        Task {
            let r = await NPRApi.post(["type": "payrollRuleSave", "rule": ruleBody])
            saving = false
            if r.ok { onSaved(r.message ?? "給与ルールを保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 歩合ルールの追加・編集（Web の CommissionRuleDialog）

struct NPRTierRow: Identifiable, Hashable {
    let id = UUID()
    var from: String
    var to: String
    var rate: String
}

struct NPRCommissionSheet: View {
    let rule: NPRCommissionRule?
    let staff: [NPROption]
    let stores: [NPROption]
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var name: String
    @State private var targetType: String
    @State private var profileId: String
    @State private var storeId: String
    @State private var method: String
    @State private var basis: String
    @State private var rate: String
    @State private var fixed: String
    @State private var tiers: [NPRTierRow]
    @State private var minAmount: String
    @State private var maxAmount: String
    @State private var effectiveFrom: String
    @State private var previewSales = "0"
    @State private var error: String?
    @State private var saving = false

    init(rule: NPRCommissionRule?, staff: [NPROption], stores: [NPROption], today: String, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.rule = rule
        self.staff = staff
        self.stores = stores
        self.onSaved = onSaved
        self.onClose = onClose
        _name = State(initialValue: rule?.name ?? "")
        _targetType = State(initialValue: rule?.targetType ?? "personal_sales")
        _profileId = State(initialValue: rule?.profileId ?? "")
        _storeId = State(initialValue: rule?.storeId ?? "")
        _method = State(initialValue: rule?.method ?? "rate")
        _basis = State(initialValue: rule?.basis ?? "tax_excluded")
        _rate = State(initialValue: rule == nil ? "2" : NPRFmt.num(rule?.rate))
        _fixed = State(initialValue: NPRFmt.num(rule?.fixedAmount))
        _tiers = State(initialValue: (rule?.tiers ?? []).map { NPRTierRow(from: NPRFmt.num($0.from), to: NPRFmt.num($0.to), rate: NPRFmt.num($0.rate)) })
        _minAmount = State(initialValue: NPRFmt.num(rule?.minAmount))
        _maxAmount = State(initialValue: NPRFmt.num(rule?.maxAmount))
        _effectiveFrom = State(initialValue: rule?.effectiveFrom ?? today)
    }

    private var isStoreTarget: Bool { targetType == "store_target" }

    /// 店舗目標達成は固定額だけ（Web と同じく、切り替えたら計算方法を固定額に）
    private var targetBinding: Binding<String> {
        Binding(get: { targetType }, set: { v in
            targetType = v
            if v == "store_target" { method = "fixed" }
        })
    }

    private var tierValues: [NPRTier] {
        tiers.map { NPRTier(from: NPRFmt.double($0.from) ?? 0, to: NPRFmt.double($0.to), rate: NPRFmt.double($0.rate) ?? 0) }
    }

    private var previewAmount: Double {
        let sales = NPRFmt.double(previewSales) ?? 0
        if isStoreTarget {
            // 店舗売上 >= 目標額 なら支給額、未満なら 0 円（給与計算と同じ）
            return sales >= (NPRFmt.double(minAmount) ?? 0) ? (NPRFmt.double(fixed) ?? 0) : 0
        }
        return NPRFmt.commission(method: method, rate: NPRFmt.double(rate), fixed: NPRFmt.double(fixed), tiers: tierValues,
                                 lo: NPRFmt.double(minAmount), hi: NPRFmt.double(maxAmount), sales: sales)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("ルール") {
                    TextField("ルール名（例：個人売上歩合）", text: $name)
                    Picker("対象タイプ", selection: targetBinding) {
                        Text("個人売上").tag("personal_sales")
                        Text("店舗目標達成").tag("store_target")
                    }
                    Picker("対象スタッフ", selection: $profileId) {
                        Text("全スタッフ").tag("")
                        ForEach(staff) { s in Text(s.name).tag(s.id) }
                    }
                    Picker("対象店舗", selection: $storeId) {
                        Text("全店舗").tag("")
                        ForEach(stores) { s in Text(s.name).tag(s.id) }
                    }
                }
                if isStoreTarget { storeTargetSection } else { personalSection }
                if !isStoreTarget && method == "tiered" { tiersSection }
                if !isStoreTarget {
                    Section("下限・上限（任意）") {
                        amountRow("下限額", text: $minAmount)
                        amountRow("上限額", text: $maxAmount)
                    }
                }
                Section {
                    DatePicker("適用開始日", selection: NPRFmt.date($effectiveFrom), displayedComponents: .date)
                }
                Section("試算") {
                    amountRow(isStoreTarget ? "店舗売上" : "売上", text: $previewSales)
                    HStack {
                        Text("支給額")
                        Spacer()
                        Text(NPRFmt.yen(previewAmount)).font(.system(size: 17, weight: .heavy)).monospacedDigit()
                    }
                }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle(rule == nil ? "歩合ルールを追加" : "歩合ルールを編集")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "保存中…" : "保存") { save() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private var storeTargetSection: some View {
        Section {
            amountRow("支給額", text: $fixed)
            amountRow("目標額（必須）", text: $minAmount)
        } header: {
            Text("店舗目標達成")
        } footer: {
            Text("店舗売上が目標額以上の月に固定額を払います。目標に届かない月は払いません。")
        }
    }

    private var personalSection: some View {
        Section("計算") {
            Picker("計算方法", selection: $method) {
                Text("料率（%）").tag("rate")
                Text("固定額").tag("fixed")
                Text("段階料率").tag("tiered")
            }
            Picker("売上基準", selection: $basis) {
                Text("税抜売上").tag("tax_excluded")
                Text("税込売上").tag("tax_included")
            }
            if method == "rate" {
                HStack {
                    Text("料率")
                    Spacer()
                    TextField("0", text: $rate).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 140)
                    Text("%").foregroundColor(NT.ink3)
                }
            }
            if method == "fixed" { amountRow("固定額", text: $fixed) }
        }
    }

    private var tiersSection: some View {
        Section {
            if tiers.isEmpty { Text("段階がありません").foregroundColor(NT.ink3) }
            ForEach($tiers) { $t in
                HStack(spacing: 8) {
                    TextField("下限", text: $t.from).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 110)
                    Text("〜").foregroundColor(NT.ink3)
                    TextField("上限（空＝なし）", text: $t.to).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 150)
                    Text("円").foregroundColor(NT.ink3)
                    Spacer(minLength: 4)
                    TextField("料率", text: $t.rate).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
                    Text("%").foregroundColor(NT.ink3)
                    Button { tiers.removeAll { $0.id == t.id } } label: {
                        Image(systemName: "trash").foregroundColor(NT.danger)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("削除")
                }
            }
            Button { tiers.append(NPRTierRow(from: "0", to: "", rate: "0")) } label: {
                Label("段階を追加", systemImage: "plus")
            }
        } header: {
            Text("段階（売上の帯ごとの料率）")
        } footer: {
            Text("例：0〜30万円 0%／30〜50万円 3%／50〜80万円 5%／80万円〜 8%")
        }
    }

    private func amountRow(_ label: String, text: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("0", text: text).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(maxWidth: 180)
            Text("円").foregroundColor(NT.ink3)
        }
    }

    private func save() {
        if name.trimmingCharacters(in: .whitespaces).isEmpty {
            error = "ルール名を入力してください"
            return
        }
        error = nil
        saving = true
        let tierList: [[String: Any]] = tiers.map { t in
            let from: Double = NPRFmt.double(t.from) ?? 0
            let tierRate: Double = NPRFmt.double(t.rate) ?? 0
            return ["from": from, "to": NPRFmt.orNull(NPRFmt.double(t.to)), "rate": tierRate]
        }
        let ruleBody: [String: Any] = [
            "id": NPRFmt.orNull(rule?.id),
            "name": name,
            "targetType": targetType,
            "profileId": NPRFmt.orNull(profileId.isEmpty ? nil : profileId),
            "storeId": NPRFmt.orNull(storeId.isEmpty ? nil : storeId),
            "method": method,
            "rate": NPRFmt.orNull(NPRFmt.double(rate)),
            "fixedAmount": NPRFmt.orNull(NPRFmt.double(fixed)),
            "tiers": NPRFmt.orNull(tierList.isEmpty ? nil : tierList),
            "basis": basis,
            "minAmount": NPRFmt.orNull(NPRFmt.double(minAmount)),
            "maxAmount": NPRFmt.orNull(NPRFmt.double(maxAmount)),
            "effectiveFrom": effectiveFrom,
        ]
        Task {
            let r = await NPRApi.post(["type": "payrollCommissionSave", "rule": ruleBody])
            saving = false
            if r.ok { onSaved(r.message ?? "歩合ルールを保存しました") } else { error = r.error ?? "保存できませんでした" }
        }
    }
}

// MARK: - 給与計算の新規作成（Web の RunDialog：給与＝期間集計／賞与＝金額を手入力）

struct NPRBonusRow: Identifiable, Hashable {
    let id = UUID()
    var profileId: String
    var amount: String
}

struct NPRRunCreateSheet: View {
    let defaults: NPRDefaults
    let staff: [NPROption]
    let stores: [NPROption]
    let onCreated: (String) -> Void
    let onClose: () -> Void

    @State private var runType = "salary"
    @State private var title: String
    @State private var periodStart: String
    @State private var periodEnd: String
    @State private var paymentDate: String
    @State private var storeId = ""
    @State private var bonusRows = [NPRBonusRow(profileId: "", amount: "")]
    @State private var error: String?
    @State private var saving = false

    init(defaults: NPRDefaults, staff: [NPROption], stores: [NPROption], onCreated: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.defaults = defaults
        self.staff = staff
        self.stores = stores
        self.onCreated = onCreated
        self.onClose = onClose
        _title = State(initialValue: defaults.salaryTitle)
        _periodStart = State(initialValue: defaults.periodStart)
        _periodEnd = State(initialValue: defaults.periodEnd)
        _paymentDate = State(initialValue: defaults.today)
    }

    private var typeBinding: Binding<String> {
        Binding(get: { runType }, set: { v in
            runType = v
            error = nil
            title = v == "bonus" ? defaults.bonusTitle : defaults.salaryTitle
        })
    }

    private var bonusTotal: Double { bonusRows.reduce(0) { $0 + (NPRFmt.double($1.amount) ?? 0) } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("種別", selection: typeBinding) {
                        Text("給与（期間集計）").tag("salary")
                        Text("賞与（金額を手入力）").tag("bonus")
                    }
                    .pickerStyle(.segmented)
                    TextField("タイトル", text: $title)
                    if runType == "salary" {
                        DatePicker("期間の始め", selection: NPRFmt.date($periodStart), displayedComponents: .date)
                        DatePicker("期間の終わり", selection: NPRFmt.date($periodEnd), displayedComponents: .date)
                    } else {
                        DatePicker("支給日", selection: NPRFmt.date($paymentDate), displayedComponents: .date)
                    }
                    Picker("対象店舗", selection: $storeId) {
                        Text("全社（全店舗）").tag("")
                        ForEach(stores) { s in Text(s.name).tag(s.id) }
                    }
                }
                if runType == "bonus" { bonusSection }
                if let error {
                    Section { Text(error).foregroundColor(NT.danger) }
                }
            }
            .navigationTitle("給与計算を新規作成")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose).disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "作成中…" : "作成する") { submit() }.disabled(saving) }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private var bonusSection: some View {
        Section {
            ForEach($bonusRows) { $row in
                HStack(spacing: 10) {
                    Picker("", selection: $row.profileId) {
                        Text("スタッフを選択").tag("")
                        ForEach(staff) { s in Text(s.name).tag(s.id) }
                    }
                    .labelsHidden().pickerStyle(.menu)
                    Spacer(minLength: 6)
                    TextField("支給額", text: $row.amount).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 140)
                    Text("円").foregroundColor(NT.ink3)
                    Button { bonusRows.removeAll { $0.id == row.id } } label: {
                        Image(systemName: "trash").foregroundColor(bonusRows.count == 1 ? NT.ink3 : NT.danger)
                    }
                    .buttonStyle(.borderless)
                    .disabled(bonusRows.count == 1)
                    .accessibilityLabel("この行を削除")
                }
            }
            Button { bonusRows.append(NPRBonusRow(profileId: "", amount: "")) } label: {
                Label("行を追加", systemImage: "plus")
            }
            HStack {
                Spacer()
                Text("合計 \(NPRFmt.yen(bonusTotal))").font(.system(size: 16, weight: .heavy)).monospacedDigit()
            }
        } header: {
            Text("対象スタッフ・支給額")
        } footer: {
            Text("勤怠・手当・歩合は入りません。税・社会保険を引く前の総支給額を入れてください。")
        }
    }

    private func submit() {
        if title.trimmingCharacters(in: .whitespaces).isEmpty {
            error = "タイトルを入力してください"
            return
        }
        error = nil
        let store = NPRFmt.orNull(storeId.isEmpty ? nil : storeId)
        let cleanTitle = title.trimmingCharacters(in: .whitespaces)
        let body: [String: Any]
        if runType == "salary" {
            if periodStart > periodEnd {
                error = "期間の指定が正しくありません"
                return
            }
            body = ["type": "payrollRunCreate", "title": cleanTitle, "periodStart": periodStart, "periodEnd": periodEnd, "storeId": store]
        } else {
            let items: [[String: Any]] = bonusRows
                .filter { !$0.profileId.isEmpty && !$0.amount.trimmingCharacters(in: .whitespaces).isEmpty }
                .map { row in
                    let amount: Double = NPRFmt.double(row.amount) ?? 0
                    return ["profileId": row.profileId, "amount": amount]
                }
            if items.isEmpty {
                error = "対象スタッフと支給額を1件以上入力してください"
                return
            }
            body = ["type": "payrollBonusCreate", "title": cleanTitle, "paymentDate": paymentDate, "storeId": store, "items": items]
        }
        saving = true
        Task {
            let r = await NPRApi.post(body)
            saving = false
            if r.ok, let id = r.id { onCreated(id) } else { error = r.error ?? "作成できませんでした" }
        }
    }
}

// MARK: - 詳細（/app/payroll/<runId>）

@MainActor
final class NPRRunModel: ObservableObject {
    let runId: String
    @Published var payload: NPRRunPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    init(runId: String) { self.runId = runId }

    func load() async {
        do {
            payload = try await NPRApi.get(NPRRunPayload.self, ["run": runId])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func act(_ type: String) async {
        busy = true
        let r = await NPRApi.post(["type": type, "runId": runId])
        busy = false
        toast = r.ok ? (r.message ?? "できました") : (r.error ?? "できませんでした")
        await load()
    }
}

/// 確定・承認・下書きに戻す の確かめ（Web の ConfirmDialog と同じ文言）
enum NPRConfirm {
    case confirm, approve, revert
    var title: String {
        switch self {
        case .confirm: return "給与計算を確定"
        case .approve: return "給与計算を承認"
        case .revert: return "給与計算を下書きに戻す"
        }
    }
    var message: String {
        switch self {
        case .confirm: return "この内容で確定します。確定後は再計算できません（再計算するには一旦下書きに戻す必要があります）。"
        case .approve: return "承認すると内容を変更できなくなります（金額・計算根拠は以後不変になります）。よろしいですか。"
        case .revert: return "下書きに戻すと再計算が可能になります。勤怠修正申請の承認などで内容が変わった場合はこちらから再計算してください。"
        }
    }
    var button: String {
        switch self {
        case .confirm: return "確定する"
        case .approve: return "承認する"
        case .revert: return "下書きに戻す"
        }
    }
    var type: String {
        switch self {
        case .confirm: return "payrollRunConfirm"
        case .approve: return "payrollRunApprove"
        case .revert: return "payrollRunRevert"
        }
    }
}

struct NPRRunScreen: View {
    let runId: String
    let onBack: () -> Void
    let onWeb: (String) -> Void
    @StateObject private var model: NPRRunModel
    @State private var confirm: NPRConfirm?
    @State private var expanded: Set<String> = []
    @State private var exporting = false

    init(runId: String, onBack: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.runId = runId
        self.onBack = onBack
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NPRRunModel(runId: runId))
    }

    var body: some View {
        NPRPage(title: model.payload?.mode == "manage" ? "給与計算" : "給与明細", backIcon: "chevron.left", onBack: onBack,
                loaded: model.payload != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p = model.payload { content(p) }
        }
        .task { await model.load() }
        .alert(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { k in
            Button("キャンセル", role: .cancel) {}
            Button(k.button) { Task { await model.act(k.type) } }
        } message: { k in
            Text(k.message)
        }
    }

    @ViewBuilder private func content(_ p: NPRRunPayload) -> some View {
        switch p.mode {
        case "manage":
            if let run = p.run { manage(p, run: run) }
        case "self":
            if let slip = p.payslip { selfSlip(slip) }
        default:
            NPRCard(title: "給与明細", trailing: { EmptyView() }) {
                NPREmpty(title: p.title ?? "この給与明細は表示できません", message: p.message)
            }
        }
    }

    // MARK: 管理者

    @ViewBuilder private func manage(_ p: NPRRunPayload, run: NPRRunHead) -> some View {
        header(run)
        NPRDisclaimer()
        if let note = run.note, !note.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "info.circle")
                Text(note).fixedSize(horizontal: false, vertical: true)
            }
            .font(.system(size: 13)).foregroundColor(NT.ink2)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
        actions(run)
        if let s = p.snapshot { NPRSnapshotPanel(s: s) }
        if run.runType == "bonus" {
            bonusList(p.bonusItems ?? [], total: p.bonusTotal ?? 0)
        } else {
            salaryList(p.items ?? [], totals: p.totals)
        }
    }

    private func header(_ run: NPRRunHead) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(run.title).font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                    Text(run.description).font(.system(size: 14)).foregroundColor(NT.ink2)
                }
                Spacer(minLength: 8)
                NPBadge(text: NPRFmt.runType[run.runType] ?? run.runType, color: NPRFmt.runTypeColor(run.runType))
                NPBadge(text: NPRFmt.runStatus[run.status] ?? run.status, color: NPRFmt.runStatusColor(run.status))
            }
            HStack(spacing: 10) {
                NPRButton(text: "CSVで出す", icon: "square.and.arrow.up", busy: exporting) { exportCsv(run) }
                NPRButton(text: "この給与の仕訳を見る", icon: "book") {
                    onWeb("/app/accounting?source_type=payroll&source_id=\(run.id)")
                }
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    /// CSV（Web の /app/payroll/<id>/export をそのまま取ってきて共有シートへ）
    private func exportCsv(_ run: NPRRunHead) {
        exporting = true
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/payroll/\(run.id)/export")
                let name = NPRFmt.fileSafe(run.csvName ?? "payroll_\(run.title).csv")
                if let url = NLShare.tempFile(name, data: data) { NLShare.present(url: url) } else { model.toast = "CSV を保存できませんでした" }
            } catch {
                model.toast = NativeModuleAPI.message(error)
            }
            exporting = false
        }
    }

    /// 承認済みは何も出さない（DB でも変えられない）
    @ViewBuilder private func actions(_ run: NPRRunHead) -> some View {
        if run.status == "draft" {
            HStack(spacing: 10) {
                if run.runType == "salary" {
                    NPRButton(text: "再計算", icon: "arrow.clockwise", busy: model.busy) { Task { await model.act("payrollRunRecalc") } }
                }
                NPRButton(text: "確定", icon: "checkmark.circle", kind: .primary, disabled: model.busy) { confirm = .confirm }
            }
        } else if run.status == "confirmed" {
            HStack(spacing: 10) {
                NPRButton(text: "下書きに戻す", icon: "arrow.uturn.backward", disabled: model.busy) { confirm = .revert }
                NPRButton(text: "承認", icon: "checkmark.shield", kind: .primary, disabled: model.busy) { confirm = .approve }
            }
        }
    }

    private func bonusList(_ items: [NPRBonusItem], total: Double) -> some View {
        NPRCard(title: "支給額", trailing: { EmptyView() }) {
            if items.isEmpty {
                NPREmpty(title: "支給対象者がいません")
            } else {
                VStack(spacing: 0) {
                    ForEach(items) { i in
                        HStack {
                            Text(i.profileName).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                            Spacer()
                            Text(NPRFmt.yen(i.amount)).font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                        }
                        .padding(.horizontal, 18).padding(.vertical, 12)
                        NPRDivider()
                    }
                    HStack {
                        Text("合計").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                        Spacer()
                        Text(NPRFmt.yen(total)).font(.system(size: 18, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 14)
                    .background(NT.page)
                }
            }
        }
    }

    @ViewBuilder private func salaryList(_ items: [NPRItem], totals: NPRTotals?) -> some View {
        if items.isEmpty {
            NPRCard(title: "明細", trailing: { EmptyView() }) {
                NPREmpty(title: "この期間の対象者がいません", message: "給与ルールが未設定か、勤怠記録がありません")
            }
        } else {
            if let t = totals { NPRTotalsCard(t: t, count: items.count) }
            VStack(spacing: 10) {
                ForEach(items) { item in
                    NPRItemCard(item: item, open: expanded.contains(item.id)) {
                        if expanded.contains(item.id) { expanded.remove(item.id) } else { expanded.insert(item.id) }
                    }
                }
            }
        }
    }

    // MARK: スタッフ（自分の給与明細）

    @ViewBuilder private func selfSlip(_ slip: NPRPayslip) -> some View {
        NPRDisclaimer()
        HStack {
            Spacer()
            NPRButton(text: "PDF で保存・印刷", icon: "printer") { savePdf(slip) }
        }
        NPRPayslipView(p: slip)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
    }

    /// 給与明細を PDF に（Web の「印刷する（PDF保存はブラウザの印刷画面から）」の代わり。共有から印刷・保存）
    private func savePdf(_ slip: NPRPayslip) {
        let kind = slip.runType == "bonus" ? "賞与明細" : "給与明細"
        let name = NPRFmt.fileSafe("\(kind)_\(slip.runTitle).pdf")
        let page = NPRPayslipView(p: slip).padding(24).background(Color.white)
        if let url = NLShare.pdf(of: page, width: 760, name: name) { NLShare.present(url: url) } else { model.toast = "PDF を作れませんでした" }
    }
}

/// 合計（Web の表の一番下の行）
private struct NPRTotalsCard: View {
    let t: NPRTotals
    let count: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("合計（\(count)人）").font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                Text("総支給").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Text(NPRFmt.yen(t.grossTotal)).font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
            }
            NPRChips(pairs: [
                ("勤務", "\(Int(t.workDays))日"), ("実働", NPRFmt.minutes(t.workMinutes)), ("残業", NPRFmt.minutes(t.overtimeMinutes)),
                ("深夜", NPRFmt.minutes(t.nightMinutes)), ("休日", NPRFmt.minutes(t.holidayMinutes)),
            ])
            NPRChips(pairs: [
                ("基本給", NPRFmt.yen(t.basePay)), ("残業代", NPRFmt.yen(t.overtimePay)), ("深夜手当", NPRFmt.yen(t.nightPay)),
                ("休日手当", NPRFmt.yen(t.holidayPay)), ("交通費", NPRFmt.yen(t.commutePay)), ("手当", NPRFmt.yen(t.allowanceTotal)),
                ("歩合", NPRFmt.yen(t.commissionTotal)),
            ])
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }
}

/// スタッフ 1 人の明細（押すと計算根拠・日別勤怠）
private struct NPRItemCard: View {
    let item: NPRItem
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: open ? "chevron.down" : "chevron.right")
                            .font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).frame(width: 16)
                        Text(item.profileName).font(.system(size: 17, weight: .heavy)).foregroundColor(NT.ink)
                        Spacer()
                        Text("総支給").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                        Text(NPRFmt.yen(item.grossTotal)).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(NT.ink)
                    }
                    NPRChips(pairs: [
                        ("勤務", "\(Int(item.workDays))日"), ("実働", NPRFmt.minutes(item.workMinutes)), ("残業", NPRFmt.minutes(item.overtimeMinutes)),
                        ("深夜", NPRFmt.minutes(item.nightMinutes)), ("休日", NPRFmt.minutes(item.holidayMinutes)),
                    ])
                    NPRChips(pairs: [
                        ("基本給", NPRFmt.yen(item.basePay)), ("残業代", NPRFmt.yen(item.overtimePay)), ("深夜手当", NPRFmt.yen(item.nightPay)),
                        ("休日手当", NPRFmt.yen(item.holidayPay)), ("交通費", NPRFmt.yen(item.commutePay)), ("手当", NPRFmt.yen(item.allowanceTotal)),
                        ("歩合", NPRFmt.yen(item.commissionTotal)),
                    ])
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Rectangle().fill(NT.line).frame(height: 1)
                NPRItemDetail(item: item)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

private struct NPRItemDetail: View {
    let item: NPRItem

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("計算根拠").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                ForEach(Array(item.lines.enumerated()), id: \.offset) { _, line in NPRLineView(line: line) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                Text("日別勤怠").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                if item.days.isEmpty {
                    Text("対象日がありません").font(.system(size: 13)).foregroundColor(NT.ink3)
                } else {
                    days
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(NT.page.opacity(0.5))
    }

    private var days: some View {
        VStack(alignment: .leading, spacing: 0) {
            NPRTableRow(cells: [("日付", 86, false), ("出退勤", 104, false), ("実働", 44, true), ("残業", 44, true), ("深夜", 44, true), ("休日", 44, true)], header: true)
                .padding(.horizontal, 10)
            Rectangle().fill(NT.line).frame(height: 1)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(item.days.enumerated()), id: \.offset) { _, d in
                        NPRTableRow(cells: [(d.date, 86, false), (d.inOut, 104, false), (d.work, 44, true), (d.overtime, 44, true), (d.night, 44, true), (d.holiday, 44, true)])
                            .padding(.horizontal, 10)
                    }
                }
            }
            .frame(maxHeight: 240)
        }
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

private struct NPRLineView: View {
    let line: NPRLine
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(line.text)
                .font(.system(size: 14, weight: line.strong == true ? Font.Weight.heavy : Font.Weight.regular))
                .foregroundColor(line.strong == true ? NT.ink : NT.ink2)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array((line.sub ?? []).enumerated()), id: \.offset) { _, s in
                Text("・" + s).font(.system(size: 12.5)).foregroundColor(NT.ink3).padding(.leading, 14).fixedSize(horizontal: false, vertical: true)
            }
            if let tail = line.tail {
                Text(tail).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink).padding(.leading, 14)
            }
        }
    }
}

/// 承認時に固定したルール（Web の RulesSnapshotPanel）
private struct NPRSnapshotPanel: View {
    let s: NPRSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("この計算で使ったルール（確定時点で固定）").font(.system(size: 16, weight: .heavy)).foregroundColor(NT.ink)
                Spacer()
                if let g = s.generatedLabel { Text(g).font(.system(size: 12)).foregroundColor(NT.ink3) }
            }
            if let note = s.note { Text(note).font(.system(size: 13)).foregroundColor(NT.ink2) }
            if s.payrollRules.isEmpty && s.commissionRules.isEmpty && s.note == nil {
                Text("記録されたルールはありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            if !s.payrollRules.isEmpty { payrollTable }
            if !s.commissionRules.isEmpty { commissionTable }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    private var payrollTable: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                NPRTableRow(cells: [("スタッフ", 130, false), ("給与形態", 60, false), ("基本額", 90, true), ("残業倍率", 64, true), ("深夜加算", 64, true), ("休日倍率", 64, true), ("交通費", 80, true), ("適用期間", 200, false)], header: true)
                ForEach(s.payrollRules) { r in
                    NPRTableRow(cells: [(r.staff, 130, false), (r.payType, 60, false), (r.base, 90, true), (r.overtime, 64, true), (r.night, 64, true), (r.holiday, 64, true), (r.commute, 80, true), (r.period, 200, false)])
                }
            }
        }
    }

    private var commissionTable: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                NPRTableRow(cells: [("ルール名", 160, false), ("対象", 120, false), ("計算方法", 80, false), ("料率／固定額", 100, true), ("適用期間", 200, false)], header: true)
                ForEach(s.commissionRules) { r in
                    NPRTableRow(cells: [(r.name, 160, false), (r.target, 120, false), (r.method, 80, false), (r.value, 100, true), (r.period, 200, false)])
                }
            }
        }
    }
}

/// 給与明細書（Web の components/payroll/payslip.tsx）。PDF にもそのまま使う
struct NPRPayslipView: View {
    let p: NPRPayslip

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            head
            Rectangle().fill(NT.line).frame(height: 1)
            if p.runType == "bonus" {
                totalBox("賞与支給額", p.grossTotal)
            } else {
                salaryBody
            }
            Text("本明細は概算の試算です。税金・社会保険料・年末調整は含まれません。正式な計算は社会保険労務士・税理士へご確認ください。")
                .font(.system(size: 10)).foregroundColor(NT.ink3).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(28)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private var head: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(p.runType == "bonus" ? "賞与明細書" : "給与明細書").font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink)
                Text(p.runTitle).font(.system(size: 12)).foregroundColor(NT.ink3)
                Text(p.periodLabel).font(.system(size: 12)).foregroundColor(NT.ink3)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let org = p.organizationName { Text(org).font(.system(size: 12)).foregroundColor(NT.ink3) }
                Text("\(p.profileName) 様").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
            }
        }
    }

    private var salaryBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            section("勤怠情報") {
                HStack(spacing: 10) {
                    tile("出勤日数", "\(Int(p.workDays))日")
                    tile("実働時間", NPRFmt.minutes(p.workMinutes))
                    tile("残業時間", NPRFmt.minutes(p.overtimeMinutes))
                }
            }
            section("支給内訳") {
                VStack(spacing: 0) {
                    row("基本給", p.basePay)
                    row("残業手当", p.overtimePay)
                    row("深夜手当", p.nightPay)
                    row("休日手当", p.holidayPay)
                    row("交通費", p.commutePay)
                    row("諸手当", p.allowanceTotal)
                    row("歩合給", p.commissionTotal)
                    Rectangle().fill(NT.line).frame(height: 2)
                    HStack {
                        Text("支給合計").font(.system(size: 14, weight: .heavy))
                        Spacer()
                        Text(NPRFmt.yen(p.grossTotal)).font(.system(size: 14, weight: .heavy)).monospacedDigit()
                    }
                    .foregroundColor(NT.ink).padding(.vertical, 8)
                }
            }
            section("控除") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("税・社会保険料の控除はこれから対応します。いまは 0 円で出しています。")
                        .font(.system(size: 12)).foregroundColor(NT.ink3)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.page))
                    row("控除合計", 0)
                }
            }
            totalBox("差引支給額", p.grossTotal)
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            content()
        }
    }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(label).font(.system(size: 12)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 16, weight: .bold)).monospacedDigit().foregroundColor(NT.ink)
        }
        .frame(maxWidth: .infinity).padding(12)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
    }

    private func row(_ label: String, _ value: Double) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundColor(NT.ink2)
            Spacer()
            Text(NPRFmt.yen(value)).font(.system(size: 14)).monospacedDigit().foregroundColor(NT.ink)
        }
        .padding(.vertical, 7)
    }

    private func totalBox(_ label: String, _ value: Double) -> some View {
        HStack {
            Text(label).font(.system(size: 14, weight: .semibold))
            Spacer()
            Text(NPRFmt.yen(value)).font(.system(size: 26, weight: .heavy)).monospacedDigit()
        }
        .foregroundColor(.white)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.header))
    }
}

// MARK: - 年末調整（/app/payroll/nencho）

struct NPRDependentRow: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var relation: String
    var birthDate: String
}

/// 自分の申告の入力（Web の NenchoForm と同じ項目）
struct NPRNenchoForm: Equatable {
    var dependents: [NPRDependentRow] = []
    var hasSpouse = false
    var spouseIncome = ""
    var life = "0"
    var earthquake = "0"
    var housingLoan = false
    var previousJob = false
    var note = ""

    init() {}

    init(_ d: NPRNenchoDataDTO) {
        dependents = d.dependents.map { NPRDependentRow(name: $0.name, relation: $0.relation, birthDate: $0.birthDate) }
        hasSpouse = d.hasSpouse
        spouseIncome = NPRFmt.num(d.spouseIncome)
        life = NPRFmt.num(d.lifeInsurancePremium)
        earthquake = NPRFmt.num(d.earthquakeInsurancePremium)
        housingLoan = d.hasHousingLoanDeduction
        previousJob = d.hasPreviousEmploymentIncome
        note = d.basicDeductionNote
    }

    /// サーバー（saveNenchoDraft の zod）に渡す形。金額は数字だけ拾う（Web と同じ）
    var json: [String: Any] {
        var d: [String: Any] = [
            "dependents": dependents.map { ["name": $0.name, "relation": $0.relation, "birthDate": $0.birthDate] },
            "hasSpouse": hasSpouse,
            "lifeInsurancePremium": Int(NPRFmt.digits(life)) ?? 0,
            "earthquakeInsurancePremium": Int(NPRFmt.digits(earthquake)) ?? 0,
            "hasHousingLoanDeduction": housingLoan,
            "hasPreviousEmploymentIncome": previousJob,
            "basicDeductionNote": note,
        ]
        let income = NPRFmt.digits(spouseIncome)
        if income.isEmpty {
            d["spouseIncome"] = NSNull()
        } else {
            d["spouseIncome"] = Int(income) ?? 0
        }
        return d
    }
}

@MainActor
final class NPRNenchoModel: ObservableObject {
    @Published var year: Int?
    @Published var status: String
    @Published var payload: NPRNenchoPayload?
    @Published var form = NPRNenchoForm()
    @Published var error: String?
    @Published var formError: String?
    @Published var toast: String?
    @Published var busy = false

    init(year: Int?, status: String?) {
        self.year = year
        self.status = status ?? ""
    }

    var editable: Bool { ["new", "draft", "needs_fix"].contains(payload?.own.status ?? "") }

    /// resetForm: 自分の申告の入力も読み直す（年を変えた・保存したとき）。確認する人の操作では入力中のものを残す
    func load(resetForm: Bool = true) async {
        var q = ["view": "nencho"]
        if let year { q["year"] = String(year) }
        if !status.isEmpty { q["status"] = status }
        do {
            let p = try await NPRApi.get(NPRNenchoPayload.self, q)
            if resetForm || payload == nil { form = NPRNenchoForm(p.own.data) }
            payload = p
            year = p.year
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    /// 下書き保存（submit: true は保存してから提出。Web と同じ順）
    func save(submit: Bool) async {
        guard let y = payload?.year else { return }
        formError = nil
        busy = true
        let saved = await NPRApi.post(["type": "nenchoSave", "year": y, "data": form.json])
        if !saved.ok {
            busy = false
            formError = saved.error
            toast = saved.error
            return
        }
        if submit {
            let r = await NPRApi.post(["type": "nenchoSubmit", "year": y])
            toast = r.ok ? r.message : r.error
            if !r.ok { formError = r.error }
        } else {
            toast = saved.message
        }
        busy = false
        await load(resetForm: true)
    }

    func act(_ body: [String: Any]) async {
        busy = true
        let r = await NPRApi.post(body)
        busy = false
        toast = r.ok ? (r.message ?? "できました") : (r.error ?? "できませんでした")
        await load(resetForm: false)
    }
}

struct NPRNenchoScreen: View {
    let onBack: () -> Void
    @StateObject private var model: NPRNenchoModel
    @State private var expanded: Set<String> = []
    @State private var prompt: NPReasonPrompt?

    init(year: Int?, status: String?, onBack: @escaping () -> Void) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: NPRNenchoModel(year: year, status: status))
    }

    var body: some View {
        NPRPage(title: "年末調整", backIcon: "chevron.left", onBack: onBack, loaded: model.payload != nil, error: model.error,
                toast: $model.toast, retry: { await model.load(resetForm: false) }) {
            if let p = model.payload {
                yearChips(p)
                ownSection(p)
                if p.canReview { adminSection(p) }
            }
        }
        .task { await model.load() }
        .sheet(item: $prompt) { pr in NPReasonSheet(prompt: pr) { prompt = nil }.presentationDetents([.medium]) }
    }

    private func yearChips(_ p: NPRNenchoPayload) -> some View {
        HStack(spacing: 8) {
            Text("対象年").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
            ForEach(p.yearOptions, id: \.self) { y in
                Button {
                    Task {
                        model.year = y
                        model.status = ""
                        await model.load(resetForm: true)
                    }
                } label: {
                    Text(verbatim: "\(y)年").font(.system(size: 15, weight: .bold))
                        .foregroundColor(y == p.year ? Color.white : NT.ink2)
                        .padding(.horizontal, 14).frame(height: 38)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(y == p.year ? NT.header : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(y == p.year ? Color.clear : NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
            Spacer()
        }
    }

    // MARK: 自分の申告

    @ViewBuilder private func ownSection(_ p: NPRNenchoPayload) -> some View {
        Text("自分の申告").font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).padding(.top, 4)
        HStack(spacing: 10) {
            Text(verbatim: "\(p.year)年分の申告").font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2)
            NPBadge(text: NPRFmt.nenchoStatus[p.own.status] ?? p.own.status, color: NPRFmt.nenchoColor(p.own.status))
            if p.own.status == "needs_fix", let note = p.own.reviewNote {
                Text("差戻し理由：\(note)").font(.system(size: 13, weight: .semibold)).foregroundColor(NT.danger)
            }
            Spacer()
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle")
            Text("年末調整の計算は、税理士などの確認が終わってから対応します。いまは申告の集めと確認だけです。").fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 13)).foregroundColor(NT.warn)
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.saffronSoft))
        dependentsCard
        spouseAndInsuranceCards
        otherCard
        if model.editable { ownButtons }
    }

    private var dependentsCard: some View {
        let editable = model.editable
        return NPRCard(title: "扶養家族", trailing: {
            if editable {
                NPRButton(text: "行を追加", icon: "plus") { model.form.dependents.append(NPRDependentRow(name: "", relation: "", birthDate: "")) }
            }
        }) {
            VStack(alignment: .leading, spacing: 0) {
                if model.form.dependents.isEmpty {
                    Text(editable ? "扶養家族がいるときは「行を追加」してください" : "なし").font(.system(size: 13)).foregroundColor(NT.ink3)
                        .padding(.horizontal, 18).padding(.vertical, 16)
                }
                ForEach($model.form.dependents) { $d in
                    HStack(spacing: 10) {
                        NSPInput(text: $d.name, placeholder: "氏名", enabled: editable, width: 220)
                        NSPInput(text: $d.relation, placeholder: "続柄", enabled: editable, width: 140)
                        birthField($d.birthDate, editable: editable)
                        Spacer(minLength: 4)
                        if editable {
                            Button { model.form.dependents.removeAll { $0.id == d.id } } label: {
                                Image(systemName: "trash").font(.system(size: 16, weight: .semibold)).foregroundColor(NT.danger).frame(width: 40, height: 40)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("この行を削除")
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                }
            }
        }
    }

    @ViewBuilder private func birthField(_ date: Binding<String>, editable: Bool) -> some View {
        if date.wrappedValue.isEmpty {
            Button { date.wrappedValue = "2000-01-01" } label: {
                Text("生年月日を入れる").font(.system(size: 14, weight: .semibold)).foregroundColor(editable ? NT.purple : NT.ink3)
                    .padding(.horizontal, 12).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(!editable)
        } else {
            HStack(spacing: 6) {
                Text("生年月日").font(.system(size: 13)).foregroundColor(NT.ink3)
                DatePicker("", selection: NPRFmt.date(date), displayedComponents: .date)
                    .labelsHidden()
                    .disabled(!editable)
                    .environment(\.locale, Locale(identifier: "ja_JP"))
            }
        }
    }

    private var spouseAndInsuranceCards: some View {
        let editable = model.editable
        return VStack(spacing: 16) {
            NPRCard(title: "配偶者", trailing: { EmptyView() }) {
                VStack(spacing: 0) {
                    NSPRow(label: "配偶者がいる") {
                        NSPToggle(on: model.form.hasSpouse, disabled: !editable) { model.form.hasSpouse.toggle() }
                    }
                    if model.form.hasSpouse {
                        NSPRow(label: "配偶者の年間所得（概算）") {
                            NSPInput(text: $model.form.spouseIncome, placeholder: "0", enabled: editable, width: 220, keyboard: .numberPad, trailing: "円")
                        }
                    }
                }
            }
            NPRCard(title: "保険料控除", trailing: { EmptyView() }) {
                VStack(spacing: 0) {
                    NSPRow(label: "生命保険料（年間合計）") {
                        NSPInput(text: $model.form.life, placeholder: "0", enabled: editable, width: 220, keyboard: .numberPad, trailing: "円")
                    }
                    NSPRow(label: "地震保険料（年間合計）") {
                        NSPInput(text: $model.form.earthquake, placeholder: "0", enabled: editable, width: 220, keyboard: .numberPad, trailing: "円")
                    }
                }
            }
        }
    }

    private var otherCard: some View {
        let editable = model.editable
        return NPRCard(title: "その他の申告", trailing: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 0) {
                NSPRow(label: "住宅ローン控除がある") {
                    NSPToggle(on: model.form.housingLoan, disabled: !editable) { model.form.housingLoan.toggle() }
                }
                NSPRow(label: "今年、前の仕事の給与がある") {
                    NSPToggle(on: model.form.previousJob, disabled: !editable) { model.form.previousJob.toggle() }
                }
                if model.form.previousJob {
                    Text("前の仕事の源泉徴収票を出してください").font(.system(size: 13)).foregroundColor(NT.ink3)
                        .padding(.horizontal, 20).padding(.top, 8)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("基礎控除のメモ").font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink)
                    TextField("所得の見込み額や、伝えたいことがあれば", text: $model.form.note, axis: .vertical)
                        .lineLimit(3...8)
                        .font(.system(size: 16))
                        .disabled(!editable)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(editable ? Color.white : NFColor.lilacSoft))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
                }
                .padding(.horizontal, 20).padding(.vertical, 14)
            }
        }
    }

    private var ownButtons: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let e = model.formError { Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger) }
            HStack(spacing: 10) {
                Spacer()
                NPRButton(text: "下書き保存", busy: model.busy) { Task { await model.save(submit: false) } }
                NPRButton(text: "提出する", icon: "paperplane", kind: .primary, disabled: model.busy) { Task { await model.save(submit: true) } }
            }
        }
    }

    // MARK: 提出状況の確認（payroll.view_all。操作は payroll.manage）

    @ViewBuilder private func adminSection(_ p: NPRNenchoPayload) -> some View {
        HStack {
            Text("提出状況の確認（管理）").font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink)
            Spacer()
            statusFilter(p)
        }
        .padding(.top, 12)
        if p.adminRows.isEmpty {
            NPRCard(title: "申告", trailing: { EmptyView() }) { NPREmpty(title: "該当する申告はありません") }
        } else {
            VStack(spacing: 10) {
                ForEach(p.adminRows) { r in adminRow(r, canManage: p.canManage) }
            }
        }
    }

    private func statusFilter(_ p: NPRNenchoPayload) -> some View {
        let options: [(String, String)] = [("", "すべての状態"), ("submitted", "提出済み"), ("reviewing", "確認中"), ("needs_fix", "要修正"), ("confirmed", "確認済み")]
        let current = options.first { $0.0 == p.status }?.1 ?? "すべての状態"
        return Menu {
            ForEach(options, id: \.0) { o in
                Button(o.1) {
                    Task {
                        model.status = o.0
                        await model.load(resetForm: false)
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(current).font(.system(size: 15, weight: .bold))
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold))
            }
            .foregroundColor(NT.ink)
            .padding(.horizontal, 14).frame(height: 40)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    private func adminRow(_ r: NPRNenchoRow, canManage: Bool) -> some View {
        let open = expanded.contains(r.id)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    if open { expanded.remove(r.id) } else { expanded.insert(r.id) }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3).frame(width: 16)
                        Text(r.profileName).font(.system(size: 16, weight: .bold)).foregroundColor(NT.ink)
                        Text(verbatim: "\(r.year)年").font(.system(size: 13)).foregroundColor(NT.ink3)
                        NPBadge(text: NPRFmt.nenchoStatus[r.status] ?? r.status, color: NPRFmt.nenchoColor(r.status))
                        Text("提出 \(r.submittedLabel)").font(.system(size: 13)).foregroundColor(NT.ink3)
                        Spacer(minLength: 4)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if canManage { adminButtons(r) }
            }
            .padding(14)
            if open {
                Rectangle().fill(NT.line).frame(height: 1)
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("扶養家族").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                        if r.dependents.isEmpty { Text("なし").font(.system(size: 13)).foregroundColor(NT.ink3) }
                        ForEach(Array(r.dependents.enumerated()), id: \.offset) { _, d in
                            Text(d).font(.system(size: 14)).foregroundColor(NT.ink2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(r.lines.enumerated()), id: \.offset) { _, l in
                            Text(l.text)
                                .font(.system(size: l.tone == "muted" ? 12 : 14))
                                .foregroundColor(l.tone == "danger" ? NT.danger : l.tone == "muted" ? NT.ink3 : NT.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(16)
            }
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    @ViewBuilder private func adminButtons(_ r: NPRNenchoRow) -> some View {
        HStack(spacing: 8) {
            if r.status == "submitted" {
                NPRButton(text: "確認中にする", disabled: model.busy) { Task { await model.act(["type": "nenchoReviewing", "id": r.id]) } }
            }
            if r.status == "reviewing" {
                NPRButton(text: "確認済みにする", kind: .primary, disabled: model.busy) { Task { await model.act(["type": "nenchoConfirm", "id": r.id]) } }
            }
            if r.status == "submitted" || r.status == "reviewing" {
                NPRButton(text: "差し戻す", kind: .danger, disabled: model.busy) {
                    let id = r.id
                    prompt = NPReasonPrompt(title: "申告を差し戻す", message: "差し戻す理由を入れてください。本人が直して、もう一度出せるようになります。", confirm: "差し戻す") { reason in
                        await model.act(["type": "nenchoReject", "id": id, "note": reason])
                    }
                }
            }
        }
    }
}
