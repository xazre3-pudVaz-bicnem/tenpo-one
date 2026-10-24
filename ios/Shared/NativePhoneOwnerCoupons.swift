import SwiftUI

// iPhone の店長・オーナー：クーポン管理（ネイティブ）。Web の /app/coupons と同じ中身・同じ操作（2026-10-25 Ronnie「iPhone も native に」）
//   一覧（状態で絞り込み・探す・削除済みも見られる）・詳細（条件・利用履歴 → 伝票明細へ）・作成・編集（全項目・コードの自動生成）・停止・再開・削除（確かめてから）
// サーバーは iPad と同じ：GET part=coupons・couponUses（&id=）／ POST couponSave・couponStatus・couponCode（app/api/app/v1/pos/route.ts・lib/native-coupons.ts。menu.manage）

// MARK: - 中身（サーバーの返事。使うところだけ）

struct NPCPCoupon: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    /// fixed（円引き）／percent（%OFF）
    let kind: String
    let value: Double
    let storeId: String?
    let storeName: String?
    let targetCategoryId: String?
    let targetMenuItemId: String?
    let targetLabel: String?
    let minTotal: Double?
    let startsAt: String?
    let endsAt: String?
    let timeFrom: String?
    let timeTo: String?
    let maxUses: Int?
    let perCustomerLimit: Int?
    let firstVisitOnly: Bool?
    let stackable: Bool?
    /// active／paused／deleted
    let status: String
    let redemptionCount: Int?
}

struct NPCPPayload: Decodable {
    let rows: [NPCPCoupon]
    let stores: [NPOCOption]
    let categories: [NPOCOption]
    let items: [NPOCOption]
}

struct NPCPUse: Decodable, Identifiable, Hashable {
    let id: String
    let createdAt: String
    let orderId: String
    let customerName: String?
    let discountAmount: Double
}

struct NPCPUses: Decodable {
    let rows: [NPCPUse]
}

/// 名前・色・書き方（Web の coupons-panel と同じ）
enum NPCPText {
    static func status(_ s: String) -> String {
        switch s {
        case "active": return "有効"
        case "paused": return "停止中"
        case "deleted": return "削除済み"
        default: return s
        }
    }

    static func statusColor(_ s: String) -> Color {
        switch s {
        case "active": return NT.ok
        case "paused": return NT.warn
        default: return NT.ink3
        }
    }

    /// 10%OFF ／ ¥500引き
    static func value(_ c: NPCPCoupon) -> String {
        c.kind == "percent" ? "\(NPPYFmt.num(c.value))%OFF" : "\(NPPYFmt.yen(c.value))引き"
    }

    /// ISO → 日本時間の 2026/10/25（読めなければ nil）
    static func jstDay(_ iso: String?) -> String? {
        guard NPOCFmt.date(iso) != nil else { return nil }
        return NPOCFmt.day(iso)
    }

    /// 2026/10/01 〜 無期限
    static func period(_ c: NPCPCoupon) -> String {
        "\(jstDay(c.startsAt) ?? "—") 〜 \(jstDay(c.endsAt) ?? "無期限")"
    }

    /// 17:00〜21:00（無ければ nil）
    static func timeWindow(_ c: NPCPCoupon) -> String? {
        if c.timeFrom == nil && c.timeTo == nil { return nil }
        let a = c.timeFrom.map { String($0.prefix(5)) } ?? "—"
        let b = c.timeTo.map { String($0.prefix(5)) } ?? "—"
        return "\(a)〜\(b)"
    }

    /// 利用 12件 ／ 上限 100件（1人2件まで）
    static func usage(_ c: NPCPCoupon) -> String {
        var s = "利用 \(c.redemptionCount ?? 0)件"
        if let m = c.maxUses { s += " ／ 上限 \(m)件" }
        if let p = c.perCustomerLimit { s += "（1人\(p)件まで）" }
        return s
    }
}

// MARK: - 読み込み・操作

@MainActor
final class NPCPModel: ObservableObject {
    @Published var payload: NPCPPayload?
    @Published var toast: String?
    @Published var busy = false
    @Published var useWeb = false
    /// 開いているクーポン（一覧の中身から引く＝読み直すと新しい状態になる）
    @Published var detailId: String?
    @Published var uses: [String: [NPCPUse]] = [:]
    @Published var usesError: [String: String] = [:]

