import SwiftUI

// 照合（売上・現金・在庫）のネイティブ。Web の /app/reconciliation と同じ中身（2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）:
//   期間（開始日・終了日）・店舗（本部だけ）で照合／全体の結果／売上照合（POS純売上・決済合計・仕訳売上・自動仕訳の未確定日）／
//   現金照合（理論現金・実現金・差異・差異のある日・締め履歴へ）／在庫照合（直近の棚卸の差異品目・差異金額）
// サーバーは lib/native-modules/reconciliation.ts（読み込みは Web と同じ lib/reconciliation-server.ts）。読むだけ。

// MARK: - 中身（サーバーの返事）

struct NReconOverall: Decodable {
    let status: String
    let label: String
    let message: String
}

struct NReconSalesRow: Decodable, Identifiable {
    let key: String
    let label: String
    let amount: Double
    let diff: String
    let mismatch: Bool
    let note: String
    let href: String
    var id: String { key }
}

struct NReconSales: Decodable {
    let status: String
    let label: String
    let rows: [NReconSalesRow]
    let unconfirmedDays: Int
}

struct NReconCashDay: Decodable, Identifiable {
    let id: String
    let dateLabel: String
    let storeName: String
    let expected: Double?
    let counted: Double?
    let differenceLabel: String
    let href: String
}

struct NReconCash: Decodable {
    let status: String
    let label: String
    let hasRows: Bool
    let expectedTotal: Double
    let countedTotal: Double
    let differenceTotal: Double
    let differenceLabel: String
    let diffDays: [NReconCashDay]
}

struct NReconInvRow: Decodable, Identifiable {
    let id: String
    let name: String
    let qtyLabel: String
    let short: Bool
    let unitCost: Double?
    let amountLabel: String
    let mismatch: Bool
}

struct NReconInventory: Decodable {
    let status: String
    let label: String
    let hasCounts: Bool
    let diffCount: Int
    let diffAmountTotal: Double
    let diffAmountLabel: String
    let rows: [NReconInvRow]
}

struct NReconPayload: Decodable {
    let ok: Bool
    let from: String
    let to: String
    let storeId: String
    let stores: [NInvOption]
    let description: String
    let noStores: Bool
    let overall: NReconOverall?
    let sales: NReconSales?
    let cash: NReconCash?
    let inventory: NReconInventory?
}

enum NReconText {
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
final class NReconModel: ObservableObject {
    @Published var payload: NReconPayload?
    @Published var error: String?
    @Published var toast: String?
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

    init(route: NativeModuleRoute) {
        apply(route: route)
    }

    func apply(route: NativeModuleRoute) {
        from = route.query("from") ?? ""
        to = route.query("to") ?? ""
        store = route.query("store") ?? ""
        payload = NativeModuleAPI.cached(NReconPayload.self, part: "reconciliation", query: query)
    }

    func load() async {
        let q = query
        do {
            let p = try await NativeModuleAPI.get(NReconPayload.self, part: "reconciliation", query: q)
            if q == query {
                payload = p
                // 実際の期間（開始＞終了の入れ替え・既定）を入力欄に
                from = p.from
                to = p.to
                store = p.storeId
            }
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }
}

// MARK: - 画面

struct NativeReconciliationView: View {
    let route: NativeModuleRoute
    let onHome: () -> Void
    /// ほかの画面（伝票・現金・自動仕訳・棚卸）へ。ネイティブがあればネイティブで開く
    let onWeb: (String) -> Void

    @StateObject private var model: NReconModel
    @State private var fromDraft = ""
    @State private var toDraft = ""
    @State private var storeDraft = ""

    init(route: NativeModuleRoute, onHome: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.route = route
        self.onHome = onHome
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NReconModel(route: route))
    }

    private var p: NReconPayload? { model.payload }

    var body: some View {
        NPRPage(title: "照合（売上・現金・在庫）", onBack: onHome, loaded: p != nil, error: model.error, toast: $model.toast, retry: { await model.load() }) {
            if let p { pageBody(p) }
        }
        .task {
            await model.load()
            await syncDrafts()
        }
        .onChange(of: route) { r in
            model.apply(route: r)
            Task {
                await model.load()
                syncDrafts()
            }
        }
    }

    @MainActor
    private func syncDrafts() {
        fromDraft = model.from
        toDraft = model.to
        storeDraft = model.store
    }

    private func run() {
        model.from = fromDraft
        model.to = toDraft
        model.store = storeDraft
        Task {
            await model.load()
            syncDrafts()
        }
    }

