import SwiftUI

// 顧客台帳の「RFM分析」「重複候補」（ネイティブ）。Web の /app/customers?view=rfm|duplicates と同じ（2026-10-24）

struct NCRScore: Codable, Hashable { let recency: Int; let frequency: Int; let monetary: Int; let rank: String; let rankLabel: String }
struct NCRCustomer: Codable, Identifiable, Hashable { let id: String; let name: String; let phone: String?; let visitCount: Int; let totalSpent: Int; let lastVisitAt: String?; let rfm: NCRScore }
struct NCRPayload: Codable { let customers: [NCRCustomer] }
struct NCDupCandidate: Codable, Identifiable, Hashable { let id: String; let name: String; let phone: String?; let email: String?; let visitCount: Int; let totalSpent: Int; let lastVisitAt: String? }
struct NCDupGroup: Codable, Identifiable, Hashable { var id: String { "\(matchType)-\(key)" }; let key: String; let matchType: String; let customers: [NCDupCandidate] }
struct NCDupPayload: Codable { let groups: [NCDupGroup]; let canMerge: Bool }

/// 一覧・RFM分析・重複候補のタブ（Web の CustomerTabs と同じ）
struct NCTabs: View {
    @Binding var view: String
    var body: some View {
        HStack(spacing: 4) {
            ForEach([("list", "顧客一覧"), ("rfm", "RFM分析"), ("duplicates", "重複候補")], id: \.0) { t in
                Button { view = t.0 } label: {
                    Text(t.1).font(.system(size: 14, weight: .bold)).foregroundColor(view == t.0 ? .white : NFColor.ink2)
                        .frame(maxWidth: .infinity).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(view == t.0 ? NFColor.navy : Color.clear))
                }.buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }
}

enum NCRank {
    static let ranks = ["S", "A", "B", "C", "D"]
    static func tone(_ r: String) -> Color { NCTone.color(["S": "navy", "A": "success", "B": "primary", "C": "warning", "D": "danger"][r] ?? "gray") }
    /// M（平均累計利用額）の段階色（Web の HEAT_STEPS と同じ）
    static let heat: [UInt32] = [0xF6E4DA, 0xEFCDBD, 0xF0A080, 0xC86B51, 0xBC5940, 0x9F4630]
    static func heatStyle(_ avg: Double, _ maxAvg: Double) -> (Color, Color) {
        guard avg > 0, maxAvg > 0 else { return (Color(hex: 0xF9FAFB), Color(hex: 0x9CA3AF)) }
        let ratio = min(1, avg / maxAvg)
        let idx = max(1, min(heat.count - 1, Int((ratio * Double(heat.count - 1)).rounded(.up))))
        return (Color(hex: heat[idx]), idx >= 4 ? .white : Color(hex: 0x292725))
    }
}

struct NCRfmView: View {
    @ObservedObject var list: NativeCustomersModel
    let onOpen: (String) -> Void
    @State private var customers: [NCRCustomer]?
    @State private var selected: (Int, Int)?

