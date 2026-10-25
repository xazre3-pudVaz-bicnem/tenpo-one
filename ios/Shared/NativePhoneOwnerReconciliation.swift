import SwiftUI

// iPhone の店長・オーナー：照合（売上・現金・在庫）（ネイティブ）。Web の /app/reconciliation と同じ中身（2026-10-25 Ronnie「101% native」）:
//   期間（今月・先月・過去30日 …）・店舗（本部だけ）を変えるとすぐ照合／全体の結果／売上照合（POS純売上・決済合計・仕訳売上・自動仕訳の未確定日）／
//   現金照合（理論現金・実現金・差異・差異のある日 → 締め履歴）／在庫照合（直近の棚卸の差異品目・差異金額）
// サーバーは iPad と同じ GET part=reconciliation&from=&to=&store=（lib/native-modules/reconciliation.ts。読むだけ・返事の形は変えない）。

// MARK: - 中身（サーバーの返事）

struct NPRXStore: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct NPRXOverall: Decodable {
    let status: String
    let label: String
    let message: String
}

struct NPRXSalesRow: Decodable, Identifiable {
    let key: String
    let label: String
    let amount: Double
    let diff: String
    let mismatch: Bool
    let note: String
    let href: String
    var id: String { key }
}

struct NPRXSales: Decodable {
    let status: String
    let label: String
    let rows: [NPRXSalesRow]
    let unconfirmedDays: Int
}

struct NPRXCashDay: Decodable, Identifiable {
    let id: String
    let dateLabel: String
    let storeName: String
    let expected: Double?
    let counted: Double?
    let differenceLabel: String
    let href: String
}

struct NPRXCash: Decodable {
    let status: String
    let label: String
    let hasRows: Bool
    let expectedTotal: Double
    let countedTotal: Double
    let differenceTotal: Double
    let differenceLabel: String
    let diffDays: [NPRXCashDay]
}

struct NPRXInvRow: Decodable, Identifiable {
    let id: String
    let name: String
    let qtyLabel: String
    let short: Bool
    let unitCost: Double?
    let amountLabel: String
    let mismatch: Bool
}

struct NPRXInventory: Decodable {
    let status: String
    let label: String
    let hasCounts: Bool
    let diffCount: Int
    let diffAmountTotal: Double
    let diffAmountLabel: String
    let rows: [NPRXInvRow]
}

struct NPRXPayload: Decodable {
    let from: String
    let to: String
    let storeId: String
    let stores: [NPRXStore]
    let description: String
    let noStores: Bool
    let overall: NPRXOverall?
    let sales: NPRXSales?
    let cash: NPRXCash?
    let inventory: NPRXInventory?
}

enum NPRXText {
    static func color(_ status: String) -> Color {
        switch status {
        case "ok": return NT.ok
        case "mismatch": return NT.danger
        default: return NT.ink3
        }
    }

    static func icon(_ status: String) -> String {
        switch status {
        case "ok": return "checkmark.circle.fill"
        case "mismatch": return "exclamationmark.triangle.fill"
        default: return "minus.circle"
        }
    }
}

// MARK: - 読み込み

@MainActor
final class NPRXModel: ObservableObject {
    @Published var payload: NPRXPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var loading = false
    /// 最初の読み込みで「Web で」と言われた → この画面を閉じて裏の Web を見せる
    @Published var useWeb = false
    /// 照合の条件（空は Web と同じ既定：直近7日・本部は全社）
    @Published var from = ""
    @Published var to = ""
    @Published var store = ""

    var query: [String: String] {
        var q: [String: String] = [:]
        if !from.isEmpty { q["from"] = from }
        if !to.isEmpty { q["to"] = to }
        if !store.isEmpty { q["store"] = store }
        return q
    }

    init(route: NativeModuleRoute? = nil) {
        if let route {
            from = route.query("from") ?? ""
            to = route.query("to") ?? ""
            store = route.query("store") ?? ""
        }
        payload = NativeModuleAPI.cached(NPRXPayload.self, part: "reconciliation", query: query)
    }