    init() {
        payload = NativeModuleAPI.cached(NPCPPayload.self, part: "coupons")
    }

    var detail: NPCPCoupon? {
        guard let id = detailId else { return nil }
        return payload?.rows.first { $0.id == id }
    }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            payload = try await NativeModuleAPI.get(NPCPPayload.self, part: "coupons")
        } catch {
            if (error as? NativeAPIError)?.useWeb == true || payload == nil { useWeb = true; return }
            toast = NativeModuleAPI.message(error)
        }
    }

    func reload() { Task { await load() } }

    /// 利用履歴（開いたときに読む。force は読み直し）
    func loadUses(_ id: String, force: Bool = false) async {
        if NativePreview.current != nil { return }
        if uses[id] != nil && !force { return }
        do {
            let u = try await NativeModuleAPI.get(NPCPUses.self, part: "couponUses", query: ["id": id])
            uses[id] = u.rows
            usesError[id] = nil
        } catch {
            usesError[id] = NativeModuleAPI.message(error)
        }
    }

    /// 停止・再開・削除
    func setStatus(_ c: NPCPCoupon, _ status: String) async {
        guard !busy else { return }
        let done = status == "paused" ? "クーポンを停止しました" : status == "active" ? "クーポンを再開しました" : "クーポンを削除しました"
        if NativePreview.current != nil {
            toast = done + "（見本）"
            return
        }
        busy = true
        do {
            try await NativeModuleAPI.post(["type": "couponStatus", "id": c.id, "status": status])
            toast = done
            await load()
        } catch {
            toast = NativeModuleAPI.message(error)
        }
        busy = false
    }
}

// MARK: - 画面（AppState につなぐ）

struct NativePhoneCouponsScreen: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model = NPCPModel()

    init(route: NativeModuleRoute) {}

    var body: some View {
        NativePhoneCouponsView(
            model: model,
            onBack: { state.closePhoneOwnerModule() },
            // 利用履歴の「伝票」→ 伝票明細（iPhone のネイティブがあればネイティブで）
            onOrder: { id in state.leaveNativePhone(to: "/app/orders/\(id)") }
        )
        .modifier(NPOCWebFallback(key: "coupons", useWeb: model.useWeb, state: state))
    }
}

/// 作成・編集のシート（coupon が nil なら作成）
struct NPCPFormRef: Identifiable {
    let id = UUID()
    let coupon: NPCPCoupon?
}

struct NativePhoneCouponsView: View {
    @ObservedObject var model: NPCPModel
    let onBack: () -> Void
    let onOrder: (String) -> Void
    /// live（有効・停止中）／active／paused／deleted／all
    @State private var filter = "live"
    @State private var query = ""
    @State private var form: NPCPFormRef?

    var body: some View {
        ZStack {
            NPOFrame(title: "クーポン", subtitle: "Coupons", onBack: onBack, trailing: {
                NPOCBarButton(icon: "plus", label: "作成") { form = NPCPFormRef(coupon: nil) }
            }) {
                NPOCBody(loaded: model.payload != nil, error: nil, retry: { await model.load() }) {
                    if let p = model.payload { list(p) }
                }
            }
            if let c = model.detail {
                NPCPDetailView(model: model, coupon: c, onEdit: { form = NPCPFormRef(coupon: c) }, onOrder: onOrder)
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.22), value: model.detailId)
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .sheet(item: $form) { f in
            if let p = model.payload {
                NPCPFormSheet(
                    coupon: f.coupon, payload: p,
                    onSaved: { message in
                        form = nil
                        model.toast = message
                        model.reload()
                    },
                    onClose: { form = nil }
                )
            }
        }
    }

    // MARK: 一覧