    var body: some View {
        Group {
            if let cs = customers {
                if cs.isEmpty {
                    niEmpty("分析対象の顧客がいません", "来店実績のある顧客が登録されるとRFM分析が表示されます")
                } else { content(cs) }
            } else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60) }
        }
        .task {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "customerRfm")]
            do {
                let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
                customers = try JSONDecoder().decode(NCRPayload.self, from: data).customers
            } catch { list.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"; customers = [] }
        }
    }

    private func content(_ cs: [NCRCustomer]) -> some View {
        var count = Array(repeating: Array(repeating: 0, count: 5), count: 5)
        var money = Array(repeating: Array(repeating: 0.0, count: 5), count: 5)
        for c in cs where (1...5).contains(c.rfm.recency) && (1...5).contains(c.rfm.frequency) {
            count[c.rfm.recency - 1][c.rfm.frequency - 1] += 1
            money[c.rfm.recency - 1][c.rfm.frequency - 1] += Double(c.totalSpent)
        }
        let avg = (0..<5).map { r in (0..<5).map { f in count[r][f] > 0 ? money[r][f] / Double(count[r][f]) : 0 } }
        let maxAvg = avg.flatMap { $0 }.max() ?? 0
        let total = Double(cs.reduce(0) { $0 + $1.totalSpent })
        let summary = NCRank.ranks.map { rank -> (String, Int, Int, Double) in
            let rows = cs.filter { $0.rfm.rank == rank }
            let sales = rows.reduce(0) { $0 + $1.totalSpent }
            return (rank, rows.count, sales, total > 0 ? Double(sales) / total * 100 : 0)
        }
        let picked = selected.map { s in cs.filter { $0.rfm.recency == s.0 && $0.rfm.frequency == s.1 }.sorted { $0.totalSpent > $1.totalSpent } } ?? []
        return VStack(alignment: .leading, spacing: 14) {
            niCard {
                VStack(spacing: 0) {
                    Text("ランク別サマリー（S〜D）").font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading).padding(14)
                    HStack { Text("ランク").frame(width: 80, alignment: .leading); Spacer(); Text("人数").frame(width: 100, alignment: .trailing); Text("累計売上").frame(width: 140, alignment: .trailing); Text("売上構成比").frame(width: 100, alignment: .trailing) }
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 34).background(NFColor.lilacSoft)
                    ForEach(summary, id: \.0) { r in
                        HStack {
                            NPBadge(text: r.0, color: NCRank.tone(r.0)).frame(width: 80, alignment: .leading)
                            Spacer()
                            Text("\(r.1)人").frame(width: 100, alignment: .trailing)
                            Text(NT.yen(r.2)).frame(width: 140, alignment: .trailing)
                            Text(String(format: "%.1f%%", r.3)).frame(width: 100, alignment: .trailing)
                        }
                        .font(.system(size: 14)).monospacedDigit().padding(.horizontal, 14).frame(height: 44)
                        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("R × F マトリクス（セルをクリックで顧客リストを表示）").font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.navy)
                Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                    GridRow {
                        Color.clear.frame(width: 60, height: 1)
                        ForEach(1...5, id: \.self) { f in Text("F\(f)").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity) }
                    }
                    ForEach([5, 4, 3, 2, 1], id: \.self) { r in
                        GridRow {
                            Text("R\(r)").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 60, alignment: .trailing)
                            ForEach(1...5, id: \.self) { f in
                                let st = NCRank.heatStyle(avg[r - 1][f - 1], maxAvg)
                                let on = selected?.0 == r && selected?.1 == f
                                Button { selected = on ? nil : (r, f) } label: {
                                    VStack(spacing: 2) {
                                        Text("\(count[r - 1][f - 1])").font(.system(size: 15, weight: .bold)).monospacedDigit()
                                        Text(count[r - 1][f - 1] > 0 ? NT.yen(Int(avg[r - 1][f - 1].rounded())) : "—").font(.system(size: 10)).opacity(0.85)
                                    }
                                    .foregroundColor(st.1).frame(maxWidth: .infinity).frame(height: 62)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(st.0))
                                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? NFColor.iris : Color.clear, lineWidth: 2.5))
                                }.buttonStyle(PressableStyle())
                            }
                        }
                    }
                }
                Text("縦軸: R（最終来店の新しさ・上ほど直近）／横軸: F（来店頻度）／セル内上段は人数、下段は平均累計利用額（M）です。").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                Text("R・F・Mの区分としきい値は lib/crm.ts（calcRfm の固定しきい値、セグメント分類は SEGMENT_THRESHOLDS）で定義された固定値です。本画面から変更はできません。").font(.system(size: 11.5)).foregroundColor(NFColor.ink3.opacity(0.8))
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NFColor.line, lineWidth: 1))
            if let s = selected {
                niCard {
                    VStack(spacing: 0) {
                        HStack {
                            Text("R\(s.0) × F\(s.1) の顧客（\(picked.count)人）").font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.navy)
                            Spacer()
                            Button("絞込を解除") { selected = nil }.font(.system(size: 13, weight: .bold))
                        }.padding(14)
                        if picked.isEmpty {
                            Text("該当する顧客がいません").font(.system(size: 13)).foregroundColor(NFColor.ink3).padding(.vertical, 24)
                        } else {
                            HStack { Text("名前").frame(maxWidth: .infinity, alignment: .leading); Text("電話").frame(width: 140, alignment: .leading); Text("RFMランク").frame(width: 80); Text("来店回数").frame(width: 80, alignment: .trailing); Text("累計利用額").frame(width: 110, alignment: .trailing); Text("最終来店").frame(width: 110, alignment: .leading) }
                                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 34).background(NFColor.lilacSoft)
                            ForEach(picked) { c in
                                Button { onOpen(c.id) } label: {
                                    HStack {
                                        Text(c.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                                        Text(c.phone ?? "—").foregroundColor(NFColor.ink2).frame(width: 140, alignment: .leading)
                                        NPBadge(text: c.rfm.rank, color: NCRank.tone(c.rfm.rank)).frame(width: 80)
                                        Text("\(c.visitCount)回").frame(width: 80, alignment: .trailing)
                                        Text(NT.yen(c.totalSpent)).frame(width: 110, alignment: .trailing)
                                        Text(c.lastVisitAt.map { NPDate.slash(NNDateOnly.jst($0)) } ?? "—").foregroundColor(NFColor.ink2).frame(width: 110, alignment: .leading)
                                    }
                                    .font(.system(size: 13.5)).monospacedDigit().padding(.horizontal, 14).frame(height: 44).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                Rectangle().fill(NFColor.line).frame(height: 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

struct NCDuplicatesView: View {
    @ObservedObject var list: NativeCustomersModel
    @State private var payload: NCDupPayload?
    @State private var target: NCDupGroup?

    var body: some View {
        Group {
            if let p = payload {
                if p.groups.isEmpty {
                    niEmpty("重複候補は見つかりませんでした", "電話番号またはメールアドレスが一致する顧客はありません")
                } else {
                    VStack(spacing: 14) { ForEach(p.groups) { g in group(g, canMerge: p.canMerge) } }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60) }
        }
        .task { await load() }
        .overlay {
            if let g = target {
                NativeModalCard(width: 640) { NCDupMergeForm(group: g, list: list, onClose: { target = nil }, onDone: { Task { await load() } }) }
            }
        }
    }

    private func load() async {
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "customerDuplicates")]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NCDupPayload.self, from: data)
        } catch { list.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"; payload = NCDupPayload(groups: [], canMerge: false) }
    }

    private func group(_ g: NCDupGroup, canMerge: Bool) -> some View {
        niCard {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "person.2").foregroundColor(NFColor.ink3)
                    Text("\(g.matchType == "phone" ? "電話番号が一致" : "メールアドレスが一致")：\(g.key)").font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.navy)
                    Spacer()
                    if canMerge { niSmallButton("統合", tone: .white, fill: NFColor.iris) { target = g } }
                }.padding(14)
                HStack { Text("名前").frame(maxWidth: .infinity, alignment: .leading); Text("電話").frame(width: 140, alignment: .leading); Text("メール").frame(width: 200, alignment: .leading); Text("来店回数").frame(width: 80, alignment: .trailing); Text("累計利用額").frame(width: 110, alignment: .trailing); Text("最終来店").frame(width: 110, alignment: .leading) }
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 34).background(NFColor.lilacSoft)
                ForEach(g.customers) { c in
                    HStack {
                        Text(c.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy).frame(maxWidth: .infinity, alignment: .leading)
                        Text(c.phone ?? "—").foregroundColor(NFColor.ink2).frame(width: 140, alignment: .leading)
                        Text(c.email ?? "—").foregroundColor(NFColor.ink2).lineLimit(1).frame(width: 200, alignment: .leading)
                        Text("\(c.visitCount)回").frame(width: 80, alignment: .trailing)
                        Text(NT.yen(c.totalSpent)).frame(width: 110, alignment: .trailing)
                        Text(c.lastVisitAt.map { NPDate.slash(NNDateOnly.jst($0)) } ?? "—").foregroundColor(NFColor.ink2).frame(width: 110, alignment: .leading)
                    }
                    .font(.system(size: 13.5)).monospacedDigit().padding(.horizontal, 14).frame(height: 44)
                    .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                }
            }
        }
    }
}