    func load() async {
        let q = query
        if NativePreview.current != nil {
            if let o = NPACSamples.object("reconciliation", q), let p = NOS.decode(NPRXPayload.self, o) {
                payload = p
                from = p.from
                to = p.to
            }
            return
        }
        loading = true
        defer { loading = false }
        do {
            let p = try await NativeModuleAPI.get(NPRXPayload.self, part: "reconciliation", query: q)
            if q == query {
                payload = p
                // 実際の期間（開始＞終了の入れ替え・既定）を条件に
                from = p.from
                to = p.to
                store = p.storeId
            }
            error = nil
        } catch {
            if payload == nil && NPACText.wantsWeb(error) { useWeb = true }
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }
}

// MARK: - 画面

/// key "reconciliation" の画面（NativePhoneOwnerScreen から）
struct NativePhoneReconciliationScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @State private var useWeb = false

    var body: some View {
        NPRXRootView(route: route, onBack: { state.closePhoneOwnerModule() }, onLeave: { NPOCLink.open($0, state: state) }, onWeb: { useWeb = true })
            .modifier(NPOCWebFallback(key: "reconciliation", useWeb: useWeb, state: state))
    }
}

struct NPRXRootView: View {
    let onBack: () -> Void
    /// ほかの画面（伝票・現金・自動仕訳・棚卸）へ。ネイティブがあればネイティブで開く
    let onLeave: (String) -> Void
    let onWeb: () -> Void

    @StateObject private var model: NPRXModel