    private func rows(_ p: NPCPPayload) -> [NPCPCoupon] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return p.rows.filter { c in
            let okStatus: Bool
            switch filter {
            case "live": okStatus = c.status != "deleted"
            case "all": okStatus = true
            default: okStatus = c.status == filter
            }
            return okStatus && (q.isEmpty || c.code.lowercased().contains(q) || c.name.lowercased().contains(q))
        }
    }

    private func count(_ p: NPCPPayload, _ status: String) -> Int { p.rows.filter { $0.status == status }.count }

    @ViewBuilder private func list(_ p: NPCPPayload) -> some View {
        summary(p)
        searchField
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                NPOCChip(text: "有効・停止中", selected: filter == "live") { filter = "live" }
                NPOCChip(text: "有効（\(count(p, "active"))）", selected: filter == "active") { filter = "active" }
                NPOCChip(text: "停止中（\(count(p, "paused"))）", selected: filter == "paused") { filter = "paused" }
                NPOCChip(text: "削除済み（\(count(p, "deleted"))）", selected: filter == "deleted") { filter = "deleted" }
                NPOCChip(text: "すべて", selected: filter == "all") { filter = "all" }
            }
            .padding(.horizontal, 1)
        }
        let list = rows(p)
        if p.rows.isEmpty {
            NPOCEmpty(icon: "ticket", title: "クーポンが登録されていません", note: "右上の「作成」から、コード・割引・利用条件を登録できます")
        } else if list.isEmpty {
            NPOCEmpty(icon: "magnifyingglass", title: "該当するクーポンはありません")
        } else {
            ForEach(list) { c in row(c) }
        }
        Text("POS（レジ）でのクーポンの適用は会計の画面から行います").font(.system(size: 12)).foregroundColor(NT.ink3).padding(.horizontal, 4)
    }

    private func summary(_ p: NPCPPayload) -> some View {
        let live = p.rows.filter { $0.status != "deleted" }
        let used = live.reduce(0) { $0 + ($1.redemptionCount ?? 0) }
        return HStack(spacing: 0) {
            stat("有効", "\(count(p, "active"))件", NT.ok)
            stat("停止中", "\(count(p, "paused"))件", NT.warn)
            stat("利用（累計）", "\(used)件", NT.purpleDeep)
        }
        .padding(.vertical, 12)
        .background(npocCard())
    }

    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 19, weight: .heavy)).foregroundColor(color).monospacedDigit()
        }
        .frame(maxWidth: .infinity)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink3)
            TextField("コード・名称で探す", text: $query)
                .font(.system(size: 16))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("消す")
            }
        }
        .padding(.horizontal, 12).frame(height: 46)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func row(_ c: NPCPCoupon) -> some View {
        Button { model.detailId = c.id } label: {
            HStack(alignment: .top, spacing: 12) {
                NPCPValueTile(coupon: c, size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 6) {
                        Text(c.name).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        NWKBadge(text: NPCPText.status(c.status), color: NPCPText.statusColor(c.status))
                    }
                    Text(c.code).font(.system(size: 13.5, weight: .bold, design: .monospaced)).foregroundColor(NT.purpleDeep).lineLimit(1)
                    Text("\(c.storeName ?? "全店")｜\(c.targetLabel ?? "全体")\(c.firstVisitOnly == true ? "｜新規限定" : "")")
                        .font(.system(size: 12)).foregroundColor(NT.ink3).lineLimit(1)
                    HStack(spacing: 10) {
                        meta("calendar", NPCPText.period(c))
                        meta("person.2", "利用\(c.redemptionCount ?? 0)件")
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard())
            .opacity(c.status == "deleted" ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.985))
    }

    private func meta(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 10.5, weight: .semibold))
            Text(text).font(.system(size: 11.5, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .foregroundColor(NT.ink3)
    }
}

/// 値引きの大きな札（10% OFF ／ ¥500 引き）
struct NPCPValueTile: View {
    let coupon: NPCPCoupon
    var size: CGFloat = 64

    var body: some View {
        let percent = coupon.kind == "percent"
        let big = percent ? "\(NPPYFmt.num(coupon.value))%" : NPPYFmt.yen(coupon.value)
        return VStack(spacing: 0) {
            Text(big).font(.system(size: size * 0.29, weight: .heavy)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.5)
            Text(percent ? "OFF" : "引き").font(.system(size: size * 0.17, weight: .heavy)).foregroundColor(.white.opacity(0.85))
        }
        .padding(.horizontal, 4)
        .frame(width: size, height: size)
        .background(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous).fill(coupon.status == "active" ? NT.purple : NT.ink3))
    }
}

// MARK: - 詳細（条件・利用履歴・停止・再開・削除）