    @ViewBuilder private func pageBody(_ p: NReconPayload) -> some View {
        Text(p.description).font(.system(size: 13.5)).foregroundColor(NT.ink3)
        filterBar(p)
        if p.noStores {
            NAccCard {
                NPREmpty(title: "アクセス可能な店舗がありません", message: "管理者に店舗の割り当てを依頼してください")
            }
        } else {
            if let o = p.overall, let s = p.sales, let c = p.cash, let i = p.inventory {
                summary(o, s, c, i)
                salesCard(s, p)
                cashCard(c)
                inventoryCard(i)
            }
        }
    }

    private func filterBar(_ p: NReconPayload) -> some View {
        let dateFrom = Binding<Date>(get: { NPDate.date(fromDraft.isEmpty ? p.from : fromDraft) }, set: { fromDraft = NPDate.str($0) })
        let dateTo = Binding<Date>(get: { NPDate.date(toDraft.isEmpty ? p.to : toDraft) }, set: { toDraft = NPDate.str($0) })
        return NAccFilterBar {
            VStack(alignment: .leading, spacing: 4) {
                Text("開始日").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                DatePicker("", selection: dateFrom, displayedComponents: .date).labelsHidden()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("終了日").font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                DatePicker("", selection: dateTo, displayedComponents: .date).labelsHidden()
            }
            if !p.stores.isEmpty {
                NInvMenu(
                    label: "店舗",
                    options: [NInvChoice(value: "", label: "全社（全店舗）")] + p.stores.map { NInvChoice(value: $0.id, label: $0.name) },
                    selection: storeDraft
                ) { storeDraft = $0 }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(" ").font(.system(size: 12))
                NPRButton(text: "照合する", icon: "arrow.triangle.2.circlepath", kind: .primary) { run() }
            }
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    // MARK: サマリー

    private func summary(_ o: NReconOverall, _ s: NReconSales, _ c: NReconCash, _ i: NReconInventory) -> some View {
        let tone = NReconText.color(o.status)
        return HStack(spacing: 14) {
            Image(systemName: NReconText.icon(o.status)).font(.system(size: 22)).foregroundColor(tone)
            Text(o.message).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink)
            Spacer(minLength: 8)
            NPBadge(text: "売上照合: \(s.label)", color: NReconText.color(s.status))
            NPBadge(text: "現金照合: \(c.label)", color: NReconText.color(c.status))
            NPBadge(text: "在庫照合: \(i.label)", color: NReconText.color(i.status))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(o.status == "no_data" ? Color.white : tone.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(o.status == "no_data" ? NT.line : tone.opacity(0.3), lineWidth: 1))
    }

    // MARK: 売上照合

    private func salesCard(_ s: NReconSales, _ p: NReconPayload) -> some View {
        NPRCard(title: "売上照合（POS純売上 / 決済合計 / 仕訳売上）", trailing: {
            NPBadge(text: s.label, color: NReconText.color(s.status))
        }) {
            VStack(alignment: .leading, spacing: 0) {
                NAccTableHead(cells: [("指標", 170, false), ("金額", 130, true), ("POS純売上との差額", 160, true), ("定義", nil, false)])
                ForEach(s.rows) { r in
                    HStack(spacing: 10) {
                        Button { onWeb(r.href) } label: {
                            Text(r.label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).underline()
                                .frame(width: 170, alignment: .leading)
                        }
                        .buttonStyle(PressableStyle())
                        NAccCell(text: NInvText.yen(r.amount), width: 130, trailing: true, bold: r.key == "pos")
                        NAccCell(text: r.diff, width: 160, trailing: true, bold: r.mismatch, color: r.mismatch ? NT.danger : (r.key == "pos" ? NT.ink3 : NT.ink))
                        Text(r.note).font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                }
                if s.unconfirmedDays > 0 {
                    HStack(spacing: 10) {
                        Text("自動仕訳が未確定の日が\(s.unconfirmedDays)日あります（仕訳売上に反映されていません）")
                            .font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.warn)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        NPRButton(text: "自動仕訳ページへ") { onWeb("/app/accounting/auto") }
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.saffronSoft))
                    .padding(14)
                }
            }
        }
    }

    // MARK: 現金照合

    private func cashCard(_ c: NReconCash) -> some View {
        NPRCard(title: "現金照合（理論現金 / 実現金 / 差異）", trailing: {
            NPBadge(text: c.label, color: NReconText.color(c.status))
        }) {
            VStack(alignment: .leading, spacing: 12) {
                if !c.hasRows {
                    NPREmpty(title: "締め記録がありません", message: "この期間にレジ締め（daily_closings）の記録がありません")
                } else {
                    HStack(spacing: 12) {
                        NAccStat(label: "理論現金合計", value: Int(c.expectedTotal.rounded()))
                        NAccStat(label: "実現金合計", value: Int(c.countedTotal.rounded()))
                        NReconTile(label: "差異合計", text: c.differenceLabel, tone: c.differenceTotal != 0 ? NT.danger : NT.ink)
                    }
                    if c.diffDays.isEmpty {
                        Text("この期間に現金差異のある日はありません。").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                    } else {
                        Text("差異のある日（\(c.diffDays.count)日）").font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3)
                        NAccCard {
                            NAccTableHead(cells: [("営業日", 120, false), ("店舗", nil, false), ("理論現金", 120, true), ("実現金", 120, true), ("差異", 120, true), ("", 120, false)])
                            ForEach(c.diffDays) { r in
                                HStack(spacing: 10) {
                                    NAccCell(text: r.dateLabel, width: 120)
                                    NAccCell(text: r.storeName)
                                    NAccCell(text: NInvText.yen(r.expected), width: 120, trailing: true)
                                    NAccCell(text: NInvText.yen(r.counted), width: 120, trailing: true)
                                    NAccCell(text: r.differenceLabel, width: 120, trailing: true, bold: true, color: NT.danger)
                                    Button { onWeb(r.href) } label: {
                                        Text("締め履歴を見る").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purple)
                                    }
                                    .buttonStyle(PressableStyle())
                                    .frame(width: 120, alignment: .leading)
                                }
                                .padding(.horizontal, 16).padding(.vertical, 10)
                                .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                            }
                        }
                    }
                    Text("理論現金・実現金は締め時点のスナップショット（daily_closings）です。締めが未実行の日は集計に含まれません。")
                        .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(16)
        }
    }

    // MARK: 在庫照合

    private func inventoryCard(_ i: NReconInventory) -> some View {
        NPRCard(title: "在庫照合（直近の棚卸差異）", trailing: {
            NPBadge(text: i.label, color: NReconText.color(i.status))
        }) {
            VStack(alignment: .leading, spacing: 12) {
                if !i.hasCounts {
                    NPREmpty(title: "棚卸データがありません", message: "対象店舗で確定済みの棚卸がありません。「在庫」から棚卸を実施してください")
                    HStack {
                        Spacer()
                        NPRButton(text: "在庫（棚卸）へ") { onWeb("/app/inventory?tab=counts") }
                        Spacer()
                    }
                } else {
                    HStack(spacing: 12) {
                        NReconTile(label: "差異品目数", text: "\(i.diffCount)件", tone: i.diffCount > 0 ? NT.danger : NT.ink)
                        NReconTile(label: "差異金額合計（実数不足を正）", text: i.diffAmountLabel, tone: i.diffAmountTotal != 0 ? NT.danger : NT.ink)
                    }
                    if !i.rows.isEmpty {
                        NAccCard {
                            NAccTableHead(cells: [("品目", nil, false), ("差異数量", 130, true), ("単価", 120, true), ("差異金額", 140, true)])
                            ForEach(i.rows) { r in
                                HStack(spacing: 10) {
                                    NAccCell(text: r.name, bold: true)
                                    NAccCell(text: r.qtyLabel, width: 130, trailing: true, color: r.short ? NT.danger : NT.ok)
                                    NAccCell(text: NInvText.yen(r.unitCost), width: 120, trailing: true)
                                    NAccCell(text: r.amountLabel, width: 140, trailing: true, bold: true, color: r.mismatch ? NT.danger : NT.ink)
                                }
                                .padding(.horizontal, 16).padding(.vertical, 10)
                                .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
                            }
                        }
                    }
                    Text("各店舗の最新の確定済み棚卸を対象にしています（この照合ページの期間指定とは独立です）。差異金額は品目の現在平均単価で評価した参考値です。")
                        .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(16)
        }
    }
}

/// 文字のタイル（差異合計など、符号つきの金額）
struct NReconTile: View {
    let label: String
    let text: String
    var tone: Color = NT.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
            Text(text).font(.system(size: 24, weight: NT.strong)).monospacedDigit().foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.6)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}