    init(route: NativeModuleRoute, onBack: @escaping () -> Void, onLeave: @escaping (String) -> Void, onWeb: @escaping () -> Void = {}) {
        self.onBack = onBack
        self.onLeave = onLeave
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NPRXModel(route: route))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "照合", subtitle: "売上・現金・在庫", onBack: onBack, trailing: {
                NOMRefreshButton(loading: model.loading) { Task { await model.load() } }
            }) {
                if let p = model.payload {
                    content(p)
                } else {
                    NOSStateView(error: model.error) { Task { await model.load() } }
                }
            }
            NPHToast(text: $model.toast)
        }
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "ja_JP"))
        .task { await model.load() }
        .onChange(of: model.useWeb) { on in if on { onWeb() } }
    }

    private func run() { Task { await model.load() } }

    private func content(_ p: NPRXPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(p.description).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3).padding(.horizontal, 4)
                NPACPeriodBar(from: p.from, to: p.to) { a, b in
                    model.from = a
                    model.to = b
                    run()
                }
                if !p.stores.isEmpty {
                    NPACMenuRow {
                        NPOCMenuChip(label: "店舗", options: [("", "全社（全店舗）")] + p.stores.map { ($0.id, $0.name) }, selection: p.storeId) { v in
                            model.store = v
                            run()
                        }
                    }
                }
                if p.noStores {
                    NPOCEmpty(icon: "storefront", title: "アクセス可能な店舗がありません", note: "管理者に店舗の割り当てを依頼してください")
                } else if let o = p.overall, let s = p.sales, let c = p.cash, let i = p.inventory {
                    summary(o, s, c, i)
                    salesCard(s)
                    cashCard(c)
                    inventoryCard(i)
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 60)
        }
        .refreshable { await model.load() }
    }

    // MARK: 全体

    private func summary(_ o: NPRXOverall, _ s: NPRXSales, _ c: NPRXCash, _ i: NPRXInventory) -> some View {
        let tone = NPRXText.color(o.status)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: NPRXText.icon(o.status)).font(.system(size: 24)).foregroundColor(tone)
                Text(o.message).font(.system(size: 15.5, weight: .heavy)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            WrapLayout(spacing: 6) {
                NOSBadge(text: "売上照合：\(s.label)", color: NPRXText.color(s.status))
                NOSBadge(text: "現金照合：\(c.label)", color: NPRXText.color(c.status))
                NOSBadge(text: "在庫照合：\(i.label)", color: NPRXText.color(i.status))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(o.status == "no_data" ? Color.white : tone.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(o.status == "no_data" ? Color.clear : tone.opacity(0.3), lineWidth: 1))
    }

    // MARK: 売上照合

    private func salesCard(_ s: NPRXSales) -> some View {
        NPOCard(title: "売上照合", trailing: s.label) {
            Text("POS純売上 / 決済合計 / 仕訳売上").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            ForEach(s.rows) { r in
                Button { onLeave(r.href) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(r.label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).underline()
                            Spacer(minLength: 6)
                            Text(NPIVText.yen(r.amount)).font(.system(size: 15.5, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
                        }
                        HStack(spacing: 6) {
                            Text("POS純売上との差額").font(.system(size: 11)).foregroundColor(NT.ink3)
                            Text(r.diff).font(.system(size: 12.5, weight: r.mismatch ? .heavy : .semibold)).monospacedDigit()
                                .foregroundColor(r.mismatch ? NT.danger : (r.key == "pos" ? NT.ink3 : NT.ink))
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3)
                        }
                        Text(r.note).font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(r.mismatch ? NT.dangerBg : NT.page))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if s.unconfirmedDays > 0 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("自動仕訳が未確定の日が\(s.unconfirmedDays)日あります（仕訳売上に反映されていません）")
                        .font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.warn).fixedSize(horizontal: false, vertical: true)
                    NPACPill(title: "自動仕訳へ", icon: "wand.and.stars", tint: NT.warn) { onLeave("/app/accounting/auto") }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.warn.opacity(0.1)))
            }
        }
    }

    // MARK: 現金照合

    private func cashCard(_ c: NPRXCash) -> some View {
        NPOCard(title: "現金照合", trailing: c.label) {
            if !c.hasRows {
                Text("この期間にレジ締め（daily_closings）の記録がありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                HStack(spacing: 6) {
                    NOMStat(label: "理論現金合計", value: NPIVText.yen(c.expectedTotal))
                    NOMStat(label: "実現金合計", value: NPIVText.yen(c.countedTotal))
                    NOMStat(label: "差異合計", value: c.differenceLabel, tone: c.differenceTotal != 0 ? NT.danger : NT.ink)
                }
                if c.diffDays.isEmpty {
                    Text("この期間に現金差異のある日はありません。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                } else {
                    Text("差異のある日（\(c.diffDays.count)日）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                    ForEach(c.diffDays) { r in
                        Button { onLeave(r.href) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text(r.dateLabel).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                                    Text(r.storeName).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(r.differenceLabel).font(.system(size: 14.5, weight: .heavy)).foregroundColor(NT.danger).monospacedDigit()
                                }
                                HStack(spacing: 10) {
                                    Text("理論 \(NPIVText.yen(r.expected))")
                                    Text("実 \(NPIVText.yen(r.counted))")
                                    Spacer(minLength: 0)
                                    Text("締め履歴 ›").foregroundColor(NT.purpleDeep).fontWeight(.bold)
                                }
                                .font(.system(size: 11.5)).foregroundColor(NT.ink2).monospacedDigit()
                            }
                            .padding(10)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("理論現金・実現金は締め時点のスナップショット（daily_closings）です。締めが未実行の日は集計に含まれません。")
                    .font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: 在庫照合

    private func inventoryCard(_ i: NPRXInventory) -> some View {
        NPOCard(title: "在庫照合（直近の棚卸差異）", trailing: i.label) {
            if !i.hasCounts {
                Text("対象店舗で確定済みの棚卸がありません。「在庫」から棚卸を実施してください。").font(.system(size: 13)).foregroundColor(NT.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                NPACPill(title: "在庫（棚卸）へ", icon: "shippingbox") { onLeave("/app/inventory?tab=counts") }
            } else {
                HStack(spacing: 6) {
                    NOMStat(label: "差異品目数", value: "\(i.diffCount)件", tone: i.diffCount > 0 ? NT.danger : NT.ink)
                    NOMStat(label: "差異金額合計", value: i.diffAmountLabel, tone: i.diffAmountTotal != 0 ? NT.danger : NT.ink, sub: "実数不足を正")
                }
                ForEach(i.rows) { r in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.name).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
                            Text("単価 \(NPIVText.yen(r.unitCost))").font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit()
                        }
                        Spacer(minLength: 6)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(r.qtyLabel).font(.system(size: 13, weight: .bold)).foregroundColor(r.short ? NT.danger : NT.ok).monospacedDigit()
                            Text(r.amountLabel).font(.system(size: 13.5, weight: .heavy)).foregroundColor(r.mismatch ? NT.danger : NT.ink).monospacedDigit()
                        }
                    }
                    .padding(.vertical, 4)
                    NPACDivider()
                }
                Text("各店舗の最新の確定済み棚卸を対象にしています（この照合の期間とは別です）。差異金額は品目の現在平均単価で評価した参考値です。")
                    .font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