struct NPCPDetailView: View {
    @ObservedObject var model: NPCPModel
    let coupon: NPCPCoupon
    let onEdit: () -> Void
    let onOrder: (String) -> Void
    @State private var confirmDelete = false
    @State private var confirmPause = false

    var body: some View {
        NPOCDetailFrame(title: "クーポン", subtitle: coupon.code, backLabel: "一覧", onBack: { model.detailId = nil }, trailing: {
            if coupon.status != "deleted" {
                NPOCBarButton(icon: "pencil", label: "編集", action: onEdit)
            } else {
                Color.clear.frame(width: 40, height: 40)
            }
        }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    hero
                    actions
                    conditions
                    usesSection
                }
                .padding(14).padding(.bottom, 56)
            }
            .refreshable {
                await model.load()
                await model.loadUses(coupon.id, force: true)
            }
        }
        .task(id: coupon.id) { await model.loadUses(coupon.id) }
        .confirmationDialog("クーポンを削除", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("削除する", role: .destructive) { Task { await model.setStatus(coupon, "deleted") } }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("「\(coupon.name)」（\(coupon.code)）を削除します。過去の利用履歴は保持されます。")
        }
        .confirmationDialog("クーポンを停止", isPresented: $confirmPause, titleVisibility: .visible) {
            Button("停止する") { Task { await model.setStatus(coupon, "paused") } }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("停止中はレジで使えなくなります。あとで再開できます。")
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                NPCPValueTile(coupon: coupon, size: 84)
                VStack(alignment: .leading, spacing: 6) {
                    NWKBadge(text: NPCPText.status(coupon.status), color: NPCPText.statusColor(coupon.status))
                    Text(coupon.name).font(.system(size: 19, weight: .heavy)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    Text(NPCPText.value(coupon)).font(.system(size: 14, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
            }
            HStack(spacing: 8) {
                Text(coupon.code).font(.system(size: 18, weight: .heavy, design: .monospaced)).foregroundColor(NT.ink)
                    .textSelection(.enabled)
                Spacer(minLength: 6)
                Button {
                    UIPasteboard.general.string = coupon.code
                    model.toast = "コードをコピーしました"
                } label: {
                    Label("コピー", systemImage: "doc.on.doc").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
    }

    @ViewBuilder private var actions: some View {
        if coupon.status != "deleted" {
            VStack(spacing: 8) {
                if coupon.status == "active" {
                    NPOCWideButton(text: "停止する", icon: "pause.fill", kind: .secondary, busy: model.busy, height: 48) { confirmPause = true }
                } else if coupon.status == "paused" {
                    NPOCWideButton(text: "再開する", icon: "play.fill", kind: .success, busy: model.busy, height: 48) {
                        Task { await model.setStatus(coupon, "active") }
                    }
                }
                NPOCWideButton(text: "削除する", icon: "trash", kind: .danger, disabled: model.busy, height: 46) { confirmDelete = true }
            }
        } else {
            HStack(spacing: 8) {
                Image(systemName: "trash.slash").font(.system(size: 13, weight: .bold))
                Text("削除済みのクーポンです（利用履歴は残っています）").font(.system(size: 13.5, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundColor(NT.ink2)
            .padding(12)
            .background(npocCard(12))
        }
    }

    private var conditions: some View {
        let c = coupon
        var rows: [(String, String)] = [
            ("対象店舗", c.storeName ?? "全店"),
            ("対象", c.targetLabel ?? "全体"),
            ("最低利用額", (c.minTotal ?? 0) > 0 ? NPPYFmt.yen(c.minTotal) : "なし"),
            ("期間", NPCPText.period(c)),
        ]
        if let t = NPCPText.timeWindow(c) { rows.append(("利用できる時間帯", t)) }
        rows.append(("利用上限（全体）", c.maxUses.map { "\($0)件" } ?? "無制限"))
        rows.append(("顧客ごとの上限", c.perCustomerLimit.map { "\($0)件" } ?? "無制限"))
        rows.append(("新規顧客限定", c.firstVisitOnly == true ? "はい" : "いいえ"))
        rows.append(("他の値引きと併用", c.stackable == true ? "できる" : "できない"))
        let list = rows
        return VStack(alignment: .leading, spacing: 0) {
            Text("利用条件").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.ink).padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 6)
            ForEach(Array(list.enumerated()), id: \.offset) { i, r in
                if i > 0 { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14) }
                HStack(alignment: .top, spacing: 10) {
                    Text(r.0).font(.system(size: 13.5)).foregroundColor(NT.ink3).frame(width: 112, alignment: .leading)
                    Text(r.1).font(.system(size: 14.5, weight: .semibold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 11)
            }
        }
        .padding(.bottom, 4)
        .background(npocCard())
    }

    @ViewBuilder private var usesSection: some View {
        NPOCSectionTitle(title: "利用履歴（\(coupon.redemptionCount ?? 0)件）", note: "押すとその伝票の明細を開きます（新しい順・200件まで）")
        if let list = model.uses[coupon.id] {
            if list.isEmpty {
                NPOCEmpty(icon: "clock", title: "利用履歴はありません")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { i, u in
                        if i > 0 { Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14) }
                        Button { onOrder(u.orderId) } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(NWKFmt.dateTime(u.createdAt)).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink)
                                    Text(u.customerName ?? "—").font(.system(size: 12.5)).foregroundColor(NT.ink3).lineLimit(1)
                                }
                                Spacer(minLength: 6)
                                Text("−\(NPPYFmt.yen(u.discountAmount))").font(.system(size: 15, weight: .heavy)).foregroundColor(NT.danger).monospacedDigit()
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(npocCard())
            }
        } else if let e = model.usesError[coupon.id] {
            VStack(spacing: 10) {
                Text(e).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                NPOCWideButton(text: "もう一度読む", icon: "arrow.clockwise", kind: .secondary, height: 44) {
                    Task { await model.loadUses(coupon.id, force: true) }
                }
            }
            .padding(14)
            .background(npocCard())
        } else {
            HStack {
                Spacer()
                ProgressView().tint(NT.purple)
                Spacer()
            }
            .padding(.vertical, 24)
            .background(npocCard())
        }
    }
}

// MARK: - 作成・編集（Web の CouponDialog と同じ全項目）

struct NPCPFormSheet: View {
    let coupon: NPCPCoupon?
    let payload: NPCPPayload
    let onSaved: (String) -> Void
    let onClose: () -> Void

    @State private var code: String
    @State private var name: String
    @State private var kind: String
    @State private var value: String
    @State private var minTotal: String
    @State private var storeId: String
    @State private var targetMode: String
    @State private var categoryId: String
    @State private var itemId: String
    @State private var hasStart: Bool
    @State private var startsAt: Date
    @State private var hasEnd: Bool
    @State private var endsAt: Date
    @State private var timeFrom: String
    @State private var timeTo: String
    @State private var maxUses: String
    @State private var perCustomer: String
    @State private var firstVisitOnly: Bool
    @State private var stackable: Bool
    @State private var generating = false
    @State private var saving = false
    @State private var error: String?

    init(coupon: NPCPCoupon?, payload: NPCPPayload, onSaved: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.coupon = coupon
        self.payload = payload
        self.onSaved = onSaved
        self.onClose = onClose
        let start = NPOCFmt.date(coupon?.startsAt)
        let end = NPOCFmt.date(coupon?.endsAt)
        _code = State(initialValue: coupon?.code ?? "")
        _name = State(initialValue: coupon?.name ?? "")
        _kind = State(initialValue: coupon?.kind ?? "fixed")
        _value = State(initialValue: NPPYFmt.num(coupon?.value))
        _minTotal = State(initialValue: NPPYFmt.num(coupon?.minTotal ?? 0))
        _storeId = State(initialValue: coupon?.storeId ?? "")
        _targetMode = State(initialValue: coupon?.targetCategoryId != nil ? "category" : (coupon?.targetMenuItemId != nil ? "item" : "none"))
        _categoryId = State(initialValue: coupon?.targetCategoryId ?? "")
        _itemId = State(initialValue: coupon?.targetMenuItemId ?? "")
        _hasStart = State(initialValue: start != nil)
        _startsAt = State(initialValue: start ?? Date())
        _hasEnd = State(initialValue: end != nil)
        _endsAt = State(initialValue: end ?? Date().addingTimeInterval(30 * 24 * 3600))
        _timeFrom = State(initialValue: coupon?.timeFrom.map { String($0.prefix(5)) } ?? "")
        _timeTo = State(initialValue: coupon?.timeTo.map { String($0.prefix(5)) } ?? "")
        _maxUses = State(initialValue: coupon?.maxUses.map { String($0) } ?? "")
        _perCustomer = State(initialValue: coupon?.perCustomerLimit.map { String($0) } ?? "")
        _firstVisitOnly = State(initialValue: coupon?.firstVisitOnly ?? false)
        _stackable = State(initialValue: coupon?.stackable ?? false)
    }

    private var codeBinding: Binding<String> {
        Binding(get: { code }, set: { code = $0.uppercased() })
    }

    var body: some View {
        NPOCSheetFrame(title: coupon == nil ? "クーポンを作成" : "クーポンを編集", confirmText: saving ? "保存中…" : "保存する", busy: saving,
                       onCancel: onClose, onConfirm: { save() }) {
            NPOCField(label: "コード（英数字とハイフン）") {
                HStack(spacing: 8) {
                    TextField("SUMMER10", text: codeBinding)
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .npocInputBox()
                    Button { generate() } label: {
                        HStack(spacing: 5) {
                            if generating { ProgressView().tint(NT.purpleDeep) } else { Image(systemName: "wand.and.stars") }
                            Text("自動生成")
                        }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(NT.purpleDeep)
                        .padding(.horizontal, 12).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(generating)
                }
            }
            NPOCField(label: "名称") {
                TextField("例：サマーセール10%OFF", text: $name).font(.system(size: 16)).npocInputBox()
            }
            NPOCField(label: "割引") {
                VStack(spacing: 10) {
                    Picker("種別", selection: $kind) {
                        Text("固定額（円）").tag("fixed")
                        Text("割引率（%）").tag("percent")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    NPPYFormGroup {
                        NPPYNumberRow(label: kind == "percent" ? "割引率" : "値引き額", text: $value, unit: kind == "percent" ? "%" : "円", decimal: kind == "percent")
                        NPPYFormDivider()
                        NPPYNumberRow(label: "最低利用額", text: $minTotal, unit: "円")
                    }
                }
            }
            NPOCField(label: "対象") {
                VStack(spacing: 10) {
                    NPPYFormGroup {
                        NPPYPickRow(label: "対象店舗", options: [("", "全店")] + payload.stores.map { ($0.id, $0.name) }, selection: $storeId)
                    }
                    Picker("対象", selection: $targetMode) {
                        Text("全体").tag("none")
                        Text("カテゴリ").tag("category")
                        Text("商品").tag("item")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    if targetMode == "category" {
                        NPPYFormGroup {
                            NPPYPickRow(label: "カテゴリ", options: [("", "選択してください")] + payload.categories.map { ($0.id, $0.name) }, selection: $categoryId)
                        }
                    }
                    if targetMode == "item" {
                        NPPYFormGroup {
                            NPPYPickRow(label: "商品", options: [("", "選択してください")] + payload.items.map { ($0.id, $0.name) }, selection: $itemId)
                        }
                    }
                }
            }
            NPOCField(label: "期間（空なら無期限）") {
                NPPYFormGroup {
                    dateToggle("開始日時を決める", on: $hasStart, date: $startsAt)
                    NPPYFormDivider()
                    dateToggle("終了日時を決める", on: $hasEnd, date: $endsAt)
                }
            }
            NPOCField(label: "利用できる時間帯（空なら終日）") {
                NPPYFormGroup {
                    timeRow("開始", value: $timeFrom, fallback: "17:00")
                    NPPYFormDivider()
                    timeRow("終了", value: $timeTo, fallback: "22:00")
                }
            }
            NPOCField(label: "利用上限（空欄で無制限）") {
                NPPYFormGroup {
                    NPPYNumberRow(label: "全体の回数", text: $maxUses, unit: "回", placeholder: "無制限")
                    NPPYFormDivider()
                    NPPYNumberRow(label: "顧客ごとの回数", text: $perCustomer, unit: "回", placeholder: "無制限")
                }
            }
            NPOCField(label: "その他") {
                NPPYFormGroup {
                    Toggle(isOn: $firstVisitOnly) {
                        Text("新規顧客限定").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                    }
                    .tint(NT.purple)
                    .npocRow()
                    NPPYFormDivider()
                    Toggle(isOn: $stackable) {
                        Text("他の値引きと併用できる").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
                    }
                    .tint(NT.purple)
                    .npocRow()
                }
            }
            if let error {
                Text(error).font(.system(size: 14, weight: .bold)).foregroundColor(NT.danger).padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private func dateToggle(_ label: String, on: Binding<Bool>, date: Binding<Date>) -> some View {
        Toggle(isOn: on) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
        }
        .tint(NT.purple)
        .npocRow()
        if on.wrappedValue {
            DatePicker("日時", selection: date, displayedComponents: [.date, .hourAndMinute])
                .font(.system(size: 15))
                .foregroundColor(NT.ink2)
                .environment(\.locale, Locale(identifier: "ja_JP"))
                .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo") ?? TimeZone.current)
                .npocRow()
        }
    }

    @ViewBuilder private func timeRow(_ label: String, value: Binding<String>, fallback: String) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink)
            Spacer(minLength: 8)
            if value.wrappedValue.isEmpty {
                Button { value.wrappedValue = fallback } label: {
                    Label("決める", systemImage: "clock").font(.system(size: 14, weight: .bold)).foregroundColor(NT.purple)
                }
                .buttonStyle(.plain)
            } else {
                DatePicker("", selection: Binding(get: { Self.hmDate(value.wrappedValue) }, set: { value.wrappedValue = Self.hm($0) }), displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .environment(\.locale, Locale(identifier: "ja_JP"))
                Button { value.wrappedValue = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 19)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("消す")
            }
        }
        .npocRow()
    }

    static func hmDate(_ s: String) -> Date {
        let p = s.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 0, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }

    static func hm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private func generate() {
        if NativePreview.current != nil {
            code = "TENPO-2026"
            return
        }
        generating = true
        Task {
            do {
                let r = try await NativeModuleAPI.post(["type": "couponCode"])
                if let c = r.id { code = c } else { error = "コードを作れませんでした" }
            } catch {
                self.error = NativeModuleAPI.message(error)
            }
            generating = false
        }
    }

    /// 空欄は null（無制限）。数でなければ null、大きすぎる数はサーバーが断る
    private static func intOrNull(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let v = NOS.num(t), v.isFinite, abs(v) < 1e12 else { return NSNull() }
        return Int(v)
    }

    private func save() {
        error = nil
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var body: [String: Any] = [:]
        body["type"] = "couponSave"
        body["code"] = code
        body["name"] = name
        body["kind"] = kind
        body["value"] = NOS.num(value) ?? 0
        body["storeId"] = NPPYFmt.orNull(storeId.isEmpty ? nil : storeId)
        body["targetCategoryId"] = NPPYFmt.orNull(targetMode == "category" && !categoryId.isEmpty ? categoryId : nil)
        body["targetMenuItemId"] = NPPYFmt.orNull(targetMode == "item" && !itemId.isEmpty ? itemId : nil)
        body["minTotal"] = NOS.num(minTotal) ?? 0
        body["startsAt"] = NPPYFmt.orNull(hasStart ? f.string(from: startsAt) : nil)
        body["endsAt"] = NPPYFmt.orNull(hasEnd ? f.string(from: endsAt) : nil)
        body["timeFrom"] = NPPYFmt.orNull(timeFrom.isEmpty ? nil : timeFrom)
        body["timeTo"] = NPPYFmt.orNull(timeTo.isEmpty ? nil : timeTo)
        body["maxUses"] = Self.intOrNull(maxUses)
        body["perCustomerLimit"] = Self.intOrNull(perCustomer)
        body["firstVisitOnly"] = firstVisitOnly
        body["stackable"] = stackable
        if let c = coupon { body["id"] = c.id }
        let isNew = coupon == nil
        if NativePreview.current != nil {
            onSaved(isNew ? "クーポンを作成しました（見本）" : "クーポンを更新しました（見本）")
            return
        }
        saving = true
        let request = body
        Task {
            do {
                try await NativeModuleAPI.post(request)
                saving = false
                onSaved(isNew ? "クーポンを作成しました" : "クーポンを更新しました")
            } catch {
                saving = false
                self.error = NativeModuleAPI.message(error)
            }
        }
    }
}