/// 重複候補を統合（残す顧客を選ぶ。Web の MergeGroupDialog と同じ）
struct NCDupMergeForm: View {
    let group: NCDupGroup
    @ObservedObject var list: NativeCustomersModel
    let onClose: () -> Void
    let onDone: () -> Void
    @State private var keepId = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "重複候補を統合", onClose: onClose)
            Text("残す顧客を選択してください。予約・注文・ポイント・タグ等の履歴はすべて残した顧客に引き継がれ、選択されなかった顧客は削除扱いになります。この操作は取り消せません。")
                .font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
            ForEach(group.customers) { c in
                Button { keepId = c.id } label: {
                    HStack {
                        Image(systemName: keepId == c.id ? "largecircle.fill.circle" : "circle").foregroundColor(keepId == c.id ? NFColor.iris : NFColor.ink3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
                            Text("\(c.phone ?? "—")｜\(c.email ?? "—")｜来店\(c.visitCount)回｜\(NT.yen(c.totalSpent))").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        Spacer()
                        NPBadge(text: keepId == c.id ? "残す" : "統合される", color: keepId == c.id ? NFColor.iris : NFColor.ink3)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(keepId == c.id ? NFColor.irisSoft.opacity(0.5) : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(keepId == c.id ? NFColor.iris : NFColor.line, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            NIDialogFoot(error: error, busy: list.busy, okText: "統合する", busyText: "統合中…", danger: true, onCancel: onClose) { Task { await merge() } }
        }
        .padding(22)
        .onAppear {
            // 累計利用額・来店回数が多い方を「残す」候補に（Web と同じ）
            if keepId.isEmpty { keepId = group.customers.sorted { ($0.totalSpent, $0.visitCount) > ($1.totalSpent, $1.visitCount) }.first?.id ?? "" }
        }
    }

    private func merge() async {
        let others = group.customers.filter { $0.id != keepId }.map(\.id)
        guard !others.isEmpty else { return }
        if await list.act(["type": "customerMerge", "id": keepId, "mergeIds": others]) != nil {
            list.toast = "顧客を統合しました"
            onClose(); onDone()
        } else { error = list.error; list.error = nil }
    }
}
